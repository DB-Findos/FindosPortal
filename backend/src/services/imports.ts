import type { DatabaseClient as PoolClient } from '../database/connection.js';
export async function beginAuditedImport(client: PoolClient) {
  const actor = (
    await client.query(
      'SELECT "objectId" FROM portal.users WHERE active AND "archivedAt" IS NULL AND email=$1',
      [process.env.ADMIN_EMAIL]
    )
  ).rows[0];
  if (!actor) throw Error('An active ADMIN_EMAIL user is required for audited imports');
  await client.query(
    "SELECT set_config('portal.actor_id',$1,true),set_config('portal.allow_archive','on',true)",
    [actor.objectId]
  );
}
