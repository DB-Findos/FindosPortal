import './config.js';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import ExcelJS from 'exceljs';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { updateRecord } from './repositories/entities.js';
import { metricFormulaRules, parseMetricExpression } from './services/metric-formula-format.js';

const folder = path.join(projectRoot, '.imports/Dokumente');
const argument = process.argv.find((value) => value.startsWith('--file='))?.slice(7);
const files = (await readdir(folder)).filter((name) => /^Metric Formulas.*\.xlsx$/i.test(name));
assert.ok(
  argument || files.length === 1,
  'Specify --file=... when more than one Metric Formulas workbook exists.'
);
const sourcePath = argument ? path.resolve(argument) : path.join(folder, files[0]);
const sourceFile = path.basename(sourcePath);
const sourceHash = createHash('sha256')
  .update(await readFile(sourcePath))
  .digest('hex');
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sourcePath);
const sheet = workbook.worksheets[0];
assert.ok(sheet, 'First worksheet missing.');
const headers = Array.from(
  { length: sheet.columnCount },
  (_, i) => sheet.getRow(1).getCell(i + 1).text
);
for (const field of [
  'Internal ID',
  'Company',
  'Metric Number',
  'Dimension',
  'Type',
  'Accumulation formula (ID)',
  'Monthly formula (ID)',
])
  assert.ok(headers.includes(field), `Missing column ${field}`);
const rows: { source_row: number; data: Record<string, string | number | boolean | null> }[] = [];
sheet.eachRow((row, index) => {
  if (index === 1) return;
  const data = Object.fromEntries(
    headers.map((header, col) => {
      const cell = row.getCell(col + 1);
      const value = cell.value;
      return [
        header,
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'object' && value !== null
            ? cell.text
            : (value ?? null),
      ];
    })
  );
  if (Object.values(data).some((v) => v !== null && v !== ''))
    rows.push({ source_row: index, data });
});
const nullable = (value: unknown) => (value === '' || value == null ? null : String(value));
const integer = (value: unknown) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), `Invalid integer ${value}`);
  return number;
};
const timestamp = (value: unknown) => {
  if (value === '' || value == null) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(Date.UTC(1899, 11, 30) + numeric * 86400000)
    : new Date(String(value));
  assert.ok(Number.isFinite(date.valueOf()), `Invalid timestamp ${value}`);
  return date.toISOString();
};
const dimensions: Record<string, string> = {
  Actual: 'actual',
  Budget: 'budget',
  Forecast: 'forecast',
  'Findos Plan': 'plan',
};
const parsed = new Set<string>();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('metric-formulas-import'))");
  const companies = (
    await client.query(
      'SELECT "objectId",name,internal_name FROM portal.companies WHERE "archivedAt" IS NULL'
    )
  ).rows;
  const metrics = (
    await client.query(
      'SELECT "objectId",company_id,metric_number FROM portal.metrics WHERE "archivedAt" IS NULL'
    )
  ).rows;
  const byMetricId = new Map(metrics.map((m) => [m.objectId, m]));
  const byCompanyNumber = new Map<string, any>();
  for (const metric of metrics) {
    const key = `${metric.company_id}:${metric.metric_number}`;
    assert.ok(!byCompanyNumber.has(key), `Ambiguous company/metric number ${key}`);
    byCompanyNumber.set(key, metric);
  }
  const seen = new Set<string>();
  const unresolved: {
    row: number;
    name: unknown;
    company: unknown;
    metricNumber: number | null;
    reason: string;
  }[] = [];
  const records = rows.map(({ source_row, data: row }) => {
    const identity = String(row['Internal ID']).toLowerCase();
    assert.match(identity, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.ok(!seen.has(identity), `Duplicate Dynamo formula ID ${identity}`);
    seen.add(identity);
    for (const col of ['Accumulation formula (ID)', 'Monthly formula (ID)']) {
      const formula = nullable(row[col]);
      if (formula && !parsed.has(formula)) {
        parseMetricExpression(formula);
        parsed.add(formula);
      }
    }
    assert.ok(dimensions[String(row.Dimension)], `Unknown dimension ${row.Dimension}`);
    assert.ok(['Data', 'Range', 'Formula'].includes(String(row.Type)), `Unknown type ${row.Type}`);
    const number = integer(row['Metric Number']);
    // Only the ID paired with this metric number identifies the formula's target.
    // Other UUIDs inside a ratio or monthly formula are inputs, not the target.
    let dynamoId: string | null = null;
    for (const prefix of ['Accumulation', 'Monthly']) {
      const ids = [
        ...String(row[`${prefix} formula (ID)`] ?? '').matchAll(/\|[A-Z0-9]+:([0-9a-f-]{36})\|/gi),
      ];
      const numbers = [
        ...String(row[`${prefix} formula (Number)`] ?? '').matchAll(/\|[A-Z0-9]+:(\d+)\|/gi),
      ];
      if (ids.length === numbers.length)
        for (let i = 0; i < ids.length; i++)
          if (number !== null && Number(numbers[i][1]) === number)
            dynamoId = ids[i][1].toLowerCase();
    }
    if (!row.Company && !dynamoId) {
      const sole = String(row['Accumulation formula (ID)'] ?? '').match(
        /^\|[A-Z]+:([0-9a-f-]{36})\|$/i
      );
      if (sole) dynamoId = sole[1].toLowerCase();
    }
    const companyMatches = companies.filter(
      (c) => c.name === row.Company || (row.Company && c.internal_name === row.Company)
    );
    assert.ok(companyMatches.length <= 1, `Ambiguous Company ${row.Company}`);
    const companyId =
      companyMatches[0]?.objectId ??
      (dynamoId ? byMetricId.get(dynamoId)?.company_id : null) ??
      null;
    const target = dynamoId
      ? byMetricId.get(dynamoId)
      : byCompanyNumber.get(`${companyId}:${number}`);
    assert.ok(
      !target || target.company_id === companyId,
      `Cross-company target in row ${source_row}`
    );
    if (!target)
      unresolved.push({
        row: source_row,
        name: row.Name,
        company: row.Company,
        metricNumber: number,
        reason: 'Target Metric not present; original formula and Dynamo references preserved.',
      });
    return {
      objectId: identity,
      name: String(row.Name || row['Name (ID)']),
      company_id: companyId,
      company_source_name: nullable(row.Company),
      metric_id: target?.objectId ?? null,
      dynamo_metric_id: dynamoId ?? target?.objectId ?? null,
      metric_source_name: nullable(row.Metric),
      metric_number: number ?? target?.metric_number ?? null,
      dimension: dimensions[String(row.Dimension)],
      formula_type: row.Type,
      accumulation_formula_id: nullable(row['Accumulation formula (ID)']),
      accumulation_formula_name: nullable(row['Accumulation formula (Name)']),
      accumulation_formula_number: nullable(row['Accumulation formula (Number)']),
      monthly_formula_id: nullable(row['Monthly formula (ID)']),
      monthly_formula_name: nullable(row['Monthly formula (Name)']),
      monthly_formula_number: nullable(row['Monthly formula (Number)']),
      range_from: integer(row['Range from']),
      range_to: integer(row['Range to']),
      source_created_at: timestamp(row['Date created']),
      source_modified_at: timestamp(row['Last modified']),
      source_file: sourceFile,
      source_row,
      source_data: row,
      engine_version: 1,
      evaluation_rules: metricFormulaRules,
    };
  });
  const existing = new Map(
    (
      await client.query(
        'SELECT * FROM portal.metric_formulas WHERE "archivedAt" IS NULL FOR UPDATE'
      )
    ).rows.map((r) => [r.objectId, r])
  );
  const fresh: typeof records = [];
  let updated = 0,
    unchanged = 0;
  for (const record of records) {
    const prior = existing.get(record.objectId);
    if (!prior) {
      fresh.push(record);
      continue;
    }
    if (
      Object.entries(record).every(([key, value]) => {
        const previous = prior[key] instanceof Date ? prior[key].toISOString() : prior[key];
        return isDeepStrictEqual(previous, value);
      })
    ) {
      unchanged++;
      continue;
    }
    await updateRecord(client, 'metric_formulas', record.objectId, prior.id, record);
    updated++;
  }
  const columns = Object.keys(records[0]);
  for (let offset = 0; offset < fresh.length; offset += 300) {
    await client.query(
      `INSERT INTO portal.metric_formulas (${columns.map((k) => `"${k}"`).join(',')})
       SELECT ${columns.map((k) => `"${k}"`).join(',')} FROM jsonb_populate_recordset(NULL::portal.metric_formulas,$1::jsonb)`,
      [JSON.stringify(fresh.slice(offset, offset + 300))]
    );
  }
  const count = (
    await client.query(
      'SELECT count(*)::int AS count FROM portal.metric_formulas WHERE source_file=$1 AND "archivedAt" IS NULL',
      [sourceFile]
    )
  ).rows[0].count;
  assert.equal(count, records.length, 'Not all source rows are present.');
  const apply = process.argv.includes('--apply');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const report = {
    applied: apply,
    sourceFile,
    sourceHash,
    sourceRows: records.length,
    inserted: fresh.length,
    updated,
    unchanged,
    linkedMetrics: records.filter((r) => r.metric_id).length,
    unlinkedMetricCount: unresolved.length,
    unresolved,
  };
  await writeFile(
    path.join(projectRoot, '.imports/metric-formulas-import-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify({ ...report, unresolved: undefined }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
