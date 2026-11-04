import { useState } from 'react';
import { useChartSize } from '../../../hooks/useChartSize';
import { bridgeColors, bridgeNumber, type BridgeSeries } from './bridge-types';

export default function BridgeEffectsChart({
  series,
  currency,
  scale,
}: {
  series: BridgeSeries[];
  currency: string;
  scale: number;
}) {
  const { ref, width, height } = useChartSize();
  const [selectedMonth, setSelectedMonth] = useState('');
  const months = series[0]?.points.map((point) => point.month) ?? [];
  const activeMonth = months.includes(selectedMonth) ? selectedMonth : months.at(-1);
  const left = width < 500 ? 44 : 62,
    right = 18,
    top = 22,
    bottom = height - 32;
  const values = [
    0,
    ...series
      .flatMap((item) => item.points.map((point) => point.value))
      .filter((v): v is number => v !== null),
  ];
  const low = Math.min(...values),
    high = Math.max(...values),
    padding = Math.max((high - low) * 0.12, 1);
  const minimum = low - padding,
    maximum = high + padding;
  const y = (value: number) => top + ((maximum - value) / (maximum - minimum)) * (bottom - top);
  const step = (width - left - right) / Math.max(months.length - 1, 1);
  const interval = Math.max(1, Math.ceil(42 / step));
  return (
    <div className="bridge-history-content">
      <div className="bridge-series-readout" aria-live="polite">
        <span>{activeMonth}</span>
        {series.map((item) => (
          <span key={item.key}>
            <i style={{ background: bridgeColors[item.key] }} />
            {item.label}{' '}
            <strong>
              {bridgeNumber(item.points.find((point) => point.month === activeMonth)?.value, scale)}
            </strong>
          </span>
        ))}
      </div>
      <div className="income-chart-viewport" ref={ref}>
        {series.some((item) => item.points.some((point) => point.value !== null)) ? (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="income-waterfall"
            role="img"
            aria-label={`Entwicklung der ausgewählten Bridge-Effekte in Millionen ${currency}`}
          >
            <title>Entwicklung der ausgewählten Effekte über die letzten 18 Monate</title>
            {Array.from({ length: 4 }, (_, index) => {
              const value = minimum + ((maximum - minimum) * index) / 3;
              return (
                <g className="income-axis" key={index}>
                  <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
                  <text x={left - 8} y={y(value) + 4} textAnchor="end">
                    {bridgeNumber(value, scale)}
                  </text>
                </g>
              );
            })}
            <line className="income-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
            {months.map((month, index) => {
              const x = left + step * index;
              return (
                <g
                  key={month}
                  tabIndex={0}
                  className="bridge-month"
                  onPointerEnter={() => setSelectedMonth(month)}
                  onClick={() => setSelectedMonth(month)}
                  onFocus={() => setSelectedMonth(month)}
                  aria-label={`${month}: ${series.map((item) => `${item.label} ${bridgeNumber(item.points[index]?.value, scale)}`).join(', ')} Millionen ${currency}`}
                >
                  <rect
                    className="bridge-hit-area"
                    x={Math.max(left, x - step / 2)}
                    y={top}
                    width={index === 0 || index === months.length - 1 ? step / 2 : step}
                    height={bottom - top}
                  />
                  {month === activeMonth && (
                    <line className="income-history-cursor" x1={x} x2={x} y1={top} y2={bottom} />
                  )}
                  {((index % interval === 0 && index < months.length - interval) ||
                    index === months.length - 1) && (
                    <text className="income-label" x={x} y={height - 10} textAnchor="middle">
                      {month.slice(5)}/{month.slice(2, 4)}
                    </text>
                  )}
                </g>
              );
            })}
            {series.map((item) => {
              let connected = false;
              const path = item.points
                .map((point, index) => {
                  if (point.value === null) {
                    connected = false;
                    return '';
                  }
                  const command = connected ? 'L' : 'M';
                  connected = true;
                  return `${command} ${left + step * index} ${y(point.value)}`;
                })
                .join(' ');
              return (
                <g key={item.key}>
                  <path
                    d={path}
                    fill="none"
                    stroke={bridgeColors[item.key]}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                  {item.points.map((point, index) =>
                    point.value === null ? null : (
                      <circle
                        key={point.month}
                        cx={left + step * index}
                        cy={y(point.value)}
                        r={point.month === activeMonth ? 4 : 2.5}
                        fill="var(--surface)"
                        stroke={bridgeColors[item.key]}
                        strokeWidth={2}
                        onPointerEnter={() => setSelectedMonth(point.month)}
                        onClick={() => setSelectedMonth(point.month)}
                      >
                        <title>{`${item.label}, ${point.month}: ${bridgeNumber(point.value, scale)} Mio. ${currency}`}</title>
                      </circle>
                    )
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="income-empty">
            {series.length
              ? 'Für die ausgewählten Effekte sind in diesem Zeitraum keine Werte verfügbar.'
              : 'Wähle mindestens einen Effekt für den Verlauf aus.'}
          </div>
        )}
      </div>
    </div>
  );
}
