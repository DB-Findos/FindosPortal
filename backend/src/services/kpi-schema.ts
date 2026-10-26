import { z } from 'zod';
export const variableInput = z
  .object({
    identifier: z.string().regex(/^[A-Z]{1,3}$/),
    entity: z.string().min(1).max(100),
    field: z.string().min(1).max(100),
    aggregation: z.enum(['MONTH', 'LTM', 'YTD', 'FIXED', 'KPI']),
    prior_year: z.boolean().default(false),
    dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).nullable().default(null),
    metric_number: z.number().int().min(0).max(2147483647).nullable().default(null),
    record_id: z.uuid().nullable().default(null),
    target_kpi_id: z.uuid().nullable().default(null),
    filter: z
      .object({
        field: z.string().min(1).max(100),
        operator: z.enum(['equals', 'context_company']),
        value: z.string().max(500).nullable().default(null),
      })
      .nullable()
      .default(null),
  })
  .strict();
export const formulaInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
    unit: z.string().max(40).default(''),
    decimals: z.number().int().min(0).max(10).default(2),
    TextEditor: z.string().min(1).max(4000),
    variables: z.array(variableInput).max(100),
  })
  .strict();
export const reportInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
    kpi_ids: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Eine KPI darf nur einmal im Bericht stehen.'
      ),
  })
  .strict();
export const reportContext = z
  .object({
    company_id: z.uuid(),
    date: z.iso
      .date()
      .refine(
        (value) => Number(value.slice(0, 4)) >= 1901 && Number(value.slice(0, 4)) <= 9998,
        'Ungültiger Berichtszeitraum.'
      ),
    dimension: z.enum(['actual', 'budget', 'forecast', 'plan']),
  })
  .strict();
export type VariableInput = z.infer<typeof variableInput>;
export type FormulaInput = z.infer<typeof formulaInput>;
export type ReportContext = z.infer<typeof reportContext>;
