import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { updateRecord } from './repositories/entities.js';

const apply = process.argv.includes('--apply');
const folder = path.join(projectRoot, '.imports');
const json = async (name: string) => JSON.parse(await readFile(path.join(folder, name), 'utf8'));
const workbookSchema = z.object({
  source: z.string(),
  sheets: z
    .array(
      z.object({
        name: z.string(),
        headers: z.array(z.string()),
        rows: z.array(z.record(z.string(), z.unknown())),
      })
    )
    .length(1),
});
const metricSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  name: z.string().trim().min(1).max(500),
  unit: z.string().trim().min(1).max(500),
  metric_number: z.number().int().min(0).max(2147483647),
  section: z.string().trim().max(2000).nullable(),
  important: z.boolean(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  description: z.string().max(2000).nullable(),
});
const companyNameSchema = z.object({
  id: z.uuid(),
  internal_name: z.string().trim().min(1).max(2000),
});
const client = await pool.connect();
try {
  const metricsBook = workbookSchema.parse(await json('metrics-extracted.json'));
  const companyBook = workbookSchema.parse(await json('sharepoint-companies.json'));
  const sourceMetadata = await json('metrics-source.json');
  const localHash = createHash('sha256')
    .update(await readFile(sourceMetadata.metricsFile))
    .digest('hex');
  assert.equal(
    localHash,
    sourceMetadata.metricsSha256,
    'Metrics source file changed after extraction'
  );
  const requiredHeaders = [
    'Internal ID',
    'Company',
    'Short metric name',
    'Metric unit',
    'Metric number',
    'Section',
    'Important',
    'Company currency',
    'Metric description',
  ];
  for (const header of requiredHeaders)
    assert.ok(metricsBook.sheets[0].headers.includes(header), 'Missing column ' + header);
  for (const header of ['Name (ID)', 'Internal Name'])
    assert.ok(
      companyBook.sheets[0].headers.includes(header),
      'Missing SharePoint column ' + header
    );
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-metrics-import'))");
  const existingCompanies = (
    await client.query(
      'SELECT "objectId" AS id,id AS "versionId",name,internal_name FROM portal.companies WHERE "archivedAt" IS NULL FOR UPDATE'
    )
  ).rows;
  const companyIds = new Map<string, string>();
  for (const company of existingCompanies) {
    assert.ok(!companyIds.has(company.name), 'Ambiguous existing Company name: ' + company.name);
    companyIds.set(company.name, company.id);
  }
  const companyNames = existingCompanies.map((company) => {
    const matches = companyBook.sheets[0].rows.filter((row) => row['Name (ID)'] === company.name);
    assert.equal(
      matches.length,
      1,
      'SharePoint Company name must match exactly once: ' + company.name
    );
    const name = companyNameSchema.parse({
      id: company.id,
      internal_name: matches[0]['Internal Name'],
    });
    assert.ok(
      company.internal_name === null || company.internal_name === name.internal_name,
      'Existing internal name differs: ' + company.name
    );
    return name;
  });
  const skipped: { row: unknown; company: unknown; metric_id: unknown; reason: string }[] = [];
  const metrics: z.infer<typeof metricSchema>[] = [];
  for (const row of metricsBook.sheets[0].rows) {
    const company_id = companyIds.get(String(row.Company));
    const skip = (reason: string) =>
      skipped.push({ row: row.__row, company: row.Company, metric_id: row['Internal ID'], reason });
    if (!company_id) {
      assert.ok(
        ['Model Company - Cost of Sales', 'Model Company - Total Cost', 'Test Company'].includes(
          String(row.Company)
        ),
        'Unexpected unmatched Company: ' + row.Company
      );
      skip('Company not present in portal (test/model entity without Fund)');
      continue;
    }
    if (!row['Short metric name'] || !row['Metric unit'] || !row['Metric number']) {
      skip('Missing required Metric name, number or unit');
      continue;
    }
    assert.ok(
      row.Important === 'True' || row.Important === 'False',
      'Invalid Important value in row ' + row.__row
    );
    metrics.push(
      metricSchema.parse({
        id: row['Internal ID'],
        company_id,
        name: row['Short metric name'],
        unit: row['Metric unit'],
        metric_number: Number(row['Metric number']),
        section: row.Section || null,
        important: row.Important === 'True',
        currency: row['Company currency'] || null,
        description: row['Metric description'] || null,
      })
    );
  }
  assert.equal(new Set(metrics.map((r) => r.id)).size, metrics.length, 'Duplicate Metric ID');
  assert.equal(
    new Set(metrics.map((r) => JSON.stringify([r.company_id, r.name]))).size,
    metrics.length,
    'Duplicate Metric name within Company'
  );
  const ids = metrics.map((m) => m.id);
  const previous = (
    await client.query(
      'SELECT "objectId" AS id,company_id,name,unit,metric_number,section,important,currency,description FROM portal.metrics WHERE "archivedAt" IS NULL AND "objectId"=ANY($1::uuid[])',
      [ids]
    )
  ).rows;
  const expected = new Map(metrics.map((m) => [m.id, m]));
  for (const row of previous)
    assert.deepEqual(
      row,
      expected.get(row.id),
      'Existing Metric differs; import does not overwrite it: ' + row.id
    );
  const namedConflicts = await client.query(
    `SELECT m.id FROM portal.metrics m JOIN jsonb_to_recordset($1::jsonb) AS x(id uuid,company_id uuid,name text) ON m.company_id=x.company_id AND m.name=x.name WHERE m."archivedAt" IS NULL AND m."objectId"<>x.id`,
    [JSON.stringify(metrics)]
  );
  assert.equal(
    namedConflicts.rowCount,
    0,
    'Existing Metric has the same Company/name but another ID'
  );
  const namesUpdated = { rowCount: 0 };
  for (const row of companyNames) {
    const old = existingCompanies.find((c) => c.id === row.id)!;
    if (old.internal_name !== row.internal_name) {
      await updateRecord(client, 'companies', row.id, old.versionId, {
        internal_name: row.internal_name,
      });
      namesUpdated.rowCount++;
    }
  }
  const existingIds = new Set(previous.map((row) => row.id));
  const missingMetrics = metrics.filter((row) => !existingIds.has(row.id));
  const inserted = await client.query(
    `INSERT INTO portal.metrics(id,company_id,name,unit,metric_number,section,important,currency,description)
 SELECT id,company_id,name,unit,metric_number,section,important,currency,description FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,company_id uuid,name text,unit text,metric_number integer,section text,important boolean,currency text,description text)`,
    [JSON.stringify(missingMetrics)]
  );
  const actual = (
    await client.query(
      'SELECT m."objectId" AS id,m.company_id,m.name,m.unit,m.metric_number,m.section,m.important,m.currency,m.description FROM portal.metrics m JOIN portal.companies c ON c."objectId"=m.company_id AND c."archivedAt" IS NULL WHERE m."archivedAt" IS NULL AND m."objectId"=ANY($1::uuid[])',
      [ids]
    )
  ).rows;
  const actualNames = (
    await client.query(
      'SELECT "objectId" AS id,internal_name FROM portal.companies WHERE "archivedAt" IS NULL AND "objectId"=ANY($1::uuid[])',
      [companyNames.map((c) => c.id)]
    )
  ).rows;
  const sort = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sort(actual), sort(metrics));
  assert.deepEqual(sort(actualNames), sort(companyNames));
  const skippedCounts = new Map<string, number>();
  for (const row of skipped)
    skippedCounts.set(String(row.company), (skippedCounts.get(String(row.company)) || 0) + 1);
  const result = {
    mode: apply ? 'APPLIED' : 'DRY RUN (rolled back)',
    metricsSource: sourceMetadata.metricsFile,
    metricsSha256: localHash,
    internalNamesSource: sourceMetadata.internalNamesUrl,
    sourceMetricRows: metricsBook.sheets[0].rows.length,
    internalNamesVerified: actualNames.length,
    internalNamesUpdated: namesUpdated.rowCount,
    metricsInserted: inserted.rowCount,
    metricsExisting: previous.length,
    metricsVerified: actual.length,
    companiesWithMetrics: new Set(metrics.map((m) => m.company_id)).size,
    skippedCount: skipped.length,
    skippedGroups: [...skippedCounts].map(([company, rows]) => ({ company, rows })),
    skipped,
  };
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  await writeFile(
    path.join(folder, apply ? 'metrics-import-report.json' : 'metrics-import-preview.json'),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify({ ...result, skipped: undefined }, null, 2));
  console.log('PASS: every imported Metric field, Company ID and Internal Name verified.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
