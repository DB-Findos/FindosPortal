import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { ApiProvider } from '../src/contexts/ApiContext';
import RecordForm from '../src/components/data/RecordForm';
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
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const entity: Entity = {
  name: 'contacts',
  label: 'Contacts',
  readonly: false,
  auditFields: [],
  permissions: {},
  fields: ['first_name', 'email'].map((name) => ({
    name,
    required: true,
    type: name === 'email' ? 'email' : 'text',
    reference: null,
    options: null,
  })),
};
test('required and email errors appear directly below their fields and focus the first error', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw Error('Unexpected request');
  };
  const view = render(
    <ApiProvider>
      <RecordForm
        entity={entity}
        entities={[entity]}
        row={null}
        onClose={() => {}}
        onSave={() => {}}
      />
    </ApiProvider>
  );
  const name = view.container.querySelector<HTMLInputElement>('[name="first_name"]')!;
  const email = view.container.querySelector<HTMLInputElement>('[name="email"]')!;
  fireEvent.submit(view.container.querySelector('form')!);
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(email.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, name);
  assert.ok(name.closest('label')!.querySelector('.field-error'));
  fireEvent.change(name, { target: { value: 'Test' } });
  fireEvent.change(email, { target: { value: 'invalid' } });
  fireEvent.submit(view.container.querySelector('form')!);
  assert.equal(name.getAttribute('aria-invalid'), 'false');
  assert.match(email.closest('label')!.textContent!, /E-Mail/);
  assert.equal(requests, 0);
  cleanup();
});
test('server field errors stay under the matching input and clear on correction', async () => {
  let saved = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'Duplicate',
        fieldErrors: { email: 'Diese E-Mail existiert bereits.' },
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  const view = render(
    <ApiProvider>
      <RecordForm
        entity={entity}
        entities={[entity]}
        row={null}
        onClose={() => {}}
        onSave={() => {
          saved++;
        }}
      />
    </ApiProvider>
  );
  const name = view.container.querySelector<HTMLInputElement>('[name="first_name"]')!;
  const email = view.container.querySelector<HTMLInputElement>('[name="email"]')!;
  fireEvent.change(name, { target: { value: 'Test' } });
  fireEvent.change(email, { target: { value: 'test@example.com' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => assert.equal(email.getAttribute('aria-invalid'), 'true'));
  assert.match(email.closest('label')!.textContent!, /existiert bereits/);
  assert.equal(document.activeElement, email);
  assert.equal(
    document.getElementById(email.getAttribute('aria-describedby')!)?.textContent,
    'Diese E-Mail existiert bereits.'
  );
  assert.equal(name.closest('label')!.querySelector('.field-error'), null);
  fireEvent.change(email, { target: { value: 'other@example.com' } });
  assert.equal(email.closest('label')!.querySelector('.field-error'), null);
  globalThis.fetch = async () => new Response('{}', { status: 201 });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => assert.equal(saved, 1));
  cleanup();
});
