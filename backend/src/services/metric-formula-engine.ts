import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../database/connection.js';
import { httpError } from '../shared/errors.js';
import {
  evaluateMetricExpression,
  parseMetricExpression,
  type MetricExpression,
} from './metric-formula-format.js';

type Metric = {
  objectId: string;
  name: string;
  metric_number: number;
  currency: string | null;
  unit: string;
};
type Definition = {
  metric_id: string | null;
  dynamo_metric_id: string | null;
  metric_number: number | null;
  metric_source_name: string | null;
  formula_type: 'Data' | 'Range' | 'Formula';
  monthly_formula_id: string | null;
  accumulation_formula_id: string | null;
  range_from: number | null;
  range_to: number | null;
  engine_version: number;
};
export type IncomeContext = {
  companyId: string;
  date: string;
  currency: 'CC' | 'EUR';
  dimension: string;
  aggregation: 'MONTH' | 'YTD' | 'LTM';
};
export type WaterfallBar = {
  key: string;
  label: string;
  metricId: string;
  metricNumber: number;
  kind: 'total' | 'change';
  value: number | null;
  start: number | null;
  end: number | null;
  formula: string | null;
};
const addMonths = (month: string, count: number) => {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
};
function monthsBetween(start: string, end: string) {
  const months: string[] = [];
  for (let month = start; month <= end; month = addMonths(month, 1)) {
    if (months.length >= 120) throw new Error('Zu langer Auswertungszeitraum.');
    months.push(month);
  }
  return months;
}
const nonMonetary =
  /(%|percent|ratio|multiple|\b(?:x|days?|months?|years?|fte|headcount|units?|count|number)\b)/i;

/** Per-request evaluator. All expressions and the company-specific graph remain on the server. */
class MetricFormulaEngine {
  private metrics = new Map<string, Metric>();
  private definitions = new Map<string, Definition>();
  private data = new Map<string, Decimal>();
  private monthlyCache = new Map<string, Decimal | null>();
  private accumulationCache = new Map<string, Decimal | null>();
  private expressions = new Map<string, MetricExpression>();
  private active = new Set<string>();
  private zeroFillMonths = new Set<string>();
  private calls = 0;
  private rates = new Map<string, Decimal>([['EUR', new Decimal(1)]]);
  readonly warnings = new Set<string>();
  readonly end: string;
  readonly start: string;
  targetCurrency = 'EUR';
  company!: {
    objectId: string;
    name: string;
    internal_name: string | null;
    currency: string | null;
  };

  constructor(
    private db: DatabaseClient,
    private context: IncomeContext
  ) {
    this.end = `${context.date}-01`;
    this.start =
      context.aggregation === 'YTD'
        ? `${context.date.slice(0, 4)}-01-01`
        : context.aggregation === 'LTM'
          ? addMonths(this.end, -11)
          : this.end;
  }
  async load() {
    const company = await this.db.query(
      'SELECT "objectId",name,internal_name,currency FROM portal.companies WHERE "objectId"=$1 AND "archivedAt" IS NULL',
      [this.context.companyId]
    );
    if (!company.rows.length) throw httpError(404, 'Company nicht gefunden.');
    this.company = company.rows[0];
    this.targetCurrency = this.context.currency === 'EUR' ? 'EUR' : this.company.currency || 'EUR';
    const definitions = (
      await this.db.query<Definition>(
        'SELECT metric_id,dynamo_metric_id,metric_number,metric_source_name,formula_type,monthly_formula_id,accumulation_formula_id,range_from,range_to,engine_version FROM portal.metric_formulas WHERE company_id=$1 AND dimension=$2 AND "archivedAt" IS NULL',
        [this.context.companyId, this.context.dimension]
      )
    ).rows;
    const metrics = (
      await this.db.query<Metric>(
        'SELECT "objectId",name,metric_number,currency,unit FROM portal.metrics WHERE company_id=$1 AND "archivedAt" IS NULL',
        [this.context.companyId]
      )
    ).rows;
    for (const metric of metrics) this.metrics.set(metric.objectId, metric);
    for (const definition of definitions) {
      if (definition.engine_version !== 1)
        throw httpError(422, 'Unbekannte Metric-Formel-Version.');
      const id = definition.dynamo_metric_id || definition.metric_id;
      if (!id) continue;
      const previous = this.definitions.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(definition))
        throw httpError(
          422,
          `Mehrere widersprüchliche Formeln für Metric ${definition.metric_number}.`
        );
      this.definitions.set(id, definition);
      // New source metrics remain evaluable without inventing a Metric record or changing its Dynamo ID.
      if (!this.metrics.has(id) && definition.metric_number !== null) {
        const prefix = `${this.company.name} - `;
        this.metrics.set(id, {
          objectId: id,
          metric_number: definition.metric_number,
          name: (definition.metric_source_name || String(definition.metric_number)).replace(
            prefix,
            ''
          ),
          currency: this.company.currency,
          unit: '',
        });
      }
    }
    // A12/PMV12 can look back a further year; fetch a bounded window once per request.
    const values = (
      await this.db.query(
        `SELECT d.metric_id,to_char(date_trunc('month',d.period),'YYYY-MM-DD') AS period,d.value::text AS value,
         coalesce(d.currency,m.currency,$5) AS currency
       FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
       WHERE m.company_id=$1 AND d.dimension=$2 AND d.period >= $3::date AND d.period < $4::date AND d."archivedAt" IS NULL`,
        [
          this.context.companyId,
          this.context.dimension,
          addMonths(this.start, -36),
          addMonths(this.end, 1),
          this.company.currency || 'EUR',
        ]
      )
    ).rows;
    const currencies = new Set<string>([
      this.targetCurrency,
      ...values
        .filter((v) => !nonMonetary.test(this.metrics.get(v.metric_id)?.unit || ''))
        .map((v) => v.currency),
    ]);
    for (const currency of currencies) {
      if (currency === 'EUR') continue;
      const result = await this.db.query(
        'SELECT index_value::text FROM portal.index_rates WHERE base_currency=\'EUR\' AND currency=$1 AND period=$2::date AND "archivedAt" IS NULL ORDER BY as_of_date DESC LIMIT 1',
        [currency, this.end]
      );
      if (!result.rows.length)
        throw httpError(422, `Kein EUR-Indexkurs für ${currency} zum ${this.context.date}.`);
      const value = new Decimal(result.rows[0].index_value);
      if (!value.isFinite() || value.lte(0))
        throw httpError(422, `Ungültiger Indexkurs für ${currency}.`);
      this.rates.set(currency, value);
    }
    const seen = new Set<string>();
    for (const item of values) {
      const key = `${item.metric_id}:${item.period}`;
      if (seen.has(key))
        throw httpError(422, `Mehrere MetricData-Werte für ${item.metric_id} in ${item.period}.`);
      seen.add(key);
      if (item.value === null) continue;
      let value = new Decimal(item.value);
      if (!nonMonetary.test(this.metrics.get(item.metric_id)?.unit || ''))
        value = value.div(this.rates.get(item.currency)!).mul(this.rates.get(this.targetCurrency)!);
      this.data.set(key, value);
    }
  }
  private ast(text: string) {
    let result = this.expressions.get(text);
    if (!result) {
      result = parseMetricExpression(text);
      this.expressions.set(text, result);
    }
    return result;
  }
  private sum(values: (Decimal | null)[]) {
    const present = values.filter((v): v is Decimal => v !== null);
    return present.length ? present.reduce((a, b) => a.plus(b), new Decimal(0)) : null;
  }
  private guarded(key: string, work: () => Decimal | null): Decimal | null {
    if (++this.calls > 200000 || this.active.size > 128)
      throw httpError(422, 'Metric-Formel zu komplex.');
    if (this.active.has(key)) throw httpError(422, `Zyklische Metric-Formel: ${key}.`);
    this.active.add(key);
    try {
      return work();
    } finally {
      this.active.delete(key);
    }
  }
  private resolve(op: string, id: string, start: string, end: string): Decimal | null {
    if (!this.metrics.has(id))
      throw httpError(422, `Dynamo-Metric ${id} fehlt im Company-Kontext.`);
    switch (op) {
      case 'VALUE':
        return this.monthly(id, end);
      case 'IVAP':
        return this.monthly(id, start);
      case 'PMV12':
        return this.monthly(id, addMonths(end, -12));
      case 'A12':
        return this.accumulate(id, addMonths(end, -11), end);
      case 'SUM':
        return this.sum(monthsBetween(start, end).map((month) => this.monthly(id, month)));
      case 'AVG': {
        const values = monthsBetween(start, end)
          .map((month) => this.monthly(id, month))
          .filter((v): v is Decimal => v !== null);
        return values.length ? this.sum(values)!.div(values.length) : null;
      }
      default:
        throw httpError(422, `Unbekannter Metric-Operator ${op}.`);
    }
  }
  private rangeChildren(id: string, def: Definition) {
    if (def.range_from === null || def.range_to === null)
      throw httpError(422, `Range-Grenzen fehlen für ${def.metric_number}.`);
    const candidates = [...this.metrics.values()].filter(
      (m) =>
        m.objectId !== id && m.metric_number >= def.range_from! && m.metric_number <= def.range_to!
    );
    // Nested range totals replace their enclosed detail rows, avoiding double counting.
    return candidates.filter(
      (candidate) =>
        !candidates.some((parent) => {
          if (parent.objectId === candidate.objectId) return false;
          const definition = this.definitions.get(parent.objectId);
          return (
            definition?.formula_type === 'Range' &&
            definition.range_from !== null &&
            definition.range_to !== null &&
            candidate.metric_number >= definition.range_from &&
            candidate.metric_number <= definition.range_to
          );
        })
    );
  }
  private monthly(id: string, month: string): Decimal | null {
    const key = `${id}:${month}`;
    if (this.monthlyCache.has(key)) return this.monthlyCache.get(key)!;
    const result = this.guarded(`monthly:${key}`, () => {
      const definition = this.definitions.get(id);
      if (!definition || definition.formula_type === 'Data') return this.data.get(key) ?? null;
      if (definition.formula_type === 'Range')
        return this.sum(
          this.rangeChildren(id, definition).map((m) => this.monthly(m.objectId, month))
        );
      if (!definition.monthly_formula_id)
        throw httpError(422, `Monatsformel fehlt für Metric ${definition.metric_number}.`);
      return evaluateMetricExpression(this.ast(definition.monthly_formula_id), (op, ref) =>
        this.resolve(op, ref, month, month)
      );
    });
    const value = result ?? (this.zeroFillMonths.has(month) ? new Decimal(0) : null);
    this.monthlyCache.set(key, value);
    return value;
  }
  private accumulate(id: string, start: string, end: string): Decimal | null {
    const key = `${id}:${start}:${end}`;
    if (this.accumulationCache.has(key)) return this.accumulationCache.get(key)!;
    const result = this.guarded(`accumulation:${key}`, () => {
      const definition = this.definitions.get(id);
      return definition?.accumulation_formula_id
        ? evaluateMetricExpression(this.ast(definition.accumulation_formula_id), (op, ref) =>
            this.resolve(op, ref, start, end)
          )
        : this.sum(monthsBetween(start, end).map((month) => this.monthly(id, month)));
    });
    this.accumulationCache.set(key, result);
    return result;
  }
  private terms(node: MetricExpression, sign = 1): { id: string; sign: number }[] | null {
    if (node.type === 'ref' && node.op === 'VALUE') return [{ id: node.id, sign }];
    if (node.type === 'unary') return this.terms(node.value, node.op === '-' ? -sign : sign);
    if (node.type === 'binary' && (node.op === '+' || node.op === '-')) {
      const left = this.terms(node.left, sign),
        right = this.terms(node.right, node.op === '-' ? -sign : sign);
      return left && right ? [...left, ...right] : null;
    }
    return null;
  }
  private incomeTerms(id: string) {
    const definition = this.definitions.get(id);
    return definition?.formula_type === 'Formula' && definition.monthly_formula_id
      ? this.terms(this.ast(definition.monthly_formula_id))
      : null;
  }
  waterfall() {
    const byNumber = (number: number) => {
      const matches = [...this.metrics.values()].filter((m) => m.metric_number === number);
      if (matches.length > 1) throw httpError(422, `Metric Number ${number} ist nicht eindeutig.`);
      return matches[0];
    };
    const revenue = byNumber(1000000),
      netIncome = byNumber(1600000);
    if (!revenue || !netIncome)
      return {
        bars: [],
        warnings: ['Revenue oder Net Income ist für diese Company nicht verfügbar.'],
      };
    // Revenue marks a complete monthly statement, including an explicit zero revenue.
    // Fill missing inputs before deriving subtotals, so the bridge remains consistent.
    const completeMonths = monthsBetween(addMonths(this.end, -28), this.end).filter(
      (month) => this.monthly(revenue.objectId, month) !== null
    );
    for (const month of completeMonths) this.zeroFillMonths.add(month);
    this.monthlyCache.clear();
    this.accumulationCache.clear();
    const bars: WaterfallBar[] = [];
    let running: Decimal | null = null;
    const append = (id: string, kind: 'total' | 'change', sign = 1) => {
      const metric = this.metrics.get(id);
      if (!metric) throw httpError(422, `Metric ${id} fehlt im Company-Kontext.`);
      const value = this.accumulate(id, this.start, this.end)?.mul(sign) ?? null;
      if (value === null)
        this.warnings.add(`Keine vollständigen Berechnungsdaten für ${metric.name}.`);
      const start = kind === 'total' ? new Decimal(0) : running;
      const end =
        kind === 'total' ? value : running !== null && value !== null ? running.plus(value) : null;
      bars.push({
        key: `${id}:${bars.length}`,
        label: metric.name,
        metricId: id,
        metricNumber: metric.metric_number,
        kind,
        value: value?.toNumber() ?? null,
        start: start?.toNumber() ?? null,
        end: end?.toNumber() ?? null,
        formula: this.definitions.get(id)?.monthly_formula_id ?? null,
      });
      running = end;
    };
    const containsRevenue = (id: string, visited = new Set<string>()): boolean => {
      if (id === revenue.objectId) return true;
      if (visited.has(id) || visited.size > 64) return false;
      const next = new Set(visited);
      next.add(id);
      return (
        this.incomeTerms(id)?.some((term) => term.sign === 1 && containsRevenue(term.id, next)) ??
        false
      );
    };
    const walk = (id: string, visited = new Set<string>()) => {
      if (id === revenue.objectId) {
        append(id, 'total');
        return;
      }
      if (visited.has(id) || visited.size > 32)
        throw httpError(422, 'Zyklischer Income-Statement-Aufbau.');
      const next = new Set(visited);
      next.add(id);
      const terms = this.incomeTerms(id);
      const paths = terms?.filter((term) => term.sign === 1 && containsRevenue(term.id)) ?? [];
      if (!terms || paths.length !== 1)
        throw httpError(
          422,
          `Keine eindeutige additive Revenue-Verbindung in ${this.metrics.get(id)?.name}.`
        );
      walk(paths[0].id, next);
      for (const term of terms) if (term !== paths[0]) append(term.id, 'change', term.sign);
      // A reported subtotal is reset to its evaluated amount, never added to the running balance.
      const computed = this.accumulate(id, this.start, this.end);
      if (
        computed !== null &&
        running !== null &&
        computed.minus(running).abs().gt(Decimal.max(computed.abs(), 1).mul('0.00000001'))
      )
        this.warnings.add(
          `Accumulation und Monatsbrücke weichen bei ${this.metrics.get(id)?.name} voneinander ab.`
        );
      append(id, 'total');
    };
    if (containsRevenue(netIncome.objectId)) walk(netIncome.objectId);
    else {
      append(revenue.objectId, 'total');
      append(netIncome.objectId, 'total');
      this.warnings.add(
        'Die importierten Formeln enthalten keine additive Verbindung von Revenue zu Net Income; eine Kostenbrücke kann daraus nicht abgeleitet werden.'
      );
    }
    return { bars, warnings: [...this.warnings] };
  }
  history(metricIds: string[]) {
    return [...new Set(metricIds)].map((metricId) => {
      const metric = this.metrics.get(metricId)!;
      return {
        metricId,
        label: metric.name,
        metricNumber: metric.metric_number,
        points: monthsBetween(addMonths(this.end, -17), this.end).map((month) => {
          const start = addMonths(month, -11);
          // Each point is its own trailing twelve-month result, never a cumulative
          // total of the displayed chart months or a partial twelve-month window.
          const complete = monthsBetween(start, month).every(
            (period) => this.monthly(metricId, period) !== null
          );
          return {
            month: month.slice(0, 7),
            value: this.monthly(metricId, month)?.toNumber() ?? null,
            ltm: complete ? (this.accumulate(metricId, start, month)?.toNumber() ?? null) : null,
          };
        }),
      };
    });
  }
}

export async function incomeStatement(db: DatabaseClient, context: IncomeContext) {
  const engine = new MetricFormulaEngine(db, context);
  await engine.load();
  const waterfall = engine.waterfall();
  return {
    company: engine.company,
    date: context.date,
    dimension: context.dimension,
    aggregation: context.aggregation,
    currency: { mode: context.currency, code: engine.targetCurrency },
    period: { start: engine.start, end: engine.end },
    engineVersion: 1,
    ...waterfall,
    history: engine.history(waterfall.bars.map((bar) => bar.metricId)),
  };
}
