import { useChartSize } from '../../hooks/useChartSize';
import type { BalanceColumn } from './BalanceSheetReport';

const colors = [
  'var(--primary)',
  'var(--accent)',
  'var(--secondary)',
  'var(--text)',
  'var(--primary)',
  'var(--accent)',
  'var(--secondary)',
  'var(--text)',
];
const compact = (value: number) =>
  new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const exact = (value: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);

export default function BalanceSheetStacks({
  columns,
  currency,
  selectedMetricNumber,
  onSelect,
}: {
  columns: BalanceColumn[];
  currency: string;
  selectedMetricNumber?: number;
  onSelect: (metricNumber: number) => void;
}) {
  const { ref, width, height } = useChartSize();
  const segments = [
    ...new Map(
      columns.flatMap((column) => column.segments).map((segment) => [segment.metricNumber, segment])
    ).values(),
  ];
  const color = (number: number) =>
    colors[
      Math.max(
        0,
        segments.findIndex((segment) => segment.metricNumber === number)
      ) % colors.length
    ];
  const extents = columns.map((column) => ({
    positive: column.segments.reduce((sum, segment) => sum + Math.max(segment.value ?? 0, 0), 0),
    negative: column.segments.reduce((sum, segment) => sum + Math.min(segment.value ?? 0, 0), 0),
  }));
  const low = Math.min(0, ...extents.map((extent) => extent.negative));
  const high = Math.max(0, ...extents.map((extent) => extent.positive));
  const span = high - low || 1;
  const top = 30,
    bottom = Math.max(top + 20, height - 38),
    left = width < 400 ? 44 : 62;
  const max = high + span * 0.12,
    min = low < 0 ? low - span * 0.05 : 0;
  const y = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const step = Math.max(1, (width - left - 16) / 2),
    barWidth = Math.min(80, step * 0.25);
  const layouts = columns.map((column, index) => {
    const x = left + step * index + 8;
    const labelX = x + barWidth + 18;
    let positive = 0,
      negative = 0;
    const items = column.segments
      .map((segment) => {
        const value = segment.value ?? 0;
        const start = value >= 0 ? positive : negative;
        const end = start + value;
        if (value >= 0) positive = end;
        else negative = end;
        const rectY = y(Math.max(start, end));
        const rectHeight = Math.abs(y(start) - y(end));
        return { segment, rectY, rectHeight, anchorY: y((start + end) / 2), labelY: 0 };
      })
      .sort((a, b) => a.anchorY - b.anchorY);
    const gap = Math.min(20, (bottom - top - 8) / Math.max(items.length - 1, 1));
    let previous = top - gap;
    for (const item of items) {
      item.labelY = Math.max(top + 4, item.anchorY, previous + gap);
      previous = item.labelY;
    }
    if (items.length && items.at(-1)!.labelY > bottom - 4) {
      items.at(-1)!.labelY = bottom - 4;
      for (let i = items.length - 2; i >= 0; i--)
        items[i].labelY = Math.min(items[i].labelY, items[i + 1].labelY - gap);
    }
    return { x, labelX, items, labelWidth: Math.max(20, left + step * (index + 1) - labelX - 10) };
  });
  return (
    <div className="balance-visual">
      <div className="income-chart-viewport" ref={ref}>
        <svg
          className="income-waterfall"
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Assets und Equity & Liabilities in ${currency}`}
        >
          <title>Balance Sheet · gemeinsame Werteskala</title>
          {Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4).map(
            (tick, index) => (
              <g className="income-axis" key={index}>
                <line x1={left} x2={width - 12} y1={y(tick)} y2={y(tick)} />
                <text x={left - 7} y={y(tick) + 4} textAnchor="end">
                  {compact(tick)}
                </text>
              </g>
            )
          )}
          <line className="income-zero" x1={left} x2={width - 12} y1={y(0)} y2={y(0)} />
          {columns.map((column, index) => {
            const { x, labelX, items, labelWidth } = layouts[index];
            return (
              <g key={column.label}>
                {items.map(({ segment, rectY, rectHeight, anchorY, labelY }) => {
                  const value = segment.value;
                  return (
                    <g
                      key={segment.metricId}
                      className="balance-segment"
                      role="button"
                      tabIndex={0}
                      aria-label={`${segment.label}: ${value === null ? 'Keine Daten' : exact(value)} ${currency}. Verlauf anzeigen.`}
                      onClick={() => onSelect(segment.metricNumber)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(segment.metricNumber);
                        }
                      }}
                    >
                      <title>
                        {segment.label}: {value === null ? 'Keine Daten' : exact(value)} {currency}
                      </title>
                      {value !== null && (
                        <rect
                          x={x}
                          y={rectY}
                          width={barWidth}
                          height={Math.max(rectHeight, 1)}
                          fill={color(segment.metricNumber)}
                          fillOpacity={
                            0.9 -
                            (segments.findIndex(
                              (item) => item.metricNumber === segment.metricNumber
                            ) >= 4
                              ? 0.3
                              : 0)
                          }
                          stroke="var(--surface)"
                          strokeWidth={1}
                        />
                      )}
                      {value !== null && (
                        <path
                          className="balance-label-connector"
                          d={`M ${x + barWidth} ${anchorY} L ${x + barWidth + 6} ${anchorY} L ${labelX - 5} ${labelY}`}
                          fill="none"
                          stroke={color(segment.metricNumber)}
                        />
                      )}
                      <foreignObject x={labelX} y={labelY - 9} width={labelWidth} height={18}>
                        <div
                          className={`balance-direct-label ${selectedMetricNumber === segment.metricNumber ? 'selected' : ''}`}
                        >
                          {segment.label}
                          {value === null ? ' ? keine Daten' : ''}
                        </div>
                      </foreignObject>
                      {value !== null && rectHeight > 24 && (
                        <text
                          x={x + barWidth / 2}
                          y={rectY + rectHeight / 2 + 4}
                          className="balance-segment-value"
                          textAnchor="middle"
                        >
                          {compact(value)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text
                  x={x + barWidth / 2}
                  y={Math.max(16, y(extents[index].positive) - 8)}
                  textAnchor="middle"
                  className="income-value"
                >
                  {column.total === null ? 'Unvollständig' : compact(column.total)}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={height - 12}
                  textAnchor="middle"
                  className="income-label"
                >
                  {column.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
