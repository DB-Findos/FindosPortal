import './config.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Decimal } from 'decimal.js';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { readImportWorkbook, type ImportRow } from './services/import-workbook.js';
import {
  covenantCompanyAliases,
  covenantMetricNumbers,
} from './services/covenant-import-mapping.js';

const sourcePath = process.argv.find((arg) => arg.startsWith('--file='))?.slice(7);
assert.ok(sourcePath, 'Supply --file=<Findos_Covenants_Datenbankinput.xlsx>');
const apply = process.argv.includes('--apply');
const bytes = await readFile(sourcePath);
const sourceFile = path.basename(sourcePath);
const sourceHash = createHash('sha256').update(bytes).digest('hex');
const book = await readImportWorkbook(bytes);
for (const name of [
  'Covenants',
  'Current',
  'TargetHistory',
  'NameMapping',
  'Sources',
  'Exceptions',
])
  assert.ok(book[name]?.length, `Missing or empty worksheet: ${name}`);

const excelDate = (value: unknown): string => {
  assert.ok(
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 100000,
    `Invalid Excel date: ${value}`
  );
  return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
};
const period = (value: unknown) => {
  const end = excelDate(value);
  const date = new Date(`${end}T00:00:00Z`);
  assert.ok([2, 5, 8, 11].includes(date.getUTCMonth()), `Not a quarter-end month: ${end}`);
  assert.equal(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(),
    date.getUTCDate(),
    `Not a quarter end: ${end}`
  );
  // MetricData consistently identifies a month by its first day.
  return `${end.slice(0, 7)}-01`;
};
const amount = (row: ImportRow) => {
  assert.ok(
    row.Amount === null || (typeof row.Amount === 'number' && Number.isFinite(row.Amount)),
    `Invalid Amount in source row ${row.source_row}`
  );
  assert.ok(
    ['Numeric', 'Waived', 'Standstill', 'Suspended', 'InNegotiation', 'Breach', 'Missing'].includes(
      String(row.Status)
    ),
    `Unknown status: ${row.Status}`
  );
  if (row.Status === 'Numeric')
    assert.notEqual(row.Amount, null, `Numeric row without amount: ${row.source_row}`);
  return row.Amount === null ? null : new Decimal(row.Amount as number).toString();
};
const currentKey = (row: ImportRow) => `${row.CovenantId}:${period(row.PeriodEnd)}:${row.Measure}`;
const current = new Map<string, ImportRow>();
for (const row of book.Current) {
  assert.ok(['Value', 'Target'].includes(String(row.Measure)), `Unknown measure: ${row.Measure}`);
  const key = currentKey(row);
  assert.ok(!current.has(key), `Duplicate current key: ${key}`);
  amount(row);
  current.set(key, row);
}
const sourceRows = new Map(book.Sources.map((row) => [String(row.SourceRowId), row]));
assert.equal(sourceRows.size, book.Sources.length, 'Duplicate SourceRowId');
const definitions = new Map(book.Covenants.map((row) => [String(row.CovenantId), row]));
assert.equal(definitions.size, book.Covenants.length, 'Duplicate CovenantId');
for (const row of [...book.Current, ...book.TargetHistory]) {
  const definition = definitions.get(String(row.CovenantId));
  assert.ok(
    definition &&
      definition.Company === row.Company &&
      definition.CovenantName === row.CovenantName,
    `Invalid Covenant reference in source row ${row.source_row}`
  );
  amount(row);
}

const history = new Map<string, ImportRow[]>();
const versionKeys = new Set<string>();
for (const row of book.TargetHistory) {
  const key = `${row.CovenantId}:${period(row.PeriodEnd)}:Target`;
  assert.ok(!versionKeys.has(String(row.VersionKey)), `Duplicate VersionKey: ${row.VersionKey}`);
  versionKeys.add(String(row.VersionKey));
  const group = history.get(key) ?? [];
  group.push(row);
  history.set(key, group);
}
for (const [key, rows] of history) {
  rows.sort((a, b) => Number(a.Version) - Number(b.Version));
  for (const [index, row] of rows.entries()) {
    assert.equal(row.Version, index + 1, `Non-contiguous target versions: ${key}`);
    assert.equal(row.IsCurrent, index === rows.length - 1, `Invalid IsCurrent: ${key}`);
    if (index < rows.length - 1)
      assert.equal(
        row.ReplacedAt,
        rows[index + 1].FirstObservedDate,
        `Invalid source history interval: ${key}`
      );
    else assert.equal(row.ReplacedAt, null, `Current target has a replacement: ${key}`);
  }
  const latest = rows.at(-1)!;
  const expected = current.get(key);
  assert.ok(expected && expected.Status !== 'Missing', `History without current target: ${key}`);
  for (const field of ['Amount', 'Status', 'Operator', 'TargetScope'])
    assert.equal(
      latest[field],
      expected[field],
      `Current/TargetHistory mismatch: ${key}, ${field}`
    );
}
for (const [key, row] of current)
  if (row.Measure === 'Target' && row.Status !== 'Missing')
    assert.ok(history.has(key), `Target has no history: ${key}`);

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('covenants-import'))");
  await beginAuditedImport(client);
  const migration = await client.query(
    "SELECT 1 FROM portal.schema_migrations WHERE name='019-covenant-source-data'"
  );
  assert.ok(migration.rowCount, 'Run db:migrate before importing Covenants.');
  const companies = (
    await client.query(
      'SELECT "objectId", name, internal_name FROM portal.companies WHERE "archivedAt" IS NULL FOR SHARE'
    )
  ).rows;
  const companyIds = new Map<string, string>();
  for (const row of book.Covenants) {
    const sourceName = String(row.Company);
    const name = covenantCompanyAliases[sourceName] ?? sourceName;
    const matches = companies.filter(
      (company) => company.internal_name === name || company.name === name
    );
    assert.equal(matches.length, 1, `Missing or ambiguous Company: ${sourceName}`);
    companyIds.set(sourceName, matches[0].objectId);
    assert.ok(
      covenantMetricNumbers[sourceName]?.[String(row.CovenantName)],
      `Unmapped Covenant: ${sourceName}/${row.CovenantName}`
    );
  }
  const companyIdList = [...new Set(companyIds.values())];
  const allMetrics = (
    await client.query(
      'SELECT * FROM portal.metrics WHERE company_id=ANY($1::uuid[]) AND "archivedAt" IS NULL FOR UPDATE',
      [companyIdList]
    )
  ).rows;
  const metricByKey = new Map<string, Record<string, any>>();
  for (const metric of allMetrics) {
    const key = `${metric.company_id}:${metric.metric_number}`;
    if (metric.metric_number >= 4004000 && metric.metric_number < 4005000)
      assert.ok(!metricByKey.has(key), `Duplicate Covenant Metric Number: ${key}`);
    metricByKey.set(key, metric);
  }
  const mapping = new Map<
    string,
    { metric: Record<string, any>; target: Record<string, any>; definition: ImportRow }
  >();
  const desiredMetrics: Record<string, any>[] = [];
  const usedNumbers = new Set<string>();
  for (const definition of book.Covenants) {
    const companyId = companyIds.get(String(definition.Company))!;
    const base = covenantMetricNumbers[String(definition.Company)][String(definition.CovenantName)];
    const pair: Record<string, any>[] = [];
    for (const isTarget of [false, true]) {
      const metricNumber = base + Number(isTarget);
      const key = `${companyId}:${metricNumber}`;
      assert.ok(!usedNumbers.has(key), `Two different Covenants map to ${key}`);
      usedNumbers.add(key);
      const prior = metricByKey.get(key);
      const name = `${definition.CovenantName}${isTarget ? ' (Target)' : ''}`;
      assert.ok(
        !allMetrics.some(
          (other) =>
            other.company_id === companyId &&
            other.name === name &&
            other.objectId !== prior?.objectId
        ),
        `Metric name already assigned elsewhere: ${name}`
      );
      const ratio = definition.Unit === 'Ratio';
      const metric = {
        objectId: prior?.objectId ?? randomUUID(),
        company_id: companyId,
        name,
        metric_number: metricNumber,
        unit: ratio ? 'Ratio' : (prior?.unit ?? 'Unspecified'),
        currency: ratio ? null : (prior?.currency ?? null),
        section: prior?.section ?? 'Covenants',
        important: prior?.important ?? false,
        description: prior?.description ?? null,
        source_data: {
          ...(prior?.source_data ?? {}),
          import: 'findos-covenants',
          source_file: sourceFile,
          source_sha256: sourceHash,
          covenant_id: definition.CovenantId,
          measure: isTarget ? 'Target' : 'Value',
          source_unit: definition.Unit,
          unit_confirmed: ratio,
          definition,
          original_names: book.NameMapping.filter(
            (row) => row.CovenantId === definition.CovenantId
          ),
        },
      };
      pair.push(metric);
      desiredMetrics.push(metric);
    }
    mapping.set(String(definition.CovenantId), { metric: pair[0], target: pair[1], definition });
  }
  const affectedIds = desiredMetrics.map((metric) => metric.objectId);
  const dataBefore = (
    await client.query(
      'SELECT * FROM portal.metric_data WHERE metric_id=ANY($1::uuid[]) ORDER BY "objectId","lastModifiedAt" FOR UPDATE',
      [affectedIds]
    )
  ).rows;
  const backupFolder = path.join(projectRoot, '.imports/backups');
  await mkdir(backupFolder, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupFolder, `covenants-before-${timestamp}.json`);
  await writeFile(
    backupFile,
    JSON.stringify(
      {
        sourceFile,
        sourceHash,
        metrics: allMetrics.filter((m) => affectedIds.includes(m.objectId)),
        metric_data: dataBefore,
      },
      null,
      2
    )
  );
  await copyFile(sourcePath, path.join(backupFolder, `${sourceHash}-${sourceFile}`));
  const counters = {
    metrics: { inserted: 0, updated: 0, unchanged: 0 },
    metric_data: { inserted: 0, updated: 0, unchanged: 0 },
  };
  const metricState = new Map(allMetrics.map((row) => [row.objectId, row]));
  const dataState = new Map(
    dataBefore
      .filter((row) => !row.archivedAt)
      .map((row) => [`${row.metric_id}:${row.period}:${row.dimension}`, row])
  );
  const metricColumns = [
    'objectId',
    'priorId',
    'company_id',
    'name',
    'metric_number',
    'unit',
    'currency',
    'section',
    'important',
    'description',
    'source_data',
  ];
  const dataColumns = [
    'objectId',
    'priorId',
    'metric_id',
    'company_id',
    'name',
    'currency',
    'period',
    'value',
    'dimension',
    'source_data',
  ];
  const dataKey = (row: Record<string, any>) => `${row.metric_id}:${row.period}:${row.dimension}`;
  async function upsert(table: 'metrics' | 'metric_data', records: Record<string, any>[]) {
    const state = table === 'metrics' ? metricState : dataState;
    const keyFor =
      table === 'metrics' ? (row: Record<string, any>) => String(row.objectId) : dataKey;
    const columns = table === 'metrics' ? metricColumns : dataColumns;
    const changed: Record<string, any>[] = [];
    const archive: string[] = [];
    for (const record of records) {
      const previous = state.get(keyFor(record));
      if (
        previous &&
        Object.entries(record).every(([key, value]) => isDeepStrictEqual(previous[key], value))
      ) {
        counters[table].unchanged++;
        continue;
      }
      if (previous) {
        archive.push(previous.id);
        changed.push({ ...record, objectId: previous.objectId, priorId: previous.id });
        counters[table].updated++;
      } else {
        changed.push({ ...record, objectId: record.objectId ?? randomUUID(), priorId: null });
        counters[table].inserted++;
      }
    }
    if (archive.length) {
      const result = await client.query(
        `UPDATE portal.${table} SET "archivedAt"=clock_timestamp() WHERE id=ANY($1::uuid[]) AND "archivedAt" IS NULL`,
        [archive]
      );
      assert.equal(result.rowCount, archive.length, 'A record changed during the import.');
    }
    for (let offset = 0; offset < changed.length; offset += 250) {
      const names = columns.map((name) => `"${name}"`).join(',');
      const inserted = await client.query(
        `INSERT INTO portal.${table} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::portal.${table},$1::jsonb) RETURNING *`,
        [JSON.stringify(changed.slice(offset, offset + 250))]
      );
      for (const row of inserted.rows) state.set(keyFor(row), row);
    }
  }
  await upsert('metrics', desiredMetrics);
  const metadata = (row: ImportRow, sheet: 'Current' | 'TargetHistory') => {
    const definition = mapping.get(String(row.CovenantId))!.definition;
    const latest =
      row.IsCurrent === true
        ? current.get(`${row.CovenantId}:${period(row.PeriodEnd)}:Target`)
        : undefined;
    const references = [
      ...new Set(
        [
          row.SourceRowId,
          row.FirstSourceRowId,
          row.LastSourceRowId,
          row.ReplacementSourceRowId,
          latest?.SourceRowId,
        ]
          .filter(Boolean)
          .map(String)
      ),
    ];
    for (const id of references) assert.ok(sourceRows.has(id), `Source row not found: ${id}`);
    return {
      import: 'findos-covenants',
      source_file: sourceFile,
      source_sha256: sourceHash,
      sheet,
      source_row: row.source_row,
      covenant_id: row.CovenantId,
      measure: sheet === 'TargetHistory' ? 'Target' : row.Measure,
      status: row.Status,
      operator: row.Operator,
      target_scope: row.TargetScope,
      period_end: excelDate(row.PeriodEnd),
      source_unit: definition.Unit,
      unit_confirmed: definition.Unit === 'Ratio',
      history_version_key: row.VersionKey ?? null,
      first_observed_date: row.FirstObservedDate ? excelDate(row.FirstObservedDate) : null,
      replaced_at: row.ReplacedAt ? excelDate(row.ReplacedAt) : null,
      last_observed_date: row.LastObservedDate ? excelDate(row.LastObservedDate) : null,
      record_key: latest?.RecordKey ?? row.RecordKey ?? null,
      current_record: latest ?? null,
      original_record: row,
      sources: references.map((id) => sourceRows.get(id)),
    };
  };
  const recordFor = (row: ImportRow, sheet: 'Current' | 'TargetHistory') => {
    const pair = mapping.get(String(row.CovenantId))!;
    const metric =
      sheet === 'TargetHistory' || row.Measure === 'Target' ? pair.target : pair.metric;
    return {
      metric_id: metric.objectId,
      company_id: metric.company_id,
      name: metric.name,
      currency: metric.currency,
      period: period(row.PeriodEnd),
      dimension: 'actual',
      value: amount(row),
      source_data: metadata(row, sheet),
    };
  };
  const existingVersionKeys = new Set(
    dataBefore.map((row) => row.source_data?.history_version_key).filter(Boolean)
  );
  const maximumVersions = Math.max(...[...history.values()].map((rows) => rows.length), 0);
  for (let index = 0; index < maximumVersions; index++) {
    const batch = [...history.values()].flatMap((rows) => {
      const row = rows[index];
      return row && !existingVersionKeys.has(row.VersionKey)
        ? [recordFor(row, 'TargetHistory')]
        : [];
    });
    await upsert('metric_data', batch);
  }
  // Reconcile the latest state even if an already-imported record was edited
  // manually, without replaying old target versions over the current state.
  const expected = [
    ...book.Current.filter((row) => row.Measure === 'Value' && row.Status !== 'Missing').map(
      (row) => recordFor(row, 'Current')
    ),
    ...[...history.values()].map((rows) => recordFor(rows.at(-1)!, 'TargetHistory')),
  ];
  await upsert('metric_data', expected);
  // MetricData carries denormalized names and currencies. Update untouched
  // periods/dimensions through new versions too; their values stay intact.
  const details = [...dataState.values()].flatMap((row) => {
    const metric = metricState.get(row.metric_id)!;
    if (
      row.name === metric.name &&
      row.currency === metric.currency &&
      row.company_id === metric.company_id
    )
      return [];
    return [
      {
        ...Object.fromEntries(
          dataColumns
            .filter((name) => name !== 'objectId' && name !== 'priorId')
            .map((name) => [name, row[name]])
        ),
        name: metric.name,
        currency: metric.currency,
        company_id: metric.company_id,
      },
    ];
  });
  await upsert('metric_data', details);

  // Exact reconciliation is part of the import transaction, not an app test.
  const reconciliation = await client.query(
    `WITH expected AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS e(metric_id uuid,period date,dimension text,value numeric,source_data jsonb)
  ) SELECT count(*)::int AS checked, count(*) FILTER(WHERE d.id IS NOT NULL AND d.value IS NOT DISTINCT FROM e.value
      AND d.source_data=e.source_data AND d.company_id=m.company_id AND d.name=m.name AND d.currency IS NOT DISTINCT FROM m.currency)::int AS matched
    FROM expected e LEFT JOIN portal.metric_data d ON d.metric_id=e.metric_id AND d.period=e.period AND d.dimension=e.dimension AND d."archivedAt" IS NULL
    LEFT JOIN portal.metrics m ON m."objectId"=e.metric_id AND m."archivedAt" IS NULL`,
    [JSON.stringify(expected)]
  );
  assert.equal(reconciliation.rows[0].checked, expected.length, 'Duplicate imported records.');
  assert.equal(
    reconciliation.rows[0].matched,
    expected.length,
    'Imported records do not match the source.'
  );
  for (const metric of allMetrics.filter((m) => affectedIds.includes(m.objectId)))
    assert.equal(
      metricState.get(metric.objectId)!.metric_number,
      metric.metric_number,
      'An existing Metric Number changed.'
    );
  const importedHistory = await client.query(
    `SELECT DISTINCT source_data->>'history_version_key' AS key FROM portal.metric_data WHERE metric_id=ANY($1::uuid[]) AND source_data->>'import'='findos-covenants'`,
    [affectedIds]
  );
  const importedKeys = new Set(importedHistory.rows.map((row) => row.key));
  for (const key of versionKeys) assert.ok(importedKeys.has(key), `Missing target version: ${key}`);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const report = {
    applied: apply,
    sourceFile,
    sourceHash,
    companies: companyIdList.length,
    covenants: book.Covenants.length,
    metrics: desiredMetrics.length,
    currentSourceRows: book.Current.length,
    importedCurrentRecords: expected.length,
    numericCurrentRecords: expected.filter((row) => row.value !== null).length,
    statusOnlyCurrentRecords: expected.filter((row) => row.value === null).length,
    missingRowsNotImported: book.Current.filter((row) => row.Status === 'Missing').length,
    targetVersions: book.TargetHistory.length,
    historicalTargetVersions: book.TargetHistory.filter((row) => !row.IsCurrent).length,
    sourceExceptionRowsNotPromoted: book.Exceptions.length,
    unconfirmedUnits: book.Covenants.filter((row) => row.Unit !== 'Ratio').map((row) => ({
      company: row.Company,
      covenant: row.CovenantName,
      note: row.Note,
    })),
    counters,
    reconciled: reconciliation.rows[0].matched,
    backupFile,
    mapping: [...mapping.values()].map(({ metric, target, definition }) => ({
      company: definition.Company,
      name: metric.name,
      companyId: metric.company_id,
      metricId: metric.objectId,
      metricNumber: metric.metric_number,
      targetMetricId: target.objectId,
      targetMetricNumber: target.metric_number,
    })),
  };
  const reportFile = path.join(
    projectRoot,
    `.imports/covenants-${apply ? 'import' : 'preview'}-${timestamp}.json`
  );
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ ...report, mapping: undefined, reportFile }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
