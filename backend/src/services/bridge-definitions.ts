export const bridgeReportName = 'Findos Equity Bridge';
export const bridgeDefinitions = [
  { key: 't0', name: 'Findos Equity Value T0', label: 'Findos Equity T0', kind: 'total' },
  { key: 'revenue', name: 'Revenue Effect Findos', label: 'Revenue', kind: 'change' },
  { key: 'margin', name: 'Margin Effect Findos', label: 'Margin', kind: 'change' },
  { key: 'net-debt', name: 'Net Debt Effect Findos', label: 'Net Debt', kind: 'change' },
  {
    key: 'capital-structure',
    name: 'Capital Structur Effect T1',
    label: 'Capital Structure',
    kind: 'change',
  },
  { key: 'capital-returns', name: 'Capital Returns T1', label: 'Capital Returns', kind: 'change' },
  { key: 't1', name: 'Findos Equity Value T1', label: 'Findos Equity T1', kind: 'total' },
] as const;
