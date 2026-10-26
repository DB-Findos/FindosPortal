import assert from 'node:assert/strict';
import { pool } from './db.js';
import { beginAuditedImport } from './services/imports.js';
import { updateRecord } from './repositories/entities.js';

const key = (value: string | null | undefined) => value?.trim().toLocaleLowerCase('de-DE') || '';
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await beginAuditedImport(client);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-deal-data-company-map'))");

  const companies = (
    await client.query(`SELECT "objectId",name,internal_name FROM portal.companies
      WHERE "archivedAt" IS NULL`)
  ).rows as { objectId: string; name: string; internal_name: string | null }[];
  const byInternalName = new Map<string, string>();
  for (const company of companies) {
    const internalName = key(company.internal_name);
    if (!internalName) continue;
    assert.ok(!byInternalName.has(internalName), `Duplicate Company internal_name: ${company.internal_name}`);
    byInternalName.set(internalName, company.objectId);
  }

  const deals = (
    await client.query(`SELECT * FROM portal.deal_data WHERE "archivedAt" IS NULL FOR UPDATE`)
  ).rows as Record<string, any>[];
  let alreadyMapped = 0;
  let remapped = 0;
  const unresolved: string[] = [];
  for (const deal of deals) {
    const companyId = byInternalName.get(key(deal.company_internal_name));
    if (!companyId) {
      unresolved.push(deal.objectId);
      continue;
    }
    if (deal.company_id === companyId) {
      alreadyMapped++;
      continue;
    }
    await updateRecord(client, 'deal_data', deal.objectId, deal.id, { company_id: companyId });
    remapped++;
  }
  assert.equal(unresolved.length, 0, `Unresolved DealData Company references: ${unresolved.join(', ')}`);
  await client.query('COMMIT');
  console.log(JSON.stringify({ dealData: deals.length, alreadyMapped, remapped, unresolved: 0 }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
