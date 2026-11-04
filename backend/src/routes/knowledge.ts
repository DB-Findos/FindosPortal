import express, { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { snapshot } from '../services/snapshot.js';
import {
  transaction,
  activeRow,
  createRecord,
  updateRecord,
  archiveRecord,
} from '../repositories/entities.js';
import {
  entryDetail,
  saveEntry,
  userName,
  completeEntryReview,
} from '../services/knowledge/entries.js';
import { spaceInput, sectionInput } from '../services/knowledge/schema.js';
import {
  knowledgeStorageStatus,
  uploadKnowledgeTemplate,
  removeNewKnowledgeUpload,
} from '../services/knowledge/sharepoint.js';
import { httpError } from '../shared/errors.js';
import { sendSharePointDocument } from '../services/document-download.js';
import { refreshKnowledgeReviews, reviewCurrentSql } from '../services/knowledge/reviews.js';
export const knowledgeRouter = Router();
knowledgeRouter.use(authenticate);
knowledgeRouter.use(async (_req, _res, next) => {
  await refreshKnowledgeReviews();
  next();
});
const version = (value: unknown) =>
  z.uuid().parse(typeof value === 'string' ? value.replaceAll('"', '') : value);
knowledgeRouter.get('/tree', async (req, res) => {
  for (const entity of ['knowledge_spaces', 'knowledge_sections', 'knowledge_entries'])
    await requirePermission(req.userId!, entity, 'read');
  res.json(
    await snapshot(async (db) => {
      const isAdmin = Boolean(
        (
          await db.query(
            `SELECT 1 FROM portal.user_group_memberships m JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL WHERE m.user_id=$1 AND m."archivedAt" IS NULL AND g.name='Administrators' LIMIT 1`,
            [req.userId]
          )
        ).rowCount
      );
      const mine = !isAdmin && req.query.scope === 'mine';
      const result = {
        isAdmin,
        scope: mine ? 'mine' : 'all',
        spaces: (
          await db.query(
            'SELECT "objectId",name,description,position FROM portal.knowledge_spaces WHERE "archivedAt" IS NULL ORDER BY position,name'
          )
        ).rows,
        sections: (
          await db.query(
            'SELECT "objectId",space_id,name,position FROM portal.knowledge_sections WHERE "archivedAt" IS NULL ORDER BY position,name'
          )
        ).rows,
        entries: (
          await db.query(
            `SELECT e."objectId",section_id,parent_id,title,type,tags,position,"lastModifiedAt",responsible_id,(${reviewCurrentSql('e')}) AS "upToDate","reviewCycleMonths","reviewDueAt" FROM portal.knowledge_entries e WHERE "archivedAt" IS NULL AND ($1::uuid IS NULL OR responsible_id=$1) ORDER BY position,title`,
            [mine ? req.userId : null]
          )
        ).rows,
        storage: knowledgeStorageStatus(),
        overview: isAdmin
          ? (
              await db.query(
                `SELECT count(*)::int AS total,count(*) FILTER(WHERE btrim(plain_text)<>'')::int AS maintained,count(*) FILTER(WHERE btrim(plain_text)<>'' AND (${reviewCurrentSql('e')}))::int AS current FROM portal.knowledge_entries e WHERE "archivedAt" IS NULL`
              )
            ).rows[0]
          : null,
      };
      if (mine) {
        const ids = new Set(result.entries.map((entry) => entry.objectId));
        result.entries = result.entries.map((entry) => ({
          ...entry,
          parent_id: ids.has(entry.parent_id) ? entry.parent_id : null,
        }));
      }
      return result;
    })
  );
});
knowledgeRouter.get('/entries', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'read');
  const input = z
    .object({
      search: z.string().max(200).default(''),
      section_id: z.uuid().optional(),
      space_id: z.uuid().optional(),
      type: z.string().max(30).optional(),
      tag: z.string().max(60).optional(),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
      scope: z.enum(['mine', 'all']).default('all'),
    })
    .parse(req.query);
  const result = await pool.query(
    `SELECT e."objectId",e.title,e.type,e.tags,e.section_id,e."lastModifiedAt",e.responsible_id,(${reviewCurrentSql('e')}) AS "upToDate",e."reviewCycleMonths",e."reviewDueAt",left(e.plain_text,220) AS excerpt,s.name AS section_name,sp.name AS space_name
 FROM portal.knowledge_entries e JOIN portal.knowledge_sections s ON s."objectId"=e.section_id AND s."archivedAt" IS NULL
 JOIN portal.knowledge_spaces sp ON sp."objectId"=s.space_id AND sp."archivedAt" IS NULL
 WHERE e."archivedAt" IS NULL AND ($1='' OR to_tsvector('german',e.title||' '||e.plain_text) @@ websearch_to_tsquery('german',$1) OR e.title ILIKE '%'||$1||'%')
 AND ($2::uuid IS NULL OR e.section_id=$2) AND ($3::uuid IS NULL OR s.space_id=$3) AND ($4::text IS NULL OR e.type=$4) AND ($5::text IS NULL OR $5=ANY(e.tags))
 AND ($7::uuid IS NULL OR e.responsible_id=$7)
 ORDER BY e."lastModifiedAt" DESC,e.title LIMIT 51 OFFSET $6`,
    [
      input.search,
      input.section_id || null,
      input.space_id || null,
      input.type || null,
      input.tag || null,
      input.offset,
      input.scope === 'mine' ? req.userId : null,
    ]
  );
  res.json({
    rows: result.rows.slice(0, 50),
    nextOffset: result.rows.length > 50 ? input.offset + 50 : null,
  });
});
knowledgeRouter.post('/spaces', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_spaces', 'create');
  const input = spaceInput.parse(req.body);
  res
    .status(201)
    .json(await transaction(req.userId!, (db) => createRecord(db, 'knowledge_spaces', input)));
});
knowledgeRouter.post('/sections', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_sections', 'create');
  const input = sectionInput.parse(req.body);
  res
    .status(201)
    .json(await transaction(req.userId!, (db) => createRecord(db, 'knowledge_sections', input)));
});
knowledgeRouter.post('/entries', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'create');
  res
    .status(201)
    .json(await transaction(req.userId!, (db) => saveEntry(db, req.userId!, req.body)));
});
knowledgeRouter.get('/entries/:id', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'read');
  await requirePermission(req.userId!, 'knowledge_documents', 'read');
  res.json(await snapshot((db) => entryDetail(db, z.uuid().parse(req.params.id))));
});
knowledgeRouter.put('/entries/:id', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'update');
  res.json(
    await transaction(req.userId!, (db) =>
      saveEntry(
        db,
        req.userId!,
        req.body,
        z.uuid().parse(req.params.id),
        version(req.get('if-match'))
      )
    )
  );
});
knowledgeRouter.post('/entries/:id/review', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'update');
  res.json(
    await transaction(req.userId!, (db) =>
      completeEntryReview(
        db,
        req.userId!,
        z.uuid().parse(req.params.id),
        version(req.get('if-match'))
      )
    )
  );
});
knowledgeRouter.get('/entries/:id/history', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'read');
  const id = z.uuid().parse(req.params.id);
  res.json(
    (
      await pool.query(
        `SELECT e.id,e."lastModifiedAt",e."archivedAt",e."modifiedBy",e.title,${userName('c')} AS modified_by_name
 FROM portal.knowledge_entries e LEFT JOIN portal.users u ON u."objectId"=e."modifiedBy" AND u."archivedAt" IS NULL
 LEFT JOIN portal.contacts c ON c."objectId"=u.contact_id AND c."archivedAt" IS NULL
 WHERE e."objectId"=$1 ORDER BY e."lastModifiedAt" DESC LIMIT 50`,
        [id]
      )
    ).rows
  );
});
knowledgeRouter.post(
  '/entries/:id/templates',
  express.raw({ type: 'application/octet-stream', limit: '25mb' }),
  async (req, res) => {
    await requirePermission(req.userId!, 'knowledge_documents', 'create');
    await requirePermission(req.userId!, 'knowledge_entries', 'update');
    const id = z.uuid().parse(req.params.id);
    await snapshot((db) => activeRow(db, 'knowledge_entries', id));
    if (!Buffer.isBuffer(req.body)) throw httpError(400, 'Dateiinhalt fehlt.');
    let name: string;
    try {
      name = decodeURIComponent(req.get('x-file-name') || '');
    } catch {
      throw httpError(400, 'Ungültiger Dateiname.');
    }
    const uploaded = await uploadKnowledgeTemplate(name, req.body);
    try {
      const result = await transaction(req.userId!, async (db) => {
        const entry = await activeRow(db, 'knowledge_entries', id, true);
        await createRecord(db, 'knowledge_documents', {
          ...uploaded,
          entry_id: id,
          kind: 'template',
        });
        await updateRecord(db, 'knowledge_entries', id, entry.id, { responsible_id: req.userId! });
        return entryDetail(db, id);
      });
      res.status(201).json(result);
    } catch (error) {
      try {
        await removeNewKnowledgeUpload(uploaded.drive_id, uploaded.item_id);
      } catch {
        console.error('KM upload cleanup failed for item', uploaded.item_id);
      }
      throw error;
    }
  }
);
knowledgeRouter.get('/entries/:id/templates/:documentId/download', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_entries', 'read');
  await requirePermission(req.userId!, 'knowledge_documents', 'read');
  const id = z.uuid().parse(req.params.id),
    documentId = z.uuid().parse(req.params.documentId);
  const document = await snapshot(async (db) => {
    await activeRow(db, 'knowledge_entries', id);
    const file = await activeRow(db, 'knowledge_documents', documentId);
    if (file.entry_id !== id) throw httpError(404, 'Vorlage gehört nicht zu diesem Eintrag.');
    return file;
  });
  await sendSharePointDocument(res, document as any);
});
knowledgeRouter.delete('/entries/:id/templates/:documentId', async (req, res) => {
  await requirePermission(req.userId!, 'knowledge_documents', 'delete');
  await requirePermission(req.userId!, 'knowledge_entries', 'update');
  const id = z.uuid().parse(req.params.id),
    documentId = z.uuid().parse(req.params.documentId);
  res.json(
    await transaction(req.userId!, async (db) => {
      const entry = await activeRow(db, 'knowledge_entries', id, true);
      const document = await activeRow(db, 'knowledge_documents', documentId);
      if (document.entry_id !== id) throw httpError(404, 'Vorlage gehört nicht zu diesem Eintrag.');
      await archiveRecord(db, 'knowledge_documents', documentId, document.id);
      await updateRecord(db, 'knowledge_entries', id, entry.id, { responsible_id: req.userId! });
      return entryDetail(db, id);
    })
  );
});
