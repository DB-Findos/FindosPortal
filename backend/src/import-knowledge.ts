import './config.js';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse } from 'parse5';
import { pool } from './db.js';
import { projectRoot } from './config.js';
import { beginAuditedImport } from './services/imports.js';
import { sanitizeKnowledgeHtml, safeKnowledgeUrl } from './services/knowledge/html.js';
const source = process.argv.find((value) => value.endsWith('.html'));
assert.ok(source, 'Provide Knowledge HTML path.');
const apply = process.argv.includes('--apply');
const bytes = await readFile(source);
const dom = parse(bytes.toString('utf8'));
let seed: string | undefined;
const visit = (node: any) => {
  if (
    node.tagName === 'script' &&
    node.attrs.some((a: any) => a.name === 'id' && a.value === 'seed')
  )
    seed = node.childNodes.map((c: any) => c.value || '').join('');
  for (const child of node.childNodes || []) visit(child);
};
visit(dom);
assert.ok(seed, 'Seed JSON missing.');
const data = JSON.parse(seed) as { datasetId: string; sections: any[]; docs: any[] };
assert.ok(data.datasetId && Array.isArray(data.docs));
const directory = path.join(projectRoot, '.imports/knowledge');
await mkdir(directory, { recursive: true });
const hash = createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(directory, `${hash}.html`), bytes);
const uuid = (key: string) => {
  const h = createHash('sha256').update(`findos-km:${data.datasetId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const selected = data.docs.filter((doc) => ['findos', 'deal'].includes(doc.category));
assert.equal(new Set(selected.map((doc) => doc.id)).size, selected.length);
const selectedIds = new Set(selected.map((doc) => doc.id));
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const client = await pool.connect();
let created = 0,
  skipped = 0,
  empty = 0;
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('import-knowledge'))");
  await beginAuditedImport(client);
  const actor = (await client.query("SELECT current_setting('portal.actor_id') AS id")).rows[0].id;
  await writeFile(
    path.join(directory, `before-${Date.now()}.json`),
    JSON.stringify((await client.query('SELECT * FROM portal.knowledge_entries')).rows)
  );
  for (const [position, [key, name]] of Object.entries({
    findos: 'Findos Wiki',
    deal: 'Deal Team',
  }).entries()) {
    await client.query(
      `INSERT INTO portal.knowledge_spaces("objectId",name,position,source_key) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM portal.knowledge_spaces WHERE source_key=$4 AND "archivedAt" IS NULL)`,
      [uuid(`space:${key}`), name, position, `${data.datasetId}:space:${key}`]
    );
  }
  const sections = data.sections.filter((section) => ['findos', 'deal'].includes(section.category));
  for (const [position, section] of sections.entries())
    await client.query(
      `INSERT INTO portal.knowledge_sections("objectId",space_id,name,position,source_key)
 SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM portal.knowledge_sections WHERE source_key=$5 AND "archivedAt" IS NULL)`,
      [
        uuid(`section:${section.id}`),
        uuid(`space:${section.category}`),
        section.name,
        position,
        `${data.datasetId}:section:${section.id}`,
      ]
    );
  for (const doc of selected) {
    const key = `${data.datasetId}:entry:${doc.id}`;
    if (
      (
        await client.query(
          'SELECT 1 FROM portal.knowledge_entries WHERE source_key=$1 AND "archivedAt" IS NULL',
          [key]
        )
      ).rowCount
    ) {
      skipped++;
      continue;
    }
    assert.ok(
      sections.some((section) => section.id === doc.sectionId && section.category === doc.category),
      `Unknown section for ${doc.id}`
    );
    const clean = sanitizeKnowledgeHtml(
      (doc.fields || [])
        .map(
          (field: any) =>
            `${field.label ? `<h2>${escape(String(field.label))}</h2>` : ''}${String(field.html || '')}`
        )
        .join('\n')
    );
    if (!clean.text) empty++;
    const parent =
      selectedIds.has(doc.parentId) &&
      selected.find((candidate) => candidate.id === doc.parentId)?.sectionId === doc.sectionId
        ? uuid(`entry:${doc.parentId}`)
        : null;
    const date = doc.source?.modified;
    const modified = date && Number.isFinite(Date.parse(date)) ? date : null;
    await client.query(
      `INSERT INTO portal.knowledge_entries("objectId",section_id,parent_id,title,type,content_html,plain_text,tags,responsible_id,position,source_key,source_url,source_modified_at,source_data)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        uuid(`entry:${doc.id}`),
        uuid(`section:${doc.sectionId}`),
        parent,
        String(doc.title),
        ['process', 'meeting', 'policy', 'reference', 'checklist'].includes(doc.type)
          ? doc.type
          : 'reference',
        clean.html,
        clean.text,
        Array.isArray(doc.tags) ? doc.tags.map(String) : [],
        actor,
        Number(doc.order) || 0,
        key,
        doc.source?.url ? safeKnowledgeUrl(doc.source.url) : null,
        modified,
        JSON.stringify({
          source_file: path.basename(source),
          source_sha256: hash,
          source_id: doc.sourceId || doc.id,
          content_present: Boolean(clean.text),
          original_owner: doc.owner || null,
          original_author: doc.author || null,
        }),
      ]
    );
    created++;
  }
  const count = (
    await client.query(
      'SELECT count(*)::int count FROM portal.knowledge_entries WHERE source_key=ANY($1::text[]) AND "archivedAt" IS NULL',
      [selected.map((doc) => `${data.datasetId}:entry:${doc.id}`)]
    )
  ).rows[0].count;
  assert.equal(count, selected.length);
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const report = {
    apply,
    sourceRows: selected.length,
    created,
    skipped,
    emptyContents: empty,
    spaces: 2,
    sections: sections.length,
  };
  await writeFile(path.join(directory, 'import-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
