import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';
import { useVisibleViewData } from '../contexts/ViewContentContext';
import { useFormErrors } from '../hooks/useFormErrors';
import PageHeading from '../components/common/PageHeading';
import FieldError from '../components/common/FieldError';
import ApplicationIcon from '../components/applications/ApplicationIcon';
import type { ApplicationModule } from '../types/applications';
import '../styles/applications.css';

export default function ApplicationLinksPage() {
  const { request } = useApi();
  const { user } = useAuth();
  const errors = useFormErrors();
  const [applications, setApplications] = useState<ApplicationModule[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const canSave = Boolean(user?.permissions.application_modules?.can_update);
  function loaded(items: ApplicationModule[]) {
    setApplications(items);
    setValues(Object.fromEntries(items.map((item) => [item.objectId, item.external_url ?? ''])));
  }
  useEffect(() => {
    let active = true;
    request<ApplicationModule[]>('/applications')
      .then((items) => {
        if (active) loaded(items);
      })
      .catch((cause: Error) => {
        if (active) errors.setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);
  useVisibleViewData('Anwendungen & Links', { applications, values, busy, error: errors.error });
  return (
    <>
      <PageHeading
        title="Anwendungen & Links"
        description="Zielanwendungen für die Bereiche der Startseite festlegen. Externe Links öffnen sich in einem neuen Tab."
      />
      <form
        className="application-links-form"
        ref={errors.formRef}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (!errors.validate(event.currentTarget)) return;
          setBusy(true);
          setNotice('');
          errors.setError('');
          try {
            loaded(
              await request<ApplicationModule[]>('/applications/links', 'PUT', {
                links: applications.map((application) => ({
                  objectId: application.objectId,
                  version_id: application.id,
                  external_url: values[application.objectId]?.trim() || null,
                })),
              })
            );
            setNotice('Anwendungslinks gespeichert.');
          } catch (cause) {
            errors.handleError(cause);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="application-links-actions">
          <div role="status">
            {notice || (!canSave && !loading ? 'Für Änderungen fehlt die Berechtigung.' : '')}
          </div>
          <button
            className="primary"
            type="submit"
            disabled={!canSave || busy || loading || !applications.length}
          >
            <Save size={16} />
            {busy ? 'Speichern …' : 'Speichern'}
          </button>
        </div>
        {errors.error && (
          <p className="error" role="alert">
            {errors.error}
          </p>
        )}
        <div className="application-links-fields">
          {loading && <p role="status">Anwendungen werden geladen …</p>}
          {applications.map((application, index) => {
            const field = `links.${index}.external_url`;
            return (
              <section className="application-link-card" key={application.objectId}>
                <div className="application-link-heading">
                  <span className="application-tile-icon">
                    <ApplicationIcon application={application.key} size={21} />
                  </span>
                  <div>
                    <h2>{application.name}</h2>
                    <p>
                      {['knowledge-management', 'portfolio-management'].includes(application.key)
                        ? 'Integrierter Portalbereich.'
                        : application.internal_path
                          ? 'Ohne externen Link wird das interne Reporting geöffnet.'
                          : 'Ohne Link bleibt die Kachel noch nicht verknüpft.'}
                    </p>
                  </div>
                </div>
                <label htmlFor={errors.inputProps(field).id}>Anwendungslink</label>
                <input
                  {...errors.inputProps(field)}
                  type="url"
                  name={field}
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://…"
                  maxLength={2048}
                  disabled={
                    !canSave ||
                    busy ||
                    ['knowledge-management', 'portfolio-management'].includes(application.key)
                  }
                  value={values[application.objectId] ?? ''}
                  onChange={(event) => {
                    setValues((previous) => ({
                      ...previous,
                      [application.objectId]: event.target.value,
                    }));
                    errors.clearField(field);
                    setNotice('');
                  }}
                />
                <FieldError id={errors.errorId(field)} message={errors.fieldErrors[field]} />
              </section>
            );
          })}
        </div>
      </form>
    </>
  );
}
