import { useState } from 'react';
import { ChevronDown, History, Plus, MessageSquare, Search, SlidersHorizontal } from 'lucide-react';
import type { ChatModel, Conversation } from '../../types/ai';
export default function ChatControls({
  conversations,
  conversationId,
  models,
  model,
  effort,
  busy,
  nextOffset,
  onConversation,
  onNew,
  onModel,
  onEffort,
  onMore,
}: {
  conversations: Conversation[];
  conversationId?: string;
  models: ChatModel[];
  model: string;
  effort: string;
  busy: boolean;
  nextOffset: number | null;
  onConversation: (id: string) => void;
  onNew: () => void;
  onModel: (id: string) => void;
  onEffort: (effort: string) => void;
  onMore: () => void;
}) {
  const [panel, setPanel] = useState<'history' | 'settings' | null>(null);
  const [search, setSearch] = useState('');
  const labels: Record<string, string> = {
    none: 'Ohne',
    minimal: 'Minimal',
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
    xhigh: 'Sehr hoch',
  };
  return (
    <div
      className="ai-controls"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPanel(null);
      }}
    >
      <div className="ai-toolbar">
        <button
          className="ai-model-trigger"
          aria-expanded={panel === 'settings'}
          onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
        >
          {models.find((m) => m.id === model)?.label || 'Modell wählen'} <ChevronDown size={14} />
        </button>
        <div className="ai-toolbar-actions">
          <button
            className="ai-icon-button"
            title="Chatverlauf"
            aria-label="Chatverlauf"
            aria-expanded={panel === 'history'}
            onClick={() => setPanel(panel === 'history' ? null : 'history')}
          >
            <History size={17} />
          </button>
          <button
            className="ai-icon-button"
            title="Einstellungen"
            aria-label="Chat-Einstellungen"
            aria-expanded={panel === 'settings'}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            <SlidersHorizontal size={17} />
          </button>
          <button
            className="ai-icon-button"
            disabled={busy}
            title="Neuer Chat"
            aria-label="Neuer Chat"
            onClick={() => {
              onNew();
              setPanel(null);
            }}
          >
            <Plus size={19} />
          </button>
        </div>
      </div>
      {panel === 'settings' && (
        <div className="ai-controls-panel">
          <div className="ai-panel-heading">Chat-Einstellungen</div>
          <label>
            Modell
            <select disabled={busy} value={model} onChange={(e) => onModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning · Denktiefe
            <select disabled={busy} value={effort} onChange={(e) => onEffort(e.target.value)}>
              {models
                .find((m) => m.id === model)
                ?.efforts.map((v) => (
                  <option key={v} value={v}>
                    {labels[v] || v}
                  </option>
                ))}
            </select>
          </label>
          <small>
            Mehr Denktiefe kann bei komplexen Formeln helfen und die Antwortzeit verlängern.
          </small>
        </div>
      )}
      {panel === 'history' && (
        <div className="ai-controls-panel ai-history">
          <div className="ai-panel-heading">Deine Chats</div>
          <div className="ai-history-search">
            <Search size={16} />
            <input
              aria-label="Chats durchsuchen"
              placeholder="Chats durchsuchen …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {conversations
            .filter((c) => c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
            .map((c) => (
              <button
                key={c.objectId}
                className={'ai-history-item' + (conversationId === c.objectId ? ' active' : '')}
                disabled={busy}
                onClick={() => {
                  onConversation(c.objectId);
                  setPanel(null);
                }}
              >
                <MessageSquare size={16} />
                <span>{c.title}</span>
              </button>
            ))}
          {!conversations.length && <small>Noch keine gespeicherten Chats.</small>}
          {nextOffset !== null && (
            <button className="ai-history-item" disabled={busy} onClick={onMore}>
              Weitere Chats laden
            </button>
          )}
        </div>
      )}
    </div>
  );
}
