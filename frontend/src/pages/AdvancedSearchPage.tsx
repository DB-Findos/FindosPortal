import { useRef, useState } from 'react';
import PageHeading from '../components/common/PageHeading';
import JoinEditor from '../components/search/JoinEditor';
import SearchFieldPicker from '../components/search/SearchFieldPicker';
import SearchFilters from '../components/search/SearchFilters';
import SearchResults from '../components/search/SearchResults';
import SavedSearchViews from '../components/search/SavedSearchViews';
import RecordForm from '../components/data/RecordForm';
import { editableSearchEntity } from '../components/search/SearchRecordActions';
import type { Entity, Row } from '../types/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useApi } from '../contexts/ApiContext';
import { useVisibleViewData } from '../contexts/ViewContentContext';
import {
  availableFields,
  getSources,
  type SearchDefinition,
  type SearchResult,
  type SearchRecordRef,
} from '../types/search';
const initial = (entity: string): SearchDefinition => ({
  entity,
  joins: [],
  fields: (entity === 'metric_data'
    ? ['company_id', 'name', 'currency', 'period', 'value', 'dimension']
    : ['id']
  ).map((field) => ({ alias: 'root', field })),
  filters: [],
  order: [],
});
export default function AdvancedSearchPage() {
  const { entities, refresh } = useAuth();
  const theme = useTheme();
  const { request } = useApi();
  const [definition, setDefinition] = useState<SearchDefinition>(() =>
    initial(
      entities.some((e) => e.name === 'metric_data') ? 'metric_data' : entities[0]?.name || ''
    )
  );
  const [result, setResult] = useState<SearchResult | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ entity: Entity; row: Row } | null>(null);
  const [openingEdit, setOpeningEdit] = useState(false);
  const editRevision = useRef(0);
  const revision = useRef(0),
    requestId = useRef(0);
  const sources = getSources(definition, entities);
  useVisibleViewData('Advanced Search', { definition, result, busy, error });
  const change = (next: SearchDefinition) => {
    revision.current++;
    editRevision.current++;
    setEditing(null);
    setOpeningEdit(false);
    setDefinition(next);
    setResult(null);
    setError('');
  };
  async function run(page = 1) {
    const version = revision.current,
      id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const data = await request<SearchResult>('/search/query', 'POST', {
        definition,
        page,
        limit: 50,
      });
      if (version === revision.current && id === requestId.current) {
        const lastPage = Math.max(1, Math.ceil(data.total / data.limit));
        if (page > lastPage) {
          await run(lastPage);
          return;
        }
        setResult(data);
      }
    } catch (e) {
      if (version === revision.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  async function edit(record: SearchRecordRef) {
    const entity = entities.find((item) => item.name === record.entity);
    if (!entity || !editableSearchEntity(entity)) return;
    const selection = ++editRevision.current;
    setOpeningEdit(true);
    setError('');
    try {
      const row = await request<Row>(`/data/${record.entity}/${record.objectId}`);
      if (selection === editRevision.current) setEditing({ entity, row });
    } catch (cause) {
      if (selection === editRevision.current) setError((cause as Error).message);
    } finally {
      if (selection === editRevision.current) setOpeningEdit(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Advanced Search"
        description="Variablen über Referenzen verknüpfen, gezielt suchen und eigene Views speichern."
      />
      <div className="advanced-search">
        <aside className="query-builder">
          <section className="query-section">
            <h2>Ausgangs-Entity</h2>
            <select
              aria-label="Ausgangs-Entity"
              value={definition.entity}
              onChange={(e) => change(initial(e.target.value))}
            >
              {entities.map((entity) => (
                <option key={entity.name} value={entity.name}>
                  {entity.label}
                </option>
              ))}
            </select>
          </section>
          <JoinEditor
            joins={definition.joins}
            sources={sources}
            entities={entities}
            onChange={(joins) => {
              const next = { ...definition, joins };
              const allowed = new Set(
                getSources(next, entities).flatMap((source) =>
                  availableFields(source).map((field) => source.alias + '.' + field)
                )
              );
              change({
                ...next,
                fields: next.fields.filter((f) => allowed.has(f.alias + '.' + f.field)),
                filters: next.filters.filter((f) => allowed.has(f.alias + '.' + f.field)),
                order: next.order.filter((f) => allowed.has(f.alias + '.' + f.field)),
              });
            }}
          />
          <SearchFieldPicker
            sources={sources}
            selected={definition.fields}
            onChange={(fields) => change({ ...definition, fields })}
          />
          <SearchFilters sources={sources} definition={definition} onChange={change} />
          <SavedSearchViews definition={definition} onLoad={change} />
        </aside>
        <div className="query-output">
          <div className="table-tools">
            <button
              className="primary"
              disabled={busy || !definition.fields.length}
              onClick={() => void run()}
            >
              {busy ? 'Suche läuft …' : 'Suche ausführen'}
            </button>
            <span className="record-count">
              {definition.joins.length} Verknüpfungen · {definition.fields.length} Felder
            </span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <SearchResults
            result={result}
            busy={busy}
            entities={entities}
            editingBusy={openingEdit}
            onEdit={(record) => void edit(record)}
            onPage={(page) => void run(page)}
          />
        </div>
      </div>
      {editing && (
        <RecordForm
          key={`${editing.entity.name}:${editing.row.id}`}
          entity={editing.entity}
          row={editing.row}
          entities={entities}
          onClose={() => setEditing(null)}
          onSave={() => {
            if (['images', 'design_settings'].includes(editing.entity.name)) void theme.refresh();
            setEditing(null);
            void refresh();
            void run(result?.page ?? 1);
          }}
        />
      )}
    </>
  );
}
