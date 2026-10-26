import { useEffect, useRef } from 'react';
import { ArrowUp, Paperclip, FileText, X } from 'lucide-react';

export default function ChatComposer({
  draft,
  files,
  busy,
  ready,
  onDraft,
  onFiles,
  onError,
  onSend,
}: {
  draft: string;
  files: File[];
  busy: boolean;
  ready: boolean;
  onDraft: (value: string) => void;
  onFiles: (files: File[]) => void;
  onError: (error: string) => void;
  onSend: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 140) + 'px';
    }
  }, [draft]);
  const canSend = !busy && ready && (!!draft.trim() || !!files.length);
  return (
    <div className="ai-composer-wrap">
      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSend();
        }}
      >
        {!!files.length && (
          <div className="ai-file-chips">
            {files.map((file, index) => (
              <span className="ai-file-chip" key={index}>
                <FileText size={15} />
                <span>{file.name}</span>
                <button
                  type="button"
                  className="ai-icon-button"
                  disabled={busy}
                  aria-label={`${file.name} entfernen`}
                  onClick={() => onFiles(files.filter((_, i) => i !== index))}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="Nachricht"
          disabled={busy}
          value={draft}
          maxLength={16000}
          rows={1}
          placeholder="Frag Findos KI …"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <div className="ai-composer-actions">
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json"
            onChange={(e) => {
              const selected = [...files, ...Array.from(e.target.files || [])];
              e.target.value = '';
              if (selected.length > 10 || selected.some((f) => f.size > 5 * 1024 * 1024)) {
                onError('Maximal 10 Dateien mit jeweils bis zu 5 MB.');
                return;
              }
              onFiles(selected);
            }}
          />
          <button
            type="button"
            className="ai-icon-button"
            disabled={busy}
            title="Dokumente anhängen · max. 5 MB je Datei"
            aria-label="Dokumente anhängen"
            onClick={() => input.current?.click()}
          >
            <Paperclip size={19} />
          </button>
          <span>Shift + Enter für neue Zeile</span>
          <button
            type="submit"
            className="ai-send"
            disabled={!canSend}
            aria-label="Nachricht senden"
          >
            <ArrowUp size={20} />
          </button>
        </div>
      </form>
      <small className="ai-composer-note">
        Änderungsvorschläge werden erst nach deiner Bestätigung übernommen.
      </small>
    </div>
  );
}
