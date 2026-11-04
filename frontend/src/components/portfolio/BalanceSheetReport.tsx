import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { useVisibleViewData } from '../../contexts/ViewContentContext';
import type { FinancialContext } from './FinancialsReport';
import MetricHistoryChart, { type MetricHistory } from './MetricHistoryChart';
import BalanceSheetStacks from './BalanceSheetStacks';

export type BalanceMetric = {
  metricId: string;
  metricNumber: number;
  label: string;
  value: number | null;
};
export type BalanceColumn = { label: string; total: number | null; segments: BalanceMetric[] };
type BalanceReport = {
  company: { objectId: string };
  date: string;
  dimension: string;
  currency: { mode: string; code: string };
  cards: BalanceMetric[];
  columns: BalanceColumn[];
  history: MetricHistory[];
  warnings: string[];
};
const format = (value: number | null) =>
  value === null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);

export default function BalanceSheetReport({
  companyId,
  date,
  currency,
  dimension,
  onDateResolved,
}: FinancialContext & { onDateResolved: (date: string) => void }) {
  const { request } = useApi();
  const [report, setReport] = useState<BalanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedNumber, setSelectedNumber] = useState(2000000);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ currency, dimension });
    if (date) query.set('date', date);
    request<BalanceReport>(`/portfolio/companies/${companyId}/balance-sheet?${query}`)
      .then((data) => {
        if (active) {
          setReport(data);
          onDateResolved(data.date);
        }
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
  }, [companyId, date, currency, dimension, request, onDateResolved]);
  const current =
    report?.company.objectId === companyId &&
    (!date || report.date === date) &&
    report.dimension === dimension &&
    report.currency.mode === currency
      ? report
      : null;
  const history =
    current?.history.find((metric) => metric.metricNumber === selectedNumber) ??
    current?.history[0];
  useVisibleViewData('Balance Sheet', {
    companyId,
    date: date || current?.date,
    currency,
    dimension,
    loading,
    error,
    report: current,
    selectedMetric: history?.metricNumber,
    visualizations: [
      'Assets und Equity & Liabilities: gestapelte Bilanz',
      '18-Monats-Verlauf: Monatsbalken und Running LTM',
    ],
  });
  return (
    <section className="income-statement" aria-label="Balance Sheet">
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw size={14} className="performance-spin" /> Bilanz wird geladen …
        </div>
      )}
      {current && !error && (
        <>
          <div className="balance-kpis">
            {current.cards.map((card) => (
              <button
                type="button"
                className={history?.metricNumber === card.metricNumber ? 'selected' : ''}
                key={card.metricNumber}
                disabled={!card.metricId}
                onClick={() => setSelectedNumber(card.metricNumber)}
              >
                <span>{card.label}</span>
                <strong>{format(card.value)}</strong>
                <small>{current.currency.code}</small>
              </button>
            ))}
          </div>
          <div className="income-charts">
            <div className="income-chart-card">
              <div className="income-chart-meta">
                <h3>Balance Sheet</h3>
                <span>in {current.currency.code} · Stichtagswerte</span>
              </div>
              <BalanceSheetStacks
                columns={current.columns}
                currency={current.currency.code}
                selectedMetricNumber={history?.metricNumber}
                onSelect={setSelectedNumber}
              />
            </div>
            {history && (
              <div className="income-chart-card income-history-card">
                <div className="income-chart-meta">
                  <h3>{history.label} · letzte 18 Monate</h3>
                  <span>Monat links · LTM rechts · {current.currency.code}</span>
                </div>
                <MetricHistoryChart history={history} currency={current.currency.code} />
              </div>
            )}
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
