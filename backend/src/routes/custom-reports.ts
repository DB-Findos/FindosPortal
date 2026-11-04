import { Router } from 'express';
import { z } from 'zod';
import { authenticate, permissions } from '../middleware/auth.js';
import { pool } from '../db.js';
import { transaction, activeRow, archiveRecord, createRecord } from '../repositories/entities.js';
import { snapshot } from '../services/snapshot.js';
import type { Actor } from '../mcp/data.js';
import {
  accessibleReport,
  listCustomReports,
  runCustomReport,
} from '../services/custom-reports/store.js';
import { customContext } from '../services/custom-reports/definition.js';
import { httpError } from '../shared/errors.js';
import { reportMonth } from '../services/report-context.js';
import { permit } from '../services/kpi-definitions.js';

export const customReportsRouter = Router();
customReportsRouter.use(authenticate);
const actor = async (userId: string): Promise<Actor> => ({
  userId,
  rights: await permissions(userId),
  canCommit: true,
});
customReportsRouter.get('/', async (req, res) => {
  const scope = z.enum(['own', 'shared']).parse(req.query.scope ?? 'own');
  const search = z
    .string()
    .max(200)
    .parse(req.query.search ?? '');
  const user = await actor(req.userId!);
  res.json(await snapshot((db) => listCustomReports(db, user, scope, search)));
});
customReportsRouter.get('/recipients', async (req, res) => {
  const user = await actor(req.userId!);
  if (!user.rights.custom_reports?.can_create) throw httpError(403, 'Keine Berechtigung.');
  const users = await pool.query(
    `SELECT u."objectId",coalesce(nullif(trim(concat(c.first_name,' ',c.last_name)),''),u.email) AS name
 FROM portal.users u JOIN portal.contacts c ON c."objectId"=u.contact_id AND c."archivedAt" IS NULL
 WHERE u."archivedAt" IS NULL AND u.active AND u."objectId"<>$1 ORDER BY name`,
    [user.userId]
  );
  const groups = await pool.query(
    'SELECT "objectId",name FROM portal.user_groups WHERE "archivedAt" IS NULL ORDER BY name'
  );
  res.json({ users: users.rows, groups: groups.rows });
});
customReportsRouter.get('/:id', async (req, res) => {
  const user = await actor(req.userId!);
  res.json(await snapshot((db) => accessibleReport(db, user, z.uuid().parse(req.params.id))));
});
customReportsRouter.get('/:id/run', async (req, res) => {
  const user = await actor(req.userId!);
  const id = z.uuid().parse(req.params.id);
  const companyId = z.uuid().parse(req.query.company_id);
  const dimension = z
    .enum(['actual', 'budget', 'forecast', 'plan'])
    .parse(req.query.dimension ?? 'actual');
  const date = await reportMonth(companyId, req.query.date, dimension);
  const context = customContext.parse({
    company_id: companyId,
    date,
    dimension,
    currency: req.query.currency ?? 'EUR',
  });
  res.json(
    await snapshot(async (db) => {
      await db.query("SET LOCAL statement_timeout='30s'");
      const row = await accessibleReport(db, user, id);
      return {
        objectId: row.objectId,
        id: row.id,
        owner_id: row.owner_id,
        is_owner: row.owner_id === user.userId,
        ...(await runCustomReport(
          db,
          user,
          { name: row.name, description: row.description, html: row.html, mapping: row.mapping },
          context
        )),
      };
    })
  );
});
customReportsRouter.get('/:id/shares', async (req, res) => {
  const user = await actor(req.userId!);
  const id = z.uuid().parse(req.params.id);
  permit(user.rights, 'custom_report_shares');
  res.json(
    await snapshot(async (db) => {
      await accessibleReport(db, user, id, true);
      return (
        await db.query(
          `SELECT s."objectId",s.id,s.user_id,s.group_id,
     coalesce(g.name,u.email) AS name FROM portal.custom_report_shares s
     LEFT JOIN portal.users u ON u."objectId"=s.user_id AND u."archivedAt" IS NULL
     LEFT JOIN portal.user_groups g ON g."objectId"=s.group_id AND g."archivedAt" IS NULL
     WHERE s.report_id=$1 AND s."archivedAt" IS NULL ORDER BY name`,
          [id]
        )
      ).rows;
    })
  );
});
customReportsRouter.post('/:id/shares', async (req, res) => {
  const user = await actor(req.userId!);
  const id = z.uuid().parse(req.params.id);
  permit(user.rights, 'custom_report_shares', 'create');
  const input = z
    .object({
      user_id: z.uuid().nullable().default(null),
      group_id: z.uuid().nullable().default(null),
    })
    .strict()
    .refine(
      (value) => Boolean(value.user_id) !== Boolean(value.group_id),
      'Genau einen Empfänger wählen.'
    )
    .parse(req.body);
  res.status(201).json(
    await transaction(user.userId, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      await accessibleReport(db, user, id, true);
      await activeRow(
        db,
        input.user_id ? 'users' : 'user_groups',
        (input.user_id || input.group_id)!
      );
      const existing = (
        await db.query(
          'SELECT * FROM portal.custom_report_shares WHERE report_id=$1 AND user_id IS NOT DISTINCT FROM $2::uuid AND group_id IS NOT DISTINCT FROM $3::uuid AND "archivedAt" IS NULL',
          [id, input.user_id, input.group_id]
        )
      ).rows[0];
      return existing || createRecord(db, 'custom_report_shares', { report_id: id, ...input });
    })
  );
});
customReportsRouter.delete('/:id/shares/:shareId', async (req, res) => {
  const user = await actor(req.userId!);
  const id = z.uuid().parse(req.params.id);
  const shareId = z.uuid().parse(req.params.shareId);
  permit(user.rights, 'custom_report_shares', 'delete');
  await transaction(user.userId, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
    await accessibleReport(db, user, id, true);
    const row = await activeRow(db, 'custom_report_shares', shareId);
    if (row.report_id !== id) throw httpError(404, 'Freigabe nicht gefunden.');
    await archiveRecord(db, 'custom_report_shares', shareId, row.id);
  });
  res.json({ ok: true });
});
