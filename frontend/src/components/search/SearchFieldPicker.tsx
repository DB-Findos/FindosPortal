import { availableFields, type SearchField, type SearchSource } from '../../types/search';
import { label } from '../../utils/labels';
export default function SearchFieldPicker({
  sources,
  selected,
  onChange,
}: {
  sources: SearchSource[];
  selected: SearchField[];
  onChange: (fields: SearchField[]) => void;
}) {
  return (
    <section className="query-section">
      <h2>
        Ausgabefelder <small>{selected.length}/30</small>
      </h2>
      {sources.map((source) => (
        <fieldset key={source.alias}>
          <legend>
            {source.alias} · {source.entity.label}
          </legend>
          <div className="query-fields">
            {availableFields(source).map((field) => {
              const checked = selected.some((f) => f.alias === source.alias && f.field === field);
              return (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= 30}
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((f) => f.alias !== source.alias || f.field !== field)
                          : [...selected, { alias: source.alias, field }]
                      )
                    }
                  />
                  {label(field)}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </section>
  );
}
