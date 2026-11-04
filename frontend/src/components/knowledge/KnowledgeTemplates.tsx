import { useRef, useState } from 'react';
import { FileText, Upload, Download, Trash2, LoaderCircle } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { useAuth } from '../../contexts/AuthContext';
import type { KnowledgeEntry, KnowledgeTree } from './types';
export default function KnowledgeTemplates({
  entry,
  storage,
  onChanged,
}: {
  entry: KnowledgeEntry;
  storage: KnowledgeTree['storage'];
  onChanged: (entry: KnowledgeEntry) => void;
}) {
  const { request, upload } = useApi();
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canUpload = Boolean(
    user?.permissions.knowledge_documents?.can_create &&
    user?.permissions.knowledge_entries?.can_update
  );
  const canRemove = Boolean(
    user?.permissions.knowledge_documents?.can_delete &&
    user?.permissions.knowledge_entries?.can_update
  );
  const submit = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        if (file.size > storage.maxBytes) throw Error('Vorlagen dürfen maximal 25 MB groß sein.');
        onChanged(
          await upload<KnowledgeEntry>(`/knowledge/entries/${entry.objectId}/templates`, file)
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section className="km-templates">
      <header>
        <h2>
          Vorlagen <small>{entry.documents.length}</small>
        </h2>
        {canUpload && (
          <button
            type="button"
            className="km-button"
            disabled={busy || !storage.configured}
            onClick={() => input.current?.click()}
          >
            {busy ? <LoaderCircle size={15} className="performance-spin" /> : <Upload size={15} />}
            Hochladen
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".docx,.dotx,.xlsx,.xltx,.pptx,.potx,.pdf,.doc,.xls,.ppt,.txt,.md,.csv,.zip"
          onChange={(event) => void submit(event.target.files)}
        />
      </header>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {canUpload && !storage.configured && (
        <p className="km-muted">Die SharePoint-Verbindung ist noch nicht verfügbar.</p>
      )}
      {entry.documents.map((document) => (
        <div className="km-template-file" key={document.objectId}>
          <FileText size={20} />
          <div>
            <a
              href={`/api/knowledge/entries/${entry.objectId}/templates/${document.objectId}/download`}
              download={document.name}
            >
              {document.name}
              <Download size={12} />
            </a>
            <small>
              {document.extension.toUpperCase()} ·{' '}
              {(document.size_bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })}{' '}
              KB · {new Date(document.uploaded_at).toLocaleDateString('de-DE')}
            </small>
          </div>
          {canRemove && (
            <button
              type="button"
              className="km-icon"
              disabled={busy}
              title="Vorlage entfernen"
              aria-label={`${document.name} entfernen`}
              onClick={async () => {
                if (!window.confirm('Vorlage aus diesem Eintrag entfernen?')) return;
                setBusy(true);
                setError('');
                try {
                  onChanged(
                    await request<KnowledgeEntry>(
                      `/knowledge/entries/${entry.objectId}/templates/${document.objectId}`,
                      'DELETE'
                    )
                  );
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {!entry.documents.length && <p className="km-muted">Keine Vorlagen hinterlegt.</p>}
    </section>
  );
}
