import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { activeRow, transaction, updateRecord } from '../repositories/entities.js';
import { applicationUrl } from '../services/application-schema.js';
import { fieldError } from '../shared/errors.js';

export const applicationsRouter = Router();
applicationsRouter.use(authenticate);
async function applications() {
  return (
    await pool.query(
      'SELECT * FROM portal.application_modules WHERE "archivedAt" IS NULL ORDER BY position,key'
    )
  ).rows;
}
// The launcher is available to every signed-in user. Editing links is a
// separate entity permission; report views keep their existing permissions.
applicationsRouter.get('/', async (_req, res) => res.json(await applications()));
applicationsRouter.put('/links', async (req, res) => {
  await requirePermission(req.userId!, 'application_modules', 'update');
  const input = z
    .object({
      links: z
        .array(
          z
            .object({
              objectId: z.uuid(),
              version_id: z.uuid(),
              external_url: applicationUrl,
            })
            .strict()
        )
        .min(1)
        .max(50),
    })
    .strict()
    .parse(req.body);
  const identities = input.links.map((link) => link.objectId);
  if (new Set(identities).size !== identities.length)
    throw fieldError(400, 'links', 'Jeden Bereich nur einmal übergeben.');
  await transaction(req.userId!, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-application-links'))");
    for (const [index, link] of input.links.entries()) {
      const previous = await activeRow(client, 'application_modules', link.objectId, true);
      if (
        ['knowledge-management', 'portfolio-management'].includes(previous.key) &&
        link.external_url
      )
        throw fieldError(
          400,
          `links.${index}.external_url`,
          'Dieser Bereich ist als Portalbereich integriert.'
        );
      if (previous.id !== link.version_id)
        throw fieldError(
          409,
          `links.${index}.external_url`,
          'Dieser Link wurde inzwischen geändert. Bitte neu laden.'
        );
      if (previous.external_url !== link.external_url)
        await updateRecord(client, 'application_modules', link.objectId, link.version_id, {
          external_url: link.external_url,
        });
    }
  });
  res.json(await applications());
});
