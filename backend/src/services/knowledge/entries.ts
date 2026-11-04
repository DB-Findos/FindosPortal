import type { DatabaseClient } from '../../database/connection.js';
import { activeRow, createRecord, updateRecord } from '../../repositories/entities.js';
import { entryInput } from './schema.js';
import { sanitizeKnowledgeHtml } from './html.js';
import { fieldError, httpError } from '../../shared/errors.js';
export const userName = (alias: string) =>
  `coalesce(nullif(trim(concat(${alias}.first_name,' ',${alias}.last_name)),''),'Benutzer')`;
export async function entryDetail(db: DatabaseClient, id: string) {
  const row = await activeRow(db, 'knowledge_entries', id);
  row.upToDate = Boolean(
    row.upToDate && row.reviewDueAt && new Date(row.reviewDueAt).getTime() > Date.now()
  );
  const section = await activeRow(db, 'knowledge_sections', row.section_id);
  const space = await activeRow(db, 'knowledge_spaces', section.space_id);
  const actors = (
    await db.query(
      `SELECT u."objectId",${userName('c')} AS name FROM portal.users u
 LEFT JOIN portal.contacts c ON c."objectId"=u.contact_id AND c."archivedAt" IS NULL
 WHERE u."objectId"=ANY($1::uuid[]) AND u."archivedAt" IS NULL`,
      [[row.createdBy, row.modifiedBy, row.responsible_id]]
    )
  ).rows;
  const names = new Map(actors.map((actor) => [actor.objectId, actor.name]));
  const documents = (
    await db.query(
      `SELECT k.*,d."objectId" AS document_id,coalesce(d.name,k.name) AS name,coalesce(d.url,k.url) AS url,
       d.document_type_id,d.origin_id FROM portal.knowledge_documents k
       LEFT JOIN portal.documents d ON d.source_entity='knowledge_documents' AND d.source_object_id=k."objectId" AND d."archivedAt" IS NULL
       WHERE k.entry_id=$1 AND k."archivedAt" IS NULL ORDER BY k.uploaded_at DESC`,
      [id]
    )
  ).rows;
  return {
    ...row,
    section,
    space,
    created_by_name: names.get(row.createdBy) || 'Benutzer',
    modified_by_name: names.get(row.modifiedBy) || 'Benutzer',
    responsible_name: names.get(row.responsible_id) || 'Benutzer',
    documents: documents.map((document) => ({
      ...document,
      url: `/api/knowledge/entries/${id}/templates/${document.objectId}/download`,
    })),
  };
}
export async function completeEntryReview(
  db: DatabaseClient,
  userId: string,
  id: string,
  expectedVersion: string
) {
  const entry = await activeRow(db, 'knowledge_entries', id, true);
  if (entry.responsible_id !== userId)
    throw httpError(403, 'Nur der verantwortliche Benutzer kann diese Prüfung abschließen.');
  if (entry.upToDate && entry.reviewDueAt && new Date(entry.reviewDueAt).getTime() > Date.now())
    throw httpError(409, 'Die Prüfung ist bereits abgeschlossen. Bitte den Eintrag neu laden.');
  if (!entry.plain_text.trim())
    throw httpError(400, 'Bitte zuerst den Inhalt pflegen, bevor die Prüfung abgeschlossen wird.');
  await updateRecord(db, 'knowledge_entries', id, expectedVersion, {
    upToDate: true,
    reviewedAt: new Date().toISOString(),
    reviewedBy: userId,
  });
  return entryDetail(db, id);
}

export async function saveEntry(
  db: DatabaseClient,
  userId: string,
  raw: unknown,
  id?: string,
  version?: string
) {
  const input = entryInput.parse(raw);
  await activeRow(db, 'knowledge_sections', input.section_id);
  await db.query("SELECT pg_advisory_xact_lock(hashtext('knowledge-entry-graph'))");
  let parent = input.parent_id;
  const seen = new Set<string>();
  while (parent) {
    if (parent === id || seen.has(parent) || seen.size > 50)
      throw fieldError(400, 'parent_id', 'Zyklische Seitenstruktur.');
    seen.add(parent);
    const row = await activeRow(db, 'knowledge_entries', parent);
    if (row.section_id !== input.section_id)
      throw fieldError(
        400,
        'section_id',
        'Übergeordneter Eintrag muss im selben Abschnitt liegen.'
      );
    parent = row.parent_id;
  }
  if (id) {
    const children = (
      await db.query(
        'SELECT 1 FROM portal.knowledge_entries WHERE parent_id=$1 AND section_id<>$2 AND "archivedAt" IS NULL LIMIT 1',
        [id, input.section_id]
      )
    ).rowCount;
    if (children)
      throw fieldError(
        400,
        'section_id',
        'Eintrag hat Unterseiten. Bitte zuerst die Unterseiten verschieben.'
      );
  }
  const clean = sanitizeKnowledgeHtml(input.content_html);
  if (input.upToDate && !clean.text)
    throw fieldError(
      400,
      'upToDate',
      'Bitte zuerst den Inhalt pflegen, bevor der Eintrag als aktuell bestätigt wird.'
    );
  const data = {
    ...input,
    content_html: clean.html,
    plain_text: clean.text,
    tags: [...new Set(input.tags)],
    responsible_id: userId,
    ...(input.upToDate ? { reviewedAt: new Date().toISOString(), reviewedBy: userId } : {}),
  };
  const row = id
    ? await updateRecord(db, 'knowledge_entries', id, version!, data)
    : await createRecord(db, 'knowledge_entries', data);
  return entryDetail(db, row.objectId);
}
