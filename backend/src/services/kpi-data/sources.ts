import type { DatabaseClient, DatabaseResult } from '../../database/connection.js';
import { Decimal } from 'decimal.js';
const Precise = Decimal.clone({ precision: 40 });

export interface KpiSourceData {
  formulas: Map<string, Record<string, any>>;
  metrics: Map<number, Record<string, any>[]>;
  metricData: Map<string, { month: string; value: string | null; currency: string | null }[]>;
  rates: Map<string, { index_value: string }[]>;
  movements: Record<string, any>[];
}

export function cumulativeSourceValues(
  sources: KpiSourceData,
  cutoff: string,
  filter: { field: string; value: string | null } | null
) {
  const groups = new Map<string, { currency: string; value: string; undated: number }>();
  for (const row of sources.movements) {
    if (row.movement_date && row.movement_date >= cutoff) continue;
    if (filter && String(row[filter.field]) !== filter.value) continue;
    const group = groups.get(row.currency) ?? { currency: row.currency, value: '0', undated: 0 };
    if (!row.movement_date) group.undated++;
    else group.value = new Precise(group.value).plus(row.value).toString();
    groups.set(row.currency, group);
  }
  return [...groups.values()];
}

/** Memoization stays inside one repeatable-read snapshot and one company. */
export function memoizeCalculationReads(client: DatabaseClient): DatabaseClient {
  const cache = new Map<string, Promise<DatabaseResult>>();
  return {
    query<Row extends Record<string, any> = any>(
      sql: string,
      values?: any[]
    ): Promise<DatabaseResult<Row>> {
      const key = JSON.stringify([sql, values]);
      let value = cache.get(key);
      if (!value) {
        value = client.query(sql, values);
        cache.set(key, value);
      }
      return value as Promise<DatabaseResult<Row>>;
    },
    release() {},
  };
}

export async function loadCalculationSources(
  client: DatabaseClient,
  companyId: string
): Promise<KpiSourceData> {
  const formulas = (
    await client.query('SELECT * FROM portal.kpi_formulas WHERE "archivedAt" IS NULL')
  ).rows;
  const variables = (
    await client.query(
      'SELECT * FROM portal.variable_map WHERE "archivedAt" IS NULL ORDER BY identifier'
    )
  ).rows;
  const metrics = (
    await client.query(
      'SELECT "objectId",currency,unit,metric_number FROM portal.metrics WHERE company_id=$1 AND "archivedAt" IS NULL',
      [companyId]
    )
  ).rows;
  const data = (
    await client.query(
      `SELECT d.metric_id,d.dimension,to_char(date_trunc('month',d.period),'YYYY-MM-DD') AS month,d.value::text AS value,d.currency
    FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
    WHERE m.company_id=$1 AND d."archivedAt" IS NULL ORDER BY d.period`,
      [companyId]
    )
  ).rows;
  const rates = (
    await client.query(`SELECT currency,to_char(period,'YYYY-MM-DD') AS period,index_value::text AS index_value
    FROM portal.index_rates WHERE base_currency='EUR' AND "archivedAt" IS NULL ORDER BY as_of_date DESC`)
  ).rows;
  const movements = (
    await client.query(
      `SELECT *,to_char(movement_date,'YYYY-MM-DD') AS movement_date
    FROM portal.capital_movements WHERE company_id=$1 AND "archivedAt" IS NULL`,
      [companyId]
    )
  ).rows;
  const result: KpiSourceData = {
    formulas: new Map(
      formulas.map((f) => [
        f.objectId,
        { ...f, variables: variables.filter((v) => v.formula_version_id === f.id) },
      ])
    ),
    metrics: new Map(),
    metricData: new Map(),
    rates: new Map(),
    movements,
  };
  for (const metric of metrics)
    result.metrics.set(metric.metric_number, [
      ...(result.metrics.get(metric.metric_number) ?? []),
      metric,
    ]);
  for (const row of data) {
    const key = `${row.metric_id}:${row.dimension}`;
    const rows = result.metricData.get(key) ?? [];
    rows.push(row);
    result.metricData.set(key, rows);
  }
  for (const rate of rates) {
    const key = `${rate.currency}:${rate.period}`;
    if (!result.rates.has(key)) result.rates.set(key, [rate]);
  }
  return result;
}

export function requiredEntities(
  id: string,
  sources: KpiSourceData,
  visited = new Set<string>()
): string[] {
  if (visited.has(id)) return [];
  visited.add(id);
  const required = new Set(['kpi_formulas', 'variable_map', 'companies', 'funds']);
  for (const variable of sources.formulas.get(id)?.variables ?? []) {
    required.add(variable.entity);
    if (['MONTH', 'LTM', 'YTD'].includes(variable.aggregation)) required.add('metrics');
    if (variable.target_kpi_id)
      for (const entity of requiredEntities(variable.target_kpi_id, sources, visited))
        required.add(entity);
  }
  return [...required].sort();
}

export function dependencyVersions(
  id: string,
  sources: KpiSourceData,
  versions: Record<string, string> = {}
): Record<string, string> {
  if (Object.hasOwn(versions, id)) return versions;
  const formula = sources.formulas.get(id);
  if (!formula) return versions;
  versions[id] = formula.id;
  for (const variable of formula.variables)
    if (variable.target_kpi_id) dependencyVersions(variable.target_kpi_id, sources, versions);
  return versions;
}
