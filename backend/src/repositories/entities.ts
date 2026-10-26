import type { DatabaseClient as PoolClient } from '../database/connection.js';
import { pool } from '../db.js';
import { definitions, type Entity } from '../entities.js';
import { httpError, fieldError } from '../shared/errors.js';

export const current = '"archivedAt" IS NULL';
export const auditColumns = [
  'objectId',
  'priorId',
  'createdAt',
  'lastModifiedAt',
  'archivedAt',
  'createdBy',
  'modifiedBy',
];
export function publicRow(entity: Entity, row: Record<string, any>) {
  const result = { ...row };
  delete result.password_hash;
  return result;
}
export async function transaction<T>(actor: string, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('portal.actor_id',$1,true),set_config('portal.allow_archive','on',true)",
      [actor]
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function activeRow(
  client: PoolClient,
  entity: Entity,
  identity: string,
  lock = false
) {
  const result = await client.query(
    `SELECT * FROM portal.${entity} WHERE "objectId"=$1 AND ${current}${lock ? ' FOR UPDATE' : ''}`,
    [identity]
  );
  if (!result.rowCount) throw httpError(404, 'Objekt nicht gefunden oder bereits archiviert.');
  return result.rows[0];
}
async function validateReferences(client: PoolClient, entity: Entity, data: Record<string, any>) {
  for (const [column, target] of Object.entries(definitions[entity].refs)) {
    if (data[column] == null) continue;
    const result = await client.query(
      `SELECT id FROM portal.${target} WHERE "objectId"=$1 AND ${current} FOR SHARE`,
      [data[column]]
    );
    if (!result.rowCount)
      throw fieldError(
        409,
        column,
        'Der ausgewählte Eintrag ist nicht mehr verfügbar. Bitte einen anderen auswählen.'
      );
  }
}
export async function createRecord(client: PoolClient, entity: Entity, data: Record<string, any>) {
  await validateReferences(client, entity, data);
  const keys = Object.keys(data);
  const placeholders = keys.map((_, index) => '$' + (index + 1));
  const result = await client.query(
    `INSERT INTO portal.${entity} (${keys.map((key) => '"' + key + '"').join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
    Object.values(data)
  );
  return publicRow(entity, result.rows[0]);
}
export async function updateRecord(
  client: PoolClient,
  entity: Entity,
  identity: string,
  expectedId: string,
  data: Record<string, any>
) {
  const previous = await activeRow(client, entity, identity, true);
  if (previous.id !== expectedId)
    throw httpError(409, 'Dieses Objekt wurde inzwischen geändert. Bitte neu laden.');
  const next = { ...previous, ...data };
  await validateReferences(client, entity, next);
  await client.query(`UPDATE portal.${entity} SET "archivedAt"=clock_timestamp() WHERE id=$1`, [
    previous.id,
  ]);
  delete next.id;
  next.priorId = previous.id;
  const keys = Object.keys(next);
  const result = await client.query(
    `INSERT INTO portal.${entity} (${keys.map((key) => '"' + key + '"').join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
    Object.values(next)
  );
  return publicRow(entity, result.rows[0]);
}
export async function archiveRecord(
  client: PoolClient,
  entity: Entity,
  identity: string,
  expectedId: string
) {
  const row = await activeRow(client, entity, identity, true);
  if (row.id !== expectedId)
    throw httpError(409, 'Dieses Objekt wurde inzwischen geändert. Bitte neu laden.');
  // Explicit logical cascades preserve history of authorization relationships.
  const cascades: Record<string, string[]> =
    entity === 'users'
      ? { user_group_memberships: ['user_id'], search_views: ['owner_id'] }
      : entity === 'user_groups'
        ? { user_group_memberships: ['group_id'], permissions: ['group_id'] }
        : entity === 'kpi_formulas'
          ? { variable_map: ['formula_id'] }
          : entity === 'report_definitions'
            ? { report_items: ['report_id'] }
            : {};
  for (const [table, columns] of Object.entries(cascades))
    for (const column of columns) {
      const children = (
        await client.query(
          `SELECT * FROM portal.${table} WHERE ${column}=$1 AND ${current} FOR UPDATE`,
          [identity]
        )
      ).rows;
      for (const child of children)
        await archiveRecord(client, table as Entity, child.objectId, child.id);
    }
  for (const [table, def] of Object.entries(definitions))
    for (const [column, target] of Object.entries(def.refs)) {
      if (target !== entity) continue;
      const used = await client.query(
        `SELECT 1 FROM portal.${table} WHERE "${column}"=$1 AND ${current} LIMIT 1`,
        [identity]
      );
      if (used.rowCount)
        throw httpError(409, 'Dieses Objekt wird noch von aktiven Datensätzen verwendet.');
    }
  const fixedUse = await client.query(
    `SELECT 1 FROM portal.variable_map WHERE entity=$1 AND record_id=$2 AND ${current} LIMIT 1`,
    [entity, identity]
  );
  if (fixedUse.rowCount)
    throw httpError(409, 'Dieses Objekt wird noch als feste KPI-Variable verwendet.');
  await client.query(`UPDATE portal.${entity} SET "archivedAt"=clock_timestamp() WHERE id=$1`, [
    row.id,
  ]);
}
