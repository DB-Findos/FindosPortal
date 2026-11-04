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
import { chatViewContext } from '../services/chat-context.js';
import type { ChatProgress } from '../services/chat-progress.js';
import { aiRunsRouter } from './ai-runs.js';

export const aiRouter = Router();
aiRouter.use(authenticate);
const chatLimiter = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
aiRouter.use('/chat', (req, res, next) =>
  req.method === 'POST' ? chatLimiter(req, res, next) : next()
);
aiRouter.use('/chat/runs', aiRunsRouter);
const chatInput = z.object({
  conversation_id: z.uuid(),
  message_id: z.uuid(),
  content: z.string().trim().min(1).max(16000),
  document_ids: z.array(z.uuid()).max(10).default([]),
  model: z.string().min(1).max(100),
  reasoning_effort: reasoningEffort,
  context: chatViewContext,
});
aiRouter.post('/chat', async (req, res) => {
  const input = chatInput.parse(req.body);
  validateChatModel(input.model, input.reasoning_effort);
  const begun = await beginMessage(req.userId!, input);
  const streaming = req.get('accept')?.includes('application/x-ndjson');
  let connected = true;
  const send = (event: unknown) => {
    if (streaming && connected && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (streaming) {
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    heartbeat = setInterval(() => send({ type: 'ping' }), 10000);
    heartbeat.unref();
    res.on('close', () => {
      connected = false;
      clearInterval(heartbeat);
    });
  }
  const progress: ChatProgress[] = [];
  try {
    if (!begun.cached) {
      try {
        const result = await runPortalChat(
          {
            userId: req.userId!,
            rights: await permissions(req.userId!),
            canCommit: false,
            conversationId: input.conversation_id,
          },
          { ...input, messages: modelHistory(begun.messages) },
          (event) => {
            progress.push(event);
            send({ type: 'progress', progress: event });
          }
        );
        await finishMessage(req.userId!, input.conversation_id, input.message_id, result.reply, {
          changes: result.changes,
          steps: result.steps,
          document_ids: result.document_ids,
          progress: result.progress,
          review: result.review,
          orchestration: result.orchestration,
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
          { progress },
          'error'
        );
      }
    }
    const detail = await readConversation(req.userId!, input.conversation_id);
    if (streaming) {
      send({ type: 'complete', detail });
      if (connected) res.end();
    } else res.json(detail);
  } catch (error) {
    if (!streaming) throw error;
    send({
      type: 'error',
      message: 'Die Chatantwort konnte nicht geladen werden. Bitte den Verlauf erneut öffnen.',
    });
    if (connected) res.end();
  } finally {
    clearInterval(heartbeat);
  }
});
aiRouter.get('/models', (_req, res) =>
  res.json({
    ...chatModels(),
    capabilities: {
      chat_revision: 3,
      view_context: true,
      answer_review: true,
      reviewer_research: true,
      planned_tasks: true,
      live_runs: true,
    },
  })
);
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
