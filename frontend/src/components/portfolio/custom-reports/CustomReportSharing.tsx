import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useApi } from '../../../contexts/ApiContext';
type Recipient = { objectId: string; name: string };
type Share = Recipient & { user_id: string | null; group_id: string | null };
export default function CustomReportSharing({
  reportId,
  onClose,
}: {
  reportId: string;
  onClose: () => void;
}) {
  const { request } = useApi();
  const [recipients, setRecipients] = useState<{ users: Recipient[]; groups: Recipient[] }>({
    users: [],
    groups: [],
  });
  const [shares, setShares] = useState<Share[]>([]);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<{ users: Recipient[]; groups: Recipient[] }>('/custom-reports/recipients'),
      request<Share[]>(`/custom-reports/${reportId}/shares`),
    ])
      .then(([directory, rows]) => {
        if (active) {
          setRecipients(directory);
          setShares(rows);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [reportId, request]);
  const add = async () => {
    if (!recipient) return;
    setBusy(true);
    setError('');
    try {
      const [kind, id] = recipient.split(':');
      await request(`/custom-reports/${reportId}/shares`, 'POST', {
        user_id: kind === 'user' ? id : null,
        group_id: kind === 'group' ? id : null,
      });
      setShares(await request<Share[]>(`/custom-reports/${reportId}/shares`));
      setRecipient('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="custom-share-overlay" onClick={onClose}>
      <section
        className="custom-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Bericht teilen"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>Bericht teilen</h3>
          <button type="button" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </header>
        <p>Empfänger können den Bericht mit ihren eigenen Datenberechtigungen ansehen.</p>
        <label>
          Empfänger
          <select value={recipient} onChange={(event) => setRecipient(event.target.value)}>
            <option value="">Nutzer oder Gruppe auswählen</option>
            <optgroup label="Nutzer">
              {recipients.users.map((user) => (
                <option key={user.objectId} value={`user:${user.objectId}`}>
                  {user.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Gruppen">
              {recipients.groups.map((group) => (
                <option key={group.objectId} value={`group:${group.objectId}`}>
                  {group.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          className="custom-primary-button"
          disabled={!recipient || busy}
          onClick={() => void add()}
        >
          Freigeben
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <ul>
          {shares.map((share) => (
            <li key={share.objectId}>
              <span>
                {share.name}
                {share.group_id ? ' · Gruppe' : ''}
              </span>
              <button
                type="button"
                aria-label="Freigabe entfernen"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await request(`/custom-reports/${reportId}/shares/${share.objectId}`, 'DELETE');
                    setShares((previous) =>
                      previous.filter((item) => item.objectId !== share.objectId)
                    );
                  } catch (cause) {
                    setError((cause as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
