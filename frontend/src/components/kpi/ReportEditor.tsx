import { useState } from 'react';
import { useApi } from '../../contexts/ApiContext';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
import type { Formula, Report } from '../../types/kpi';
export default function ReportEditor({
  initial,
  formulas,
  canSave,
  onSaved,
  onCancel,
}: {
  initial: Report | null;
  formulas: Formula[];
  canSave: boolean;
  onSaved: (r: Report) => void;
  onCancel: () => void;
}) {
  const { request } = useApi(),
    errors = useFormErrors();
  const [name, setName] = useState(initial?.name || ''),
    [description, setDescription] = useState(initial?.description || ''),
    [ids, setIds] = useState<string[]>(initial?.kpi_ids || []),
    [busy, setBusy] = useState(false);
  function move(index: number, direction: number) {
    const next = [...ids];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setIds(next);
  }
  async function save() {
    if (!errors.validate(errors.formRef.current!)) return;
    if (!ids.length) {
      errors.setFieldError('kpi_ids', 'Bitte mindestens eine KPI auswählen.');
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await request<Report>(
          '/kpi/reports' + (initial ? '/' + initial.objectId : ''),
          initial ? 'PATCH' : 'POST',
          { name, description, kpi_ids: ids },
          initial?.id
        )
      );
    } catch (e) {
      errors.handleError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="kpi-editor"
      ref={errors.formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <header className="kpi-editor-heading">
        <h2>{initial ? 'Bericht bearbeiten' : 'Neuer Bericht'}</h2>
        <button type="button" className="secondary" onClick={onCancel}>
          Schließen
        </button>
      </header>
      <fieldset className="kpi-fieldset" disabled={busy}>
        <section className="kpi-section kpi-fields">
          <label className="full">
            Name
            <input
              {...errors.inputProps('name')}
              required
              maxLength={200}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                errors.clearField('name');
              }}
            />
            <FieldError id={errors.errorId('name')} message={errors.fieldErrors.name} />
          </label>
          <label className="full">
            Beschreibung
            <textarea
              {...errors.inputProps('description')}
              maxLength={2000}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                errors.clearField('description');
              }}
            />
            <FieldError
              id={errors.errorId('description')}
              message={errors.fieldErrors.description}
            />
          </label>
        </section>
        <section className="kpi-section" {...errors.inputProps('kpi_ids')} tabIndex={-1}>
          <h3>Kennzahlen auswählen</h3>
          <div className="report-kpi-options">
            {formulas.map((f) => (
              <label key={f.objectId} className="kpi-check">
                <input
                  type="checkbox"
                  checked={ids.includes(f.objectId)}
                  onChange={(e) => {
                    setIds(
                      e.target.checked
                        ? [...ids, f.objectId]
                        : ids.filter((id) => id !== f.objectId)
                    );
                    errors.clearField('kpi_ids');
                  }}
                />
                {f.name}
              </label>
            ))}
          </div>
          <FieldError id={errors.errorId('kpi_ids')} message={errors.fieldErrors.kpi_ids} />
          <h3>Reihenfolge im Bericht</h3>
          <ol className="report-order">
            {ids.map((id, index) => (
              <li key={id}>
                <span>
                  {formulas.find((f) => f.objectId === id)?.name || 'Nicht verfügbare KPI'}
                </span>
                <button
                  type="button"
                  className="secondary"
                  aria-label="KPI nach oben"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label="KPI nach unten"
                  disabled={index === ids.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </section>
        {errors.error && (
          <p className="error" role="alert">
            {errors.error}
          </p>
        )}
        <footer className="kpi-actions">
          <button className="primary" type="submit" disabled={!canSave}>
            {busy ? 'Wird gespeichert …' : 'Bericht speichern'}
          </button>
        </footer>
      </fieldset>
    </form>
  );
}
