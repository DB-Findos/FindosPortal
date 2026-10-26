import type { ZodError } from 'zod';
import { definitions } from '../entities.js';
export type FieldErrors = Record<string, string>;

function issueMessage(issue: ZodError['issues'][number]): string {
  if (issue.code === 'custom') return issue.message;
  if (issue.code === 'invalid_type')
    return issue.expected === 'number'
      ? 'Bitte eine gültige Zahl eingeben.'
      : 'Bitte einen gültigen Wert eingeben.';
  if (issue.code === 'too_small') {
    if (issue.origin === 'string')
      return issue.minimum === 1
        ? 'Bitte dieses Feld ausfüllen.'
        : `Bitte mindestens ${issue.minimum} Zeichen eingeben.`;
    return issue.inclusive
      ? `Der Wert muss mindestens ${issue.minimum} sein.`
      : `Der Wert muss größer als ${issue.minimum} sein.`;
  }
  if (issue.code === 'too_big')
    return issue.origin === 'string'
      ? `Bitte maximal ${issue.maximum} Zeichen eingeben.`
      : `Der Wert darf höchstens ${issue.maximum} sein.`;
  if (issue.code === 'invalid_format') {
    if (issue.format === 'email') return 'Bitte eine gültige E-Mail-Adresse eingeben.';
    if (issue.format === 'url')
      return 'Bitte eine gültige URL eingeben (z. B. https://example.com).';
    if (issue.format === 'uuid') return 'Bitte einen gültigen Eintrag auswählen.';
    if (issue.format === 'date') return 'Bitte ein gültiges Datum eingeben.';
  }
  if (issue.path.at(-1) === 'website')
    return 'Bitte eine gültige URL eingeben (z. B. https://example.com).';
  if (String(issue.path.at(-1)).endsWith('_color') || issue.path[0] === 'colors')
    return 'Bitte einen Hex-Farbwert mit sechs Stellen eingeben, z. B. #246649.';
  if (['currency', 'base_currency'].includes(String(issue.path.at(-1))))
    return 'Bitte einen Währungscode aus drei Großbuchstaben eingeben, z. B. EUR.';
  return 'Bitte einen gültigen Wert eingeben.';
}
export function validationFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (path && !Object.hasOwn(fields, path)) fields[path] = issueMessage(issue);
  }
  return fields;
}
export function databaseFieldErrors(
  error: { detail?: string; column?: string; constraint?: string },
  url: string,
  message: string
): FieldErrors {
  if (
    /^\/api\/kpi\/(formulas|reports)/.test(url) &&
    ['kpi_formulas_name', 'report_definitions_name'].includes(error.constraint || '')
  )
    return { name: message };
  if (
    /^\/api\/search\/views(?:\/|\?|$)/.test(url) &&
    error.constraint === 'search_views_current_name'
  )
    return { name: message };
  const name = /^\/api\/data\/([a-z_]+)(?:\/|\?|$)/.exec(url)?.[1];
  if (!name || !Object.hasOwn(definitions, name)) return {};
  const definition = definitions[name as keyof typeof definitions];
  const editable = new Set(Object.keys(definition.schema.shape));
  const columns = (error.detail?.match(/^Key \(([^)]+)\)/)?.[1] || '')
    .split(',')
    .map((key) => key.trim().replaceAll('"', ''));
  if (error.column) columns.push(error.column);
  for (const field of editable)
    if (
      error.constraint === `${name}_${field}_check` ||
      error.constraint === `${name}_${field}_fkey`
    )
      columns.push(field);
  return Object.fromEntries(
    [...new Set(columns)]
      .filter((column) => editable.has(column))
      .map((column) => [column, message])
  );
}
