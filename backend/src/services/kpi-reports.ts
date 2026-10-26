import type { DatabaseClient } from '../database/connection.js';
import {
  activeRow,
  archiveRecord,
  createRecord,
  current,
  updateRecord,
} from '../repositories/entities.js';
import { permit, type Rights } from './kpi-definitions.js';
import { reportInput } from './kpi-schema.js';
import { fieldError } from '../shared/errors.js';

export async function reportWithItems(client: DatabaseClient, id: string) {
  const report = await activeRow(client, 'report_definitions', id);
  const items = (
    await client.query(
      `SELECT * FROM portal.report_items WHERE report_id=$1 AND ${current} ORDER BY position`,
      [id]
    )
  ).rows;
  return { ...report, kpi_ids: items.map((item) => item.kpi_id) };
}
export async function saveReport(
  client: DatabaseClient,
  raw: unknown,
  rights: Rights,
  id?: string,
  version?: string,
  creationId?: string
) {
  permit(rights, 'report_definitions', id ? 'update' : 'create');
  permit(rights, 'report_items', id ? 'update' : 'create');
  permit(rights, 'kpi_formulas');
  const { kpi_ids, ...input } = reportInput.parse(raw);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
  for (const kpi of kpi_ids) {
    try {
      await activeRow(client, 'kpi_formulas', kpi);
    } catch {
      throw fieldError(400, 'kpi_ids', 'Eine ausgewählte KPI ist nicht mehr verfügbar.');
    }
  }
  const row = id
    ? await updateRecord(client, 'report_definitions', id, version!, input)
    : await createRecord(client, 'report_definitions', {
        ...input,
        ...(creationId ? { objectId: creationId } : {}),
      });
  const old = (
    await client.query(`SELECT * FROM portal.report_items WHERE report_id=$1 AND ${current}`, [
      row.objectId,
    ])
  ).rows;
  for (const item of old) await archiveRecord(client, 'report_items', item.objectId, item.id);
  for (const [position, kpi_id] of kpi_ids.entries()) {
    const previous = old.find((item) => item.kpi_id === kpi_id);
    await createRecord(client, 'report_items', {
      report_id: row.objectId,
      kpi_id,
      position,
      ...(previous
        ? {
            objectId: previous.objectId,
            priorId: previous.id,
            createdAt: previous.createdAt,
            createdBy: previous.createdBy,
          }
        : {}),
    });
  }
  return reportWithItems(client, row.objectId);
}
