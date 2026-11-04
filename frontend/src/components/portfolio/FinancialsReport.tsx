import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useReportContext } from '../../hooks/useReportContext';
import IncomeStatementReport from './IncomeStatementReport';
import BalanceSheetReport from './BalanceSheetReport';
import './PerformanceUpdateReport.css';
import './IncomeStatementReport.css';
import './FinancialsReport.css';

export type FinancialContext = {
  companyId: string;
  date: string;
  currency: 'CC' | 'EUR';
  dimension: string;
  aggregation: string;
};
const views = [
  ['income-statement', 'Income Statement'],
  ['balance-sheet', 'Balance Sheet'],
  ['cashflow', 'Cashflow'],
  ['cross-portfolio-kpis', 'Cross Portfolio KPIs'],
] as const;

export default function FinancialsReport({ companyId }: { companyId: string }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('financialView') || params.get('tab');
  const view = views.find(([key]) => key === requested)?.[0] || 'income-statement';
  const { date, setDate, currency, setCurrency } = useReportContext(companyId);
  const [resolvedDate, setResolvedDate] = useState({ companyId, date: '' });
  const [aggregation, setAggregation] = useState('MONTH');
  const [dimension, setDimension] = useState('actual');
  const context = { companyId, date, currency, dimension, aggregation };
  const changeView = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'financials');
    next.set('financialView', value);
    setParams(next);
  };
  const onDateResolved = useCallback(
    (value: string) => setResolvedDate({ companyId, date: value }),
    [companyId]
  );
  return (
    <section className="financials-report" aria-label="Financials">
      <div className="performance-toolbar income-toolbar">
        <div className="performance-pickers income-pickers financials-pickers">
          <label>
            <span>Ansicht</span>
            <select value={view} onChange={(event) => changeView(event.target.value)}>
              {views.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Stichtag</span>
            <span className="performance-input-wrap">
              <CalendarDays size={15} />
              <input
                type="month"
                value={date || (resolvedDate.companyId === companyId ? resolvedDate.date : '')}
                onChange={(event) => setDate(event.target.value)}
              />
            </span>
          </label>
          {view === 'income-statement' && (
            <label>
              <span>Zeitraum</span>
              <select value={aggregation} onChange={(event) => setAggregation(event.target.value)}>
                <option value="MONTH">Monat</option>
                <option value="YTD">YTD</option>
                <option value="LTM">LTM</option>
              </select>
            </label>
          )}
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
              <option value="CC">CC · Company Currency</option>
              <option value="EUR">EUR · Euro</option>
            </select>
          </label>
        </div>
      </div>
      {view === 'income-statement' ? (
        <IncomeStatementReport {...context} onDateResolved={onDateResolved} />
      ) : view === 'balance-sheet' ? (
        <BalanceSheetReport {...context} onDateResolved={onDateResolved} />
      ) : (
        <div className="company-empty-report">
          <span>{views.find(([key]) => key === view)?.[1]}</span>
          <p>Für diese Ansicht ist noch kein Bericht eingerichtet.</p>
        </div>
      )}
    </section>
  );
}
