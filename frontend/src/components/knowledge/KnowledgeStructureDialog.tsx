import { useState } from 'react';
import { X } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
import type { KnowledgeTree } from './types';
export default function KnowledgeStructureDialog({
  kind,
  tree,
  spaceId,
  onClose,
  onSaved,
}: {
  kind: 'space' | 'section';
  tree: KnowledgeTree;
  spaceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useApi();
  const errors = useFormErrors();
  const [name, setName] = useState('');
  const [space, setSpace] = useState(spaceId || tree.spaces[0]?.objectId || '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="km-dialog-overlay">
      <form
        className="km-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'space' ? 'Neuer Bereich' : 'Neuer Abschnitt'}
        ref={errors.formRef}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (!errors.validate(event.currentTarget)) return;
          setBusy(true);
          try {
            await request(`/knowledge/${kind === 'space' ? 'spaces' : 'sections'}`, 'POST', {
              name,
              ...(kind === 'section' ? { space_id: space } : {}),
            });
            onSaved();
          } catch (cause) {
            errors.handleError(cause);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <h2>{kind === 'space' ? 'Neuer Bereich' : 'Neuer Abschnitt'}</h2>
          <button type="button" className="km-icon" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </header>
        <label>
          Name
          <input
            autoFocus
            {...errors.inputProps('name')}
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              errors.clearField('name');
            }}
          />
          <FieldError id={errors.errorId('name')} message={errors.fieldErrors.name} />
        </label>
        {kind === 'section' && (
          <label>
            Bereich
            <select
              {...errors.inputProps('space_id')}
              value={space}
              required
              onChange={(event) => setSpace(event.target.value)}
            >
              {tree.spaces.map((item) => (
                <option key={item.objectId} value={item.objectId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {errors.error && (
          <p className="error" role="alert">
            {errors.error}
          </p>
        )}
        <button type="submit" className="km-button primary" disabled={busy}>
          Erstellen
        </button>
      </form>
    </div>
  );
}
