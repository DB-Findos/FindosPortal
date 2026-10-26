import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

const apply = process.argv.includes('--apply');
const folder = path.join(projectRoot, '.imports');
const readJson = async (file: string) =>
  JSON.parse(await readFile(path.join(folder, file), 'utf8'));
const decimal = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,10})?$/)
  .refine((value) => Number(value) > 0);
const currency = z.string().regex(/^[A-Z]{3}$/);
const rateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  as_of_date: z.iso.date(),
  period: z.iso.date(),
  base_currency: currency,
  currency,
  index_value: decimal,
});
function excelDate(value: unknown): string {
  assert.equal(typeof value, 'string', 'Date must be an Excel serial');
  const serial = Number(value);
  assert.ok(
    Number.isInteger(serial) && serial > 60 && serial < 100000,
    'Invalid Excel date serial'
  );
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}
const normalizeDecimal = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const key = (row: { base_currency: string; currency: string; as_of_date: string }) =>
  JSON.stringify([row.base_currency, row.currency, row.as_of_date]);
const client = await pool.connect();
try {
  const source = await readJson('index-rates-source.json');
  const hash = createHash('sha256')
    .update(await readFile(path.join(folder, 'Index Exchange Rate Values.xlsx')))
    .digest('hex');
  assert.equal(hash, source.sha256, 'SharePoint workbook changed after extraction');
  const workbook = await readJson('index-rates-extracted.json');
  assert.equal(workbook.sheets.length, 1, 'Unexpected workbook sheets');
  const sheet = workbook.sheets[0];
  for (const header of [
    'Name (ID)',
    'As of date',
    'Base currency',
    'Currency',
    'Index value',
    'Period',
  ])
    assert.ok(sheet.headers.includes(header), 'Missing column ' + header);
  const rates = sheet.rows.map((row: Record<string, unknown>) =>
    rateSchema.parse({
      name: row['Name (ID)'],
      as_of_date: excelDate(row['As of date']),
      period: excelDate(row.Period),
      base_currency: row['Base currency'],
      currency: row.Currency,
      index_value: row['Index value'],
    })
  );
  assert.ok(rates.length > 0, 'Empty source workbook');
  assert.equal(
    new Set(rates.map(key)).size,
    rates.length,
    'Duplicate base currency/currency/date in source'
  );
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-index-rates-import'))");
  const projection =
    "SELECT r.name,to_char(r.as_of_date,'YYYY-MM-DD') AS as_of_date,to_char(r.period,'YYYY-MM-DD') AS period,r.base_currency,r.currency,r.index_value::text AS index_value";
  const matching = ` FROM portal.index_rates r JOIN jsonb_to_recordset($1::jsonb) AS x(base_currency text,currency text,as_of_date date) ON r.base_currency=x.base_currency AND r.currency=x.currency AND r.as_of_date=x.as_of_date AND r."archivedAt" IS NULL`;
  const previous = (await client.query(projection + matching, [JSON.stringify(rates)])).rows;
  const expected = new Map<string, z.infer<typeof rateSchema>>(
    rates.map((row: z.infer<typeof rateSchema>) => [key(row), row])
  );
  for (const row of previous)
    assert.deepEqual(
      { ...row, index_value: normalizeDecimal(row.index_value) },
      {
        ...expected.get(key(row)),
        index_value: normalizeDecimal(expected.get(key(row))!.index_value),
      },
      'Existing rate differs; no existing data overwritten: ' + key(row)
    );
  const existingKeys = new Set(previous.map(key));
  const missingRates = rates.filter(
    (row: z.infer<typeof rateSchema>) => !existingKeys.has(key(row))
  );
  const inserted = await client.query(
    `INSERT INTO portal.index_rates(name,as_of_date,period,base_currency,currency,index_value)
 SELECT name,as_of_date,period,base_currency,currency,index_value FROM jsonb_to_recordset($1::jsonb) AS x(name text,as_of_date date,period date,base_currency text,currency text,index_value numeric)
 `,
    [JSON.stringify(missingRates)]
  );
  const actual = (await client.query(projection + matching, [JSON.stringify(rates)])).rows;
  assert.equal(actual.length, rates.length);
  for (const row of actual)
    assert.deepEqual(
      { ...row, index_value: normalizeDecimal(row.index_value) },
      {
        ...expected.get(key(row)),
        index_value: normalizeDecimal(expected.get(key(row))!.index_value),
      },
      'Readback differs: ' + key(row)
    );
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const report = {
    mode: apply ? 'APPLIED' : 'DRY RUN (rolled back)',
    source: source.url,
    sha256: hash,
    sourceRows: rates.length,
    inserted: inserted.rowCount,
    existing: previous.length,
    verified: actual.length,
    pairs: [
      ...new Set(rates.map((r: z.infer<typeof rateSchema>) => r.base_currency + '/' + r.currency)),
    ],
  };
  await writeFile(
    path.join(folder, apply ? 'index-rates-import-report.json' : 'index-rates-import-preview.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS: all source rows, dates, currencies and exact decimal values verified.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
