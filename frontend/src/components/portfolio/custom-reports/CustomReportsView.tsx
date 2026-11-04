import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Share2, PanelLeft, RefreshCw } from 'lucide-react';
import { useApi } from '../../../contexts/ApiContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useReportContext } from '../../../hooks/useReportContext';
import { useVisibleViewData } from '../../../contexts/ViewContentContext';
import CustomReportSidebar from './CustomReportSidebar';
import CustomReportSharing from './CustomReportSharing';
import HtmlReportFrame from './HtmlReportFrame';
import type { CustomReportSummary, CustomReportRun } from './types';
import '../PerformanceUpdateReport.css';
import './CustomReportsView.css';

export default function CustomReportsView({ companyId }: { companyId: string }) {
  const { request } = useApi();
  const { portfolioCompanies } = useAuth();
  const [params, setParams] = useSearchParams();
  const { date, setDate, currency, setCurrency } = useReportContext(companyId);
  const [dimension, setDimension] = useState('actual');
  const [scope, setScope] = useState<'own' | 'shared'>('own');
  const [search, setSearch] = useState('');
  const [reports, setReports] = useState<CustomReportSummary[]>([]);
  const [selected, setSelected] = useState<CustomReportSummary | null>(null);
  const [report, setReport] = useState<CustomReportRun | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('portal-data-changed', refresh);
    return () => window.removeEventListener('portal-data-changed', refresh);
  }, []);
  useEffect(() => {
    let active = true;
    setLoadingList(true);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ scope, search });
      request<CustomReportSummary[]>(`/custom-reports?${query}`)
        .then((rows) => {
          if (!active) return;
          setReports(rows);
          setSelected((previous) =>
            previous
              ? rows.find((row) => row.objectId === previous.objectId) || previous
              : rows[0] || null
          );
        })
        .catch((cause: Error) => {
          if (active) setError(cause.message);
        })
        .finally(() => {
          if (active) setLoadingList(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scope, search, revision, request]);
  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ company_id: companyId, currency, dimension });
    if (date) query.set('date', date);
    request<CustomReportRun>(`/custom-reports/${selected.objectId}/run?${query}`)
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
  }, [selected?.objectId, selected?.id, companyId, date, currency, dimension, revision, request]);
  const current =
    report?.objectId === selected?.objectId &&
    report?.context.company_id === companyId &&
    (!date || report.context.date === date) &&
    report.context.currency === currency &&
    report.context.dimension === dimension
      ? report
      : null;
  useVisibleViewData('Custom Reports', {
    companyId,
    date: date || current?.context.date,
    currency,
    dimension,
    reportId: selected?.objectId,
    report: current,
    loading,
    error,
    availableReports: reports,
    visualizations: ['Dynamischer HTML-Bericht mit Live-Datenmapping'],
  });
  return (
    <section
      className={`custom-reports-view ${sidebarOpen ? 'sidebar-open' : ''}`}
      aria-label="Custom Reports"
    >
      <CustomReportSidebar
        scope={scope}
        onScope={(value) => {
          setScope(value);
          setReports([]);
          setSelected(null);
          setReport(null);
          setSharing(false);
        }}
        search={search}
        onSearch={setSearch}
        reports={reports}
        selectedId={selected?.objectId}
        onSelect={(value) => {
          setSelected(value);
          setSidebarOpen(false);
          setSharing(false);
        }}
        loading={loadingList}
      />
      <div className="custom-report-main">
        <div className="performance-toolbar custom-report-toolbar">
          <div className="custom-report-title">
            <button
              type="button"
              className="custom-sidebar-toggle"
              aria-label="Berichte ein-/ausblenden"
              onClick={() => setSidebarOpen((value) => !value)}
            >
              <PanelLeft size={18} />
            </button>
            <h2>{selected?.name || 'Custom Reports'}</h2>
            {current?.is_owner && (
              <button type="button" onClick={() => setSharing(true)} title="Bericht teilen">
                <Share2 size={16} />
              </button>
            )}
          </div>
          <div className="performance-pickers custom-report-pickers">
            <label>
              <span>Company</span>
              <select
                value={companyId}
                onChange={(event) => {
                  const next = new URLSearchParams(params);
                  next.set('company', event.target.value);
                  setParams(next);
                }}
              >
                {portfolioCompanies.map((company) => (
                  <option key={company.objectId} value={company.objectId}>
                    {company.internal_name || company.name}
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
                  value={date || current?.context.date || ''}
                  onChange={(event) => setDate(event.target.value)}
                />
              </span>
            </label>
            <label>
              <span>Dimension</span>
              <select value={dimension} onChange={(event) => setDimension(event.target.value)}>
                <option value="actual">Actual</option>
                <option value="budget">Budget</option>
                <option value="forecast">Forecast</option>
                <option value="plan">Findos Plan</option>
              </select>
            </label>
            <label>
              <span>Währung</span>
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value as 'EUR' | 'CC')}
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
            <RefreshCw size={14} className="performance-spin" />
            Berichtsdaten werden geladen …
          </div>
        )}
        {current && !error && (
          <>
            <HtmlReportFrame html={current.html} title={current.name} />
            {current.warnings.length > 0 && (
              <details className="custom-report-warnings">
                <summary>Hinweise zu den Berichtsdaten ({current.warnings.length})</summary>
                {current.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </details>
            )}
          </>
        )}
        {!selected && !loading && (
          <div className="company-empty-report">
            <span>Deine Berichte</span>
            <p>
              Wähle einen Bericht oder beschreibe im KI-Chat, welchen Bericht du erstellen möchtest.
            </p>
          </div>
        )}
      </div>
      {sharing && selected && (
        <CustomReportSharing reportId={selected.objectId} onClose={() => setSharing(false)} />
      )}
    </section>
  );
}
