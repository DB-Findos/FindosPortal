import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../database/connection.js';
import { KpiEngine, type KpiResult } from './kpi-engine.js';
import { permit, type Rights } from './kpi-definitions.js';
import { readMonthlyKpiDataRange } from './kpi-data/read.js';
import type { BridgeContext } from './bridge-report.js';

const D = Decimal.clone({ precision: 40 });

/** The chart's base is the monthly CC result. EUR uses one report-date rate. */
export async function bridgeHistory(
  db: DatabaseClient,
  rights: Rights,
  context: BridgeContext,
  companyCurrency: string,
  bindings: readonly { key: string; kpiId?: string; kind: string }[]
) {
  const selected = new Date(`${context.date}-01T00:00:00Z`);
  const start = new Date(selected);
  start.setUTCMonth(start.getUTCMonth() - 17);
  const end = new Date(selected);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const reportContext = {
    company_id: context.companyId,
    date: `${context.date}-01`,
    dimension: context.dimension,
    currency: 'CC' as const,
  };
  // One database read for the entire chart, with the same freshness and
  // dependency/permission checks as individual KPIData reads.
  const stored = await readMonthlyKpiDataRange(
    db,
    rights,
    reportContext,
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10),
    bindings
      .filter((binding) => binding.kind === 'change' && binding.kpiId)
      .map((binding) => binding.kpiId!)
  );
  let factor: Decimal | null = new D(1);
  let rateMessage: string | undefined;
  if (context.currency === 'EUR' && companyCurrency !== 'EUR') {
    permit(rights, 'index_rates');
    const rate = (
      await db.query(
        `SELECT index_value::text AS value FROM portal.index_rates
      WHERE base_currency='EUR' AND currency=$1 AND period=$2::date AND "archivedAt" IS NULL
      ORDER BY as_of_date DESC LIMIT 1`,
        [companyCurrency, `${context.date}-01`]
      )
    ).rows[0];
    if (!rate || !new D(rate.value).isFinite() || new D(rate.value).lte(0)) {
      factor = null;
      rateMessage = `Kein gültiger Indexkurs EUR/${companyCurrency} für ${context.date} vorhanden.`;
    } else factor = new D(1).div(rate.value);
  }
  return async (month: string): Promise<Map<string, KpiResult>> => {
    const values = new Map<string, KpiResult>();
    const engine = new KpiEngine(
      db,
      rights,
      { ...reportContext, date: `${month}-01` },
      { bypassStored: true }
    );
    for (const binding of bindings) {
      if (binding.kind !== 'change' || !binding.kpiId) continue;
      const result =
        stored.get(`${month}-01`)?.get(binding.kpiId) ?? (await engine.evaluateId(binding.kpiId));
      const converted: KpiResult = {
        ...result,
        currency_context: {
          mode: context.currency,
          code: context.currency === 'EUR' ? 'EUR' : companyCurrency,
        },
        // Only the chart value is converted; source-variable details are not
        // part of the series response and must not be mislabeled as EUR.
        variables: [],
      };
      if (result.status === 'ok' && result.value !== null) {
        converted.value = factor ? new D(result.value).mul(factor).toString() : null;
        if (!factor) {
          converted.status = 'missing';
          converted.message = rateMessage;
        }
      }
      values.set(binding.key, converted);
    }
    return values;
  };
}
