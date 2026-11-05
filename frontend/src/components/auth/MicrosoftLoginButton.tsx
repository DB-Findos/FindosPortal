import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../contexts/ApiContext';
import './microsoft-login.css';

const errors: Record<string, string> = {
  cancelled: 'Die Microsoft-Anmeldung wurde abgebrochen oder nicht genehmigt.',
  failed:
    'Microsoft-Anmeldung fehlgeschlagen. Bitte erneut versuchen oder den Administrator kontaktieren.',
  disabled: 'Dieses Benutzerkonto ist deaktiviert. Bitte den Administrator kontaktieren.',
  email_conflict:
    'Für diese E-Mail existiert bereits ein Konto. Bitte vorerst den normalen Login verwenden und die Microsoft-Verknüpfung durch den Administrator klären lassen.',
};
export default function MicrosoftLoginButton() {
  const { request } = useApi();
  const [params] = useSearchParams();
  const [startUrl, setStartUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    request<{ enabled: boolean; startUrl: string | null }>('/auth/entra/config')
      .then((config) => {
        if (!cancelled) setStartUrl(config.enabled ? config.startUrl : null);
      })
      .catch(() => {
        if (!cancelled) setStartUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  const error = errors[params.get('microsoft_error') || ''];
  return (
    <div className="microsoft-login">
      <div className="login-divider">
        <span>oder</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="microsoft-login-button"
        disabled={!startUrl}
        title={!startUrl ? 'Microsoft Login ist derzeit nicht verfügbar.' : undefined}
        onClick={() => {
          if (startUrl) window.location.assign(startUrl);
        }}
      >
        <svg width="19" height="19" viewBox="0 0 21 21" aria-hidden="true">
          <path fill="#f25022" d="M1 1h9v9H1z" />
          <path fill="#7fba00" d="M11 1h9v9h-9z" />
          <path fill="#00a4ef" d="M1 11h9v9H1z" />
          <path fill="#ffb900" d="M11 11h9v9h-9z" />
        </svg>
        Microsoft Login
      </button>
    </div>
  );
}
