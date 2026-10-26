import { useState } from 'react';
import type { Formula, KpiCatalog, KpiVariable } from '../../types/kpi';

interface Props {
  catalog: KpiCatalog;
  formulas: Formula[];
  onAdd: (v: Omit<KpiVariable, 'identifier'>) => void;
  initial?: KpiVariable;
  onCancelEdit?: () => void;
}

export default function VariablePicker({ catalog, formulas, onAdd, initial, onCancelEdit }: Props) {
  const [kind, setKind] = useState(
    initial?.aggregation === 'FIXED' ? 'fixed' : initial?.aggregation === 'KPI' ? 'kpi' : 'metric'
  );
  const [metric, setMetric] = useState(
    initial?.metric_number == null ? '' : String(initial.metric_number)
  );
  const [aggregation, setAggregation] = useState<'MONTH' | 'LTM' | 'YTD'>(
    initial && ['MONTH', 'LTM', 'YTD'].includes(initial.aggregation)
      ? (initial.aggregation as 'MONTH' | 'LTM' | 'YTD')
      : 'MONTH'
  );
  const [prior, setPrior] = useState(initial?.prior_year || false);
  const [dimension, setDimension] = useState(initial?.dimension || '');
  const [entity, setEntity] = useState(
    initial?.aggregation === 'FIXED' ? initial.entity : catalog.sources[0]?.entity || ''
  );
  const [field, setField] = useState(initial?.field || catalog.sources[0]?.fields[0] || '');
  const [filterField, setFilterField] = useState(initial?.filter?.field || '');
  const [filterOperator, setFilterOperator] = useState<'equals' | 'context_company'>(
    initial?.filter?.operator || 'equals'
  );
  const [filterValue, setFilterValue] = useState(initial?.filter?.value || '');
  const [target, setTarget] = useState(initial?.target_kpi_id || '');
  const source = catalog.sources.find((item) => item.entity === entity);
  const selectedMetric = catalog.metrics.find((item) => String(item.metric_number) === metric);
  const valid =
    kind === 'metric'
      ? Boolean(selectedMetric)
      : kind === 'fixed'
        ? Boolean(
            source?.fields.includes(field) && (!filterField || filterOperator === 'context_company' || filterValue.trim())
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
      <h3>{initial ? `Variable ${initial.identifier} bearbeiten` : 'Variable hinzufügen'}</h3>
      <div className="kpi-fields">
        <label>
          Quelle
          <select value={kind} onChange={(event) => {
            setKind(event.target.value);
            if(event.target.value==='fixed' && !source?.fields.includes(field)) setField(source?.fields[0]||'');
          }}>
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
              <select
                value={entity}
                onChange={(event) => {
                  setEntity(event.target.value);
                  setField(
                    catalog.sources.find((item) => item.entity === event.target.value)?.fields[0] ||
                      ''
                  );
                  setFilterField('');
                  setFilterValue('');
                  setFilterOperator('equals');
                }}
              >
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
        {initial ? 'Variable updaten' : '+ Variable in Formel einfügen'}
      </button>
      {initial && (
        <button type="button" className="secondary" onClick={onCancelEdit}>
          Neue Variable hinzufügen
        </button>
      )}
    </section>
  );
}
