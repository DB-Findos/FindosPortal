import type { DatabaseClient } from '../../database/connection.js';
import type { Actor } from '../../mcp/data.js';
import { activeRow, createRecord, updateRecord } from '../../repositories/entities.js';
import { permit } from '../kpi-definitions.js';
import { httpError } from '../../shared/errors.js';
import { reportVisibility } from './access.js';
import { customReportInput, type CustomContext } from './definition.js';
import { validateMappings, resolveBindings } from './data.js';
import { validateHtml, renderHtml } from './html.js';

export async function accessibleReport(
  db: DatabaseClient,
  actor: Actor,
  id: string,
  owner = false
) {
  permit(actor.rights, 'custom_reports');
  const row = (
    await db.query(
      `SELECT r.* FROM portal.custom_reports r WHERE r."objectId"=$1 AND r."archivedAt" IS NULL
 AND ${owner ? 'r.owner_id=$2' : reportVisibility('r', '$2')}`,
      [id, actor.userId]
    )
  ).rows[0];
  if (!row) throw httpError(404, 'Bericht nicht gefunden oder nicht freigegeben.');
  return row;
}
export async function listCustomReports(
  db: DatabaseClient,
  actor: Actor,
  scope: 'own' | 'shared',
  search = ''
) {
  permit(actor.rights, 'custom_reports');
  return (
    await db.query(
      `SELECT r."objectId",r.id,r.name,r.description,r.owner_id,r."lastModifiedAt",
 (r.owner_id=$1) AS is_owner FROM portal.custom_reports r
 WHERE r."archivedAt" IS NULL AND ${reportVisibility('r', '$1')}
 AND ${scope === 'own' ? 'r.owner_id=$1' : 'r.owner_id<>$1'} AND (r.name ILIKE $2 OR r.description ILIKE $2)
 ORDER BY r."lastModifiedAt" DESC,r."objectId" LIMIT 100`,
      [actor.userId, `%${search}%`]
    )
  ).rows;
}
export async function prepareCustomReport(
  db: DatabaseClient,
  actor: Actor,
  raw: unknown,
  id?: string,
  version?: string
) {
  permit(actor.rights, 'custom_reports', id ? 'update' : 'create');
  if (id) {
    const row = await accessibleReport(db, actor, id, true);
    if (row.id !== version) throw httpError(409, 'Bericht inzwischen geändert. Erneut laden.');
  }
  const input = customReportInput.parse(raw);
  const html = validateHtml(input);
  await validateMappings(db, actor.rights, input);
  return { ...input, html };
}
export async function saveCustomReport(
  db: DatabaseClient,
  actor: Actor,
  raw: unknown,
  id?: string,
  version?: string,
  creationId?: string
) {
  if (id) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
  const input = await prepareCustomReport(db, actor, raw, id, version);
  const data = { ...input, mapping: JSON.stringify(input.mapping) };
  return id
    ? updateRecord(db, 'custom_reports', id, version!, data)
    : createRecord(db, 'custom_reports', {
        ...data,
        owner_id: actor.userId,
        engine_version: 1,
        ...(creationId ? { objectId: creationId } : {}),
      });
}
export async function runCustomReport(
  db: DatabaseClient,
  actor: Actor,
  raw: unknown,
  context: CustomContext
) {
  const input = customReportInput.parse(raw);
  await validateMappings(db, actor.rights, input);
  const { company, results } = await resolveBindings(db, actor.rights, input, context);
  const code = context.currency === 'EUR' ? 'EUR' : company.currency || 'EUR';
  const html = renderHtml(input, results, {
    company: company.internal_name || company.name,
    date: context.date,
    currency: code,
    dimension: context.dimension,
  });
  return {
    name: input.name,
    description: input.description,
    context: { ...context, currency_code: code },
    html,
    bindings: results,
    warnings: results
      .filter((result) => result.message)
      .map((result) => `${result.label}: ${result.message}`),
  };
}
