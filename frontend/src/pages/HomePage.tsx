import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../contexts/ApiContext';
import { useFormErrors } from '../hooks/useFormErrors';
import PageHeading from '../components/common/PageHeading';
import ReportContextFields from '../components/kpi/ReportContextFields';
import KpiCard from '../components/kpi/KpiCard';
import FieldError from '../components/common/FieldError';
import type { KpiCatalog, Report, ReportContext, ReportResult } from '../types/kpi';
export default function HomePage() {
  const { request } = useApi(),
    errors = useFormErrors();
  const [reports, setReports] = useState<Report[]>([]),
    [catalog, setCatalog] = useState<KpiCatalog | null>(null),
    [report, setReport] = useState(''),
    [context, setContext] = useState<ReportContext>({
      company_id: '',
      date: new Date().toISOString().slice(0, 7) + '-01',
      dimension: 'actual',
      currency: 'CC',
    }),
    [result, setResult] = useState<ReportResult | null>(null),
    [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    Promise.all([request<Report[]>('/kpi/reports'), request<KpiCatalog>('/kpi/catalog')])
      .then(([r, c]) => {
        if (active) {
          setReports(r);
          setReport(r[0]?.objectId || '');
          setCatalog(c);
          setContext((x) => ({ ...x, company_id: c.companies[0]?.objectId || '' }));
        }
      })
      .catch((e) => {
        if (active) errors.setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  function clear() {
    revision.current++;
    setResult(null);
    setBusy(false);
    errors.setError('');
  }
  async function run() {
    if (!errors.validate(errors.formRef.current!)) return;
    if (!context.company_id || !context.date) {
      errors.setFieldError(!context.company_id ? 'company_id' : 'date', 'Bitte auswählen.');
      return;
    }
    const version = ++revision.current;
    setBusy(true);
    setResult(null);
    try {
      const next = await request<ReportResult>(`/kpi/reports/${report}/run`, 'POST', context);
      if (version === revision.current) setResult(next);
    } catch (e) {
      if (version === revision.current) errors.handleError(e);
    } finally {
      if (version === revision.current) setBusy(false);
    }
  }
  return (
    <main className="home-page reporting-page" aria-label="Standardreporting">
      <PageHeading
        title="Reporting"
        description="Kennzahlen aus MetricData · ausgewertet für Ihre Company und Ihren Berichtsmonat."
      />
      <div className="reporting-workspace">
        <form
          className="report-controls"
          ref={errors.formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <label>
            Standardbericht
            <select
              {...errors.inputProps('report')}
              required
              value={report}
              onChange={(e) => {
                setReport(e.target.value);
                errors.clearField('report');
                clear();
              }}
            >
              <option value="">Bitte auswählen …</option>
              {reports.map((r) => (
                <option key={r.objectId} value={r.objectId}>
                  {r.name}
                </option>
              ))}
            </select>
            <FieldError id={errors.errorId('report')} message={errors.fieldErrors.report} />
          </label>
          <ReportContextFields
            companies={catalog?.companies || []}
            value={context}
            onChange={(next) => {
              setContext(next);
              errors.clearField('company_id');
              errors.clearField('date');
              clear();
            }}
            errors={errors.fieldErrors}
          />
          <button type="submit" className="primary" disabled={busy || !catalog}>
            {busy ? 'Wird berechnet …' : 'Bericht anzeigen'}
          </button>
          <Link className="report-settings-link" to="/settings/kpis">
            KPIs & Berichte verwalten
          </Link>
          {errors.error && (
            <p className="error" role="alert">
              {errors.error}
            </p>
          )}
        </form>
        <section className="report-results" aria-live="polite">
          {result ? (
            <>
              <div className="report-result-heading">
                <h2>{result.report.name}</h2>
                <p>
                  {result.company.name} · {result.context.date.slice(0, 7)} ·{' '}
                  {result.context.dimension} Â·{' '}
                  {result.context.currency === 'EUR'
                    ? 'EUR · Euro'
                    : `CC · ${result.results[0]?.currency_context.code || 'Company Currency'}`}
                </p>
              </div>
              <div className="kpi-grid">
                {result.results.map((kpi) => (
                  <KpiCard key={kpi.objectId} result={kpi} />
                ))}
              </div>
            </>
          ) : (
            <div className="kpi-empty">
              <h2>Ihr Standardreporting</h2>
              <p>Bericht, Company und Monat auswählen und den Bericht anzeigen.</p>
              <p>
                LTM umfasst zwölf Monate inklusive Berichtsmonat, YTD beginnt im Januar. V12P
                verschiebt den Zeitraum um zwölf Monate zurück.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
