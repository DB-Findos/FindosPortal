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
  currency_context: { mode: 'CC' | 'EUR'; code: string };
  value: string | null;
  status: 'ok' | 'missing' | 'error' | 'forbidden';
  message?: string;
  variables: {
    identifier: string;
    name: string;
    value: string;
    period?: string;
    currency?: string;
  }[];
}
export class KpiEngine {
  private cache = new Map<string, KpiResult>();
  private count = 0;
  private companyCurrencyCache?: Promise<string>;
  constructor(
    private client: DatabaseClient,
    private rights: Rights,
    private context: ReportContext
  ) {}
  private async companyCurrency(): Promise<string> {
    if (!this.companyCurrencyCache)
      this.companyCurrencyCache = (async () => {
        const company = await activeRow(this.client, 'companies', this.context.company_id);
        if (company.currency) return company.currency as string;
        const fund = await activeRow(this.client, 'funds', company.fund_id);
        return fund.currency as string;
      })();
    return this.companyCurrencyCache;
  }
  private async targetCurrency() {
    return (this.context.currency || 'CC') === 'EUR' ? 'EUR' : this.companyCurrency();
  }
  private async rate(currency: string, period: string): Promise<Decimal> {
    if (currency === 'EUR') return new D(1);
    const rows = (
      await this.client.query(
        `SELECT index_value::text AS index_value FROM portal.index_rates WHERE base_currency='EUR' AND currency=$1 AND period=$2::date AND ${current} ORDER BY as_of_date DESC LIMIT 1`,
        [currency, period]
      )
    ).rows;
    if (!rows.length)
      throw new Missing(`Kein Indexkurs EUR/${currency} für ${period.slice(0, 7)} vorhanden.`);
    const value = new D(rows[0].index_value);
    if (!value.isFinite() || value.lte(0)) throw new Error(`Ungültiger Indexkurs EUR/${currency}.`);
    return value;
  }
  private async convert(
    value: string,
    source: string,
    target: string,
    period: string
  ): Promise<string> {
    if (source === target) return new D(value).toString();
    // IndexRates stores foreign-currency units per EUR: x / IndexValue = EUR.
    const sourceRate = await this.rate(source, period);
    const targetRate = await this.rate(target, period);
    return new D(value).div(sourceRate).mul(targetRate).toString();
  }
  private metricIsMonetary(metric: { currency?: string | null; unit?: string | null }) {
    if (
      /(%|percent|ratio|multiple|\b(?:x|days?|months?|years?|fte|headcount|units?|count|number)\b)/i.test(
        metric.unit || ''
      )
    )
      return false;
    return true;
  }
  private fixedFieldIsMonetary(entity: string, field: string) {
    return (
      entity === 'deal_data' &&
      new Set([
        'findos_investment_value',
        'revenue_ltm',
        'ebitda_ltm',
        'ebita_ltm',
        'fixed_ev',
        'transaction_cost',
        'overfunding',
        'transaction_cost_other',
        'debt_financing',
        'purchase_price_total',
      ]).has(field)
    );
  }
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
            throw new Error(
              `Der Filterwert „${filterValue}“ ist für ${targetEntity} nicht eindeutig.`
            );
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
      currency_context: { mode: this.context.currency || 'CC', code: 'EUR' },
      value: null,
      status: 'ok',
      variables: [],
    };
    try {
      const targetCurrency = await this.targetCurrency();
      result.currency_context = { mode: this.context.currency || 'CC', code: targetCurrency };
      if (formula.engine_version !== 1) throw new Error('Unbekannte Formelversion.');
      const values: Record<string, string> = {};
      for (const v of formula.variables) {
        if (++this.count > 1000) throw new Error('Maximal 1.000 Variablen pro Bericht.');
        permit(this.rights, v.entity);
        let value: string, period: string | undefined, variableCurrency: string | undefined;
        if (['MONTH', 'LTM', 'YTD'].includes(v.aggregation)) {
          permit(this.rights, 'metrics');
          permit(this.rights, 'companies');
          const metrics = (
            await this.client.query(
              `SELECT "objectId",currency,unit FROM portal.metrics WHERE company_id=$1 AND metric_number=$2 AND ${current}`,
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
              `SELECT to_char(date_trunc('month',period),'YYYY-MM-DD') AS month, value::text AS value, currency FROM portal.metric_data WHERE metric_id=$1 AND dimension=$2 AND period >= $3::date AND period < $4::date AND ${current} ORDER BY period`,
              [metrics[0].objectId, v.dimension || this.context.dimension, window.start, window.end]
            )
          ).rows;
          const counts = new Map<string, number>();
          for (const row of rows) counts.set(row.month, (counts.get(row.month) || 0) + 1);
          const ambiguous = [...counts].find(([, count]) => count > 1);
          if (ambiguous)
            throw new Error(`${v.identifier}: Mehrere Werte im Monat ${ambiguous[0].slice(0, 7)}.`);
          const missing = window.months.filter(
            (month) => !rows.some((r) => r.month === month && r.value != null)
          );
          if (missing.length)
            throw new Missing(
              `${v.identifier}: Fehlende Werte für ${missing.map((m) => m.slice(0, 7)).join(', ')} (${v.dimension || this.context.dimension}).`
            );
          const ratePeriod = `${this.context.date.slice(0, 7)}-01`;
          const metric = metrics[0];
          const monetary = this.metricIsMonetary(metric);
          const sourceDefault = metric.currency || (await this.companyCurrency());
          let total = new D(0);
          for (const row of rows) {
            if (row.value == null) continue;
            const sourceCurrency = row.currency || sourceDefault;
            const converted = monetary
              ? await this.convert(row.value, sourceCurrency, targetCurrency, ratePeriod)
              : row.value;
            total = total.plus(converted);
          }
          value = total.toString();
          if (monetary) variableCurrency = targetCurrency;
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
          if (this.fixedFieldIsMonetary(v.entity, v.field)) {
            const sourceCurrency =
              record.data_currency || record.company_currency || (await this.companyCurrency());
            value = await this.convert(
              value,
              sourceCurrency,
              targetCurrency,
              `${this.context.date.slice(0, 7)}-01`
            );
            variableCurrency = targetCurrency;
          }
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
          variableCurrency = nested.currency_context.code;
        } else throw new Error('Unbekannte Aggregation.');
        values[v.identifier] = value;
        result.variables.push({
          identifier: v.identifier,
          name: v.name,
          value,
          ...(period ? { period } : {}),
          ...(variableCurrency ? { currency: variableCurrency } : {}),
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
