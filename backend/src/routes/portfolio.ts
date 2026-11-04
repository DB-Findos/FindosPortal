import { Decimal } from 'decimal.js';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { authenticate, permissions, requirePermission } from '../middleware/auth.js';
import { current } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';
import { snapshot } from '../services/snapshot.js';
import { incomeStatement, balanceSheet } from '../services/metric-formula-engine.js';
import { reportMonth } from '../services/report-context.js';
import { bridgeReport } from '../services/bridge-report.js';
import { investorReport } from '../services/investor-report.js';

export const portfolioRouter = Router();
portfolioRouter.use(authenticate);

portfolioRouter.get('/companies/:companyId/details', async (req, res) => {
  const rights = await permissions(req.userId!);
  if (!rights.companies?.can_read) throw httpError(403, 'Keine Berechtigung.');
  const companyId = z.uuid().parse(req.params.companyId);
  res.json(
    await snapshot(async (db) => {
      const company = (
        await db.query(`SELECT * FROM portal.companies WHERE "objectId"=$1 AND ${current}`, [
          companyId,
        ])
      ).rows[0];
      if (!company) throw httpError(404, 'Unternehmen nicht gefunden.');
      const fund = rights.funds?.can_read
        ? ((
            await db.query(
              `SELECT "objectId",name FROM portal.funds WHERE "objectId"=$1 AND ${current}`,
              [company.fund_id]
            )
          ).rows[0] ?? null)
        : null;
      const contacts =
        rights.company_contacts?.can_read && rights.contacts?.can_read
          ? (
              await db.query(
                `SELECT to_jsonb(a) AS assignment, to_jsonb(c) AS contact
          FROM portal.company_contacts a
          LEFT JOIN portal.contacts c ON c."objectId"=a.contact_id AND c."archivedAt" IS NULL
          WHERE a.company_id=$1 AND a."archivedAt" IS NULL
          ORDER BY c.last_name,c.first_name,a.role`,
                [companyId]
              )
            ).rows
          : null;
      return { company, fund, contacts };
    })
  );
});

portfolioRouter.get('/companies/:companyId/investor-reporting', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of ['companies', 'metrics', 'metric_data', 'comments'])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');
  const companyId = z.uuid().parse(req.params.companyId);
  const date = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .parse(req.query.date);
  res.json(await snapshot((db) => investorReport(db, companyId, date)));
});

portfolioRouter.get('/companies/:companyId/bridge', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of [
    'companies',
    'metrics',
    'metric_data',
    'index_rates',
    'kpi_formulas',
    'variable_map',
    'report_definitions',
    'report_items',
  ])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');
  const companyId = z.uuid().parse(req.params.companyId);
  const dimension = z
    .enum(['actual', 'budget', 'forecast', 'plan'])
    .parse(req.query.dimension ?? 'actual');
  const date = await reportMonth(companyId, req.query.date, dimension);
  const currency = z.enum(['CC', 'EUR']).parse(req.query.currency ?? 'EUR');
  res.json(
    await snapshot((db) => bridgeReport(db, rights, { companyId, dimension, date, currency }))
  );
});

portfolioRouter.get('/companies/:companyId/income-statement', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of ['companies', 'metrics', 'metric_data', 'metric_formulas', 'index_rates'])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');
  const companyId = z.uuid().parse(req.params.companyId);
  const dimension = z
    .enum(['actual', 'budget', 'forecast', 'plan'])
    .parse(req.query.dimension ?? 'actual');
  const date = await reportMonth(companyId, req.query.date, dimension);
  const context = {
    companyId,
    date,
    currency: z.enum(['CC', 'EUR']).parse(req.query.currency ?? 'EUR'),
    dimension,
    aggregation: z.enum(['MONTH', 'YTD', 'LTM']).parse(req.query.aggregation ?? 'MONTH'),
  };
  res.json(await snapshot((db) => incomeStatement(db, context)));
});

portfolioRouter.get('/companies/:companyId/balance-sheet', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of ['companies', 'metrics', 'metric_data', 'metric_formulas', 'index_rates'])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');
  const companyId = z.uuid().parse(req.params.companyId);
  const dimension = z
    .enum(['actual', 'budget', 'forecast', 'plan'])
    .parse(req.query.dimension ?? 'actual');
  const date = await reportMonth(companyId, req.query.date, dimension);
  const currency = z.enum(['CC', 'EUR']).parse(req.query.currency ?? 'EUR');
  res.json(
    await snapshot((db) =>
      balanceSheet(db, { companyId, date, currency, dimension, aggregation: 'MONTH' })
    )
  );
});

portfolioRouter.get('/companies', async (req, res) => {
  await requirePermission(req.userId!, 'companies', 'read');
  const rows = await pool.query(
    `SELECT c."objectId",c.name,c.internal_name,c.currency,c.status
     FROM portal.companies c
     WHERE c."archivedAt" IS NULL AND c.status='P - Portfolio'
     ORDER BY coalesce(nullif(c.internal_name,''),c.name),c.name`
  );
  res.json(rows.rows);
});

portfolioRouter.get('/companies/:companyId/performance-update', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of ['companies', 'metrics', 'metric_data', 'index_rates'])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');

  const companyId = z.uuid().parse(req.params.companyId);
  const month = await reportMonth(companyId, req.query.date);
  const currencyMode = z.enum(['CC', 'EUR']).parse(req.query.currency ?? 'EUR');
  const year = Number(month.slice(0, 4));
  const selectedMonth = `${month}-01`;
  const companyResult = await pool.query(
    `SELECT c."objectId",c.name,c.internal_name,c.currency
     FROM portal.companies c WHERE c."objectId"=$1 AND c."archivedAt" IS NULL`,
    [companyId]
  );
  if (!companyResult.rows.length) throw httpError(404, 'Company nicht gefunden.');
  const company = companyResult.rows[0];
  const names = ['revenue', 'adjusted ebitda', 'adjusted ebita', 'net debt (broad definition)'];
  const metricResult = await pool.query(
    `SELECT m."objectId",m.name,m.metric_number,m.currency,d.dimension,
            to_char(date_trunc('month',d.period),'YYYY-MM-DD') AS month,
            d.value::text AS value,d.currency AS data_currency
     FROM portal.metrics m
     LEFT JOIN portal.metric_data d ON d.metric_id=m."objectId" AND d."archivedAt" IS NULL
       AND d.period >= $2::date AND d.period < $3::date
     WHERE m.company_id=$1 AND m."archivedAt" IS NULL AND lower(trim(m.name))=ANY($4::text[])
     ORDER BY m.name,d.period,d.dimension`,
    [companyId, `${year - 2}-01-01`, `${year + 1}-01-01`, names]
  );
  const metrics = new Map<
    string,
    {
      metric_number: number;
      currency: string | null;
      values: Map<string, Map<string, { value: Decimal; currency: string | null }>>;
    }
  >();
  for (const row of metricResult.rows) {
    const name = String(row.name).trim().toLowerCase();
    let metric = metrics.get(name);
    if (!metric) {
      metric = { metric_number: row.metric_number, currency: row.currency, values: new Map() };
      metrics.set(name, metric);
    } else if (metric.metric_number !== row.metric_number) {
      throw httpError(422, `Die Kennzahl „${row.name}“ ist für diese Company nicht eindeutig.`);
    }
    if (row.month && row.value !== null) {
      const dimensionValues =
        metric.values.get(row.dimension) ??
        new Map<string, { value: Decimal; currency: string | null }>();
      if (dimensionValues.has(row.month))
        throw httpError(422, `Mehrere Werte für ${row.name} im Monat ${row.month.slice(0, 7)}.`);
      dimensionValues.set(row.month, {
        value: new Decimal(row.value),
        currency: row.data_currency,
      });
      metric.values.set(row.dimension, dimensionValues);
    }
  }

  const targetCurrency =
    currencyMode === 'EUR'
      ? 'EUR'
      : company.currency ||
        [...metrics.values()].find((metric) => metric.currency)?.currency ||
        'EUR';
  const fxCache = new Map<string, Decimal>([['EUR', new Decimal(1)]]);
  const rate = async (currency: string) => {
    const cached = fxCache.get(currency);
    if (cached) return cached;
    const result = await pool.query(
      `SELECT index_value::text FROM portal.index_rates WHERE base_currency='EUR' AND currency=$1
       AND period=$2::date AND ${current} ORDER BY as_of_date DESC LIMIT 1`,
      [currency, selectedMonth]
    );
    if (!result.rows.length)
      throw httpError(422, `Kein EUR-Indexkurs für ${currency} am ${month} vorhanden.`);
    const value = new Decimal(result.rows[0].index_value);
    if (!value.isFinite() || value.lte(0))
      throw httpError(422, `Ungültiger EUR-Indexkurs für ${currency}.`);
    fxCache.set(currency, value);
    return value;
  };
  const convert = async (value: Decimal, source: string | null | undefined) => {
    const sourceCurrency = source || targetCurrency;
    if (sourceCurrency === targetCurrency) return value;
    // IndexRates stores currency units per EUR; dividing converts the source to EUR.
    return value.div(await rate(sourceCurrency)).mul(await rate(targetCurrency));
  };

  const periodMap = (name: string, dimension: string) =>
    metrics.get(name)?.values.get(dimension) ??
    new Map<string, { value: Decimal; currency: string | null }>();
  const flow = async (name: string, dimension: string, start: string, end: string) => {
    const metric = metrics.get(name);
    if (!metric) return null;
    const values = periodMap(name, dimension);
    const months = [...values.keys()].filter((date) => date >= start && date < end).sort();
    if (!months.length) return null;
    let total = new Decimal(0);
    for (const date of months) {
      const item = values.get(date)!;
      total = total.plus(await convert(item.value, item.currency || metric.currency));
    }
    return total;
  };
  const exact = async (name: string, dimension: string, date: string) => {
    const metric = metrics.get(name);
    const item = periodMap(name, dimension).get(date);
    return metric && item ? convert(item.value, item.currency || metric.currency) : null;
  };
  const stock = async (dimension: string, start: string, end: string) => {
    const values = periodMap('net debt (broad definition)', dimension);
    const date = [...values.keys()]
      .filter((item) => item >= start && item < end)
      .sort()
      .at(-1);
    return date ? exact('net debt (broad definition)', dimension, date) : null;
  };
  const monthDate = (offset: number) => {
    const date = new Date(`${selectedMonth}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  };
  const yearStart = (offset: number) => `${year + offset}-01-01`;
  const nextYearStart = (offset: number) => `${year + offset + 1}-01-01`;
  const ytdEnd = monthDate(1);
  const metricDefs = [
    { key: 'revenue', label: 'Revenue', kind: 'flow' },
    { key: 'adjusted ebitda', label: 'EBITDA norm.', kind: 'flow' },
    { key: 'adjusted ebita', label: 'EBITA norm.', kind: 'flow' },
    { key: 'net debt (broad definition)', label: 'Net Debt', kind: 'stock' },
  ] as const;
  const columns = [
    { key: 'm_py', group: month, label: 'PY' },
    { key: 'm_act', group: month, label: 'ACT' },
    { key: 'm_budget', group: month, label: 'Budget' },
    { key: 'ytd_py', group: 'YTD', label: 'PY' },
    { key: 'ytd_act', group: 'YTD', label: 'ACT' },
    { key: 'ytd_budget', group: 'YTD', label: 'Budget' },
    { key: 'fy_old', group: String(year - 2), label: 'ACT' },
    { key: 'fy_last', group: String(year - 1), label: 'ACT' },
    { key: 'ltm_act', group: 'LTM', label: 'ACT' },
    { key: 'fy_budget', group: String(year), label: 'Budget' },
    { key: 'fy_plan', group: String(year), label: 'Findos Plan' },
  ];
  const rows: {
    key: string;
    label: string;
    kind: 'value' | 'margin';
    values: (number | null)[];
  }[] = [];
  for (const metric of metricDefs) {
    const values: (Decimal | null)[] = [];
    if (metric.kind === 'flow') {
      values.push(
        await exact(metric.key, 'actual', monthDate(-12)),
        await exact(metric.key, 'actual', selectedMonth),
        await exact(metric.key, 'budget', selectedMonth),
        await flow(metric.key, 'actual', yearStart(-1), monthDate(-11)),
        await flow(metric.key, 'actual', yearStart(0), ytdEnd),
        await flow(metric.key, 'budget', yearStart(0), ytdEnd),
        await flow(metric.key, 'actual', yearStart(-2), nextYearStart(-2)),
        await flow(metric.key, 'actual', yearStart(-1), nextYearStart(-1)),
        await flow(metric.key, 'actual', monthDate(-11), monthDate(1)),
        await flow(metric.key, 'budget', yearStart(0), nextYearStart(0)),
        await flow(metric.key, 'plan', yearStart(0), nextYearStart(0))
      );
    } else {
      values.push(
        await exact(metric.key, 'actual', monthDate(-12)),
        await exact(metric.key, 'actual', selectedMonth),
        await exact(metric.key, 'budget', selectedMonth),
        await exact(metric.key, 'actual', monthDate(-12)),
        await exact(metric.key, 'actual', selectedMonth),
        await exact(metric.key, 'budget', selectedMonth),
        await stock('actual', yearStart(-2), nextYearStart(-2)),
        await stock('actual', yearStart(-1), nextYearStart(-1)),
        await exact(metric.key, 'actual', selectedMonth),
        await stock('budget', yearStart(0), nextYearStart(0)),
        await stock('plan', yearStart(0), nextYearStart(0))
      );
    }
    rows.push({
      key: metric.key,
      label: metric.label,
      kind: 'value',
      values: values.map((value) => value?.toNumber() ?? null),
    });
    if (metric.key === 'adjusted ebitda' || metric.key === 'adjusted ebita') {
      const revenue = rows.find((row) => row.key === 'revenue')?.values ?? [];
      rows.push({
        key: `${metric.key}-margin`,
        label: 'Margin',
        kind: 'margin',
        values: values.map((value, index) =>
          value && revenue[index] ? value.toNumber() / revenue[index]! : null
        ),
      });
    }
  }
  res.json({
    company: {
      objectId: company['objectId'],
      name: company.name,
      internal_name: company.internal_name,
    },
    date: month,
    currency: { mode: currencyMode, code: targetCurrency },
    columns,
    rows,
    missingMetrics: names.filter((name) => !metrics.has(name)),
  });
});

portfolioRouter.get('/companies/:companyId/performance-data', async (req, res) => {
  const rights = await permissions(req.userId!);
  for (const entity of ['companies', 'metrics', 'metric_data', 'performance_update_comments'])
    if (!rights[entity]?.can_read) throw httpError(403, 'Keine Berechtigung.');

  const companyId = z.uuid().parse(req.params.companyId);
  const month = await reportMonth(companyId, req.query.date);
  const selectedMonth = `${month}-01`;
  const selected = new Date(`${selectedMonth}T00:00:00Z`);
  const shiftMonth = (date: Date, amount: number) => {
    const value = new Date(date);
    value.setUTCMonth(value.getUTCMonth() + amount);
    return value.toISOString().slice(0, 10);
  };
  const selectedQuarterMonth = Math.floor(selected.getUTCMonth() / 3) * 3;
  const selectedQuarterStart = new Date(
    Date.UTC(selected.getUTCFullYear(), selectedQuarterMonth, 1)
  );
  const quarters = Array.from({ length: 6 }, (_, index) => {
    const start = shiftMonth(selectedQuarterStart, (index - 5) * 3);
    const [year, monthNumber] = start.split('-').map(Number);
    const quarterEndMonth = shiftMonth(new Date(`${start}T00:00:00Z`), 2);
    const isSelectedQuarter = index === 5;
    return {
      start,
      period: isSelectedQuarter ? selectedMonth : quarterEndMonth,
      year,
      label: `Q${Math.floor((monthNumber - 1) / 3) + 1}`,
    };
  });
  const queryStart = quarters[0].start;
  const queryEnd = shiftMonth(new Date(`${selectedMonth}T00:00:00Z`), 1);
  const source = await pool.query(
    `SELECT m.metric_number,m.name,m.source_data AS metric_source_data,
       d.dimension,to_char(d.period,'YYYY-MM-DD') AS period,d.value::text AS value,
       d.source_data->>'status' AS status,d.source_data->>'operator' AS operator
     FROM portal.metrics m
     LEFT JOIN portal.metric_data d ON d.metric_id=m."objectId" AND d."archivedAt" IS NULL
       AND d.period >= $2::date AND d.period < $3::date
     WHERE m.company_id=$1 AND (m.metric_number=4101200 OR m.metric_number BETWEEN 4004000 AND 4004999) AND m."archivedAt" IS NULL
     ORDER BY m.metric_number,d.period,d.dimension`,
    [companyId, queryStart, queryEnd]
  );
  type CovenantValue = { value: Decimal | null; status: string | null; operator: string | null };
  const metricMap = new Map<
    number,
    {
      name: string;
      imported: boolean;
      values: Map<string, Map<string, CovenantValue>>;
    }
  >();
  for (const row of source.rows) {
    const number = Number(row.metric_number);
    const metric = metricMap.get(number) ?? {
      name: row.name,
      imported: Boolean(row.metric_source_data?.covenant_id),
      values: new Map(),
    };
    if (metric.name !== row.name)
      throw httpError(422, `Metric Number ${number} ist f\u00fcr diese Company nicht eindeutig.`);
    if (row.period && (row.value !== null || row.status)) {
      const dimension = String(row.dimension);
      const periods = metric.values.get(dimension) ?? new Map<string, CovenantValue>();
      if (periods.has(row.period))
        throw httpError(422, `Mehrere MetricData-Werte f\u00fcr Metric Number ${number}.`);
      periods.set(row.period, {
        value: row.value === null ? null : new Decimal(row.value),
        status: row.status ?? null,
        operator: row.operator ?? null,
      });
      metric.values.set(dimension, periods);
    }
    metricMap.set(number, metric);
  }
  const direct = (number: number, date: string) =>
    metricMap.get(number)?.values.get('actual')?.get(date)?.value ?? null;
  const asNumbers = (values: (Decimal | null)[]) =>
    values.map((value) => value?.toNumber() ?? null);
  const actuals = (number: number) => quarters.map((quarter) => direct(number, quarter.period));
  const hasImportedCovenants = [...metricMap.values()].some((metric) => metric.imported);
  const covenantNumbers = [...metricMap.keys()]
    .filter(
      (number) =>
        number >= 4004000 &&
        number < 4005000 &&
        number % 100 === 0 &&
        (metricMap.get(number)!.imported ||
          !hasImportedCovenants ||
          metricMap.get(number)!.values.get('actual')?.size)
    )
    .sort((a, b) => a - b);
  const covenantRow = (number: number, kind: 'value' | 'target', label: string) => ({
    key: `covenant-${number}`,
    label,
    kind,
    values: asNumbers(actuals(number)),
    statuses: quarters.map(
      (quarter) => metricMap.get(number)?.values.get('actual')?.get(quarter.period)?.status ?? null
    ),
    operators: quarters.map(
      (quarter) =>
        metricMap.get(number)?.values.get('actual')?.get(quarter.period)?.operator ?? null
    ),
  });
  const rows = [
    { key: 'rcv', label: 'RCV', kind: 'value', values: asNumbers(actuals(4101200)) },
    ...covenantNumbers.flatMap((number) => [
      covenantRow(number, 'value', metricMap.get(number)!.name),
      ...(metricMap.has(number + 1) ? [covenantRow(number + 1, 'target', 'Target')] : []),
    ]),
  ];
  const comments = await pool.query(
    `WITH eligible AS (
       SELECT company_source_name,metric_data_period,performance_update_date,comment_text,text_type,
         source_file,slide_number,paragraph_number,slide_id,source_row
       FROM portal.performance_update_comments
       WHERE company_id=$1 AND metric_data_period <= $2::date
         AND performance_update_date IS NOT NULL
         AND performance_update_date < $3::date
         AND "archivedAt" IS NULL
     ), chosen_period AS (
       SELECT max(metric_data_period) AS period FROM eligible
     ), chosen_term AS (
       SELECT e.performance_update_date FROM eligible e JOIN chosen_period p ON e.metric_data_period=p.period
       ORDER BY e.performance_update_date DESC NULLS LAST LIMIT 1
     )
     SELECT e.company_source_name,to_char(e.metric_data_period,'YYYY-MM-DD') AS metric_data_period,
       to_char(e.performance_update_date,'YYYY-MM-DD') AS performance_update_date,
       e.comment_text,e.text_type,e.source_file,e.slide_number,e.paragraph_number,e.slide_id
     FROM eligible e JOIN chosen_period p ON e.metric_data_period=p.period
     JOIN chosen_term t ON e.performance_update_date IS NOT DISTINCT FROM t.performance_update_date
     ORDER BY e.source_row`,
    [companyId, selectedMonth, shiftMonth(new Date(`${selectedMonth}T00:00:00Z`), 1)]
  );
  res.json({
    date: month,
    quarters,
    rows,
    comments: comments.rows,
    commentPeriod: comments.rows[0]?.metric_data_period ?? null,
    commentMeetingDate: comments.rows[0]?.performance_update_date ?? null,
  });
});
