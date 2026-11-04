import './config.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { updateRecord } from './repositories/entities.js';

const sourcePath =
  process.argv.find((arg) => arg.startsWith('--file='))?.slice(7) ||
  path.join(projectRoot, '.imports/CapitalMovements.xlsx');
const sourceFile = 'Kapitalbewegungen.xlsx';
const sourceHash = createHash('sha256')
  .update(await readFile(sourcePath))
  .digest('hex');
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sourcePath);
const sheet = workbook.worksheets[0];
assert.ok(sheet, 'First worksheet missing.');
const headers = Array.from(
  { length: sheet.columnCount },
  (_, index) => sheet.getRow(1).getCell(index + 1).text
);
for (const field of ['Company', 'Date', 'Value', 'Type', 'Reason'])
  assert.ok(headers.includes(field), `Missing ${field}`);
const source: { row: number; data: Record<string, unknown> }[] = [];
sheet.eachRow((row, index) => {
  if (index === 1) return;
  const data = Object.fromEntries(
    headers.map((header, column) => {
      const cell = row.getCell(column + 1),
        value = cell.value;
      return [
        header,
        value instanceof Date
          ? value.toISOString()
          : value && typeof value === 'object'
            ? cell.text
            : (value ?? null),
      ];
    })
  );
  if (Object.values(data).some((value) => value !== null && value !== ''))
    source.push({ row: index, data });
});
const uuidFor = (row: number) => {
  const bytes = createHash('sha256')
    .update(`sharepoint:capital-movements:${sheet.name}:${row}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const asDate = (value: unknown) => {
  if (value === null || value === '') return null;
  const date =
    typeof value === 'number'
      ? new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  return z.iso.date().parse(date);
};
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await beginAuditedImport(db);
  await db.query("SELECT pg_advisory_xact_lock(hashtext('portal-capital-movements-import'))");
  const companies = (
    await db.query(
      'SELECT "objectId",name,internal_name FROM portal.companies WHERE "archivedAt" IS NULL'
    )
  ).rows;
  const deals = (
    await db.query(`SELECT d.company_id,d.deal_date::text AS deal_date,d.findos_investment_value::text AS investment,t.name AS type
    FROM portal.deal_data d JOIN portal.deal_types t ON t."objectId"=d.deal_type_id AND t."archivedAt" IS NULL WHERE d."archivedAt" IS NULL`)
  ).rows;
  const unresolved: { row: number; company: string; reason: string }[] = [];
  const records = source.map(({ row, data }) => {
    const name = z.string().trim().min(1).parse(data.Company);
    const matches = companies.filter(
      (company) => company.name === name || company.internal_name === name
    );
    assert.ok(matches.length <= 1, `Ambiguous Company ${name}`);
    const companyId = matches[0]?.objectId ?? null;
    if (!companyId)
      unresolved.push({ row, company: name, reason: 'Company not yet present in portal.' });
    const type = z.enum(['Capital Call', 'Capital Return']).parse(data.Type);
    assert.ok(data.Value !== null && data.Value !== '', `Missing value in row ${row}`);
    const value = new Decimal(String(data.Value));
    assert.ok(value.isFinite(), `Invalid value in row ${row}`);
    const reason = data.Reason == null ? null : String(data.Reason).trim();
    const originalDate = asDate(data.Date);
    let date = originalDate,
      dateSource = originalDate ? 'SharePoint' : 'missing';
    const dealType =
      type === 'Capital Call' && reason === 'Kaufpreiszahlung'
        ? 'Entry'
        : type === 'Capital Return' && reason === 'Exit'
          ? 'Exit'
          : null;
    if (!date && companyId && dealType) {
      const candidates = deals.filter(
        (deal) =>
          deal.company_id === companyId &&
          deal.type === dealType &&
          deal.deal_date &&
          (dealType === 'Exit' || (deal.investment !== null && value.eq(deal.investment)))
      );
      if (candidates.length === 1) {
        date = candidates[0].deal_date;
        dateSource = `DealData ${dealType}`;
      }
    }
    if (!date)
      unresolved.push({
        row,
        company: name,
        reason:
          'No source date or uniquely matching DealData date; excluded from dated KPI totals.',
      });
    return {
      objectId: uuidFor(row),
      name: `${name} · ${type} · ${reason || row}`,
      company_id: companyId,
      company_source_name: name,
      movement_date: date,
      source_date: originalDate,
      date_source: dateSource,
      value: value.toString(),
      currency: 'EUR',
      type,
      reason,
      source_file: sourceFile,
      source_row: row,
      source_data: data,
    };
  });
  const previous = new Map(
    (
      await db.query('SELECT * FROM portal.capital_movements WHERE "archivedAt" IS NULL FOR UPDATE')
    ).rows.map((row) => [row.objectId, row])
  );
  const fresh: typeof records = [];
  let updated = 0,
    unchanged = 0;
  for (const record of records) {
    const old = previous.get(record.objectId);
    if (!old) {
      fresh.push(record);
      continue;
    }
    if (Object.entries(record).every(([key, value]) => isDeepStrictEqual(old[key], value))) {
      unchanged++;
      continue;
    }
    await updateRecord(db, 'capital_movements', record.objectId, old.id, record);
    updated++;
  }
  if (fresh.length) {
    const columns = Object.keys(fresh[0])
      .map((key) => `"${key}"`)
      .join(',');
    await db.query(
      `INSERT INTO portal.capital_movements(${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::portal.capital_movements,$1::jsonb)`,
      [JSON.stringify(fresh)]
    );
  }
  const currentIds = new Set(records.map((row) => row.objectId));
  for (const old of previous.values())
    if (old.source_file === sourceFile && !currentIds.has(old.objectId))
      await db.query(
        'UPDATE portal.capital_movements SET "archivedAt"=clock_timestamp() WHERE id=$1',
        [old.id]
      );
  const count = (
    await db.query(
      'SELECT count(*)::int AS count FROM portal.capital_movements WHERE source_file=$1 AND "archivedAt" IS NULL',
      [sourceFile]
    )
  ).rows[0].count;
  assert.equal(count, records.length, 'Not all source rows were imported.');
  const applied = process.argv.includes('--apply');
  await db.query(applied ? 'COMMIT' : 'ROLLBACK');
  const report = {
    applied,
    sourceFile,
    sourceHash,
    sourceRows: records.length,
    inserted: fresh.length,
    updated,
    unchanged,
    matchedCompanies: records.filter((row) => row.company_id).length,
    datesFromDeals: records.filter((row) => row.date_source.startsWith('DealData')).length,
    missingDates: records.filter((row) => row.movement_date === null).length,
    undatedReturns: records.filter(
      (row) => row.movement_date === null && row.type === 'Capital Return'
    ).length,
    unresolved,
  };
  await writeFile(
    path.join(projectRoot, '.imports/capital-movements-import-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify({ ...report, unresolved: undefined }, null, 2));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
