import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { authenticate, permissions } from '../middleware/auth.js';
import { runPortalChat } from '../services/ai-chat.js';
import { commitChange } from '../mcp/changes.js';
import { transaction } from '../repositories/entities.js';
import { formulaInput } from '../services/kpi-schema.js';
import { saveFormula } from '../services/kpi-definitions.js';
import { chatModels, validateChatModel, reasoningEffort } from '../services/chat-models.js';
import {
  beginMessage,
  createConversation,
  finishMessage,
  listConversations,
  modelHistory,
  readConversation,
  commitStoredChange,
} from '../services/chat-history.js';
import { ownDocument, saveDocument } from '../services/chat-documents.js';

export const aiRouter = Router();
aiRouter.use(authenticate);
aiRouter.use(
  '/chat',
  rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })
);
const chatInput = z.object({
  conversation_id: z.uuid(),
  message_id: z.uuid(),
  content: z.string().trim().min(1).max(16000),
  document_ids: z.array(z.uuid()).max(10).default([]),
  model: z.string().min(1).max(100),
  reasoning_effort: reasoningEffort,
  context: z.object({
    path: z.string().max(500),
    view: z.string().max(200),
    entity: z.string().max(100).nullable(),
  }),
});
aiRouter.post('/chat', async (req, res) => {
  const input = chatInput.parse(req.body);
  validateChatModel(input.model, input.reasoning_effort);
  const begun = await beginMessage(req.userId!, input);
  if (!begun.cached) {
    try {
      const result = await runPortalChat(
        {
          userId: req.userId!,
          rights: await permissions(req.userId!),
          canCommit: false,
          conversationId: input.conversation_id,
        },
        { ...input, messages: modelHistory(begun.messages) }
      );
      await finishMessage(req.userId!, input.conversation_id, input.message_id, result.reply, {
        changes: result.changes,
        steps: result.steps,
        document_ids: result.document_ids,
      });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      await finishMessage(
        req.userId!,
        input.conversation_id,
        input.message_id,
        e.status && e.status < 600
          ? e.message || 'KI-Anfrage fehlgeschlagen.'
          : 'KI-Anfrage fehlgeschlagen. Bitte erneut versuchen.',
        {},
        'error'
      );
    }
  }
  res.json(await readConversation(req.userId!, input.conversation_id));
});
aiRouter.get('/models', (_req, res) => res.json(chatModels()));
aiRouter.get('/conversations', async (req, res) =>
  res.json(
    await listConversations(
      req.userId!,
      z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(req.query.offset || 0)
    )
  )
);
aiRouter.post('/conversations', async (req, res) => {
  const input = z
    .object({ model: z.string(), reasoning_effort: reasoningEffort })
    .strict()
    .parse(req.body);
  validateChatModel(input.model, input.reasoning_effort);
  res.status(201).json(await createConversation(req.userId!, input.model, input.reasoning_effort));
});
aiRouter.get('/conversations/:id', async (req, res) =>
  res.json(await readConversation(req.userId!, z.uuid().parse(req.params.id)))
);
aiRouter.post('/conversations/:id/documents', async (req, res) =>
  res.status(201).json(await saveDocument(req.userId!, z.uuid().parse(req.params.id), req.body))
);
aiRouter.get('/documents/:id/content', async (req, res) => {
  const file = await ownDocument(req.userId!, z.uuid().parse(req.params.id));
  res.attachment(file.name).type(file.mime_type).send(Buffer.from(file.data_base64, 'base64'));
});
aiRouter.post('/changes/commit', async (req, res) => {
  if (req.body.message_id) {
    const input = z
      .object({ message_id: z.uuid(), proposal_index: z.number().int().min(0).max(99) })
      .strict()
      .parse(req.body);
    return void res.json(
      await commitStoredChange(
        { userId: req.userId!, rights: await permissions(req.userId!), canCommit: true },
        input.message_id,
        input.proposal_index
      )
    );
  }
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
