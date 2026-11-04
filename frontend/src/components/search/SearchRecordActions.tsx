import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Entity } from '../../types/api';
import type { SearchRecordRef } from '../../types/search';
import './SearchRecordActions.css';

const managedElsewhere = new Set([
  'entities',
  'kpi_formulas',
  'variable_map',
  'report_definitions',
  'report_items',
  'search_views',
]);
export function editableSearchEntity(entity?: Entity) {
  return Boolean(
    entity &&
    !entity.readonly &&
    entity.permissions.can_update &&
    !managedElsewhere.has(entity.name)
  );
}
export default function SearchRecordActions({
  records,
  entities,
  busy,
  onEdit,
}: {
  records: Record<string, SearchRecordRef | null>;
  entities: Entity[];
  busy: boolean;
  onEdit: (record: SearchRecordRef) => void;
}) {
  const [selected, setSelected] = useState('root');
  const editable = Object.entries(records).filter((entry): entry is [string, SearchRecordRef] =>
    Boolean(
      entry[1] && editableSearchEntity(entities.find((entity) => entity.name === entry[1]?.entity))
    )
  );
  const target = editable.find(([alias]) => alias === selected) ?? editable[0];
  if (!target) return <span className="muted">—</span>;
  const name =
    entities.find((entity) => entity.name === target[1].entity)?.label ?? target[1].entity;
  return (
    <div className="search-record-actions">
      {editable.length > 1 && (
        <select
          aria-label="Datensatz zum Bearbeiten auswählen"
          value={target[0]}
          disabled={busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          {editable.map(([alias, record]) => (
            <option value={alias} key={alias}>
              {entities.find((entity) => entity.name === record.entity)?.label ?? record.entity}
              {alias === 'root' ? '' : ` · ${alias}`}
            </option>
          ))}
        </select>
      )}
      <button
        className="icon"
        type="button"
        disabled={busy}
        aria-label={`${name} bearbeiten`}
        title={`${name} bearbeiten`}
        onClick={() => onEdit(target[1])}
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}
