export const entryTypeNames: Record<string, string> = {
  process: 'Prozess',
  meeting: 'Meetingformat',
  policy: 'Richtlinie',
  reference: 'Nachschlagewerk',
  checklist: 'Checkliste',
};
export type KnowledgeSpace = {
  objectId: string;
  name: string;
  description: string;
  position: number;
};
export type KnowledgeSection = {
  objectId: string;
  space_id: string;
  name: string;
  position: number;
};
export type KnowledgeEntrySummary = {
  objectId: string;
  section_id: string;
  parent_id: string | null;
  title: string;
  type: string;
  tags: string[];
  position: number;
  lastModifiedAt: string;
  upToDate: boolean;
  reviewCycleMonths: number;
  reviewDueAt: string | null;
  excerpt?: string;
  space_name?: string;
  section_name?: string;
};
export type KnowledgeDocument = {
  objectId: string;
  name: string;
  url: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  createdBy: string;
};
export type KnowledgeEntry = KnowledgeEntrySummary & {
  id: string;
  content_html: string;
  plain_text: string;
  createdAt: string;
  createdBy: string;
  modifiedBy: string;
  responsible_id: string;
  created_by_name: string;
  modified_by_name: string;
  responsible_name: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  source_url: string | null;
  source_modified_at: string | null;
  source_data?: { content_present?: boolean };
  section: KnowledgeSection;
  space: KnowledgeSpace;
  documents: KnowledgeDocument[];
};
export type KnowledgeTree = {
  isAdmin: boolean;
  scope: 'mine' | 'all';
  overview: { total: number; maintained: number; current: number } | null;
  spaces: KnowledgeSpace[];
  sections: KnowledgeSection[];
  entries: KnowledgeEntrySummary[];
  storage: { configured: boolean; site: string; folder: string; maxBytes: number };
};
