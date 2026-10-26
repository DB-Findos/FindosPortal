import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import type { Entity, Row } from '../../types/api';
export default function HistoryDialog({
  entity,
  row,
  onClose,
}: {
  entity: Entity;
  row: Row;
  onClose: () => void;
}) {
  const { request } = useApi();
  const [versions, setVersions] = useState<Row[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    void request('/data/' + entity.name + '/' + row.objectId + '/history')
      .then((data) => setVersions(data.rows))
      .catch((e) => setError(e.message));
  }, [entity.name, row.objectId, request]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header>
          <div>
            <span className="eyebrow">VERSIONEN</span>
            <h2 id="history-title">{entity.label} · Historie</h2>
          </div>
          <button className="icon" aria-label="Schließen" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {error && <div className="error">{error}</div>}
        <div className="history-list">
          {versions.map((version) => (
            <details key={version.id}>
              <summary>
                <span className={'badge ' + (!version.archivedAt ? 'positive' : '')}>
                  {version.archivedAt ? 'Archiviert' : 'Aktuell'}
                </span>
                <span>{new Date(version.lastModifiedAt).toLocaleString('de-DE')}</span>
                <code>{version.id.slice(0, 8)}…</code>
              </summary>
              <pre>
                {JSON.stringify(
                  { ...version, ...(version.data_base64 ? { data_base64: '[Base64-Bild]' } : {}) },
                  null,
                  2
                )}
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
