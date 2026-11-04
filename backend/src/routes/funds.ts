import { Router } from 'express';
import { z } from 'zod';
import { authenticate, permissions, requirePermission } from '../middleware/auth.js';
import { pool } from '../db.js';
import { snapshot } from '../services/snapshot.js';
import { fundBridge } from '../services/fund-bridge.js';
import { fundDataStatus } from '../services/fund-data-status.js';
import { permit } from '../services/kpi-definitions.js';
export const fundsRouter = Router();
fundsRouter.use(authenticate);
const context = z.object({
  date: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).default('actual'),
  scope: z.literal('portfolio').default('portfolio'),
  months: z.coerce.number().int().min(1).max(24).default(12),
});
fundsRouter.get('/', async (req, res) => {
  await requirePermission(req.userId!, 'funds', 'read');
  res.json(
    (
      await pool.query(
        'SELECT "objectId",name,currency FROM portal.funds WHERE "archivedAt" IS NULL ORDER BY name'
      )
    ).rows
  );
});
fundsRouter.get('/:fundId/bridge', async (req, res) => {
  const fundId = z.uuid().parse(req.params.fundId),
    input = context.parse(req.query),
    rights = await permissions(req.userId!);
  for (const entity of [
    'funds',
    'companies',
    'metrics',
    'metric_data',
    'index_rates',
    'kpi_formulas',
    'variable_map',
    'report_definitions',
    'report_items',
  ])
    permit(rights, entity);
  res.json(
    await snapshot((db) => fundBridge(db, rights, fundId, input.dimension, input.scope, input.date))
  );
});
fundsRouter.get('/:fundId/data-status', async (req, res) => {
  const fundId = z.uuid().parse(req.params.fundId),
    input = context.parse(req.query),
    rights = await permissions(req.userId!);
  for (const entity of [
    'funds',
    'companies',
    'metrics',
    'metric_data',
    'kpi_formulas',
    'variable_map',
  ])
    permit(rights, entity);
  res.json(await snapshot((db) => fundDataStatus(db, { fundId, ...input })));
});
fundsRouter.get('/:fundId/data-status/:companyId', async (req, res) => {
  const fundId = z.uuid().parse(req.params.fundId),
    companyId = z.uuid().parse(req.params.companyId),
    input = context.parse(req.query),
    rights = await permissions(req.userId!);
  for (const entity of [
    'funds',
    'companies',
    'metrics',
    'metric_data',
    'kpi_formulas',
    'variable_map',
  ])
    permit(rights, entity);
  res.json(await snapshot((db) => fundDataStatus(db, { fundId, companyId, ...input })));
});
