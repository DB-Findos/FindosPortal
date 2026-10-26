import { useMemo, useState } from 'react';
import { Bot, ChevronLeft, Send, Sparkles, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useChat } from '../../hooks/useChat';
import ChatControls from './ChatControls';
import ChatMessageItem from './ChatMessageItem';
function viewContext(path: string) {
  if (path.includes('/settings/kpis'))
    return { view: 'KPI Formula Editor & Reporting', entity: null };
  if (path.includes('/settings/data/'))
    return { view: 'Data Management', entity: path.split('/').at(-1) || null };
  if (path.includes('/settings/users')) return { view: 'User Management', entity: null };
  if (path.includes('/settings/search')) return { view: 'Advanced Search', entity: null };
  if (path.includes('/settings/design')) return { view: 'Design & Layout', entity: null };
  return { view: 'Main Page', entity: null };
}
export default function AiChatSidebar() {
  const location = useLocation(),
    [open, setOpen] = useState(false);
  const context = useMemo(
    () => ({ path: location.pathname, ...viewContext(location.pathname) }),
    [location.pathname]
  );
  const chat = useChat(open, context);
  if (!open)
    return (
      <button className="ai-chat-toggle" onClick={() => setOpen(true)} aria-label="KI-Chat öffnen">
        <Sparkles size={18} /> KI-Chat <ChevronLeft size={16} />
      </button>
    );
  return (
    <aside className="ai-chat" aria-label="KI-Chat">
      <header>
        <span>
          <Bot size={18} /> Findos KI
        </span>
        <button onClick={() => setOpen(false)} aria-label="KI-Chat schließen">
          <X size={18} />
        </button>
      </header>
      <ChatControls
        conversations={chat.conversations}
        conversationId={chat.conversation?.objectId}
        models={chat.models}
        model={chat.model}
        effort={chat.effort}
        busy={chat.busy}
        nextOffset={chat.nextOffset}
        onConversation={(id) => void chat.select(id)}
        onNew={chat.newChat}
        onModel={chat.chooseModel}
        onEffort={chat.setEffort}
        onMore={() => void chat.loadMore().catch((e) => chat.setError((e as Error).message))}
      />
      <div className="ai-chat-context">
        {context.view}
        {context.entity ? ` · ${context.entity}` : ''}
      </div>
      <div className="ai-chat-messages">
        {!chat.messages.length && (
          <p className="muted">
            Frage zu deinen Daten oder beschreibe eine gewünschte Änderung. Nachrichten und
            Dokumente werden in dieser Konversation gespeichert.
          </p>
        )}
        {chat.messages.map((message) => (
          <ChatMessageItem
            key={message.objectId}
            message={message}
            busy={chat.busy}
            onCommit={chat.commit}
          />
        ))}
        {chat.busy && (
          <article className="ai-message assistant muted" role="status">
            Wird verarbeitet …
          </article>
        )}
      </div>
      {chat.error && (
        <div className="ai-chat-error" role="alert">
          {chat.error}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void chat.send();
        }}
      >
        <textarea
          disabled={chat.busy}
          value={chat.draft}
          onChange={(e) => chat.setDraft(e.target.value)}
          maxLength={16000}
          placeholder="Nachricht …"
          rows={3}
        />
        <button
          type="submit"
          disabled={chat.busy || !chat.model || (!chat.draft.trim() && !chat.files.length)}
        >
          <Send size={16} /> Senden
        </button>
        <label className="ai-attachments">
          Dokumente anhängen · max. 5 MB je Datei
          <input
            type="file"
            disabled={chat.busy}
            multiple
            accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              if (selected.length > 10 || selected.some((f) => f.size > 5 * 1024 * 1024)) {
                chat.setError('Maximal 10 Dateien mit jeweils bis zu 5 MB.');
                e.target.value = '';
                return;
              }
              chat.setFiles(selected);
            }}
          />
        </label>
        {!!chat.files.length && (
          <small className="ai-attachments">
            {chat.files.map((f) => f.name).join(', ')}{' '}
            <button type="button" disabled={chat.busy} onClick={() => chat.setFiles([])}>
              Entfernen
            </button>
          </small>
        )}
      </form>
    </aside>
  );
}
