import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

const apply = process.argv.includes('--apply');
const folder = path.join(projectRoot, '.imports');
const json = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(folder, name), 'utf8'));
const nullableNumber = z.number().finite().nullable().optional();
const nullableCurrency = z
  .union([z.string().regex(/^[A-Z]{3}$/), z.literal('')])
  .nullable()
  .optional();
const sourceRow = z.object({
  _id: z.uuid(),
  EntryData: z.string().min(1),
  Company: z.string().min(1),
  CompanyInternalName: z.string().optional(),
  CompanyInternalID: z.uuid().optional(),
  CompanyCompanyCurrency: nullableCurrency,
  Type: z.enum(['Entry', 'AddOn', 'Exit']),
  FindosInvestment: z.string().optional(),
  FindosInvestmentValue: nullableNumber,
  FindosInvestmentIndexValue: nullableNumber,
  FindosInvestmentType: z.string().optional(),
  Date: z.string().min(10),
  RevenueLTM: nullableNumber,
  EBITDALTM: nullableNumber,
  EBITALTM: nullableNumber,
  MultipleEBITDA: nullableNumber,
  MultipleEBITA: nullableNumber,
  FixedEV: nullableNumber,
  TransactionCost: nullableNumber,
  Overfunding: nullableNumber,
  'TransactionCost-Other': nullableNumber,
  DebtFinancing: nullableNumber,
  'FindosShare(%)': nullableNumber,
  IndexValue: nullableNumber,
  PurchasePriceTotal: nullableNumber,
  Comment_PlainText: z.string().optional(),
  DataProviderId: z.string().optional(),
  ExternalId: z.string().optional(),
  DataCurrency: nullableCurrency,
});
type ImportRow = {
  object_id: string;
  source_id: string;
  name: string;
  company_id: string;
  company_internal_name: string | null;
  company_source_id: string | null;
  company_currency: string | null;
  deal_type_id: string;
  findos_investment: string | null;
  findos_investment_value: number | null;
  findos_investment_index_value: number | null;
  findos_investment_type: string | null;
  deal_date: string;
  revenue_ltm: number | null;
  ebitda_ltm: number | null;
  ebita_ltm: number | null;
  multiple_ebitda: number | null;
  multiple_ebita: number | null;
  fixed_ev: number | null;
  transaction_cost: number | null;
  overfunding: number | null;
  transaction_cost_other: number | null;
  debt_financing: number | null;
  findos_share: number | null;
  index_value: number | null;
  purchase_price_total: number | null;
  comment: string | null;
  data_provider_id: string | null;
  external_id: string | null;
  data_currency: string | null;
};
const blankToNull = (value: string | undefined) => (value?.trim() ? value : null);

const client = await pool.connect();
try {
  const source = z.array(sourceRow).parse(await json<unknown>('deal-data-source.json'));
  const companies = (
    await client.query(`SELECT "objectId" AS id,name FROM portal.companies
      WHERE "archivedAt" IS NULL`)
  ).rows as { id: string; name: string }[];
  const companyByName = new Map(companies.map((company) => [company.name, company.id]));
  assert.equal(
    companyByName.size,
    companies.length,
    'Duplicate active Company names prevent a safe import'
  );
  const types = (
    await client.query(`SELECT "objectId" AS id,name FROM portal.deal_types
      WHERE "archivedAt" IS NULL`)
  ).rows as { id: string; name: string }[];
  const typeByName = new Map(types.map((type) => [type.name, type.id]));
  assert.deepEqual([...typeByName.keys()].sort(), ['AddOn', 'Entry', 'Exit']);

  const ids = new Set<string>();
  const rows: ImportRow[] = source.map((item) => {
    assert.ok(!ids.has(item._id), `Duplicate source ID: ${item._id}`);
    ids.add(item._id);
    const companyId = companyByName.get(item.Company);
    assert.ok(companyId, `No current portal Company matches source value: ${item.Company}`);
    const typeId = typeByName.get(item.Type);
    assert.ok(typeId, `No DealType matches source value: ${item.Type}`);
    const dealDate = item.Date.slice(0, 10);
    z.iso.date().parse(dealDate);
    return {
      object_id: item._id,
      source_id: item._id,
      name: item.EntryData,
      company_id: companyId,
      company_internal_name: blankToNull(item.CompanyInternalName),
      company_source_id: item.CompanyInternalID ?? null,
      company_currency: item.CompanyCompanyCurrency || null,
      deal_type_id: typeId,
      findos_investment: blankToNull(item.FindosInvestment),
      findos_investment_value: item.FindosInvestmentValue ?? null,
      findos_investment_index_value: item.FindosInvestmentIndexValue ?? null,
      findos_investment_type: blankToNull(item.FindosInvestmentType),
      deal_date: dealDate,
      revenue_ltm: item.RevenueLTM ?? null,
      ebitda_ltm: item.EBITDALTM ?? null,
      ebita_ltm: item.EBITALTM ?? null,
      multiple_ebitda: item.MultipleEBITDA ?? null,
      multiple_ebita: item.MultipleEBITA ?? null,
      fixed_ev: item.FixedEV ?? null,
      transaction_cost: item.TransactionCost ?? null,
      overfunding: item.Overfunding ?? null,
      transaction_cost_other: item['TransactionCost-Other'] ?? null,
      debt_financing: item.DebtFinancing ?? null,
      findos_share: item['FindosShare(%)'] ?? null,
      index_value: item.IndexValue ?? null,
      purchase_price_total: item.PurchasePriceTotal ?? null,
      comment: blankToNull(item.Comment_PlainText),
      data_provider_id: blankToNull(item.DataProviderId),
      external_id: blankToNull(item.ExternalId),
      data_currency: item.DataCurrency || null,
    };
  });

  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-deal-data-import'))");
  await client.query('LOCK TABLE portal.deal_data IN SHARE ROW EXCLUSIVE MODE');
  await client.query(`CREATE TEMP TABLE deal_data_import(
    object_id uuid PRIMARY KEY, source_id uuid NOT NULL UNIQUE, name text NOT NULL, company_id uuid NOT NULL,
    company_internal_name text, company_source_id uuid, company_currency text, deal_type_id uuid NOT NULL,
    findos_investment text, findos_investment_value numeric, findos_investment_index_value numeric,
    findos_investment_type text, deal_date date NOT NULL, revenue_ltm numeric, ebitda_ltm numeric,
    ebita_ltm numeric, multiple_ebitda numeric, multiple_ebita numeric, fixed_ev numeric,
    transaction_cost numeric, overfunding numeric, transaction_cost_other numeric, debt_financing numeric,
    findos_share numeric, index_value numeric, purchase_price_total numeric, comment text,
    data_provider_id text, external_id text, data_currency text
  ) ON COMMIT DROP`);
  await client.query(
    `INSERT INTO deal_data_import SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
      object_id uuid,source_id uuid,name text,company_id uuid,company_internal_name text,company_source_id uuid,
      company_currency text,deal_type_id uuid,findos_investment text,findos_investment_value numeric,
      findos_investment_index_value numeric,findos_investment_type text,deal_date date,revenue_ltm numeric,
      ebitda_ltm numeric,ebita_ltm numeric,multiple_ebitda numeric,multiple_ebita numeric,fixed_ev numeric,
      transaction_cost numeric,overfunding numeric,transaction_cost_other numeric,debt_financing numeric,
      findos_share numeric,index_value numeric,purchase_price_total numeric,comment text,data_provider_id text,
      external_id text,data_currency text)`,
    [JSON.stringify(rows)]
  );
  const conflict = await client.query(`SELECT s.source_id FROM deal_data_import s
    JOIN portal.deal_data d ON d.source_id=s.source_id AND d."archivedAt" IS NULL
    WHERE d.company_id<>s.company_id OR d.deal_type_id<>s.deal_type_id OR d.name<>s.name
      OR d.deal_date<>s.deal_date OR d.revenue_ltm IS DISTINCT FROM s.revenue_ltm
      OR d.ebitda_ltm IS DISTINCT FROM s.ebitda_ltm LIMIT 10`);
  assert.equal(
    conflict.rowCount,
    0,
    'Existing DealData differs; nothing overwritten: ' + JSON.stringify(conflict.rows)
  );
  const existing = Number(
    (
      await client.query(`SELECT count(*) AS n FROM deal_data_import s
    JOIN portal.deal_data d ON d.source_id=s.source_id AND d."archivedAt" IS NULL`)
    ).rows[0].n
  );
  const inserted = await client.query(`INSERT INTO portal.deal_data(
    "objectId",source_id,name,company_id,company_internal_name,company_source_id,company_currency,deal_type_id,
    findos_investment,findos_investment_value,findos_investment_index_value,findos_investment_type,deal_date,
    revenue_ltm,ebitda_ltm,ebita_ltm,multiple_ebitda,multiple_ebita,fixed_ev,transaction_cost,overfunding,
    transaction_cost_other,debt_financing,findos_share,index_value,purchase_price_total,comment,data_provider_id,
    external_id,data_currency)
    SELECT object_id,source_id,name,company_id,company_internal_name,company_source_id,company_currency,deal_type_id,
    findos_investment,findos_investment_value,findos_investment_index_value,findos_investment_type,deal_date,
    revenue_ltm,ebitda_ltm,ebita_ltm,multiple_ebitda,multiple_ebita,fixed_ev,transaction_cost,overfunding,
    transaction_cost_other,debt_financing,findos_share,index_value,purchase_price_total,comment,data_provider_id,
    external_id,data_currency FROM deal_data_import s
    WHERE NOT EXISTS (SELECT 1 FROM portal.deal_data d WHERE d.source_id=s.source_id AND d."archivedAt" IS NULL)`);
  const verified = Number(
    (
      await client.query(`SELECT count(*) AS n FROM deal_data_import s
    JOIN portal.deal_data d ON d.source_id=s.source_id AND d."archivedAt" IS NULL
    WHERE d."objectId"=s.object_id AND d.company_id=s.company_id AND d.deal_type_id=s.deal_type_id
      AND d.deal_date=s.deal_date AND d."createdBy" IS NOT NULL AND d."modifiedBy" IS NOT NULL`)
    ).rows[0].n
  );
  assert.equal(verified, rows.length, 'Readback mismatch');
  const summary = (
    await client.query(`SELECT t.name AS type,count(*)::int AS rows
    FROM deal_data_import d JOIN portal.deal_types t ON t."objectId"=d.deal_type_id
    GROUP BY t.name ORDER BY t.name`)
  ).rows;
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const report = {
    mode: apply ? 'APPLIED' : 'DRY RUN (rolled back)',
    sourceRows: source.length,
    inserted: inserted.rowCount,
    existing,
    verified,
    summary,
  };
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  await writeFile(
    path.join(folder, apply ? 'deal-data-import-report.json' : 'deal-data-import-preview.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS: source IDs, DealType, Company references, values and audit actor verified.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
