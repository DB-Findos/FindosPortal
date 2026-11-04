import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';
import { useVisibleViewData } from '../contexts/ViewContentContext';
import ApplicationTile from '../components/applications/ApplicationTile';
import type { ApplicationModule } from '../types/applications';
import '../styles/applications.css';

export default function ApplicationsPage() {
  const { request } = useApi();
  const { user } = useAuth();
  const [applications, setApplications] = useState<ApplicationModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<ApplicationModule[]>('/applications')
      .then((items) => {
        if (active) {
          setApplications(items);
          setError('');
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);
  useVisibleViewData('Anwendungsübersicht', { applications, loading, error });
  const primary = ['knowledge-management', 'portfolio-management'].flatMap((key) =>
    applications.filter((application) => application.key === key)
  );
  const externalKeys = new Set([
    'people-management',
    'datev',
    'adobe-sign',
    'lanes-planes',
    'teams',
    'crm',
    'dynamo',
  ]);
  const remaining = applications.filter(
    (application) =>
      !['reporting', 'knowledge-management', 'portfolio-management'].includes(application.key)
  );
  const external = remaining.filter(
    (application) => application.external_url || externalKeys.has(application.key)
  );
  const future = remaining.filter(
    (application) => !application.external_url && !externalKeys.has(application.key)
  );
  return (
    <main className="applications-page" aria-label="Anwendungen">
      <div className="applications-shell">
        <header className="applications-heading">
          <div>
            <span className="eyebrow">FINDOS PORTAL</span>
            <h1>Anwendungen</h1>
          </div>
          {user?.permissions.application_modules?.can_update && (
            <Link className="secondary application-config-link" to="/settings/applications">
              <Settings2 size={16} />
              Links verwalten
            </Link>
          )}
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="applications-content" aria-busy={loading}>
          {loading ? (
            <p className="muted" role="status">
              Anwendungen werden geladen …
            </p>
          ) : (
            <>
              <section className="applications-primary" aria-label="Portalbereiche">
                {primary.map((application) => (
                  <ApplicationTile
                    key={application.objectId}
                    application={application}
                    variant="primary"
                  />
                ))}
              </section>
              {!!external.length && (
                <section className="applications-external" aria-label="Anwendungsverlinkungen">
                  {external.map((application) => (
                    <ApplicationTile
                      key={application.objectId}
                      application={application}
                      variant="external"
                    />
                  ))}
                </section>
              )}
              {!!future.length && (
                <section className="applications-future" aria-label="Weitere Bereiche">
                  {future.map((application) => (
                    <ApplicationTile
                      key={application.objectId}
                      application={application}
                      variant="future"
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
