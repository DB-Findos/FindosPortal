import type { KpiResult } from '../../types/kpi';
export default function KpiCard({ result }: { result: KpiResult }) {
  // Formatting only: all arithmetic and source resolution run on the API.
  const formatted =
    result.value === null
      ? '—'
      : new Intl.NumberFormat('de-DE', {
          minimumFractionDigits: result.decimals,
          maximumFractionDigits: result.decimals,
        }).format(result.value as unknown as number);
  return (
    <article className={'kpi-card status-' + result.status}>
      <h3>{result.name}</h3>
      <div className="kpi-value">
        {formatted}
        <small>{result.unit}</small>
      </div>
      {result.message && (
        <p role="status" className="kpi-status">
          {result.message}
        </p>
      )}
      {result.variables.length > 0 && (
        <details>
          <summary>Berechnungsgrundlage</summary>
          <ul>
            {result.variables.map((v) => (
              <li key={v.identifier}>
                <b>
                  {v.identifier} · {v.name}
                </b>
                <span>
                  {v.value}
                  {v.period ? ' · ' + v.period : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
