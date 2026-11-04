import { useEffect, useState } from 'react';
import { useApi } from '../../contexts/ApiContext';
import type { KnowledgeEntry } from './types';
const date = (value: string | null) => (value ? new Date(value).toLocaleString('de-DE') : '–');
type History = { id: string; lastModifiedAt: string; modified_by_name: string; title: string };
export default function KnowledgeDetails({ entry }: { entry: KnowledgeEntry }) {
  const { request } = useApi();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    request<History[]>(`/knowledge/entries/${entry.objectId}/history`)
      .then((rows) => {
        if (active) {
          setHistory(rows);
          setError('');
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [entry.objectId, entry.id, open, request]);
  return (
    <details
      className="km-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Details</summary>
      <dl>
        <div>
          <dt>Aktualität</dt>
          <dd>{entry.upToDate ? 'Aktuell' : 'Prüfung offen'}</dd>
        </div>
        <div>
          <dt>Prüfzyklus</dt>
          <dd>{entry.reviewCycleMonths} Monate</dd>
        </div>
        <div>
          <dt>Zuletzt geprüft</dt>
          <dd>{date(entry.reviewedAt)}</dd>
        </div>
        <div>
          <dt>Nächste Prüfung</dt>
          <dd>{date(entry.reviewDueAt)}</dd>
        </div>
        <div>
          <dt>Verantwortlich</dt>
          <dd>{entry.responsible_name}</dd>
        </div>
        <div>
          <dt>Letzte Änderung</dt>
          <dd>
            {date(entry.lastModifiedAt)}
            <small>{entry.modified_by_name}</small>
          </dd>
        </div>
        <div>
          <dt>Erstellt</dt>
          <dd>
            {date(entry.createdAt)}
            <small>{entry.created_by_name}</small>
          </dd>
        </div>
        <div>
          <dt>Bereich / Abschnitt</dt>
          <dd>
            {entry.space.name} / {entry.section.name}
          </dd>
        </div>
        {entry.source_url && (
          <div>
            <dt>Quelle</dt>
            <dd>
              <a href={entry.source_url} target="_blank" rel="noopener noreferrer">
                Original öffnen
              </a>
              {entry.source_modified_at && <small>{date(entry.source_modified_at)}</small>}
            </dd>
          </div>
        )}
      </dl>
      <div className="km-history">
        <h3>Änderungsverlauf</h3>
        {error && <p role="alert">{error}</p>}
        {history.map((row, index) => (
          <div key={row.id}>
            <span>{index === 0 ? 'Aktuell' : `Version ${history.length - index}`}</span>
            <time>{date(row.lastModifiedAt)}</time>
            <strong>{row.modified_by_name}</strong>
          </div>
        ))}
      </div>
    </details>
  );
}
