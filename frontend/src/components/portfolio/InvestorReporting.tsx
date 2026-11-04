import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { useReportContext } from '../../hooks/useReportContext';
import { useVisibleViewData } from '../../contexts/ViewContentContext';
import InvestorQuarterCard, { type InvestorQuarter } from './InvestorQuarterCard';
import './PerformanceUpdateReport.css';
import './InvestorReporting.css';

type Report = {
  company: { objectId: string; name: string; internal_name: string | null };
  date: string;
  currency: { mode: string; code: string };
  quarters: InvestorQuarter[];
};
export default function InvestorReporting({ companyId }: { companyId: string }) {
  const { request } = useApi();
  const { date, setDate } = useReportContext(companyId);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    request<Report>(`/portfolio/companies/${companyId}/investor-reporting?${query}`)
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
  }, [companyId, date, request]);
  const current =
    report?.company.objectId === companyId &&
    (!date || report.date === date) &&
    report.currency.mode === 'EUR'
      ? report
      : null;
  useVisibleViewData('Investoren Reporting', {
    companyId,
    date: date || current?.date,
    currency: 'EUR',
    loading,
    error,
    report: current,
    visualizations: ['Letzte vier Quartale: IR-Kennzahlen, Margen, Abweichungen und Kommentare'],
  });
  return (
    <section className="investor-reporting" aria-label="Investoren Reporting">
      <div className="performance-toolbar">
        <div className="performance-heading">
          <h2>Investoren Reporting</h2>
        </div>
        <div className="performance-pickers">
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
        </div>
      </div>
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw size={14} className="performance-spin" /> Investoren Reporting wird geladen …
        </div>
      )}
      {current && !error && (
        <div className="investor-quarter-list">
          {current.quarters.map((quarter) => (
            <InvestorQuarterCard
              key={quarter.period}
              quarter={quarter}
              currency={current.currency.code}
            />
          ))}
          {!current.quarters.length && (
            <div className="company-empty-report">
              <p>Für diese Company sind noch keine IR-Quartalskennzahlen verfügbar.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
