import type { Entity } from './api';
export type SearchField = { alias: string; field: string };
export type SearchJoin = { alias: string; from: string; field: string; type: 'inner' | 'left' };
export type SearchFilter = SearchField & {
  op: 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'isnull' | 'notnull';
  value?: string | number | boolean | null;
};
export type SearchDefinition = {
  entity: string;
  joins: SearchJoin[];
  fields: SearchField[];
  filters: SearchFilter[];
  order: (SearchField & { direction: 'asc' | 'desc' })[];
};
export type SearchSource = { alias: string; entity: Entity };
export type SearchResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
};
export type SearchView = {
  id: string;
  objectId: string;
  name: string;
  definition: SearchDefinition;
};
export function getSources(definition: SearchDefinition, entities: Entity[]): SearchSource[] {
  const base = entities.find((e) => e.name === definition.entity);
  if (!base) return [];
  const result = [{ alias: 'root', entity: base }];
  for (const join of definition.joins) {
    const parent = result.find((s) => s.alias === join.from);
    const reference = parent?.entity.fields.find((f) => f.name === join.field)?.reference;
    const entity = entities.find((e) => e.name === reference);
    if (entity) result.push({ alias: join.alias, entity });
  }
  return result;
}
export const availableFields = (source: SearchSource) =>
  ['id', ...source.entity.fields.map((f) => f.name), ...source.entity.auditFields].filter(
    (f) => !['password', 'password_hash', 'data_base64', 'definition'].includes(f)
  );
