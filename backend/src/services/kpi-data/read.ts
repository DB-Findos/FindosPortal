import type { DatabaseClient } from '../../database/connection.js';
import type { Rights } from '../kpi-definitions.js';
import type { ReportContext } from '../kpi-schema.js';
import type { KpiResult } from '../kpi-engine.js';

export async function readMonthlyKpiData(
  client: DatabaseClient,
  rights: Rights,
  context: ReportContext
): Promise<Map<string, KpiResult>> {
  const start = `${context.date.slice(0, 7)}-01`;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return (
    (
      await readMonthlyKpiDataRange(client, rights, context, start, end.toISOString().slice(0, 10))
    ).get(start) ?? new Map()
  );
}

export async function readMonthlyKpiDataRange(
  client: DatabaseClient,
  rights: Rights,
  context: ReportContext,
  start: string,
  end: string,
  kpiIds?: string[]
): Promise<Map<string, Map<string, KpiResult>>> {
  if (!rights.kpi_data?.can_read) return new Map();
  const rows = (
    await client.query(
      `SELECT d.kpi_id,to_char(d.period,'YYYY-MM-DD') AS period,d.required_entities,d.result
    FROM portal.kpi_data d
    JOIN portal.kpi_formulas f ON f.id=d.formula_version_id AND f."archivedAt" IS NULL
    JOIN portal.kpi_calculation_state s ON s.singleton AND s.revision=d.source_revision
    JOIN portal.companies c ON c."objectId"=d.company_id AND c."archivedAt" IS NULL
    WHERE d.company_id=$1 AND d.period >= $2::date AND d.period < $3::date AND d.dimension=$4 AND d.currency_mode=$5 AND d."archivedAt" IS NULL
      AND d.status IN ('ok','missing') AND d.formula_versions ? d.kpi_id::text
      AND ($6::uuid[] IS NULL OR d.kpi_id=ANY($6::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(d.formula_versions) v
        WHERE NOT EXISTS (SELECT 1 FROM portal.kpi_formulas dependency WHERE dependency.id=v.value::uuid AND dependency."objectId"=v.key::uuid AND dependency."archivedAt" IS NULL))`,
      [context.company_id, start, end, context.dimension, context.currency || 'CC', kpiIds ?? null]
    )
  ).rows;
  const results = new Map<string, Map<string, KpiResult>>();
  for (const row of rows) {
    if (!row.required_entities.every((entity: string) => rights[entity]?.can_read)) continue;
    const month = results.get(row.period) ?? new Map<string, KpiResult>();
    month.set(row.kpi_id, row.result as KpiResult);
    results.set(row.period, month);
  }
  return results;
}
