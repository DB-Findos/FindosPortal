import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { ApiProvider } from '../src/contexts/ApiContext';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import AdvancedSearchPage from '../src/pages/AdvancedSearchPage';
import type { Entity } from '../src/types/api';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLFormElement',
  'MutationObserver',
])
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const make = (name: string, names: string[]): Entity => ({
  name,
  label: name,
  readonly: false,
  auditFields: [],
  permissions: { can_read: true },
  fields: names.map((field) => ({
    name: field,
    required: false,
    type: 'text',
    reference: field === 'metric_id' ? 'metrics' : null,
    options: null,
  })),
});
const entities = [
  make('metric_data', [
    'metric_id',
    'company_id',
    'name',
    'currency',
    'period',
    'value',
    'dimension',
  ]),
  make('metrics', ['name', 'unit']),
];
function Ready() {
  const { loading } = useAuth();
  return loading ? null : <AdvancedSearchPage />;
}
test('query builder adds a reference, selects a linked variable, runs a search and persists its definition', async () => {
  let query: any, viewDefinition: any;
  globalThis.fetch = async (url, options) => {
    let data: any;
    if (url === '/api/auth/me')
      data = {
        id: 'user',
        permissions: {
          search_views: { can_create: true, can_read: true, can_update: true, can_delete: true },
        },
      };
    else if (url === '/api/entities') data = entities;
    else if (url === '/api/search/views' && options?.method === 'POST') {
      viewDefinition = JSON.parse(String(options.body));
      data = { id: 'v1', objectId: 'saved-view', ...viewDefinition };
    } else if (url === '/api/search/views') data = [];
    else if (url === '/api/search/query') {
      query = JSON.parse(String(options?.body));
      data = {
        columns: ['root.name', 'j1.unit'],
        rows: [{ 'root.name': 'Revenue', 'j1.unit': 'EUR' }],
        total: 1,
        page: 1,
        limit: 50,
      };
    } else throw Error('Unexpected URL ' + url);
    return new Response(JSON.stringify(data), {
      status: options?.method === 'POST' && url === '/api/search/views' ? 201 : 200,
    });
  };
  const ui = render(
    <ApiProvider>
      <AuthProvider>
        <Ready />
      </AuthProvider>
    </ApiProvider>
  );
  await waitFor(() => assert.ok(ui.queryByLabelText('Referenz verknüpfen')));
  fireEvent.change(ui.getByLabelText('Referenz verknüpfen'), {
    target: { value: 'root.metric_id' },
  });
  fireEvent.click(ui.getByLabelText('Einheit'));
  fireEvent.click(ui.getByRole('button', { name: 'Suche ausführen' }));
  await waitFor(() => assert.ok(ui.queryByText('Revenue')));
  assert.deepEqual(query.definition.joins, [
    { alias: 'j1', from: 'root', field: 'metric_id', type: 'inner' },
  ]);
  assert.ok(query.definition.fields.some((f: any) => f.alias === 'j1' && f.field === 'unit'));
  fireEvent.change(ui.getByLabelText('View-Name'), { target: { value: 'Revenue view' } });
  fireEvent.click(ui.getByRole('button', { name: /Als neue View speichern/ }));
  await waitFor(() => assert.ok(ui.queryByText('View gespeichert.')));
  assert.equal(viewDefinition.name, 'Revenue view');
  assert.deepEqual(viewDefinition.definition, query.definition);
  cleanup();
});
