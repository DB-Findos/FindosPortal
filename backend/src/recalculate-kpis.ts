import './config.js';
import { pool } from './db.js';
import { runNextKpiCalculation } from './services/kpi-data/worker.js';
import { enqueueKpiCalculation } from './services/kpi-data/jobs.js';
import { transaction } from './repositories/entities.js';
try {
  if (!process.argv.includes('--pending-only')) {
    const actor = (
      await pool.query(
        'SELECT "objectId" FROM portal.users WHERE email=$1 AND active AND "archivedAt" IS NULL',
        [process.env.ADMIN_EMAIL]
      )
    ).rows[0];
    if (!actor) throw new Error('Aktiver ADMIN_EMAIL-Benutzer erforderlich.');
    await transaction(actor.objectId, (client) => enqueueKpiCalculation(client, actor.objectId));
  }
  while (await runNextKpiCalculation()) {
    /* Drain the durable queue without starting an HTTP server. */
  }
  console.log(
    JSON.stringify(
      (
        await pool.query(
          'SELECT id,status,progress,total,successful,missing,errors,message FROM portal.kpi_calculation_jobs ORDER BY requested_at DESC LIMIT 3'
        )
      ).rows,
      null,
      2
    )
  );
} finally {
  await pool.end();
}
