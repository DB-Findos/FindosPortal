import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../../../contexts/ApiContext';
import { useVisibleViewData } from '../../../contexts/ViewContentContext';
import FundStatusOverview from './FundStatusOverview';
import FundCompanyDataDetail from './FundCompanyDataDetail';
import type { FundStatusResponse, FundReportContext } from './types';
export default function FundDataStatus({
  fundId,
  date,
  dimension,
  scope,
  onDateResolved,
}: FundReportContext) {
  const { request } = useApi();
  const [months, setMonths] = useState('12');
  const [selected, setSelected] = useState({ fundId, scope, companyId: '', month: '' });
  const companyId =
    selected.fundId === fundId && selected.scope === scope ? selected.companyId : '';
  const [report, setReport] = useState<FundStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ dimension, scope, months });
    if (date) query.set('date', date);
    const endpoint = `/portfolio/funds/${fundId}/data-status${companyId ? '/' + companyId : ''}`;
    request<FundStatusResponse>(`${endpoint}?${query}`)
      .then((value) => {
        if (active) {
          setReport(value);
          onDateResolved(value.date);
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
  }, [fundId, date, dimension, scope, months, companyId, request, onDateResolved]);
  const current =
    report?.fund.objectId === fundId &&
    (!date || report.date === date) &&
    report.dimension === dimension &&
    report.scope === scope &&
    Boolean(report.detail) === Boolean(companyId) &&
    (!companyId || report.rows[0]?.company.objectId === companyId)
      ? report
      : null;
  useVisibleViewData('Fund Datenstand', {
    fundId,
    date: date || current?.date,
    dimension,
    scope,
    selectedCompany: companyId,
    loading,
    error,
    report: current,
    visualizations: [
      companyId
        ? 'MetricData-Detailmatrix aller Company-Kennzahlen'
        : 'Company-Monatsmatrix: Pflegeampel',
    ],
  });
  return (
    <section className="fund-data-status">
      <div className="fund-status-top">
        <h3>{companyId ? 'Kennzahlendetails' : 'Datenstand nach Company und Monat'}</h3>
        <label>
          Zeitraum{' '}
          <select value={months} onChange={(event) => setMonths(event.target.value)}>
            <option value="12">12 Monate</option>
            <option value="24">24 Monate</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="performance-message error" role="alert">
          {error}
          {companyId && (
            <button
              type="button"
              className="fund-detail-back"
              onClick={() => setSelected({ fundId, scope, companyId: '', month: '' })}
            >
              Zurück zur Übersicht
            </button>
          )}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw size={14} className="performance-spin" />
          Datenstand wird geladen …
        </div>
      )}
      {current &&
        !error &&
        (companyId ? (
          <FundCompanyDataDetail
            key={`${fundId}:${companyId}`}
            report={current}
            focusedMonth={selected.month || current.date}
            onBack={() => setSelected({ fundId, scope, companyId: '', month: '' })}
          />
        ) : (
          <FundStatusOverview
            report={current}
            onCompany={(id, month) =>
              setSelected({ fundId, scope, companyId: id, month: month || current.date })
            }
          />
        ))}
    </section>
  );
}
