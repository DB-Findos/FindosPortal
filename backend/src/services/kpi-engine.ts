import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../database/connection.js';
import { definitions, fields, type Entity } from '../entities.js';
import { activeRow, current } from '../repositories/entities.js';
import { calculate, monthWindow, parseFormula } from './formula-language.js';
import { formulaWithVariables, numericSources, permit, type Rights } from './kpi-definitions.js';
import type { ReportContext } from './kpi-schema.js';

const D = Decimal.clone({ precision: 40 });
class Missing extends Error {}
export interface KpiResult {
  objectId: string;
  name: string;
  unit: string;
  decimals: number;
  value: string | null;
  status: 'ok' | 'missing' | 'error' | 'forbidden';
  message?: string;
  variables: { identifier: string; name: string; value: string; period?: string }[];
}
export class KpiEngine {
  private cache = new Map<string, KpiResult>();
  private count = 0;
  constructor(
    private client: DatabaseClient,
    private rights: Rights,
    private context: ReportContext
  ) {}
  private async contextRecord(
    entity: Entity,
    filter: { field: string; operator: 'equals' | 'context_company'; value: string | null } | null
  ) {
    const company = await activeRow(this.client, 'companies', this.context.company_id);
    let record: Record<string, any>;
    if (entity === 'companies') record = company;
    else if (entity === 'funds') record = await activeRow(this.client, 'funds', company.fund_id);
    else if (entity === 'deal_data') {
      const values: string[] = [this.context.company_id];
      const clauses = ['company_id=$1'];
      if (filter) {
        if (!fields(entity).some((field) => field.name === filter.field))
          throw new Error('Ungültiges Filterfeld.');
        let filterValue =
          filter.operator === 'context_company' ? this.context.company_id : filter.value!;
        const targetEntity = (definitions[entity].refs as Record<string, string>)[filter.field];
        if (filter.operator === 'equals' && targetEntity) {
          const matches = (
            await this.client.query(
              `SELECT "objectId" FROM portal.${targetEntity} WHERE name=$1 AND ${current} LIMIT 2`,
              [filterValue]
            )
          ).rows;
          if (!matches.length)
            throw new Missing(`Kein ${targetEntity}-Eintrag mit dem Namen „${filterValue}“.`);
          if (matches.length > 1)
            throw new Error(`Der Filterwert „${filterValue}“ ist für ${targetEntity} nicht eindeutig.`);
          filterValue = matches[0].objectId;
        }
        values.push(filterValue);
        clauses.push(`"${filter.field}"=$${values.length}`);
      }
      const rows = (
        await this.client.query(
          `SELECT * FROM portal.deal_data WHERE ${clauses.join(' AND ')} AND ${current} ORDER BY deal_date DESC, "lastModifiedAt" DESC LIMIT 2`,
          values
        )
      ).rows;
      if (!rows.length)
        throw new Missing('Kein DealData-Datensatz für die Berichts-Company und den Filter.');
      if (rows.length > 1)
        throw new Error('DealData ist für diese Company und den Filter nicht eindeutig.');
      return rows[0];
    } else throw new Error('Diese Entity ist nicht über den Company-Kontext auflösbar.');
    if (filter) {
      if (!fields(entity).some((field) => field.name === filter.field))
        throw new Error('Ungültiges Filterfeld.');
      const expected =
        filter.operator === 'context_company' ? this.context.company_id : filter.value;
      if (String(record[filter.field]) !== expected)
        throw new Missing('Der Company-Kontext erfüllt den Filter nicht.');
    }
    return record;
  }
  async evaluateId(id: string, path = new Set<string>()): Promise<KpiResult> {
    permit(this.rights, 'kpi_formulas');
    permit(this.rights, 'variable_map');
    if (path.has(id) || path.size >= 12)
      throw new Error('Zirkuläre oder zu tief verschachtelte KPI.');
    const cached = this.cache.get(id);
    if (cached) return cached;
    const result = await this.evaluate(
      await formulaWithVariables(this.client, id),
      new Set(path).add(id)
    );
    this.cache.set(id, result);
    return result;
  }
  async evaluate(formula: Record<string, any>, path = new Set<string>()): Promise<KpiResult> {
    const result: KpiResult = {
      objectId: formula.objectId || 'preview',
      name: formula.name,
      unit: formula.unit,
      decimals: formula.decimals,
      value: null,
      status: 'ok',
      variables: [],
    };
    try {
      if (formula.engine_version !== 1) throw new Error('Unbekannte Formelversion.');
      const values: Record<string, string> = {};
      for (const v of formula.variables) {
        if (++this.count > 1000) throw new Error('Maximal 1.000 Variablen pro Bericht.');
        permit(this.rights, v.entity);
        let value: string, period: string | undefined;
        if (['MONTH', 'LTM', 'YTD'].includes(v.aggregation)) {
          permit(this.rights, 'metrics');
          permit(this.rights, 'companies');
          const metrics = (
            await this.client.query(
              `SELECT "objectId" FROM portal.metrics WHERE company_id=$1 AND metric_number=$2 AND ${current}`,
              [this.context.company_id, v.metric_number]
            )
          ).rows;
          if (!metrics.length)
            throw new Missing(
              `${v.identifier}: Metric ${v.metric_number} fehlt für diese Company.`
            );
          if (metrics.length !== 1)
            throw new Error(
              `${v.identifier}: Metric Number ${v.metric_number} ist für diese Company nicht eindeutig.`
            );
          const window = monthWindow(this.context.date, v.aggregation, v.prior_year);
          const rows = (
            await this.client.query(
              `SELECT to_char(date_trunc('month',period),'YYYY-MM-DD') AS month, count(*)::int AS records, count(value)::int AS populated, sum(value)::text AS value FROM portal.metric_data WHERE metric_id=$1 AND dimension=$2 AND period >= $3::date AND period < $4::date AND ${current} GROUP BY date_trunc('month',period)`,
              [metrics[0].objectId, v.dimension || this.context.dimension, window.start, window.end]
            )
          ).rows;
          const ambiguous = rows.find((r) => r.records > 1);
          if (ambiguous)
            throw new Error(
              `${v.identifier}: Mehrere Werte im Monat ${ambiguous.month.slice(0, 7)}.`
            );
          const missing = window.months.filter(
            (month) => !rows.some((r) => r.month === month && r.populated === 1)
          );
          if (missing.length)
            throw new Missing(
              `${v.identifier}: Fehlende Werte für ${missing.map((m) => m.slice(0, 7)).join(', ')} (${v.dimension || this.context.dimension}).`
            );
          value = rows.reduce((sum, row) => sum.plus(row.value), new D(0)).toString();
          period = `${window.start.slice(0, 7)} – ${window.months.at(-1)!.slice(0, 7)}`;
        } else if (v.aggregation === 'FIXED') {
          if (
            !numericSources(this.rights)
              .find((s) => s.entity === v.entity)
              ?.fields.includes(v.field)
          )
            throw new Error('Ungültiges numerisches Quellfeld.');
          const record = await this.contextRecord(v.entity as Entity, v.filter);
          if (record[v.field] == null)
            throw new Missing(`${v.identifier}: Das feste Quellfeld ist leer.`);
          value = new D(String(record[v.field])).toString();
        } else if (v.aggregation === 'KPI') {
          const nested = await this.evaluateId(v.target_kpi_id, path);
          if (nested.status !== 'ok') {
            if (nested.status === 'missing')
              throw new Missing(`${v.identifier}: ${nested.message}`);
            if (nested.status === 'forbidden')
              throw Object.assign(
                new Error('Keine Berechtigung für eine referenzierte KPI-Quelle.'),
                { status: 403 }
              );
            throw new Error(`${v.identifier}: ${nested.message}`);
          }
          value = nested.value!;
        } else throw new Error('Unbekannte Aggregation.');
        values[v.identifier] = value;
        result.variables.push({
          identifier: v.identifier,
          name: v.name,
          value,
          ...(period ? { period } : {}),
        });
      }
      result.value = calculate(parseFormula(formula.TextEditor).ast, values);
    } catch (error) {
      // Infrastructure/SQL errors belong to the central error handler, not to report data.
      if ((error as any).code) throw error;
      result.status =
        (error as any).status === 403
          ? 'forbidden'
          : error instanceof Missing
            ? 'missing'
            : 'error';
      result.message = (error as Error).message;
      // Never leak successfully resolved values from a partially forbidden formula.
      if (result.status === 'forbidden') result.variables = [];
    }
    return result;
  }
}
