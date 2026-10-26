import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Brand from './Brand';
export default function Topbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [error, setError] = useState('');
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand-button" aria-label="Hauptseite">
          <Brand />
        </Link>
        <div className="topbar-right">
          <span className="user-name">
            {user?.first_name} {user?.last_name}
          </span>
          <span className="avatar">
            {user?.first_name?.[0]}
            {user?.last_name?.[0]}
          </span>
          <span className="separator" />
          <Link
            className={'icon ' + (location.pathname.startsWith('/settings') ? 'selected' : '')}
            aria-label="Einstellungen"
            to="/settings/users"
          >
            <Settings size={20} />
          </Link>
          <button
            className="icon"
            aria-label="Abmelden"
            onClick={() => void logout().catch((e) => setError(e.message))}
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
    </>
  );
}
