import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import IncomeWaterfall from './IncomeWaterfall';
import MetricHistoryChart, { type MetricHistory } from './MetricHistoryChart';
import type { FinancialContext } from './FinancialsReport';
import { useVisibleViewData } from '../../contexts/ViewContentContext';
import './PerformanceUpdateReport.css';
import './IncomeStatementReport.css';

export type IncomeBar = {
  key: string;
  label: string;
  metricId: string;
  metricNumber: number;
  kind: 'total' | 'change';
  value: number | null;
  start: number | null;
  end: number | null;
  formula: string | null;
};
type Report = {
  company: { objectId: string };
  date: string;
  dimension: string;
  aggregation: string;
  currency: { mode: string; code: string };
  bars: IncomeBar[];
  warnings: string[];
  history: MetricHistory[];
};
export default function IncomeStatementReport({
  companyId,
  date,
  currency,
  aggregation,
  dimension,
  onDateResolved,
}: FinancialContext & { onDateResolved: (date: string) => void }) {
  const { request } = useApi();
  const [selectedMetric, setSelectedMetric] = useState({ companyId, metricId: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ currency, aggregation, dimension });
    if (date) query.set('date', date);
    request<Report>(`/portfolio/companies/${companyId}/income-statement?${query}`)
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
  }, [companyId, date, currency, aggregation, dimension, request, onDateResolved]);

  const currentReport =
    report?.company.objectId === companyId &&
    (!date || report.date === date) &&
    report.currency.mode === currency &&
    report.aggregation === aggregation &&
    report.dimension === dimension
      ? report
      : null;
  const selectedHistory =
    currentReport?.history.find(
      (item) => selectedMetric.companyId === companyId && item.metricId === selectedMetric.metricId
    ) ??
    currentReport?.history.find((item) => item.metricNumber === 1000000) ??
    currentReport?.history[0];

  useVisibleViewData('Income Statement', {
    companyId,
    date: date || currentReport?.date,
    currency,
    aggregation,
    dimension,
    loading,
    error,
    selectedMetric: selectedHistory?.metricNumber,
    report: currentReport,
    visualizations: [
      'Revenue-to-Net-Income-Wasserfall',
      '18-Monats-Verlauf: Monatsbalken und Running-LTM-Linie',
    ],
  });
  return (
    <section className="income-statement" aria-label="Income Statement">
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw className="performance-spin" size={14} /> Income Statement wird geladen …
        </div>
      )}
      {currentReport && !error && (
        <>
          <div className="income-charts">
            <div className="income-chart-card">
              <div className="income-chart-meta">
                <span>in {currentReport.currency.code}</span>
                <div className="income-legend" aria-label="Legende">
                  <span>
                    <i className="is-total" />
                    Summe
                  </span>
                  <span>
                    <i className="is-positive" />
                    Zunahme
                  </span>
                  <span>
                    <i className="is-negative" />
                    Abnahme
                  </span>
                </div>
              </div>
              {currentReport.bars.length ? (
                <IncomeWaterfall
                  bars={currentReport.bars}
                  currency={currentReport.currency.code}
                  selectedMetricId={selectedHistory?.metricId}
                  onSelect={(metricId) => setSelectedMetric({ companyId, metricId })}
                />
              ) : (
                <div className="income-empty">
                  Für diese Company und Dimension ist noch keine auswertbare Formelstruktur
                  vorhanden.
                </div>
              )}
            </div>
            {selectedHistory && (
              <div className="income-chart-card income-history-card">
                <div className="income-chart-meta">
                  <h3>{selectedHistory.label} · letzte 18 Monate</h3>
                  <span>Monat links · LTM rechts · {currentReport.currency.code}</span>
                </div>
                <MetricHistoryChart
                  history={selectedHistory}
                  currency={currentReport.currency.code}
                />
              </div>
            )}
          </div>
          {currentReport.warnings.length > 0 && (
            <div className="income-warnings" role="status">
              {currentReport.warnings.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
