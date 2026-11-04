import { setImmediate as yieldEventLoop, setTimeout as waitForWorker } from 'node:timers/promises';
import { pool } from '../../db.js';
import { definitions } from '../../entities.js';
import { KpiEngine } from '../kpi-engine.js';
import { claimKpiCalculation, enqueueKpiCalculation } from './jobs.js';
import { transaction } from '../../repositories/entities.js';
import {
  loadCalculationSources,
  memoizeCalculationReads,
  requiredEntities,
  dependencyVersions,
} from './sources.js';
import { storeKpiData } from './write.js';
import type { ReportContext } from '../kpi-schema.js';

let stopping = false;
let executing = false;
const systemRights = Object.fromEntries(
  Object.keys(definitions).map((entity) => [entity, { can_read: true }])
);
class Superseded extends Error {}
type CompanyPlan = {
  objectId: string;
  periods: string[];
  dimensions: ReportContext['dimension'][];
};

async function calculationPlan(): Promise<CompanyPlan[]> {
  const rows = (
    await pool.query(`SELECT c."objectId",to_char(min(d.period),'YYYY-MM-01') AS start,
    to_char(max(d.period),'YYYY-MM-01') AS finish,
    to_char(coalesce(max(d.period) FILTER(WHERE d.dimension='actual' AND d.value IS NOT NULL AND m.metric_number BETWEEN 1000000 AND 1009899),
      max(d.period) FILTER(WHERE d.dimension='actual' AND d.value IS NOT NULL)),'YYYY-MM-01') AS latest_actual,
    array_agg(DISTINCT d.dimension) FILTER(WHERE d.dimension IS NOT NULL) AS dimensions
    FROM portal.companies c LEFT JOIN portal.metric_data d ON d.company_id=c."objectId" AND d."archivedAt" IS NULL
    LEFT JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
    WHERE c."archivedAt" IS NULL GROUP BY c."objectId" ORDER BY c."objectId"`)
  ).rows;
  const plans = rows.map((row) => {
    const current = `${new Date().toISOString().slice(0, 7)}-01`;
    const date = new Date(`${row.start ?? current}T00:00:00Z`);
    const finish = row.finish ?? current;
    const periods: string[] = [];
    while (date.toISOString().slice(0, 10) <= finish) {
      periods.push(date.toISOString().slice(0, 10));
      date.setUTCMonth(date.getUTCMonth() + 1);
    }
    return {
      objectId: row.objectId,
      periods,
      latest: row.latest_actual ?? finish,
      dimensions: [...new Set<ReportContext['dimension']>(['actual', ...(row.dimensions ?? [])])],
    };
  });
  // Warm today's reporting context across all companies before backfilling
  // their older months. Historical rows are then processed newest first.
  return [
    ...plans.map((plan) => ({ ...plan, periods: [plan.latest] })),
    ...plans
      .map((plan) => ({
        ...plan,
        periods: plan.periods.filter((period) => period !== plan.latest).reverse(),
      }))
      .filter((plan) => plan.periods.length),
  ];
}

async function runJob(job: Record<string, any>) {
  const actor = (
    await pool.query(
      `SELECT "objectId" FROM portal.users WHERE active AND "archivedAt" IS NULL
    AND (email=$1 OR "objectId"=$2) ORDER BY (email=$1) DESC LIMIT 1`,
      [process.env.ADMIN_EMAIL, job.requested_by]
    )
  ).rows[0]?.objectId;
  if (!actor) throw new Error('Kein aktiver Benutzer für die Berechnung verfügbar.');
  const ids = (
    await pool.query(
      `WITH RECURSIVE selected(id) AS (
    (SELECT $1::uuid WHERE $1::uuid IS NOT NULL
      UNION SELECT "objectId" FROM portal.kpi_formulas WHERE "archivedAt" IS NULL AND $1::uuid IS NULL)
    UNION SELECT v.formula_id FROM portal.variable_map v JOIN selected s ON v.target_kpi_id=s.id WHERE v."archivedAt" IS NULL
  ) SELECT f."objectId" FROM selected s JOIN portal.kpi_formulas f ON f."objectId"=s.id AND f."archivedAt" IS NULL`,
      [job.formula_id]
    )
  ).rows.map((row) => row.objectId as string);
  const plan = await calculationPlan();
  const total = plan.reduce(
    (sum, company) => sum + company.periods.length * company.dimensions.length * 2 * ids.length,
    0
  );
  await pool.query('UPDATE portal.kpi_calculation_jobs SET total=$2 WHERE id=$1', [job.id, total]);
  let progress = 0,
    successful = 0,
    missing = 0,
    errors = 0;
  for (const company of plan) {
    if (stopping)
      throw new Error('Backend beendet; Berechnung wird beim nächsten Start erneut aufgenommen.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='30s'");
      const revision = String(
        (await client.query('SELECT revision FROM portal.kpi_calculation_state WHERE singleton'))
          .rows[0].revision
      );
      if (revision !== String(job.revision))
        throw new Superseded('Quelldaten geändert; der neuere Auftrag übernimmt.');
      const sources = await loadCalculationSources(client, company.objectId);
      const db = memoizeCalculationReads(client);
      const dependencies = new Map(ids.map((id) => [id, requiredEntities(id, sources)]));
      let batch: Record<string, any>[] = [];
      for (const period of company.periods)
        for (const dimension of company.dimensions)
          for (const currency of ['CC', 'EUR'] as const) {
            const engine = new KpiEngine(
              db,
              systemRights,
              {
                company_id: company.objectId,
                date: period,
                dimension,
                currency,
              },
              { bypassStored: true, sources }
            );
            for (const id of ids) {
              if (!sources.formulas.has(id))
                throw new Superseded('KPI wurde zwischenzeitlich geändert oder archiviert.');
              const result = await engine.evaluateId(id);
              batch.push({
                kpi_id: id,
                formula_version_id: sources.formulas.get(id)!.id,
                company_id: company.objectId,
                name: result.name,
                period,
                value: result.value,
                dimension,
                currency_mode: currency,
                currency: result.currency_context.code,
                unit: result.unit,
                status: result.status === 'forbidden' ? 'error' : result.status,
                message: result.message ?? null,
                source_revision: revision,
                calculated_at: new Date().toISOString(),
                required_entities: dependencies.get(id),
                formula_versions: dependencyVersions(id, sources),
                result,
              });
              progress++;
              if (result.status === 'ok') successful++;
              else if (result.status === 'missing') missing++;
              else errors++;
            }
            if (batch.length >= 500) {
              if (stopping)
                throw new Error('Berechnung wird beim nächsten Backend-Start fortgesetzt.');
              if (!(await storeKpiData(actor, job.id, revision, batch)))
                throw new Superseded('Ein neuerer Datenstand wird berechnet.');
              batch = [];
              await pool.query(
                "UPDATE portal.kpi_calculation_jobs SET progress=$2,successful=$3,missing=$4,errors=$5,heartbeat_at=clock_timestamp() WHERE id=$1 AND status='running'",
                [job.id, progress, successful, missing, errors]
              );
              await yieldEventLoop();
            }
          }
      if (batch.length && !(await storeKpiData(actor, job.id, revision, batch)))
        throw new Superseded('Ein neuerer Datenstand wird berechnet.');
      await client.query('COMMIT');
      await pool.query(
        `UPDATE portal.kpi_calculation_jobs SET progress=$2,successful=$3,missing=$4,errors=$5,heartbeat_at=clock_timestamp() WHERE id=$1 AND status='running'`,
        [job.id, progress, successful, missing, errors]
      );
      console.log(`KPIData: ${progress}/${total} Monatswerte berechnet.`);
      if (
        job.scope === 'all' &&
        (
          await pool.query(
            "SELECT 1 FROM portal.kpi_calculation_jobs WHERE status='pending' AND formula_id IS NOT NULL LIMIT 1"
          )
        ).rowCount
      )
        throw new Superseded(
          'Gezielte KPI-Neuberechnung hat Vorrang; der Gesamtaufbau wird fortgesetzt.'
        );
      await yieldEventLoop();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query(
    `UPDATE portal.kpi_calculation_jobs SET status='completed',finished_at=clock_timestamp(),message=$2 WHERE id=$1 AND status='running'`,
    [
      job.id,
      `Berechnung abgeschlossen: ${successful} Werte, ${missing} fehlende Daten, ${errors} Berechnungsfehler.`,
    ]
  );
}

export async function runNextKpiCalculation() {
  if (executing || stopping) return false;
  executing = true;
  let job: Record<string, any> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    job = await claimKpiCalculation();
    if (!job) return false;
    const jobId = job.id;
    heartbeat = setInterval(() => {
      void pool
        .query(
          "UPDATE portal.kpi_calculation_jobs SET heartbeat_at=clock_timestamp() WHERE id=$1 AND status='running'",
          [jobId]
        )
        .catch(() => {});
    }, 15000);
    heartbeat.unref();
    await runJob(job);
    return true;
  } catch (error) {
    if (job && stopping) {
      await transaction('', async (client) => {
        await client.query(
          "UPDATE portal.kpi_calculation_jobs SET status='failed',message='Backend-Neustart; Neuberechnung vorgemerkt.',finished_at=clock_timestamp() WHERE id=$1 AND status='running'",
          [job!.id]
        );
        await enqueueKpiCalculation(client, job!.requested_by);
      });
    } else if (job) {
      await transaction('', async (client) => {
        await client.query(
          `UPDATE portal.kpi_calculation_jobs SET status=$2,message=$3,finished_at=clock_timestamp() WHERE id=$1 AND status='running'`,
          [job!.id, error instanceof Superseded ? 'completed' : 'failed', (error as Error).message]
        );
        if (error instanceof Superseded && job!.scope === 'all')
          await enqueueKpiCalculation(client, job!.requested_by);
      });
    }
    if (!(error instanceof Superseded))
      console.error('KPIData calculation:', (error as Error).message);
    return Boolean(job);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    executing = false;
  }
}

export function startKpiCalculationWorker() {
  stopping = false;
  const tick = () => {
    void runNextKpiCalculation().catch((error: Error) =>
      console.error('KPIData worker:', error.message)
    );
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (executing) await waitForWorker(100);
  };
}
