import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitions, fields } from '../entities.js';

const base = { metric_id: 'af695e17-2ae8-4864-ae9b-576c2e566922', period: '2026-01-01' };
test('MetricData keeps missing values distinct from zero and exposes them as optional fields', () => {
  assert.equal(definitions.metric_data.schema.parse({ ...base, value: null }).value, null);
  assert.equal(definitions.metric_data.schema.parse({ ...base, value: 0 }).value, 0);
  assert.equal(fields('metric_data').find((field) => field.name === 'value')?.required, false);
});
test('Findos Plan remains a distinct dimension from budget, actual and forecast', () => {
  for (const dimension of ['actual', 'budget', 'forecast', 'plan']) {
    assert.equal(
      definitions.metric_data.schema.parse({ ...base, value: 1, dimension }).dimension,
      dimension
    );
  }
  assert.ok(
    fields('metric_data')
      .find((field) => field.name === 'dimension')
      ?.options?.includes('plan')
  );
  assert.equal(
    definitions.metric_data.schema.safeParse({ ...base, value: 1, dimension: 'unknown' }).success,
    false
  );
});
