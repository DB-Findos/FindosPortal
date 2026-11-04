import type { BridgeBar } from '../bridge/bridge-types';
export type FundReportContext = {
  fundId: string;
  date: string;
  dimension: string;
  scope: string;
  onDateResolved: (date: string) => void;
};
export type FundCompany = {
  objectId: string;
  name: string;
  internal_name: string | null;
  status: string;
};
export type FundBridgeResponse = {
  fund: { objectId: string; name: string };
  date: string;
  dimension: string;
  scope: string;
  currency: { mode: 'EUR'; code: 'EUR' };
  valueScale: number;
  bars: (BridgeBar & {
    knownSubtotal: number;
    completeCompanies: number;
    totalCompanies: number;
  })[];
  companies: (FundCompany & { bars: BridgeBar[]; warnings: string[] })[];
  warnings: string[];
};
export type MissingSource = {
  metricNumber: number;
  metricId: string | null;
  month: string;
  dimension: string;
  kpis: string[];
};
export type StatusCell = {
  month: string;
  status: 'green' | 'yellow' | 'red';
  filled: number;
  total: number;
  required: number;
  requiredMissing: number;
  missing?: MissingSource[];
};
export type FundStatusResponse = {
  fund: { objectId: string; name: string };
  date: string;
  dimension: string;
  scope: string;
  months: string[];
  rows: { company: FundCompany; cells: StatusCell[] }[];
  definition: string;
  dependencyCount: number;
  detail?: {
    objectId: string;
    name: string;
    metric_number: number;
    unit: string;
    currency: string | null;
    requiredByKpi: boolean;
    kpis: string[];
    values: {
      month: string;
      value: string | null;
      status: 'ok' | 'missing' | 'duplicate';
      currency: string | null;
    }[];
  }[];
};
