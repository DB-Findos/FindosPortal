import './config.js';
import { pool } from './db.js';
import { permissions } from './middleware/auth.js';
import { transaction, current } from './repositories/entities.js';
import { saveFormula } from './services/kpi-definitions.js';
import { saveReport } from './services/kpi-reports.js';
import { formulaInput } from './services/kpi-schema.js';

try {
  const actor = (
    await pool.query(
      `SELECT "objectId" FROM portal.users WHERE email=$1 AND active AND ${current}`,
      [process.env.ADMIN_EMAIL]
    )
  ).rows[0];
  if (!actor) throw new Error('Aktiver ADMIN_EMAIL-Benutzer erforderlich.');
  const rights = await permissions(actor.objectId);
  const metric = (
    identifier: string,
    number: number,
    aggregation = 'MONTH',
    prior_year = false
  ) => ({
    identifier,
    entity: 'metric_data',
    field: 'value',
    aggregation,
    prior_year,
    metric_number: number,
  });
  const templates = [
    { name: 'Umsatz · Monat', TextEditor: 'A', variables: [metric('A', 1000000)] },
    { name: 'Umsatz · LTM', TextEditor: 'A', variables: [metric('A', 1000000, 'LTM')] },
    { name: 'Umsatz · YTD', TextEditor: 'A', variables: [metric('A', 1000000, 'YTD')] },
    {
      name: 'Umsatz · Vorjahresmonat',
      TextEditor: 'A',
      variables: [metric('A', 1000000, 'MONTH', true)],
    },
    {
      name: 'Umsatzwachstum · Monat (%)',
      TextEditor: '( A / B - 1 ) * 100',
      unit: '%',
      variables: [metric('A', 1000000), metric('B', 1000000, 'MONTH', true)],
    },
    { name: 'Adjusted EBITDA · Monat', TextEditor: 'A', variables: [metric('A', 1300300)] },
    {
      name: 'Adjusted EBITDA-Marge (%)',
      TextEditor: 'A / B * 100',
      unit: '%',
      variables: [metric('A', 1300300), metric('B', 1000000)],
    },
  ];
  await transaction(actor.objectId, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
    const ids: string[] = [];
    for (const template of templates) {
      const old = (
        await client.query(
          `SELECT "objectId" FROM portal.kpi_formulas WHERE name=$1 AND ${current}`,
          [template.name]
        )
      ).rows[0];
      const row =
        old ||
        (await saveFormula(
          client,
          formulaInput.parse({
            description:
              'Standard-KPI: Revenue 1000000 / Adjusted EBITDA 1300300. Absolute Werte in der Einheit der Quelldaten; keine Währungsumrechnung.',
            ...template,
          }),
          rights
        ));
      ids.push(row.objectId);
      console.log(`${old ? 'Existing' : 'Created'} KPI: ${template.name}`);
    }
    const name = 'Standardreporting · Performance';
    const exists = (
      await client.query(`SELECT 1 FROM portal.report_definitions WHERE name=$1 AND ${current}`, [
        name,
      ])
    ).rowCount;
    if (!exists)
      await saveReport(
        client,
        {
          name,
          description:
            'Umsatz, Wachstum, Adjusted EBITDA und Marge. Company, Monat und Dimension werden im Bericht ausgewählt. Fehlende Quelldaten bleiben als fehlend sichtbar.',
          kpi_ids: ids,
        },
        rights
      );
    console.log(`${exists ? 'Existing' : 'Created'} report: ${name}`);
  });
} finally {
  await pool.end();
}
