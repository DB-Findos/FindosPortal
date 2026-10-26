import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Columns3 } from 'lucide-react';

export function readSelectedFields(entity: string): string[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`findos:visible-fields:${entity}`) || 'null');
    if (
      entity === 'metric_data' &&
      Array.isArray(saved) &&
      !localStorage.getItem('findos:metric-data-details-v1')
    ) {
      const migrated = [
        ...new Set([
          ...saved.map((field) => (field === 'scenario' ? 'dimension' : field)),
          'company_id',
          'name',
          'currency',
          'dimension',
        ]),
      ];
      localStorage.setItem(`findos:visible-fields:${entity}`, JSON.stringify(migrated));
      localStorage.setItem('findos:metric-data-details-v1', '1');
      return migrated;
    }
    return Array.isArray(saved) &&
      saved.length > 0 &&
      saved.every((field) => typeof field === 'string')
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function saveSelectedFields(entity: string, fields: string[]) {
  try {
    localStorage.setItem(`findos:visible-fields:${entity}`, JSON.stringify(fields));
  } catch {
    /* The current selection still works when browser storage is disabled. */
  }
}

export default function FieldSelector({
  fields,
  selected,
  label,
  onChange,
}: {
  fields: string[];
  selected: string[];
  label: (field: string) => string;
  onChange: (fields: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const position = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(310, window.innerWidth - 48);
      const below = window.innerHeight - rect.bottom - 32;
      const above = rect.top - 32;
      const useBelow = below >= Math.min(400, above);
      setPanelStyle({
        position: 'fixed',
        width,
        left: Math.max(24, Math.min(rect.right - width, window.innerWidth - width - 24)),
        right: 'auto',
        top: useBelow ? rect.bottom + 8 : 'auto',
        bottom: useBelow ? 'auto' : window.innerHeight - rect.top + 8,
        maxHeight: Math.max(0, useBelow ? below : above),
      });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className="field-selector"
      ref={container}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Columns3 size={16} /> Felder{' '}
        <span className="field-selector-count">
          {selected.length}/{fields.length}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          id={panelId}
          className="field-selector-panel"
          style={panelStyle}
          role="group"
          aria-label="Sichtbare Tabellenfelder"
        >
          <div className="field-selector-heading">
            <strong>Sichtbare Felder</strong>
            <button type="button" className="text-button" onClick={() => onChange(fields)}>
              Alle anzeigen
            </button>
          </div>
          <div className="field-selector-options">
            {fields.map((field) => (
              <label key={field} className="field-selector-option">
                <input
                  type="checkbox"
                  checked={selected.includes(field)}
                  disabled={selected.length === 1 && selected.includes(field)}
                  onChange={(event) =>
                    onChange(
                      fields.filter((name) =>
                        name === field ? event.target.checked : selected.includes(name)
                      )
                    )
                  }
                />
                <span>{label(field)}</span>
                <code>{field}</code>
              </label>
            ))}
          </div>
          <p>Mindestens ein Feld bleibt sichtbar.</p>
        </div>
      )}
    </div>
  );
}
