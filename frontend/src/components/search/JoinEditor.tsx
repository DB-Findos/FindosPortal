import type { Entity } from '../../types/api';
import type { SearchJoin, SearchSource } from '../../types/search';
import { label } from '../../utils/labels';
export default function JoinEditor({
  joins,
  sources,
  entities,
  onChange,
}: {
  joins: SearchJoin[];
  sources: SearchSource[];
  entities: Entity[];
  onChange: (joins: SearchJoin[]) => void;
}) {
  const options = sources.flatMap((source) =>
    source.entity.fields
      .filter((f) => f.reference && entities.some((e) => e.name === f.reference))
      .map((f) => ({
        value: source.alias + '.' + f.name,
        text:
          source.alias +
          ' · ' +
          label(f.name) +
          ' → ' +
          entities.find((e) => e.name === f.reference)!.label,
      }))
  );
  return (
    <section className="query-section">
      <h2>Verknüpfte Entities</h2>
      <p>INNER JOIN zeigt nur Treffer mit Referenz. LEFT JOIN behält auch Zeilen ohne Referenz.</p>
      {joins.map((join, index) => (
        <div className="query-row" key={join.alias}>
          <code>{join.alias}</code>
          <span>
            {join.from}.{label(join.field)}
          </span>
          <select
            aria-label={'Join-Typ ' + join.alias}
            value={join.type}
            onChange={(e) =>
              onChange(
                joins.map((j, i) =>
                  i === index ? { ...j, type: e.target.value as SearchJoin['type'] } : j
                )
              )
            }
          >
            <option value="inner">INNER JOIN</option>
            <option value="left">LEFT JOIN</option>
          </select>
          <button
            type="button"
            className="secondary"
            onClick={() => onChange(joins.slice(0, index))}
          >
            Entfernen
          </button>
        </div>
      ))}
      <select
        aria-label="Referenz verknüpfen"
        value=""
        disabled={joins.length >= 8}
        onChange={(e) => {
          if (!e.target.value) return;
          const [from, field] = e.target.value.split('.');
          onChange([...joins, { alias: 'j' + (joins.length + 1), from, field, type: 'inner' }]);
        }}
      >
        <option value="">+ Referenz verknüpfen …</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </section>
  );
}
