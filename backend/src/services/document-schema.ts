import { z } from 'zod';

const id = z.uuid();
const optionalText = z.string().trim().max(2000).nullable().optional();
const classification = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
});

export const documentDefinitions = {
  document_types: { label: 'Dokumenttypen', schema: classification, refs: {} },
  document_origins: { label: 'Dokumentherkünfte', schema: classification, refs: {} },
  documents: {
    label: 'Dokumente',
    schema: z.object({
      name: z.string().trim().min(1).max(500),
      description: optionalText,
      document_type_id: id,
      origin_id: id,
      url: z
        .url()
        .refine((value) => value.startsWith('https://'), 'Bitte einen HTTPS-Link angeben.'),
      extension: z.string().trim().max(20).default(''),
      mime_type: z.string().trim().max(200).default('application/octet-stream'),
      size_bytes: z.coerce.number().int().nonnegative().nullable().optional(),
      uploaded_at: z.iso.datetime({ offset: true }).nullable().optional(),
      company_id: id.nullable().optional(),
      fund_id: id.nullable().optional(),
    }),
    refs: {
      document_type_id: 'document_types',
      origin_id: 'document_origins',
      company_id: 'companies',
      fund_id: 'funds',
    },
  },
} as const;

// Private chat files remain accessible exclusively through the existing owner-checked chat API.
export const sharedDocumentScope = (entity: string, alias = '') =>
  entity === 'documents' ? `${alias ? alias + '.' : ''}visibility='shared'` : 'true';

export function documentLinkSql(entity: string, alias = '') {
  const prefix = alias ? alias + '.' : '';
  return entity === 'knowledge_documents'
    ? `'/api/knowledge/entries/'||${prefix}entry_id||'/templates/'||${prefix}"objectId"||'/download'`
    : `CASE WHEN ${prefix}storage_provider='sharepoint' THEN '/api/documents/'||${prefix}"objectId"||'/download' ELSE ${prefix}url END`;
}
