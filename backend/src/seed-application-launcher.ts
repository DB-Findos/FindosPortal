import './config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';
import { pool } from './db.js';
import { beginAuditedImport } from './services/imports.js';
import { createRecord, updateRecord, archiveRecord } from './repositories/entities.js';

const modules = [
  ['knowledge-management', 'Knowledge Management', '/knowledge', 10],
  ['portfolio-management', 'Portfolio Management', '/portfolio/dashboard', 20],
  ['people-management', 'People Management', null, 100],
  ['datev', 'Datev', null, 110],
  ['adobe-sign', 'Adobe Sign', null, 120],
  ['lanes-planes', 'Lanes & Planes', null, 130],
  ['teams', 'Teams', null, 140],
  ['crm', 'DealCloud', null, 150],
  ['dynamo', 'Dynamo', null, 160],
  ['entity-management', 'Entity Management', null, 300],
  ['deal-management', 'Deal Management', null, 310],
  ['fund-management', 'Fund Management', null, 320],
  ['financing-tools', 'Financing Tools', null, 330],
] as const;

const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('portal-application-links'))");
  await beginAuditedImport(db);
  const before = (
    await db.query('SELECT * FROM portal.application_modules WHERE "archivedAt" IS NULL FOR UPDATE')
  ).rows;
  const folder = path.join(projectRoot, '.imports/applications');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `before-launcher-${Date.now()}.json`), JSON.stringify(before));
  for (const [key, name, internal_path, position] of modules) {
    const old = before.find((row) => row.key === key);
    const data = {
      key,
      name,
      internal_path,
      position,
      external_url: internal_path ? null : old?.external_url || null,
    };
    if (!old) await createRecord(db, 'application_modules', data);
    else if (Object.entries(data).some(([field, value]) => old[field] !== value))
      await updateRecord(db, 'application_modules', old.objectId, old.id, data);
  }
  const reporting = before.find((row) => row.key === 'reporting');
  if (reporting) await archiveRecord(db, 'application_modules', reporting.objectId, reporting.id);
  await db.query('COMMIT');
  console.log(
    'Application launcher updated: 2 portal areas, 7 applications, 4 additional areas. Existing external links preserved.'
  );
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
