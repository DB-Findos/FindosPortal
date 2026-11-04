const requiredEntities: Record<string, string[]> = {
  details: ['companies'],
  'performance-update': [
    'companies',
    'metrics',
    'metric_data',
    'index_rates',
    'performance_update_comments',
  ],
  financials: ['companies', 'metrics', 'metric_data', 'metric_formulas', 'index_rates'],
  valuation: ['companies'],
  bridge: [
    'companies',
    'metrics',
    'metric_data',
    'index_rates',
    'kpi_formulas',
    'variable_map',
    'report_definitions',
    'report_items',
  ],
  'investor-reporting': ['companies', 'metrics', 'metric_data', 'comments'],
  'custom-reports': ['companies', 'custom_reports'],
};
export function canReadCompanyTab(tab: string, rights: Record<string, Record<string, boolean>>) {
  return Boolean(requiredEntities[tab]?.every((entity) => rights[entity]?.can_read));
}
