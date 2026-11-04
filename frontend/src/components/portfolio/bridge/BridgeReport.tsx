import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { useApi } from '../../../contexts/ApiContext';
import { useReportContext } from '../../../hooks/useReportContext';
import { useVisibleViewData } from '../../../contexts/ViewContentContext';
import BridgeWaterfall from './BridgeWaterfall';
import BridgeEffectsChart from './BridgeEffectsChart';
import { bridgeColors, type BridgeKey, type BridgeResponse } from './bridge-types';
import '../PerformanceUpdateReport.css';
import '../IncomeStatementReport.css';
import './BridgeReport.css';

export default function BridgeReport({ companyId }: { companyId: string }) {
  const { request } = useApi();
  const { date, setDate, currency, setCurrency } = useReportContext(companyId);
  const [dimension, setDimension] = useState('actual');
  const [selection, setSelection] = useState<{ companyId: string; keys: BridgeKey[] }>({
    companyId,
    keys: ['revenue'],
  });
  const selected: BridgeKey[] = selection.companyId === companyId ? selection.keys : ['revenue'];
  const [report, setReport] = useState<BridgeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toggle = (key: BridgeKey) =>
    setSelection({
      companyId,
      keys: selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key],
    });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ currency, dimension });
    if (date) query.set('date', date);
    request<BridgeResponse>(`/portfolio/companies/${companyId}/bridge?${query}`)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyId, date, currency, dimension, request]);
  const current =
    report?.company.objectId === companyId &&
    (!date || report.date === date) &&
    report.currency.mode === currency &&
    report.dimension === dimension
      ? report
      : null;
  useVisibleViewData('Findos Equity Bridge', {
    companyId,
    date: date || current?.date,
    currency,
    dimension,
    loading,
    error,
    selectedEffects: selected,
    report: current,
    visualizations: [
      'Equity-Bridge-Wasserfall',
      '18-Monats-Linienverlauf der ausgewählten Effekte',
    ],
  });
  return (
    <section className="income-statement bridge-report" aria-label="Findos Equity Bridge">
      <div className="performance-toolbar income-toolbar">
        <div className="performance-heading">
          <h2>Findos Equity Bridge</h2>
        </div>
        <div className="performance-pickers income-pickers">
          <label>
            <span>Stichtag</span>
            <span className="performance-input-wrap">
              <CalendarDays size={15} />
              <input
                type="month"
                value={date || current?.date || ''}
                onChange={(event) => setDate(event.target.value)}
              />
            </span>
          </label>
          <label>
            <span>Dimension</span>
            <select value={dimension} onChange={(event) => setDimension(event.target.value)}>
              <option value="actual">Actual</option>
              <option value="budget">Budget</option>
              <option value="plan">Findos Plan</option>
              <option value="forecast">Forecast</option>
            </select>
          </label>
          <label>
            <span>Währung</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as 'CC' | 'EUR')}
            >
              <option value="EUR">EUR · Euro</option>
              <option value="CC">CC · Company Currency</option>
            </select>
          </label>
        </div>
      </div>
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw className="performance-spin" size={14} /> Bridge wird berechnet …
        </div>
      )}
      {current && !error && (
        <>
          <div className="income-charts bridge-charts">
            <div className="income-chart-card">
              <div className="income-chart-meta">
                <span>in Mio. {current.currency.code}</span>
                <span>T0 · Entry bis T1 · {current.date}</span>
              </div>
              <BridgeWaterfall
                bars={current.bars}
                currency={current.currency.code}
                scale={current.valueScale}
                selected={selected}
                toggle={toggle}
              />
            </div>
            <div className="income-chart-card bridge-effects-card">
              <div className="income-chart-meta">
                <h3>Entwicklung der Effekte · letzte 18 Monate</h3>
                <span>in Mio. {current.currency.code}</span>
              </div>
              <div
                className="bridge-effect-selector"
                role="group"
                aria-label="Effekte für den Verlauf auswählen"
              >
                {current.series.map((series) => (
                  <button
                    key={series.key}
                    type="button"
                    aria-pressed={selected.includes(series.key)}
                    onClick={() => toggle(series.key)}
                    className={selected.includes(series.key) ? 'is-selected' : ''}
                  >
                    <i style={{ background: bridgeColors[series.key] }} />
                    {series.label}
                  </button>
                ))}
              </div>
              <BridgeEffectsChart
                series={current.series.filter((series) => selected.includes(series.key))}
                currency={current.currency.code}
                scale={current.valueScale}
              />
            </div>
          </div>
          {current.warnings.length > 0 && (
            <div className="income-warnings" role="status">
              {current.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
