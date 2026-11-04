import { z } from 'zod';
import type { Actor } from './data.js';
import { permit } from '../services/kpi-definitions.js';
import { snapshot } from '../services/snapshot.js';
import { fundBridge } from '../services/fund-bridge.js';
import { fundDataStatus } from '../services/fund-data-status.js';

export const fundReportInput = z
  .object({
    fund_id: z.uuid(),
    report: z.enum(['bridge', 'data-status']),
    date: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).default('actual'),
    scope: z.enum(['portfolio', 'all']).default('portfolio'),
    months: z.number().int().min(1).max(36).default(12),
    company_id: z.uuid().optional(),
  })
  .strict();
export async function getFundReport(actor: Actor, raw: unknown) {
  const input = fundReportInput.parse(raw);
  for (const entity of [
    'funds',
    'companies',
    'metrics',
    'metric_data',
    'kpi_formulas',
    'variable_map',
  ])
    permit(actor.rights, entity);
  if (input.report === 'bridge') {
    for (const entity of ['index_rates', 'report_definitions', 'report_items'])
      permit(actor.rights, entity);
    return snapshot((db) =>
      fundBridge(db, actor.rights, input.fund_id, input.dimension, input.scope, input.date)
    );
  }
  return snapshot((db) =>
    fundDataStatus(db, {
      fundId: input.fund_id,
      date: input.date,
      dimension: input.dimension,
      scope: input.scope,
      months: input.months,
      companyId: input.company_id,
    })
  );
}
