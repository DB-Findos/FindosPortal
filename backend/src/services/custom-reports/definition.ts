import { z } from 'zod';
import { variableInput } from '../kpi-schema.js';
import { searchDefinition } from '../search.js';

const common = {
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().max(200),
};
export const reportBinding = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('value'),
      source: variableInput,
      month_offset: z.number().int().min(-120).max(0).default(0),
      months: z.number().int().min(1).max(36).default(1),
      format: z.enum(['number', 'percent', 'currency']).default('number'),
      decimals: z.number().int().min(0).max(6).default(1),
      scale: z.number().finite().positive().max(1e12).default(1),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('query'),
      definition: searchDefinition,
      // Aliases are resolved through declared Entity references, never arbitrary SQL.
      company_alias: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,30}$/)
        .default('root'),
      date_field: z
        .object({ alias: z.string(), field: z.string(), mode: z.enum(['month', 'through_month']) })
        .nullable()
        .default(null),
      dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).nullable().default(null),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
]);
export const customReportInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(''),
    html: z.string().min(1).max(100000),
    mapping: z.array(reportBinding).min(1).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.mapping.map((binding) => binding.key)).size !== value.mapping.length)
      ctx.addIssue({
        code: 'custom',
        path: ['mapping'],
        message: 'Mapping-Schlüssel müssen eindeutig sein.',
      });
    if (value.mapping.reduce((sum, b) => sum + (b.kind === 'value' ? b.months : 1), 0) > 360)
      ctx.addIssue({
        code: 'custom',
        path: ['mapping'],
        message: 'Maximal 360 Monatsauswertungen pro Bericht.',
      });
  });
export type CustomReportInput = z.infer<typeof customReportInput>;
export type ReportBinding = z.infer<typeof reportBinding>;
export const customContext = z
  .object({
    company_id: z.uuid(),
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).default('actual'),
    currency: z.enum(['EUR', 'CC']).default('EUR'),
  })
  .strict();
export type CustomContext = z.infer<typeof customContext>;
