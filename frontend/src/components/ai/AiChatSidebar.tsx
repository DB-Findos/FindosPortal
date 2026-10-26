import { useMemo, useState } from 'react';
import { Bot, ChevronLeft, Send, Sparkles, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useApi } from '../../contexts/ApiContext';
import type { FormulaDraft } from '../../types/kpi';
import type { ChangeProposal } from '../../types/ai';
import ChangeProposalCard from './ChangeProposalCard';

type FormulaProposal = FormulaDraft & { explanation?: string };
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  proposals?: FormulaProposal[];
  changes?: ChangeProposal[];
  steps?: string[];
};

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
  const { request } = useApi();
  const location = useLocation();
  const context = useMemo(() => viewContext(location.pathname), [location.pathname]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Ich kann Daten und Beziehungen untersuchen, Kennzahlen berechnen und Änderungen vorbereiten. Beschreibe deine Frage oder die gewünschte Änderung.',
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      const result = await request<{
        reply: string;
        proposals: FormulaProposal[];
        changes: ChangeProposal[];
        steps: string[];
      }>('/ai/chat', 'POST', {
        messages: next.slice(-12).map(({ role, content }) => ({ role, content })),
        context: { path: location.pathname, ...context },
      });
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.reply,
          proposals: result.proposals,
          changes: result.changes,
          steps: result.steps,
        },
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die KI-Antwort ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }
  async function commitProposal(proposal: ChangeProposal) {
    setBusy(true);
    setError('');
    try {
      await request('/ai/changes/commit', 'POST', { token: proposal.token });
      window.dispatchEvent(
        new CustomEvent('portal-data-changed', { detail: { entity: proposal.entity } })
      );
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: `Übernommen: ${proposal.title}` },
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Die Änderung konnte nicht übernommen werden.'
      );
      throw reason;
    } finally {
      setBusy(false);
    }
  }
  async function commit(formula: FormulaProposal) {
    setBusy(true);
    setError('');
    try {
      const { explanation: _explanation, ...payload } = formula;
      await request('/ai/formulas/commit', 'POST', payload);
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `Die KPI „${formula.name}“ wurde erstellt und ist sofort im KPI-Bereich verfügbar.`,
        },
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Die Formel konnte nicht erstellt werden.'
      );
    } finally {
      setBusy(false);
    }
  }

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
      <div className="ai-chat-context">
        {context.view}
        {context.entity ? ` · ${context.entity}` : ''}
      </div>
      <div className="ai-chat-messages">
        {messages.map((message, index) => (
          <article key={index} className={'ai-message ' + message.role}>
            <p>{message.content}</p>
            {!!message.steps?.length && (
              <small>{message.steps.length} Daten- und Validierungsschritte ausgeführt</small>
            )}
            {message.changes?.map((proposal) => (
              <ChangeProposalCard
                key={proposal.token}
                proposal={proposal}
                busy={busy}
                onCommit={commitProposal}
              />
            ))}
            {message.proposals?.map((proposal, proposalIndex) => (
              <div className="ai-proposal" key={proposalIndex}>
                <strong>Formelvorschlag: {proposal.name}</strong>
                <code>{proposal.TextEditor}</code>
                {proposal.explanation && <small>{proposal.explanation}</small>}
                <button disabled={busy} onClick={() => void commit(proposal)}>
                  Formel übernehmen
                </button>
              </div>
            ))}
          </article>
        ))}
        {busy && <article className="ai-message assistant muted">KI denkt nach …</article>}
      </div>
      {error && <div className="ai-chat-error">{error}</div>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Frage zum Datenmodell oder beschreibe eine KPI …"
          rows={3}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          <Send size={16} /> Senden
        </button>
      </form>
    </aside>
  );
}
