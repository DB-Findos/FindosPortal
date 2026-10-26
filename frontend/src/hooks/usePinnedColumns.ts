import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function usePinnedColumns(columns: string[], entity: string) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  useLayoutEffect(() => setPinned([]), [entity]);
  const signature = columns.join('|');
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const measure = () => {
      let left = 0;
      const next: Record<string, number> = {};
      for (const cell of table.querySelectorAll<HTMLTableCellElement>('thead th[data-column]')) {
        const column = cell.dataset.column!;
        if (pinned.includes(column)) {
          next[column] = left;
          left += cell.getBoundingClientRect().width;
        }
      }
      setOffsets(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    for (const cell of table.querySelectorAll('thead th')) observer.observe(cell);
    return () => observer.disconnect();
  }, [signature, pinned]);
  return {
    tableRef,
    isPinned: (column: string) => pinned.includes(column),
    toggle: (column: string) =>
      setPinned((old) =>
        old.includes(column) ? old.filter((c) => c !== column) : [...old, column]
      ),
    style: (column: string): CSSProperties | undefined =>
      pinned.includes(column) ? { position: 'sticky', left: offsets[column] ?? 0 } : undefined,
  };
}
