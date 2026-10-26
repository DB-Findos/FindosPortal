import type { DatabaseClient } from '../database/connection.js';
import { pool } from '../db.js';
import { activeRow, createRecord, transaction, updateRecord } from '../repositories/entities.js';
import { httpError } from '../shared/errors.js';
import { snapshot } from './snapshot.js';
import type { ChangeProposal } from '../mcp/changes.js';
import { commitChange } from '../mcp/changes.js';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config.js';
import type { Actor } from '../mcp/data.js';

export async function ownConversation(
  db: DatabaseClient,
  userId: string,
  id: string,
  lock = false
) {
  const row = await activeRow(db, 'chat_conversations', id, lock);
  if (row.owner_id !== userId) throw httpError(404, 'Konversation nicht gefunden.');
  return row;
}
export async function listConversations(userId: string, offset = 0) {
  const rows = (
    await pool.query(
      `SELECT c."objectId",c.id,c.title,c.model,c.reasoning_effort,
    coalesce((SELECT max(m.sent_at) FROM portal.chat_messages m WHERE m.conversation_id=c."objectId" AND m."archivedAt" IS NULL),c."createdAt") AS updated_at
    FROM portal.chat_conversations c WHERE c.owner_id=$1 AND c."archivedAt" IS NULL
    ORDER BY updated_at DESC,c."objectId" LIMIT 51 OFFSET $2`,
      [userId, offset]
    )
  ).rows;
  return {
    rows: rows.slice(0, 50),
    hasMore: rows.length > 50,
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}
export async function messagesIn(db: DatabaseClient, conversationId: string) {
  const rows = (
    await db.query(
      `SELECT * FROM portal.chat_messages WHERE conversation_id=$1 AND "archivedAt" IS NULL ORDER BY sent_at,"objectId"`,
      [conversationId]
    )
  ).rows;
  const files = (
    await db.query(
      `SELECT f.message_id,d."objectId",d.name,d.url,d.mime_type,d.extension,d.size_bytes,d.source,d.document_at,d.extraction_note
    FROM portal.chat_message_files f JOIN portal.chat_documents d ON d."objectId"=f.document_id AND d."archivedAt" IS NULL
    WHERE d.conversation_id=$1 AND f."archivedAt" IS NULL ORDER BY d.document_at`,
      [conversationId]
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    response_time_ms: row.response_time_ms == null ? null : Number(row.response_time_ms),
    files: files.filter((f) => f.message_id === row.objectId),
  }));
}
export async function readConversation(userId: string, id: string) {
  return snapshot(async (db) => ({
    conversation: await ownConversation(db, userId, id),
    messages: await messagesIn(db, id),
  }));
}
export async function createConversation(userId: string, model: string, effort: string) {
  return transaction(userId, (db) =>
    createRecord(db, 'chat_conversations', {
      owner_id: userId,
      title: 'Neue Konversation',
      model,
      reasoning_effort: effort,
    })
  );
}
export async function beginMessage(
  userId: string,
  input: {
    conversation_id: string;
    message_id: string;
    content: string;
    document_ids: string[];
    model: string;
    reasoning_effort: string;
  }
) {
  return transaction(userId, async (db) => {
    const conversation = await ownConversation(db, userId, input.conversation_id, true);
    const prior = await messagesIn(db, input.conversation_id);
    const duplicate = prior.find((row) => row.objectId === input.message_id);
    if (duplicate) {
      const answer = prior.find((row) => row.reply_to_id === input.message_id);
      if (answer) return { cached: answer, messages: prior };
      throw httpError(409, 'Diese Nachricht wird bereits verarbeitet. Verlauf neu laden.');
    }
    const last = prior.at(-1);
    if (last?.role === 'user' && Date.now() - new Date(last.sent_at).getTime() < 600000)
      throw httpError(409, 'Für diese Konversation wird noch eine Antwort erzeugt.');
    for (const id of input.document_ids) {
      const file = await activeRow(db, 'chat_documents', id);
      if (file.owner_id !== userId || file.conversation_id !== input.conversation_id)
        throw httpError(400, 'Anhang gehört nicht zu dieser Konversation.');
    }
    const sent = (await db.query('SELECT clock_timestamp() AS timestamp')).rows[0].timestamp;
    const message = await createRecord(db, 'chat_messages', {
      objectId: input.message_id,
      conversation_id: input.conversation_id,
      role: 'user',
      content: input.content,
      sent_at: sent,
      reply_to_id: null,
      response_time_ms: null,
      model: input.model,
      reasoning_effort: input.reasoning_effort,
      status: 'complete',
      metadata: {},
    });
    for (const documentId of input.document_ids)
      await createRecord(db, 'chat_message_files', {
        message_id: message.objectId,
        document_id: documentId,
      });
    await updateRecord(db, 'chat_conversations', conversation.objectId, conversation.id, {
      model: input.model,
      reasoning_effort: input.reasoning_effort,
      ...(!prior.length ? { title: input.content.slice(0, 100) || 'Dokumentbesprechung' } : {}),
    });
    return { cached: null, messages: await messagesIn(db, input.conversation_id) };
  });
}
export async function finishMessage(
  userId: string,
  conversationId: string,
  questionId: string,
  content: string,
  metadata: { changes?: ChangeProposal[]; steps?: string[]; document_ids?: string[] },
  status = 'complete'
) {
  return transaction(userId, async (db) => {
    await ownConversation(db, userId, conversationId, true);
    const question = await activeRow(db, 'chat_messages', questionId);
    if (question.conversation_id !== conversationId || question.role !== 'user')
      throw httpError(400, 'Ungültige Frage-Referenz.');
    const existing = (
      await db.query(
        'SELECT * FROM portal.chat_messages WHERE reply_to_id=$1 AND "archivedAt" IS NULL',
        [questionId]
      )
    ).rows[0];
    if (existing) return existing;
    const timing = (
      await db.query(
        'SELECT clock_timestamp() AS sent_at, greatest(0,floor(extract(epoch FROM (clock_timestamp()-$1::timestamptz))*1000))::bigint AS elapsed',
        [question.sent_at]
      )
    ).rows[0];
    const row = await createRecord(db, 'chat_messages', {
      conversation_id: conversationId,
      role: 'assistant',
      content,
      sent_at: timing.sent_at,
      reply_to_id: questionId,
      response_time_ms: timing.elapsed,
      model: question.model,
      reasoning_effort: question.reasoning_effort,
      status,
      metadata,
    });
    for (const id of metadata.document_ids || []) {
      const file = await activeRow(db, 'chat_documents', id);
      if (file.owner_id !== userId || file.conversation_id !== conversationId)
        throw httpError(400, 'Ungültige Dokumentreferenz.');
      await createRecord(db, 'chat_message_files', { message_id: row.objectId, document_id: id });
    }
    return row;
  });
}
export function modelHistory(messages: Record<string, any>[]) {
  return messages.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content:
      message.content +
      (message.files?.length
        ? '\nDokumentreferenzen (über read_document abrufbar): ' +
          JSON.stringify(
            message.files.map((f: Record<string, unknown>) => ({ id: f.objectId, name: f.name }))
          )
        : '') +
      (message.metadata?.changes?.length
        ? '\nÄnderungsvorschläge: ' +
          JSON.stringify(
            message.metadata.changes.map(
              ({ token: _, ...preview }: ChangeProposal, index: number) => ({
                ...preview,
                committed: message.metadata.committed_indices?.includes(index) || false,
              })
            )
          )
        : ''),
  }));
}

export async function commitStoredChange(actor: Actor, messageId: string, index: number) {
  const message = await snapshot(async (db) => {
    const row = await activeRow(db, 'chat_messages', messageId);
    await ownConversation(db, actor.userId, row.conversation_id);
    return row;
  });
  if (message.role !== 'assistant') throw httpError(400, 'Kein KI-Vorschlag.');
  if (message.metadata.committed_indices?.includes(index)) return { alreadyCommitted: true };
  const proposal = message.metadata.changes?.[index] as ChangeProposal | undefined;
  if (!proposal) throw httpError(404, 'Vorschlag nicht gefunden.');
  // Renew only a server-stored, user-owned proposal, preserving its idempotency ID.
  const payload = jwt.verify(proposal.token, jwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'findos-portal',
    audience: 'findos-change',
    ignoreExpiration: true,
  });
  if (typeof payload === 'string' || payload.sub !== actor.userId || !payload.jti)
    throw httpError(403, 'Ungültiger Vorschlag.');
  const token = jwt.sign({ change: payload.change }, jwtSecret(), {
    algorithm: 'HS256',
    issuer: 'findos-portal',
    audience: 'findos-change',
    subject: actor.userId,
    jwtid: payload.jti,
    expiresIn: '5m',
  });
  const result = await commitChange(actor, token);
  await transaction(actor.userId, async (db) => {
    const row = await activeRow(db, 'chat_messages', messageId, true);
    await ownConversation(db, actor.userId, row.conversation_id);
    const committed = Array.from(new Set([...(row.metadata.committed_indices || []), index]));
    await updateRecord(db, 'chat_messages', messageId, row.id, {
      metadata: { ...row.metadata, committed_indices: committed },
    });
  });
  return result;
}
