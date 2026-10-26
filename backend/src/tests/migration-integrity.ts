import '../config.js';
import assert from 'node:assert/strict';
import { pool } from '../db.js';
import { definitions } from '../entities.js';
import { readFile } from 'node:fs/promises';
const baseline: Record<string, number> | null = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : null;
const counts: Record<string, number> = {};
const client = await pool.connect();
try {
  for (const entity of Object.keys(definitions)) {
    const invalid = await client.query(
      `SELECT 1 FROM portal.${entity} t LEFT JOIN portal.object_registry r ON r.id=t."objectId" WHERE t."objectId" IS NULL OR t."createdAt" IS NULL OR t."lastModifiedAt" IS NULL OR t."createdBy" IS NULL OR t."modifiedBy" IS NULL OR r.entity IS DISTINCT FROM $1 LIMIT 1`,
      [entity]
    );
    assert.equal(invalid.rowCount, 0, 'Invalid version metadata in ' + entity);
  }
  for (const entity of ['funds', 'companies', 'metrics', 'index_rates', 'metric_data']) {
    const count = (
      await client.query(
        `SELECT count(*)::int AS n FROM portal.${entity} WHERE "archivedAt" IS NULL`
      )
    ).rows[0].n;
    counts[entity] = count;
    if (baseline) assert.equal(count, baseline[entity], 'Active source count changed in ' + entity);
  }
  const broken = await client.query(
    'SELECT 1 FROM portal.metrics m LEFT JOIN portal.companies c ON c."objectId"=m.company_id AND c."archivedAt" IS NULL WHERE m."archivedAt" IS NULL AND c.id IS NULL LIMIT 1'
  );
  assert.equal(broken.rowCount, 0);
  for (const sql of [
    'UPDATE portal.funds SET name=name WHERE "archivedAt" IS NULL',
    'DELETE FROM portal.funds WHERE "archivedAt" IS NOT NULL',
  ]) {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      if (sql.startsWith('UPDATE')) assert.fail('Unversioned update accepted');
    } catch (error: any) {
      assert.equal(error.code, '23514');
    } finally {
      await client.query('ROLLBACK');
    }
  }
  const archived = (
    await client.query('SELECT id FROM portal.funds WHERE "archivedAt" IS NOT NULL LIMIT 1')
  ).rows[0];
  if (archived) {
    await assert.rejects(
      client.query('DELETE FROM portal.funds WHERE id=$1', [archived.id]),
      (error: any) => error.code === '23514'
    );
  }
  console.log(
    `PASS all ${Object.keys(definitions).length} entities have valid audit metadata and stable identity registry entries`
  );
  console.log(
    `${baseline ? 'PASS source counts preserved' : 'Observed source counts'}: ${JSON.stringify(counts)}`
  );
  console.log('PASS logical references, direct-update rejection and physical-deletion protection');
} finally {
  client.release();
  await pool.end();
}
