import type { DatabaseClient } from '../database/connection.js';
import { activeRow } from '../repositories/entities.js';
export type FundScope = 'portfolio' | 'all';
export async function fundCompanies(db: DatabaseClient, fundId: string, scope: FundScope) {
  const fund = await activeRow(db, 'funds', fundId);
  const companies = (
    await db.query(
      `SELECT "objectId",name,internal_name,status,currency FROM portal.companies
   WHERE fund_id=$1 AND "archivedAt" IS NULL AND (status='P - Portfolio' OR ($2='all' AND status='X - Exited'))
   ORDER BY coalesce(nullif(internal_name,''),name)`,
      [fundId, scope]
    )
  ).rows;
  return { fund, companies };
}
export async function fundMonth(
  db: DatabaseClient,
  companyIds: string[],
  dimension: string,
  requested?: string
) {
  if (requested) return requested;
  return (
    await db.query(
      `SELECT to_char(coalesce(max(d.period) FILTER(WHERE m.metric_number BETWEEN 1000000 AND 1009899),max(d.period),current_date),'YYYY-MM') AS month
   FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
   WHERE m.company_id=ANY($1::uuid[]) AND d."archivedAt" IS NULL AND d.dimension=$2 AND d.value IS NOT NULL`,
      [companyIds, dimension]
    )
  ).rows[0].month as string;
}
export const shiftFundMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};
