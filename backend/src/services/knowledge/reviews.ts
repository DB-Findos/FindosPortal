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
        'SELECT "objectId" FROM portal.users WHERE email=$1 AND active AND "archivedAt" IS NULL',
        [process.env.ADMIN_EMAIL]
      )
    ).rows[0];
    if (!actor)
      throw Error('Active ADMIN_EMAIL is required for automatic knowledge review expiry.');
    await transaction(actor.objectId, (db) => db.query('SELECT portal.expire_knowledge_reviews()'));
    refreshedAt = Date.now();
  })();
  try {
    await pending;
  } finally {
    pending = undefined;
  }
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
