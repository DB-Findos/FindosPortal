import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import './PerformanceUpdateReport.css';

type CurrencyMode = 'CC' | 'EUR';
type Column = { key: string; group: string; label: string };
type Report = {
  company: { objectId: string; name: string; internal_name: string | null };
  date: string;
  currency: { mode: CurrencyMode; code: string };
  columns: Column[];
  rows: { key: string; label: string; kind: 'value' | 'margin'; values: (number | null)[] }[];
  missingMetrics: string[];
};

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function formatNumber(value: number | null, percent = false) {
  if (value === null || !Number.isFinite(value)) return '–';
  const absolute = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: percent ? 1 : 0,
    maximumFractionDigits: percent ? 1 : 0,
  }).format(Math.abs(percent ? value * 100 : value));
  return value < 0 ? `(${absolute}${percent ? '%' : ''})` : `${absolute}${percent ? '%' : ''}`;
}

export default function PerformanceUpdateReport({ companyId }: { companyId: string }) {
  const { request } = useApi();
  const [date, setDate] = useState(currentMonth);
  const [currency, setCurrency] = useState<CurrencyMode>('CC');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    request<Report>(
      `/portfolio/companies/${companyId}/performance-update?date=${date}&currency=${currency}`
    )
      .then((data) => {
        if (active) {
          setReport(data);
        }
      })
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [companyId, date, currency, request]);

  const currentReport =
    report?.company.objectId === companyId &&
    report.date === date &&
    report.currency.mode === currency
      ? report
      : null;

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(
        new Date(`${date}-01T00:00:00`)
      ),
    [date]
  );
  const groupHeaders = useMemo(() => {
    const groups: { label: string; span: number }[] = [];
    for (const column of currentReport?.columns ?? []) {
      const current = groups.at(-1);
      if (current?.label === column.group) current.span += 1;
      else groups.push({ label: column.group, span: 1 });
    }
    return groups;
  }, [currentReport?.columns]);

  return (
    <section className="performance-update" aria-label="Performance Update">
      <div className="performance-toolbar">
        <div className="performance-heading">
          <span className="performance-kicker">Company Reporting</span>
          <h2>Performance Update</h2>
          <p>Monatliche Entwicklung, Jahresverlauf und Plan im gewählten Währungskontext.</p>
        </div>
        <div className="performance-pickers">
          <label>
            <span>Stichtag</span>
            <span className="performance-input-wrap">
              <CalendarDays size={15} />
              <input type="month" value={date} onChange={(event) => setDate(event.target.value)} />
            </span>
          </label>
          <label>
            <span>Währung</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as CurrencyMode)}
            >
              <option value="CC">CC · Company Currency</option>
              <option value="EUR">EUR · Euro</option>
            </select>
          </label>
        </div>
      </div>
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && !currentReport && (
        <div className="performance-message">
          <RefreshCw className="performance-spin" size={16} /> Performance Update wird geladen …
        </div>
      )}
      {currentReport && (
        <>
          {loading && (
            <div className="performance-refreshing">
              <RefreshCw className="performance-spin" size={14} /> Aktualisierung …
            </div>
          )}
          {currentReport.missingMetrics.length > 0 && (
            <div className="performance-message">
              Für diese Company fehlen Kennzahlen: {currentReport.missingMetrics.join(', ')}.
            </div>
          )}
          <div className="performance-table-scroll">
            <table className="performance-table">
              <thead>
                <tr>
                  <th className="performance-corner" rowSpan={2}>
                    in {currentReport.currency.code}
                  </th>
                  {groupHeaders.map((group, index) => (
                    <th key={`${group.label}-${index}`} colSpan={group.span}>
                      {group.label === date ? monthTitle : group.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {currentReport.columns.map((column) => (
                    <th
                      className={
                        column.key.includes('act') || column.key === 'ltm_act' ? 'is-actual' : ''
                      }
                      key={column.key}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentReport.rows.map((row) => (
                  <tr className={row.kind === 'margin' ? 'is-margin' : ''} key={row.key}>
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, index) => (
                      <td
                        className={
                          currentReport.columns[index]?.key.includes('act') ||
                          currentReport.columns[index]?.key === 'ltm_act'
                            ? 'is-actual'
                            : ''
                        }
                        key={`${row.key}-${index}`}
                      >
                        {formatNumber(value, row.kind === 'margin')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="performance-footnote">
            Währungsumrechnung auf Basis der IndexRates zum Stichtag {monthTitle}; Net Debt wird als
            Monats-/Jahresendbestand dargestellt.
          </div>
        </>
      )}
    </section>
  );
}
