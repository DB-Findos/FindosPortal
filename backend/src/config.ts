import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Works from source and compiled dist, regardless of the calling directory.
export const projectRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true });
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
export const production = process.env.NODE_ENV === 'production';
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  return secret;
}
