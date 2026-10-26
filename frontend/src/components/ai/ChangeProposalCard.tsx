import { useState } from 'react';
import type { ChangeProposal } from '../../types/ai';

export default function ChangeProposalCard({
  proposal,
  busy,
  onCommit,
}: {
  proposal: ChangeProposal;
  busy: boolean;
  onCommit: (proposal: ChangeProposal) => Promise<void>;
}) {
  const [committed, setCommitted] = useState(false);
  const operations = { create: 'Neu erstellen', update: 'Ändern', archive: 'Archivieren' };
  const formula = proposal.preview.TextDisplay;
  const description = proposal.preview.description;
  return (
    <div className="ai-proposal">
      <strong>{proposal.title}</strong>
      <small>{operations[proposal.operation]}</small>
      {typeof description === 'string' && <p>{description}</p>}
      {typeof formula === 'string' && <code>{formula}</code>}
      <details>
        <summary>Änderungen ansehen</summary>
        <pre>{JSON.stringify(proposal.preview, null, 2)}</pre>
      </details>
      <button
        disabled={busy || committed}
        onClick={async () => {
          try {
            await onCommit(proposal);
            setCommitted(true);
          } catch {
            /* Parent displays the error; allow retry. */
          }
        }}
      >
        {committed
          ? 'Übernommen'
          : proposal.operation === 'archive'
            ? 'Archivierung bestätigen'
            : 'Änderung übernehmen'}
      </button>
    </div>
  );
}
