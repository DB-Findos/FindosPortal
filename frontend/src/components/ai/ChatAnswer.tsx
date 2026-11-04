import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeAnswerMarkdown } from './answer-format';

export default function ChatAnswer({ content }: { content: string }) {
  return (
    <div className="ai-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          table: ({ children }) => (
            <div
              className="ai-answer-table"
              role="region"
              aria-label="Ergebnistabelle"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target={href?.startsWith('/api/') ? undefined : '_blank'}
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {normalizeAnswerMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
