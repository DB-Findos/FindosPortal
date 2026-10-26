import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateMcp } from './auth.js';
import { createMcpServer } from './server.js';
import { permissions } from '../middleware/auth.js';

export const mcpRouter = Router();
mcpRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const allowed = (process.env.MCP_ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (req.get('origin') && !allowed.includes(req.get('origin')!))
    return void res.status(403).json({ error: 'Unzulässiger MCP-Ursprung.' });
  next();
});
mcpRouter.use(
  rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false })
);
mcpRouter.use(authenticateMcp);
mcpRouter.post('/', async (req, res) => {
  const server = createMcpServer({
    userId: req.userId!,
    rights: await permissions(req.userId!),
    canCommit: Boolean(req.mcpWrite),
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
mcpRouter.all('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res
    .status(405)
    .json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Stateless MCP: use POST.' },
      id: null,
    });
});
