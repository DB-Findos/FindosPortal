import '../config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { definitions } from '../entities.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const suffix = randomUUID().slice(0, 8),
  password = 'Test-' + randomUUID();
const versions = new Map<string, any>(),
  created: { entity: string; objectId: string }[] = [];
let cookie = '',
  originalDesign: any,
  designChanged = false;
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  expected = 200,
  auth = cookie,
  version?: string
) {
  const objectId = path.split('/').at(-1)!;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'FindosPortal',
    Origin: base,
    Cookie: auth,
  };
  if (version || (['PATCH', 'DELETE'].includes(method) && versions.has(objectId)))
    headers['If-Match'] = version || versions.get(objectId).id;
  const response = await fetch(base + '/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  if (response.ok && data?.objectId && data?.createdAt) versions.set(data.objectId, data);
  return { data, setCookie: response.headers.get('set-cookie') || '' };
}
async function create(entity: string, data: unknown) {
  const row = (await request('/data/' + entity, 'POST', data, 201)).data;
  created.push({ entity, objectId: row.objectId });
  return row;
}
async function list(entity: string) {
  let rows: any[] = [];
  for (let page = 1; ; page++) {
    const data = (await request(`/data/${entity}?limit=100&page=${page}`)).data;
    rows.push(...data.rows);
    if (rows.length >= data.total) break;
  }
  for (const row of rows) versions.set(row.objectId, row);
  return rows;
}
try {
  assert.equal((await request('/health')).data.database, 'connected');
  await request('/data/funds', 'GET', undefined, 401, '');
  await request(
    '/auth/login',
    'POST',
    { email: process.env.ADMIN_EMAIL, password: 'incorrect' },
    401,
    ''
  );
  const login = await request(
    '/auth/login',
    'POST',
    { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
    200,
    ''
  );
  cookie = login.setCookie.split(';')[0];
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Strict/);
  const me = (await request('/auth/me')).data,
    catalog = (await request('/entities')).data;
  assert.equal(
    catalog.length,
    Object.keys(definitions).filter((name) => name !== 'search_views').length
  );
  for (const entity of catalog) assert.equal(entity.auditFields.length, 7);
  console.log(
    `PASS authentication, HttpOnly JWT, ${catalog.length} entity schemas and version metadata`
  );
  const fund = await create('funds', { name: 'E2E Fund ' + suffix, currency: 'EUR' });
  for (const field of ['id', 'objectId', 'createdAt', 'lastModifiedAt', 'createdBy', 'modifiedBy'])
    assert.ok(fund[field]);
  assert.equal(fund.priorId, null);
  assert.equal(fund.archivedAt, null);
  assert.equal(fund.createdBy, me.id);
  const company = await create('companies', {
    name: 'E2E Company ' + suffix,
    internal_name: suffix,
    fund_id: fund.objectId,
  });
  const changed = (
    await request('/data/funds/' + fund.objectId, 'PATCH', { description: 'Version two' })
  ).data;
  assert.notEqual(changed.id, fund.id);
  assert.equal(changed.objectId, fund.objectId);
  assert.equal(changed.priorId, fund.id);
  assert.equal(changed.createdAt, fund.createdAt);
  assert.equal(changed.createdBy, fund.createdBy);
  assert.equal(changed.modifiedBy, me.id);
  await request(
    '/data/funds/' + fund.objectId,
    'PATCH',
    { description: 'Stale' },
    409,
    cookie,
    fund.id
  );
  const history = (await request('/data/funds/' + fund.objectId + '/history')).data.rows;
  assert.equal(history.length, 2);
  assert.ok(history.find((r: any) => r.id === fund.id).archivedAt);
  assert.equal(history.find((r: any) => r.id === fund.id).description, null);
  assert.equal(
    (await list('companies')).find((r) => r.objectId === company.objectId).fund_id,
    fund.objectId
  );
  await request('/data/funds/' + fund.objectId, 'DELETE', undefined, 409);
  const simultaneous = await Promise.all(
    ['Concurrent A', 'Concurrent B'].map((description) =>
      fetch(base + '/api/data/funds/' + fund.objectId, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'FindosPortal',
          Origin: base,
          Cookie: cookie,
          'If-Match': changed.id,
        },
        body: JSON.stringify({ description }),
      })
    )
  );
  assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 409]);
  const winner = await simultaneous.find((response) => response.status === 200)!.json();
  versions.set(winner.objectId, winner);
  assert.equal((await request('/data/funds/' + fund.objectId + '/history')).data.rows.length, 3);
  console.log(
    'PASS immutable versions, stable identity/audit fields, priorId/history, concurrent-edit conflict and stable references'
  );
  const metric = await create('metrics', {
    company_id: company.objectId,
    name: 'Revenue ' + suffix,
    unit: '000',
    metric_number: 100,
    important: true,
    currency: 'EUR',
  });
  const metricData = await create('metric_data', {
    metric_id: metric.objectId,
    period: '2026-01-01',
    value: 123.45,
    dimension: 'actual',
  });
  const m2 = (await request('/data/metrics/' + metric.objectId, 'PATCH', { unit: 'EUR' })).data;
  assert.equal(m2.important, true);
  const md2 = (
    await request('/data/metric_data/' + metricData.objectId, 'PATCH', { value: 456.78 })
  ).data;
  assert.equal(md2.period, '2026-01-01');
  assert.equal(Number(md2.value), 456.78);
  const rate = await create('index_rates', {
    name: 'E2E Rate ' + suffix,
    as_of_date: '2099-12-31',
    period: '2099-12-01',
    base_currency: 'XTS',
    currency: 'EUR',
    index_value: 1.2345678901,
  });
  assert.equal(rate.as_of_date, '2099-12-31');
  assert.equal(Number(rate.index_value), 1.2345678901);
  const entryType = (await list('deal_types')).find((row) => row.name === 'Entry');
  assert.ok(entryType);
  const dealData = await create('deal_data', {
    name: 'E2E Deal ' + suffix,
    company_id: company.objectId,
    deal_type_id: entryType.objectId,
    deal_date: '2026-01-01',
    revenue_ltm: 1234.5,
    ebitda_ltm: 123.4,
    data_currency: 'EUR',
  });
  assert.equal(dealData.company_id, company.objectId);
  assert.equal(dealData.deal_type_id, entryType.objectId);
  assert.equal(Number(dealData.revenue_ltm), 1234.5);
  console.log(
    'PASS Fund/Company/Metric/MetricData, IndexRates and DealData through versioned CRUD'
  );
  const contact = await create('contacts', {
    first_name: 'E2E',
    last_name: suffix,
    email: `e2e-${suffix}@example.invalid`,
  });
  const user = await create('users', {
    email: `e2e-${suffix}@example.invalid`,
    password,
    contact_id: contact.objectId,
  });
  assert.ok(!('password_hash' in user));
  const group = await create('user_groups', { name: 'E2E ' + suffix });
  await create('user_group_memberships', { user_id: user.objectId, group_id: group.objectId });
  const otherLogin = await request('/auth/login', 'POST', { email: user.email, password }, 200, '');
  const otherCookie = otherLogin.setCookie.split(';')[0];
  await request('/data/funds', 'GET', undefined, 403, otherCookie);
  await request('/data/images', 'GET', undefined, 403, otherCookie);
  const perms = (await list('permissions')).filter((r) => r.group_id === group.objectId);
  assert.equal(perms.length, (await list('entities')).length);
  const fundEntity = (await list('entities')).find((r) => r.name === 'funds');
  const perm = perms.find((r) => r.entity_id === fundEntity.objectId);
  await request('/data/permissions/' + perm.objectId, 'PATCH', { can_read: true });
  await request('/data/funds', 'GET', undefined, 200, otherCookie);
  await request('/data/funds', 'POST', { name: 'Denied' }, 403, otherCookie);
  const g2 = (
    await request('/data/user_groups/' + group.objectId, 'PATCH', { description: 'Updated group' })
  ).data;
  assert.notEqual(g2.id, group.id);
  await request('/data/funds', 'GET', undefined, 200, otherCookie);
  await request('/data/users/' + user.objectId, 'PATCH', { active: false });
  await request('/auth/me', 'GET', undefined, 401, otherCookie);
  const userHistory = (await request('/data/users/' + user.objectId + '/history')).data.rows;
  assert.ok(userHistory.every((r: any) => !('password_hash' in r)));
  console.log(
    'PASS current-version authorization, versioned groups/permissions/users, disabled-account JWT rejection and secret-free history'
  );
  originalDesign = (await request('/design')).data;
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const upload = { name: 'e2e.png', mime_type: 'image/png', data_base64: png };
  const d1 = (
    await request(
      '/design',
      'PUT',
      { colors: { ...originalDesign.colors, primary: '#123456' }, logo: upload },
      200,
      cookie,
      originalDesign.id || 'new'
    )
  ).data;
  designChanged = true;
  assert.equal(d1.colors.primary, '#123456');
  assert.equal(d1.logo.data_base64, png);
  const d2 = (
    await request(
      '/design',
      'PUT',
      { colors: d1.colors, logo: { ...upload, name: 'e2e-v2.png' } },
      200,
      cookie,
      d1.id
    )
  ).data;
  assert.equal(d2.logo.objectId, d1.logo.objectId);
  assert.notEqual(d2.logo.id, d1.logo.id);
  const imageHistory = (await request('/data/images/' + d1.logo.objectId + '/history')).data.rows;
  assert.ok(imageHistory.length >= 2);
  assert.equal(imageHistory.find((r: any) => r.id === d2.logo.id)?.priorId, d1.logo.id);
  assert.ok(imageHistory.some((r: any) => r.id === d1.logo.id && r.archivedAt));
  await request('/design', 'PUT', { colors: d1.colors }, 409, cookie, d1.id);
  await request(
    '/design',
    'PUT',
    { colors: d2.colors, logo: { name: 'bad.svg', mime_type: 'image/svg+xml', data_base64: png } },
    400,
    cookie,
    d2.id
  );
  await request('/design', 'PUT', { colors: d2.colors }, 401, otherCookie, d2.id);
  console.log(
    'PASS six-color design persistence, Base64 Images, logo version chain, invalid image rejection and optimistic design concurrency'
  );
  const currentDesign = (await request('/design')).data;
  await request(
    '/design',
    'PUT',
    {
      colors: originalDesign.colors,
      logo: originalDesign.logo
        ? {
            name: originalDesign.logo.name,
            mime_type: originalDesign.logo.mime_type,
            data_base64: originalDesign.logo.data_base64,
          }
        : null,
    },
    200,
    cookie,
    currentDesign.id
  );
  designChanged = false;
  for (const route of [
    '/',
    '/settings/design',
    '/settings/data/metrics',
    '/settings/users/groups',
    '/settings/search',
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Findos Portal/);
  }
  console.log('PASS BrowserRouter deep links and built frontend');
} finally {
  if (designChanged && originalDesign) {
    const current = (await request('/design')).data;
    await request(
      '/design',
      'PUT',
      {
        colors: originalDesign.colors,
        logo: originalDesign.logo
          ? {
              name: originalDesign.logo.name,
              mime_type: originalDesign.logo.mime_type,
              data_base64: originalDesign.logo.data_base64,
            }
          : null,
      },
      200,
      cookie,
      current.id
    );
  }
  for (const row of created.reverse())
    await request('/data/' + row.entity + '/' + row.objectId, 'DELETE', undefined, 204);
  console.log('CLEANUP temporary objects archived; their immutable audit history retained.');
}
console.log('All end-to-end checks passed.');
