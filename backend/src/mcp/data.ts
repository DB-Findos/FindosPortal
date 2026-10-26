import { z } from 'zod';
import { definitions, entityName, fields, type Entity } from '../entities.js';
import { auditColumns, current, publicRow } from '../repositories/entities.js';
import { compileSearch, searchDefinition } from '../services/search.js';
import { permit, type Rights } from '../services/kpi-definitions.js';
import { snapshot } from '../services/snapshot.js';
import { httpError } from '../shared/errors.js';
import { privateChatEntities } from '../services/chat-schema.js';

export type Actor = { userId: string; rights: Rights; canCommit: boolean; conversationId?: string };
export const versionFields = ['id', ...auditColumns];
const privateFields = new Set(['password', 'password_hash']);
export const readableFields = (entity: Entity) =>
  [...versionFields, ...Object.keys(definitions[entity].schema.shape)].filter(
    (f) => !privateFields.has(f)
  );

export function catalog(actor: Actor) {
  return Object.entries(definitions)
    .filter(([name]) => actor.rights[name]?.can_read)
    .map(([name, definition]) => ({
      entity: name,
      label: definition.label,
      permissions: actor.rights[name],
      references: definition.refs,
      specializedWrite: 'readonly' in definition,
    }));
}
export async function describeEntity(actor: Actor, name: string) {
  const entity = entityName(name);
  permit(actor.rights, entity);
  return snapshot(async (db) => ({
    ...catalog(actor).find((item) => item.entity === entity),
    fields: fields(entity).map((f) => ({ ...f, writeOnly: f.name === 'password' })),
    inputSchema: z.toJSONSchema(definitions[entity].schema, { unrepresentable: 'any' }),
    databaseColumns: (
      await db.query(
        `SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='portal' AND table_name=$1 ORDER BY ordinal_position`,
        [entity]
      )
    ).rows,
    incomingReferences: catalog(actor).flatMap((source) =>
      Object.entries(source.references)
        .filter(([, target]) => target === entity)
        .map(([field]) => ({ entity: source.entity, field }))
    ),
    identity:
      'objectId = stable logical ID (references); id = version ID (expected_version for edits). Active: archivedAt IS NULL.',
  }));
}

export const queryInput = z
  .object({
    definition: searchDefinition,
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export async function queryEntities(actor: Actor, raw: unknown) {
  const input = queryInput.parse(raw);
  const query = compileSearch(input.definition, actor.rights);
  return snapshot(async (db) => {
    const rows = (await db.query(query.sql, [...query.values, input.limit + 1, input.offset])).rows;
    return {
      columns: query.columns,
      rows: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit,
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    };
  });
}

export const recordInput = z
  .object({
    entity: z.string(),
    object_id: z.uuid(),
    history: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(1000000).default(0),
    fields: z.array(z.string()).min(1).max(60).optional(),
  })
  .strict();
export async function getRecord(actor: Actor, raw: unknown) {
  const input = recordInput.parse(raw),
    entity = entityName(input.entity);
  if (privateChatEntities.has(entity))
    throw httpError(
      403,
      'Private Chats über list_conversations, read_conversation und read_document abrufen.'
    );
  permit(actor.rights, entity);
  const selected = input.fields ?? readableFields(entity).filter((f) => f !== 'data_base64');
  if (selected.some((f) => !readableFields(entity).includes(f)))
    throw httpError(400, 'Unbekanntes oder geschütztes Feld.');
  const columns = selected.map((f) => '"' + f + '"').join(',');
  return snapshot(async (db) => {
    const values: unknown[] = [input.object_id, input.limit + 1, input.offset];
    const owner = entity === 'search_views' ? ' AND owner_id=$4' : '';
    if (owner) values.push(actor.userId);
    const rows = (
      await db.query(
        `SELECT ${columns} FROM portal.${entity} WHERE "objectId"=$1 ${owner}
      ${input.history ? '' : 'AND ' + current} ORDER BY "lastModifiedAt" DESC,id LIMIT $2 OFFSET $3`,
        values
      )
    ).rows;
    return {
      rows: rows.slice(0, input.limit).map((row) => publicRow(entity, row)),
      hasMore: rows.length > input.limit,
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
    };
  });
}

export const metricInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    company_id: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export async function resolveMetric(actor: Actor, raw: unknown) {
  const input = metricInput.parse(raw);
  permit(actor.rights, 'metrics');
  const words = input.name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const patterns = words.map((word) => '%' + word.replace(/[\\%_]/g, '\\$&') + '%');
  return snapshot(async (db) => {
    const rows = (
      await db.query(
        `SELECT metric_number, name, unit, currency, count(DISTINCT company_id)::int AS company_count
      FROM portal.metrics WHERE ${current} AND metric_number IS NOT NULL AND name ILIKE ALL($1::text[])
      AND ($2::uuid IS NULL OR company_id=$2)
      GROUP BY metric_number,name,unit,currency ORDER BY (lower(name)=lower($3)) DESC,name,metric_number,unit,currency
      LIMIT $4 OFFSET $5`,
        [patterns, input.company_id ?? null, input.name, input.limit + 1, input.offset]
      )
    ).rows;
    const exact = rows.filter((row) => row.name.toLowerCase() === input.name.toLowerCase());
    return {
      matches: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit,
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      advice: exact.length
        ? 'Use matching metric_number with entity=metric_data and field=value. Check ambiguity across distinct numbers.'
        : 'Choose only a semantically matching name; shorten the search if empty. Never invent a number.',
    };
  });
}
