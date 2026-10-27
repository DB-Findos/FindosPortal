# Dynamo Metric Formulas and Income Statement

## Source and identities

`portal.metric_formulas` contains every populated row of the first worksheet of the
Metric Formulas workbook. `objectId` is the formula's Dynamo **Internal ID**.
`metric_id` references the existing target `portal.metrics.objectId` where present.
`dynamo_metric_id` retains the target's source UUID, including when the Metric has
not yet been imported. **UUIDs inside expressions refer to Metrics, never to
MetricFormula records, MetricData records, or version IDs.** MetricData is resolved
through `metric_data.metric_id`, company, dimension, and month.

All original column names and values, including flags, notes and source metadata,
are retained in `source_data`. Source creation/modification dates are separate from
the application's audit timestamps. Formula rows use the application's immutable
version chain. Re-imports retain unchanged rows and version changed rows.
Unknown targets remain in the table, with nullable `metric_id`; the import report
records them rather than discarding rows or inventing Metrics.

Run `npm run db:migrate`, then `npm run db:import-metric-formulas`.
The importer normally finds the sole `Metric Formulas*.xlsx` file under
`.imports/Dokumente`; specify `--file=...` on the TypeScript script when needed.
The source hash, counts and unresolved targets are written to
`.imports/metric-formulas-import-report.json`. `.imports` is not tracked by Git.
Migration 017 and the application code must also be deployed to the hosted API;
the data import itself is already stored in the configured cloud database.

## Engine contract, version 1

The machine-readable contract is stored in **every** formula's `evaluation_rules`
alongside `engine_version=1`, and defined in `metric-formula-format.ts`.
The backend interpreter is `metric-formula-engine.ts`; the frontend only draws
the evaluated bars. There is no dynamic JavaScript or SQL evaluation.

Contexts: a Company, dimension (`actual`, `budget`, `forecast`, `plan`), reporting
month, period (`MONTH`, calendar `YTD`, `LTM`), and currency (`CC`, `EUR`).
UUIDs resolve strictly inside the selected Company. Duplicate conflicting
configurations, circular dependencies, malformed syntax and division by zero fail
explicitly. No fallback to another Company or dimension is allowed.

### Monthly evaluation

| Type    | Evaluation                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data    | Exact monthly MetricData value.                                                                                                                                       |
| Range   | Sum Metrics within the inclusive numeric interval. Nested Range totals replace their enclosed detail Metrics to avoid double counting. The target itself is excluded. |
| Formula | Recursively interpret `monthly_formula_id`. Previously stored formula totals are not added again.                                                                     |

### Expression syntax

`|OPERATOR:Metric-UUID|` references a Metric. Supported arithmetic: `+`, `-`, `*`,
`/`, `^`, unary signs, parentheses and numeric constants. Comparisons: `<`, `>`,
`<=`, `>=`, `=`, `<>`, `!=`. `IF(condition, then, else)` evaluates only the selected
branch; `AND(condition, ...)` combines conditions. Zero is false, nonzero is true.

| Operator | Version 1 semantics                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------- |
| VALUE    | Evaluated monthly value at the period's last month.                                                     |
| SUM      | Sum of evaluated monthly values within the period, inclusive.                                           |
| AVG      | Mean of available monthly values within the period.                                                     |
| IVAP     | Initial value of the accumulation period: evaluated monthly value in its first month.                   |
| PMV12    | Evaluated monthly value twelve months before the selected month.                                        |
| A12      | Apply the referenced Metric's accumulation formula over the twelve months ending in the selected month. |

For a report period, `accumulation_formula_id` is evaluated. A self-reference such
as `|SUM:own-metric-UUID|` invokes **monthly evaluation**, not the same accumulation
formula again. Thus ratios use their declared accumulation expression instead of
summing monthly percentages. If the accumulation expression is empty, monthly
values are summed. Missing months are never forward-filled. Sparse sums/averages
use available values; entirely missing inputs remain null, and arithmetic with a
null operand remains null. Missing graph values are labelled in the UI.

Monetary inputs are converted once, at the reporting month, before arithmetic:
`value / EUR_source_index * EUR_target_index`. The index uses the first day of the
report month in `index_rates.period`. Ratios, percentages and counts are not
converted. A missing required exchange rate is an explicit error. Original signs
are retained, so a negative cost in a `+` formula remains a negative movement.

## Company-specific waterfall

The response also includes an 18-month monthly history for each displayed Metric,
ending at the selected reporting month. It uses the same formula engine,
dimension, end-date currency conversion and Revenue-based missing-value policy.
Each history point includes its own LTM evaluation for that month and the eleven
preceding months. Incomplete twelve-month windows produce a null LTM point, never
a partial or cumulative sum. Monthly bars use the left scale; the LTM series uses
an independent right scale. The right scale fits the LTM range and need not start
at zero. Touch or keyboard selection reveals exact values for each month.
The UI initially shows Revenue history; clicking a waterfall bar switches the
history to that Metric. Monthly histories remain monthly when the waterfall is
set to YTD or LTM. Shared report defaults are defined by `report-context.ts` and
`useReportContext.ts`: latest data month for the selected Company, EUR currency.

Income Statement overrides the base missing-value policy: a month with a Revenue
value (including zero) is treated as a complete statement. Missing monthly inputs
in that month become zero before formulas and subtotals are evaluated. Months
without Revenue retain the base missing-value behavior. The initial reporting
month is the latest available Revenue month for the Company and dimension, falling
back to other Income Statement data if needed. The default currency is EUR.

`GET /api/portfolio/companies/:companyId/income-statement`
accepts `date=YYYY-MM`, `currency=CC|EUR`, `aggregation=MONTH|YTD|LTM` and
`dimension=actual|budget|forecast|plan`. Entity read permissions are checked before
running a read-only database snapshot.

Revenue (Metric Number **1000000**) and Net Income (**1600000**) identify the
endpoints. The engine follows the unique additive path through the **selected
Company's monthly formulas**, starting from Net Income back to Revenue. Sibling
terms become signed movements. Formula ancestors become independently evaluated
subtotals, starting at zero, not extra changes. This also includes intermediary
steps such as Total Output when they appear in that Company's formulas.

The frontend receives labels, Metric IDs/numbers, signed values, starts, ends and
the formula reference for each bar. It does not select cost items or calculate
financial amounts. If no additive path exists, only the two available endpoints
are shown with an explanatory message. Missing amounts are not represented as
zero or fabricated balancing items. Differences between an independently
accumulated subtotal and the monthly movement bridge are surfaced as warnings.
