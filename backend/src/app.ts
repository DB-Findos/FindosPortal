import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { projectRoot, production } from './config.js';
import { pool } from './db.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { designRouter } from './routes/design.js';
import { errorHandler } from './middleware/errors.js';
import { searchRouter } from './routes/search.js';
import { kpiRouter } from './routes/kpi.js';
import { aiRouter } from './routes/ai.js';
import { mcpRouter } from './mcp/router.js';
import { portfolioRouter } from './routes/portfolio.js';
export const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet(), express.json({ limit: '8mb' }), cookieParser());
app.use('/mcp', mcpRouter);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const allowed = [process.env.APP_ORIGIN || 'http://127.0.0.1:5173'];
    if (!production) allowed.push(`http://127.0.0.1:${process.env.PORT || 3001}`);
    if (req.get('origin') && !allowed.includes(req.get('origin')!))
      return void res.status(403).json({ error: 'Unzulässiger Ursprung.' });
    if (req.get('x-requested-with') !== 'FindosPortal')
      return void res.status(403).json({ error: 'Request header missing.' });
  }
  next();
});
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
});
app.use('/api/auth', authRouter);
app.use('/api/design', designRouter);
app.use('/api/search', searchRouter);
app.use('/api/kpi', kpiRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/ai', aiRouter);
app.use('/api', dataRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));
const dist = path.join(projectRoot, 'frontend/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);
