import '../config.js';
import { writeFile } from 'node:fs/promises';
import { pool } from '../db.js';
const counts: Record<string, number> = {};
try {
  for (const entity of ['funds', 'companies', 'metrics', 'index_rates', 'metric_data'])
    counts[entity] = (
      await pool.query(`SELECT count(*)::int AS n FROM portal.${entity} WHERE "archivedAt" IS NULL`)
    ).rows[0].n;
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(counts, null, 2));
  console.log(JSON.stringify(counts));
} finally {
  await pool.end();
}
