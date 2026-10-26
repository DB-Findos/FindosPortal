import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

const apply = process.argv.includes('--apply');
const client = await pool.connect();
try {
  const currencies: { object_id: string; currency: string | null }[] = [];
  for (const source of ['historisch', 'aktuell', 'budget']) {
    const book = JSON.parse(
      await readFile(path.join(projectRoot, `.imports/metric-data-${source}.json`), 'utf8')
    );
    for (const row of book.sheets[0].rows)
      currencies.push({ object_id: row['Internal ID'], currency: row.Currency || null });
  }
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query('LOCK TABLE portal.metric_data IN SHARE ROW EXCLUSIVE MODE');
  await client.query(
    'CREATE TEMP TABLE source_currency(object_id uuid PRIMARY KEY,currency text) ON COMMIT DROP'
  );
  for (let i = 0; i < currencies.length; i += 5000)
    await client.query(
      'INSERT INTO source_currency SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(object_id uuid,currency text)',
      [JSON.stringify(currencies.slice(i, i + 5000))]
    );
  await client.query(
    `CREATE TEMP TABLE metric_data_before ON COMMIT DROP AS SELECT * FROM portal.metric_data WHERE "archivedAt" IS NULL`
  );
  await client.query(`CREATE TEMP TABLE details_to_fill ON COMMIT DROP AS
    SELECT d.*,coalesce(m.currency,s.currency,d.currency) AS next_currency
    FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
    LEFT JOIN source_currency s ON s.object_id=d."objectId"
    WHERE d."archivedAt" IS NULL AND (d.company_id IS DISTINCT FROM m.company_id OR d.name IS DISTINCT FROM m.name OR d.currency IS DISTINCT FROM coalesce(m.currency,s.currency,d.currency))`);
  const archived = await client.query(
    'UPDATE portal.metric_data d SET "archivedAt"=clock_timestamp() FROM details_to_fill t WHERE d.id=t.id'
  );
  const inserted =
    await client.query(`INSERT INTO portal.metric_data("objectId","priorId",metric_id,period,value,dimension,currency)
    SELECT "objectId",id,metric_id,period,value,dimension,next_currency FROM details_to_fill`);
  const check = (
    await client.query(`SELECT count(*) AS verified,count(*) FILTER(WHERE d.company_id IS DISTINCT FROM m.company_id OR d.name IS DISTINCT FROM m.name OR d.currency IS DISTINCT FROM coalesce(m.currency,s.currency,d.currency)) AS incorrect_details,
    count(*) FILTER(WHERE b.value IS DISTINCT FROM d.value OR b.metric_id<>d.metric_id OR b.period<>d.period OR b.dimension<>d.dimension OR b."createdAt"<>d."createdAt" OR b."createdBy"<>d."createdBy") AS changed_originals
    FROM metric_data_before b JOIN portal.metric_data d ON d."objectId"=b."objectId" AND d."archivedAt" IS NULL JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL LEFT JOIN source_currency s ON s.object_id=d."objectId"`)
  ).rows[0];
  const total = Number(
    (await client.query('SELECT count(*) AS n FROM metric_data_before')).rows[0].n
  );
  assert.equal(Number(check.verified), total);
  assert.equal(Number(check.incorrect_details), 0);
  assert.equal(Number(check.changed_originals), 0);
  assert.equal(archived.rowCount, inserted.rowCount);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const report = {
    mode: apply ? 'APPLIED' : 'PREVIEW',
    archived: archived.rowCount,
    newVersions: inserted.rowCount,
    ...check,
  };
  await writeFile(
    path.join(projectRoot, '.imports/metric-data-details-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
  console.log(
    'PASS: Company, Name, Currency verified; original values, dimensions, references and creation metadata unchanged.'
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
