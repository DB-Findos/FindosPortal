import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import Brand from '../components/layout/Brand';
import { useAuth } from '../contexts/AuthContext';

export default function PendingAccessPage() {
  const { user, logout, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="login">
      <div className="login-card">
        <Brand />
        <div className="login-heading">
          <Clock3 size={28} />
          <h1>Freischaltung ausstehend</h1>
          <p>
            Ihr Microsoft-Konto wurde registriert. Ein Administrator muss Ihnen zunächst Zugriff
            zuweisen.
          </p>
          <p>{user?.email}</p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await refresh();
            } catch {
              setError('Status konnte nicht geladen werden. Bitte erneut versuchen.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Status aktualisieren
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            try {
              await logout();
            } catch {
              setError('Abmelden fehlgeschlagen. Bitte erneut versuchen.');
            }
          }}
        >
          Abmelden
        </button>
      </div>
    </main>
  );
}
