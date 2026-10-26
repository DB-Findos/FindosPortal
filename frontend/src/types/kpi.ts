export interface KpiVariable {
  identifier: string;
  entity: string;
  field: string;
  aggregation: 'MONTH' | 'LTM' | 'YTD' | 'FIXED' | 'KPI';
  prior_year: boolean;
  dimension: string | null;
  metric_number: number | null;
  record_id: string | null;
  target_kpi_id: string | null;
  filter: { field: string; operator: 'equals' | 'context_company'; value: string | null } | null;
  name?: string;
}
export interface FormulaDraft {
  name: string;
  description: string;
  unit: string;
  decimals: number;
  TextEditor: string;
  variables: KpiVariable[];
}
export interface Formula extends FormulaDraft {
  id: string;
  objectId: string;
  TextDisplay: string;
}
export interface Report {
  id: string;
  objectId: string;
  name: string;
  description: string;
  kpi_ids: string[];
}
export interface KpiCatalog {
  metrics: { metric_number: number; name: string }[];
  companies: { objectId: string; name: string }[];
  sources: { entity: string; label: string; fields: string[]; filterFields: string[] }[];
}
export interface ReportContext {
  company_id: string;
  date: string;
  dimension: string;
}
export interface KpiResult {
  objectId: string;
  name: string;
  unit: string;
  decimals: number;
  value: string | null;
  status: 'ok' | 'missing' | 'error' | 'forbidden';
  message?: string;
  variables: { identifier: string; name: string; value: string; period?: string }[];
}
export interface ReportResult {
  report: { name: string };
  company: { name: string };
  context: ReportContext;
  results: KpiResult[];
}
export const emptyFormula: FormulaDraft = {
  name: '',
  description: '',
  unit: '',
  decimals: 2,
  TextEditor: '',
  variables: [],
};
export function cleanVariable(v: KpiVariable): KpiVariable {
  return {
    identifier: v.identifier,
    entity: v.entity,
    field: v.field,
    aggregation: v.aggregation,
    prior_year: v.prior_year,
    dimension: v.dimension,
    metric_number: v.metric_number,
    record_id: v.record_id,
    target_kpi_id: v.target_kpi_id,
    filter: v.filter,
  };
}
export function variableIdentifier(index: number) {
  let value = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  return value;
}
