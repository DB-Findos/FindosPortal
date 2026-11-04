import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Search,
  Plus,
  Pencil,
  FileText,
  FolderPlus,
  LoaderCircle,
  CheckCheck,
} from 'lucide-react';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';
import { useVisibleViewData } from '../contexts/ViewContentContext';
import KnowledgeSidebar from '../components/knowledge/KnowledgeSidebar';
import KnowledgeDetails from '../components/knowledge/KnowledgeDetails';
import KnowledgeOverview from '../components/knowledge/KnowledgeOverview';
import KnowledgeTemplates from '../components/knowledge/KnowledgeTemplates';
import KnowledgeEntryEditor from '../components/knowledge/KnowledgeEntryEditor';
import KnowledgeStructureDialog from '../components/knowledge/KnowledgeStructureDialog';
import {
  entryTypeNames,
  type KnowledgeTree,
  type KnowledgeEntry,
  type KnowledgeEntrySummary,
} from '../components/knowledge/types';
import '../components/knowledge/KnowledgeManagement.css';

export default function KnowledgePage() {
  const { request } = useApi();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'all' ? 'all' : 'mine';
  const entryId = params.get('entry'),
    sectionId = params.get('section'),
    spaceId = params.get('space'),
    query = params.get('q') || '';
  const [tree, setTree] = useState<KnowledgeTree | null>(null);
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [rows, setRows] = useState<KnowledgeEntrySummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [search, setSearch] = useState(query);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<KnowledgeEntry | null>(null);
  const dirty = useRef(false);
  const [structure, setStructure] = useState<'space' | 'section' | null>(null);
  const [tab, setTab] = useState<'content' | 'templates'>('content');
  const canCreate = Boolean(user?.permissions.knowledge_entries?.can_create),
    canEdit = Boolean(user?.permissions.knowledge_entries?.can_update);
  const reloadTree = useCallback(
    () => request<KnowledgeTree>(`/knowledge/tree?scope=${scope}`).then(setTree),
    [request, scope]
  );
  useEffect(() => {
    let active = true;
    request<KnowledgeTree>(`/knowledge/tree?scope=${scope}`)
      .then((value) => {
        if (active) setTree(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [request, scope]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!dirty.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
        return;
      const anchor = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.href === window.location.href) return;
      if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);
  useEffect(() => {
    setSearch(query);
  }, [query]);
  useEffect(() => {
    if (!entryId || editing) return;
    let active = true;
    setLoading(true);
    setError('');
    request<KnowledgeEntry>(`/knowledge/entries/${entryId}`)
      .then((value) => {
        if (active) setEntry(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entryId, request, revision, editing]);
  const listQuery = useCallback(
    (offset = 0) => {
      const value = new URLSearchParams({ search: query, offset: String(offset) });
      value.set('scope', tree?.isAdmin ? 'all' : scope);
      if (spaceId) value.set('space_id', spaceId);
      if (sectionId) value.set('section_id', sectionId);
      if (type) value.set('type', type);
      return value;
    },
    [query, spaceId, sectionId, type, scope, tree?.isAdmin]
  );
  useEffect(() => {
    if (entryId || editing || !tree) return;
    let active = true;
    setLoading(true);
    setError('');
    request<{ rows: KnowledgeEntrySummary[]; nextOffset: number | null }>(
      `/knowledge/entries?${listQuery()}`
    )
      .then((result) => {
        if (active) {
          setRows(result.rows);
          setNextOffset(result.nextOffset);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entryId, editing, listQuery, request, revision, !!tree]);
  const leave = () => {
    if (dirty.current && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return false;
    dirty.current = false;
    setEditing(false);
    return true;
  };
  const navigate = (value: Record<string, string>) => {
    if (!leave()) return;
    setParams({ scope, ...value });
    setTab('content');
    setError('');
  };
  const create = () => {
    if (!tree?.sections.length || !leave()) return;
    setEditTarget(null);
    setEditing(true);
    setError('');
  };
  const current = entry?.objectId === entryId ? entry : null;
  const selectedSection = tree?.sections.find((section) => section.objectId === sectionId);
  const selectedSpace = tree?.spaces.find(
    (space) => space.objectId === (spaceId || selectedSection?.space_id)
  );
  const title = query
    ? `Suche: ${query}`
    : selectedSection?.name || selectedSpace?.name || 'Knowledge Management';
  useVisibleViewData('Knowledge Management', {
    entryId,
    sectionId,
    spaceId,
    search: query,
    editing,
    entry: current,
    entries: entryId ? undefined : rows,
    spaces: tree?.spaces,
    loading,
    error,
  });
  return (
    <div className="knowledge-layout">
      <KnowledgeSidebar
        tree={tree}
        entryId={entryId}
        sectionId={sectionId}
        spaceId={spaceId}
        onHome={() => navigate({})}
        onSpace={(id) => navigate({ space: id })}
        onSection={(id) => navigate({ section: id })}
        onEntry={(id) => navigate({ entry: id })}
        onCreate={create}
        canCreate={canCreate}
        scope={scope}
        onScope={(value) => navigate({ scope: value })}
      />
      <main className="knowledge-main" aria-label="Knowledge Management">
        <div className="km-workspace">
          {!editing && (
            <div className="km-global-tools">
              <form
                className="km-global-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigate(search.trim() ? { q: search.trim() } : {});
                }}
              >
                <Search size={17} />
                <input
                  aria-label="Knowledge durchsuchen"
                  placeholder="Wissen durchsuchen"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button type="submit">Suchen</button>
              </form>
              <div className="km-head-actions">
                {user?.permissions.knowledge_spaces?.can_create && (
                  <button type="button" className="km-button" onClick={() => setStructure('space')}>
                    <BookOpen size={15} />
                    <span>Bereich</span>
                  </button>
                )}
                {user?.permissions.knowledge_sections?.can_create && (
                  <button
                    type="button"
                    className="km-button"
                    onClick={() => setStructure('section')}
                  >
                    <FolderPlus size={15} />
                    <span>Abschnitt</span>
                  </button>
                )}
                {canCreate && (
                  <button
                    type="button"
                    className="km-button primary"
                    onClick={create}
                    disabled={!tree?.sections.length}
                  >
                    <Plus size={15} />
                    <span>Eintrag</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {loading && !editing && (
            <div className="km-loading" role="status">
              <LoaderCircle size={15} className="performance-spin" />
              Wird geladen …
            </div>
          )}
          {editing && tree ? (
            <KnowledgeEntryEditor
              key={editTarget?.id || 'new'}
              tree={tree}
              entry={editTarget}
              sectionId={sectionId || current?.section_id}
              onDirty={() => {
                dirty.current = true;
              }}
              onCancel={() => {
                if (leave()) setRevision((value) => value + 1);
              }}
              onSaved={(saved) => {
                dirty.current = false;
                setEditing(false);
                setEntry(saved);
                setParams({ scope, entry: saved.objectId });
                setTab('content');
                void reloadTree().catch((cause: Error) => setError(cause.message));
              }}
            />
          ) : entryId ? (
            current &&
            !loading && (
              <article className="km-entry">
                <header className="km-article-header">
                  <div className="km-breadcrumb">
                    <button
                      type="button"
                      onClick={() => navigate({ space: current.space.objectId })}
                    >
                      {current.space.name}
                    </button>
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => navigate({ section: current.section.objectId })}
                    >
                      {current.section.name}
                    </button>
                  </div>
                  <div className="km-title-row">
                    <h1>{current.title}</h1>
                    <div className="km-head-actions">
                      {canEdit && !current.upToDate && current.responsible_id === user?.id && (
                        <button
                          type="button"
                          className="km-button primary"
                          disabled={reviewBusy}
                          onClick={async () => {
                            setReviewBusy(true);
                            setError('');
                            try {
                              const saved = await request<KnowledgeEntry>(
                                `/knowledge/entries/${current.objectId}/review`,
                                'POST',
                                {},
                                current.id
                              );
                              setEntry(saved);
                              await reloadTree();
                            } catch (cause) {
                              setError((cause as Error).message);
                            } finally {
                              setReviewBusy(false);
                            }
                          }}
                        >
                          {reviewBusy ? (
                            <LoaderCircle size={15} className="performance-spin" />
                          ) : (
                            <CheckCheck size={15} />
                          )}
                          Prüfung abschließen
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          className="km-button"
                          disabled={reviewBusy}
                          onClick={() => {
                            setEditTarget(current);
                            setEditing(true);
                            dirty.current = false;
                          }}
                        >
                          <Pencil size={15} />
                          Bearbeiten
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="km-article-labels">
                    <span className={current.upToDate ? 'km-status-current' : 'km-status-due'}>
                      {current.upToDate ? 'Aktuell' : 'Prüfung offen'}
                    </span>
                    <span>{entryTypeNames[current.type] || current.type}</span>
                    {current.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <KnowledgeDetails key={current.objectId} entry={current} />
                  <nav className="km-article-tabs" aria-label="Eintrag">
                    <button
                      type="button"
                      className={tab === 'content' ? 'active' : ''}
                      onClick={() => setTab('content')}
                    >
                      Inhalt
                    </button>
                    <button
                      type="button"
                      className={tab === 'templates' ? 'active' : ''}
                      onClick={() => setTab('templates')}
                    >
                      Vorlagen <span>{current.documents.length}</span>
                    </button>
                  </nav>
                </header>
                <div className="km-article-scroll">
                  {tab === 'content' ? (
                    current.plain_text ? (
                      <div
                        className="km-prose"
                        dangerouslySetInnerHTML={{ __html: current.content_html }}
                      />
                    ) : (
                      <p className="km-muted">Noch kein Inhalt.</p>
                    )
                  ) : (
                    tree && (
                      <KnowledgeTemplates
                        entry={current}
                        storage={tree.storage}
                        onChanged={(saved) => {
                          setEntry(saved);
                          void reloadTree().catch((cause: Error) => setError(cause.message));
                        }}
                      />
                    )
                  )}
                </div>
              </article>
            )
          ) : (
            <section className="km-browser">
              <div className="km-browser-heading">
                <div>
                  <span className="eyebrow">KNOWLEDGE</span>
                  <h1>{title}</h1>
                </div>
                <select
                  aria-label="Eintragstyp filtern"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  <option value="">Alle Typen</option>
                  {Object.entries(entryTypeNames).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="km-browser-scroll">
                {tree?.overview && !spaceId && !sectionId && !query && (
                  <KnowledgeOverview overview={tree.overview} />
                )}
                {!spaceId && !sectionId && !query && (
                  <div className="km-space-cards">
                    {tree?.spaces.map((space) => (
                      <button
                        type="button"
                        key={space.objectId}
                        onClick={() => navigate({ space: space.objectId })}
                      >
                        <BookOpen size={23} />
                        <h2>{space.name}</h2>
                        <span>
                          {
                            tree.entries.filter(
                              (entry) =>
                                tree.sections.find(
                                  (section) => section.objectId === entry.section_id
                                )?.space_id === space.objectId
                            ).length
                          }{' '}
                          Einträge
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedSpace && !sectionId && (
                  <div className="km-section-chips">
                    {tree?.sections
                      .filter((section) => section.space_id === selectedSpace.objectId)
                      .map((section) => (
                        <button
                          type="button"
                          key={section.objectId}
                          onClick={() => navigate({ section: section.objectId })}
                        >
                          {section.name}
                        </button>
                      ))}
                  </div>
                )}
                <div className="km-entry-list">
                  {rows.map((row) => (
                    <button
                      type="button"
                      key={row.objectId}
                      onClick={() => navigate({ entry: row.objectId })}
                    >
                      <FileText size={19} />
                      <div>
                        <h2>{row.title}</h2>
                        <span>
                          {row.space_name} · {row.section_name}
                        </span>
                        {row.excerpt && <p>{row.excerpt}</p>}
                      </div>
                      <small className={row.upToDate ? 'km-status-current' : 'km-status-due'}>
                        {row.upToDate ? 'Aktuell' : 'Prüfung offen'}
                      </small>
                    </button>
                  ))}
                  {!rows.length && !loading && <p className="km-muted">Keine Einträge gefunden.</p>}
                </div>
                {nextOffset !== null && (
                  <button
                    type="button"
                    className="km-button km-load-more"
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const result = await request<{
                          rows: KnowledgeEntrySummary[];
                          nextOffset: number | null;
                        }>(`/knowledge/entries?${listQuery(nextOffset)}`);
                        setRows((previous) => [...previous, ...result.rows]);
                        setNextOffset(result.nextOffset);
                      } catch (cause) {
                        setError((cause as Error).message);
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Weitere laden
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
      {structure && tree && (
        <KnowledgeStructureDialog
          kind={structure}
          tree={tree}
          spaceId={spaceId || selectedSection?.space_id || null}
          onClose={() => setStructure(null)}
          onSaved={() => {
            setStructure(null);
            void reloadTree().catch((cause: Error) => setError(cause.message));
          }}
        />
      )}
    </div>
  );
}
