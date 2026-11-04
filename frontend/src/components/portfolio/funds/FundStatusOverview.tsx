import FundTable from './FundTable';
import type { FundStatusResponse } from './types';
export default function FundStatusOverview({
  report,
  onCompany,
}: {
  report: FundStatusResponse;
  onCompany: (companyId: string, month?: string) => void;
}) {
  const latest = report.rows.map((row) => row.cells.at(-1));
  return (
    <>
      <div className="fund-status-summary">
        {(['green', 'yellow', 'red'] as const).map((color) => (
          <div key={color}>
            <i className={`fund-status-dot ${color}`} />
            <strong>{latest.filter((cell) => cell?.status === color).length}</strong>
            <span>
              {color === 'green'
                ? 'Vollständig'
                : color === 'yellow'
                  ? 'KPI-Quellen vollständig'
                  : 'KPI-Quellen fehlen'}
            </span>
          </div>
        ))}
      </div>
      <FundTable
        name={`fund-status:${report.fund.objectId}`}
        columns={[
          { key: 'company', label: 'Company' },
          ...report.months.map((month) => ({
            key: month,
            label: month.slice(5) + '/' + month.slice(2, 4),
          })),
        ]}
        rows={report.rows.map((row) => ({
          key: row.company.objectId,
          cells: {
            company: (
              <button
                type="button"
                className="fund-company-drilldown"
                onClick={() => onCompany(row.company.objectId)}
              >
                {row.company.internal_name || row.company.name}
              </button>
            ),
            ...Object.fromEntries(
              row.cells.map((cell) => [
                cell.month,
                <button
                  type="button"
                  className={`fund-status-cell ${cell.status}`}
                  onClick={() => onCompany(row.company.objectId, cell.month)}
                  aria-label={`${row.company.internal_name || row.company.name}, ${cell.month}: ${cell.status === 'green' ? 'vollständig' : cell.status === 'yellow' ? 'KPI-Quellen vollständig' : 'KPI-Quellen fehlen'}`}
                  title={`${cell.month}: ${cell.filled}/${cell.total} Metrics gepflegt · ${cell.requiredMissing}/${cell.required} benötigte KPI-Monatswerte fehlen oder sind mehrdeutig`}
                >
                  <i className={`fund-status-dot ${cell.status}`} />
                </button>,
              ])
            ),
          },
        }))}
      />
      <p className="fund-status-note">
        Grün: alle Metrics des Monats numerisch gepflegt. Gelb: alle benötigten MetricData-Quellen
        der KPIs vorhanden. Rot: mindestens eine KPI-Quelle fehlt oder ist mehrdeutig. LTM, YTD,
        V12P und Dimensionsvorgaben werden berücksichtigt. Klick auf Company oder Ampel öffnet die
        Details.
      </p>
    </>
  );
}
