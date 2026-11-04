import { FileText, Search, Users, UserRound } from 'lucide-react';
import type { CustomReportSummary } from './types';

export default function CustomReportSidebar({
  scope,
  onScope,
  search,
  onSearch,
  reports,
  selectedId,
  onSelect,
  loading,
}: {
  scope: 'own' | 'shared';
  onScope: (value: 'own' | 'shared') => void;
  search: string;
  onSearch: (value: string) => void;
  reports: CustomReportSummary[];
  selectedId?: string;
  onSelect: (report: CustomReportSummary) => void;
  loading: boolean;
}) {
  return (
    <aside className="custom-report-sidebar" aria-label="Custom Reports">
      <div className="custom-report-scopes">
        <button
          type="button"
          className={scope === 'own' ? 'active' : ''}
          onClick={() => onScope('own')}
        >
          <UserRound size={14} />
          Eigene
        </button>
        <button
          type="button"
          className={scope === 'shared' ? 'active' : ''}
          onClick={() => onScope('shared')}
        >
          <Users size={14} />
          Geteilte
        </button>
      </div>
      <label className="custom-report-search">
        <Search size={15} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Berichte suchen"
          aria-label="Berichte suchen"
        />
      </label>
      <div className="custom-report-list" aria-busy={loading}>
        {reports.map((report) => (
          <button
            type="button"
            key={report.objectId}
            className={selectedId === report.objectId ? 'active' : ''}
            onClick={() => onSelect(report)}
          >
            <FileText size={16} />
            <span>
              <strong>{report.name}</strong>
              {report.description && <small>{report.description}</small>}
            </span>
          </button>
        ))}
        {!reports.length && (
          <p>
            {loading
              ? 'Berichte werden geladen …'
              : search
                ? 'Keine passenden Berichte.'
                : scope === 'own'
                  ? 'Erstelle deinen ersten Bericht über den KI-Chat.'
                  : 'Noch keine Berichte mit dir geteilt.'}
          </p>
        )}
      </div>
    </aside>
  );
}
