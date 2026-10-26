import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { projectRoot } from './config.js';
const file = path.join(projectRoot, '.env.local');
const content = await readFile(file, 'utf8').catch(() => '');
const values = {
  JWT_SECRET: randomBytes(48).toString('base64url'),
  ADMIN_EMAIL: 'admin@findos.local',
  ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
  APP_ORIGIN: 'http://127.0.0.1:5173',
};
const missing = Object.entries(values).filter(
  ([key]) => !new RegExp('^' + key + '=', 'm').test(content)
);
if (missing.length)
  await appendFile(file, '\n' + missing.map(([key, value]) => key + '=' + value).join('\n') + '\n');
console.log('Local app configuration ready; administrator credentials are in .env.local.');
