import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';

// Only the explicitly selected master fields can enter this importer.
const inputSchema = z
  .object({
    source: z.literal('Findos MCP / Dynamo'),
    funds: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(500),
          currency: z.string().regex(/^[A-Z]{3}$/),
        })
        .strict()
    ),
    companies: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(500),
          fund_id: z.uuid(),
          industry: z.string().max(2000).nullable(),
          website: z.string().nullable(),
        })
        .strict()
    ),
    skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
  })
  .strict();
const commit = process.argv.includes('--apply');
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const filename = fileArg
  ? path.resolve(fileArg.slice(7))
  : path.join(projectRoot, '.imports/findos-master-data.json');
const invalidWebsites: string[] = [];
function cleanWebsite(value: string | null, name: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname.includes('.') ||
      /\s/.test(value) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid website');
    return url.toString();
  } catch {
    invalidWebsites.push(name);
    return null;
  }
}
const client = await pool.connect();
try {
  const input = inputSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  assert.equal(
    new Set(input.funds.map((r) => r.id)).size,
    input.funds.length,
    'Duplicate source fund ID'
  );
  assert.equal(
    new Set(input.companies.map((r) => r.id)).size,
    input.companies.length,
    'Duplicate source company ID'
  );
  for (const row of input.companies)
    assert.ok(
      input.funds.some((f) => f.id === row.fund_id),
      'Unknown fund reference'
    );
  const companies = input.companies.map((row) => ({
    ...row,
    website: cleanWebsite(row.website, row.name),
  }));
  await client.query('BEGIN');
  await beginAuditedImport(client);
  // Serialize repeated imports without blocking ordinary portal operations.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('findos-master-data-import'))");
  const counts = { fundsInserted: 0, fundsExisting: 0, companiesInserted: 0, companiesExisting: 0 };
  for (const fund of input.funds) {
    const existing = await client.query(
      'SELECT "objectId" AS id,name,currency FROM portal.funds WHERE "archivedAt" IS NULL AND ("objectId"=$1 OR name=$2)',
      [fund.id, fund.name]
    );
    if (existing.rowCount) {
      assert.equal(existing.rowCount, 1, 'Fund ID/name conflict');
      assert.deepEqual(
        existing.rows[0],
        fund,
        `Fund differs from source: ${fund.name}; no existing data overwritten.`
      );
      counts.fundsExisting++;
      continue;
    }
    await client.query('INSERT INTO portal.funds(id,name,currency) VALUES ($1,$2,$3)', [
      fund.id,
      fund.name,
      fund.currency,
    ]);
    counts.fundsInserted++;
  }
  for (const company of companies) {
    const existing = await client.query(
      'SELECT "objectId" AS id,name,fund_id,industry,website FROM portal.companies WHERE "archivedAt" IS NULL AND ("objectId"=$1 OR (fund_id=$2 AND name=$3))',
      [company.id, company.fund_id, company.name]
    );
    if (existing.rowCount) {
      assert.equal(existing.rowCount, 1, 'Company ID/name conflict');
      assert.deepEqual(
        existing.rows[0],
        company,
        `Company differs from source: ${company.name}; no existing data overwritten.`
      );
      counts.companiesExisting++;
      continue;
    }
    await client.query(
      'INSERT INTO portal.companies(id,name,fund_id,industry,website) VALUES ($1,$2,$3,$4,$5)',
      [company.id, company.name, company.fund_id, company.industry, company.website]
    );
    counts.companiesInserted++;
  }
  // Read back every imported field and check every Fund -> Company link before committing.
  const actualFunds = await client.query(
    'SELECT "objectId" AS id,name,currency FROM portal.funds WHERE "archivedAt" IS NULL AND "objectId"=ANY($1::uuid[])',
    [input.funds.map((f) => f.id)]
  );
  const actualCompanies = await client.query(
    'SELECT c."objectId" AS id,c.name,c.fund_id,c.industry,c.website FROM portal.companies c JOIN portal.funds f ON f."objectId"=c.fund_id AND f."archivedAt" IS NULL WHERE c."archivedAt" IS NULL AND c."objectId"=ANY($1::uuid[])',
    [companies.map((c) => c.id)]
  );
  const sort = (rows: { id: string }[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sort(actualFunds.rows), sort(input.funds));
  assert.deepEqual(sort(actualCompanies.rows), sort(companies));
  await client.query(commit ? 'COMMIT' : 'ROLLBACK');
  console.log(
    JSON.stringify(
      {
        mode: commit ? 'APPLIED' : 'DRY RUN (rolled back)',
        ...counts,
        fundsVerified: actualFunds.rowCount,
        companiesVerified: actualCompanies.rowCount,
        skipped: input.skipped,
        invalidWebsitesOmitted: invalidWebsites,
      },
      null,
      2
    )
  );
  console.log('PASS: all master fields and mandatory fund references verified.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
