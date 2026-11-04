# Fund Reporting

The session navigation loads Funds once before protected views render, alongside Companies and navigation permissions. The Fund dropdown lists the actual Fund II, Fund III and Fund IV database records. It reuses the existing sidebar layout without refetching on each interaction.

The Fund view contains **Bridge** and **Datenstand**. Both use a common selected month, dimension and holding scope. Currently only active `P - Portfolio` Companies are included. The holding filter shows a disabled future “inkl. Exits” option; exited-company accounting is intentionally not enabled until its business treatment is defined. Companies without a portfolio status are not included.

## Bridge

Each Company's existing Findos Equity Bridge is evaluated in EUR at the same selected month and dimension, without per-Company history requests. Existing valid KPIData is reused by the normal engine; missing or stale materializations fall back to normal live calculations. Reads are memoized within one consistent read-only snapshot.

Fund bars sum corresponding Company bars with Decimal arithmetic and reconstruct the waterfall from those sums. A bar is complete only when every included Company has a valid amount for that bar. Missing amounts remain missing, not zero, and do not become a misleading partial fund total. The breakdown table exposes each Company's values and completion counts. No recalculation jobs or database writes are initiated by opening the view.

## Datenstand

The default matrix covers the latest 12 months, with an option for 24 months. Rows are Companies; cells represent reporting months. The default end month follows the latest available Revenue month across selected Fund Companies, otherwise the latest MetricData month. It can be changed manually.

- **Green:** every active Metric defined for that Company has exactly one non-null numeric MetricData value in the selected dimension/month, and all required KPI input windows are available.
- **Yellow:** all MetricData inputs referenced by active KPI formulas are available, but the full Company Metric set is not completely populated for that month.
- **Red:** at least one required KPI MetricData input is absent, null, ambiguous, or the required Metric does not exist for that Company. A Company without any Metrics is also red.

The dependency check reads active formula variables, including the variables of nested KPI formulas, and expands MONTH/LTM/YTD plus V12P into their required monthly cells. Explicit variable dimensions override the selected dimension. Repeated dependencies are deduplicated by Metric Number, source month and dimension. Zero is a valid filled value. Multiple active values are flagged as ambiguous. This is a MetricData maintenance view, not a claim that all KPI computations succeed: fixed DealData fields, CapitalMovements and calculation errors outside MetricData are not evaluated by this status check.

All registered Metrics count toward full completeness, including quarterly IR fields; the overview does not invent a reporting cadence or waive missing data. Clicking a Company or a month cell opens all of that Company's Metrics, source units and raw values. Search and “Nur KPI-Quellen” help locate inputs. The missing-input panel explains the exact Metric Number, month, dimension and dependent KPI names. Missing Metrics that have no Company row are also listed there.

Only table/report containers scroll, and table headers offer the existing right-click column-pinning menu. The API uses read-only snapshots and checks Fund/Company/Metric/KPI Entity permissions. Detail endpoints verify that the Company belongs to the selected Fund and scope. No schema migration is needed.

Endpoints: `GET /api/portfolio/funds`, `GET /:fundId/bridge`, `GET /:fundId/data-status`, `GET /:fundId/data-status/:companyId`.
