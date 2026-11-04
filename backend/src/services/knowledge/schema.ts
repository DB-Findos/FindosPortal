import { z } from 'zod';
export const knowledgeTypes = z.enum(['process', 'meeting', 'policy', 'reference', 'checklist']);
export const entryInput = z
  .object({
    section_id: z.uuid(),
    parent_id: z.uuid().nullable().default(null),
    title: z.string().trim().min(1, 'Bitte einen Titel eingeben.').max(500),
    type: knowledgeTypes.default('reference'),
    content_html: z.string().max(500000),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    upToDate: z.boolean().default(false),
    reviewCycleMonths: z.number().int().min(1).max(120).default(12),
  })
  .strict();
export const spaceInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).default(''),
  })
  .strict();
export const sectionInput = z
  .object({ space_id: z.uuid(), name: z.string().trim().min(1).max(200) })
  .strict();
export const knowledgeEntities = new Set([
  'knowledge_spaces',
  'knowledge_sections',
  'knowledge_entries',
  'knowledge_documents',
]);
