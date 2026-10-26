import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { ApiProvider } from '../src/contexts/ApiContext';
import DataTable from '../src/components/data/DataTable';
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
]) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  const width = this.getAttribute('data-column') === 'id' ? 120 : 180;
  return { width, height: 40, top: 0, left: 0, right: width, bottom: 40, x: 0, y: 0, toJSON() {} };
};
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const entity: Entity = {
  name: 'funds',
  label: 'Funds',
  readonly: false,
  auditFields: [],
  permissions: {},
  fields: [{ name: 'name', required: true, type: 'text', reference: null, options: null }],
};
test('header menu pins multiple columns with measured offsets, unpins, and keeps actions fixed', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ rows: [{ id: 'version-1', objectId: 'object-1', name: 'Fund' }], total: 1 }),
      { status: 200 }
    );
  const view = render(
    <ApiProvider>
      <DataTable entity={entity} entities={[entity]} onChange={() => {}} />
    </ApiProvider>
  );
  await waitFor(() => assert.equal(view.container.querySelectorAll('tbody tr').length, 1));
  const id = view.container.querySelector<HTMLTableCellElement>('th[data-column="id"]')!;
  const name = view.container.querySelector<HTMLTableCellElement>('th[data-column="name"]')!;
  fireEvent.contextMenu(name, { clientX: 100, clientY: 100 });
  fireEvent.click(view.getByRole('menuitem', { name: 'Spalte links fixieren' }));
  assert.equal(name.style.position, 'sticky');
  assert.equal(name.style.left, '0px');
  fireEvent.contextMenu(id, { clientX: 100, clientY: 100 });
  fireEvent.click(view.getByRole('menuitem', { name: 'Spalte links fixieren' }));
  assert.equal(name.style.left, '120px');
  assert.equal(id.style.left, '0px');
  assert.equal(view.container.querySelectorAll('tbody td.pinned-column').length, 2);
  assert.ok(view.container.querySelector('thead th.actions'));
  assert.ok(view.container.querySelector('tbody td.actions'));
  fireEvent.keyDown(id, { key: 'F10', shiftKey: true });
  fireEvent.click(view.getByRole('menuitem', { name: 'Fixierung aufheben' }));
  assert.equal(id.style.position, '');
  assert.equal(name.style.left, '0px');
  fireEvent.contextMenu(name);
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(view.queryByRole('menu'), null);
  cleanup();
});
