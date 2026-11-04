import { beginMessage, finishMessage, modelHistory } from '../chat-history.js';
import { permissions } from '../../middleware/auth.js';
import { runPortalChat } from '../ai-chat.js';
import { httpError } from '../../shared/errors.js';
import type { ChatProgress } from '../chat-progress.js';
import type { ChatInput } from './orchestration/types.js';

export type RunInput = Omit<ChatInput, 'messages'> & {
  conversation_id: string;
  message_id: string;
  content: string;
  document_ids: string[];
  model: string;
  reasoning_effort: string;
};
type RunEvent = { sequence: number; progress: ChatProgress };
type ChatRun = {
  id: string;
  owner: string;
  conversationId: string;
  startedAt: string;
  status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  events: RunEvent[];
  controller: AbortController;
  listeners: Set<() => void>;
  finishedAt?: number;
};
const runs = new Map<string, ChatRun>();
const terminal = (run: ChatRun) => ['complete', 'error', 'cancelled'].includes(run.status);

export function ownRun(userId: string, id: string) {
  const run = runs.get(id);
  if (!run || run.owner !== userId)
    throw httpError(
      404,
      'Die laufende Bearbeitung ist auf diesem Server nicht mehr verfügbar. Ein Neustart kann sie unterbrochen haben; gespeicherte Nachrichten bleiben im Verlauf.'
    );
  return run;
}
export function runSnapshot(run: ChatRun, after = 0) {
  return {
    run_id: run.id,
    conversation_id: run.conversationId,
    started_at: run.startedAt,
    status: run.status,
    cursor: run.events.length,
    events: run.events.slice(after),
  };
}
function publish(run: ChatRun, progress?: ChatProgress) {
  if (progress) run.events.push({ sequence: run.events.length + 1, progress });
  for (const listener of run.listeners) {
    try {
      listener();
    } catch {
      run.listeners.delete(listener);
    }
  }
}
export async function startChatRun(userId: string, input: RunInput) {
  const existing = runs.get(input.message_id);
  if (existing) {
    const run = ownRun(userId, input.message_id);
    if (run.conversationId !== input.conversation_id)
      throw httpError(409, 'Die Nachricht gehört zu einer anderen Konversation.');
    return run;
  }
  for (const [id, run] of runs)
    if (run.finishedAt && Date.now() - run.finishedAt > 15 * 60000) runs.delete(id);
  if (
    [...runs.values()].some(
      (run) =>
        run.owner === userId && run.conversationId === input.conversation_id && !terminal(run)
    )
  )
    throw httpError(409, 'In dieser Konversation wird bereits eine Antwort erzeugt.');
  if ([...runs.values()].filter((run) => run.owner === userId && !terminal(run)).length >= 2)
    throw httpError(
      429,
      'Es laufen bereits zwei Bearbeitungen. Bitte eine abschließen oder abbrechen.'
    );
  if (runs.size >= 64) {
    const removable = [...runs.values()]
      .filter(terminal)
      .sort((a, b) => a.finishedAt! - b.finishedAt!)[0];
    if (removable) runs.delete(removable.id);
    else throw httpError(503, 'Die Chat-Bearbeitung ist aktuell ausgelastet. Bitte kurz warten.');
  }
  const begun = await beginMessage(userId, input);
  const question = begun.messages.find((message) => message.objectId === input.message_id);
  const run: ChatRun = {
    id: input.message_id,
    owner: userId,
    conversationId: input.conversation_id,
    startedAt: new Date(question?.sent_at || Date.now()).toISOString(),
    status: begun.cached ? 'complete' : 'queued',
    events: [],
    controller: new AbortController(),
    listeners: new Set(),
  };
  runs.set(run.id, run);
  if (begun.cached) {
    for (const event of begun.cached.metadata?.progress || []) publish(run, event);
    run.finishedAt = Date.now();
    return run;
  }
  // Accept first; generation does not keep the POST request open or depend on its connection.
  setImmediate(() => {
    void (async () => {
      run.status = 'running';
      publish(run);
      try {
        const result = await runPortalChat(
          {
            userId,
            rights: await permissions(userId),
            canCommit: false,
            conversationId: input.conversation_id,
          },
          { ...input, messages: modelHistory(begun.messages) },
          (event) => publish(run, event),
          run.controller.signal
        );
        await finishMessage(userId, input.conversation_id, input.message_id, result.reply, {
          changes: result.changes,
          steps: result.steps,
          document_ids: result.document_ids,
          progress: result.progress,
          review: result.review,
          orchestration: result.orchestration,
        });
        run.status = result.review.status === 'cancelled' ? 'cancelled' : 'complete';
      } catch (error) {
        console.error('Chat run failed', {
          id: run.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
        publish(run, {
          stage: 'warning',
          status: 'failed',
          summary: 'Die Bearbeitung ist technisch fehlgeschlagen.',
          at: new Date().toISOString(),
          elapsed_ms: Date.now() - Date.parse(run.startedAt),
        });
        try {
          await finishMessage(
            userId,
            input.conversation_id,
            input.message_id,
            'Die Bearbeitung ist technisch fehlgeschlagen. Bitte erneut versuchen. Dies ist keine Aussage über fehlende Daten.',
            { progress: run.events.map((event) => event.progress) },
            'error'
          );
        } catch (saveError) {
          console.error(
            'Chat run persistence failed',
            saveError instanceof Error ? saveError.name : 'unknown'
          );
        }
        run.status = 'error';
      } finally {
        run.finishedAt = Date.now();
        publish(run);
      }
    })();
  });
  return run;
}
export function subscribeRun(run: ChatRun, listener: () => void) {
  if (run.listeners.size >= 6)
    throw httpError(429, 'Für diese Bearbeitung sind bereits mehrere Live-Verbindungen geöffnet.');
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}
export function cancelRun(userId: string, id: string) {
  const run = ownRun(userId, id);
  if (!terminal(run) && !run.controller.signal.aborted) {
    run.controller.abort();
    publish(run, {
      stage: 'warning',
      status: 'info',
      summary: 'Abbruch angefordert; laufenden Schritt beenden und Ergebnisse sichern.',
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - Date.parse(run.startedAt),
    });
  }
  return runSnapshot(run);
}
