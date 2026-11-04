import { ApiError } from '../contexts/ApiContext';
import type { ChatProgress, ChatRunSnapshot, ConversationDetail } from '../types/ai';

async function jsonRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch('/api/ai' + path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FindosPortal' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(
      response.status,
      data.error || 'Chat-Anfrage fehlgeschlagen.',
      data.fieldErrors || {}
    );
  }
  return data;
}
type RunOptions = { signal?: AbortSignal; onRun?: (id: string) => void };
export async function streamChat(
  body: unknown,
  onProgress: (progress: ChatProgress) => void,
  options: RunOptions = {}
) {
  const initial = await jsonRequest<ChatRunSnapshot>('/chat/runs', 'POST', body, options.signal);
  options.onRun?.(initial.run_id);
  return observeRun(initial, onProgress, options.signal);
}
export async function resumeChatRun(
  id: string,
  onProgress: (progress: ChatProgress) => void,
  options: RunOptions = {}
) {
  const initial = await jsonRequest<ChatRunSnapshot>(
    '/chat/runs/' + id,
    'GET',
    undefined,
    options.signal
  );
  options.onRun?.(initial.run_id);
  return observeRun(initial, onProgress, options.signal);
}
export function stopChatRun(id: string) {
  return jsonRequest<ChatRunSnapshot>('/chat/runs/' + id + '/cancel', 'POST');
}

/** SSE gives low latency; independent short polling guarantees updates even behind buffering proxies. */
function observeRun(
  initial: ChatRunSnapshot,
  onProgress: (progress: ChatProgress) => void,
  signal?: AbortSignal
): Promise<ConversationDetail> {
  return new Promise((resolve, reject) => {
    let cursor = 0;
    let closed = false;
    let finishing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let events: EventSource | undefined;
    let failures = 0;
    const lifetime = new AbortController();
    const cleanup = () => {
      closed = true;
      clearTimeout(timer);
      events?.close();
      lifetime.abort();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (!closed) {
        cleanup();
        reject(error);
      }
    };
    const abort = () =>
      fail(
        new DOMException(
          'Live-Anzeige wurde beendet; die serverseitige Bearbeitung bleibt im Verlauf.',
          'AbortError'
        )
      );
    const receive = (snapshot: ChatRunSnapshot) => {
      if (closed || snapshot.run_id !== initial.run_id) return;
      for (const event of snapshot.events)
        if (event.sequence > cursor) {
          cursor = event.sequence;
          onProgress(event.progress);
        }
      if (['complete', 'error', 'cancelled'].includes(snapshot.status) && !finishing) {
        finishing = true;
        clearTimeout(timer);
        events?.close();
        void jsonRequest<ConversationDetail>(
          '/conversations/' + initial.conversation_id,
          'GET',
          undefined,
          lifetime.signal
        )
          .then((detail) => {
            if (!closed) {
              cleanup();
              resolve(detail);
            }
          })
          .catch(fail);
      }
    };
    const poll = async () => {
      if (closed || finishing) return;
      try {
        const requestSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]);
        receive(
          await jsonRequest<ChatRunSnapshot>(
            '/chat/runs/' + initial.run_id + '?after=' + cursor,
            'GET',
            undefined,
            requestSignal
          )
        );
        failures = 0;
      } catch (error) {
        if (closed || finishing) return;
        if (
          (error instanceof ApiError && [401, 403, 404].includes(error.status)) ||
          ++failures >= 6
        ) {
          fail(error);
          return;
        }
      }
      if (!closed && !finishing) timer = setTimeout(() => void poll(), 1500);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    receive(initial);
    if (!closed && !finishing) {
      if (typeof EventSource !== 'undefined') {
        events = new EventSource('/api/ai/chat/runs/' + initial.run_id + '/events?after=' + cursor);
        events.onmessage = (event) => {
          try {
            receive(JSON.parse(event.data) as ChatRunSnapshot);
          } catch {
            events?.close(); /* Short polling remains independent of SSE. */
          }
        };
        events.onerror = () => events?.close();
      }
      void poll();
    }
  });
}
