import '../config.js';
import assert from 'node:assert/strict';
import { pool } from '../db.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
let cookie = '';
async function request(path: string, body?: unknown) {
  const response = await fetch(base + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'FindosPortal',
      Origin: base,
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  if (path === '/auth/login') cookie = response.headers.get('set-cookie')!.split(';')[0];
  return data;
}
try {
  assert.equal((await request('/health')).database, 'connected');
  await request('/auth/login', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const catalog = await request('/kpi/catalog');
  assert.ok(catalog.metrics.length && catalog.companies.length);
  const report = (await request('/kpi/reports')).find(
    (r: any) => r.name === 'Standardreporting · Performance'
  );
  assert.ok(report);
  const source = (
    await pool.query(
      `SELECT d.company_id,to_char(d.period,'YYYY-MM-DD') AS period,d.value::text AS value FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL WHERE d."archivedAt" IS NULL AND m.metric_number=1000000 AND d.dimension='actual' AND d.value IS NOT NULL AND d.value<>0 AND (SELECT count(*) FROM portal.metrics x WHERE x.company_id=d.company_id AND x.metric_number=1000000 AND x."archivedAt" IS NULL)=1 ORDER BY d.period DESC LIMIT 1`
    )
  ).rows[0];
  const result = await request(`/kpi/reports/${report.objectId}/run`, {
    company_id: source.company_id,
    date: source.period,
    dimension: 'actual',
  });
  assert.equal(result.results.length, 7);
  const revenue = result.results.find((r: any) => r.name === 'Umsatz · Monat');
  assert.equal(revenue.status, 'ok');
  assert.equal(Number(revenue.value), Number(source.value));
  console.log('PASS production: health, login, catalog and Standardreporting with 7 KPIs');
  console.log(
    `PASS production: monthly Revenue ${revenue.value} equals PostgreSQL source at ${source.period}`
  );
  console.log(
    'Report statuses: ' + result.results.map((r: any) => `${r.name}=${r.status}`).join('; ')
  );
  for (const route of ['/', '/settings/kpis']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="root"/);
  }
  console.log(
    'PASS production: reporting and settings BrowserRouter routes serve the built frontend'
  );
} finally {
  await pool.end();
}
