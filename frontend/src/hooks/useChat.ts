import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../contexts/ApiContext';
import type {
  ChatMessage,
  ChatModel,
  ChatProgress,
  Conversation,
  ConversationDetail,
} from '../types/ai';
import type { ChatViewContext } from '../types/view-context';
import { useViewContent } from '../contexts/ViewContentContext';
import { streamChat, resumeChatRun, stopChatRun } from '../services/chat-runs';

export function useChat(open: boolean, context: ChatViewContext) {
  const { request } = useApi();
  const { capture } = useViewContent();
  const [generation, setGeneration] = useState<{
    startedAt: number;
    progress: ChatProgress[];
  } | null>(null);
  const sending = useRef(false);
  const activeRun = useRef<string | null>(null);
  const transport = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const [canStop, setCanStop] = useState(false);
  useEffect(() => () => transport.current?.abort(), []);
  const [backendReady, setBackendReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null);
  const [models, setModels] = useState<ChatModel[]>([]),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState('medium');
  const [draft, setDraft] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [nextOffset, setNextOffset] = useState<number | null>(null);
  const selection = useRef(0),
    current = useRef<Conversation | null>(null),
    modelRef = useRef('');
  const apply = (detail: ConversationDetail) => {
    current.current = detail.conversation;
    setConversation(detail.conversation);
    setMessages(detail.messages);
  };
  const refreshList = useCallback(
    async (offset = 0) => {
      const result = await request<{ rows: Conversation[]; nextOffset: number | null }>(
        '/ai/conversations?offset=' + offset
      );
      setConversations((old) =>
        offset
          ? [...old, ...result.rows.filter((row) => !old.some((c) => c.objectId === row.objectId))]
          : result.rows
      );
      setNextOffset(result.nextOffset);
    },
    [request]
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      request<{
        models: ChatModel[];
        defaultModel: string;
        capabilities?: { chat_revision: number };
      }>('/ai/models'),
      refreshList(),
    ])
      .then(([config]) => {
        if (!active) return;
        const ready = (config.capabilities?.chat_revision || 0) >= 3;
        setBackendReady(ready);
        if (!ready)
          setError(
            'Das verbundene Backend verwendet noch die alte Chat-Version. Backend neu bauen und neu starten bzw. auf Render neu deployen, danach den Chat erneut öffnen.'
          );
        else setError((old) => (old.startsWith('Das verbundene Backend verwendet') ? '' : old));
        setModels(config.models);
        if (!modelRef.current) {
          modelRef.current = config.defaultModel;
          setModel(config.defaultModel);
          const choices = config.models.find((m) => m.id === config.defaultModel)?.efforts || [];
          setEffort(choices.includes('medium') ? 'medium' : choices[0] || 'none');
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [open, request, refreshList]);
  function chooseModel(id: string) {
    modelRef.current = id;
    setModel(id);
    const choices = models.find((m) => m.id === id)?.efforts || [];
    setEffort((old) =>
      choices.includes(old) ? old : choices.includes('medium') ? 'medium' : choices[0] || 'none'
    );
  }
  async function select(id: string) {
    const revision = ++selection.current;
    setError('');
    setBusy(true);
    try {
      const detail = await request<ConversationDetail>('/ai/conversations/' + id);
      if (revision !== selection.current) return;
      apply(detail);
      modelRef.current = detail.conversation.model;
      setModel(detail.conversation.model);
      setEffort(detail.conversation.reasoning_effort);
      setDraft('');
      setFiles([]);
      const pending = detail.messages.at(-1);
      if (backendReady && pending?.role === 'user') {
        transport.current = new AbortController();
        setGeneration({ startedAt: Date.parse(pending.sent_at), progress: [] });
        apply(
          await resumeChatRun(
            pending.objectId,
            (event) =>
              setGeneration(
                (old) =>
                  old && {
                    ...old,
                    progress: [...old.progress, event],
                  }
              ),
            {
              signal: transport.current.signal,
              onRun: (id) => {
                activeRun.current = id;
                setCanStop(true);
              },
            }
          )
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (revision === selection.current) {
        setBusy(false);
        setGeneration(null);
        activeRun.current = null;
        setCanStop(false);
        setStopping(false);
      }
    }
  }
  function newChat() {
    if (sending.current) return;
    selection.current++;
    current.current = null;
    setConversation(null);
    setMessages([]);
    setDraft('');
    setFiles([]);
    setError('');
  }
  async function send() {
    if (busy || sending.current || !backendReady || !model || (!draft.trim() && !files.length))
      return;
    sending.current = true;
    transport.current = new AbortController();
    setBusy(true);
    setError('');
    setGeneration({
      startedAt: Date.now(),
      progress: [
        {
          stage: 'context',
          summary: 'Aktuelle Ansicht, Filter und Diagramme aufnehmen …',
          at: new Date().toISOString(),
          elapsed_ms: 0,
        },
      ],
    });
    const content = draft.trim() || 'Bitte die angehängten Dokumente untersuchen.';
    const messageId = crypto.randomUUID();
    let id = current.current?.objectId;
    try {
      const visibleContext = { ...context, content: await capture() };
      if (!id) {
        const created = await request<Conversation>('/ai/conversations', 'POST', {
          model,
          reasoning_effort: effort,
        });
        id = created.objectId;
        current.current = created;
        setConversation(created);
      }
      const document_ids: string[] = [];
      if (files.length)
        setGeneration(
          (old) =>
            old && {
              ...old,
              progress: [
                ...old.progress,
                {
                  stage: 'context',
                  summary: 'Angehängte Dokumente hochladen …',
                  at: new Date().toISOString(),
                  elapsed_ms: Date.now() - old.startedAt,
                },
              ],
            }
        );
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw Error('Dateien dürfen maximal 5 MB groß sein.');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(Error('Datei konnte nicht gelesen werden.'));
          reader.readAsDataURL(file);
        });
        const saved = await request<{ objectId: string }>(
          '/ai/conversations/' + id + '/documents',
          'POST',
          { name: file.name, data_base64: data }
        );
        document_ids.push(saved.objectId);
      }
      setMessages((old) => [
        ...old,
        {
          objectId: messageId,
          role: 'user',
          content,
          sent_at: new Date().toISOString(),
          reply_to_id: null,
          response_time_ms: null,
          model,
          reasoning_effort: effort,
          status: 'complete',
          files: [],
          metadata: {},
        },
      ]);
      setDraft('');
      setFiles([]);
      apply(
        await streamChat(
          {
            conversation_id: id,
            message_id: messageId,
            content,
            document_ids,
            model,
            reasoning_effort: effort,
            context: visibleContext,
          },
          (event) =>
            setGeneration(
              (old) =>
                old && {
                  ...old,
                  progress: [
                    ...old.progress,
                    {
                      ...event,
                      elapsed_ms: event.elapsed_ms,
                    },
                  ],
                }
            ),
          {
            signal: transport.current.signal,
            onRun: (id) => {
              activeRun.current = id;
              setCanStop(true);
            },
          }
        )
      );
      setGeneration(null);
      await refreshList();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setDraft(content);
        setFiles(files);
      } else setError((e as Error).message);
      if (id)
        try {
          apply(await request<ConversationDetail>('/ai/conversations/' + id));
        } catch {
          /* Keep visible local state if offline. */
        }
    } finally {
      sending.current = false;
      activeRun.current = null;
      setCanStop(false);
      setStopping(false);
      setGeneration(null);
      setBusy(false);
    }
  }
  async function stop() {
    if (!activeRun.current || stopping) return;
    setStopping(true);
    try {
      await stopChatRun(activeRun.current);
    } catch (error) {
      setError((error as Error).message);
      setStopping(false);
    }
  }
  async function commit(message: ChatMessage, index: number) {
    setBusy(true);
    setError('');
    try {
      await request('/ai/changes/commit', 'POST', {
        message_id: message.objectId,
        proposal_index: index,
      });
      if (current.current)
        apply(await request<ConversationDetail>('/ai/conversations/' + current.current.objectId));
      window.dispatchEvent(new CustomEvent('portal-data-changed'));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return {
    conversations,
    messages,
    conversation,
    models,
    model,
    effort,
    setEffort,
    chooseModel,
    draft,
    setDraft,
    files,
    setFiles,
    busy,
    generation,
    backendReady,
    stopping,
    canStop,
    stop,
    error,
    setError,
    select,
    newChat,
    send,
    commit,
    nextOffset,
    loadMore: () => refreshList(nextOffset || 0),
  };
}
