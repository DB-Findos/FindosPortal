import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import type { DatabaseClient } from '../database/connection.js';
import { authenticate, permissions } from '../middleware/auth.js';
import { activeRow, archiveRecord, current, transaction } from '../repositories/entities.js';
import {
  formulaWithVariables,
  numericSources,
  permit,
  prepareFormula,
  saveFormula,
} from '../services/kpi-definitions.js';
import { formulaInput, reportContext } from '../services/kpi-schema.js';
import { reportWithItems, saveReport } from '../services/kpi-reports.js';
import { KpiEngine } from '../services/kpi-engine.js';
import { entityName, definitions } from '../entities.js';
import { fieldError } from '../shared/errors.js';

export const kpiRouter = Router();
kpiRouter.use(authenticate);
async function snapshot<T>(work: (client: DatabaseClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
kpiRouter.get('/catalog', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'kpi_formulas');
  const metrics =
    rights.metrics?.can_read && rights.metric_data?.can_read
      ? (
          await pool.query(
            `SELECT metric_number, min(name) AS name FROM portal.metrics WHERE ${current} AND metric_number IS NOT NULL GROUP BY metric_number ORDER BY metric_number`
          )
        ).rows
      : [];
  const companies = rights.companies?.can_read
    ? (
        await pool.query(
          `SELECT c."objectId",c.name,coalesce(c.currency,f.currency) AS currency FROM portal.companies c JOIN portal.funds f ON f."objectId"=c.fund_id AND f."archivedAt" IS NULL WHERE c."archivedAt" IS NULL ORDER BY c.name`
        )
      ).rows
    : [];
  res.json({ metrics, companies, sources: numericSources(rights) });
});
kpiRouter.get('/records/:entity', async (req, res) => {
  const entity = entityName(String(req.params.entity));
  const rights = await permissions(req.userId!);
  permit(rights, entity);
  if (!numericSources(rights).some((s) => s.entity === entity))
    throw fieldError(400, 'entity', 'Keine numerischen Felder verfügbar.');
  const q = z
    .string()
    .max(200)
    .parse(req.query.q || '');
  const shape = definitions[entity].schema.shape;
  const label =
    'name' in shape
      ? 'name'
      : 'metric_number' in shape
        ? 'metric_number::text'
        : '"objectId"::text';
  const rows = (
    await pool.query(
      `SELECT "objectId",${label} AS name FROM portal.${entity} WHERE ${current} AND (${label} ILIKE $1 OR "objectId"::text=$2) ORDER BY ${label},"objectId" LIMIT 100`,
      ['%' + q + '%', q]
    )
  ).rows;
  res.json(rows);
});
kpiRouter.get('/formulas', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'kpi_formulas');
  res.json(
    (await pool.query(`SELECT * FROM portal.kpi_formulas WHERE ${current} ORDER BY name`)).rows
  );
});
kpiRouter.get('/formulas/:id', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'kpi_formulas');
  permit(rights, 'variable_map');
  res.json(await snapshot((client) => formulaWithVariables(client, z.uuid().parse(req.params.id))));
});
kpiRouter.post('/validate', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'kpi_formulas');
  permit(rights, 'variable_map');
  res.json(await snapshot((client) => prepareFormula(client, req.body, rights)));
});
kpiRouter.post('/preview', async (req, res) => {
  const input = z
    .object({ formula: formulaInput, context: reportContext })
    .strict()
    .parse(req.body);
  const rights = await permissions(req.userId!);
  permit(rights, 'kpi_formulas');
  permit(rights, 'variable_map');
  permit(rights, 'companies');
  res.json(
    await snapshot(async (client) => {
      await activeRow(client, 'companies', input.context.company_id);
      const prepared = await prepareFormula(client, input.formula, rights);
      return new KpiEngine(client, rights, input.context).evaluate({
        ...prepared.data,
        variables: prepared.variables,
      });
    })
  );
});
kpiRouter.post('/formulas', async (req, res) => {
  const rights = await permissions(req.userId!);
  res
    .status(201)
    .json(await transaction(req.userId!, (client) => saveFormula(client, req.body, rights)));
});
kpiRouter.patch('/formulas/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    version = z.uuid().parse(req.get('if-match')),
    rights = await permissions(req.userId!);
  res.json(
    await transaction(req.userId!, (client) => saveFormula(client, req.body, rights, id, version))
  );
});
kpiRouter.get('/reports', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'report_definitions');
  res.json(
    (await pool.query(`SELECT * FROM portal.report_definitions WHERE ${current} ORDER BY name`))
      .rows
  );
});
kpiRouter.get('/reports/:id', async (req, res) => {
  const rights = await permissions(req.userId!);
  permit(rights, 'report_definitions');
  permit(rights, 'report_items');
  res.json(await snapshot((client) => reportWithItems(client, z.uuid().parse(req.params.id))));
});
kpiRouter.post('/reports', async (req, res) => {
  const rights = await permissions(req.userId!);
  res
    .status(201)
    .json(await transaction(req.userId!, (client) => saveReport(client, req.body, rights)));
});
kpiRouter.patch('/reports/:id', async (req, res) => {
  const id = z.uuid().parse(req.params.id),
    version = z.uuid().parse(req.get('if-match')),
    rights = await permissions(req.userId!);
  res.json(
    await transaction(req.userId!, (client) => saveReport(client, req.body, rights, id, version))
  );
});
kpiRouter.post('/reports/:id/run', async (req, res) => {
  const context = reportContext.parse(req.body),
    id = z.uuid().parse(req.params.id),
    rights = await permissions(req.userId!);
  for (const entity of [
    'report_definitions',
    'report_items',
    'kpi_formulas',
    'variable_map',
    'companies',
  ])
    permit(rights, entity);
  res.json(
    await snapshot(async (client) => {
      const company = await activeRow(client, 'companies', context.company_id);
      const report = await reportWithItems(client, id),
        engine = new KpiEngine(client, rights, context),
        results = [];
      for (const kpi of report.kpi_ids) results.push(await engine.evaluateId(kpi));
      return {
        report: { objectId: report.objectId, name: report.name },
        company: { objectId: company.objectId, name: company.name },
        context,
        results,
      };
    })
  );
});
for (const [path, entity, child] of [
  ['formulas', 'kpi_formulas', 'variable_map'],
  ['reports', 'report_definitions', 'report_items'],
] as const) {
  kpiRouter.delete(`/${path}/:id`, async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      version = z.uuid().parse(req.get('if-match')),
      rights = await permissions(req.userId!);
    permit(rights, entity, 'delete');
    permit(rights, child, 'delete');
    await transaction(req.userId!, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
      await archiveRecord(client, entity, id, version);
    });
    res.sendStatus(204);
  });
}
