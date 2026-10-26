import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Sparkles, X, Maximize2, Minimize2, PanelRight } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useChat } from '../../hooks/useChat';
import ChatControls from './ChatControls';
import ChatMessageItem from './ChatMessageItem';
import ChatComposer from './ChatComposer';
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
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const context = useMemo(
    () => ({ path: location.pathname, ...viewContext(location.pathname) }),
    [location.pathname]
  );
  const chat = useChat(open, context);
  useEffect(() => {
    nearBottom.current = true;
  }, [chat.conversation?.objectId, open]);
  useEffect(() => {
    if (scroll.current && nearBottom.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [chat.messages, chat.busy, open]);
  if (!open)
    return (
      <button className="ai-chat-toggle" onClick={() => setOpen(true)} aria-label="KI-Chat öffnen">
        <Sparkles size={18} /> KI-Chat <ChevronLeft size={16} />
      </button>
    );
  return (
    <aside className={'ai-chat' + (expanded ? ' ai-chat-expanded' : '')} aria-label="KI-Chat">
      <header className="ai-chat-header">
        <div className="ai-chat-brand">
          <div className="ai-brand-icon">
            <Sparkles size={19} />
          </div>
          <div>
            <strong>Findos KI</strong>
            <small>Dein Assistent im Portal</small>
          </div>
        </div>
        <div className="ai-toolbar-actions">
          <button
            className="ai-icon-button ai-expand"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Chat verkleinern' : 'Chat vergrößern'}
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            className="ai-icon-button"
            onClick={() => setOpen(false)}
            aria-label="KI-Chat schließen"
          >
            <X size={19} />
          </button>
        </div>
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
        <PanelRight size={13} />
        <span>
          {context.view}
          {context.entity ? ' · ' + context.entity : ''}
        </span>
      </div>
      <div
        className="ai-chat-messages"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {!chat.messages.length && !chat.busy && (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">
              <Sparkles size={27} />
            </div>
            <h2>Was möchtest du wissen?</h2>
            <p>Entdecke deine Daten, verstehe Kennzahlen und entwickle neue KPI-Formeln.</p>
            <div className="ai-starters">
              {[
                'Erkläre mir das Datenmodell',
                'Hilf mir, eine KPI-Formel zu erstellen',
                'Welche Kennzahlen stehen zur Verfügung?',
              ].map((text) => (
                <button key={text} onClick={() => chat.setDraft(text)}>
                  {text}
                  <ChevronLeft size={15} />
                </button>
              ))}
            </div>
          </div>
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
          <div className="ai-thinking" role="status">
            <Sparkles size={16} />
            <span>Wird verarbeitet</span>
            <span className="ai-thinking-dots">•••</span>
          </div>
        )}
      </div>
      {chat.error && (
        <div className="ai-chat-error" role="alert">
          {chat.error}
        </div>
      )}
      <ChatComposer
        draft={chat.draft}
        files={chat.files}
        busy={chat.busy}
        ready={!!chat.model}
        onDraft={chat.setDraft}
        onFiles={chat.setFiles}
        onError={chat.setError}
        onSend={() => {
          nearBottom.current = true;
          void chat.send();
        }}
      />
    </aside>
  );
}
