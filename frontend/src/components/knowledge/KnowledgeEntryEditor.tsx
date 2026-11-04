import { useState } from 'react';
import { Save, X, LoaderCircle } from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
import { useFormErrors } from '../../hooks/useFormErrors';
import FieldError from '../common/FieldError';
import RichTextEditor from './rich-text/RichTextEditor';
import { entryTypeNames, type KnowledgeEntry, type KnowledgeTree } from './types';
export default function KnowledgeEntryEditor({
  entry,
  tree,
  sectionId,
  onSaved,
  onCancel,
  onDirty,
}: {
  entry: KnowledgeEntry | null;
  tree: KnowledgeTree;
  sectionId?: string;
  onSaved: (entry: KnowledgeEntry) => void;
  onCancel: () => void;
  onDirty: () => void;
}) {
  const { request } = useApi();
  const errors = useFormErrors();
  const [title, setTitle] = useState(entry?.title || '');
  const [section, setSection] = useState(
    entry?.section_id || sectionId || tree.sections[0]?.objectId || ''
  );
  const [type, setType] = useState(entry?.type || 'reference');
  const [tags, setTags] = useState(entry?.tags.join(', ') || '');
  const [html, setHtml] = useState(entry?.content_html || '');
  const [upToDate, setUpToDate] = useState(entry?.upToDate || false);
  const [reviewCycleMonths, setReviewCycleMonths] = useState(entry?.reviewCycleMonths || 12);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="km-entry-editor"
      ref={errors.formRef}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!errors.validate(event.currentTarget)) return;
        setBusy(true);
        try {
          const data = {
            title,
            section_id: section,
            parent_id: entry?.parent_id || null,
            type,
            tags: tags
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
            content_html: html,
            upToDate,
            reviewCycleMonths,
          };
          const saved = await request<KnowledgeEntry>(
            entry ? `/knowledge/entries/${entry.objectId}` : '/knowledge/entries',
            entry ? 'PUT' : 'POST',
            data,
            entry?.id
          );
          onSaved(saved);
        } catch (cause) {
          errors.handleError(cause);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="km-editor-header">
        <div>
          <span className="eyebrow">{entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</span>
          <h1>{entry?.title || 'Eintrag erstellen'}</h1>
        </div>
        <div className="km-head-actions">
          <button type="button" className="km-button" disabled={busy} onClick={onCancel}>
            <X size={15} />
            Abbrechen
          </button>
          <button type="submit" className="km-button primary" disabled={busy || !section}>
            {busy ? <LoaderCircle size={15} className="performance-spin" /> : <Save size={15} />}
            Speichern
          </button>
        </div>
      </div>
      {errors.error && (
        <p className="error" role="alert">
          {errors.error}
        </p>
      )}
      <div className="km-edit-fields">
        <label className="km-edit-title">
          Titel
          <input
            {...errors.inputProps('title')}
            required
            maxLength={500}
            value={title}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
              errors.clearField('title');
              onDirty();
            }}
          />
          <FieldError id={errors.errorId('title')} message={errors.fieldErrors.title} />
        </label>
        <label>
          Abschnitt
          <select
            {...errors.inputProps('section_id')}
            required
            value={section}
            disabled={busy || Boolean(entry?.parent_id)}
            onChange={(event) => {
              setSection(event.target.value);
              errors.clearField('section_id');
              onDirty();
            }}
          >
            {tree.spaces.map((space) => (
              <optgroup key={space.objectId} label={space.name}>
                {tree.sections
                  .filter((item) => item.space_id === space.objectId)
                  .map((item) => (
                    <option key={item.objectId} value={item.objectId}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <FieldError id={errors.errorId('section_id')} message={errors.fieldErrors.section_id} />
        </label>
        <label>
          Typ
          <select
            {...errors.inputProps('type')}
            value={type}
            disabled={busy}
            onChange={(event) => {
              setType(event.target.value);
              onDirty();
            }}
          >
            {Object.entries(entryTypeNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tags
          <input
            {...errors.inputProps('tags')}
            value={tags}
            disabled={busy}
            onChange={(event) => {
              setTags(event.target.value);
              errors.clearField('tags');
              onDirty();
            }}
            placeholder="Mit Komma trennen"
          />
          <FieldError id={errors.errorId('tags')} message={errors.fieldErrors.tags} />
        </label>
      </div>
      <div className="km-review-fields">
        <label>
          Prüfzyklus (Monate)
          <input
            {...errors.inputProps('reviewCycleMonths')}
            type="number"
            min={1}
            max={120}
            required
            value={reviewCycleMonths}
            disabled={busy}
            onChange={(event) => {
              setReviewCycleMonths(Number(event.target.value));
              errors.clearField('reviewCycleMonths');
              onDirty();
            }}
          />
          <FieldError
            id={errors.errorId('reviewCycleMonths')}
            message={errors.fieldErrors.reviewCycleMonths}
          />
        </label>
        <label className="km-review-confirm">
          <span>
            <input
              {...errors.inputProps('upToDate')}
              type="checkbox"
              checked={upToDate}
              disabled={busy}
              onChange={(event) => {
                setUpToDate(event.target.checked);
                errors.clearField('upToDate');
                onDirty();
              }}
            />
            Inhalt geprüft und aktuell
          </span>
          <FieldError id={errors.errorId('upToDate')} message={errors.fieldErrors.upToDate} />
        </label>
      </div>
      <RichTextEditor
        html={html}
        onChange={(value) => {
          setHtml(value);
          errors.clearField('content_html');
          onDirty();
        }}
        resetKey={entry?.id || 'new'}
        disabled={busy}
        errorId={errors.fieldErrors.content_html ? errors.errorId('content_html') : undefined}
      />
      <FieldError id={errors.errorId('content_html')} message={errors.fieldErrors.content_html} />
    </form>
  );
}
