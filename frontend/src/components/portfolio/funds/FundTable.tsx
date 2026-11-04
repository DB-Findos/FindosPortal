import { useState, type ReactNode } from 'react';
import { Pin } from 'lucide-react';
import { usePinnedColumns } from '../../../hooks/usePinnedColumns';
import ColumnContextMenu from '../../data/ColumnContextMenu';
export default function FundTable({
  name,
  columns,
  rows,
  footer,
}: {
  name: string;
  columns: { key: string; label: ReactNode }[];
  rows: { key: string; cells: Record<string, ReactNode> }[];
  footer?: Record<string, ReactNode>;
}) {
  const pins = usePinnedColumns(
    columns.map((c) => c.key),
    name
  );
  const [menu, setMenu] = useState<{ column: string; x: number; y: number } | null>(null);
  return (
    <>
      <div className="fund-table-scroll">
        <table className="fund-table" ref={pins.tableRef}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  data-column={column.key}
                  style={pins.style(column.key)}
                  className={pins.isPinned(column.key) ? 'pinned-column' : ''}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ column: column.key, x: event.clientX, y: event.clientY });
                  }}
                  title="Rechtsklick: Spalte fixieren"
                >
                  {column.label}
                  {pins.isPinned(column.key) && <Pin size={11} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={pins.style(column.key)}
                    className={pins.isPinned(column.key) ? 'pinned-column' : ''}
                  >
                    {row.cells[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={pins.style(column.key)}
                    className={pins.isPinned(column.key) ? 'pinned-column' : ''}
                  >
                    {footer[column.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {menu && (
        <ColumnContextMenu
          x={menu.x}
          y={menu.y}
          pinned={pins.isPinned(menu.column)}
          onToggle={() => pins.toggle(menu.column)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
