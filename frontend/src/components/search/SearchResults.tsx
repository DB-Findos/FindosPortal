import { useState } from 'react';
import { Pin } from 'lucide-react';
import { usePinnedColumns } from '../../hooks/usePinnedColumns';
import ColumnContextMenu from '../data/ColumnContextMenu';
import type { SearchResult } from '../../types/search';
import { label } from '../../utils/labels';
export default function SearchResults({
  result,
  busy,
  onPage,
}: {
  result: SearchResult | null;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  const pinned = usePinnedColumns(result?.columns || [], 'advanced-search');
  const [menu, setMenu] = useState<{ column: string; x: number; y: number } | null>(null);
  return (
    <section className="query-results">
      <div className="entity-title">
        <h2>Ergebnisse</h2>
        <span className="record-count">
          {result ? result.total + ' Treffer' : 'Suche konfigurieren und ausführen'}
        </span>
      </div>
      <div className="table-wrap" aria-busy={busy}>
        <table ref={pinned.tableRef}>
          <thead>
            <tr>
              {result?.columns.map((column) => (
                <th
                  key={column}
                  data-column={column}
                  tabIndex={0}
                  className={pinned.isPinned(column) ? 'pinned-column' : undefined}
                  style={pinned.style(column)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ column, x: e.clientX, y: e.clientY });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({ column, x: rect.left, y: rect.bottom });
                    }
                  }}
                >
                  {column.split('.')[0]} · {label(column.split('.')[1])}{' '}
                  {pinned.isPinned(column) && <Pin size={11} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((row, index) => (
              <tr key={index}>
                {result.columns.map((column) => (
                  <td
                    key={column}
                    className={pinned.isPinned(column) ? 'pinned-column' : undefined}
                    style={pinned.style(column)}
                    title={String(row[column] ?? '')}
                  >
                    {row[column] === null
                      ? '—'
                      : typeof row[column] === 'boolean'
                        ? row[column]
                          ? 'Ja'
                          : 'Nein'
                        : typeof row[column] === 'object'
                          ? JSON.stringify(row[column])
                          : String(row[column] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!result?.rows.length && (
          <div className="empty">
            {busy ? 'Suche läuft …' : result ? 'Keine Treffer' : 'Noch keine Suche ausgeführt.'}
          </div>
        )}
      </div>
      {result && (
        <div className="pagination">
          <span>
            Seite {result.page} von {Math.max(1, Math.ceil(result.total / result.limit))}
          </span>
          <div>
            <button
              className="secondary"
              disabled={busy || result.page === 1}
              onClick={() => onPage(result.page - 1)}
            >
              Zurück
            </button>
            <button
              className="secondary"
              disabled={busy || result.page * result.limit >= result.total}
              onClick={() => onPage(result.page + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      )}
      {menu && (
        <ColumnContextMenu
          {...menu}
          pinned={pinned.isPinned(menu.column)}
          onToggle={() => pinned.toggle(menu.column)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
