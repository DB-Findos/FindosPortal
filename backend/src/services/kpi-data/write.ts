import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { transaction } from '../../repositories/entities.js';

export const kpiDataKey = (row: Record<string, any>) =>
  [row.kpi_id, row.company_id, row.period, row.dimension, row.currency_mode].join(':');

export async function storeKpiData(
  actor: string,
  jobId: string,
  revision: string,
  records: Record<string, any>[]
) {
  return transaction(actor, async (client) => {
    const state = (
      await client.query(
        `SELECT s.revision,j.status FROM portal.kpi_calculation_state s
      CROSS JOIN portal.kpi_calculation_jobs j WHERE s.singleton AND j.id=$1`,
        [jobId]
      )
    ).rows[0];
    if (String(state?.revision) !== revision || state?.status !== 'running') return false;
    const versions = [
      ...new Set(records.flatMap((record) => Object.values(record.formula_versions) as string[])),
    ];
    const activeVersions = (
      await client.query(
        'SELECT count(*)::int AS count FROM portal.kpi_formulas WHERE id=ANY($1::uuid[]) AND "archivedAt" IS NULL',
        [versions]
      )
    ).rows[0].count;
    if (activeVersions !== versions.length) return false;
    const existing = new Map(
      (
        await client.query(
          `SELECT * FROM portal.kpi_data WHERE company_id=$1 AND kpi_id=ANY($2::uuid[])
      AND period=ANY($3::date[]) AND "archivedAt" IS NULL FOR UPDATE`,
          [
            records[0].company_id,
            [...new Set(records.map((r) => r.kpi_id))],
            [...new Set(records.map((r) => r.period))],
          ]
        )
      ).rows.map((row) => [kpiDataKey(row), row])
    );
    const changed: Record<string, any>[] = [];
    const archive: string[] = [];
    for (const record of records) {
      const previous = existing.get(kpiDataKey(record));
      if (
        previous &&
        Object.entries(record).every(
          ([key, value]) => key === 'calculated_at' || isDeepStrictEqual(previous[key], value)
        )
      )
        continue;
      if (previous) archive.push(previous.id);
      changed.push({
        ...record,
        objectId: previous?.objectId ?? randomUUID(),
        priorId: previous?.id ?? null,
      });
    }
    if (archive.length)
      await client.query(
        'UPDATE portal.kpi_data SET "archivedAt"=clock_timestamp() WHERE id=ANY($1::uuid[])',
        [archive]
      );
    if (changed.length) {
      const names = Object.keys(changed[0])
        .map((name) => `"${name}"`)
        .join(',');
      await client.query(
        `INSERT INTO portal.kpi_data (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::portal.kpi_data,$1::jsonb)`,
        [JSON.stringify(changed)]
      );
    }
    return true;
  });
}
