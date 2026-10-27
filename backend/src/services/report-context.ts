import { z } from 'zod';
import { pool } from '../db.js';

/** Shared defaults for company reports: latest available revenue month, otherwise latest data. */
export async function reportMonth(
  companyId: string,
  requested: unknown,
  dimension = 'actual'
): Promise<string> {
  const selected = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .parse(requested);
  if (selected) return selected;
  const result = await pool.query(
    `SELECT to_char(coalesce(
       max(d.period) FILTER (WHERE m.metric_number BETWEEN 1000000 AND 1009899),
       max(d.period), current_date), 'YYYY-MM') AS month
     FROM portal.metric_data d
     JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
     WHERE m.company_id=$1 AND d.dimension=$2 AND d.value IS NOT NULL AND d."archivedAt" IS NULL`,
    [companyId, dimension]
  );
  return result.rows[0].month;
}
