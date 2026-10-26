import { z } from 'zod';
import { formulaInput, variableInput } from '../services/kpi-schema.js';
import { formulaWithVariables, permit } from '../services/kpi-definitions.js';
import { snapshot } from '../services/snapshot.js';
import type { Actor } from './data.js';

export function editableFormula(row: Record<string, any>) {
  return formulaInput.parse({
    ...Object.fromEntries(
      Object.keys(formulaInput.shape)
        .filter((key) => key !== 'variables')
        .map((key) => [key, row[key]])
    ),
    description: row.description ?? '',
    variables: row.variables.map((variable: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(variableInput.shape).map((key) => [key, variable[key]]))
    ),
  });
}

export const findFormulasInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();

export async function findFormulas(actor: Actor, raw: unknown) {
  const input = findFormulasInput.parse(raw);
  permit(actor.rights, 'kpi_formulas');
  permit(actor.rights, 'variable_map');
  const words = input.name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return snapshot(async (db) => {
    const rows = (
      await db.query(
        `SELECT "objectId" FROM portal.kpi_formulas
      WHERE "archivedAt" IS NULL AND name ILIKE ALL($1::text[])
      ORDER BY (lower(name)=lower($2)) DESC,name,"objectId" LIMIT 6 OFFSET $3`,
        [words.map((word) => '%' + word + '%'), input.name, input.offset]
      )
    ).rows;
    const matches = [];
    for (const row of rows.slice(0, 5)) {
      const formula = await formulaWithVariables(db, row.objectId);
      matches.push({
        object_id: formula.objectId,
        expected_version: formula.id,
        TextDisplay: formula.TextDisplay,
        draft: editableFormula(formula),
      });
    }
    return {
      matches,
      hasMore: rows.length > 5,
      nextOffset: rows.length > 5 ? input.offset + 5 : null,
      instructions:
        'draft is valid editor input with audit fields removed. For a NEW derived KPI, adapt draft and call propose_change with kind=formula, without object_id/expected_version. Inspect related base KPIs if the business formula differs; never just rename a different calculation.',
    };
  });
}
