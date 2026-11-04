import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import './KpiCalculationControls.css';

type CalculationJob = {
  id: string;
  formula_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
  successful: number;
  missing: number;
  errors: number;
  message: string | null;
};

export default function KpiCalculationControls({
  formulaId,
  canRecalculate,
}: {
  formulaId?: string;
  canRecalculate: boolean;
}) {
  const { request } = useApi();
  const [job, setJob] = useState<CalculationJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setJob(null);
    setError('');
    void request<CalculationJob | null>(
      `/kpi/calculations/latest${formulaId ? `?formula_id=${formulaId}` : ''}`
    )
      .then((result) => {
        if (active) setJob(result);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [request, formulaId]);
  useEffect(() => {
    if (!job || !['pending', 'running'].includes(job.status)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void request<CalculationJob | null>(`/kpi/calculations/${job.id}`)
        .then((result) => {
          if (!active) return;
          setError('');
          setJob(result);
          if (result?.status === 'completed')
            window.dispatchEvent(new Event('portal-data-changed'));
        })
        .catch((cause: Error) => {
          if (active) {
            setError(cause.message);
            setJob({ ...job });
          }
        });
    }, 2000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [job, request]);
  const running = submitting || job?.status === 'pending' || job?.status === 'running';
  const selectedIsRunning = running && (!formulaId || job?.formula_id === formulaId);
  async function recalculate(all = false) {
    setSubmitting(true);
    setError('');
    try {
      setJob(
        await request<CalculationJob>(
          '/kpi/recalculate',
          'POST',
          !all && formulaId ? { formula_id: formulaId } : {}
        )
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="kpi-calculation-controls" aria-label="Monatliche KPI-Berechnung">
      <div className="kpi-calculation-actions">
        <button
          type="button"
          className="secondary"
          disabled={!canRecalculate || submitting || selectedIsRunning}
          onClick={() => void recalculate()}
          title={
            formulaId
              ? 'Gewählte KPI und abhängige KPIs für alle vorhandenen Berichtsmonate neu berechnen'
              : 'Alle KPIs für alle vorhandenen Berichtsmonate neu berechnen'
          }
        >
          <RefreshCw size={16} className={running ? 'kpi-calculation-spin' : ''} />
          Recalculate{formulaId ? '' : ' all'}
        </button>
        {formulaId && (
          <button
            type="button"
            className="secondary"
            disabled={!canRecalculate || running}
            onClick={() => void recalculate(true)}
          >
            Alle KPIs
          </button>
        )}
      </div>
      <div className="kpi-calculation-status" role="status" aria-live="polite">
        {error ? (
          <span className="error">{error}</span>
        ) : job?.status === 'failed' ? (
          <span className="error">{job.message || 'Berechnung fehlgeschlagen.'}</span>
        ) : job?.status === 'pending' ? (
          <span>Neuberechnung vorgemerkt …</span>
        ) : job?.status === 'running' ? (
          <>
            <span>
              Monatswerte: {job.progress.toLocaleString('de-DE')} /{' '}
              {job.total.toLocaleString('de-DE')}
              {job.total === 0 ? ' · wird vorbereitet …' : ''}
            </span>
            {job.total > 0 && (
              <progress value={job.progress} max={job.total} aria-label="Berechnungsfortschritt" />
            )}
          </>
        ) : job?.status === 'completed' ? (
          <span>{job.message}</span>
        ) : (
          <span>Monatswerte werden nach Änderungen automatisch aktualisiert.</span>
        )}
      </div>
    </section>
  );
}
