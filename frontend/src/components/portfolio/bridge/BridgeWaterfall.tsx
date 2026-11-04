import { useState } from 'react';
import { useChartSize } from '../../../hooks/useChartSize';
import { bridgeColors, bridgeNumber, type BridgeBar, type BridgeKey } from './bridge-types';

export default function BridgeWaterfall({
  bars,
  selected,
  toggle,
  currency,
  scale,
}: {
  bars: BridgeBar[];
  selected: BridgeKey[];
  toggle: (key: BridgeKey) => void;
  currency: string;
  scale: number;
}) {
  const { ref, width, height } = useChartSize();
  const [focused, setFocused] = useState<BridgeKey | null>(null);
  const active =
    bars.find((bar) => bar.key === focused) ?? bars.find((bar) => selected.includes(bar.key));
  const left = width < 500 ? 44 : 62,
    right = 14,
    top = 24,
    bottom = 62;
  const values = [
    0,
    ...bars.flatMap((bar) => [bar.start, bar.end]).filter((v): v is number => v !== null),
  ];
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.12, 1);
  const low = minimum - padding,
    high = maximum + padding;
  const y = (value: number) => top + ((high - value) / (high - low)) * (height - top - bottom);
  const step = (width - left - right) / Math.max(bars.length, 1),
    barWidth = Math.min(72, step * 0.67);
  return (
    <div className="bridge-waterfall-content">
      <div className="bridge-readout" aria-live="polite">
        <span>{active?.name || 'Findos Equity Bridge'}</span>
        <strong>
          {bridgeNumber(active?.value, scale)} Mio. {currency}
        </strong>
      </div>
      <div className="income-chart-viewport" ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="income-waterfall bridge-waterfall"
          role="group"
          aria-label={`Findos Equity Bridge in Millionen ${currency}`}
        >
          <title>Findos Equity T0 bis Findos Equity T1</title>
          {Array.from({ length: 4 }, (_, index) => {
            const value = low + ((high - low) * index) / 3;
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
          {bars.map((bar, index) => {
            const x = left + step * index + (step - barWidth) / 2;
            const available = bar.start !== null && bar.end !== null && bar.value !== null;
            const previous = bars[index - 1];
            const change = bar.kind === 'change';
            const lines =
              bar.label === 'Findos Equity T0'
                ? ['Findos Equity', 'T0']
                : bar.label === 'Findos Equity T1'
                  ? ['Findos Equity', 'T1']
                  : bar.label.split(' ');
            const selectedBar = change && selected.includes(bar.key);
            return (
              <g
                key={bar.key}
                className="bridge-column"
                tabIndex={0}
                role={change ? 'button' : 'img'}
                aria-label={`${bar.name}: ${bridgeNumber(bar.value, scale)} Millionen ${currency}`}
                aria-pressed={change ? selectedBar : undefined}
                onPointerEnter={() => setFocused(bar.key)}
                onFocus={() => setFocused(bar.key)}
                onClick={() => {
                  setFocused(bar.key);
                  if (change) toggle(bar.key);
                }}
                onKeyDown={(event) => {
                  if (change && (event.key === ' ' || event.key === 'Enter')) {
                    event.preventDefault();
                    toggle(bar.key);
                  }
                }}
              >
                <title>{`${bar.name}: ${bridgeNumber(bar.value, scale)} Mio. ${currency}${bar.message ? `\n${bar.message}` : ''}`}</title>
                <rect
                  className="bridge-hit-area"
                  x={left + step * index}
                  y={top}
                  width={step}
                  height={height - top}
                />
                {index > 0 && previous.end !== null && bar.start !== null && (
                  <line
                    className="income-connector"
                    x1={x - step + barWidth}
                    x2={x}
                    y1={y(previous.end)}
                    y2={y(previous.end)}
                  />
                )}
                {available && (
                  <rect
                    x={x}
                    y={y(Math.max(bar.start!, bar.end!))}
                    width={barWidth}
                    height={Math.max(3, Math.abs(y(bar.start!) - y(bar.end!)))}
                    rx={3}
                    fill={bridgeColors[bar.key]}
                    stroke={selectedBar ? 'var(--text)' : 'none'}
                    strokeWidth={selectedBar ? 2 : 0}
                  />
                )}
                <text
                  className="income-value"
                  x={x + barWidth / 2}
                  y={available ? y(Math.max(bar.start!, bar.end!)) - 8 : y(0) - 8}
                  textAnchor="middle"
                >
                  {step >= 42
                    ? `${change && (bar.value ?? 0) > 0 ? '+' : ''}${bridgeNumber(bar.value, scale)}`
                    : ''}
                </text>
                <text
                  className="income-label"
                  x={x + barWidth / 2}
                  y={height - bottom + 18}
                  textAnchor="middle"
                >
                  {lines.map((line, lineIndex) => (
                    <tspan key={lineIndex} x={x + barWidth / 2} dy={lineIndex ? 14 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
