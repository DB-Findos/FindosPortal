import './config.js';
import { createDatabasePool } from './database/connection.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing. Run neon deploy.');
export const pool = createDatabasePool(process.env.DATABASE_URL);
pool.on('error', (error) => console.error('Database pool error:', error.message));
