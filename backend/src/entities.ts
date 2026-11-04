import { z } from 'zod';
import { imageInput } from './services/images.js';
import { variableInput } from './services/kpi-schema.js';
import { chatDefinitions } from './services/chat-schema.js';
import { applicationDefinition } from './services/application-schema.js';
import { documentDefinitions } from './services/document-schema.js';
const text = z.string().trim().min(1).max(500);
const optional = z.string().trim().max(2000).nullable().optional();
const uuid = z.uuid();
export const definitions = {
  ...chatDefinitions,
  ...documentDefinitions,
  application_modules: applicationDefinition,
  knowledge_spaces: {
    label: 'Knowledge Spaces',
    readonly: true,
    schema: z.object({
      name: text,
      description: z.string(),
      position: z.number().int(),
      source_key: z.string().nullable(),
    }),
    refs: {},
  },
  knowledge_sections: {
    label: 'Knowledge Sections',
    readonly: true,
    schema: z.object({
      space_id: uuid,
      name: text,
      position: z.number().int(),
      source_key: z.string().nullable(),
    }),
    refs: { space_id: 'knowledge_spaces' },
  },
  knowledge_entries: {
    label: 'Knowledge Entries',
    readonly: true,
    schema: z.object({
      section_id: uuid,
      parent_id: uuid.nullable(),
      title: text,
      type: z.string(),
      content_html: z.string(),
      plain_text: z.string(),
      tags: z.array(z.string()),
      responsible_id: uuid,
      upToDate: z.boolean(),
      reviewCycleMonths: z.number().int(),
      reviewedAt: z.string().nullable(),
      reviewedBy: uuid.nullable(),
      reviewDueAt: z.string().nullable(),
      position: z.number().int(),
      source_key: z.string().nullable(),
      source_url: z.string().nullable(),
      source_modified_at: z.string().nullable(),
    }),
    refs: {
      section_id: 'knowledge_sections',
      parent_id: 'knowledge_entries',
      responsible_id: 'users',
      reviewedBy: 'users',
    },
  },
  knowledge_documents: {
    label: 'Knowledge Templates',
    readonly: true,
    schema: z.object({
      entry_id: uuid,
      name: text,
      kind: z.literal('template'),
      extension: z.string(),
      mime_type: z.string(),
      size_bytes: z.number(),
      sha256: z.string(),
      url: z.string(),
      drive_id: z.string(),
      item_id: z.string(),
      uploaded_at: z.string(),
      storage_path: z.string(),
    }),
    refs: { entry_id: 'knowledge_entries' },
  },
  custom_reports: {
    label: 'CustomReport',
    readonly: true,
    schema: z.object({
      owner_id: uuid,
      name: text,
      description: z.string(),
      html: z.string(),
      mapping: z.array(z.unknown()),
      engine_version: z.number().int(),
    }),
    refs: { owner_id: 'users' },
  },
  custom_report_shares: {
    label: 'CustomReport Shares',
    readonly: true,
    schema: z.object({ report_id: uuid, user_id: uuid.nullable(), group_id: uuid.nullable() }),
    refs: { report_id: 'custom_reports', user_id: 'users', group_id: 'user_groups' },
  },
  comments: {
    label: 'Comment',
    schema: z.object({
      company_id: uuid.nullable(),
      company_source_name: z.string().nullable().optional(),
      period: z.iso.date(),
      type: z.string().trim().min(1).max(200).default('Investoren Reporting'),
      comment_text: z.string().max(100000).nullable(),
      source_id: uuid.nullable().optional(),
      source_file: z.string().nullable().optional(),
      source_row: z.number().int().nullable().optional(),
      mapping_note: z.string().nullable().optional(),
      source_data: z.record(z.string(), z.unknown()).default({}),
    }),
    refs: { company_id: 'companies' },
  },
  kpi_data: {
    label: 'KPIData',
    readonly: true,
    schema: z.object({
      kpi_id: uuid,
      formula_version_id: uuid,
      company_id: uuid,
      name: text,
      period: z.iso.date(),
      value: z.coerce.number().finite().nullable(),
      dimension: z.enum(['actual', 'budget', 'forecast', 'plan']),
      currency_mode: z.enum(['CC', 'EUR']),
      currency: z.string(),
      unit: z.string(),
      status: z.enum(['ok', 'missing', 'error']),
      message: z.string().nullable(),
      source_revision: z.coerce.number().int(),
      calculated_at: z.string(),
    }),
    refs: { kpi_id: 'kpi_formulas', company_id: 'companies' },
  },
  capital_movements: {
    label: 'CapitalMovements',
    schema: z.object({
      name: text,
      company_id: uuid.nullable(),
      company_source_name: text,
      movement_date: z.iso.date().nullable(),
      source_date: z.iso.date().nullable().optional(),
      date_source: z.string().default('manual'),
      value: z.coerce.number().finite(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default('EUR'),
      type: z.enum(['Capital Call', 'Capital Return']),
      reason: optional,
      source_file: optional,
      source_row: z.number().int().nullable().optional(),
      source_data: z.record(z.string(), z.unknown()).default({}),
    }),
    refs: { company_id: 'companies' },
  },
  metric_formulas: {
    label: 'MetricFormulas',
    schema: z.object({
      name: z.string(),
      company_id: uuid.nullable(),
      company_source_name: z.string().nullable(),
      metric_id: uuid.nullable(),
      dynamo_metric_id: uuid.nullable(),
      metric_source_name: z.string().nullable(),
      metric_number: z.number().int().nullable(),
      dimension: z.enum(['actual', 'budget', 'forecast', 'plan']),
      formula_type: z.enum(['Data', 'Range', 'Formula']),
      accumulation_formula_id: z.string().nullable(),
      accumulation_formula_name: z.string().nullable(),
      accumulation_formula_number: z.string().nullable(),
      monthly_formula_id: z.string().nullable(),
      monthly_formula_name: z.string().nullable(),
      monthly_formula_number: z.string().nullable(),
      range_from: z.number().int().nullable(),
      range_to: z.number().int().nullable(),
      source_created_at: z.string().nullable(),
      source_modified_at: z.string().nullable(),
      source_file: z.string(),
      source_row: z.number().int(),
      source_data: z.record(z.string(), z.unknown()),
      engine_version: z.number().int(),
      evaluation_rules: z.record(z.string(), z.unknown()),
    }),
    refs: { company_id: 'companies', metric_id: 'metrics' },
    readonly: true,
  },
  kpi_formulas: {
    label: 'KPI Formulas',
    schema: z.object({
      name: text,
      description: optional,
      unit: text,
      decimals: z.number().int(),
      TextEditor: text,
      TextDisplay: text,
      engine_version: z.number().int(),
    }),
    refs: {},
    readonly: true,
  },
  variable_map: {
    label: 'VariableMap',
    schema: variableInput.extend({ formula_id: uuid, formula_version_id: uuid, name: text }),
    refs: { formula_id: 'kpi_formulas', target_kpi_id: 'kpi_formulas' },
    readonly: true,
  },
  report_definitions: {
    label: 'Reports',
    schema: z.object({ name: text, description: optional }),
    refs: {},
    readonly: true,
  },
  report_items: {
    label: 'Report KPIs',
    schema: z.object({ report_id: uuid, kpi_id: uuid, position: z.number().int() }),
    refs: { report_id: 'report_definitions', kpi_id: 'kpi_formulas' },
    readonly: true,
  },
  contacts: {
    label: 'Contact',
    schema: z.object({ first_name: text, last_name: text, email: z.email(), phone: optional }),
    refs: {},
  },
  users: {
    label: 'User',
    schema: z.object({
      email: z.email().transform((v) => v.toLowerCase()),
      password: z
        .string()
        .min(12)
        .max(72)
        .refine(
          (v) => Buffer.byteLength(v, 'utf8') <= 72,
          'Passwort darf maximal 72 UTF-8-Bytes haben.'
        ),
      contact_id: uuid,
      active: z.boolean().default(true),
    }),
    refs: { contact_id: 'contacts' },
  },
  user_groups: {
    label: 'User group',
    schema: z.object({ name: text, description: optional }),
    refs: {},
  },
  user_group_memberships: {
    label: 'Membership',
    schema: z.object({ user_id: uuid, group_id: uuid }),
    refs: { user_id: 'users', group_id: 'user_groups' },
  },
  entities: { label: 'Entity', schema: z.object({ name: text }), refs: {}, readonly: true },
  permissions: {
    label: 'Permission',
    schema: z.object({
      group_id: uuid,
      entity_id: uuid,
      can_create: z.boolean().default(false),
      can_read: z.boolean().default(false),
      can_update: z.boolean().default(false),
      can_delete: z.boolean().default(false),
    }),
    refs: { group_id: 'user_groups', entity_id: 'entities' },
  },
  funds: {
    label: 'Fund',
    schema: z.object({
      name: text,
      currency: z.string().length(3).default('EUR'),
      description: optional,
    }),
    refs: {},
  },
  companies: {
    label: 'Company',
    schema: z.object({
      fund_id: uuid,
      name: text,
      internal_name: optional,
      industry: optional,
      address_line: optional,
      postal_code: optional,
      city: optional,
      country: optional,
      phone: optional,
      email: z
        .union([z.email(), z.literal('')])
        .nullable()
        .optional(),
      description: optional,
      website: z
        .union([z.url(), z.literal('')])
        .nullable()
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
      status: optional,
    }),
    refs: { fund_id: 'funds' },
  },
  company_contacts: {
    label: 'Unternehmensverknüpfungen',
    schema: z.object({
      company_id: uuid,
      contact_id: uuid,
      category: z.enum(['company', 'findos']),
      role: text,
      notes: optional,
    }),
    refs: { company_id: 'companies', contact_id: 'contacts' },
  },
  metrics: {
    label: 'Metric',
    schema: z.object({
      company_id: uuid,
      name: text,
      metric_number: z.number().int().min(0).max(2147483647).nullable().optional(),
      unit: text,
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
      section: optional,
      important: z.boolean().default(false),
      description: optional,
      source_data: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    refs: { company_id: 'companies' },
  },
  metric_data: {
    label: 'MetricData',
    schema: z.object({
      metric_id: uuid,
      company_id: uuid.nullable().optional(),
      name: optional,
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
      period: z.iso.date(),
      value: z.coerce.number().finite().nullable(),
      dimension: z.enum(['actual', 'budget', 'forecast', 'plan']).default('actual'),
      source_data: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    refs: { metric_id: 'metrics', company_id: 'companies' },
  },
  deal_types: {
    label: 'DealType',
    schema: z.object({ name: z.enum(['Entry', 'AddOn', 'Exit']) }),
    refs: {},
  },
  deal_data: {
    label: 'DealData',
    schema: z.object({
      name: text,
      company_id: uuid,
      company_internal_name: optional,
      company_source_id: uuid.nullable().optional(),
      company_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
      deal_type_id: uuid,
      findos_investment: optional,
      findos_investment_value: z.coerce.number().finite().nullable().optional(),
      findos_investment_index_value: z.coerce.number().finite().nullable().optional(),
      findos_investment_type: optional,
      deal_date: z.iso.date(),
      revenue_ltm: z.coerce.number().finite().nullable().optional(),
      ebitda_ltm: z.coerce.number().finite().nullable().optional(),
      ebita_ltm: z.coerce.number().finite().nullable().optional(),
      multiple_ebitda: z.coerce.number().finite().nullable().optional(),
      multiple_ebita: z.coerce.number().finite().nullable().optional(),
      fixed_ev: z.coerce.number().finite().nullable().optional(),
      transaction_cost: z.coerce.number().finite().nullable().optional(),
      overfunding: z.coerce.number().finite().nullable().optional(),
      transaction_cost_other: z.coerce.number().finite().nullable().optional(),
      debt_financing: z.coerce.number().finite().nullable().optional(),
      findos_share: z.coerce.number().finite().nullable().optional(),
      index_value: z.coerce.number().finite().nullable().optional(),
      purchase_price_total: z.coerce.number().finite().nullable().optional(),
      comment: optional,
      data_provider_id: optional,
      external_id: optional,
      data_currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional(),
    }),
    refs: { company_id: 'companies', deal_type_id: 'deal_types' },
  },
  search_views: {
    label: 'Search Views',
    schema: z.object({ owner_id: uuid, name: text, definition: z.record(z.string(), z.unknown()) }),
    refs: { owner_id: 'users' },
    readonly: true,
  },
  index_rates: {
    label: 'IndexRates',
    schema: z.object({
      name: text,
      as_of_date: z.iso.date(),
      period: z.iso.date(),
      base_currency: z.string().regex(/^[A-Z]{3}$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
      index_value: z.coerce
        .number()
        .finite()
        .positive()
        .max(99999999999999)
        .refine((value) => Number(value.toFixed(10)) === value, 'Maximal 10 Nachkommastellen.'),
    }),
    refs: {},
  },
  images: { label: 'Images', schema: imageInput, refs: {} },
  design_settings: {
    label: 'Design Settings',
    schema: z.object({
      key: z.literal('application').default('application'),
      logo_id: uuid.nullable().optional(),
      primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      surface_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    refs: { logo_id: 'images' },
  },
  portfolio_sections: {
    label: 'Portfolio Sections',
    schema: z.object({ name: text, label: text, icon: text, position: z.number().int() }),
    refs: {},
  },
  portfolio_views: {
    label: 'Portfolio Views',
    schema: z.object({
      section_id: uuid,
      name: text,
      label: text,
      path: text,
      icon: text,
      position: z.number().int(),
    }),
    refs: { section_id: 'portfolio_sections' },
  },
  portfolio_navigation_access: {
    label: 'Portfolio Navigation Access',
    schema: z.object({ group_id: uuid, view_id: uuid, can_read: z.boolean().default(false) }),
    refs: { group_id: 'user_groups', view_id: 'portfolio_views' },
  },
  performance_update_comments: {
    label: 'PerformanceUpdateComments',
    schema: z.object({
      company_id: uuid.nullable(),
      company_source_name: z.string(),
      metric_data_period: z.iso.date().nullable(),
      performance_update_date: z.iso.date().nullable(),
      comment_text: z.string(),
      text_type: z.string().nullable(),
      source_file: z.string().nullable(),
      slide_number: z.number().int().nullable(),
      paragraph_number: z.number().int().nullable(),
      slide_id: z.string().nullable(),
      mapping_note: z.string().nullable(),
      capture_type: z.string().nullable(),
      source_row: z.number().int(),
    }),
    refs: { company_id: 'companies' },
    readonly: true,
  },
} as const;
export type Entity = keyof typeof definitions;
export function entityName(value: string): Entity {
  if (!Object.hasOwn(definitions, value))
    throw Object.assign(new Error('Unknown entity'), { status: 404 });
  return value as Entity;
}
export function fields(entity: Entity) {
  return Object.entries(definitions[entity].schema.shape).map(([name, schema]) => ({
    name,
    readonly:
      (entity === 'documents' && name === 'uploaded_at') ||
      (entity === 'metric_data' && ['company_id', 'name', 'currency'].includes(name)) ||
      (['metrics', 'metric_data', 'comments'].includes(entity) && name === 'source_data'),
    required: !schema.isOptional() && !(entity === 'metric_data' && name === 'value'),
    type: name.endsWith('_color')
      ? 'color'
      : name === 'url'
        ? 'url'
        : name === 'password'
          ? 'password'
          : name === 'email'
            ? 'email'
            : name === 'period' ||
                name === 'as_of_date' ||
                name === 'deal_date' ||
                name === 'movement_date' ||
                name === 'source_date'
              ? 'date'
              : [
                    'value',
                    'size_bytes',
                    'reviewCycleMonths',
                    'source_revision',
                    'metric_number',
                    'index_value',
                    'decimals',
                    'position',
                    'engine_version',
                    'range_from',
                    'range_to',
                    'source_row',
                    'findos_investment_value',
                    'findos_investment_index_value',
                    'revenue_ltm',
                    'ebitda_ltm',
                    'ebita_ltm',
                    'multiple_ebitda',
                    'multiple_ebita',
                    'fixed_ev',
                    'transaction_cost',
                    'overfunding',
                    'transaction_cost_other',
                    'debt_financing',
                    'findos_share',
                    'purchase_price_total',
                  ].includes(name)
                ? 'number'
                : name === 'upToDate' ||
                    name === 'active' ||
                    name === 'important' ||
                    name === 'prior_year' ||
                    name.startsWith('can_')
                  ? 'boolean'
                  : 'text',
    reference: (definitions[entity].refs as Record<string, string>)[name] || null,
    options: name === 'dimension' ? ['actual', 'budget', 'forecast', 'plan'] : null,
  }));
}
