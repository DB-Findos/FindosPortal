import { useState } from 'react';
import JoinEditor from '../search/JoinEditor';
import SearchFilters from '../search/SearchFilters';
import { availableFields, getSources, type SearchDefinition } from '../../types/search';
import type { Entity } from '../../types/api';
import './DataTableFilters.css';

export const emptyTableQuery = (entity: string): SearchDefinition => ({
  entity,
  joins: [],
  fields: [{ alias: 'root', field: 'objectId' }],
  filters: [],
  order: [],
});

export default function DataTableFilters({
  value,
  entities,
  onApply,
  onReset,
  busy,
}: {
  value: SearchDefinition;
  entities: Entity[];
  onApply: (query: SearchDefinition) => void;
  onReset: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const sources = getSources(draft, entities);
  return (
    <section className="data-table-filters" aria-label="Tabellenfilter">
      <div className="data-table-filter-editors">
        <JoinEditor
          joins={draft.joins}
          sources={sources}
          entities={entities}
          onChange={(joins) => {
            const next = { ...draft, joins };
            const allowed = new Set(
              getSources(next, entities).flatMap((source) =>
                availableFields(source).map((field) => `${source.alias}.${field}`)
              )
            );
            setDraft({
              ...next,
              filters: next.filters.filter((filter) =>
                allowed.has(`${filter.alias}.${filter.field}`)
              ),
              order: next.order.filter((item) => allowed.has(`${item.alias}.${item.field}`)),
            });
          }}
        />
        <SearchFilters sources={sources} definition={draft} onChange={setDraft} />
      </div>
      <div className="data-table-filter-actions">
        <button className="primary" type="button" disabled={busy} onClick={() => onApply(draft)}>
          Filter anwenden
        </button>
        <button className="secondary" type="button" disabled={busy} onClick={onReset}>
          Zurücksetzen
        </button>
      </div>
    </section>
  );
}
