import { z } from 'zod';
import type { Actor } from './data.js';
import { permit } from '../services/kpi-definitions.js';
import { reportMonth } from '../services/report-context.js';
import { snapshot } from '../services/snapshot.js';
import { bridgeReport } from '../services/bridge-report.js';
import { incomeStatement, balanceSheet } from '../services/metric-formula-engine.js';
import { investorReport } from '../services/investor-report.js';

export const companyReportInput = z
  .object({
    company_id: z.uuid(),
    report: z.enum(['bridge', 'income-statement', 'balance-sheet', 'investor-reporting']),
    date: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/)
      .optional(),
    currency: z.enum(['CC', 'EUR']).default('EUR'),
    dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).default('actual'),
    aggregation: z.enum(['MONTH', 'YTD', 'LTM']).default('MONTH'),
    include_history: z.boolean().default(false),
  })
  .strict();

/** Same engines, company context, currency conversion and defaults as the reporting UI. */
export async function getCompanyReport(actor: Actor, raw: unknown) {
  const input = companyReportInput.parse(raw);
  for (const entity of ['companies', 'metrics', 'metric_data']) permit(actor.rights, entity);
  if (input.report === 'investor-reporting') {
    permit(actor.rights, 'comments');
    return snapshot((db) => investorReport(db, input.company_id, input.date?.slice(0, 7)));
  }
  permit(actor.rights, 'index_rates');
  if (['income-statement', 'balance-sheet'].includes(input.report))
    permit(actor.rights, 'metric_formulas');
  else
    for (const entity of ['kpi_formulas', 'variable_map', 'report_definitions', 'report_items'])
      permit(actor.rights, entity);
  const date = await reportMonth(input.company_id, input.date?.slice(0, 7), input.dimension);
  const context = {
    companyId: input.company_id,
    date,
    currency: input.currency,
    dimension: input.dimension,
  };
  return snapshot(async (db) => {
    if (input.report === 'bridge') {
      const report = await bridgeReport(db, actor.rights, {
        ...context,
        includeHistory: input.include_history,
      });
      return {
        ...report,
        dateSource: input.date ? 'selected' : 'latest_available_data_month',
        series: input.include_history ? report.series : undefined,
      };
    }
    const report =
      input.report === 'balance-sheet'
        ? await balanceSheet(db, { ...context, aggregation: 'MONTH' })
        : await incomeStatement(db, { ...context, aggregation: input.aggregation });
    return {
      ...report,
      dateSource: input.date ? 'selected' : 'latest_available_data_month',
      history: input.include_history ? report.history : undefined,
    };
  });
}
