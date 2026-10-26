import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

const apply = process.argv.includes('--apply');
const folder = path.join(projectRoot, '.imports');
const json = async (name: string) => JSON.parse(await readFile(path.join(folder, name), 'utf8'));
const sourceNames = ['historisch', 'aktuell', 'budget'] as const;
const dimensions: Record<string, string> = {
  Actual: 'actual',
  Budget: 'budget',
  'Findos Plan': 'plan',
};
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
const date = (value: string) => {
  const serial = Number(value);
  assert.ok(Number.isInteger(serial) && serial > 60 && serial < 100000, 'Invalid Excel date');
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
};
type ImportRow = {
  object_id: string;
  metric_id: string;
  period: string;
  dimension: string;
  value: string | null;
  currency: string | null;
};
const client = await pool.connect();
try {
  const sourceInfo = await json('metric-data-downloads.json');
  const metrics = (
    await client.query(`SELECT m."objectId" AS metric_id,m.name,m.metric_number,m.currency,c.name AS company
    FROM portal.metrics m JOIN portal.companies c ON c."objectId"=m.company_id AND c."archivedAt" IS NULL WHERE m."archivedAt" IS NULL`)
  ).rows;
  const lookup = new Map<string, any>();
  for (const metric of metrics) {
    const key = JSON.stringify([metric.company, String(metric.metric_number)]);
    assert.ok(!lookup.has(key), 'Ambiguous Company / Metric Number: ' + key);
    lookup.set(key, metric);
  }
  const rows: ImportRow[] = [];
  const excluded: unknown[] = [];
  const normalizedValues: unknown[] = [];
  const sources: unknown[] = [];
  const keys = new Set<string>(),
    ids = new Set<string>();
  for (const source of sourceNames) {
    const book = await json(`metric-data-${source}.json`);
    assert.equal(book.sheets.length, 1);
    const sheet = book.sheets[0];
    for (const column of [
      'Internal ID',
      'Company',
      'Metric Number',
      'Short metric name',
      'Period',
      'Dimension',
      'Value',
      'Currency',
    ])
      assert.ok(sheet.headers.includes(column), 'Missing column ' + column);
    let accepted = 0;
    for (const row of sheet.rows) {
      const metric = lookup.get(JSON.stringify([row.Company, row['Metric Number']]));
      if (!metric) {
        assert.equal(
          row.Company,
          'Test Company',
          'Unexpected unmatched Metric: ' + JSON.stringify(row)
        );
        excluded.push({
          source: book.source,
          row: row.__row,
          sourceId: row['Internal ID'],
          company: row.Company,
          metricNumber: row['Metric Number'],
          reason:
            'Test Company and its Metrics are not present in portal; no reference can be assigned.',
        });
        continue;
      }
      assert.equal(
        metric.name,
        row['Short metric name'],
        'Metric name disagrees with Company / Metric Number'
      );
      if (metric.currency)
        assert.equal(metric.currency, row.Currency, 'Currency differs from Metric');
      const dimension = dimensions[row.Dimension];
      assert.ok(dimension, 'Unknown Dimension: ' + row.Dimension);
      let value = row.Value == null || row.Value === '' ? null : String(row.Value);
      if (value !== null && /^\s*'-\d+(?:\.\d+)?E'-\d+$/.test(value)) {
        const original = value;
        value = value.trim().replaceAll("'", '');
        normalizedValues.push({
          source: book.source,
          row: row.__row,
          sourceId: row['Internal ID'],
          original,
          normalized: value,
        });
      }
      const record: ImportRow = {
        object_id: z.uuid().parse(row['Internal ID']),
        metric_id: metric.metric_id,
        period: date(row.Period),
        dimension,
        value: value === null ? null : decimal.parse(value),
        currency: row.Currency
          ? z
              .string()
              .regex(/^[A-Z]{3}$/)
              .parse(row.Currency)
          : null,
      };
      const key = JSON.stringify([record.metric_id, record.period, record.dimension]);
      assert.ok(!keys.has(key), 'Duplicate Metric / period / dimension: ' + key);
      assert.ok(!ids.has(record.object_id), 'Duplicate source ID');
      keys.add(key);
      ids.add(record.object_id);
      rows.push(record);
      accepted++;
    }
    sources.push({
      file: book.source,
      url: sourceInfo[source].source,
      sha256: createHash('sha256')
        .update(await readFile(path.join(folder, book.source)))
        .digest('hex'),
      sourceRows: sheet.rows.length,
      accepted,
      excluded: sheet.rows.length - accepted,
    });
  }
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-metric-data-import'))");
  await client.query('LOCK TABLE portal.metric_data IN SHARE ROW EXCLUSIVE MODE');
  await client.query(
    'CREATE TEMP TABLE metric_data_import(object_id uuid PRIMARY KEY,metric_id uuid NOT NULL,period date NOT NULL,dimension text NOT NULL,value numeric,currency text,UNIQUE(metric_id,period,dimension)) ON COMMIT DROP'
  );
  for (let start = 0; start < rows.length; start += 5000) {
    await client.query(
      `INSERT INTO metric_data_import SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(object_id uuid,metric_id uuid,period date,dimension text,value numeric,currency text)`,
      [JSON.stringify(rows.slice(start, start + 5000))]
    );
  }
  const conflict =
    await client.query(`SELECT s.object_id FROM metric_data_import s JOIN portal.metric_data d ON d."archivedAt" IS NULL AND (d."objectId"=s.object_id OR (d.metric_id=s.metric_id AND d.period=s.period AND d.dimension=s.dimension))
    WHERE d."objectId"<>s.object_id OR d.metric_id<>s.metric_id OR d.period<>s.period OR d.dimension<>s.dimension OR d.value IS DISTINCT FROM s.value LIMIT 10`);
  assert.equal(
    conflict.rowCount,
    0,
    'Existing MetricData differs; nothing overwritten: ' + JSON.stringify(conflict.rows)
  );
  const existing = Number(
    (
      await client.query(
        'SELECT count(*) AS n FROM metric_data_import s JOIN portal.metric_data d ON d."objectId"=s.object_id AND d."archivedAt" IS NULL'
      )
    ).rows[0].n
  );
  const inserted =
    await client.query(`INSERT INTO portal.metric_data("objectId",metric_id,period,dimension,value,currency)
    SELECT s.object_id,s.metric_id,s.period,s.dimension,s.value,s.currency FROM metric_data_import s
    WHERE NOT EXISTS(SELECT 1 FROM portal.metric_data d WHERE d."objectId"=s.object_id AND d."archivedAt" IS NULL)`);
  const verified = Number(
    (
      await client.query(`SELECT count(*) AS n FROM metric_data_import s JOIN portal.metric_data d ON d."objectId"=s.object_id AND d."archivedAt" IS NULL
    WHERE d.metric_id=s.metric_id AND d.period=s.period AND d.dimension=s.dimension AND d.value IS NOT DISTINCT FROM s.value AND d."createdBy" IS NOT NULL AND d."modifiedBy" IS NOT NULL`)
    ).rows[0].n
  );
  assert.equal(verified, rows.length, 'Readback mismatch');
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const summary = (
    await client.query(
      `SELECT dimension,count(*) AS rows,count(*) FILTER(WHERE value IS NULL) AS empty_values,min(period)::text AS first_period,max(period)::text AS last_period FROM metric_data_import GROUP BY dimension ORDER BY dimension`
    )
  ).rows;
  const report = {
    mode: apply ? 'APPLIED' : 'DRY RUN (rolled back)',
    generatedAt: new Date().toISOString(),
    sources,
    sourceRows: rows.length + excluded.length,
    importedRows: rows.length,
    inserted: inserted.rowCount,
    existing,
    verified,
    excludedRows: excluded.length,
    normalizedValues,
    summary,
  };
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  await writeFile(
    path.join(folder, apply ? 'metric-data-import-report.json' : 'metric-data-import-preview.json'),
    JSON.stringify(report, null, 2)
  );
  await writeFile(
    path.join(folder, 'metric-data-import-excluded.json'),
    JSON.stringify(excluded, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(
    'PASS: every imported value, source ID, Metric reference, period, dimension and audit actor verified; exact decimals and NULLs preserved.'
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
