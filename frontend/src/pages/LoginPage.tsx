import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';
import Brand from '../components/layout/Brand';
import { useFormErrors } from '../hooks/useFormErrors';
import FieldError from '../components/common/FieldError';
export default function LoginPage() {
  const { request: api } = useApi();
  const { user, loading, refresh: onLogin } = useAuth();
  const [busy, setBusy] = useState(false);
  const {
    formRef,
    fieldErrors,
    error,
    setError,
    clearField,
    validate,
    handleError,
    inputProps,
    errorId,
  } = useFormErrors();
  if (loading) return <div className="loading">Portal wird geladen ...</div>;
  if (user) return <Navigate to="/" replace />;
  return (
    <main className="login">
      <div className="login-card">
        <Brand />
        <div className="login-heading">
          <span className="eyebrow">WILLKOMMEN</span>
          <h1>Anmelden</h1>
          <p>Mit Ihrem Konto auf das Portal zugreifen.</p>
        </div>
        <form
          ref={formRef}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!validate(e.currentTarget)) return;
            setBusy(true);
            setError('');
            const data = new FormData(e.currentTarget);
            try {
              await api('/auth/login', 'POST', Object.fromEntries(data));
              await onLogin();
            } catch (e) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            E-Mail
            <input
              {...inputProps('email')}
              type="email"
              name="email"
              autoComplete="username"
              required
              onChange={() => clearField('email')}
              placeholder="name@unternehmen.de"
            />
            <FieldError id={errorId('email')} message={fieldErrors.email} />
          </label>
          <label>
            Passwort
            <input
              {...inputProps('password')}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              onChange={() => clearField('password')}
            />
            <FieldError id={errorId('password')} message={fieldErrors.password} />
          </label>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <button className="primary login-submit" disabled={busy}>
            {busy ? 'Anmeldung läuft …' : 'Anmelden'}
            <ChevronRight size={17} />
          </button>
        </form>
        <div className="login-footer">
          <ShieldCheck size={15} /> Geschützter Zugang
        </div>
      </div>
      <small className="copyright">Findos Portal · Administration & Portfolio</small>
    </main>
  );
}
