import type { IncomeBar } from './IncomeStatementReport';
import { useChartSize } from '../../hooks/useChartSize';

const exact = (value: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);
const compact = (value: number) =>
  new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function wrapLabel(label: string) {
  const lines: string[] = [];
  for (const word of label.split(/\s+/)) {
    const last = lines.at(-1);
    if (last && last.length + word.length < 21) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

export default function IncomeWaterfall({
  bars,
  currency,
  selectedMetricId,
  onSelect,
}: {
  bars: IncomeBar[];
  currency: string;
  selectedMetricId?: string;
  onSelect: (metricId: string) => void;
}) {
  const { ref, width, height } = useChartSize();
  const compactLayout = width < 720;
  const left = compactLayout ? 48 : 66,
    right = 12,
    top = 26,
    bottom = 98;
  const values = [
    0,
    ...bars.flatMap((bar) => [bar.start, bar.end]).filter((v): v is number => v !== null),
  ];
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const min = minimum - span * 0.08,
    max = maximum + span * 0.12;
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const step = (width - left - right) / bars.length,
    barWidth = Math.min(56, step * 0.55);
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  return (
    <div className="income-chart-viewport" ref={ref}>
      <svg
        className="income-waterfall"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Income Statement Wasserfall von Revenue bis Net Income in ${currency}`}
      >
        <title>Revenue to Net Income</title>
        <desc>
          Die Positionen folgen den Metric Formulas der ausgewählten Company. Summen beginnen bei
          null, Bewegungen schließen an den vorherigen Wert an. Fehlende Daten sind als solche
          markiert.
        </desc>
        {ticks.map((tick, index) => (
          <g key={index} className="income-axis">
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text x={left - 12} y={y(tick) + 4} textAnchor="end">
              {compact(tick)}
            </text>
          </g>
        ))}
        <line className="income-zero" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {bars.map((bar, index) => {
          const x = left + step * index + (step - barWidth) / 2;
          const available = bar.start !== null && bar.end !== null && bar.value !== null;
          const previous = bars[index - 1];
          const position = available ? y(Math.max(bar.start!, bar.end!)) : y(0);
          const size = available ? Math.max(2, Math.abs(y(bar.start!) - y(bar.end!))) : 0;
          const color =
            bar.kind === 'total'
              ? 'is-total'
              : bar.value !== null && bar.value >= 0
                ? 'is-positive'
                : 'is-negative';
          return (
            <g
              key={bar.key}
              className={`income-bar income-selectable ${color}${selectedMetricId === bar.metricId ? ' is-selected' : ''}`}
              tabIndex={0}
              role="button"
              aria-pressed={selectedMetricId === bar.metricId}
              aria-label={`${bar.label}: 18-Monats-Verlauf anzeigen`}
              onClick={() => onSelect(bar.metricId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(bar.metricId);
                }
              }}
            >
              <rect
                className="income-hit-area"
                x={left + step * index}
                y={top}
                width={step}
                height={height - top}
              />
              <title>{`${bar.label} · Metric ${bar.metricNumber}\n${bar.value === null ? 'Keine Daten' : `${exact(bar.value)} ${currency}`}`}</title>
              {index > 0 && previous.end !== null && bar.start !== null && (
                <line
                  className="income-connector"
                  x1={x - step + barWidth}
                  x2={x}
                  y1={y(previous.end)}
                  y2={y(previous.end)}
                />
              )}
              {available && <rect x={x} y={position} width={barWidth} height={size} rx={3} />}
              <text
                className="income-value"
                x={x + barWidth / 2}
                y={available ? position - 10 : y(0) - 10}
                textAnchor="middle"
              >
                {step >= 58 || (step >= 38 && selectedMetricId === bar.metricId)
                  ? bar.value === null
                    ? '–'
                    : compact(bar.value)
                  : ''}
              </text>
              {(step >= 36 ||
                index % Math.ceil(60 / step) === 0 ||
                selectedMetricId === bar.metricId ||
                index === bars.length - 1) && (
                <text
                  className="income-label"
                  x={x + barWidth / 2}
                  y={height - bottom + 24}
                  textAnchor={step < 75 ? 'end' : 'middle'}
                  transform={
                    step < 75
                      ? `rotate(-40, ${x + barWidth / 2}, ${height - bottom + 24})`
                      : undefined
                  }
                >
                  {(step < 75
                    ? [bar.label.length > 18 ? `${bar.label.slice(0, 16)}…` : bar.label]
                    : wrapLabel(bar.label)
                  ).map((line, lineIndex) => (
                    <tspan key={lineIndex} x={x + barWidth / 2} dy={lineIndex ? 15 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
