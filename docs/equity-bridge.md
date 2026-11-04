# Findos Equity Bridge

The Bridge tab uses the stored **Findos Equity Bridge** report. All seven items
reference versioned KPI formulas and VariableMap rows. The React components only
draw results; financial calculations run in KpiEngine and are editable through the
KPI editor or MCP.

Setup: `npm run db:migrate`, `npm run db:import-capital-movements`, then
`npm run db:seed-bridge`. The import expects `.imports/CapitalMovements.xlsx` unless
`--file=...` is supplied to its TypeScript script. The seed preserves existing
source KPIs and versions the Bridge endpoint when its definition changes.

| Bridge item                | Stored calculation                                                              |
| -------------------------- | ------------------------------------------------------------------------------- |
| Findos Equity Value T0     | `Entry FEQV * 1000`                                                             |
| Revenue Effect Findos      | `Revenue Effect (Findos) * 1000`                                                |
| Margin Effect Findos       | `Margen Effect (Findos) * 1000`                                                 |
| Net Debt Effect Findos     | `- Net Debt Effekt (Findos) * 1000`                                             |
| Capital Structur Effect T1 | `Entry FindosInvestmentValue * 1000 * RCV - (T0 + Revenue + Margin + Net Debt)` |
| Capital Returns T1         | `Cumulative Capital Return movements through report month * 1000`               |
| Findos Equity Value T1     | `Entry FindosInvestmentValue * 1000 * RCV + Capital Returns T1`                 |

Amounts in MetricData, DealData and the imported movements use thousands. Bridge
KPIs return currency units; charts divide by 1,000,000 to display millions. The
existing Revenue, Margin and Entry KPIs are reused with their existing Entry
filters and EBITDA/EBITA conventions. The German Net Debt source KPI measures
current debt minus Entry debt, so its sign is inverted for an additive equity
bridge. Net Debt (Broad Definition) is Metric Number 2900000.

RCV (4101200) and Findos Share (4002900) are dimensionless, despite source unit
`000`, and are never currency-converted. **DealData.findos_investment_value is
already EUR**, independently of DealData.data_currency. For an EUR report it is
used directly. For a CC report, only EUR-to-target conversion is required.

## Capital Movements

Source: SharePoint Data & AI / PBI / Aktuell / Kapitalbewegungen.xlsx.
`portal.capital_movements` preserves the five original columns (Company, Date,
Value, Type, Reason) in `source_data`, alongside typed fields, Company references
and the standard immutable audit/version chain. Types are Capital Call and Capital
Return. The import is a complete source snapshot with stable row identities;
changes create successor versions and removed source rows are archived.

All 58 source rows were imported and matched to Companies. 38 blank dates were
resolved against exactly one corresponding DealData Entry or Exit. An Entry date
is used only for Capital Call/Kaufpreiszahlung with the same initial investment
amount; an Exit date is used only for Capital Return/Exit with one matching Exit.
The original date remains in `source_date`; `date_source` documents the provenance.
No missing dates remain in this import. Future undated records are retained but
excluded from dated totals, with a warning. Import counts and provenance issues
are recorded in `.imports/capital-movements-import-report.json`.

The CUMULATIVE variable aggregation sums `capital_movements.value` for the report
Company with `movement_date < first day of the following month`. There is no start
bound: the sum includes all prior years. An optional exact filter on `type` or
`reason` is stored in VariableMap; Capital Returns T1 filters type=Capital Return.
No matching dated movements means zero. Undated matching movements produce a
warning, never an invented date. The editor exposes this as Entity field / Sum
through reporting date; the MCP KPI guide documents the same contract.

## Reporting

`GET /api/portfolio/companies/:companyId/bridge` accepts `date=YYYY-MM`,
`currency=EUR|CC`, and `dimension=actual|budget|forecast|plan`. Defaults match other
Company reports: latest available data month and EUR. Each request uses one
read-only snapshot, source permissions, and request-scoped query caching.

The history bulk-loads the materialized CC effect values for the last 18 reporting
months. CC displays use these directly; EUR displays divide them by the EUR/CC
IndexRate of the **selected report month**. Only missing/outdated materializations
are calculated live in their monthly CC context. Fixed EUR amounts already inside
a monthly CC result retain that month's conversion before the final report-date
translation. The current waterfall keeps its selected-month evaluation.
Revenue is selected initially; clicking effect columns or chips
toggles multiple lines. Endpoint totals are independently evaluated; the report
warns if a complete effect sum does not reconcile to T1. With the defined Capital
Structure residual and Returns item, the seven-item bridge reconciles to
Investment * RCV + cumulative Returns. Missing source data stays visible rather
than being fabricated as zero.
