import './config.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

const apply = process.argv.includes('--apply');
const sourcePath = path.join(
  projectRoot,
  '.imports/Dokumente/Findos_Performance_Update_Kommentare (2).xlsx'
);
const columnNames = [
  'Unternehmen (Folienname)',
  'Kennzahlenmonat',
  'Termin',
  'Kommentar / Originaltext',
  'Textart',
  'Quelldatei',
  'Folie',
  'Absatz',
  'Folien-ID',
  'Zuordnungshinweis',
  'Texterfassung',
] as const;
type CommentRow = {
  object_id: string;
  company_id: string | null;
  company_source_name: string;
  metric_data_period: string | null;
  performance_update_date: string | null;
  comment_text: string;
  text_type: string | null;
  source_file: string | null;
  slide_number: number | null;
  paragraph_number: number | null;
  slide_id: string | null;
  mapping_note: string | null;
  capture_type: string | null;
  source_row: number;
};

function decodeXml(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function removeXmlPrefixes(value: string): string {
  return value.replace(/(<\/?)[A-Za-z_][\w.-]*:/g, '$1');
}

function attribute(attributes: string, name: string): string | null {
  return attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    [...item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(([, text]) => decodeXml(text))
      .join('')
  );
}

function parseSheet(xml: string, strings: string[]): Map<number, Map<string, string>> {
  const rows = new Map<number, Map<string, string>>();
  for (const [, attributes, body] of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attribute(attributes, 'r'));
    const cells = new Map<string, string>();
    for (const [, cellAttributes, cellBody] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = attribute(cellAttributes, 'r');
      if (!reference) continue;
      const column = reference.replace(/\d/g, '');
      const type = attribute(cellAttributes, 't');
      const value = cellBody?.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? '';
      let text = value;
      if (type === 's' && value !== '') text = strings[Number(value)] ?? '';
      else if (type === 'inlineStr')
        text = [...(cellBody ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map(([, part]) => part)
          .join('');
      cells.set(column, decodeXml(text));
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

function excelDate(value: string | undefined, label: string): string | null {
  if (value === undefined || value.trim() === '') return null;
  const serial = Number(value);
  assert.ok(Number.isFinite(serial) && serial > 0, `Invalid ${label}: ${value}`);
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

function stableUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const zip = await JSZip.loadAsync(sourceBytes);
const sheetEntry = zip.file('xl/worksheets/sheet1.xml');
assert.ok(sheetEntry, 'First worksheet not found');
const sharedEntry = zip.file('xl/sharedStrings.xml');
const strings = sharedEntry
  ? sharedStrings(removeXmlPrefixes(await sharedEntry.async('string')))
  : [];
const rowsByNumber = parseSheet(removeXmlPrefixes(await sheetEntry.async('string')), strings);
const headers = rowsByNumber.get(5);
assert.ok(headers, 'Header row 5 not found');
const columnLetters = new Map<string, string>();
for (const [column, title] of headers) columnLetters.set(title, column);
for (const name of columnNames) assert.ok(columnLetters.has(name), `Missing Excel column: ${name}`);

const sourceRows = [...rowsByNumber.entries()]
  .filter(([rowNumber, row]) => rowNumber > 5 && (row.get(columnLetters.get('Kommentar / Originaltext')!) ?? '').trim())
  .map(([sourceRow, row]) => {
    const get = (name: (typeof columnNames)[number]) => row.get(columnLetters.get(name)!);
    const companyName = (get('Unternehmen (Folienname)') ?? '').trim();
    const comment = (get('Kommentar / Originaltext') ?? '').trim();
    const metricPeriod = excelDate(get('Kennzahlenmonat'), `Kennzahlenmonat at row ${sourceRow}`);
    return {
      source_row: sourceRow,
      company_source_name: companyName,
      metric_data_period: metricPeriod,
      performance_update_date: excelDate(get('Termin'), `Termin at row ${sourceRow}`),
      comment_text: comment,
      text_type: get('Textart')?.trim() || null,
      source_file: get('Quelldatei')?.trim() || null,
      slide_number: get('Folie') ? Number(get('Folie')) : null,
      paragraph_number: get('Absatz') ? Number(get('Absatz')) : null,
      slide_id: get('Folien-ID')?.trim() || null,
      mapping_note: get('Zuordnungshinweis')?.trim() || null,
      capture_type: get('Texterfassung')?.trim() || null,
    };
  });
assert.equal(sourceRows.length, 1779, 'Expected every non-empty comment row from the workbook');

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-performance-update-comments-import'))");
  await beginAuditedImport(client);
  const companies = (
    await client.query(
      `SELECT "objectId"::text AS id,name,internal_name FROM portal.companies WHERE "archivedAt" IS NULL`
    )
  ).rows as { id: string; name: string; internal_name: string | null }[];
  const companyByName = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const company of companies)
    for (const label of [company.name, company.internal_name].filter(Boolean) as string[]) {
      const key = label.trim().toLocaleLowerCase();
      if (companyByName.has(key) && companyByName.get(key) !== company.id) ambiguous.add(key);
      else companyByName.set(key, company.id);
    }
  const records: CommentRow[] = sourceRows.map((row) => {
    const companyKey = (row.company_source_name === 'Ann-Sophie' ? 'Angelina' : row.company_source_name)
      .toLocaleLowerCase();
    return {
      ...row,
      company_id: ambiguous.has(companyKey) ? null : (companyByName.get(companyKey) ?? null),
      object_id: stableUuid(`${sourceHash}:${row.source_row}`),
    };
  });

  const ids = records.map((row) => row.object_id);
  const existing = (
    await client.query(
      `SELECT id::text AS version_id,"objectId"::text AS object_id,company_id::text AS company_id,company_source_name,
        to_char(metric_data_period,'YYYY-MM-DD') AS metric_data_period,
        to_char(performance_update_date,'YYYY-MM-DD') AS performance_update_date,
        comment_text,text_type,source_file,slide_number,paragraph_number,slide_id,mapping_note,capture_type,source_row
       FROM portal.performance_update_comments WHERE "objectId"=ANY($1::uuid[]) AND "archivedAt" IS NULL`,
      [ids]
    )
  ).rows as (Omit<CommentRow, 'object_id'> & { object_id: string })[];
  const expected = new Map(records.map((record) => [record.object_id, record]));
  const changed: (CommentRow & { prior_id: string })[] = [];
  for (const row of existing) {
    const { object_id, version_id, ...actual } = row;
    const wanted = expected.get(object_id)!;
    const { object_id: ignoredObjectId, ...wantedFields } = wanted;
    void ignoredObjectId;
    if (isDeepStrictEqual(actual, wantedFields)) continue;
    const { company_id: previousCompany, ...actualWithoutCompany } = actual;
    const { company_id: nextCompany, ...wantedWithoutCompany } = wantedFields;
    assert.deepEqual(
      actualWithoutCompany,
      wantedWithoutCompany,
      `Existing imported row differs at Excel row ${wanted.source_row}`
    );
    assert.equal(previousCompany, null, `Unexpected prior company at Excel row ${wanted.source_row}`);
    assert.ok(nextCompany, `Missing mapped company at Excel row ${wanted.source_row}`);
    changed.push({ ...wanted, prior_id: version_id });
  }
  const knownIds = new Set(existing.map((row) => row.object_id));
  const missing = records.filter((row) => !knownIds.has(row.object_id));
  if (changed.length) {
    await client.query(
      `UPDATE portal.performance_update_comments SET "archivedAt"=clock_timestamp()
       WHERE id=ANY($1::uuid[]) AND "archivedAt" IS NULL`,
      [changed.map((row) => row.prior_id)]
    );
  }
  const toInsert = [...missing.map((row) => ({ ...row, prior_id: null })), ...changed];
  if (toInsert.length) {
    await client.query(
      `INSERT INTO portal.performance_update_comments(
        "objectId","priorId",company_id,company_source_name,metric_data_period,performance_update_date,
        comment_text,text_type,source_file,slide_number,paragraph_number,slide_id,mapping_note,capture_type,source_row
       )
       SELECT x.object_id,x.prior_id,x.company_id,x.company_source_name,x.metric_data_period,x.performance_update_date,
         x.comment_text,x.text_type,x.source_file,x.slide_number,x.paragraph_number,x.slide_id,x.mapping_note,x.capture_type,x.source_row
       FROM jsonb_to_recordset($1::jsonb) AS x(
         object_id uuid,prior_id uuid,company_id uuid,company_source_name text,metric_data_period date,performance_update_date date,
         comment_text text,text_type text,source_file text,slide_number integer,paragraph_number integer,slide_id text,
         mapping_note text,capture_type text,source_row integer
       )`,
      [JSON.stringify(toInsert)]
    );
  }
  const unmapped = [...new Set(records.filter((row) => !row.company_id).map((row) => row.company_source_name))];
  const report = {
    mode: apply ? 'APPLIED' : 'DRY RUN (rolled back)',
    source: path.relative(projectRoot, sourcePath),
    sha256: sourceHash,
    sourceRows: records.length,
    inserted: missing.length,
    updated: changed.length,
    existing: existing.length - changed.length,
    companyLinked: records.filter((row) => row.company_id).length,
    unmappedCompanyNames: unmapped,
    sourceRowsWithoutMetricPeriod: records.filter((row) => !row.metric_data_period).length,
    sourceRowsWithUndeterminedTermin: records.filter((row) => !row.performance_update_date).length,
  };
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    path.join(projectRoot, '.imports/performance-update-comments-import-report.json'),
    JSON.stringify(report, null, 2)
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
