import { useEffect, useState } from 'react';
import type { Formula, KpiCatalog, KpiVariable } from '../../types/kpi';

interface Props {
  catalog: KpiCatalog;
  formulas: Formula[];
  onAdd: (v: Omit<KpiVariable, 'identifier'>) => void;
}

export default function VariablePicker({ catalog, formulas, onAdd }: Props) {
  const [kind, setKind] = useState('metric');
  const [metric, setMetric] = useState('');
  const [aggregation, setAggregation] = useState<'MONTH' | 'LTM' | 'YTD'>('MONTH');
  const [prior, setPrior] = useState(false);
  const [dimension, setDimension] = useState('');
  const [entity, setEntity] = useState(catalog.sources[0]?.entity || '');
  const [field, setField] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterOperator, setFilterOperator] = useState<'equals' | 'context_company'>('equals');
  const [filterValue, setFilterValue] = useState('');
  const [target, setTarget] = useState('');
  const source = catalog.sources.find((item) => item.entity === entity);
  const selectedMetric = catalog.metrics.find((item) => String(item.metric_number) === metric);
  useEffect(() => {
    setField(source?.fields[0] || '');
    setFilterField('');
    setFilterValue('');
  }, [entity, source?.fields]);
  const valid =
    kind === 'metric'
      ? Boolean(selectedMetric)
      : kind === 'fixed'
        ? Boolean(
            field && (!filterField || filterOperator === 'context_company' || filterValue.trim())
          )
        : Boolean(target);
  function add() {
    if (!valid) return;
    onAdd({
      entity: kind === 'metric' ? 'metric_data' : kind === 'kpi' ? 'kpi_formulas' : entity,
      field: kind === 'metric' ? 'value' : kind === 'kpi' ? 'result' : field,
      aggregation: kind === 'metric' ? aggregation : kind === 'kpi' ? 'KPI' : 'FIXED',
      prior_year: kind === 'metric' && prior,
      dimension: kind === 'metric' ? dimension || null : null,
      metric_number: kind === 'metric' ? Number(metric) : null,
      record_id: null,
      target_kpi_id: kind === 'kpi' ? target : null,
      filter:
        kind === 'fixed' && filterField
          ? {
              field: filterField,
              operator: filterOperator,
              value: filterOperator === 'equals' ? filterValue : null,
            }
          : null,
      name:
        kind === 'metric'
          ? `MetricData:${selectedMetric?.name} [${metric}] · ${aggregation}${prior ? ' · V12P' : ''}${dimension ? ' · ' + dimension : ''}`
          : kind === 'kpi'
            ? `KPI:${formulas.find((formula) => formula.objectId === target)?.name}`
            : `${source?.label}:${field} · Company-Kontext`,
    });
  }
  return (
    <section className="kpi-section">
      <h3>Variable hinzufügen</h3>
      <div className="kpi-fields">
        <label>
          Quelle
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="metric">MetricData · monatlich</option>
            <option value="fixed">Entity-Feld · fester Wert</option>
            <option value="kpi">Definierte KPI</option>
          </select>
        </label>
        {kind === 'metric' ? (
          <>
            <label className="wide">
              Metric Number
              <input
                list="kpi-metric-options"
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                placeholder="Metric Number suchen …"
              />
              <datalist id="kpi-metric-options">
                {catalog.metrics.map((item) => (
                  <option key={item.metric_number} value={item.metric_number}>
                    {item.name}
                  </option>
                ))}
              </datalist>
              <small>{selectedMetric?.name || 'Eine vorhandene Metric Number auswählen.'}</small>
            </label>
            <label>
              Aggregation
              <select
                value={aggregation}
                onChange={(event) => setAggregation(event.target.value as typeof aggregation)}
              >
                <option value="MONTH">Monat</option>
                <option value="LTM">LTM · letzte 12 Monate</option>
                <option value="YTD">YTD · seit Jahresbeginn</option>
              </select>
            </label>
            <label>
              Dimension
              <select value={dimension} onChange={(event) => setDimension(event.target.value)}>
                <option value="">Aus dem Bericht</option>
                {['actual', 'budget', 'forecast', 'plan'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="kpi-check">
              <input
                type="checkbox"
                checked={prior}
                onChange={(event) => setPrior(event.target.checked)}
              />
              V12P · 12 Monate zurück
            </label>
          </>
        ) : kind === 'fixed' ? (
          <>
            <label>
              Entity
              <select value={entity} onChange={(event) => setEntity(event.target.value)}>
                {catalog.sources.map((item) => (
                  <option key={item.entity} value={item.entity}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Numerisches Feld
              <select value={field} onChange={(event) => setField(event.target.value)}>
                {source?.fields.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Filterfeld
              <select value={filterField} onChange={(event) => setFilterField(event.target.value)}>
                <option value="">Kein zusätzlicher Filter</option>
                {source?.filterFields.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            {filterField && (
              <>
                <label>
                  Filtertyp
                  <select
                    value={filterOperator}
                    onChange={(event) =>
                      setFilterOperator(event.target.value as typeof filterOperator)
                    }
                  >
                    <option value="equals">Entspricht Wert</option>
                    {filterField === 'company_id' && (
                      <option value="context_company">Berichts-Company</option>
                    )}
                  </select>
                </label>
                {filterOperator === 'equals' && (
                  <label>
                    Filterwert
                    <input
                      value={filterValue}
                      onChange={(event) => setFilterValue(event.target.value)}
                      placeholder="Exakter Wert oder Object-ID"
                    />
                  </label>
                )}
              </>
            )}
            <p className="muted wide">
              Der Wert wird immer aus der im Bericht ausgewählten Company ermittelt.
            </p>
          </>
        ) : (
          <label className="wide">
            KPI
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Bitte auswählen …</option>
              {formulas.map((formula) => (
                <option key={formula.objectId} value={formula.objectId}>
                  {formula.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button type="button" className="secondary" disabled={!valid} onClick={add}>
        + Variable in Formel einfügen
      </button>
    </section>
  );
}
