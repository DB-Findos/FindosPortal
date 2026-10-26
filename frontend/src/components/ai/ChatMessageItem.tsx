import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../types/ai';
import ChangeProposalCard from './ChangeProposalCard';
export default function ChatMessageItem({
  message,
  busy,
  onCommit,
}: {
  message: ChatMessage;
  busy: boolean;
  onCommit: (message: ChatMessage, index: number) => Promise<void>;
}) {
  const duration =
    message.response_time_ms == null
      ? null
      : (message.response_time_ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  return (
    <article className={'ai-message ' + message.role}>
      <div className="ai-message-meta">
        {message.role === 'assistant' && duration !== null && (
          <strong>Antwortzeit: {duration} s</strong>
        )}
        <time dateTime={message.sent_at}>{new Date(message.sent_at).toLocaleString('de-DE')}</time>
        {message.role === 'assistant' && (
          <span>
            {message.model} · {message.reasoning_effort}
          </span>
        )}
      </div>
      <div className="ai-message-content" role={message.status === 'error' ? 'alert' : undefined}>
        {message.role === 'assistant' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: () => null,
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          <p>{message.content}</p>
        )}
      </div>
      {message.files?.map((file) => (
        <a key={file.objectId} className="ai-document" href={file.url} download>
          {file.name} · {(file.size_bytes / 1024).toFixed(0)} KB
          {file.extraction_note && <small>{file.extraction_note}</small>}
        </a>
      ))}
      {message.metadata.changes?.map((proposal, index) =>
        message.metadata.committed_indices?.includes(index) ? (
          <div key={index} className="ai-proposal">
            <strong>{proposal.title}</strong>
            <small>Übernommen</small>
          </div>
        ) : (
          <ChangeProposalCard
            key={proposal.token}
            proposal={proposal}
            busy={busy}
            onCommit={() => onCommit(message, index)}
          />
        )
      )}
    </article>
  );
}
