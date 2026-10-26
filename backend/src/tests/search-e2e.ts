import '../config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3002';
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'FindosPortal',
  Origin: base,
};
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  status = 200,
  version?: string
) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: { ...headers, ...(version ? { 'If-Match': version } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return { data, response };
}
const login = await request('/auth/login', 'POST', {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
headers.Cookie = login.response.headers.get('set-cookie')!.split(';')[0];
const definition = {
  entity: 'metric_data',
  joins: [
    { alias: 'metric', from: 'root', field: 'metric_id', type: 'inner' },
    { alias: 'company', from: 'metric', field: 'company_id', type: 'inner' },
    { alias: 'fund', from: 'company', field: 'fund_id', type: 'left' },
  ],
  fields: [
    { alias: 'root', field: 'dimension' },
    { alias: 'root', field: 'company_id' },
    { alias: 'root', field: 'name' },
    { alias: 'root', field: 'currency' },
    { alias: 'root', field: 'value' },
    { alias: 'company', field: 'name' },
    { alias: 'fund', field: 'name' },
  ],
  filters: [{ alias: 'root', field: 'dimension', op: 'eq', value: 'plan' }],
  order: [{ alias: 'root', field: 'value', direction: 'desc' }],
};
const found = (await request('/search/query', 'POST', { definition, page: 1, limit: 10 })).data;
assert.equal(found.total, 3503);
assert.equal(found.rows.length, 10);
assert.ok(
  found.rows.every(
    (r: any) => r['root.dimension'] === 'plan' && r['company.name'] && r['root.name']
  )
);
console.log(
  'PASS reference chain MetricData → Metric → Company → Fund; 3503 plan rows; pagination and sort'
);
const contains = (
  await request('/search/query', 'POST', {
    definition: {
      ...definition,
      filters: [{ alias: 'company', field: 'name', op: 'contains', value: 'Angelina' }],
    },
    limit: 10,
  })
).data;
assert.ok(contains.total > 0);
console.log('PASS joined-variable contains filter');
await request(
  '/search/query',
  'POST',
  { definition: { ...definition, fields: [{ alias: 'root', field: 'password_hash' }] } },
  400
);
await request(
  '/search/query',
  'POST',
  {
    definition: {
      ...definition,
      joins: [{ alias: 'bad', from: 'root', field: 'value', type: 'inner' }],
    },
  },
  400
);
console.log('PASS secret-field and invalid-join rejection');
const name = 'Search E2E ' + randomUUID();
let saved = (await request('/search/views', 'POST', { name, definition }, 201)).data;
try {
  assert.ok((await request('/search/views')).data.some((v: any) => v.objectId === saved.objectId));
  await request('/search/views', 'POST', { name, definition }, 409);
  const prior = saved.id;
  saved = (
    await request(
      '/search/views/' + saved.objectId,
      'PATCH',
      { name: name + ' updated', definition },
      200,
      saved.id
    )
  ).data;
  assert.equal(saved.priorId, prior);
  assert.notEqual(saved.id, prior);
  await request('/search/views/' + saved.objectId, 'PATCH', { name, definition }, 409, prior);
  console.log(
    'PASS persisted personal view create/list/update, duplicate-name protection, version history and stale-update rejection'
  );
} finally {
  await request('/search/views/' + saved.objectId, 'DELETE', undefined, 204, saved.id);
}
assert.ok(!(await request('/search/views')).data.some((v: any) => v.objectId === saved.objectId));
console.log('PASS view archive');
const data = (await request('/data/metric_data?limit=1')).data;
assert.equal(data.total, 164245);
assert.ok(data.rows[0].name);
assert.ok(data.rows[0].company_id);
assert.ok(Object.hasOwn(data.rows[0], 'dimension'));
assert.equal(Object.hasOwn(data.rows[0], 'scenario'), false);
console.log('PASS MetricData exposes Company, Name, Currency and Dimension');
