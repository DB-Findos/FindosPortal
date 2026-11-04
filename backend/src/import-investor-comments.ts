import './config.js';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { readImportWorkbook, type ImportRow } from './services/import-workbook.js';

const source = process.argv.find((arg) => arg.endsWith('.xlsx'));
assert.ok(source, 'Provide the source XLSX path.');
const apply = process.argv.includes('--apply');
const bytes = await readFile(source);
const sheets = await readImportWorkbook(bytes);
const sourceRows: (ImportRow & { sheet: string })[] = Object.entries(sheets).flatMap(
  ([sheet, rows]) => rows.map((row) => ({ ...row, sheet }))
);
const destination = path.join(projectRoot, '.imports/investor-comments');
await mkdir(destination, { recursive: true });
const hash = createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(destination, `${hash}.xlsx`), bytes);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('import-investor-comments'))");
  await beginAuditedImport(client);
  const companies = (
    await client.query(
      'SELECT "objectId",name,internal_name FROM portal.companies WHERE "archivedAt" IS NULL'
    )
  ).rows;
  const normal = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toLowerCase();
  const seen = new Set<string>();
  let created = 0,
    unchanged = 0,
    updated = 0;
  const unmapped: { row: number; company: string | null }[] = [];
  const before = (await client.query('SELECT * FROM portal.comments')).rows;
  await writeFile(path.join(destination, `before-${Date.now()}.json`), JSON.stringify(before));
  for (const row of sourceRows) {
    const sourceId = String(row['Internal ID']);
    assert.match(
      sourceId,
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
      `Invalid source ID at ${row.source_row}`
    );
    assert.ok(!seen.has(sourceId), `Duplicate source ID: ${sourceId}`);
    seen.add(sourceId);
    assert.ok(
      typeof row.Period === 'number' && Number.isFinite(row.Period),
      `Invalid period at ${row.source_row}`
    );
    const period =
      new Date(Math.round((row.Period - 25569) * 86400000)).toISOString().slice(0, 7) + '-01';
    assert.ok(
      row.Value === null || typeof row.Value === 'string',
      `Invalid comment at ${row.source_row}`
    );
    const matches = companies.filter(
      (company) =>
        normal(row.Company) &&
        [company.name, company.internal_name].some((name) => normal(name) === normal(row.Company))
    );
    assert.ok(matches.length <= 1, `Ambiguous Company: ${row.Company}`);
    const companyId = matches[0]?.objectId ?? null;
    if (!companyId)
      unmapped.push({
        row: row.source_row,
        company: row.Company == null ? null : String(row.Company),
      });
    const data = {
      company_id: companyId,
      company_source_name: row.Company == null ? null : String(row.Company),
      period,
      type: 'Investoren Reporting',
      comment_text: row.Value,
      source_id: sourceId,
      source_file: path.basename(source),
      source_row: row.source_row,
      mapping_note: companyId
        ? null
        : 'Keine eindeutige bestehende Company in der Quelldatei zugeordnet.',
      source_data: { ...row, source_sha256: hash },
    };
    const previous = (
      await client.query(
        'SELECT * FROM portal.comments WHERE source_id=$1 AND "archivedAt" IS NULL FOR UPDATE',
        [sourceId]
      )
    ).rows[0];
    const keys = Object.keys(data) as (keyof typeof data)[];
    const same =
      previous &&
      keys.every((key) =>
        key === 'period'
          ? String(previous[key]).slice(0, 10) === data[key]
          : isDeepStrictEqual(previous[key], data[key])
      );
    if (same) {
      unchanged++;
      continue;
    }
    if (previous) {
      await client.query('UPDATE portal.comments SET "archivedAt"=clock_timestamp() WHERE id=$1', [
        previous.id,
      ]);
      await client.query(
        `INSERT INTO portal.comments("objectId","priorId",${keys.map((key) => '"' + key + '"').join(',')}) VALUES($1,$2,${keys.map((_, i) => '$' + (i + 3)).join(',')})`,
        [
          previous.objectId,
          previous.id,
          ...keys.map((key) => (key === 'source_data' ? JSON.stringify(data[key]) : data[key])),
        ]
      );
      updated++;
    } else {
      await client.query(
        `INSERT INTO portal.comments(${keys.map((key) => '"' + key + '"').join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        keys.map((key) => (key === 'source_data' ? JSON.stringify(data[key]) : data[key]))
      );
      created++;
    }
  }
  const imported = (
    await client.query(
      'SELECT count(*)::int count FROM portal.comments WHERE source_id=ANY($1::uuid[]) AND "archivedAt" IS NULL AND type=$2',
      [[...seen], 'Investoren Reporting']
    )
  ).rows[0].count;
  assert.equal(imported, sourceRows.length, 'Not every source record was imported.');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const summary = {
    apply,
    sourceRows: sourceRows.length,
    created,
    updated,
    unchanged,
    matched: sourceRows.length - unmapped.length,
    unmapped,
  };
  await writeFile(path.join(destination, 'import-report.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
