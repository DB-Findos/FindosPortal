import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { pool } from '../db.js';
import { createRecord, transaction } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';
import { ownConversation } from './chat-history.js';
import { snapshot } from './snapshot.js';

export const uploadInput = z
  .object({ name: z.string().min(1).max(200), data_base64: z.string().max(6990508) })
  .strict();
const mime: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
async function extract(bytes: Buffer, extension: string) {
  if (['.txt', '.md', '.csv', '.json'].includes(extension)) return bytes.toString('utf8');
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: bytes });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (extension === '.docx') return (await mammoth.extractRawText({ buffer: bytes })).value;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const text: string[] = [];
  let size = 0;
  book.eachSheet((sheet) => {
    text.push('Sheet: ' + sheet.name);
    sheet.eachRow((row) => {
      if (size > 2000000) return;
      const line = JSON.stringify(row.values);
      size += line.length;
      text.push(line);
    });
  });
  return text.join('\n');
}
export async function saveDocument(
  userId: string,
  conversationId: string,
  raw: unknown,
  source: 'upload' | 'generated' = 'upload'
) {
  const input = uploadInput.parse(raw),
    name = path.basename(input.name.replaceAll('\\', '/')),
    extension = path.extname(name).toLowerCase();
  if (!mime[extension])
    throw httpError(400, 'Unterstützt: PDF, DOCX, XLSX, TXT, MD, CSV und JSON.');
  const bytes = Buffer.from(input.data_base64, 'base64');
  if (bytes.length > 5242880 || bytes.toString('base64') !== input.data_base64)
    throw httpError(400, 'Datei ungültig oder größer als 5 MB.');
  await snapshot((db) => ownConversation(db, userId, conversationId));
  let extracted = '',
    note: string | null = null;
  try {
    extracted = await extract(bytes, extension);
    if (extracted.length > 2000000) note = 'Textextraktion auf 2 Millionen Zeichen begrenzt.';
    extracted = extracted.slice(0, 2000000);
    if (!extracted.trim()) note = 'Kein Text extrahiert (z. B. gescanntes PDF; keine OCR).';
  } catch {
    note = 'Textextraktion nicht möglich. Originaldatei bleibt zum Download verfügbar.';
  }
  const id = randomUUID();
  return transaction(userId, async (db) => {
    await ownConversation(db, userId, conversationId);
    await createRecord(db, 'chat_documents', {
      objectId: id,
      owner_id: userId,
      conversation_id: conversationId,
      name,
      document_at: new Date().toISOString(),
      url: `/api/ai/documents/${id}/content`,
      extension,
      mime_type: mime[extension],
      size_bytes: bytes.length,
      source,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data_base64: input.data_base64,
      extracted_text: extracted,
      extraction_note: note,
    });
    return {
      objectId: id,
      name,
      url: `/api/ai/documents/${id}/content`,
      extension,
      mime_type: mime[extension],
      size_bytes: bytes.length,
      source,
      extraction_note: note,
    };
  });
}
export async function ownDocument(userId: string, id: string) {
  const row = (
    await pool.query(
      `SELECT d.* FROM portal.chat_documents d JOIN portal.chat_conversations c ON c."objectId"=d.conversation_id AND c."archivedAt" IS NULL WHERE d."objectId"=$1 AND d.owner_id=$2 AND c.owner_id=$2 AND d."archivedAt" IS NULL`,
      [id, userId]
    )
  ).rows[0];
  if (!row) throw httpError(404, 'Dokument nicht gefunden.');
  return row;
}
export async function readDocument(userId: string, id: string, offset = 0) {
  const row = await ownDocument(userId, id),
    text = row.extracted_text || '';
  return {
    objectId: id,
    name: row.name,
    url: row.url,
    mime_type: row.mime_type,
    extraction_note: row.extraction_note,
    text: text.slice(offset, offset + 20000),
    totalCharacters: text.length,
    nextOffset: offset + 20000 < text.length ? offset + 20000 : null,
  };
}
