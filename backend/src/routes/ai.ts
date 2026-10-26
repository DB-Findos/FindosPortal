import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { authenticate, permissions } from '../middleware/auth.js';
import { runPortalChat } from '../services/ai-chat.js';
import { commitChange } from '../mcp/changes.js';
import { transaction } from '../repositories/entities.js';
import { formulaInput } from '../services/kpi-schema.js';
import { saveFormula } from '../services/kpi-definitions.js';

export const aiRouter = Router();
aiRouter.use(authenticate);
aiRouter.use(
  rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })
);
const chatInput = z.object({
  messages: z
    .array(
      z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000) })
    )
    .min(1)
    .max(16),
  context: z.object({
    path: z.string().max(500),
    view: z.string().max(200),
    entity: z.string().max(100).nullable(),
  }),
});
aiRouter.post('/chat', async (req, res) => {
  const input = chatInput.parse(req.body);
  res.json(
    await runPortalChat(
      { userId: req.userId!, rights: await permissions(req.userId!), canCommit: false },
      input
    )
  );
});
aiRouter.post('/changes/commit', async (req, res) => {
  const { token } = z
    .object({ token: z.string().min(1).max(100000) })
    .strict()
    .parse(req.body);
  res.json(
    await commitChange(
      { userId: req.userId!, rights: await permissions(req.userId!), canCommit: true },
      token
    )
  );
});
// Compatibility for already displayed formula cards from before the MCP upgrade.
aiRouter.post('/formulas/commit', async (req, res) => {
  const { explanation: _, ...formula } = formulaInput
    .extend({ explanation: z.string().optional() })
    .parse(req.body);
  const rights = await permissions(req.userId!);
  res.status(201).json(await transaction(req.userId!, (db) => saveFormula(db, formula, rights)));
});
