import { useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import FundTable from './FundTable';
import type { FundStatusResponse } from './types';
const number = (value: string | null) =>
  value === null
    ? '–'
    : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(Number(value));
export default function FundCompanyDataDetail({
  report,
  focusedMonth,
  onBack,
}: {
  report: FundStatusResponse;
  focusedMonth: string;
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [month, setMonth] = useState(focusedMonth);
  const selectedMonth = report.months.includes(month) ? month : report.date;
  const company = report.rows[0]?.company,
    cell = report.rows[0]?.cells.find((item) => item.month === selectedMonth);
  const metrics =
    report.detail?.filter(
      (metric) =>
        (!requiredOnly || metric.requiredByKpi) &&
        (!search ||
          `${metric.metric_number} ${metric.name}`.toLowerCase().includes(search.toLowerCase()))
    ) || [];
  return (
    <>
      <div className="fund-detail-toolbar">
        <button type="button" className="fund-detail-back" onClick={onBack}>
          <ArrowLeft size={15} />
          Übersicht
        </button>
        <h3>{company?.internal_name || company?.name} · MetricData</h3>
        <label className="fund-detail-search">
          <Search size={14} />
          <input
            placeholder="Kennzahl / Metric Number"
            aria-label="Kennzahl suchen"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="fund-detail-checkbox">
          <input
            type="checkbox"
            checked={requiredOnly}
            onChange={(event) => setRequiredOnly(event.target.checked)}
          />
          Nur KPI-Quellen
        </label>
      </div>
      <details className="fund-report-warnings" open={Boolean(cell?.requiredMissing)}>
        <summary>
          {cell?.requiredMissing || 0} fehlende/mehrdeutige KPI-Quellwerte · {selectedMonth}
        </summary>
        <label>
          Berichtsmonat{' '}
          <select value={selectedMonth} onChange={(event) => setMonth(event.target.value)}>
            {report.months.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </label>
        {(cell?.missing || []).map((missing, index) => (
          <p key={`${missing.metricNumber}:${missing.month}:${missing.dimension}:${index}`}>
            <strong>{missing.metricNumber}</strong> · {missing.month} · {missing.dimension} ·{' '}
            {missing.metricId ? 'Wert fehlt oder ist mehrdeutig' : 'Metric fehlt in der Company'}
            <small>{missing.kpis.join(', ')}</small>
          </p>
        ))}
      </details>
      <FundTable
        name={`fund-company-data:${company?.objectId}`}
        columns={[
          { key: 'number', label: 'Metric Number' },
          { key: 'name', label: 'Kennzahl' },
          { key: 'unit', label: 'Einheit' },
          ...report.months.map((period) => ({
            key: period,
            label: (
              <button
                type="button"
                className={selectedMonth === period ? 'fund-selected-month' : ''}
                onClick={() => setMonth(period)}
              >
                {period.slice(5) + '/' + period.slice(2, 4)}
              </button>
            ),
          })),
        ]}
        rows={metrics.map((metric) => ({
          key: metric.objectId,
          cells: {
            number: metric.metric_number,
            name: (
              <span title={metric.kpis.join(', ')}>
                {metric.name}
                {metric.requiredByKpi && <small className="fund-source-badge">KPI</small>}
              </span>
            ),
            unit: metric.unit || metric.currency || '–',
            ...Object.fromEntries(
              metric.values.map((value) => [
                value.month,
                <span
                  className={`fund-data-value ${value.status === 'ok' ? 'green' : value.status === 'duplicate' || metric.requiredByKpi ? 'red' : 'yellow'}`}
                  title={`${value.currency || ''} ${value.status === 'duplicate' ? 'Mehrere aktive Werte' : value.status === 'missing' ? 'Kein numerischer Wert' : ''}`}
                >
                  {number(value.value)}
                </span>,
              ])
            ),
          },
        }))}
      />
      <p className="fund-status-note">
        Rohwerte aus MetricData · Dimension {report.dimension} · keine Währungsumrechnung.
        KPI-Quellen außerhalb MetricData werden in dieser Pflegeübersicht nicht bewertet.
      </p>
    </>
  );
}
