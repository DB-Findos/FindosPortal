import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadCompanyTab } from '../src/utils/company-tabs.ts';

test('company-only readers see details without financial or contact permissions', () => {
  const rights = { companies: { can_read: true } };
  assert.equal(canReadCompanyTab('details', rights), true);
  assert.equal(canReadCompanyTab('financials', rights), false);
  assert.equal(canReadCompanyTab('details', {}), false);
  assert.equal(canReadCompanyTab('unknown', rights), false);
});
test('write permission alone never grants tab access', () => {
  assert.equal(canReadCompanyTab('details', { companies: { can_update: true } }), false);
});
test('report tabs require every data source they render', () => {
  const rights = Object.fromEntries(
    ['companies', 'metrics', 'metric_data', 'index_rates', 'performance_update_comments'].map(
      (entity) => [entity, { can_read: true }]
    )
  );
  assert.equal(canReadCompanyTab('performance-update', rights), true);
  rights.performance_update_comments.can_read = false;
  assert.equal(canReadCompanyTab('performance-update', rights), false);
});
