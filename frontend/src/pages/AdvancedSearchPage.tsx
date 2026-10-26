import { useRef, useState } from 'react';
import PageHeading from '../components/common/PageHeading';
import JoinEditor from '../components/search/JoinEditor';
import SearchFieldPicker from '../components/search/SearchFieldPicker';
import SearchFilters from '../components/search/SearchFilters';
import SearchResults from '../components/search/SearchResults';
import SavedSearchViews from '../components/search/SavedSearchViews';
import { useAuth } from '../contexts/AuthContext';
import { useApi } from '../contexts/ApiContext';
import {
  availableFields,
  getSources,
  type SearchDefinition,
  type SearchResult,
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
  const { entities } = useAuth();
  const { request } = useApi();
  const [definition, setDefinition] = useState<SearchDefinition>(() =>
    initial(
      entities.some((e) => e.name === 'metric_data') ? 'metric_data' : entities[0]?.name || ''
    )
  );
  const [result, setResult] = useState<SearchResult | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const revision = useRef(0),
    requestId = useRef(0);
  const sources = getSources(definition, entities);
  const change = (next: SearchDefinition) => {
    revision.current++;
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
      if (version === revision.current && id === requestId.current) setResult(data);
    } catch (e) {
      if (version === revision.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setBusy(false);
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
          <SearchResults result={result} busy={busy} onPage={(page) => void run(page)} />
        </div>
      </div>
    </>
  );
}
