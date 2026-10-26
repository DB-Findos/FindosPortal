import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { jwtSecret, projectRoot } from '../config.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    days: { type: 'string', default: '7' },
    write: { type: 'boolean', default: false },
  },
});
try {
  if (!values.email)
    throw new Error('Usage: npm run mcp:token -- --email USER_EMAIL [--days 7] [--write]');
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('--days muss zwischen 1 und 30 liegen.');
  const user = (
    await pool.query(
      'SELECT "objectId" FROM portal.users WHERE lower(email)=lower($1) AND active=true AND "archivedAt" IS NULL',
      [values.email]
    )
  ).rows[0];
  if (!user) throw new Error('Kein aktiver Nutzer mit dieser E-Mail-Adresse.');
  const token = jwt.sign({ scopes: values.write ? ['read', 'write'] : ['read'] }, jwtSecret(), {
    algorithm: 'HS256',
    issuer: 'findos-portal',
    audience: 'findos-mcp',
    subject: user.objectId,
    jwtid: randomUUID(),
    expiresIn: days * 86400,
  });
  const folder = path.join(projectRoot, '.mcp-tokens');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${Date.now()}-${values.write ? 'read-write' : 'read'}.txt`);
  await writeFile(file, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(
    `MCP Token gespeichert: ${file}\nGültig: ${days} Tage. Zugriff: ${values.write ? 'Lesen + bestätigte Änderungen' : 'Lesen + Vorschläge'}.`
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
