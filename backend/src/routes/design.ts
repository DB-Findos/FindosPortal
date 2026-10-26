import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  current,
  transaction,
  createRecord,
  updateRecord,
  activeRow,
  archiveRecord,
} from '../repositories/entities.js';
import { imageInput } from '../services/images.js';
import { httpError } from '../shared/errors.js';
export const designRouter = Router();
export const defaultColors = {
  primary: '#246649',
  secondary: '#738077',
  accent: '#a7d5bc',
  background: '#f7f9f8',
  surface: '#ffffff',
  text: '#22332d',
};
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const input = z
  .object({
    colors: z
      .object({
        primary: hex,
        secondary: hex,
        accent: hex,
        background: hex,
        surface: hex,
        text: hex,
      })
      .strict(),
    logo: imageInput.nullable().optional(),
  })
  .strict();
async function getDesign() {
  const settings = (
    await pool.query(`SELECT * FROM portal.design_settings WHERE key='application' AND ${current}`)
  ).rows[0];
  if (!settings) return { id: null, objectId: null, colors: defaultColors, logo: null };
  const logo = settings.logo_id
    ? (
        await pool.query(
          `SELECT id,"objectId",name,mime_type,data_base64 FROM portal.images WHERE "objectId"=$1 AND ${current}`,
          [settings.logo_id]
        )
      ).rows[0] || null
    : null;
  return {
    id: settings.id,
    objectId: settings.objectId,
    colors: Object.fromEntries(
      Object.keys(defaultColors).map((key) => [key, settings[key + '_color']])
    ),
    logo,
  };
}
// Public branding is needed on the login screen; no private configuration is exposed.
designRouter.get('/', async (_req, res) => res.json(await getDesign()));
designRouter.put('/', authenticate, async (req, res) => {
  const data = input.parse(req.body);
  await transaction(req.userId!, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-design'))");
    const previous = (
      await client.query(
        `SELECT * FROM portal.design_settings WHERE key='application' AND ${current} FOR UPDATE`
      )
    ).rows[0];
    await requirePermission(req.userId!, 'design_settings', previous ? 'update' : 'create');
    if ((previous?.id || 'new') !== req.get('If-Match'))
      throw httpError(409, 'Das Design wurde inzwischen geändert. Bitte neu laden.');
    let logoId = previous?.logo_id || null;
    if (data.logo) {
      if (logoId) {
        await requirePermission(req.userId!, 'images', 'update');
        const image = await activeRow(client, 'images', logoId, true);
        await updateRecord(client, 'images', logoId, image.id, data.logo);
      } else {
        await requirePermission(req.userId!, 'images', 'create');
        logoId = (await createRecord(client, 'images', data.logo)).objectId;
      }
    } else if (data.logo === null) logoId = null;
    const row = {
      key: 'application',
      logo_id: logoId,
      ...Object.fromEntries(
        Object.entries(data.colors).map(([key, value]) => [key + '_color', value])
      ),
    };
    if (previous)
      await updateRecord(client, 'design_settings', previous.objectId, previous.id, row);
    else await createRecord(client, 'design_settings', row);
    if (data.logo === null && previous?.logo_id) {
      await requirePermission(req.userId!, 'images', 'delete');
      const image = await activeRow(client, 'images', previous.logo_id, true);
      await archiveRecord(client, 'images', image.objectId, image.id);
    }
  });
  res.json(await getDesign());
});
