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
  return (
    <div className="ai-chat-controls">
      <label>
        Konversation
        <select
          disabled={busy}
          value={conversationId || ''}
          onChange={(e) => {
            if (e.target.value) onConversation(e.target.value);
          }}
        >
          <option value="">Neue Konversation</option>
          {conversationId && !conversations.some((c) => c.objectId === conversationId) && (
            <option value={conversationId}>Aktuelle Konversation</option>
          )}
          {conversations.map((c) => (
            <option key={c.objectId} value={c.objectId}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={onNew}>
        + Neuer Chat
      </button>
      {nextOffset !== null && (
        <button disabled={busy} onClick={onMore}>
          Weitere Chats laden
        </button>
      )}
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
        Reasoning-Effort
        <select disabled={busy} value={effort} onChange={(e) => onEffort(e.target.value)}>
          {models
            .find((m) => m.id === model)
            ?.efforts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
