import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import './PerformanceUpdateReport.css';

type Quarter = { start: string; period: string; year: number; label: string };
type CovenantRow = {
  key: string;
  label: string;
  kind: 'value' | 'target';
  values: (number | null)[];
};
type Comment = {
  company_source_name: string;
  metric_data_period: string;
  comment_text: string;
  text_type: string | null;
  source_file: string | null;
  slide_number: number | null;
  paragraph_number: number | null;
  slide_id: string | null;
  performance_update_date: string | null;
};
type PerformanceData = {
  date: string;
  quarters: Quarter[];
  rows: CovenantRow[];
  comments: Comment[];
  commentPeriod: string | null;
  commentMeetingDate: string | null;
};

export default function PerformanceDataReport({
  companyId,
  date,
}: {
  companyId: string;
  date: string;
}) {
  const { request } = useApi();
  const [report, setReport] = useState<PerformanceData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    request<PerformanceData>(`/portfolio/companies/${companyId}/performance-data?date=${date}`)
      .then((value) => active && setReport(value))
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [companyId, date, request]);

  const currentReport = report?.date === date ? report : null;
  const yearGroups = useMemo(() => {
    const groups: { year: number; count: number }[] = [];
    for (const quarter of currentReport?.quarters ?? []) {
      const group = groups.at(-1);
      if (group?.year === quarter.year) group.count += 1;
      else groups.push({ year: quarter.year, count: 1 });
    }
    return groups;
  }, [currentReport?.quarters]);

  return (
    <section className="performance-data-report" aria-label="Performance Data">
      {error && <div className="performance-message error" role="alert">{error}</div>}
      {loading && !currentReport && (
        <div className="performance-message">
          <RefreshCw className="performance-spin" size={16} /> Performance Data wird geladen …
        </div>
      )}
      {currentReport && (
        <div className="performance-data-grid">
          <div className="performance-data-table-scroll">
            <table className="performance-data-table">
              <thead>
                <tr>
                  <th className="performance-data-corner" rowSpan={2}>Performance Data</th>
                  {yearGroups.map((group) => (
                    <th key={group.year} colSpan={group.count}>{group.year}</th>
                  ))}
                </tr>
                <tr>
                  {currentReport.quarters.map((quarter, index) => (
                    <th className={index === currentReport.quarters.length - 1 ? 'selected' : ''} key={quarter.start}>
                      {quarter.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentReport.rows.map((row) => (
                  <tr className={row.kind === 'target' ? 'is-target' : ''} key={row.key}>
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, index) => (
                      <td className={index === row.values.length - 1 ? 'selected' : ''} key={`${row.key}-${index}`}>
                        {value === null ? '–' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="performance-comments" aria-label="Aktuelle Kommentare">
            <div className="performance-comments-heading">
              <div>
                <h3>
                  Kommentare aus dem Performance Update Termin vom{' '}
                  {currentReport.commentMeetingDate
                    ? new Intl.DateTimeFormat('de-DE').format(
                        new Date(`${currentReport.commentMeetingDate}T00:00:00`)
                      )
                    : 'Datum nicht ausgewiesen'}
                </h3>
              </div>
              <MessageSquareText size={17} />
            </div>
            <div className="performance-comments-list">
              {currentReport.comments.length ? (
                <ul>
                  {currentReport.comments.map((comment, index) => (
                    <li key={`${comment.slide_id}-${comment.paragraph_number}-${index}`}>
                      {comment.comment_text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="performance-comments-empty">
                  Keine Kommentare bis zu diesem Stichtag vorhanden.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
