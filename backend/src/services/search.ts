import { z } from 'zod';
import { definitions, entityName, fields, type Entity } from '../entities.js';
import { auditColumns } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';
import { privateChatEntities } from './chat-schema.js';
import { privateCustomReportEntities } from './custom-reports/access.js';
import { sharedDocumentScope, documentLinkSql } from './document-schema.js';

const alias = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);
const field = z.object({ alias, field: z.string().min(1).max(100) }).strict();
export const searchDefinition = z
  .object({
    entity: z.string().min(1).max(100),
    joins: z
      .array(
        z
          .object({
            alias,
            from: alias,
            field: z.string().min(1).max(100),
            type: z.enum(['inner', 'left']),
          })
          .strict()
      )
      .max(8)
      .default([]),
    fields: z.array(field).min(1).max(30),
    filters: z
      .array(
        field.extend({
          op: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'isnull', 'notnull']),
          value: z
            .union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])
            .optional(),
        })
      )
      .max(30)
      .default([]),
    order: z
      .array(field.extend({ direction: z.enum(['asc', 'desc']) }))
      .max(3)
      .default([]),
  })
  .strict();
export type SearchDefinition = z.infer<typeof searchDefinition>;
export function searchFields(entity: Entity) {
  return ['id', ...Object.keys(definitions[entity].schema.shape), ...auditColumns].filter(
    (f) => !['password', 'password_hash', 'data_base64', 'definition'].includes(f)
  );
}
export function compileSearch(
  input: unknown,
  rights: Record<string, { can_read?: boolean }>,
  options: { rootRows?: boolean; includeRecordRefs?: boolean } = {}
) {
  const definition = searchDefinition.parse(input);
  const aliases = new Map<string, { entity: Entity; sql: string }>();
  const authorize = (entity: Entity) => {
    if (
      entity === 'search_views' ||
      privateChatEntities.has(entity) ||
      privateCustomReportEntities.has(entity) ||
      !rights[entity]?.can_read
    )
      throw httpError(403, 'Keine Leseberechtigung für ' + entity);
  };
  const root = entityName(definition.entity);
  authorize(root);
  aliases.set('root', { entity: root, sql: 't0' });
  let from = `portal.${root} t0`;
  for (const [index, join] of definition.joins.entries()) {
    if (aliases.has(join.alias)) throw httpError(400, 'Alias bereits vergeben: ' + join.alias);
    const parent = aliases.get(join.from);
    if (!parent) throw httpError(400, 'Unbekannter Ausgangs-Alias.');
    const target = (definitions[parent.entity].refs as Record<string, Entity>)[join.field];
    if (!target)
      throw httpError(400, 'Verknüpfungen sind nur über definierte Referenzfelder erlaubt.');
    authorize(target);
    const sql = 't' + (index + 1);
    aliases.set(join.alias, { entity: target, sql });
    from += ` ${join.type === 'inner' ? 'INNER' : 'LEFT'} JOIN portal.${target} ${sql} ON ${parent.sql}."${join.field}"=${sql}."objectId" AND ${sql}."archivedAt" IS NULL AND ${sharedDocumentScope(target, sql)}`;
  }
  const resolve = (item: { alias: string; field: string }) => {
    const source = aliases.get(item.alias);
    if (!source || !searchFields(source.entity).includes(item.field))
      throw httpError(400, 'Unbekanntes oder gesperrtes Feld: ' + item.alias + '.' + item.field);
    if (item.field === 'url' && ['documents', 'knowledge_documents'].includes(source.entity))
      return `(${documentLinkSql(source.entity, source.sql)})`;
    return `${source.sql}."${item.field}"`;
  };
  const values: unknown[] = [];
  const where = ['t0."archivedAt" IS NULL', sharedDocumentScope(root, 't0')];
  for (const source of aliases.values())
    if (source.entity === 'kpi_data') {
      values.push(
        Object.entries(rights)
          .filter(([, permission]) => permission.can_read)
          .map(([name]) => name)
      );
      where.push(`${source.sql}.required_entities <@ $${values.length}::text[]`);
    }
  for (const filter of definition.filters) {
    const column = resolve(filter);
    if (filter.op === 'isnull' || filter.op === 'notnull') {
      where.push(`${column} IS ${filter.op === 'notnull' ? 'NOT ' : ''}NULL`);
      continue;
    }
    if (filter.value == null)
      throw httpError(400, 'Bitte einen Filterwert eingeben oder „ist leer“ verwenden.');
    const source = aliases.get(filter.alias)!;
    const metadata = fields(source.entity).find((f) => f.name === filter.field);
    let value: unknown = filter.value;
    if (filter.op !== 'contains' && metadata?.type === 'number') {
      value = String(value).trim();
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value)) ||
        !Number.isFinite(Number(value))
      )
        throw httpError(400, 'Der Zahlenfilter ist ungültig.');
    }
    if (filter.op !== 'contains' && metadata?.type === 'boolean') {
      if (!['true', 'false'].includes(String(value)))
        throw httpError(400, 'Bitte true oder false eingeben.');
      value = String(value) === 'true';
    }
    if (filter.op !== 'contains' && metadata?.type === 'date') z.iso.date().parse(value);
    if (filter.op === 'contains') {
      value = '%' + String(value).replace(/[\\%_]/g, '\\$&') + '%';
      values.push(value);
      where.push(`${column}::text ILIKE $${values.length} ESCAPE '\\'`);
    } else {
      values.push(value);
      const operators = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      where.push(`${column} ${operators[filter.op]} $${values.length}`);
    }
  }
  const keys = definition.fields.map((f) => f.alias + '.' + f.field);
  if (new Set(keys).size !== keys.length)
    throw httpError(400, 'Ein Feld kann nur einmal ausgewählt werden.');
  for (const selected of definition.fields) resolve(selected);
  let select = options.rootRows
    ? 't0.*'
    : definition.fields.map((f) => `${resolve(f)} AS "${f.alias}.${f.field}"`).join(',');
  // Identity metadata is independent of selected display columns. All aliases
  // have already passed the entity permission and reference validation above.
  if (options.includeRecordRefs && !options.rootRows) {
    const records = [...aliases.entries()]
      .map(
        ([name, source]) =>
          `'${name}',CASE WHEN ${source.sql}.id IS NULL THEN NULL ELSE jsonb_build_object('entity','${source.entity}','objectId',${source.sql}."objectId",'id',${source.sql}.id) END`
      )
      .join(',');
    select += `,jsonb_build_object(${records}) AS "__record_refs"`;
  }
  const order = definition.order.map(
    (f) => `${resolve(f)} ${f.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
  );
  order.push('t0."objectId" ASC');
  return {
    definition,
    values,
    columns: keys,
    sourceSql: `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')}`,
    fieldTypes: Object.fromEntries(
      definition.fields.map((item) => [
        item.alias + '.' + item.field,
        fields(aliases.get(item.alias)!.entity).find((candidate) => candidate.name === item.field)
          ?.type || 'text',
      ])
    ),
    sql: `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order.join(',')} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    countSql: `SELECT count(*)::int AS total FROM ${from} WHERE ${where.join(' AND ')}`,
  };
}
