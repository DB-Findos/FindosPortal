import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { jwtSecret } from '../config.js';
import { definitions, entityName } from '../entities.js';
import {
  activeRow,
  archiveRecord,
  createRecord,
  transaction,
  updateRecord,
} from '../repositories/entities.js';
import { formulaInput, reportInput } from '../services/kpi-schema.js';
import { permit, prepareFormula, saveFormula } from '../services/kpi-definitions.js';
import { saveReport } from '../services/kpi-reports.js';
import { compileSearch, searchDefinition } from '../services/search.js';
import { snapshot } from '../services/snapshot.js';
import { httpError } from '../shared/errors.js';
import type { Actor } from './data.js';
import type { DatabaseClient } from '../database/connection.js';

const target = { object_id: z.uuid().optional(), expected_version: z.uuid().optional() };
const viewInput = z
  .object({ name: z.string().trim().min(1).max(100), definition: searchDefinition })
  .strict();
export const changeInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('formula'), formula: formulaInput, ...target }).strict(),
  z.object({ kind: z.literal('report'), report: reportInput, ...target }).strict(),
  z.object({ kind: z.literal('view'), view: viewInput, ...target }).strict(),
  z
    .object({
      kind: z.literal('record'),
      entity: z.string(),
      data: z.record(z.string(), z.unknown()),
      ...target,
    })
    .strict(),
  z
    .object({
      kind: z.literal('archive'),
      entity: z.string(),
      object_id: z.uuid(),
      expected_version: z.uuid(),
    })
    .strict(),
]);
type Change = z.infer<typeof changeInput>;
export type ChangeProposal = {
  token: string;
  title: string;
  entity: string;
  operation: string;
  preview: unknown;
};
function changeEntity(change: Change) {
  return entityName(
    change.kind === 'formula'
      ? 'kpi_formulas'
      : change.kind === 'report'
        ? 'report_definitions'
        : change.kind === 'view'
          ? 'search_views'
          : change.entity
  );
}
async function validateChange(db: DatabaseClient, actor: Actor, change: Change) {
  const entity = changeEntity(change);
  const operation = change.kind === 'archive' ? 'delete' : change.object_id ? 'update' : 'create';
  permit(actor.rights, entity, operation);
  if (Boolean(change.object_id) !== Boolean(change.expected_version))
    throw httpError(400, 'object_id und expected_version gemeinsam angeben.');
  let previous;
  if (change.object_id) {
    permit(actor.rights, entity);
    previous = await activeRow(db, entity, change.object_id);
    if (previous.id !== change.expected_version)
      throw httpError(409, 'Datensatz inzwischen geändert. Erneut lesen.');
    if (entity === 'search_views' && previous.owner_id !== actor.userId)
      throw httpError(403, 'View gehört einem anderen Nutzer.');
  }
  if (change.kind === 'formula') {
    permit(actor.rights, 'variable_map', operation);
    const prepared = await prepareFormula(db, change.formula, actor.rights, change.object_id);
    return { ...prepared.data, variables: prepared.variables };
  }
  if (change.kind === 'report') {
    permit(actor.rights, 'report_items', operation);
    permit(actor.rights, 'kpi_formulas');
    for (const id of change.report.kpi_ids) await activeRow(db, 'kpi_formulas', id);
    return change.report;
  }
  if (change.kind === 'view') {
    compileSearch(change.view.definition, actor.rights);
    return change.view;
  }
  if (change.kind === 'archive') {
    if (['entities', 'variable_map', 'report_items'].includes(entity))
      throw httpError(403, 'Diese Struktur nur über ihre übergeordnete Funktion ändern.');
    if (entity === 'kpi_formulas') permit(actor.rights, 'variable_map', 'delete');
    if (entity === 'report_definitions') permit(actor.rights, 'report_items', 'delete');
    if (entity === 'users' && change.object_id === actor.userId)
      throw httpError(400, 'Eigenes Konto kann nicht archiviert werden.');
    return {
      object_id: change.object_id,
      expected_version: change.expected_version,
      archive: true,
    };
  }
  if ('readonly' in definitions[entity])
    throw httpError(400, 'Die spezialisierte Formula-, Report- oder View-Funktion verwenden.');
  // Passwords are deliberately never routed through an LLM or signed preview.
  if (entity === 'users')
    throw httpError(
      400,
      'Nutzerkonten und Passwörter über die Nutzerverwaltung ändern. Gruppen und Berechtigungen können hier bearbeitet werden.'
    );
  const schema = definitions[entity].schema;
  const data = change.object_id
    ? z.object(schema.shape).partial().strict().parse(change.data)
    : schema.strict().parse(change.data);
  if (!Object.keys(data).length) throw httpError(400, 'Keine Änderungen.');
  if (previous)
    schema.parse({
      ...Object.fromEntries(Object.keys(schema.shape).map((key) => [key, previous[key]])),
      ...data,
    });
  for (const [field, reference] of Object.entries(definitions[entity].refs)) {
    const id = (data as Record<string, unknown>)[field];
    if (typeof id === 'string') {
      permit(actor.rights, reference);
      await activeRow(db, entityName(reference), id);
    }
  }
  change.data = data;
  return data;
}

export async function proposeChange(actor: Actor, raw: unknown): Promise<ChangeProposal> {
  const change = changeInput.parse(raw);
  const preview = await snapshot((db) => validateChange(db, actor, change));
  const entity = changeEntity(change);
  const operation = change.kind === 'archive' ? 'archive' : change.object_id ? 'update' : 'create';
  const name = (preview as { name?: string }).name;
  const token = jwt.sign({ change }, jwtSecret(), {
    algorithm: 'HS256',
    issuer: 'findos-portal',
    audience: 'findos-change',
    subject: actor.userId,
    jwtid: randomUUID(),
    expiresIn: '30m',
  });
  return {
    token,
    entity,
    operation,
    title: `${definitions[entity].label}: ${name || change.object_id || 'Neuer Eintrag'}`,
    preview,
  };
}

export async function commitChange(actor: Actor, token: string) {
  if (!actor.canCommit)
    throw httpError(403, 'Dieser Zugang darf nur lesen und Vorschläge erstellen.');
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'findos-portal',
      audience: 'findos-change',
    });
  } catch {
    throw httpError(400, 'Vorschlag ungültig oder abgelaufen. Neu erstellen lassen.');
  }
  if (typeof payload === 'string' || payload.sub !== actor.userId || !payload.jti)
    throw httpError(403, 'Vorschlag gehört einem anderen Nutzer.');
  const identity = z.uuid().parse(payload.jti);
  const change = changeInput.parse(payload.change);
  const entity = changeEntity(change);
  return transaction(actor.userId, async (db) => {
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity]);
    // A deterministic objectId makes creation retries safe, also across restarts/instances.
    if (!change.object_id) {
      permit(actor.rights, entity, 'create');
      const existing = (
        await db.query(
          `SELECT "objectId",id FROM portal.${entity} WHERE "objectId"=$1 ORDER BY "lastModifiedAt" DESC LIMIT 1`,
          [identity]
        )
      ).rows[0];
      if (existing) return { ...existing, entity, alreadyCommitted: true };
    }
    await validateChange(db, actor, change);
    let result;
    if (change.kind === 'formula')
      result = await saveFormula(
        db,
        change.formula,
        actor.rights,
        change.object_id,
        change.expected_version,
        identity
      );
    else if (change.kind === 'report')
      result = await saveReport(
        db,
        change.report,
        actor.rights,
        change.object_id,
        change.expected_version,
        identity
      );
    else if (change.kind === 'archive') {
      if (entity === 'kpi_formulas' || entity === 'report_definitions')
        await db.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
      await archiveRecord(db, entity, change.object_id, change.expected_version);
      return { entity, objectId: change.object_id, archived: true };
    } else {
      const data =
        change.kind === 'view' ? { ...change.view, owner_id: actor.userId } : change.data;
      result = change.object_id
        ? await updateRecord(db, entity, change.object_id, change.expected_version!, data)
        : await createRecord(db, entity, { ...data, objectId: identity });
    }
    return { entity, objectId: result.objectId, id: result.id, name: result.name };
  });
}
