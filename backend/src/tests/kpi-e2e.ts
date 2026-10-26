import '../config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
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
try {
  const login = await request('/auth/login', 'POST', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  headers.Cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  const catalog = (await request('/kpi/catalog')).data;
  assert.ok(catalog.metrics.length > 0 && catalog.companies.length > 0);
  const reports = (await request('/kpi/reports')).data,
    report = reports.find((r: any) => r.name === 'Standardreporting · Performance');
  assert.ok(report);
  const source = (
    await pool.query(
      `SELECT d.company_id,to_char(d.period,'YYYY-MM-DD') AS period,d.value::text AS value FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL WHERE d."archivedAt" IS NULL AND m.metric_number=1000000 AND d.dimension='actual' AND d.value IS NOT NULL AND d.value<>0 AND (SELECT count(*) FROM portal.metrics x WHERE x.company_id=d.company_id AND x.metric_number=1000000 AND x."archivedAt" IS NULL)=1 ORDER BY d.period DESC LIMIT 1`
    )
  ).rows[0];
  assert.ok(source);
  const context = { company_id: source.company_id, date: source.period, dimension: 'actual' };
  const result = (await request(`/kpi/reports/${report.objectId}/run`, 'POST', context)).data;
  const revenue = result.results.find((r: any) => r.name === 'Umsatz · Monat');
  assert.equal(revenue.status, 'ok');
  assert.equal(Number(revenue.value), Number(source.value));
  assert.equal(result.results.length, 7);
  console.log(
    `PASS HTTP: authenticated report with 7 KPIs; Revenue ${revenue.value} matches database value at ${source.period}`
  );
  let created: any, customReport: any;
  const body = {
    name: 'E2E KPI ' + randomUUID(),
    TextEditor: '( A + 1 ) ^ 2',
    variables: [
      {
        identifier: 'A',
        entity: 'metric_data',
        field: 'value',
        aggregation: 'MONTH',
        metric_number: 1000000,
      },
    ],
  };
  try {
    created = (await request('/kpi/formulas', 'POST', body, 201)).data;
    assert.ok(created.TextDisplay.includes('MetricData:'));
    assert.equal(created.variables[0].formula_version_id, created.id);
    const duplicate = (await request('/kpi/formulas', 'POST', body, 409)).data;
    assert.ok(duplicate.fieldErrors.name);
    const malformed = (
      await request('/kpi/formulas', 'POST', { ...body, name: 'Bad', TextEditor: '( A +' }, 400)
    ).data;
    assert.ok(malformed.fieldErrors.TextEditor);
    const old = created.id;
    created = (
      await request(
        '/kpi/formulas/' + created.objectId,
        'PATCH',
        { ...body, TextEditor: 'A * 2' },
        200,
        old
      )
    ).data;
    await request('/kpi/formulas/' + created.objectId, 'PATCH', body, 409, old);
    customReport = (
      await request(
        '/kpi/reports',
        'POST',
        { name: 'E2E report ' + randomUUID(), kpi_ids: [created.objectId] },
        201
      )
    ).data;
    const custom = (await request(`/kpi/reports/${customReport.objectId}/run`, 'POST', context))
      .data;
    assert.equal(Number(custom.results[0].value), Number(source.value) * 2);
    await request('/kpi/formulas/' + created.objectId, 'DELETE', undefined, 409, created.id);
    const savedAgain = (await request('/kpi/formulas/' + created.objectId)).data;
    assert.equal(savedAgain.variables.length, 1);
    assert.equal(savedAgain.variables[0].archivedAt, null);
    await request('/data/kpi_formulas', 'POST', body, 403);
    console.log(
      'PASS HTTP: formula create/edit/version locking, field errors, report run, reference protection with transaction rollback, generic-write protection'
    );
  } finally {
    if (customReport)
      await request(
        '/kpi/reports/' + customReport.objectId,
        'DELETE',
        undefined,
        204,
        customReport.id
      );
    if (created)
      await request('/kpi/formulas/' + created.objectId, 'DELETE', undefined, 204, created.id);
  }
  console.log('PASS KPI end-to-end tests; test definitions archived');
} finally {
  await pool.end();
}
