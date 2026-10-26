import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { authenticate, permissions, requirePermission } from '../middleware/auth.js';
import { compileSearch, searchDefinition } from '../services/search.js';
import {
  transaction,
  createRecord,
  updateRecord,
  archiveRecord,
} from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';

export const searchRouter = Router();
searchRouter.use(authenticate);
searchRouter.post('/query', async (req, res) => {
  const input = z
    .object({
      definition: searchDefinition,
      page: z.number().int().min(1).max(100000).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict()
    .parse(req.body);
  const compiled = compileSearch(input.definition, await permissions(req.userId!));
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    const count = await client.query(compiled.countSql, compiled.values);
    const result = await client.query(compiled.sql, [
      ...compiled.values,
      input.limit,
      (input.page - 1) * input.limit,
    ]);
    await client.query('COMMIT');
    res.json({
      columns: compiled.columns,
      rows: result.rows,
      total: count.rows[0].total,
      page: input.page,
      limit: input.limit,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (['22P02', '42883', '22007', '22008'].includes((error as any).code))
      throw httpError(400, 'Der Filterwert passt nicht zum Datentyp des Feldes.');
    if ((error as any).code === '57014')
      throw httpError(400, 'Die Suche dauert zu lange. Bitte zusätzliche Filter setzen.');
    throw error;
  } finally {
    client.release();
  }
});
searchRouter.get('/views', async (req, res) => {
  await requirePermission(req.userId!, 'search_views', 'read');
  res.json(
    (
      await pool.query(
        'SELECT * FROM portal.search_views WHERE owner_id=$1 AND "archivedAt" IS NULL ORDER BY name',
        [req.userId]
      )
    ).rows
  );
});
const viewInput = z
  .object({ name: z.string().trim().min(1).max(100), definition: searchDefinition })
  .strict();
searchRouter.post('/views', async (req, res) => {
  await requirePermission(req.userId!, 'search_views', 'create');
  const input = viewInput.parse(req.body);
  compileSearch(input.definition, await permissions(req.userId!));
  res
    .status(201)
    .json(
      await transaction(req.userId!, (client) =>
        createRecord(client, 'search_views', { ...input, owner_id: req.userId })
      )
    );
});
searchRouter.patch('/views/:id', async (req, res) => {
  await requirePermission(req.userId!, 'search_views', 'update');
  const input = viewInput.parse(req.body);
  compileSearch(input.definition, await permissions(req.userId!));
  const id = z.uuid().parse(req.params.id),
    version = z.uuid().parse(req.get('if-match'));
  res.json(
    await transaction(req.userId!, async (client) => {
      const owned = await client.query(
        'SELECT 1 FROM portal.search_views WHERE "objectId"=$1 AND owner_id=$2 AND "archivedAt" IS NULL',
        [id, req.userId]
      );
      if (!owned.rowCount) throw httpError(404, 'View nicht gefunden.');
      return updateRecord(client, 'search_views', id, version, input);
    })
  );
});
searchRouter.delete('/views/:id', async (req, res) => {
  await requirePermission(req.userId!, 'search_views', 'delete');
  const id = z.uuid().parse(req.params.id),
    version = z.uuid().parse(req.get('if-match'));
  await transaction(req.userId!, async (client) => {
    const owned = await client.query(
      'SELECT 1 FROM portal.search_views WHERE "objectId"=$1 AND owner_id=$2 AND "archivedAt" IS NULL',
      [id, req.userId]
    );
    if (!owned.rowCount) throw httpError(404, 'View nicht gefunden.');
    await archiveRecord(client, 'search_views', id, version);
  });
  res.sendStatus(204);
});
