import { z } from 'zod';
import type { Actor } from '../../mcp/data.js';
import { proposeChange } from '../../mcp/changes.js';
import { snapshot } from '../snapshot.js';
import { customReportInput, customContext } from './definition.js';
import { accessibleReport, listCustomReports, runCustomReport } from './store.js';

export const customReportInstructions = `CUSTOM REPORT MODULE: For reusable HTML Custom Reports use get_custom_report_guide first, then discover actual Entity fields/KPI IDs/Metric Numbers with the existing tools. Never store snapshots of financial values in HTML. All numbers, charts and live tables must reference mapping keys. Company and report month come exclusively from the UI context, not hardcoded record IDs/filters. Per-source dimension can inherit the report or override it. Use preview_custom_report to check values, then propose_custom_report to produce a committable HTML report card. Never use the old report kind (that only groups KPIs) for Custom Reports. Never claim created/saved before user commit. Shared reports are read-only for recipients. To change an existing report load get_custom_report and supply object_id and expected_version. Existing KPI sources automatically use fresh KPIData, otherwise evaluate with the backend engine. Raw KPIData queries are forbidden because freshness must be checked.`;

export const customReportTools = [
  {
    name: 'get_custom_report_guide',
    description:
      'Load the dedicated HTML Custom Report module: template syntax, mapping schema, design classes and safe live data rules. FIRST step when creating a Custom Report.',
    schema: z.object({}).strict(),
    run: () => ({
      instructions: customReportInstructions,
      schema: z.toJSONSchema(customReportInput),
      html: 'HTML fragment only; no scripts/styles/links/images/iframes/inline attributes. Uses the application design automatically. Allowed semantic tags div, section, article, header, footer, main, aside, h1-h5, p, span, strong, em, b, i, small, br, hr, ul, ol, li, table, thead, tbody, tfoot, tr, th, td, caption, figure, figcaption. Allowed attributes class/title/colspan/rowspan/scope/data-value/data-chart/data-table/data-kind.',
      placeholders:
        '{{company}}, {{date}}, {{currency}}, {{dimension}}, {{mapping_key}}. data-value="key" renders latest scalar. data-chart="key" data-kind="bar|line" renders SVG from monthly series. data-table="key" renders live query results or series.',
      classes:
        'report-grid, report-grid-3, card, metric, metric-value, muted, positive, negative, full-width, table-scroll. Use titles and short explanatory text. Charts are server-rendered responsive SVG, never JavaScript.',
      value_source:
        'kind=value: source uses the existing variableInput. identifier=A. MetricData: entity=metric_data, field=value, metric_number resolved from name, aggregation MONTH/LTM/YTD. Existing KPI or KPIData: entity=kpi_formulas, field=result, aggregation=KPI, target_kpi_id=logical KPI objectId. Fixed fields: FIXED, no record_id. Cumulative CapitalMovements: CUMULATIVE. For a time series set months=18, month_offset=0. Format number/percent/currency, scale divides values (e.g. 1000000 for millions). Source dimension=null inherits report; explicit actual/budget/forecast/plan overrides. Do not create new KPIs unless requested/needed.',
      query_source:
        'kind=query: definition is the existing searchDefinition (root alias, declared joins only). company_alias must refer to companies, funds, or an Entity with company_id; context filters are enforced server-side. For global deal_types/index_rates only, company_alias=context is allowed. Every dimension/period alias gets automatic context filters. Optional date_field {alias,field,mode:month|through_month} supports movement_date and other dates. A table can read all authorized fields including text/comments through this source. query KPIData is forbidden; use value with aggregation KPI.',
      example: {
        name: 'Revenue overview',
        description: 'Live company revenue',
        html: '<header><h1>{{company}}</h1><p class="muted">{{date}} · {{currency}} · {{dimension}}</p></header><div class="report-grid"><section class="card"><h2>Revenue</h2><p class="metric-value" data-value="revenue"></p></section><section class="card"><h2>Revenue development</h2><div data-chart="revenue" data-kind="bar"></div></section></div>',
        mapping: [
          {
            key: 'revenue',
            label: 'Revenue',
            kind: 'value',
            source: {
              identifier: 'A',
              entity: 'metric_data',
              field: 'value',
              aggregation: 'MONTH',
              metric_number: 1000000,
              dimension: null,
              record_id: null,
              target_kpi_id: null,
              prior_year: false,
              filter: null,
            },
            months: 18,
            month_offset: 0,
            format: 'number',
            scale: 1,
            decimals: 0,
          },
        ],
      },
    }),
  },
  {
    name: 'list_custom_reports',
    description:
      'List your own or explicitly shared HTML reports. Search by name/description. No other private reports are exposed.',
    schema: z
      .object({
        scope: z.enum(['own', 'shared']).default('own'),
        search: z.string().max(200).default(''),
      })
      .strict(),
    run: (actor: Actor, input: any) =>
      snapshot((db) => listCustomReports(db, actor, input.scope, input.search)),
  },
  {
    name: 'get_custom_report',
    description:
      'Read a permitted saved CustomReport including its HTML template and full live mapping. Use version id for edits.',
    schema: z.object({ report_id: z.uuid() }).strict(),
    run: (actor: Actor, input: any) =>
      snapshot((db) => accessibleReport(db, actor, input.report_id)),
  },
  {
    name: 'run_custom_report',
    description:
      'Resolve a saved CustomReport in a Company/month/currency/dimension context. Reuses fresh KPIData and returns actual mapped values, HTML and warnings.',
    schema: z.object({ report_id: z.uuid(), context: customContext }).strict(),
    run: (actor: Actor, input: any) =>
      snapshot(async (db) => {
        const row = await accessibleReport(db, actor, input.report_id);
        return runCustomReport(
          db,
          actor,
          { name: row.name, description: row.description, html: row.html, mapping: row.mapping },
          input.context
        );
      }),
  },
  {
    name: 'preview_custom_report',
    description:
      'Validate and render an unsaved HTML Custom Report using live database values. Read-only; never saves a report.',
    schema: z.object({ report: customReportInput, context: customContext }).strict(),
    run: (actor: Actor, input: any) =>
      snapshot((db) => runCustomReport(db, actor, input.report, input.context)),
  },
  {
    name: 'propose_custom_report',
    description:
      'Dedicated Custom Report creation/edit module. Validates mappings, renders preview in the real context, and creates a committable proposal card. Does not save until user commits.',
    schema: z
      .object({
        report: customReportInput,
        context: customContext,
        object_id: z.uuid().optional(),
        expected_version: z.uuid().optional(),
      })
      .strict(),
    run: async (actor: Actor, input: any) => {
      const rendered = await snapshot((db) =>
        runCustomReport(db, actor, input.report, input.context)
      );
      const change = await proposeChange(actor, {
        kind: 'custom_report',
        report: input.report,
        ...(input.object_id
          ? { object_id: input.object_id, expected_version: input.expected_version }
          : {}),
      });
      return {
        ...change,
        preview: {
          ...(change.preview as Record<string, unknown>),
          rendered_html: rendered.html,
          context: rendered.context,
          warnings: rendered.warnings,
        },
      };
    },
  },
];
