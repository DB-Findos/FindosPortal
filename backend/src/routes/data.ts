import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { definitions, entityName, fields } from '../entities.js';
import { authenticate, permissions, requirePermission } from '../middleware/auth.js';
import {
  current,
  publicRow,
  transaction,
  createRecord,
  updateRecord,
  archiveRecord,
  activeRow,
  auditColumns,
} from '../repositories/entities.js';
import { httpError, fieldError } from '../shared/errors.js';
import { privateChatEntities } from '../services/chat-schema.js';
export const dataRouter = Router();
dataRouter.use(authenticate);
dataRouter.get('/entities', async (req, res) => {
  const rights = await permissions(req.userId!);
  res.json(
    Object.entries(definitions)
      .filter(
        ([name]) =>
          name !== 'search_views' && !privateChatEntities.has(name) && rights[name]?.can_read
      )
      .map(([name, def]) => ({
        name,
        label: def.label,
        readonly: 'readonly' in def,
        fields: fields(name as keyof typeof definitions),
        auditFields: auditColumns,
        permissions: rights[name],
      }))
  );
});
dataRouter.use('/data/:entity', async (req, _res, next) => {
  const entity = entityName(req.params.entity),
    action = (
      { GET: 'read', POST: 'create', PATCH: 'update', DELETE: 'delete' } as Record<string, string>
    )[req.method];
  await requirePermission(req.userId!, entity, action || 'invalid');
  if (privateChatEntities.has(entity))
    throw httpError(403, 'Private Chats nur über die Chat-Funktionen abrufen.');
  if (entity === 'search_views')
    throw httpError(403, 'Views werden über die Advanced Search verwaltet.');
  if (
    ['kpi_formulas', 'variable_map', 'report_definitions', 'report_items'].includes(entity) &&
    action !== 'read'
  )
    throw httpError(403, 'Bitte den KPI-Editor bzw. die Berichtsverwaltung verwenden.');
  if (entity === 'entities' && action !== 'read')
    throw httpError(403, 'Systemkatalog ist schreibgeschützt.');
  next();
});
dataRouter.get('/data/:entity', async (req, res) => {
  const entity = entityName(req.params.entity),
    page = z.coerce.number().int().min(1).max(100000).catch(1).parse(req.query.page),
    limit = z.coerce.number().int().min(1).max(100).catch(50).parse(req.query.limit);
  const rows = (
    await pool.query(
      `SELECT * FROM portal.${entity} WHERE ${current} ORDER BY "objectId" LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    )
  ).rows;
  res.json({
    rows: rows.map((row) => publicRow(entity, row)),
    total: (
      await pool.query(`SELECT count(*)::int AS total FROM portal.${entity} WHERE ${current}`)
    ).rows[0].total,
    page,
    limit,
  });
});
dataRouter.get('/data/:entity/:objectId/history', async (req, res) => {
  const entity = entityName(req.params.entity),
    objectId = z.uuid().parse(req.params.objectId);
  const rows = (
    await pool.query(
      `SELECT * FROM portal.${entity} WHERE "objectId"=$1 ORDER BY "lastModifiedAt" DESC,id`,
      [objectId]
    )
  ).rows;
  res.json({ rows: rows.map((row) => publicRow(entity, row)) });
});
dataRouter.post('/data/:entity', async (req, res) => {
  const entity = entityName(req.params.entity),
    data: Record<string, any> = definitions[entity].schema.strict().parse(req.body);
  if (entity === 'users') {
    data.password_hash = await bcrypt.hash(data.password, 12);
    delete data.password;
  }
  res
    .status(201)
    .json(await transaction(req.userId!, (client) => createRecord(client, entity, data)));
});
dataRouter.patch('/data/:entity/:objectId', async (req, res) => {
  const entity = entityName(req.params.entity),
    identity = z.uuid().parse(req.params.objectId),
    expected = z.uuid().parse(req.get('If-Match'));
  const parsed = z.object(definitions[entity].schema.shape).partial().strict().parse(req.body);
  const data: Record<string, any> = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => Object.hasOwn(req.body, key))
  );
  if (!Object.keys(data).length) throw httpError(400, 'Keine Änderungen.');
  if (entity === 'users' && identity === req.userId && data.active === false)
    throw fieldError(400, 'active', 'Eigenes Konto kann nicht deaktiviert werden.');
  if (entity === 'users' && data.password) {
    data.password_hash = await bcrypt.hash(data.password, 12);
    delete data.password;
  }
  const result = await transaction(req.userId!, async (client) => {
    if (entity === 'images') {
      const old = await activeRow(client, entity, identity);
      definitions.images.schema.parse({
        ...Object.fromEntries(
          Object.keys(definitions.images.schema.shape).map((key) => [key, old[key]])
        ),
        ...data,
      });
    }
    return updateRecord(client, entity, identity, expected, data);
  });
  res.json(result);
});
dataRouter.delete('/data/:entity/:objectId', async (req, res) => {
  const entity = entityName(req.params.entity),
    identity = z.uuid().parse(req.params.objectId),
    expected = z.uuid().parse(req.get('If-Match'));
  if (entity === 'users' && identity === req.userId)
    throw httpError(400, 'Eigenes Konto kann nicht archiviert werden.');
  await transaction(req.userId!, (client) => archiveRecord(client, entity, identity, expected));
  res.status(204).end();
});
