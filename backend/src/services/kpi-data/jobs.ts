import type { DatabaseClient } from '../../database/connection.js';
import { pool } from '../../db.js';
import { activeRow, transaction } from '../../repositories/entities.js';

export async function enqueueKpiCalculation(
  client: DatabaseClient,
  actor: string,
  formulaId?: string
) {
  if (formulaId) await activeRow(client, 'kpi_formulas', formulaId);
  return (
    await client.query(
      `INSERT INTO portal.kpi_calculation_jobs(scope,formula_id,requested_by,revision)
    SELECT $1,$2,$3,revision FROM portal.kpi_calculation_state WHERE singleton
    ON CONFLICT (scope) WHERE status='pending' DO UPDATE SET
      revision=EXCLUDED.revision,requested_by=EXCLUDED.requested_by,requested_at=clock_timestamp()
    RETURNING *`,
      [formulaId ? `formula:${formulaId}` : 'all', formulaId ?? null, actor]
    )
  ).rows[0];
}

export async function claimKpiCalculation() {
  // Transaction-scoped lock also works through the existing pooled connection.
  return transaction('', async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-calculation-claim'))");
    const abandoned = (
      await client.query(`UPDATE portal.kpi_calculation_jobs SET status='failed',finished_at=clock_timestamp(),
      message='Berechnung unterbrochen; automatischer Wiederanlauf.'
      WHERE status='running' AND heartbeat_at<clock_timestamp()-interval '5 minutes' RETURNING *`)
    ).rows;
    for (const job of abandoned) {
      const exists =
        job.formula_id &&
        (
          await client.query(
            'SELECT 1 FROM portal.kpi_formulas WHERE "objectId"=$1 AND "archivedAt" IS NULL',
            [job.formula_id]
          )
        ).rowCount;
      await enqueueKpiCalculation(client, job.requested_by, exists ? job.formula_id : undefined);
    }
    if (
      (await client.query("SELECT 1 FROM portal.kpi_calculation_jobs WHERE status='running'"))
        .rowCount
    )
      return null;
    return (
      (
        await client.query(`UPDATE portal.kpi_calculation_jobs SET status='running',started_at=clock_timestamp(),heartbeat_at=clock_timestamp()
      WHERE id=(SELECT id FROM portal.kpi_calculation_jobs WHERE status='pending' ORDER BY CASE WHEN scope='all' THEN 1 ELSE 0 END,requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`)
      ).rows[0] ?? null
    );
  });
}

export async function getKpiCalculation(id?: string, formulaId?: string) {
  const result = id
    ? await pool.query('SELECT * FROM portal.kpi_calculation_jobs WHERE id=$1', [id])
    : await pool.query(
        `SELECT * FROM portal.kpi_calculation_jobs WHERE ($1::uuid IS NULL OR formula_id=$1 OR scope='all')
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,requested_at DESC LIMIT 1`,
        [formulaId ?? null]
      );
  return result.rows[0] ?? null;
}
