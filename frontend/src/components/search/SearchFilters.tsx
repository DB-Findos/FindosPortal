import {
  availableFields,
  type SearchDefinition,
  type SearchSource,
  type SearchFilter,
} from '../../types/search';
import { label } from '../../utils/labels';
const operators: Record<SearchFilter['op'], string> = {
  eq: 'ist gleich',
  ne: 'ist ungleich',
  contains: 'enthält',
  gt: 'größer als',
  gte: 'größer / gleich',
  lt: 'kleiner als',
  lte: 'kleiner / gleich',
  isnull: 'ist leer',
  notnull: 'ist nicht leer',
};
export default function SearchFilters({
  definition,
  sources,
  onChange,
}: {
  definition: SearchDefinition;
  sources: SearchSource[];
  onChange: (definition: SearchDefinition) => void;
}) {
  const options = sources.flatMap((source) =>
    availableFields(source).map((field) => (
      <option key={source.alias + '.' + field} value={source.alias + '.' + field}>
        {source.alias} · {label(field)}
      </option>
    ))
  );
  const update = (index: number, change: Partial<SearchFilter>) =>
    onChange({
      ...definition,
      filters: definition.filters.map((f, i) => (i === index ? { ...f, ...change } : f)),
    });
  return (
    <section className="query-section">
      <h2>Filter & Sortierung</h2>
      <p>
        Alle Filter werden mit UND verknüpft. Datumswerte: YYYY-MM-DD, Wahrheitswerte: true / false.
      </p>
      {definition.filters.map((filter, index) => (
        <div className="query-row" key={index}>
          <select
            aria-label={'Filterfeld ' + (index + 1)}
            value={filter.alias + '.' + filter.field}
            onChange={(e) => {
              const [alias, field] = e.target.value.split('.');
              update(index, { alias, field });
            }}
          >
            {options}
          </select>
          <select
            aria-label={'Operator ' + (index + 1)}
            value={filter.op}
            onChange={(e) => update(index, { op: e.target.value as SearchFilter['op'] })}
          >
            {Object.entries(operators).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
          {!['isnull', 'notnull'].includes(filter.op) && (
            <input
              aria-label={'Filterwert ' + (index + 1)}
              value={String(filter.value ?? '')}
              onChange={(e) => update(index, { value: e.target.value })}
            />
          )}
          <button
            className="secondary"
            type="button"
            aria-label={'Filter entfernen ' + (index + 1)}
            onClick={() =>
              onChange({ ...definition, filters: definition.filters.filter((_, i) => i !== index) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="secondary"
        type="button"
        disabled={definition.filters.length >= 30 || !sources.length}
        onClick={() =>
          onChange({
            ...definition,
            filters: [
              ...definition.filters,
              { alias: 'root', field: availableFields(sources[0])[0], op: 'eq', value: '' },
            ],
          })
        }
      >
        + Filter
      </button>
      <label className="query-sort">
        Sortierung
        <select
          value={
            definition.order[0] ? definition.order[0].alias + '.' + definition.order[0].field : ''
          }
          onChange={(e) => {
            const [alias, field] = e.target.value.split('.');
            onChange({
              ...definition,
              order: e.target.value
                ? [{ alias, field, direction: definition.order[0]?.direction || 'asc' }]
                : [],
            });
          }}
        >
          <option value="">Objekt-ID (Standard)</option>
          {options}
        </select>
      </label>
      {definition.order.length > 0 && (
        <select
          aria-label="Sortierrichtung"
          value={definition.order[0].direction}
          onChange={(e) =>
            onChange({
              ...definition,
              order: [{ ...definition.order[0], direction: e.target.value as 'asc' | 'desc' }],
            })
          }
        >
          <option value="asc">Aufsteigend</option>
          <option value="desc">Absteigend</option>
        </select>
      )}
    </section>
  );
}
