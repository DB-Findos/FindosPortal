import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { label } from '../../utils/labels';
import type { Entity, Row } from '../../types/api';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
export default function RecordForm({
  entity,
  row,
  entities,
  onClose,
  onSave,
}: {
  entity: Entity;
  row: Row | null;
  entities: Entity[];
  onClose: () => void;
  onSave: () => void;
}) {
  const { request: api } = useApi();
  const {
    formRef,
    fieldErrors,
    error,
    setError,
    clearField,
    validate,
    handleError,
    inputProps,
    errorId,
  } = useFormErrors();
  const [values, setValues] = useState<Row>(() =>
    Object.fromEntries(
      entity.fields.map((f) => [
        f.name,
        row?.[f.name] ??
          (f.type === 'boolean'
            ? f.name === 'active'
            : f.name === 'currency'
              ? 'EUR'
              : f.name === 'dimension'
                ? 'actual'
                : ''),
      ])
    )
  );
  const [refs, setRefs] = useState<Record<string, Row[]>>({}),
    [busy, setBusy] = useState(false),
    [lookup, setLookup] = useState<Record<string, { page: number; total: number }>>({});
  async function loadRef(name: string, page = 1) {
    const r = await api(`/data/${name}?limit=100&page=${page}`);
    setRefs((old) => ({ ...old, [name]: page === 1 ? r.rows : [...(old[name] || []), ...r.rows] }));
    setLookup((old) => ({ ...old, [name]: { page, total: r.total } }));
  }
  useEffect(() => {
    Promise.all(
      [...new Set(entity.fields.map((f) => f.reference).filter(Boolean))].map((r) => loadRef(r!))
    ).catch((e) => setError(e.message));
  }, [entity.name]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <header>
          <div>
            <span className="eyebrow">{row ? 'BEARBEITEN' : 'NEUER EINTRAG'}</span>
            <h2 id="form-title">{entity.label}</h2>
          </div>
          <button className="icon" aria-label="Schließen" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <form
          ref={formRef}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!validate(e.currentTarget)) return;
            setBusy(true);
            setError('');
            const payload: Row = {};
            for (const f of entity.fields) {
              if (f.readonly) continue;
              const v = values[f.name];
              if (row && f.name === 'password' && !v) continue;
              if (row && v === row[f.name]) continue;
              if (v === '' && !f.required) payload[f.name] = null;
              else if (f.type === 'number') payload[f.name] = Number(v);
              else payload[f.name] = v;
            }
            try {
              await api(
                '/data/' + entity.name + (row ? '/' + row.objectId : ''),
                row ? 'PATCH' : 'POST',
                payload,
                row?.id
              );
              onSave();
            } catch (e) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-fields">
            {entity.fields
              .filter((f) => !f.readonly)
              .map((f) => (
                <label key={f.name}>
                  {label(f.name)}
                  {f.required && !(row && f.name === 'password') && (
                    <span className="required"> *</span>
                  )}
                  {f.type === 'boolean' ? (
                    <span className="switch-row">
                      <input
                        {...inputProps(f.name)}
                        name={f.name}
                        type="checkbox"
                        checked={Boolean(values[f.name])}
                        onChange={(e) => {
                          setValues({ ...values, [f.name]: e.target.checked });
                          clearField(f.name);
                        }}
                      />
                      {values[f.name] ? 'Erlaubt / aktiv' : 'Nicht erlaubt / inaktiv'}
                    </span>
                  ) : f.reference ? (
                    <>
                      <select
                        {...inputProps(f.name)}
                        name={f.name}
                        required={f.required}
                        value={values[f.name]}
                        onChange={(e) => {
                          setValues({ ...values, [f.name]: e.target.value });
                          clearField(f.name);
                        }}
                      >
                        <option value="">Auswählen …</option>
                        {values[f.name] &&
                          !refs[f.reference]?.some((r) => r.objectId === values[f.name]) && (
                            <option value={values[f.name]}>{values[f.name]}</option>
                          )}
                        {(refs[f.reference] || []).map((r) => (
                          <option key={r.objectId} value={r.objectId}>
                            {r.name ||
                              r.email ||
                              [r.first_name, r.last_name].filter(Boolean).join(' ') ||
                              r.id}
                          </option>
                        ))}
                      </select>
                      {lookup[f.reference] &&
                        refs[f.reference]?.length < lookup[f.reference].total && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              loadRef(f.reference!, lookup[f.reference!].page + 1).catch((e) =>
                                setError(e.message)
                              )
                            }
                          >
                            Weitere Referenzen laden
                          </button>
                        )}
                      {!entities.some((e) => e.name === f.reference) && (
                        <small>Leserecht für {f.reference} erforderlich.</small>
                      )}
                    </>
                  ) : f.options ? (
                    <select
                      {...inputProps(f.name)}
                      name={f.name}
                      value={values[f.name]}
                      onChange={(e) => {
                        setValues({ ...values, [f.name]: e.target.value });
                        clearField(f.name);
                      }}
                    >
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...inputProps(f.name)}
                      name={f.name}
                      type={f.type}
                      step={f.type === 'number' ? 'any' : undefined}
                      required={f.required && !(row && f.name === 'password')}
                      minLength={f.name === 'password' ? 12 : undefined}
                      maxLength={f.name === 'password' ? 72 : undefined}
                      autoComplete={f.name === 'password' ? 'new-password' : 'off'}
                      value={String(values[f.name] ?? '').slice(
                        0,
                        f.type === 'date' ? 10 : undefined
                      )}
                      onChange={(e) => {
                        setValues({ ...values, [f.name]: e.target.value });
                        clearField(f.name);
                      }}
                    />
                  )}
                  <FieldError id={errorId(f.name)} message={fieldErrors[f.name]} />
                </label>
              ))}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <footer>
            <button type="button" className="secondary" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Speichern …' : 'Speichern'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
