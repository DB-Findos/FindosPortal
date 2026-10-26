import { useEffect, useState } from 'react';
import { useApi } from '../../contexts/ApiContext';
import { useAuth } from '../../contexts/AuthContext';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
import type { SearchDefinition, SearchView } from '../../types/search';
export default function SavedSearchViews({
  definition,
  onLoad,
}: {
  definition: SearchDefinition;
  onLoad: (definition: SearchDefinition) => void;
}) {
  const { request } = useApi();
  const { user } = useAuth();
  const [views, setViews] = useState<SearchView[]>([]),
    [active, setActive] = useState<SearchView | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const {
    formRef,
    validate,
    handleError,
    error,
    setError,
    fieldErrors,
    errorId,
    inputProps,
    clearField,
  } = useFormErrors();
  const rights = user?.permissions.search_views;
  const reload = async () => setViews(await request<SearchView[]>('/search/views'));
  useEffect(() => {
    void reload().catch(handleError);
  }, []);
  const save = async (update: boolean) => {
    if (!formRef.current || !validate(formRef.current)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await request<SearchView>(
        '/search/views' + (update && active ? '/' + active.objectId : ''),
        update ? 'PATCH' : 'POST',
        { name, definition },
        update ? active?.id : undefined
      );
      setActive(saved);
      await reload();
      setNotice('View gespeichert.');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="query-section">
      <h2>Meine Views</h2>
      <p>
        Gespeichert werden Felder, Referenzverknüpfungen, Filter und Sortierung. Ergebnisse werden
        beim Laden neu abgefragt.
      </p>
      <select
        aria-label="Gespeicherte View"
        value={active?.objectId || ''}
        disabled={busy}
        onChange={(e) => {
          const view = views.find((v) => v.objectId === e.target.value) || null;
          setActive(view);
          setName(view?.name || '');
          setNotice('');
          if (view) onLoad(view.definition);
        }}
      >
        <option value="">Neue View …</option>
        {views.map((view) => (
          <option key={view.objectId} value={view.objectId}>
            {view.name}
          </option>
        ))}
      </select>
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <label>
          View-Name
          <input
            {...inputProps('name')}
            required
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearField('name');
            }}
          />
          <FieldError id={errorId('name')} message={fieldErrors.name} />
        </label>
        <div className="query-row">
          <button
            className="secondary"
            disabled={busy || !rights?.can_create || !definition.fields.length}
          >
            + Als neue View speichern
          </button>
          {active && (
            <>
              <button
                className="secondary"
                type="button"
                disabled={busy || !rights?.can_update}
                onClick={() => void save(true)}
              >
                View aktualisieren
              </button>
              <button
                className="secondary danger"
                type="button"
                disabled={busy || !rights?.can_delete}
                onClick={async () => {
                  if (!confirm('Diese View archivieren?')) return;
                  setBusy(true);
                  setError('');
                  try {
                    await request(
                      '/search/views/' + active.objectId,
                      'DELETE',
                      undefined,
                      active.id
                    );
                    setActive(null);
                    setName('');
                    await reload();
                    setNotice('View archiviert.');
                  } catch (e) {
                    handleError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Archivieren
              </button>
            </>
          )}
        </div>
      </form>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
