import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';
import PageHeading from '../components/common/PageHeading';
import FormulaEditor from '../components/kpi/FormulaEditor';
import ReportEditor from '../components/kpi/ReportEditor';
import type { Formula, KpiCatalog, Report } from '../types/kpi';
export default function KpiSettingsPage() {
  const { request } = useApi(),
    { user } = useAuth();
  const [tab, setTab] = useState<'formulas' | 'reports'>('formulas'),
    [formulas, setFormulas] = useState<Formula[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [catalog, setCatalog] = useState<KpiCatalog | null>(null),
    [editing, setEditing] = useState<Formula | Report | null | undefined>(undefined),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const selection = useRef(0),
    rights = user?.permissions || {};
  const entity = tab === 'formulas' ? 'kpi_formulas' : 'report_definitions',
    child = tab === 'formulas' ? 'variable_map' : 'report_items';
  const canCreate = Boolean(rights[entity]?.can_create && rights[child]?.can_create),
    canUpdate = Boolean(rights[entity]?.can_update && rights[child]?.can_update);
  async function load() {
    try {
      const [f, r, c] = await Promise.all([
        request<Formula[]>('/kpi/formulas'),
        rights.report_definitions?.can_read
          ? request<Report[]>('/kpi/reports')
          : Promise.resolve([]),
        request<KpiCatalog>('/kpi/catalog'),
      ]);
      setFormulas(f);
      setReports(r);
      setCatalog(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [request]);
  async function open(id: string) {
    const revision = ++selection.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = await request<Formula | Report>(`/kpi/${tab}/${id}`);
      if (revision === selection.current) setEditing(row);
    } catch (e) {
      if (revision === selection.current) setError((e as Error).message);
    } finally {
      if (revision === selection.current) setBusy(false);
    }
  }
  async function archive(row: Formula | Report) {
    if (!window.confirm(`„${row.name}“ archivieren?`)) return;
    setBusy(true);
    try {
      await request(`/kpi/${tab}/${row.objectId}`, 'DELETE', undefined, row.id);
      setEditing(undefined);
      setNotice('Eintrag archiviert.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    selection.current++;
    setEditing(undefined);
    setBusy(false);
  }
  function saved() {
    close();
    setNotice('Gespeichert. Eine neue Objektversion wurde angelegt.');
    void load();
  }
  return (
    <>
      <PageHeading
        title="KPIs & Reporting"
        description="Kennzahlen definieren und zu Standardberichten zusammenstellen."
      />
      <div className="tabs">
        <button
          className={tab === 'formulas' ? 'active' : ''}
          onClick={() => {
            close();
            setTab('formulas');
            setError('');
            setNotice('');
          }}
        >
          KPI-Formeln
        </button>
        <button
          className={tab === 'reports' ? 'active' : ''}
          onClick={() => {
            close();
            setTab('reports');
            setError('');
            setNotice('');
          }}
        >
          Berichte
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="kpi-notice" role="status">
          {notice}
        </p>
      )}
      <div className="kpi-workspace">
        <aside className="kpi-library">
          <div className="kpi-library-heading">
            <h2>{tab === 'formulas' ? 'Kennzahlen' : 'Standardberichte'}</h2>
            <button
              type="button"
              className="primary"
              aria-label={tab === 'formulas' ? 'Neue KPI' : 'Neuer Bericht'}
              disabled={!canCreate || !catalog || busy}
              onClick={() => {
                selection.current++;
                setEditing(null);
                setNotice('');
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="kpi-library-items">
            {(tab === 'formulas' ? formulas : reports).map((row) => (
              <div
                className={
                  'kpi-library-row ' + (editing?.objectId === row.objectId ? 'selected' : '')
                }
                key={row.objectId}
              >
                <button disabled={busy} onClick={() => void open(row.objectId)}>
                  <b>{row.name}</b>
                  <small>
                    {row.description ||
                      ('TextDisplay' in row ? row.TextDisplay : 'Standardbericht')}
                  </small>
                </button>
                {rights[entity]?.can_delete && rights[child]?.can_delete && (
                  <button
                    className="kpi-archive"
                    disabled={busy}
                    aria-label={row.name + ' archivieren'}
                    onClick={() => void archive(row)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {!(tab === 'formulas' ? formulas : reports).length && (
              <p className="muted">Noch keine Einträge.</p>
            )}
          </div>
        </aside>
        <div className="kpi-detail">
          {busy && <p role="status">Wird geladen …</p>}
          {editing === undefined ? (
            <div className="kpi-empty">
              <h2>{tab === 'formulas' ? 'KPI-Formeleditor' : 'Berichtsdefinition'}</h2>
              <p>Links einen Eintrag auswählen oder über + einen neuen erstellen.</p>
              <p>
                Berichtsmonat, Company und Dimension werden bei der Ausführung gesetzt. Die
                Berechnungslogik liegt vollständig im Backend.
              </p>
            </div>
          ) : (
            catalog &&
            (tab === 'formulas' ? (
              <FormulaEditor
                key={editing?.id || 'new-formula'}
                initial={editing as Formula | null}
                catalog={catalog}
                formulas={formulas}
                canSave={editing ? canUpdate : canCreate}
                onSaved={saved}
                onCancel={close}
              />
            ) : (
              <ReportEditor
                key={editing?.id || 'new-report'}
                initial={editing as Report | null}
                formulas={formulas}
                canSave={editing ? canUpdate : canCreate}
                onSaved={saved}
                onCancel={close}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
