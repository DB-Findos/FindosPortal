import { useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import type { KnowledgeTree, KnowledgeEntrySummary } from './types';
export default function KnowledgeSidebar({
  tree,
  entryId,
  sectionId,
  spaceId,
  onHome,
  onSpace,
  onSection,
  onEntry,
  onCreate,
  canCreate,
  scope,
  onScope,
}: {
  tree: KnowledgeTree | null;
  entryId: string | null;
  sectionId: string | null;
  spaceId: string | null;
  onHome: () => void;
  onSpace: (id: string) => void;
  onSection: (id: string) => void;
  onEntry: (id: string) => void;
  onCreate: () => void;
  canCreate: boolean;
  scope: 'mine' | 'all';
  onScope: (scope: 'mine' | 'all') => void;
}) {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width:1000px)').matches);
  const [spaces, setSpaces] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<Set<string>>(new Set());
  useEffect(() => {
    const media = window.matchMedia('(max-width:1000px)');
    const changed = () => setCollapsed(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const entry = tree?.entries.find((item) => item.objectId === entryId);
    const section = tree?.sections.find(
      (item) => item.objectId === (entry?.section_id || sectionId)
    );
    if (section) {
      setSections((previous) => new Set(previous).add(section.objectId));
      setSpaces((previous) => new Set(previous).add(section.space_id));
    } else if (spaceId) setSpaces((previous) => new Set(previous).add(spaceId));
  }, [entryId, sectionId, spaceId, tree]);
  const toggle = (id: string, set: (value: (previous: Set<string>) => Set<string>) => void) =>
    set((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const page = (
    entry: KnowledgeEntrySummary,
    depth = 0,
    seen = new Set<string>()
  ): React.ReactNode => {
    if (seen.has(entry.objectId) || depth > 8) return null;
    const next = new Set(seen).add(entry.objectId);
    return (
      <div key={entry.objectId}>
        <button
          type="button"
          className={'km-nav-page' + (entryId === entry.objectId ? ' active' : '')}
          style={{ paddingLeft: 20 + depth * 12 }}
          onClick={() => onEntry(entry.objectId)}
          title={entry.title}
        >
          <FileText size={13} />
          <span>{entry.title}</span>
        </button>
        {tree?.entries
          .filter((child) => child.parent_id === entry.objectId)
          .map((child) => page(child, depth + 1, next))}
      </div>
    );
  };
  return (
    <aside
      className={'km-sidebar' + (collapsed ? ' collapsed' : '')}
      aria-label="Knowledge Navigation"
    >
      <header>
        <button
          type="button"
          className="km-sidebar-brand"
          onClick={onHome}
          title="Knowledge Management"
        >
          <BookOpen size={20} />
          {!collapsed && <strong>Knowledge</strong>}
        </button>
        <button
          type="button"
          className="km-icon"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Navigation einblenden' : 'Navigation ausblenden'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </header>
      {!collapsed && (
        <>
          <button type="button" className="km-nav-home" onClick={onHome}>
            <Home size={16} />
            Übersicht
          </button>
          {tree && !tree.isAdmin && (
            <div className="km-topic-scope" aria-label="Themenauswahl">
              <button
                type="button"
                className={scope === 'mine' ? 'active' : ''}
                onClick={() => onScope('mine')}
              >
                Meine Themen
              </button>
              <button
                type="button"
                className={scope === 'all' ? 'active' : ''}
                onClick={() => onScope('all')}
              >
                Alle Themen
              </button>
            </div>
          )}
          {canCreate && (
            <button type="button" className="km-nav-create" onClick={onCreate}>
              <Plus size={15} />
              Neuer Eintrag
            </button>
          )}
          <nav>
            {tree?.spaces.map((space) => (
              <div className="km-nav-space" key={space.objectId}>
                <div className="km-nav-space-row">
                  <button
                    type="button"
                    className="km-nav-toggle"
                    onClick={() => toggle(space.objectId, setSpaces)}
                    aria-label={`${space.name} ${spaces.has(space.objectId) ? 'einklappen' : 'ausklappen'}`}
                  >
                    {spaces.has(space.objectId) ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={spaceId === space.objectId ? 'active' : ''}
                    onClick={() => {
                      setSpaces((previous) => new Set(previous).add(space.objectId));
                      onSpace(space.objectId);
                    }}
                  >
                    <BookOpen size={15} />
                    <span>{space.name}</span>
                  </button>
                </div>
                {spaces.has(space.objectId) &&
                  tree.sections
                    .filter((section) => section.space_id === space.objectId)
                    .map((section) => (
                      <div key={section.objectId}>
                        <div className="km-nav-section-row">
                          <button
                            type="button"
                            className="km-nav-toggle"
                            onClick={() => toggle(section.objectId, setSections)}
                            aria-label={`${section.name} ${sections.has(section.objectId) ? 'einklappen' : 'ausklappen'}`}
                          >
                            {sections.has(section.objectId) ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </button>
                          <button
                            type="button"
                            className={sectionId === section.objectId ? 'active' : ''}
                            onClick={() => {
                              setSections((previous) => new Set(previous).add(section.objectId));
                              onSection(section.objectId);
                            }}
                          >
                            <Folder size={13} />
                            <span>{section.name}</span>
                          </button>
                        </div>
                        {sections.has(section.objectId) &&
                          tree.entries
                            .filter(
                              (entry) => entry.section_id === section.objectId && !entry.parent_id
                            )
                            .map((entry) => page(entry))}
                      </div>
                    ))}
              </div>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
