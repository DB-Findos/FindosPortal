import type { KpiCatalog, ReportContext } from '../../types/kpi';
export default function ReportContextFields({
  companies,
  value,
  onChange,
  errors = {},
}: {
  companies: KpiCatalog['companies'];
  value: ReportContext;
  onChange: (next: ReportContext) => void;
  errors?: Record<string, string>;
}) {
  return (
    <div className="kpi-fields">
      <label>
        Company
        <select
          value={value.company_id}
          onChange={(e) => onChange({ ...value, company_id: e.target.value })}
          data-field="company_id"
          aria-invalid={Boolean(errors.company_id)}
        >
          <option value="">Bitte auswählen …</option>
          {companies.map((c) => (
            <option key={c.objectId} value={c.objectId}>
              {c.name}
              {c.currency ? ` · CC: ${c.currency}` : ''}
            </option>
          ))}
        </select>
        {errors.company_id && (
          <span className="field-error" role="alert">
            {errors.company_id}
          </span>
        )}
      </label>
      <label>
        Berichtsmonat
        <input
          type="month"
          min="1901-01"
          max="9998-12"
          data-field="date"
          aria-invalid={Boolean(errors.date)}
          value={value.date.slice(0, 7)}
          onChange={(e) =>
            onChange({ ...value, date: e.target.value ? e.target.value + '-01' : '' })
          }
        />
        {errors.date && (
          <span className="field-error" role="alert">
            {errors.date}
          </span>
        )}
      </label>
      <label>
        Dimension
        <select
          value={value.dimension}
          onChange={(e) => onChange({ ...value, dimension: e.target.value })}
        >
          {['actual', 'budget', 'forecast', 'plan'].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        Währungskontext
        <select
          value={value.currency || 'CC'}
          onChange={(e) => onChange({ ...value, currency: e.target.value as 'CC' | 'EUR' })}
        >
          <option value="CC">CC · Company Currency</option>
          <option value="EUR">EUR · Euro</option>
        </select>
        <small>CC nutzt die Währung der Company, ersatzweise die ihres Funds.</small>
      </label>
    </div>
  );
}
