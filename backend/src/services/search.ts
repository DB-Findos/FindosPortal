import { z } from 'zod';
import { definitions, entityName, fields, type Entity } from '../entities.js';
import { auditColumns } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';

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
export function compileSearch(input: unknown, rights: Record<string, { can_read?: boolean }>) {
  const definition = searchDefinition.parse(input);
  const aliases = new Map<string, { entity: Entity; sql: string }>();
  const authorize = (entity: Entity) => {
    if (entity === 'search_views' || !rights[entity]?.can_read)
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
    from += ` ${join.type === 'inner' ? 'INNER' : 'LEFT'} JOIN portal.${target} ${sql} ON ${parent.sql}."${join.field}"=${sql}."objectId" AND ${sql}."archivedAt" IS NULL`;
  }
  const resolve = (item: { alias: string; field: string }) => {
    const source = aliases.get(item.alias);
    if (!source || !searchFields(source.entity).includes(item.field))
      throw httpError(400, 'Unbekanntes oder gesperrtes Feld: ' + item.alias + '.' + item.field);
    return `${source.sql}."${item.field}"`;
  };
  const values: unknown[] = [];
  const where = ['t0."archivedAt" IS NULL'];
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
  const select = definition.fields.map((f, i) => `${resolve(f)} AS "${keys[i]}"`).join(',');
  const order = definition.order.map(
    (f) => `${resolve(f)} ${f.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
  );
  order.push('t0."objectId" ASC');
  return {
    definition,
    values,
    columns: keys,
    sql: `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order.join(',')} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    countSql: `SELECT count(*)::int AS total FROM ${from} WHERE ${where.join(' AND ')}`,
  };
}
