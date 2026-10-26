import { useState } from 'react';
import { useApi } from '../../contexts/ApiContext';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
import FormulaCanvas from './FormulaCanvas';
import VariablePicker from './VariablePicker';
import ReportContextFields from './ReportContextFields';
import KpiCard from './KpiCard';
import {
  cleanVariable,
  emptyFormula,
  variableIdentifier,
  type Formula,
  type FormulaDraft,
  type KpiCatalog,
  type KpiResult,
  type KpiVariable,
  type ReportContext,
} from '../../types/kpi';
interface Props {
  initial: Formula | null;
  catalog: KpiCatalog;
  formulas: Formula[];
  canSave: boolean;
  onSaved: (value: Formula) => void;
  onCancel: () => void;
}
export default function FormulaEditor({
  initial,
  catalog,
  formulas,
  canSave,
  onSaved,
  onCancel,
}: Props) {
  const { request } = useApi(),
    errors = useFormErrors();
  const [draft, setDraft] = useState<FormulaDraft>(initial || emptyFormula),
    [tokens, setTokens] = useState<string[]>(initial?.TextEditor.split(/\s+/) || []),
    [cursor, setCursor] = useState(initial?.TextEditor.split(/\s+/).length || 0),
    [constant, setConstant] = useState(''),
    [busy, setBusy] = useState(false),
    [validated, setValidated] = useState(''),
    [preview, setPreview] = useState<KpiResult | null>(null);
  const [context, setContext] = useState<ReportContext>({
    company_id: catalog.companies[0]?.objectId || '',
    date: new Date().toISOString().slice(0, 7) + '-01',
    dimension: 'actual',
  });
  function change<K extends keyof FormulaDraft>(key: K, value: FormulaDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    errors.clearField(key);
    setValidated('');
    setPreview(null);
  }
  function changeTokens(next: string[], position: number) {
    setTokens(next);
    setCursor(position);
    errors.clearField('TextEditor');
    setValidated('');
    setPreview(null);
  }
  function insert(token: string) {
    changeTokens([...tokens.slice(0, cursor), token, ...tokens.slice(cursor)], cursor + 1);
  }
  function addVariable(v: Omit<KpiVariable, 'identifier'>) {
    let index = 0;
    while (draft.variables.some((x) => x.identifier === variableIdentifier(index))) index++;
    const identifier = variableIdentifier(index);
    change('variables', [...draft.variables, { ...v, identifier }]);
    insert(identifier);
  }
  const used = draft.variables.filter((v) => tokens.includes(v.identifier));
  const [editingVariable, setEditingVariable] = useState<string | null>(null);
  const selectedVariable = draft.variables.find((v) => v.identifier === editingVariable);
  function input(): FormulaDraft {
    return {
      name: draft.name,
      description: draft.description,
      unit: draft.unit,
      decimals: draft.decimals,
      TextEditor: tokens.join(' '),
      variables: used.map(cleanVariable),
    };
  }
  async function run(action: 'save' | 'validate' | 'preview') {
    if (!errors.validate(errors.formRef.current!)) return;
    if (action === 'preview' && (!context.company_id || !context.date)) {
      errors.setFieldError(!context.company_id ? 'company_id' : 'date', 'Bitte auswählen.');
      return;
    }
    setBusy(true);
    setValidated('');
    setPreview(null);
    try {
      if (action === 'save') {
        const saved = await request<Formula>(
          '/kpi/formulas' + (initial ? '/' + initial.objectId : ''),
          initial ? 'PATCH' : 'POST',
          input(),
          initial?.id
        );
        onSaved(saved);
      }
      if (action === 'validate') {
        const result = await request<{ data: { TextDisplay: string } }>(
          '/kpi/validate',
          'POST',
          input()
        );
        setValidated(result.data.TextDisplay);
      }
      if (action === 'preview')
        setPreview(await request<KpiResult>('/kpi/preview', 'POST', { formula: input(), context }));
    } catch (e) {
      errors.handleError(e, (field) => {
        const path = field.replace(/^(formula|context)\./, '');
        return /^variables\.\d+/.exec(path)?.[0] || path;
      });
    } finally {
      setBusy(false);
    }
  }
  function err(field: string) {
    return <FieldError id={errors.errorId(field)} message={errors.fieldErrors[field]} />;
  }
  return (
    <form
      ref={errors.formRef}
      className="kpi-editor"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run('save');
      }}
    >
      <header className="kpi-editor-heading">
        <h2>{initial ? 'KPI bearbeiten' : 'Neue KPI'}</h2>
        <button type="button" className="secondary" onClick={onCancel}>
          Schließen
        </button>
      </header>
      <fieldset disabled={busy} className="kpi-fieldset">
        <section className="kpi-section">
          <div className="kpi-fields">
            <label className="wide">
              KPI-Name
              <input
                {...errors.inputProps('name')}
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => change('name', e.target.value)}
              />
              {err('name')}
            </label>
            <label>
              Anzeigeeinheit
              <input
                {...errors.inputProps('unit')}
                maxLength={40}
                value={draft.unit}
                placeholder="z. B. %, EUR, TEUR"
                onChange={(e) => change('unit', e.target.value)}
              />
              {err('unit')}
            </label>
            <label>
              Nachkommastellen
              <input
                {...errors.inputProps('decimals')}
                type="number"
                min={0}
                max={10}
                step={1}
                required
                value={draft.decimals}
                onChange={(e) => change('decimals', e.target.valueAsNumber)}
              />
              {err('decimals')}
            </label>
            <label className="full">
              Beschreibung
              <textarea
                {...errors.inputProps('description')}
                maxLength={2000}
                value={draft.description}
                onChange={(e) => change('description', e.target.value)}
              />
              {err('description')}
            </label>
          </div>
        </section>
        <section className="kpi-section">
          <h3>Formel</h3>
          <p className="muted">
            Bausteine anklicken. Ein Klick in die Formel setzt die Einfügeposition. Farbige Rahmen
            verbinden zusammengehörige Klammern.
          </p>
          <div {...errors.inputProps('TextEditor')} tabIndex={-1}>
            <FormulaCanvas
              tokens={tokens}
              variables={draft.variables}
              cursor={cursor}
              onCursor={setCursor}
              onVariable={setEditingVariable}
            />
          </div>
          {err('TextEditor')}
          <div className="formula-tools">
            {['+', '-', '*', '/', '^', '(', ')'].map((op) => (
              <button
                type="button"
                className="operator"
                key={op}
                aria-label={'Operator ' + op}
                onClick={() => insert(op)}
              >
                {op === '*' ? '×' : op === '/' ? '÷' : op}
              </button>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={!cursor}
              onClick={() =>
                changeTokens(
                  tokens.filter((_, i) => i !== cursor - 1),
                  cursor - 1
                )
              }
            >
              ⌫ Baustein
            </button>
            <button type="button" className="secondary" onClick={() => changeTokens([], 0)}>
              Leeren
            </button>
          </div>
          <div className="constant-tools">
            <label>
              Zahlenwert
              <input
                {...errors.inputProps('constant')}
                inputMode="decimal"
                value={constant}
                placeholder="z. B. 100 oder 0,5"
                onChange={(e) => {
                  setConstant(e.target.value);
                  errors.clearField('constant');
                }}
              />
              {err('constant')}
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const value = constant.trim().replace(',', '.');
                if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.length > 50) {
                  errors.setFieldError(
                    'constant',
                    'Bitte eine Zahl eingeben. Negative Werte über den Minus-Operator bilden.'
                  );
                  return;
                }
                insert(value);
                setConstant('');
              }}
            >
              + Zahl
            </button>
          </div>
          <code className="formula-code">{tokens.join(' ') || '—'}</code>
        </section>
        <VariablePicker
          key={selectedVariable?.identifier || 'new-variable'}
          initial={selectedVariable}
          onCancelEdit={() => setEditingVariable(null)}
          catalog={catalog}
          formulas={formulas.filter((f) => f.objectId !== initial?.objectId)}
          onAdd={(value) => {
            if (!selectedVariable) return addVariable(value);
            change(
              'variables',
              draft.variables.map((v) =>
                v.identifier === selectedVariable.identifier
                  ? { ...value, identifier: v.identifier }
                  : v
              )
            );
          }}
        />
        <section className="kpi-section" {...errors.inputProps('variables')} tabIndex={-1}>
          <h3>VariableMap</h3>
          {err('variables')}
          <div className="variable-list">
            {draft.variables.map((v) => {
              const index = used.findIndex((x) => x.identifier === v.identifier);
              return (
                <div key={v.identifier} data-field={`variables.${index}`} tabIndex={-1}>
                  <button
                    type="button"
                    className="variable-chip"
                    onClick={() => insert(v.identifier)}
                    title="Erneut in die Formel einfügen"
                  >
                    <b>{v.identifier}</b> {v.name}
                  </button>
                  {!tokens.includes(v.identifier) && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        change(
                          'variables',
                          draft.variables.filter((x) => x.identifier !== v.identifier)
                        )
                      }
                    >
                      Entfernen
                    </button>
                  )}
                  {index >= 0 && err(`variables.${index}`)}
                </div>
              );
            })}
          </div>
          <small>
            Nur verwendete Variablen werden gespeichert. Zum Bearbeiten einen Variablenbaustein in
            der Formel anklicken. Änderungen gelten für alle Vorkommen dieser Variable.
          </small>
        </section>
        <section className="kpi-section">
          <h3>Vorschau mit Berichtskontext</h3>
          <ReportContextFields
            companies={catalog.companies}
            value={context}
            onChange={(next) => {
              setContext(next);
              setPreview(null);
              errors.clearField('company_id');
              errors.clearField('date');
            }}
            errors={errors.fieldErrors}
          />
          <button type="button" className="secondary" onClick={() => void run('preview')}>
            Vorschau berechnen
          </button>
          {preview && <KpiCard result={preview} />}
        </section>
        {errors.error && (
          <p className="error" role="alert">
            {errors.error}
          </p>
        )}
        {validated && (
          <p className="formula-valid" role="status">
            Formel gültig: {validated}
          </p>
        )}
        <footer className="kpi-actions">
          <button type="button" className="secondary" onClick={() => void run('validate')}>
            Formel prüfen
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            {busy ? 'Wird verarbeitet …' : 'KPI speichern'}
          </button>
        </footer>
      </fieldset>
    </form>
  );
}
