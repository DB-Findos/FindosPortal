import { pool } from '../../db.js';

export async function hasPendingAccess(userId: string): Promise<boolean> {
  return Boolean(
    (
      await pool.query(
        `SELECT 1 FROM portal.user_group_memberships m
     JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL
     WHERE m.user_id=$1 AND m."archivedAt" IS NULL AND g.name='Inactive' LIMIT 1`,
        [userId]
      )
    ).rowCount
  );
}
