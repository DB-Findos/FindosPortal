import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../database/connection.js';
import { httpError } from '../shared/errors.js';

const definitions = [
  { key: 'revenue', label: 'Umsatz', base: 6000000 },
  { key: 'ebitda', label: 'EBITDA normalisiert', base: 6000100 },
  { key: 'ebita', label: 'EBITA normalisiert', base: 6000200 },
  { key: 'net-debt', label: 'Nettofinanzverbindlichkeiten ggü. Banken', base: 6000300 },
] as const;

export async function investorReport(
  db: DatabaseClient,
  companyId: string,
  requestedDate?: string
) {
  const company = (
    await db.query(
      'SELECT "objectId",name,internal_name,currency FROM portal.companies WHERE "objectId"=$1 AND "archivedAt" IS NULL',
      [companyId]
    )
  ).rows[0];
  if (!company) throw httpError(404, 'Company nicht gefunden.');
  const numbers = definitions.flatMap((row) => [row.base + 1, row.base + 2, row.base + 3]);
  const latest = (
    await db.query(
      `SELECT to_char(max(d.period),'YYYY-MM') AS month
    FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
    WHERE m.company_id=$1 AND m.metric_number=ANY($2::int[]) AND d.dimension='actual'
    AND d."archivedAt" IS NULL AND d.value IS NOT NULL AND extract(month FROM d.period) IN (3,6,9,12)
    AND ($3::date IS NULL OR d.period < $3::date + interval '1 month')`,
      [companyId, numbers, requestedDate ? `${requestedDate}-01` : null]
    )
  ).rows[0].month as string | null;
  const date = requestedDate || latest || new Date().toISOString().slice(0, 7);
  if (!latest)
    return {
      company,
      date,
      currency: { mode: 'EUR', code: 'EUR' },
      quarters: [],
      warnings: [],
    };
  const shift = (month: string, offset: number) => {
    const value = new Date(`${month}-01T00:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + offset);
    return value.toISOString().slice(0, 10);
  };
  const periods = [0, -3, -6, -9].map((offset) => shift(latest, offset));
  const values = (
    await db.query(
      `SELECT m.metric_number,m.unit,
    to_char(date_trunc('month',d.period),'YYYY-MM-DD') AS period,d.value::text AS value
    FROM portal.metric_data d JOIN portal.metrics m ON m."objectId"=d.metric_id AND m."archivedAt" IS NULL
    WHERE m.company_id=$1 AND m.metric_number=ANY($2::int[]) AND d.dimension='actual'
    AND d."archivedAt" IS NULL AND d.period >= $3::date AND d.period < $4::date + interval '1 month'`,
      [companyId, numbers, periods.at(-1), periods[0]]
    )
  ).rows;
  const data = new Map<string, Decimal | null>();
  for (const value of values) {
    const key = `${value.period}:${value.metric_number}`;
    if (data.has(key))
      throw httpError(
        422,
        `Mehrere IR-Werte für Metric ${value.metric_number} in ${value.period}.`
      );
    // IR source values are already stored in thousands (unit 000).
    if (value.value !== null && value.unit !== '000')
      throw httpError(
        422,
        `Unerwartete IR-Einheit für Metric ${value.metric_number}: ${value.unit}.`
      );
    // All IR inputs are already EUR, regardless of Company/Metric currency metadata.
    data.set(key, value.value === null ? null : new Decimal(value.value));
  }
  const comments = (
    await db.query(
      `SELECT "objectId",comment_text,to_char(period,'YYYY-MM-DD') AS period
    FROM portal.comments WHERE company_id=$1 AND type='Investoren Reporting' AND "archivedAt" IS NULL AND nullif(trim(comment_text),'') IS NOT NULL
    AND period >= date_trunc('quarter',$2::date) AND period < $3::date + interval '1 month'
    ORDER BY period,source_row NULLS LAST,"createdAt","objectId"`,
      [companyId, periods.at(-1), periods[0]]
    )
  ).rows;
  const divide = (a: Decimal | null, b: Decimal | null) =>
    a !== null && b !== null && !b.isZero() ? a.div(b) : null;
  const numeric = (a: Decimal | null) => a?.toNumber() ?? null;
  return {
    company,
    date,
    currency: { mode: 'EUR', code: 'EUR' },
    warnings: [],
    quarters: periods.map((period) => {
      const get = (number: number) => data.get(`${period}:${number}`) ?? null;
      const revenue = [1, 2, 3].map((offset) => get(6000000 + offset));
      return {
        period: period.slice(0, 7),
        year: Number(period.slice(0, 4)),
        quarter: Math.ceil(Number(period.slice(5, 7)) / 3),
        columns: ['Ist Vorjahr', `LTM ${period.slice(5, 7)}/${period.slice(0, 4)}`, 'Findos Case'],
        rows: definitions.map((definition) => {
          const numbers = [1, 2, 3].map((offset) => definition.base + offset);
          const amounts = numbers.map(get);
          const growth = (comparison: Decimal | null) => {
            const ratio = divide(amounts[1], comparison);
            return ratio === null ? null : ratio.minus(1);
          };
          return {
            key: definition.key,
            label: definition.label,
            metricNumbers: numbers,
            values: amounts.map(numeric),
            margins: ['ebitda', 'ebita'].includes(definition.key)
              ? amounts.map((amount, index) => numeric(divide(amount, revenue[index])))
              : null,
            changePriorYear: numeric(growth(amounts[0])),
            changeCase: numeric(growth(amounts[2])),
          };
        }),
        comments: comments.filter(
          (comment) =>
            comment.period.slice(0, 4) === period.slice(0, 4) &&
            Math.ceil(Number(comment.period.slice(5, 7)) / 3) ===
              Math.ceil(Number(period.slice(5, 7)) / 3)
        ),
      };
    }),
  };
}
