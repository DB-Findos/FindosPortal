import type { DatabaseClient } from '../database/connection.js';
import { definitions, fields, type Entity } from '../entities.js';
import {
  activeRow,
  archiveRecord,
  createRecord,
  current,
  updateRecord,
} from '../repositories/entities.js';
import { fieldError, httpError } from '../shared/errors.js';
import { parseFormula } from './formula-language.js';
import { formulaInput, type FormulaInput } from './kpi-schema.js';

export type Rights = Record<string, Record<string, boolean>>;
export function permit(rights: Rights, entity: string, action = 'read') {
  if (!rights[entity]?.['can_' + action])
    throw httpError(403, `Keine ${action}-Berechtigung für ${entity}.`);
}
export function numericSources(rights: Rights) {
  const companyContextEntities = new Set(['companies', 'funds', 'deal_data']);
  return Object.entries(definitions).flatMap(([entity, def]) => {
    const numeric = fields(entity as Entity).filter((f) => f.type === 'number');
    return rights[entity]?.can_read && numeric.length && companyContextEntities.has(entity)
      ? [
          {
            entity,
            label: def.label,
            fields: numeric.map((f) => f.name),
            filterFields: Object.keys(def.schema.shape),
          },
        ]
      : [];
  });
}
export async function formulaWithVariables(client: DatabaseClient, id: string) {
  const row = await activeRow(client, 'kpi_formulas', id);
  const variables = (
    await client.query(
      'SELECT * FROM portal.variable_map WHERE formula_version_id=$1 ORDER BY identifier',
      [row.id]
    )
  ).rows;
  return { ...row, variables };
}
async function noCycle(
  client: DatabaseClient,
  target: string,
  self?: string,
  path = new Set<string>(),
  budget = { count: 0 }
) {
  if (target === self || path.has(target))
    throw fieldError(400, 'variables', 'Zirkuläre KPI-Abhängigkeit.');
  if (path.size >= 12 || ++budget.count > 200)
    throw fieldError(400, 'variables', 'Zu viele verschachtelte KPI-Abhängigkeiten.');
  const next = new Set(path).add(target);
  const deps = (
    await client.query(
      `SELECT target_kpi_id FROM portal.variable_map WHERE formula_id=$1 AND ${current} AND target_kpi_id IS NOT NULL`,
      [target]
    )
  ).rows;
  for (const dep of deps) await noCycle(client, dep.target_kpi_id, self, next, budget);
}
export async function prepareFormula(
  client: DatabaseClient,
  raw: unknown,
  rights: Rights,
  self?: string
) {
  const input = formulaInput.parse(raw);
  let parsed;
  try {
    parsed = parseFormula(input.TextEditor);
  } catch (error) {
    throw fieldError(400, 'TextEditor', (error as Error).message);
  }
  const identifiers = input.variables.map((v) => v.identifier);
  if (new Set(identifiers).size !== identifiers.length)
    throw fieldError(400, 'variables', 'Variablen-Identifier müssen eindeutig sein.');
  for (const name of parsed.identifiers)
    if (!identifiers.includes(name))
      throw fieldError(400, 'TextEditor', `Variable ${name} ist nicht definiert.`);
  if (identifiers.some((name) => !parsed.identifiers.includes(name)))
    throw fieldError(400, 'variables', 'Nicht verwendete Variablen entfernen.');
  const variables = [];
  for (const [i, v] of input.variables.entries()) {
    const invalid = (message: string) => fieldError(400, `variables.${i}`, message);
    let name: string;
    permit(rights, v.entity);
    if (['MONTH', 'LTM', 'YTD'].includes(v.aggregation)) {
      permit(rights, 'metrics');
      permit(rights, 'companies');
      if (
        v.entity !== 'metric_data' ||
        v.field !== 'value' ||
        v.metric_number == null ||
        v.record_id ||
        v.target_kpi_id ||
        v.filter
      )
        throw invalid('MetricData benötigt eine Metric Number und das Feld value.');
      const metric = (
        await client.query(
          `SELECT name FROM portal.metrics WHERE metric_number=$1 AND ${current} ORDER BY name LIMIT 1`,
          [v.metric_number]
        )
      ).rows[0];
      if (!metric) throw invalid('Diese Metric Number existiert nicht.');
      name = `MetricData:${metric.name} [${v.metric_number}] · ${v.aggregation}${v.prior_year ? ' · V12P' : ''}${v.dimension ? ' · ' + v.dimension : ''}`;
    } else if (v.aggregation === 'FIXED') {
      if (
        v.entity === 'metric_data' ||
        !numericSources(rights)
          .find((s) => s.entity === v.entity)
          ?.fields.includes(v.field) ||
        v.metric_number != null ||
        v.target_kpi_id ||
        v.prior_year ||
        v.dimension
      )
        throw invalid(
          'Ein fester Wert benötigt ein numerisches Feld und einen Datensatz; keine Zeitaggregation.'
        );
      if (v.filter) {
        const shape = definitions[v.entity as Entity]?.schema.shape;
        if (!shape || !Object.hasOwn(shape, v.filter.field))
          throw invalid('Das Filterfeld ist für diese Entity nicht verfügbar.');
        const reference = (definitions[v.entity as Entity].refs as Record<string, string>)[
          v.filter.field
        ];
        if (v.filter.operator === 'context_company' && reference !== 'companies')
          throw invalid('Der Company-Kontext benötigt eine Company-Referenz als Filterfeld.');
        if (v.filter.operator === 'equals' && !v.filter.value?.trim())
          throw invalid('Für den Filter fehlt ein Wert.');
      }
      const record: { name: string; metric_number?: string } = { name: 'Company-Kontext' };
      name = `${definitions[v.entity as Entity].label}:${v.field} · ${record.name || record.metric_number || v.record_id}`;
    } else {
      permit(rights, 'variable_map');
      if (
        v.entity !== 'kpi_formulas' ||
        v.field !== 'result' ||
        !v.target_kpi_id ||
        v.record_id ||
        v.metric_number != null ||
        v.prior_year ||
        v.dimension ||
        v.filter
      )
        throw invalid('Eine KPI-Variable benötigt eine referenzierte KPI.');
      const target = await activeRow(client, 'kpi_formulas', v.target_kpi_id);
      await noCycle(client, v.target_kpi_id, self);
      name = `KPI:${target.name}`;
    }
    variables.push({ ...v, name });
  }
  const names = Object.fromEntries(variables.map((v) => [v.identifier, v.name]));
  const { variables: _, ...data } = input;
  return {
    data: {
      ...data,
      TextEditor: parsed.TextEditor,
      TextDisplay: parsed.tokens.map((t) => (names[t] ? `[${names[t]}]` : t)).join(' '),
      engine_version: 1,
    },
    variables,
  };
}
export async function saveFormula(
  client: DatabaseClient,
  raw: FormulaInput,
  rights: Rights,
  id?: string,
  version?: string,
  creationId?: string
) {
  permit(rights, 'kpi_formulas', id ? 'update' : 'create');
  permit(rights, 'variable_map', id ? 'update' : 'create');
  // Serializes edits across the dependency graph, including cycle checks.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
  const prepared = await prepareFormula(client, raw, rights, id);
  const row = id
    ? await updateRecord(client, 'kpi_formulas', id, version!, prepared.data)
    : await createRecord(client, 'kpi_formulas', {
        ...prepared.data,
        ...(creationId ? { objectId: creationId } : {}),
      });
  const old = (
    await client.query(`SELECT * FROM portal.variable_map WHERE formula_id=$1 AND ${current}`, [
      row.objectId,
    ])
  ).rows;
  for (const v of old) await archiveRecord(client, 'variable_map', v.objectId, v.id);
  for (const v of prepared.variables) {
    const previous = old.find((p) => p.identifier === v.identifier);
    await createRecord(client, 'variable_map', {
      ...v,
      formula_id: row.objectId,
      formula_version_id: row.id,
      ...(previous
        ? {
            objectId: previous.objectId,
            priorId: previous.id,
            createdAt: previous.createdAt,
            createdBy: previous.createdBy,
          }
        : {}),
    });
  }
  return formulaWithVariables(client, row.objectId);
}
