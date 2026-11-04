import { Router } from 'express';
import { z } from 'zod';
import { chatViewContext } from '../services/chat-context.js';
import { reasoningEffort, validateChatModel } from '../services/chat-models.js';
import {
  cancelRun,
  ownRun,
  runSnapshot,
  startChatRun,
  subscribeRun,
} from '../services/ai/chat-runs.js';

export const aiRunsRouter = Router();
const runInput = z.object({
  conversation_id: z.uuid(),
  message_id: z.uuid(),
  content: z.string().trim().min(1).max(16000),
  document_ids: z.array(z.uuid()).max(10).default([]),
  model: z.string().min(1).max(100),
  reasoning_effort: reasoningEffort,
  context: chatViewContext,
});
aiRunsRouter.post('/', async (req, res) => {
  const input = runInput.parse(req.body);
  validateChatModel(input.model, input.reasoning_effort);
  res.status(202).json(runSnapshot(await startChatRun(req.userId!, input)));
});
aiRunsRouter.get('/:id', (req, res) => {
  const after = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(req.query.after || 0);
  res.json(runSnapshot(ownRun(req.userId!, z.uuid().parse(req.params.id)), after));
});
aiRunsRouter.get('/:id/events', (req, res) => {
  const run = ownRun(req.userId!, z.uuid().parse(req.params.id));
  let cursor = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(req.query.after || req.get('last-event-id') || 0);
  // Subscribe before headers so subscription errors still have a normal JSON error response.
  const unsubscribe = subscribeRun(run, () => send());
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  const send = () => {
    if (closed || res.writableEnded) return;
    const snapshot = runSnapshot(run, cursor);
    cursor = snapshot.cursor;
    res.write(`id: ${cursor}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    if (['complete', 'cancelled', 'error'].includes(snapshot.status)) {
      cleanup();
      res.end();
    }
  };
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders();
  res.write(':' + ' '.repeat(2048) + '\n\n');
  res.on('close', cleanup);
  heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, 10000);
  heartbeat.unref();
  send();
});
aiRunsRouter.post('/:id/cancel', (req, res) => {
  res.json(cancelRun(req.userId!, z.uuid().parse(req.params.id)));
});
