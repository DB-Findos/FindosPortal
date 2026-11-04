import { Decimal } from 'decimal.js';
import type { DatabaseClient, DatabaseResult } from '../database/connection.js';
import { activeRow, current } from '../repositories/entities.js';
import { KpiEngine, type KpiResult } from './kpi-engine.js';
import { permit, type Rights } from './kpi-definitions.js';
import { bridgeDefinitions, bridgeReportName } from './bridge-definitions.js';
import { httpError } from '../shared/errors.js';
import { bridgeHistory } from './bridge-history.js';

/** Request-scoped cache within the same read-only database snapshot. */
function memoizeReads(db: DatabaseClient): DatabaseClient {
  const cache = new Map<string, Promise<DatabaseResult>>();
  return {
    query<Row extends Record<string, any> = any>(
      sql: string,
      values?: any[]
    ): Promise<DatabaseResult<Row>> {
      const key = JSON.stringify([sql, values]);
      let result = cache.get(key);
      if (!result) {
        result = db.query(sql, values);
        cache.set(key, result);
      }
      return result as Promise<DatabaseResult<Row>>;
    },
    release() {},
  };
}
export type BridgeContext = {
  companyId: string;
  date: string;
  currency: 'CC' | 'EUR';
  dimension: 'actual' | 'budget' | 'forecast' | 'plan';
  includeHistory?: boolean;
};

export async function bridgeReport(client: DatabaseClient, rights: Rights, context: BridgeContext) {
  for (const entity of [
    'companies',
    'report_definitions',
    'report_items',
    'kpi_formulas',
    'variable_map',
  ])
    permit(rights, entity);
  const db = memoizeReads(client);
  const company = await activeRow(db, 'companies', context.companyId);
  const reports = (
    await db.query(
      `SELECT "objectId" FROM portal.report_definitions WHERE name=$1 AND ${current}`,
      [bridgeReportName]
    )
  ).rows;
  if (reports.length !== 1)
    throw httpError(
      422,
      'Findos Equity Bridge ist nicht eingerichtet. Bitte db:seed-bridge ausführen.'
    );
  const formulas = (
    await db.query(
      `SELECT f."objectId",f.name FROM portal.report_items i
     JOIN portal.kpi_formulas f ON f."objectId"=i.kpi_id AND f."archivedAt" IS NULL
     WHERE i.report_id=$1 AND i."archivedAt" IS NULL ORDER BY i.position`,
      [reports[0].objectId]
    )
  ).rows;
  const bindings = bridgeDefinitions.map((definition) => ({
    ...definition,
    kpiId: formulas.find((formula) => formula.name === definition.name)?.objectId as
      string | undefined,
  }));
  const companyCurrency =
    company.currency || (await activeRow(db, 'funds', company.fund_id)).currency;
  const targetCurrency = context.currency === 'EUR' ? 'EUR' : companyCurrency;
  const warnings = new Set<string>();
  const evaluate = async (month: string) => {
    const engine = new KpiEngine(
      db,
      rights,
      {
        company_id: context.companyId,
        date: `${month}-01`,
        currency: context.currency,
        dimension: context.dimension,
      },
      { currencyDate: `${context.date}-01` }
    );
    const values = new Map<string, KpiResult>();
    for (const binding of bindings) {
      if (binding.kpiId) values.set(binding.key, await engine.evaluateId(binding.kpiId));
    }
    return values;
  };
  const results = await evaluate(context.date);
  let running: Decimal | null = null;
  const bars = bindings.map((binding) => {
    const result = results.get(binding.key);
    if (result?.status === 'forbidden')
      throw httpError(403, 'Keine Berechtigung für eine Quelle der Equity Bridge.');
    const value =
      result?.status === 'ok' && result.value !== null ? new Decimal(result.value) : null;
    const message =
      result?.message || (!binding.kpiId ? `Die Definition für ${binding.name} fehlt noch.` : null);
    if (message) warnings.add(`${binding.label}: ${message}`);
    const start = binding.kind === 'total' ? new Decimal(0) : running;
    const end =
      binding.kind === 'total'
        ? value
        : running !== null && value !== null
          ? running.plus(value)
          : null;
    const bar = {
      ...binding,
      kpiId: binding.kpiId ?? null,
      value: value?.toNumber() ?? null,
      start: start?.toNumber() ?? null,
      end: end?.toNumber() ?? null,
      status: result?.status ?? 'missing',
      message,
    };
    if (
      binding.key === 't1' &&
      running !== null &&
      value !== null &&
      running.minus(value).abs().gt('0.01')
    )
      warnings.add('Die Summe der Effekte weicht vom unabhängig berechneten Equity Value T1 ab.');
    running = end;
    return bar;
  });
  const series = bindings
    .filter((binding) => binding.kind === 'change')
    .map((binding) => ({
      key: binding.key,
      label: binding.label,
      kpiId: binding.kpiId ?? null,
      points: [] as {
        month: string;
        value: number | null;
        status: string;
        message: string | null;
      }[],
    }));
  const history =
    context.includeHistory === false
      ? null
      : await bridgeHistory(db, rights, context, companyCurrency, bindings);
  for (let offset = context.includeHistory === false ? 1 : -17; offset <= 0; offset++) {
    const date = new Date(`${context.date}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const month = date.toISOString().slice(0, 7);
    const values = await history!(month);
    for (const item of series) {
      const result = values.get(item.key);
      if (result?.status === 'forbidden')
        throw httpError(403, 'Keine Berechtigung für eine Quelle des Bridge-Verlaufs.');
      item.points.push({
        month,
        value:
          result?.status === 'ok' && result.value !== null
            ? new Decimal(result.value).toNumber()
            : null,
        status: result?.status ?? 'missing',
        message: result?.message ?? null,
      });
    }
  }
  return {
    company: { objectId: company.objectId, name: company.name },
    date: context.date,
    dimension: context.dimension,
    currency: { mode: context.currency, code: targetCurrency },
    valueScale: 1000000,
    bars,
    series,
    warnings: [...warnings],
  };
}
