# Monthly KPIData

Migrations 020/021 create `portal.kpi_data`, shown as **KPIData** in Data Management. It uses the same stable objectId / immutable version history as MetricData. Results are identified by KPI, Company, month (first day), dimension and currency mode (CC/EUR). Each result also records its actual currency, unit, formula version, dependency versions, source revision, calculation timestamp, resolved variables and status. Missing inputs remain null with an explanation; calculation errors are distinguished from missing data. KPIData is read-only through the generic data API and MCP; source permissions also restrict Data Management, history and Advanced Search.

## Automatic calculation and freshness

The existing KpiEngine remains the single calculation implementation. SQL statement triggers on MetricData, Metrics, Companies, Funds, DealData, DealTypes, CapitalMovements and IndexRates atomically increment a global source revision and enqueue a durable calculation job. Formula/VariableMap changes enqueue only the affected KPI and its transitive dependents, preserving unrelated warm results. Creating/updating KPIs through the editor, AI, MCP, scripts or direct audited database writes therefore all schedule calculation after commit. Multiple writes in one import coalesce into one pending global job; formula writes coalesce by KPI. Initial migration also enqueues a full backfill.

The Express backend runs a worker every five seconds. One running job per database is enforced, so multiple server instances do not duplicate the same work. Jobs and progress survive backend restarts. A five-minute expired heartbeat is marked interrupted and requeued. Failures are recorded and can be retried using Recalculate.

Monthly periods span each Company's first through last available MetricData month, with no gaps. Companies without MetricData use the current month. Actual plus the dimensions present in each Company's data are calculated, for both CC and EUR. The latest actual month is prioritized across all companies before historical months, which are processed newest first. Targeted KPI jobs can interrupt a global backfill between companies; the global backfill is requeued. Other contexts continue using the live engine. Source rows, FX rates and formula definitions are loaded into a consistent per-company snapshot and reused, avoiding database round trips per individual month/variable. Fixed fields use the same snapshot too. Missing FX/source values are saved as missing rather than zero.

KpiEngine.evaluateId automatically prefers persisted results only when Company, month, dimension, currency mode, every active formula/dependency version and current global source revision all match. Every required source Entity, including recursively referenced KPIs, must still be readable by the requesting user; otherwise normal permission-checked evaluation is used. A source revision change invalidates existing results immediately; a formula change invalidates that formula and its dependents through dependency-version checks. Stored calculation errors fall back to live calculation. Unfinished or outdated materializations never replace the live calculation. Unsaved formula previews always calculate directly.

Bridge history bulk-loads its effect KPIs in CC for all 18 months in one query, applying these same freshness and source-permission checks. CC displays use the stored scalar directly; EUR displays divide every CC scalar by the single EUR/Company-Currency IndexRate of the selected report month. Missing/outdated cache entries alone are evaluated live in their monthly CC context. This explicitly uses the monthly CC result as the history's base: native EUR/fixed-currency source amounts already included in that CC result retain their original monthly conversion before the final report-date translation. The current waterfall retains its selected-month evaluation. Other callers that explicitly request a different FX month continue to use the general engine's live fallback.

Published results are written in small audited transactions. Each batch checks the current revision, and any later revision makes the older rows ineligible. Changed results create new versions; unchanged results retain their identities and audit history. External source updates during a job cause the old job to yield to the newer queued job. No existing MetricData rows are modified.

## Manual recalculation

In **Settings → KPIs & Reporting → KPI formulas**, **Recalculate** recalculates the selected KPI and its transitive dependents. **Alle KPIs / Recalculate all** recalculates the entire library. Unsaved editor changes must first be saved. The worker refreshes the actual source variables, ignores stored results while calculating, and reports progress, valid results, missing inputs and errors. Closing the view does not cancel the durable job.

API:

- `POST /api/kpi/recalculate` with `{}` or `{ "formula_id": "<objectId>" }`: returns 202 and the queued job; requires update permission on KPI formulas and read permission on VariableMap.
- `GET /api/kpi/calculations/latest?formula_id=<optional>` and `GET /api/kpi/calculations/:id`: status and progress.
- `npm run db:recalculate-kpis`: enqueue and drain a full calculation without starting an HTTP server. `-- --pending-only` drains existing jobs.

Apply using the existing `db:migrate` workflow and deploy the backend/frontend code. The already running backend process is not restarted by the migration or CLI calculation. No extra hosted service or API key is required.
