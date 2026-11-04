import { z } from 'zod';

export const applicationUrl = z
  .string()
  .trim()
  .max(2048)
  .url('Bitte eine vollständige URL eingeben.')
  .refine((value) => {
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Bitte einen HTTP- oder HTTPS-Link eingeben.')
  .transform((value) => new URL(value).toString())
  .nullable();

export const applicationDefinition = {
  label: 'Applications',
  readonly: true,
  schema: z.object({
    key: z.string(),
    name: z.string(),
    external_url: applicationUrl,
    internal_path: z.string().nullable(),
    position: z.number().int(),
  }),
  refs: {},
} as const;
