import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadKnowledgeTemplate } from './knowledge/sharepoint.js';

export async function sendSharePointDocument(
  res: Response,
  document: { drive_id: string; item_id: string; name: string; mime_type: string }
) {
  const body = await downloadKnowledgeTemplate(document.drive_id, document.item_id);
  res.attachment(document.name);
  res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    await pipeline(Readable.fromWeb(body as any), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    throw error;
  }
}
