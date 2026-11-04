import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../../database/connection.js';
import { definitions, entityName, type Entity } from '../../entities.js';
import { compileSearch, type SearchDefinition } from '../search.js';
import { activeRow } from '../../repositories/entities.js';
import { KpiEngine } from '../kpi-engine.js';
import { permit, prepareFormula, type Rights } from '../kpi-definitions.js';
import { httpError } from '../../shared/errors.js';
import type { ReportBinding, CustomContext, CustomReportInput } from './definition.js';

export type BindingResult = {
  key: string;
  label: string;
  kind: 'value' | 'query';
  value?: string | null;
  formatted?: string;
  status: string;
  message?: string;
  points?: { month: string; value: string | null; formatted: string }[];
  rows?: Record<string, unknown>[];
};
export const shiftedMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};
export function scopedQuery(
  binding: Extract<ReportBinding, { kind: 'query' }>,
  context: CustomContext,
  company: Record<string, any>
): SearchDefinition {
  const query = structuredClone(binding.definition);
  const aliases = new Map<string, Entity>([['root', entityName(query.entity)]]);
  for (const join of query.joins) {
    const from = aliases.get(join.from);
    const target = from && (definitions[from].refs as Record<string, string>)[join.field];
    if (!target) throw httpError(400, 'Ungültige Report-Verknüpfung.');
    aliases.set(join.alias, entityName(target));
  }
  const scoped = aliases.get(binding.company_alias);
  for (const filter of query.filters) {
    const entity = aliases.get(filter.alias);
    const reference = entity && (definitions[entity].refs as Record<string, string>)[filter.field];
    if (
      reference === 'companies' ||
      (filter.alias === binding.company_alias && ['id', 'objectId'].includes(filter.field)) ||
      filter.field === 'dimension' ||
      filter.field === 'period'
    )
      throw httpError(
        400,
        'Company, Monat und Dimension über den Berichtskontext bzw. das Mapping festlegen, nicht als feste Query-Filter.'
      );
  }
  if (scoped === 'companies')
    query.filters.push({
      alias: binding.company_alias,
      field: 'objectId',
      op: 'eq',
      value: context.company_id,
    });
  else if (scoped === 'funds')
    query.filters.push({
      alias: binding.company_alias,
      field: 'objectId',
      op: 'eq',
      value: company.fund_id,
    });
  else if (
    scoped &&
    (definitions[scoped].refs as Record<string, string>).company_id === 'companies'
  )
    query.filters.push({
      alias: binding.company_alias,
      field: 'company_id',
      op: 'eq',
      value: context.company_id,
    });
  else if (!(
    binding.company_alias === 'context' && ['deal_types', 'index_rates'].includes(query.entity)
  ))
    throw httpError(400, 'Query-Mapping benötigt eine Company-/Fund-Referenz im company_alias.');
  // KPIData must pass the engine's revision and dependency checks; raw snapshots
  // could be stale and are deliberately not usable as query sources.
  if ([...aliases.values()].includes('kpi_data'))
    throw httpError(400, 'KPIData über eine value-Quelle mit aggregation=KPI referenzieren.');
  for (const [alias, entity] of aliases) {
    const shape = definitions[entity].schema.shape;
    if ('dimension' in shape)
      query.filters.push({
        alias,
        field: 'dimension',
        op: 'eq',
        value: binding.dimension || context.dimension,
      });
    if (
      'period' in shape &&
      !(binding.date_field?.alias === alias && binding.date_field.field === 'period')
    ) {
      query.filters.push(
        { alias, field: 'period', op: 'gte', value: `${context.date}-01` },
        { alias, field: 'period', op: 'lt', value: `${shiftedMonth(context.date, 1)}-01` }
      );
    }
  }
  if (binding.date_field) {
    const { alias, field, mode } = binding.date_field;
    if (mode === 'month')
      query.filters.push({ alias, field, op: 'gte', value: `${context.date}-01` });
    query.filters.push({ alias, field, op: 'lt', value: `${shiftedMonth(context.date, 1)}-01` });
  }
  return query;
}
const draft = (binding: Extract<ReportBinding, { kind: 'value' }>) => ({
  name: binding.label,
  description: 'Custom Report binding',
  unit: '',
  decimals: binding.decimals,
  TextEditor: 'A',
  variables: [
    {
      ...binding.source,
      identifier: 'A',
      dimension: ['MONTH', 'LTM', 'YTD'].includes(binding.source.aggregation)
        ? binding.source.dimension
        : null,
    },
  ],
});

export async function validateMappings(
  db: DatabaseClient,
  rights: Rights,
  input: CustomReportInput
) {
  for (const binding of input.mapping) {
    if (binding.kind === 'value') {
      if (binding.source.record_id)
        throw httpError(
          400,
          'Report-Variablen verwenden den Company-Kontext, keine feste record_id.'
        );
      if (
        binding.source.filter?.field === 'company_id' &&
        binding.source.filter.operator !== 'context_company'
      )
        throw httpError(400, 'Company-Filter müssen den aktuellen Berichtskontext verwenden.');
      await prepareFormula(db, draft(binding), rights);
    } else {
      compileSearch(
        scopedQuery(
          binding,
          {
            company_id: '00000000-0000-4000-8000-000000000000',
            date: '2026-01',
            dimension: 'actual',
            currency: 'EUR',
          },
          { fund_id: '00000000-0000-4000-8000-000000000000' }
        ),
        rights
      );
    }
  }
}
export async function resolveBindings(
  db: DatabaseClient,
  rights: Rights,
  input: CustomReportInput,
  context: CustomContext
) {
  permit(rights, 'companies');
  const company = await activeRow(db, 'companies', context.company_id);
  const results: BindingResult[] = [];
  const engines = new Map<string, KpiEngine>();
  for (const binding of input.mapping) {
    if (binding.kind === 'query') {
      const compiled = compileSearch(scopedQuery(binding, context, company), rights);
      const rows = (await db.query(compiled.sql, [...compiled.values, binding.limit + 1, 0])).rows;
      results.push({
        key: binding.key,
        label: binding.label,
        kind: 'query',
        status: 'ok',
        rows: rows.slice(0, binding.limit),
        ...(rows.length > binding.limit
          ? { message: `Auf ${binding.limit} Zeilen begrenzt.` }
          : {}),
      });
      continue;
    }
    const points: NonNullable<BindingResult['points']> = [];
    const messages = new Set<string>();
    let status = 'ok';
    for (let offset = 1 - binding.months; offset <= 0; offset++) {
      const month = shiftedMonth(context.date, binding.month_offset + offset);
      const dimension = binding.source.dimension || context.dimension;
      const key = `${month}:${dimension}:${context.currency}`;
      let engine = engines.get(key);
      if (!engine) {
        engine = new KpiEngine(db, rights, {
          company_id: context.company_id,
          date: `${month}-01`,
          dimension,
          currency: context.currency,
        });
        engines.set(key, engine);
      }
      const result =
        binding.source.aggregation === 'KPI'
          ? await engine.evaluateId(binding.source.target_kpi_id!)
          : await engine.evaluate({ ...draft(binding), engine_version: 1 });
      if (result.status !== 'ok') status = result.status;
      if (result.message) messages.add(`${month}: ${result.message}`);
      const value =
        result.value === null ? null : new Decimal(result.value).div(binding.scale).toString();
      const formatted =
        value === null
          ? '–'
          : new Intl.NumberFormat('de-DE', {
              ...(binding.format === 'percent' ? { style: 'percent' as const } : {}),
              minimumFractionDigits: binding.decimals,
              maximumFractionDigits: binding.decimals,
            }).format(Number(value));
      points.push({ month, value, formatted });
    }
    const last = points.at(-1)!;
    results.push({
      key: binding.key,
      label: binding.label,
      kind: 'value',
      status,
      value: last.value,
      formatted: last.formatted,
      points,
      ...(messages.size ? { message: [...messages].join('\n') } : {}),
    });
  }
  return { company, results };
}
