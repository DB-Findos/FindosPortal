import { pool } from '../../db.js';
import { transaction } from '../../repositories/entities.js';

export const reviewCurrentSql = (alias: string) =>
  `${alias}."upToDate" AND ${alias}."reviewDueAt">clock_timestamp()`;
let pending: Promise<void> | undefined;
let refreshedAt = 0;
export async function refreshKnowledgeReviews() {
  if (pending) return pending;
  if (Date.now() - refreshedAt < 60000) return;
  pending = (async () => {
    const actor = (
      await pool.query(
        `SELECT u."objectId" FROM portal.users u
         WHERE u.active AND u."archivedAt" IS NULL
           AND (lower(u.email)=lower($1) OR EXISTS (
             SELECT 1 FROM portal.user_group_memberships m
             JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL
             WHERE m.user_id=u."objectId" AND m."archivedAt" IS NULL AND g.name='Administrators'
           ))
         ORDER BY CASE WHEN lower(u.email)=lower($1) THEN 0 ELSE 1 END, u."objectId"
         LIMIT 1`,
        [process.env.ADMIN_EMAIL?.trim() || null]
      )
    ).rows[0];
    if (!actor) {
      console.warn('Knowledge review expiry skipped: no active administrator available as audit actor.');
      return;
    }
    await transaction(actor.objectId, (db) => db.query('SELECT portal.expire_knowledge_reviews()'));
  })()
    .catch((error: unknown) => {
      // Share the handled promise so concurrent reads cannot receive maintenance failures either.
      // Read queries also check the due date, so expired entries remain visibly overdue.
      console.error('Knowledge review expiry:', error instanceof Error ? error.message : error);
    })
    .finally(() => {
      refreshedAt = Date.now();
      pending = undefined;
    });
  await pending;
}
export function startKnowledgeReviewWorker() {
  const run = () =>
    void refreshKnowledgeReviews().catch((error) =>
      console.error('Knowledge review expiry:', error.message)
    );
  run();
  const timer = setInterval(run, 5 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
