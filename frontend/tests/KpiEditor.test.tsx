import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { ApiProvider } from '../src/contexts/ApiContext';
import FormulaEditor from '../src/components/kpi/FormulaEditor';
import FormulaCanvas from '../src/components/kpi/FormulaCanvas';
import ReportEditor from '../src/components/kpi/ReportEditor';
import type { Formula, KpiCatalog } from '../src/types/kpi';
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
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const catalog: KpiCatalog = {
  metrics: [{ metric_number: 1000000, name: 'Revenue' }],
  companies: [{ objectId: 'company', name: 'Test Company' }],
  sources: [],
};
test('click editor builds variable/LTM/V12P formula, displays bracket groups and persists interpreter text only through API', async () => {
  let saved: any, validated: any, preview: any, finish: any;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === '/api/kpi/validate') {
      validated = body;
      return new Response(JSON.stringify({ data: { TextDisplay: 'Validated revenue' } }));
    }
    if (url === '/api/kpi/preview') {
      preview = body;
      return new Response(
        JSON.stringify({
          objectId: 'preview',
          name: body.formula.name,
          value: '12345',
          unit: '%',
          decimals: 2,
          status: 'ok',
          variables: [],
        })
      );
    }
    saved = body;
    return new Response(JSON.stringify({ id: 'version', objectId: 'kpi', ...body }));
  };
  const ui = render(
    <ApiProvider>
      <FormulaEditor
        initial={null}
        catalog={catalog}
        formulas={[]}
        canSave
        onSaved={(r) => {
          finish = r;
        }}
        onCancel={() => {}}
      />
    </ApiProvider>
  );
  fireEvent.change(ui.getByLabelText('KPI-Name'), { target: { value: 'Growth' } });
  fireEvent.click(ui.getByRole('button', { name: 'Operator (' }));
  fireEvent.change(ui.getByLabelText(/Metric Number/), { target: { value: '1000000' } });
  fireEvent.change(ui.getByLabelText('Aggregation'), { target: { value: 'LTM' } });
  fireEvent.click(ui.getByLabelText(/V12P · 12 Monate zurück/));
  fireEvent.click(ui.getByRole('button', { name: '+ Variable in Formel einfügen' }));
  fireEvent.click(ui.getByRole('button', { name: 'Operator +' }));
  fireEvent.change(ui.getByLabelText('Zahlenwert'), { target: { value: '0,5' } });
  fireEvent.click(ui.getByRole('button', { name: '+ Zahl' }));
  fireEvent.click(ui.getByRole('button', { name: 'Operator )' }));
  assert.equal(ui.container.querySelectorAll('.formula-group').length, 1);
  fireEvent.click(ui.getByRole('button', { name: 'Formel prüfen' }));
  await waitFor(() => assert.ok(ui.queryByText(/Formel gültig/)));
  assert.equal(validated.TextEditor, '( A + 0.5 )');
  assert.equal(validated.variables[0].aggregation, 'LTM');
  assert.equal(validated.variables[0].prior_year, true);
  assert.equal('name' in validated.variables[0], false);
  fireEvent.click(ui.getByRole('button', { name: 'Vorschau berechnen' }));
  await waitFor(() => assert.ok(ui.queryByText('12.345,00')));
  assert.equal(preview.context.company_id, 'company');
  fireEvent.click(ui.getByRole('button', { name: 'KPI speichern' }));
  await waitFor(() => assert.ok(finish));
  assert.equal(saved.TextEditor, '( A + 0.5 )');
  cleanup();
});
test('server formula errors stay under formula and preserve the draft', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'Ungültige Eingabe',
        fieldErrors: { TextEditor: 'Eine schließende Klammer fehlt.' },
      }),
      { status: 400 }
    );
  const initial = {
    id: 'v1',
    objectId: 'kpi',
    name: 'Existing',
    description: '',
    unit: '',
    decimals: 2,
    TextEditor: '( 1',
    TextDisplay: '( 1',
    variables: [],
  } as Formula;
  const ui = render(
    <ApiProvider>
      <FormulaEditor
        initial={initial}
        catalog={catalog}
        formulas={[]}
        canSave
        onSaved={() => {
          throw Error('Must not save');
        }}
        onCancel={() => {}}
      />
    </ApiProvider>
  );
  fireEvent.click(ui.getByRole('button', { name: 'KPI speichern' }));
  await waitFor(() => assert.ok(ui.queryByText('Eine schließende Klammer fehlt.')));
  assert.equal(
    ui.container.querySelector('[data-field="TextEditor"]')?.getAttribute('aria-invalid'),
    'true'
  );
  assert.equal((ui.getByLabelText('KPI-Name') as HTMLInputElement).value, 'Existing');
  cleanup();
});
test('nested parentheses form nested groups and orphan brackets remain marked', () => {
  const ui = render(
    <FormulaCanvas
      tokens={['(', '1', '+', '(', '2', ')', ')', ')']}
      variables={[]}
      cursor={8}
      onCursor={() => {}}
    />
  );
  assert.equal(ui.container.querySelectorAll('.formula-group').length, 2);
  assert.equal(ui.container.querySelectorAll('.formula-group .formula-group').length, 1);
  assert.equal(ui.container.querySelectorAll('.unmatched').length, 1);
  cleanup();
});
test('report editor saves selected KPIs in user-defined order', async () => {
  let payload: any;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: 'v1', objectId: 'report', ...payload }));
  };
  const formulas = [
    { objectId: 'a', name: 'Revenue' },
    { objectId: 'b', name: 'Margin' },
  ] as Formula[];
  const ui = render(
    <ApiProvider>
      <ReportEditor
        initial={null}
        formulas={formulas}
        canSave
        onSaved={() => {}}
        onCancel={() => {}}
      />
    </ApiProvider>
  );
  fireEvent.change(ui.getByLabelText('Name'), { target: { value: 'Performance' } });
  fireEvent.click(ui.getByLabelText('Revenue'));
  fireEvent.click(ui.getByLabelText('Margin'));
  fireEvent.click(ui.getAllByLabelText('KPI nach oben')[1]);
  fireEvent.click(ui.getByRole('button', { name: 'Bericht speichern' }));
  await waitFor(() => assert.deepEqual(payload.kpi_ids, ['b', 'a']));
  cleanup();
});
