import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { updateRecord } from './repositories/entities.js';
import { beginAuditedImport } from './services/imports.js';

const rows = z
  .array(
    z.object({
      source_id: z.uuid(),
      name: z.string().min(1),
      findos_share: z.coerce.number().finite(),
    })
  )
  .parse(
    JSON.parse(
      await readFile(path.join(projectRoot, '.imports/deal-data-findos-share.json'), 'utf8')
    )
  );
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-deal-data-findos-share'))");
  let updated = 0;
  for (const source of rows) {
    const result = await client.query(
      `SELECT * FROM portal.deal_data WHERE source_id=$1 AND "archivedAt" IS NULL FOR UPDATE`,
      [source.source_id]
    );
    assert.equal(result.rowCount, 1, `Expected one active DealData row for ${source.source_id}`);
    const deal = result.rows[0];
    assert.equal(deal.name, source.name, `Source ID/name mismatch for ${source.source_id}`);
    if (deal.findos_share === String(source.findos_share)) continue;
    await updateRecord(client, 'deal_data', deal.objectId, deal.id, {
      findos_share: source.findos_share,
    });
    updated++;
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ sourceRows: rows.length, updated }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
