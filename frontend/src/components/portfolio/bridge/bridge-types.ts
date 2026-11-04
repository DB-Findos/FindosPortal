export type BridgeKey =
  't0' | 'revenue' | 'margin' | 'net-debt' | 'capital-structure' | 'capital-returns' | 't1';
export type BridgeBar = {
  key: BridgeKey;
  name: string;
  label: string;
  kind: 'total' | 'change';
  kpiId: string | null;
  value: number | null;
  start: number | null;
  end: number | null;
  status: string;
  message: string | null;
};
export type BridgeSeries = {
  key: BridgeKey;
  label: string;
  kpiId: string | null;
  points: { month: string; value: number | null; status: string; message: string | null }[];
};
export type BridgeResponse = {
  company: { objectId: string; name: string };
  date: string;
  dimension: string;
  currency: { mode: 'CC' | 'EUR'; code: string };
  valueScale: number;
  bars: BridgeBar[];
  series: BridgeSeries[];
  warnings: string[];
};
export const bridgeColors: Record<BridgeKey, string> = {
  t0: 'var(--primary)',
  t1: 'var(--primary)',
  revenue: 'var(--secondary)',
  margin: 'var(--accent)',
  'net-debt': '#c36a55',
  'capital-structure': '#849b32',
  'capital-returns': 'var(--primary)',
};
export const bridgeNumber = (value: number | null | undefined, scale: number) =>
  value == null
    ? '–'
    : new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        value / scale
      );
