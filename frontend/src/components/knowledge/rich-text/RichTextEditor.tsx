import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link2,
  Unlink,
  Table2,
  Undo2,
  Redo2,
  RemoveFormatting,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { escapeEditorText, safeEditorLink, sanitizeEditorHtml } from './sanitize';
import './RichTextEditor.css';
export default function RichTextEditor({
  html,
  onChange,
  disabled = false,
  resetKey,
  errorId,
}: {
  html: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  resetKey: string;
  errorId?: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [popover, setPopover] = useState<'link' | 'table' | null>(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [words, setWords] = useState(0);
  const update = () => {
    if (!editor.current) return;
    onChange(editor.current.innerHTML);
    setWords((editor.current.innerText.trim().match(/\S+/g) || []).length);
  };
  const remember = () => {
    const current = window.getSelection();
    if (
      current?.rangeCount &&
      editor.current?.contains(current.anchorNode) &&
      editor.current.contains(current.focusNode)
    )
      selection.current = current.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    editor.current?.focus();
    const current = window.getSelection();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      current?.removeAllRanges();
      current?.addRange(selection.current);
    } else if (editor.current) {
      const range = document.createRange();
      range.selectNodeContents(editor.current);
      range.collapse(false);
      current?.removeAllRanges();
      current?.addRange(range);
    }
  };
  const command = (name: string, value?: string) => {
    if (disabled) return;
    restore();
    document.execCommand(name, false, value);
    remember();
    update();
  };
  useLayoutEffect(() => {
    if (editor.current) {
      editor.current.innerHTML = sanitizeEditorHtml(html);
      setWords((editor.current.innerText.trim().match(/\S+/g) || []).length);
    }
    selection.current = null;
  }, [resetKey]);
  useEffect(() => {
    const changed = () => {
      const current = window.getSelection();
      if (!editor.current?.contains(current?.anchorNode || null)) return;
      remember();
      setActive(
        Object.fromEntries(
          [
            'bold',
            'italic',
            'underline',
            'strikeThrough',
            'insertUnorderedList',
            'insertOrderedList',
          ].map((name) => [name, document.queryCommandState(name)])
        )
      );
    };
    document.addEventListener('selectionchange', changed);
    return () => document.removeEventListener('selectionchange', changed);
  }, []);
  const tools = [
    ['bold', 'Fett', Bold],
    ['italic', 'Kursiv', Italic],
    ['underline', 'Unterstrichen', Underline],
    ['strikeThrough', 'Durchgestrichen', Strikethrough],
    ['insertUnorderedList', 'Aufzählung', List],
    ['insertOrderedList', 'Nummerierte Liste', ListOrdered],
    ['justifyLeft', 'Linksbündig', AlignLeft],
    ['justifyCenter', 'Zentriert', AlignCenter],
    ['justifyRight', 'Rechtsbündig', AlignRight],
    ['undo', 'Rückgängig', Undo2],
    ['redo', 'Wiederholen', Redo2],
    ['removeFormat', 'Formatierung entfernen', RemoveFormatting],
  ] as const;
  return (
    <div className={'km-rich-editor' + (disabled ? ' is-disabled' : '')}>
      <div className="km-rich-toolbar" role="toolbar" aria-label="Textformatierung">
        <select
          aria-label="Absatzformat"
          disabled={disabled}
          defaultValue="p"
          onFocus={remember}
          onChange={(event) => command('formatBlock', event.target.value)}
        >
          <option value="p">Text</option>
          <option value="h2">Überschrift 1</option>
          <option value="h3">Überschrift 2</option>
          <option value="h4">Überschrift 3</option>
          <option value="pre">Codeblock</option>
        </select>
        {tools.map(([name, label, Icon]) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            title={label}
            aria-label={label}
            aria-pressed={Boolean(active[name])}
            className={active[name] ? 'active' : ''}
            onMouseDown={(event) => {
              event.preventDefault();
              remember();
            }}
            onClick={() => command(name)}
          >
            <Icon size={16} />
          </button>
        ))}
        <button
          type="button"
          title="Zitat"
          aria-label="Zitat"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('formatBlock', 'blockquote')}
        >
          <Quote size={16} />
        </button>
        <button
          type="button"
          title="Link einfügen"
          aria-label="Link einfügen"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            remember();
          }}
          onClick={() => {
            setPopover('link');
            setError('');
            setLink('');
          }}
        >
          <Link2 size={16} />
        </button>
        <button
          type="button"
          title="Link entfernen"
          aria-label="Link entfernen"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('unlink')}
        >
          <Unlink size={16} />
        </button>
        <button
          type="button"
          title="Tabelle einfügen"
          aria-label="Tabelle einfügen"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            remember();
          }}
          onClick={() => {
            setPopover('table');
            setError('');
          }}
        >
          <Table2 size={16} />
        </button>
      </div>
      {popover && (
        <div className="km-editor-popover">
          {popover === 'link' ? (
            <>
              <label>
                Link
                <input
                  autoFocus
                  value={link}
                  type="url"
                  placeholder="https://…"
                  onChange={(event) => {
                    setLink(event.target.value);
                    setError('');
                  }}
                  aria-invalid={Boolean(error)}
                />
                {error && <span className="field-error">{error}</span>}
              </label>
              <button
                type="button"
                onClick={() => {
                  const url = safeEditorLink(link.trim());
                  if (!url) {
                    setError('Bitte einen gültigen Link eingeben.');
                    return;
                  }
                  restore();
                  if (window.getSelection()?.isCollapsed)
                    command(
                      'insertHTML',
                      `<a href="${escapeEditorText(url)}">${escapeEditorText(url)}</a>`
                    );
                  else command('createLink', url);
                  setPopover(null);
                }}
              >
                Einfügen
              </button>
            </>
          ) : (
            <>
              <label>
                Zeilen
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={rows}
                  onChange={(event) => setRows(Number(event.target.value))}
                />
              </label>
              <label>
                Spalten
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={columns}
                  onChange={(event) => setColumns(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                disabled={
                  !Number.isInteger(rows) ||
                  rows < 1 ||
                  rows > 12 ||
                  !Number.isInteger(columns) ||
                  columns < 1 ||
                  columns > 8
                }
                onClick={() => {
                  const cells = (tag: string) =>
                    Array.from({ length: columns }, () => `<${tag}><br></${tag}>`).join('');
                  command(
                    'insertHTML',
                    `<table><thead><tr>${cells('th')}</tr></thead><tbody>${Array.from({ length: rows }, () => `<tr>${cells('td')}</tr>`).join('')}</tbody></table><p><br></p>`
                  );
                  setPopover(null);
                }}
              >
                Einfügen
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setPopover(null);
              restore();
            }}
          >
            Abbrechen
          </button>
        </div>
      )}
      <div
        ref={editor}
        className="km-prose km-editable"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-label="Artikelinhalt"
        aria-multiline="true"
        aria-describedby={errorId}
        data-field="content_html"
        spellCheck
        lang="de"
        onInput={update}
        onBlur={remember}
        onKeyUp={remember}
        onMouseUp={remember}
        onPaste={(event) => {
          event.preventDefault();
          remember();
          const html = event.clipboardData.getData('text/html');
          const text = event.clipboardData.getData('text/plain');
          command(
            'insertHTML',
            html ? sanitizeEditorHtml(html) : escapeEditorText(text).replaceAll('\n', '<br>')
          );
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            remember();
            setPopover('link');
            setError('');
          }
          if (event.key === 'Tab') {
            const current = window.getSelection()?.anchorNode;
            const cell = (
              current?.nodeType === Node.ELEMENT_NODE ? current : current?.parentElement
            ) as Element | undefined;
            const activeCell = cell?.closest('td,th');
            if (activeCell && editor.current?.contains(activeCell)) {
              const cells = Array.from(editor.current.querySelectorAll('td,th'));
              const next = cells[cells.indexOf(activeCell) + (event.shiftKey ? -1 : 1)];
              if (next) {
                event.preventDefault();
                const range = document.createRange();
                range.selectNodeContents(next);
                range.collapse(true);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                remember();
              }
            }
          }
        }}
      />
      <div className="km-editor-status">{words} Wörter</div>
    </div>
  );
}
