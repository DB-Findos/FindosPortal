import { useState } from 'react';
import { useChartSize } from '../../hooks/useChartSize';

export type MetricHistory = {
  metricId: string;
  label: string;
  metricNumber: number;
  points: { month: string; value: number | null; ltm: number | null }[];
};
const compact = (value: number) =>
  new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const exact = (value: number | null | undefined) =>
  value == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);

function scale(values: number[], top: number, bottom: number, includeZero: boolean) {
  const data = includeZero ? [0, ...values] : values.length ? values : [0, 1];
  const low = Math.min(...data),
    high = Math.max(...data);
  const span = high - low || Math.max(Math.abs(high) * 0.1, 1);
  const min = includeZero && low >= 0 ? 0 : low - span * 0.1;
  const max = high + span * 0.15;
  return { min, max, y: (value: number) => top + ((max - value) / (max - min)) * (bottom - top) };
}

export default function MetricHistoryChart({
  history,
  currency,
}: {
  history: MetricHistory;
  currency: string;
}) {
  const { ref, width, height } = useChartSize();
  const [selectedMonth, setSelectedMonth] = useState('');
  const activePoint =
    history.points.find((point) => point.month === selectedMonth) ?? history.points.at(-1);
  const narrow = width < 600;
  const left = narrow ? 46 : 64,
    right = narrow ? 50 : 70,
    top = 24,
    bottom = height - 32;
  const monthScale = scale(
    history.points.map((point) => point.value).filter((v): v is number => v !== null),
    top,
    bottom,
    true
  );
  const ltmValues = history.points.map((point) => point.ltm).filter((v): v is number => v != null);
  const ltmScale = scale(ltmValues, top, bottom, false);
  const step = (width - left - right) / Math.max(history.points.length, 1);
  const labelInterval = Math.max(1, Math.ceil(38 / step));
  let connected = false;
  const ltmPath = history.points
    .map((point, index) => {
      if (point.ltm == null) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command} ${left + step * (index + 0.5)} ${ltmScale.y(point.ltm)}`;
    })
    .join(' ');
  return (
    <div className="income-history-content">
      <div className="income-series-readout" aria-live="polite">
        <span>
          {activePoint?.month &&
            new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' }).format(
              new Date(`${activePoint.month}-01T00:00:00`)
            )}
        </span>
        <span>
          Monat <strong>{exact(activePoint?.value)}</strong> · {currency}
        </span>
        <span className="income-ltm-readout">
          LTM <strong>{exact(activePoint?.ltm)}</strong> · {currency}
        </span>
      </div>
      <div className="income-chart-viewport" ref={ref}>
        <svg
          className="income-waterfall income-history-chart"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${history.label}: Monatswerte links und monatliche LTM-Entwicklung rechts in ${currency}`}
        >
          <title>{history.label} · Monatswerte und LTM-Entwicklung</title>
          <desc>
            Jeder Linienpunkt zeigt den Wert der ausgewählten Kennzahl für die zwölf Monate bis
            einschließlich dieses Monats. Ohne vollständige Zwölfmonatsbasis bleibt eine Lücke.
          </desc>
          <text className="income-axis-title" x={left} y={13}>
            Monat
          </text>
          <text className="income-ltm-axis-title" x={width - right} y={13} textAnchor="end">
            LTM · 12 Monate
          </text>
          {Array.from({ length: 4 }, (_, index) => {
            const value = monthScale.min + ((monthScale.max - monthScale.min) * index) / 3;
            const ltm = ltmScale.min + ((ltmScale.max - ltmScale.min) * index) / 3;
            return (
              <g key={index}>
                <g className="income-axis">
                  <line
                    x1={left}
                    x2={width - right}
                    y1={monthScale.y(value)}
                    y2={monthScale.y(value)}
                  />
                  <text x={left - 8} y={monthScale.y(value) + 4} textAnchor="end">
                    {compact(value)}
                  </text>
                </g>
                <g className="income-ltm-axis">
                  <text x={width - right + 8} y={ltmScale.y(ltm) + 4}>
                    {ltmValues.length ? compact(ltm) : '–'}
                  </text>
                </g>
              </g>
            );
          })}
          <line
            className="income-zero"
            x1={left}
            x2={width - right}
            y1={monthScale.y(0)}
            y2={monthScale.y(0)}
          />
          {activePoint && (
            <line
              className="income-history-cursor"
              x1={left + step * (history.points.indexOf(activePoint) + 0.5)}
              x2={left + step * (history.points.indexOf(activePoint) + 0.5)}
              y1={top}
              y2={bottom}
            />
          )}
          {history.points.map((point, index) => {
            const center = left + step * (index + 0.5),
              value = point.value;
            const text = `${point.month}: Monat ${exact(value)}, LTM ${exact(point.ltm)} ${currency}`;
            return (
              <g
                key={point.month}
                className={`income-bar income-history-month ${value !== null && value < 0 ? 'is-negative' : 'is-total'}`}
                tabIndex={0}
                role="button"
                aria-label={text}
                aria-pressed={activePoint?.month === point.month}
                onPointerEnter={() => setSelectedMonth(point.month)}
                onClick={() => setSelectedMonth(point.month)}
                onFocus={() => setSelectedMonth(point.month)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedMonth(point.month);
                  }
                }}
              >
                <title>{text}</title>
                <rect
                  className="income-hit-area"
                  x={center - step / 2}
                  y={top}
                  width={step}
                  height={bottom - top}
                />
                {value !== null && (
                  <rect
                    x={center - step * 0.3}
                    y={monthScale.y(Math.max(0, value))}
                    width={step * 0.6}
                    height={Math.max(2, Math.abs(monthScale.y(value) - monthScale.y(0)))}
                    rx={2}
                  />
                )}
                {step >= 48 && value !== null && (
                  <text
                    className="income-value"
                    x={center}
                    y={monthScale.y(Math.max(0, value)) - 6}
                    textAnchor="middle"
                  >
                    {compact(value)}
                  </text>
                )}
                {((index % labelInterval === 0 && index < history.points.length - labelInterval) ||
                  index === history.points.length - 1) && (
                  <text className="income-label" x={center} y={height - 10} textAnchor="middle">
                    {point.month.slice(5)}/{point.month.slice(2, 4)}
                  </text>
                )}
              </g>
            );
          })}
          <path className="income-ltm-line" d={ltmPath} />
          {history.points.map((point, index) =>
            point.ltm == null ? null : (
              <circle
                key={point.month}
                className="income-ltm-point"
                cx={left + step * (index + 0.5)}
                cy={ltmScale.y(point.ltm)}
                r={activePoint?.month === point.month ? 4 : 2.5}
                onPointerEnter={() => setSelectedMonth(point.month)}
                onClick={() => setSelectedMonth(point.month)}
              >
                <title>{`${point.month} · LTM: ${exact(point.ltm)} ${currency}`}</title>
              </circle>
            )
          )}
        </svg>
      </div>
    </div>
  );
}
