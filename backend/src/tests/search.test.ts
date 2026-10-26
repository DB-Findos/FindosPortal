import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSearch } from '../services/search.js';
const rights = {
  metric_data: { can_read: true },
  metrics: { can_read: true },
  companies: { can_read: true },
  funds: { can_read: true },
  users: { can_read: true },
};
const base = {
  entity: 'metric_data',
  joins: [],
  fields: [{ alias: 'root', field: 'dimension' }],
  filters: [],
  order: [],
};
test('search builds reference-based INNER and LEFT JOINs using active logical IDs', () => {
  const compiled = compileSearch(
    {
      ...base,
      joins: [
        { alias: 'metric', from: 'root', field: 'metric_id', type: 'inner' },
        { alias: 'company', from: 'metric', field: 'company_id', type: 'left' },
        { alias: 'fund', from: 'company', field: 'fund_id', type: 'inner' },
      ],
      fields: [
        { alias: 'fund', field: 'name' },
        { alias: 'root', field: 'value' },
      ],
    },
    rights
  );
  assert.match(compiled.sql, /INNER JOIN portal.metrics/);
  assert.match(compiled.sql, /LEFT JOIN portal.companies/);
  assert.match(compiled.sql, /INNER JOIN portal.funds/);
  assert.match(compiled.sql, /t0\."metric_id"=t1\."objectId"/);
  assert.match(compiled.sql, /t3\."archivedAt" IS NULL/);
});
test('search requires permission on every joined entity, even if its fields are not selected', () => {
  assert.throws(
    () =>
      compileSearch(
        {
          ...base,
          joins: [{ alias: 'company', from: 'root', field: 'company_id', type: 'inner' }],
        },
        { metric_data: { can_read: true } }
      ),
    /Leseberechtigung/
  );
});
test('search rejects arbitrary fields, joins, secret columns and duplicate aliases', () => {
  assert.throws(
    () =>
      compileSearch(
        { ...base, fields: [{ alias: 'root', field: 'value";DROP TABLE portal.metrics;--' }] },
        rights
      ),
    /gesperrtes Feld/
  );
  assert.throws(
    () =>
      compileSearch(
        { ...base, joins: [{ alias: 'metric', from: 'root', field: 'value', type: 'inner' }] },
        rights
      ),
    /Referenzfelder/
  );
  assert.throws(
    () =>
      compileSearch(
        { entity: 'users', fields: [{ alias: 'root', field: 'password_hash' }] },
        rights
      ),
    /gesperrtes Feld/
  );
  assert.throws(
    () =>
      compileSearch(
        { ...base, joins: [{ alias: 'root', from: 'root', field: 'metric_id', type: 'inner' }] },
        rights
      ),
    /Alias bereits/
  );
});
test('filter values are parameterized and exact numeric strings keep their precision', () => {
  const attack = "' OR true; --";
  const text = compileSearch(
    { ...base, filters: [{ alias: 'root', field: 'name', op: 'contains', value: attack }] },
    rights
  );
  assert.equal(text.sql.includes(attack), false);
  assert.equal(text.values[0], '%' + attack + '%');
  const numeric = compileSearch(
    {
      ...base,
      filters: [{ alias: 'root', field: 'value', op: 'gte', value: '12345678901234.12345678' }],
    },
    rights
  );
  assert.equal(numeric.values[0], '12345678901234.12345678');
  assert.throws(
    () =>
      compileSearch(
        { ...base, filters: [{ alias: 'root', field: 'value', op: 'gte', value: '' }] },
        rights
      ),
    /Zahlenfilter/
  );
});
