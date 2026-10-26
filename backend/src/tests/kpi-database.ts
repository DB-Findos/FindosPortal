import '../config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { definitions } from '../entities.js';
import { beginAuditedImport } from '../services/imports.js';
import { createRecord, updateRecord, archiveRecord } from '../repositories/entities.js';
import { prepareFormula, saveFormula, formulaWithVariables } from '../services/kpi-definitions.js';
import { saveReport, reportWithItems } from '../services/kpi-reports.js';
import { KpiEngine } from '../services/kpi-engine.js';
import { formulaInput } from '../services/kpi-schema.js';

const client = await pool.connect();
const rights = Object.fromEntries(
  Object.keys(definitions).map((name) => [
    name,
    { can_read: true, can_create: true, can_update: true, can_delete: true },
  ])
);
const tag = randomUUID(),
  metricNumber = 2147400001;
const metricVariable = (identifier = 'A', aggregation = 'MONTH', prior_year = false) => ({
  identifier,
  entity: 'metric_data',
  field: 'value',
  aggregation,
  prior_year,
  metric_number: metricNumber,
});
try {
  await client.query('BEGIN');
  await beginAuditedImport(client);
  const fund = await createRecord(client, 'funds', { name: 'KPI test ' + tag, currency: 'EUR' });
  const company = await createRecord(client, 'companies', {
    name: 'KPI test ' + tag,
    fund_id: fund.objectId,
  });
  const metric = await createRecord(client, 'metrics', {
    name: 'Revenue test ' + tag,
    company_id: company.objectId,
    metric_number: metricNumber,
    unit: 'EUR',
    currency: 'EUR',
  });
  const rows = [];
  for (let i = 0; i < 36; i++) {
    const date = new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 10);
    rows.push(
      await createRecord(client, 'metric_data', {
        metric_id: metric.objectId,
        period: date,
        value: String(i + 1),
        dimension: 'actual',
      })
    );
  }
  await createRecord(client, 'metric_data', {
    metric_id: metric.objectId,
    period: '2025-03-01',
    value: '100',
    dimension: 'budget',
  });
  const context = {
    company_id: company.objectId,
    date: '2025-03-31',
    dimension: 'actual' as const,
  };
  async function evaluate(
    variables: unknown[],
    TextEditor = 'A',
    date = context.date,
    customRights = rights
  ) {
    const prepared = await prepareFormula(
      client,
      { name: 'Preview', TextEditor, variables },
      customRights
    );
    return new KpiEngine(client, customRights, { ...context, date }).evaluate({
      ...prepared.data,
      variables: prepared.variables,
    });
  }
  assert.equal((await evaluate([metricVariable()])).value, '27');
  assert.equal((await evaluate([metricVariable('A', 'LTM')])).value, '258'); // months 16..27
  assert.equal((await evaluate([metricVariable('A', 'YTD')])).value, '78'); // 25+26+27
  assert.equal((await evaluate([metricVariable('A', 'MONTH', true)])).value, '15');
  assert.equal((await evaluate([metricVariable('A', 'LTM', true)])).value, '114'); // 4..15
  assert.equal((await evaluate([metricVariable('A', 'YTD', true)])).value, '42');
  assert.equal((await evaluate([{ ...metricVariable(), dimension: 'budget' }])).value, '100');
  console.log(
    'PASS DB: MONTH=27, LTM=258, YTD=78; V12P=15, LTM+V12P=114, YTD+V12P=42; dimension override=100'
  );
  const fixed = {
    identifier: 'B',
    entity: 'metrics',
    field: 'metric_number',
    aggregation: 'FIXED',
    record_id: metric.objectId,
  };
  assert.equal((await evaluate([fixed], 'B', '2020-01-01')).value, String(metricNumber));
  assert.equal((await evaluate([fixed], 'B', '2025-01-01')).value, String(metricNumber));
  assert.equal((await evaluate([metricVariable()], 'A / 0')).status, 'error');
  assert.equal((await evaluate([metricVariable()], 'A', '2020-01-01')).status, 'missing');
  await updateRecord(client, 'metric_data', rows[26].objectId, rows[26].id, { value: null });
  assert.equal((await evaluate([metricVariable()])).status, 'missing');
  const latest = (
    await client.query(
      'SELECT * FROM portal.metric_data WHERE "objectId"=$1 AND "archivedAt" IS NULL',
      [rows[26].objectId]
    )
  ).rows[0];
  await updateRecord(client, 'metric_data', latest.objectId, latest.id, { value: 0 });
  assert.equal((await evaluate([metricVariable()])).value, '0');
  await createRecord(client, 'metric_data', {
    metric_id: metric.objectId,
    period: '2025-03-15',
    value: '99',
    dimension: 'actual',
  });
  assert.match((await evaluate([metricVariable()])).message!, /Mehrere Werte/);
  console.log(
    'PASS DB: fixed values ignore report date; missing/null/zero/division-by-zero and duplicate monthly values distinguished'
  );
  const input = formulaInput.parse({
    name: 'KPI version ' + tag,
    TextEditor: 'A',
    variables: [fixed && { ...fixed, identifier: 'A' }],
  });
  let saved = await saveFormula(client, input, rights);
  const old = saved;
  saved = await saveFormula(
    client,
    { ...input, TextEditor: 'A + 1' },
    rights,
    saved.objectId,
    saved.id
  );
  assert.equal(saved.priorId, old.id);
  assert.equal(saved.variables[0].priorId, old.variables[0].id);
  assert.equal(saved.variables[0].formula_version_id, saved.id);
  assert.equal(
    (await client.query('SELECT * FROM portal.variable_map WHERE formula_version_id=$1', [old.id]))
      .rows[0].id,
    old.variables[0].id
  );
  await assert.rejects(
    () => saveFormula(client, input, rights, saved.objectId, old.id),
    /inzwischen geändert/
  );
  const nestedInput = formulaInput.parse({
    name: 'Nested ' + tag,
    TextEditor: 'A * 2',
    variables: [
      {
        identifier: 'A',
        entity: 'kpi_formulas',
        field: 'result',
        aggregation: 'KPI',
        target_kpi_id: saved.objectId,
      },
    ],
  });
  const nested = await saveFormula(client, nestedInput, rights);
  for (const bad of [
    {
      ...input.variables[0],
      formula_id: nested.objectId,
      formula_version_id: saved.id,
      name: 'Wrong version',
    },
    {
      ...input.variables[0],
      entity: 'index_rates',
      formula_id: saved.objectId,
      formula_version_id: saved.id,
      name: 'Wrong entity',
    },
    {
      ...input.variables[0],
      prior_year: true,
      formula_id: saved.objectId,
      formula_version_id: saved.id,
      name: 'Invalid aggregation',
    },
  ]) {
    await client.query('SAVEPOINT bad_mapping');
    await assert.rejects(
      () => createRecord(client, 'variable_map', { ...bad, identifier: 'Z' }),
      (error: any) => ['23503', '23514'].includes(error.code)
    );
    await client.query('ROLLBACK TO SAVEPOINT bad_mapping');
  }
  console.log(
    'PASS DB: foreign keys enforce exact formula version, fixed-source entity and aggregation shape'
  );
  assert.equal(
    (await new KpiEngine(client, rights, context).evaluateId(nested.objectId)).value,
    String((metricNumber + 1) * 2)
  );
  await assert.rejects(
    () =>
      saveFormula(
        client,
        { ...input, variables: [{ ...nestedInput.variables[0], target_kpi_id: nested.objectId }] },
        rights,
        saved.objectId,
        saved.id
      ),
    /Zirkuläre/
  );
  await assert.rejects(
    () =>
      prepareFormula(
        client,
        { ...input, variables: [{ ...input.variables[0], field: 'password_hash' }] },
        rights
      ),
    /numerisches Feld/
  );
  const restricted = { ...rights, metrics: { can_read: false } };
  assert.equal(
    (await new KpiEngine(client, restricted, context).evaluateId(nested.objectId)).status,
    'forbidden'
  );
  const forbidden = await new KpiEngine(client, restricted, context).evaluate(
    await formulaWithVariables(client, saved.objectId)
  );
  assert.equal(forbidden.variables.length, 0);
  console.log(
    'PASS DB: formula/VariableMap immutable versions, stale updates rejected, nested KPI calculation, cycle rejection and source permissions'
  );
  let report = await saveReport(
    client,
    { name: 'Test report ' + tag, kpi_ids: [saved.objectId, nested.objectId] },
    rights
  );
  const original = report;
  report = await saveReport(
    client,
    { name: report.name, kpi_ids: [nested.objectId, saved.objectId] },
    rights,
    report.objectId,
    report.id
  );
  assert.equal(report.priorId, original.id);
  assert.deepEqual((await reportWithItems(client, report.objectId)).kpi_ids, [
    nested.objectId,
    saved.objectId,
  ]);
  await assert.rejects(
    () => archiveRecord(client, 'kpi_formulas', saved.objectId, saved.id),
    /verwendet/
  );
  // archiveRecord must be used inside a transaction/savepoint when a reference rejects deletion.
  console.log(
    'PASS DB: reports and ordered KPI references are versioned; referenced formulas cannot be archived'
  );
  await client.query('ROLLBACK');
  console.log('PASS all KPI database tests; fixtures rolled back');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
