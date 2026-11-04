import type { DatabaseClient } from '../database/connection.js';
import { fundCompanies, fundMonth, shiftFundMonth, type FundScope } from './fund-context.js';
import { monthWindow } from './formula-language.js';
import { httpError } from '../shared/errors.js';

type Metric = {
  objectId: string;
  company_id: string;
  name: string;
  metric_number: number;
  unit: string;
  currency: string | null;
};
type Dependency = {
  metric_number: number;
  aggregation: 'MONTH' | 'LTM' | 'YTD';
  prior_year: boolean;
  dimension: string | null;
  kpi_names: string[];
};
type Presence = {
  metric_id: string;
  month: string;
  dimension: string;
  rows: number;
  filled: number;
};
export type DataStatusOptions = {
  fundId: string;
  date?: string;
  dimension: 'actual' | 'budget' | 'forecast' | 'plan';
  scope: FundScope;
  months: number;
  companyId?: string;
};
export async function fundDataStatus(db: DatabaseClient, options: DataStatusOptions) {
  const { fund, companies: fundMembers } = await fundCompanies(db, options.fundId, options.scope);
  if (options.companyId && !fundMembers.some((c) => c.objectId === options.companyId))
    throw httpError(404, 'Company gehört nicht zu dieser Fund-Auswahl.');
  const date = await fundMonth(
    db,
    fundMembers.map((c) => c.objectId),
    options.dimension,
    options.date
  );
  const months = Array.from({ length: options.months }, (_, index) =>
    shiftFundMonth(date, index + 1 - options.months)
  );
  const companies = options.companyId
    ? fundMembers.filter((c) => c.objectId === options.companyId)
    : fundMembers;
  const ids = companies.map((c) => c.objectId);
  const metrics = (
    await db.query<Metric>(
      'SELECT "objectId",company_id,name,metric_number,unit,currency FROM portal.metrics WHERE company_id=ANY($1::uuid[]) AND "archivedAt" IS NULL ORDER BY metric_number,name',
      [ids]
    )
  ).rows;
  // Every active formula contributes its MetricData inputs, including nested KPIs:
  // their variables are in this same active graph, without evaluating each KPI.
  const dependencies = (
    await db.query<Dependency>(
      `SELECT v.metric_number,v.aggregation,v.prior_year,v.dimension,array_agg(DISTINCT f.name ORDER BY f.name) AS kpi_names
 FROM portal.variable_map v JOIN portal.kpi_formulas f ON f."objectId"=v.formula_id AND f."archivedAt" IS NULL
 WHERE v."archivedAt" IS NULL AND v.entity='metric_data' AND v.aggregation IN ('MONTH','LTM','YTD')
 GROUP BY v.metric_number,v.aggregation,v.prior_year,v.dimension ORDER BY v.metric_number`,
      []
    )
  ).rows;
  const earliest = shiftFundMonth(months[0], -23);
  const presences = (
    await db.query<Presence>(
      `SELECT d.metric_id,to_char(date_trunc('month',d.period),'YYYY-MM') AS month,d.dimension,
   count(*)::int AS rows,count(d.value)::int AS filled
 FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
 WHERE m.company_id=ANY($1::uuid[]) AND d."archivedAt" IS NULL AND d.period >= $2::date AND d.period < $3::date+interval '1 month'
 AND d.dimension=ANY($4::text[])
 GROUP BY d.metric_id,date_trunc('month',d.period),d.dimension`,
      [
        ids,
        `${earliest}-01`,
        `${date}-01`,
        [
          ...new Set([
            options.dimension,
            ...dependencies
              .map((item) => item.dimension)
              .filter((value): value is string => value !== null),
          ]),
        ],
      ]
    )
  ).rows;
  const byKey = new Map(
    presences.map((row) => [`${row.metric_id}:${row.month}:${row.dimension}`, row])
  );
  const requiredNumbers = new Set(dependencies.map((d) => d.metric_number));
  const rows = companies.map((company) => {
    const own = metrics.filter((metric) => metric.company_id === company.objectId);
    const byNumber = new Map<number, Metric[]>();
    for (const metric of own)
      byNumber.set(metric.metric_number, [...(byNumber.get(metric.metric_number) || []), metric]);
    const cells = months.map((month) => {
      const required = new Map<
        string,
        {
          metricNumber: number;
          metricId: string | null;
          month: string;
          dimension: string;
          kpis: Set<string>;
        }
      >();
      for (const dependency of dependencies) {
        const matches = byNumber.get(dependency.metric_number) || [];
        for (const period of monthWindow(
          `${month}-01`,
          dependency.aggregation,
          dependency.prior_year
        ).months) {
          const targetMonth = period.slice(0, 7),
            dimension = dependency.dimension || options.dimension;
          const key = `${dependency.metric_number}:${targetMonth}:${dimension}`;
          const cell = required.get(key) || {
            metricNumber: dependency.metric_number,
            metricId: matches.length === 1 ? matches[0].objectId : null,
            month: targetMonth,
            dimension,
            kpis: new Set<string>(),
          };
          dependency.kpi_names.forEach((name) => cell.kpis.add(name));
          required.set(key, cell);
        }
      }
      const missing = [...required.values()].filter((item) => {
        const row = item.metricId
          ? byKey.get(`${item.metricId}:${item.month}:${item.dimension}`)
          : null;
        return !row || row.rows !== 1 || row.filled !== 1;
      });
      const filled = own.filter((metric) => {
        const row = byKey.get(`${metric.objectId}:${month}:${options.dimension}`);
        return row?.rows === 1 && row.filled === 1;
      }).length;
      const status = missing.length
        ? 'red'
        : own.length > 0 && filled === own.length
          ? 'green'
          : own.length > 0
            ? 'yellow'
            : 'red';
      return {
        month,
        status,
        filled,
        total: own.length,
        required: required.size,
        requiredMissing: missing.length,
        ...(options.companyId
          ? { missing: missing.map((item) => ({ ...item, kpis: [...item.kpis] })) }
          : {}),
      };
    });
    return { company, cells };
  });
  let detail;
  if (options.companyId) {
    const values = (
      await db.query(
        `SELECT d.metric_id,to_char(date_trunc('month',d.period),'YYYY-MM') AS month,d.value::text AS value,d.currency
     FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
     WHERE m.company_id=$1 AND d.dimension=$2 AND d."archivedAt" IS NULL AND d.period >= $3::date AND d.period < $4::date+interval '1 month'
     ORDER BY d.period`,
        [options.companyId, options.dimension, `${months[0]}-01`, `${date}-01`]
      )
    ).rows;
    const data = new Map<string, typeof values>();
    for (const value of values) {
      const key = `${value.metric_id}:${value.month}`;
      data.set(key, [...(data.get(key) || []), value]);
    }
    detail = metrics.map((metric) => ({
      ...metric,
      requiredByKpi: requiredNumbers.has(metric.metric_number),
      kpis: [
        ...new Set(
          dependencies
            .filter((d) => d.metric_number === metric.metric_number)
            .flatMap((d) => d.kpi_names)
        ),
      ],
      values: months.map((month) => {
        const records = data.get(`${metric.objectId}:${month}`) || [];
        return {
          month,
          value: records.length === 1 ? records[0].value : null,
          status:
            records.length > 1
              ? 'duplicate'
              : records.length === 1 && records[0].value !== null
                ? 'ok'
                : 'missing',
          currency: records[0]?.currency || metric.currency,
        };
      }),
    }));
  }
  return {
    fund: { objectId: fund.objectId, name: fund.name },
    date,
    dimension: options.dimension,
    scope: options.scope,
    months,
    rows,
    dependencyCount: dependencies.length,
    definition:
      'Grün: alle definierten Company-Metrics eindeutig numerisch gepflegt. Gelb: alle von aktiven KPIs verwendeten MetricData-Quellen inklusive LTM/YTD/V12P und Dimensionsvorgaben vorhanden. Rot: mindestens eine KPI-Quelle fehlt oder ist mehrdeutig. Andere KPI-Quellen außerhalb MetricData werden hier nicht beurteilt.',
    ...(detail ? { detail } : {}),
  };
}
