# Custom Reports

Company → Custom Reports has its own report sidebar with **Eigene**/**Geteilte** modes and search. A report is a reusable HTML fragment plus a typed data mapping; Company, month, currency and default dimension come from the filter toolbar. Opening a report or changing its context evaluates the mapping against current active database versions. No financial snapshot is saved in the template.

## Storage and permissions

Migration `024-custom-reports` creates versioned/audited `custom_reports` (CustomReport) and `custom_report_shares`. Reports contain owner, name, description, HTML, JSON mapping and engine version. Shares target either a user or a group. Only the owner can edit and manage shares; recipients can run reports using their own current Entity permissions. Sharing a report does not grant access to its underlying business data. Revocation takes effect on the next request.

Generic Data Management, Advanced Search and MCP record/query paths cannot bypass report-level access rules. Specialized endpoints and MCP tools enforce owner/share checks. Source Entity permissions and KPI dependency permissions are rechecked when running a report. Historic report versions retain their mappings.

## Mapping

Each binding has a unique stable `key` and a label. Two kinds are supported:

- `value`: `source` uses the existing KPI VariableInput format. MetricData MONTH/LTM/YTD, fixed Company/Fund/DealData fields, cumulative CapitalMovements and saved KPIs are available. The backend resolves saved KPIs through the existing engine, reusing valid KPIData materializations and falling back to live evaluation when missing/stale. `months` (1–36) creates a series; `month_offset` allows previous months. `scale` divides for display (e.g. millions). `format` and `decimals` control formatting. No fixed record IDs are accepted.
- `query`: uses the validated SearchDefinition, including declared joins, selected fields, filters and ordering. `company_alias` identifies the Company/Fund/company-related Entity. Company scope is appended server-side. Period and dimension filters are injected for all relevant aliases; an optional `date_field` supports monthly or cumulative date scope. Each query is limited to 100 rows. Tables with no Company relationship cannot be queried without a relationship, except the global DealType and IndexRates lookup tables. Raw KPIData queries are forbidden so stale values cannot bypass the calculation engine.

Variable dimensions can inherit the report or explicitly use actual/budget/forecast/plan. KPI dimensions are applied to the engine context, not embedded into its formula definition. Query dimensions can also override the report. Up to 40 mappings and 360 monthly value evaluations are allowed. Missing values are displayed as `–` with specific warnings, never invented as zero. Query tables preserve source units/currency; use a value binding for calculated/converted financial values.

## HTML

Templates use semantic HTML with fixed application classes: `report-grid`, `report-grid-3`, `card`, `metric-value`, `muted`, `positive`, `negative`, `full-width`, `table-scroll`. Theme colors are injected from the current application settings.

- `{{company}}`, `{{date}}`, `{{currency}}`, `{{dimension}}`: report context.
- `{{mapping_key}}` or `<span data-value="mapping_key"></span>`: latest formatted value.
- `<div data-chart="mapping_key" data-kind="bar"></div>` or `line`: server-generated responsive SVG history.
- `<div data-table="mapping_key"></div>`: live query rows or a value series.

Templates cannot contain scripts, external resources, inline CSS, event handlers, forms, links or arbitrary embedded documents. The server parses and validates HTML before storage/rendering and escapes all source data. The iframe uses an empty sandbox and restrictive CSP; report code has no access to application cookies, network requests or the parent DOM. Only report contents scroll; the main page stays viewport bounded.

## Chat module and workflow

The dedicated module is exposed to the in-app chat and MCP:

1. `get_custom_report_guide`: syntax, JSON schema, design classes and example.
2. Existing discovery tools resolve actual entities, KPI IDs and Metric Numbers.
3. `preview_custom_report`: validate mappings and resolve live values in the selected Company/month context.
4. `propose_custom_report`: generate a signed, version-checked proposal with HTML preview.
5. The user commits through the existing chat proposal button. `custom_report` changes are audited and idempotent. The report list refreshes after commit; subsequent openings resolve current data again.

`list_custom_reports`, `get_custom_report`, `run_custom_report` support inspection and follow-up edits. This extends the existing chat orchestration; it does not add another paid model call or provider configuration. Example: “Erstelle einen Custom Report mit Umsatz, EBITDA-Marge und Net Debt, einem Revenue-Verlauf über 18 Monate und Actual/Budget-Vergleich.”

API: `GET /api/custom-reports`, `GET /:id`, `GET /:id/run`, `GET /recipients`, and owner-only `GET/POST /:id/shares`, `DELETE /:id/shares/:shareId`. Report creation/editing goes through reviewed chat proposals rather than unrestricted record writes.
