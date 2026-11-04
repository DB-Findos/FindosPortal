import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../contexts/ApiContext';
import { useAuth } from '../../contexts/AuthContext';
import type { Entity, Row } from '../../types/api';
import { label } from '../../utils/labels';
import RecordForm from '../data/RecordForm';
import './CompanyDetails.css';

type Details = {
  company: Row;
  fund: Row | null;
  contacts: { assignment: Row; contact: Row | null }[] | null;
};
const fields = [
  'name',
  'internal_name',
  'industry',
  'status',
  'currency',
  'address_line',
  'postal_code',
  'city',
  'country',
  'phone',
  'email',
  'website',
  'description',
];

export default function CompanyDetails({
  companyId,
  onCompanySaved,
}: {
  companyId: string;
  onCompanySaved: (company: Row) => void;
}) {
  const { request } = useApi();
  const { entities } = useAuth();
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    entity: Entity;
    row: Row | null;
    initialValues?: Row;
    hiddenFields?: string[];
  } | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const entity = (name: string) => entities.find((item) => item.name === name);
  const can = (name: string, action: string) =>
    Boolean(entity(name)?.permissions[`can_${action}`] && !entity(name)?.readonly);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    request<Details>(`/portfolio/companies/${companyId}/details`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause: Error) => active && setError(cause.message));
    return () => {
      active = false;
    };
  }, [companyId, request, revision]);

  const edit = (name: string, row: Row | null, initialValues?: Row, hiddenFields?: string[]) => {
    const target = entity(name);
    if (target && can(name, row ? 'update' : 'create'))
      setEditor({ entity: target, row, initialValues, hiddenFields });
  };
  return (
    <section className="company-details" aria-label="Unternehmensdetails">
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            type="button"
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Erneut laden
          </button>
        </div>
      )}
      {!data && !error && <p role="status">Details werden geladen …</p>}
      {data && (
        <>
          <section className="company-details-card">
            <header>
              <div>
                <h2>Stammdaten</h2>
                <p>Unternehmensdaten und Adresse</p>
              </div>
              {can('companies', 'update') && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => edit('companies', data.company)}
                >
                  Stammdaten bearbeiten
                </button>
              )}
            </header>
            <dl className="company-details-fields">
              {fields.map((field) => (
                <div key={field}>
                  <dt>{label(field)}</dt>
                  <dd>
                    {field === 'website' && /^https?:\/\//i.test(data.company[field] || '') ? (
                      <a href={data.company[field]} target="_blank" rel="noreferrer">
                        {data.company[field]}
                      </a>
                    ) : (
                      data.company[field] || '—'
                    )}
                  </dd>
                </div>
              ))}
              {data.fund && (
                <div>
                  <dt>Fonds</dt>
                  <dd>
                    <Link to={`/portfolio/fund?fund=${data.fund.objectId}`}>{data.fund.name}</Link>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          {data.contacts !== null &&
            (['company', 'findos'] as const).map((category) => {
              const rows = data.contacts!.filter(
                ({ assignment }) => assignment.category === category
              );
              return (
                <section className="company-details-card" key={category}>
                  <header>
                    <div>
                      <h2>{category === 'company' ? 'Kontakte im Unternehmen' : 'Findos-Team'}</h2>
                      <p>
                        {category === 'company'
                          ? 'Verantwortliche und ihre Rollen im Unternehmen'
                          : 'Interne Ansprechpartner und ihre Zuständigkeiten'}
                      </p>
                    </div>
                    <div className="company-details-actions">
                      {can('contacts', 'create') && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => edit('contacts', null)}
                        >
                          Kontakt anlegen
                        </button>
                      )}
                      {can('company_contacts', 'create') && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            edit('company_contacts', null, { company_id: companyId, category }, [
                              'company_id',
                              'category',
                            ])
                          }
                        >
                          Person verknüpfen
                        </button>
                      )}
                    </div>
                  </header>
                  {!rows.length ? (
                    <p className="muted">Noch keine Personen verknüpft.</p>
                  ) : (
                    <div className="company-details-people">
                      {rows.map(({ assignment, contact }) => (
                        <article key={assignment.objectId}>
                          <h3>
                            {contact
                              ? `${contact.first_name} ${contact.last_name}`
                              : 'Kontakt nicht mehr verfügbar'}
                          </h3>
                          <span className="company-details-role">{assignment.role}</span>
                          {contact?.email && (
                            <a href={`mailto:${contact.email}`}>{contact.email}</a>
                          )}
                          {contact?.phone && <span>{contact.phone}</span>}
                          {assignment.notes && <p>{assignment.notes}</p>}
                          <div className="company-details-actions">
                            {can('company_contacts', 'update') && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  edit('company_contacts', assignment, undefined, [
                                    'company_id',
                                    'category',
                                  ])
                                }
                              >
                                Zuordnung bearbeiten
                              </button>
                            )}
                            {contact && can('contacts', 'update') && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => edit('contacts', contact)}
                              >
                                Kontakt bearbeiten
                              </button>
                            )}
                            {can('company_contacts', 'delete') && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setRemoving(assignment)}
                              >
                                Verknüpfung entfernen
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
        </>
      )}
      {editor && (
        <RecordForm
          {...editor}
          entities={entities}
          onClose={() => setEditor(null)}
          onSave={() => {
            const companyEdited = editor.entity.name === 'companies';
            setEditor(null);
            setRevision((value) => value + 1);
            if (companyEdited)
              request<Row>(`/data/companies/${companyId}`)
                .then(onCompanySaved)
                .catch((cause: Error) => setError(cause.message));
          }}
        />
      )}
      {removing && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-company-contact"
          >
            <h2 id="remove-company-contact">Verknüpfung entfernen?</h2>
            <p>Die Zuordnung als „{removing.role}“ wird entfernt. Der Kontakt bleibt erhalten.</p>
            <footer>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request(
                      `/data/company_contacts/${removing.objectId}`,
                      'DELETE',
                      undefined,
                      removing.id
                    );
                    setRemoving(null);
                    setRevision((value) => value + 1);
                  } catch (cause) {
                    setError((cause as Error).message);
                    setRemoving(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Wird entfernt …' : 'Entfernen'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
