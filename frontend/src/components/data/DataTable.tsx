import { useEffect, useRef, useState } from 'react';
import { History, Search, Plus, Pencil, Trash2, Table2, Pin, ListFilter } from 'lucide-react';
import { usePinnedColumns } from '../../hooks/usePinnedColumns';
import ColumnContextMenu from './ColumnContextMenu';
import { useApi } from '../../contexts/ApiContext';
import { useVisibleViewData } from '../../contexts/ViewContentContext';
import { label } from '../../utils/labels';
import type { Entity, Row } from '../../types/api';
import RecordForm from './RecordForm';
import HistoryDialog from './HistoryDialog';
import FieldSelector, { readSelectedFields, saveSelectedFields } from './FieldSelector';
import DataTableFilters, { emptyTableQuery } from './DataTableFilters';
import type { SearchDefinition } from '../../types/search';
export default function DataTable({
  entity,
  entities,
  onChange,
  fieldSelector = false,
}: {
  entity: Entity;
  entities: Entity[];
  onChange: () => void;
  fieldSelector?: boolean;
}) {
  const { request: api } = useApi();
  const [query, setQuery] = useState<SearchDefinition>(() => emptyTableQuery(entity.name));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loadRevision = useRef(0);
  const [history, setHistory] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [form, setForm] = useState<Row | null | undefined>(undefined),
    [search, setSearch] = useState('');
  const [referenceLabels, setReferenceLabels] = useState<Record<string, string>>({});
  const [selectedFields, setSelectedFields] = useState<string[] | null>(() =>
    readSelectedFields(entity.name)
  );
  async function load() {
    const revision = ++loadRevision.current;
    setLoading(true);
    setError('');
    try {
      const result =
        query.joins.length || query.filters.length || query.order.length
          ? await api('/search/query', 'POST', {
              definition: query,
              page,
              limit: 50,
              root_records: true,
            })
          : await api(`/data/${entity.name}?page=${page}`);
      if (revision !== loadRevision.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / 50));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      if (revision === loadRevision.current) setError((e as Error).message);
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }
  useEffect(() => {
    setPage(1);
    setSearch('');
    setForm(undefined);
    if (query.entity !== entity.name) {
      setQuery(emptyTableQuery(entity.name));
      setFiltersOpen(false);
    }
  }, [entity.name]);
  useEffect(() => {
    void load();
    return () => {
      loadRevision.current++;
    };
  }, [entity.name, page, api, query]);
  useEffect(() => {
    Promise.all(
      [...new Set(entity.fields.map((f) => f.reference).filter(Boolean))]
        .filter((r) => entities.some((e) => e.name === r))
        .map(async (name) => {
          const r = await api(`/data/${name}?limit=100`);
          return r.rows;
        })
    )
      .then((groups) =>
        setReferenceLabels(
          Object.fromEntries(
            groups
              .flat()
              .map((r: Row) => [
                r.objectId,
                r.name || r.email || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.id,
              ])
          )
        )
      )
      .catch(() => {});
  }, [entity.name, entities]);
  const availableColumns = [
    'id',
    ...entity.fields.filter((f) => f.name !== 'password').map((f) => f.name),
    ...entity.auditFields,
  ];
  const visibleColumns = selectedFields
    ? availableColumns.filter((field) => selectedFields.includes(field))
    : availableColumns;
  const columns =
    fieldSelector && visibleColumns.length
      ? visibleColumns
      : fieldSelector
        ? [availableColumns[0]]
        : availableColumns;
  const changeFields = (fields: string[]) => {
    if (!fields.length) return;
    setSelectedFields(fields);
    saveSelectedFields(entity.name, fields);
  };
  const pinned = usePinnedColumns(columns, entity.name);
  const [columnMenu, setColumnMenu] = useState<{ column: string; x: number; y: number } | null>(
    null
  );
  const filtered = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase())
  );
  useVisibleViewData('Tabelle: ' + entity.name, {
    entity: entity.name,
    page,
    search,
    query,
    total,
    loading,
    error,
    columns,
    rows: filtered.map((row) =>
      Object.fromEntries(['objectId', ...columns].map((field) => [field, row[field]]))
    ),
    referenceLabels: Object.fromEntries(
      filtered
        .flatMap((row) => columns.map((field) => String(row[field])))
        .filter((id) => referenceLabels[id])
        .map((id) => [id, referenceLabels[id]])
    ),
  });
  return (
    <>
      {history && <HistoryDialog entity={entity} row={history} onClose={() => setHistory(null)} />}
      <div className="table-tools">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Aktuelle Seite durchsuchen"
            placeholder="Aktuelle Seite durchsuchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="record-count">{total} Einträge</span>
        <button
          type="button"
          className="secondary"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilter size={16} />
          Filter{query.filters.length ? ` (${query.filters.length})` : ''}
        </button>
        {fieldSelector && (
          <FieldSelector
            fields={availableColumns}
            selected={columns}
            label={label}
            onChange={changeFields}
          />
        )}
        <button
          className="primary"
          disabled={entity.readonly || !entity.permissions.can_create}
          onClick={() => setForm(null)}
        >
          <Plus size={17} /> Neuer Eintrag
        </button>
      </div>
      {filtersOpen && (
        <DataTableFilters
          value={query}
          entities={entities}
          busy={loading}
          onApply={(next) => {
            loadRevision.current++;
            setPage(1);
            setQuery(next);
            setFiltersOpen(false);
          }}
          onReset={() => {
            loadRevision.current++;
            setPage(1);
            setQuery(emptyTableQuery(entity.name));
            setFiltersOpen(false);
          }}
        />
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table ref={pinned.tableRef}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  data-column={c}
                  style={pinned.style(c)}
                  className={pinned.isPinned(c) ? 'pinned-column' : undefined}
                  tabIndex={0}
                  title="Rechtsklick: Spalte fixieren oder Fixierung aufheben"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setColumnMenu({ column: c, x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setColumnMenu({ column: c, x: rect.left, y: rect.bottom });
                    }
                  }}
                >
                  {label(c)} {pinned.isPinned(c) && <Pin size={11} aria-label="Fixiert" />}
                </th>
              ))}
              <th className="actions">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              filtered.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td
                      key={c}
                      style={pinned.style(c)}
                      className={pinned.isPinned(c) ? 'pinned-column' : undefined}
                      title={c === 'data_base64' ? 'Base64-Bild' : String(r[c] ?? '')}
                    >
                      {c === 'data_base64' ? (
                        <span className="badge">
                          Base64 ({Math.round((String(r[c]).length * 3) / 4 / 1024)} KB)
                        </span>
                      ) : typeof r[c] === 'boolean' ? (
                        <span className={'badge ' + (r[c] ? 'positive' : '')}>
                          {r[c] ? 'Ja' : 'Nein'}
                        </span>
                      ) : c === 'id' ? (
                        <code>{String(r[c]).slice(0, 8)}…</code>
                      ) : ['createdAt', 'lastModifiedAt', 'archivedAt'].includes(c) && r[c] ? (
                        new Date(r[c]).toLocaleDateString('de-DE')
                      ) : (
                        referenceLabels[r[c]] || String(r[c] ?? '—')
                      )}
                    </td>
                  ))}
                  <td className="actions">
                    <div className="row-actions">
                      <button
                        className="icon"
                        aria-label="Versionshistorie"
                        onClick={() => setHistory(r)}
                      >
                        <History size={15} />
                      </button>
                      {!entity.readonly && (
                        <>
                          <button
                            className="icon"
                            aria-label="Bearbeiten"
                            disabled={!entity.permissions.can_update}
                            onClick={() => setForm(r)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon danger"
                            aria-label="Archivieren"
                            disabled={!entity.permissions.can_delete}
                            onClick={async () => {
                              if (!confirm('Diesen Eintrag wirklich archivieren?')) return;
                              try {
                                await api(
                                  '/data/' + entity.name + '/' + r.objectId,
                                  'DELETE',
                                  undefined,
                                  r.id
                                );
                                await load();
                                onChange();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {(loading || !filtered.length) && (
          <div className="empty">
            <Table2 size={26} />
            <strong>
              {loading
                ? 'Daten werden geladen …'
                : search
                  ? 'Keine Treffer'
                  : 'Noch keine Einträge'}
            </strong>
            <p>
              {loading
                ? ''
                : search
                  ? 'Passen Sie Ihren Suchbegriff an.'
                  : 'Neue Einträge erscheinen hier.'}
            </p>
          </div>
        )}
      </div>
      {columnMenu && (
        <ColumnContextMenu
          x={columnMenu.x}
          y={columnMenu.y}
          pinned={pinned.isPinned(columnMenu.column)}
          onToggle={() => pinned.toggle(columnMenu.column)}
          onClose={() => setColumnMenu(null)}
        />
      )}
      <div className="pagination">
        <span>
          Seite {page} von {Math.max(1, Math.ceil(total / 50))}
        </span>
        <div>
          <button
            className="secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Zurück
          </button>
          <button
            className="secondary"
            disabled={page * 50 >= total || loading}
            onClick={() => setPage(page + 1)}
          >
            Weiter
          </button>
        </div>
      </div>
      {form !== undefined && (
        <RecordForm
          key={entity.name + (form?.id || 'new')}
          entity={entity}
          row={form}
          entities={entities}
          onClose={() => setForm(undefined)}
          onSave={() => {
            setForm(undefined);
            void load();
            onChange();
          }}
        />
      )}
    </>
  );
}
