import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { snapshot } from '../services/snapshot.js';
import { activeRow } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';
import { sendSharePointDocument } from '../services/document-download.js';

export const documentsRouter = Router();
documentsRouter.use(authenticate);
documentsRouter.get('/:id/download', async (req, res) => {
  await requirePermission(req.userId!, 'documents', 'read');
  const document = await snapshot((db) =>
    activeRow(db, 'documents', z.uuid().parse(req.params.id))
  );
  if (document.knowledge_entry_id) {
    await requirePermission(req.userId!, 'knowledge_entries', 'read');
    await requirePermission(req.userId!, 'knowledge_documents', 'read');
  }
  if (document.storage_provider !== 'sharepoint' || !document.drive_id || !document.item_id)
    throw httpError(404, 'Für dieses Dokument ist kein Datei-Download hinterlegt.');
  await sendSharePointDocument(res, document as any);
});
