import './config.js';
import { pool } from './db.js';
import { permissions } from './middleware/auth.js';
import { transaction, current } from './repositories/entities.js';
import { saveFormula } from './services/kpi-definitions.js';
import { saveReport, reportWithItems } from './services/kpi-reports.js';
import { formulaInput } from './services/kpi-schema.js';
import { parseFormula } from './services/formula-language.js';
import { bridgeDefinitions, bridgeReportName } from './services/bridge-definitions.js';

try {
  const actor = (
    await pool.query(
      `SELECT "objectId" FROM portal.users WHERE email=$1 AND active AND ${current}`,
      [process.env.ADMIN_EMAIL]
    )
  ).rows[0];
  if (!actor) throw new Error('Aktiver ADMIN_EMAIL-Benutzer erforderlich.');
  const rights = await permissions(actor.objectId);
  await transaction(actor.objectId, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('portal-kpi-definitions'))");
    const existing = (await db.query(`SELECT * FROM portal.kpi_formulas WHERE ${current}`)).rows;
    const find = (name: string) => {
      const matches = existing.filter((row) => row.name === name);
      if (matches.length > 1) throw new Error(`KPI-Name nicht eindeutig: ${name}`);
      return matches[0];
    };
    const reference = (identifier: string, name: string) => {
      const target = find(name);
      if (!target) throw new Error(`Benötigte bestehende KPI fehlt: ${name}`);
      return {
        identifier,
        entity: 'kpi_formulas',
        field: 'result',
        aggregation: 'KPI',
        target_kpi_id: target.objectId,
      };
    };
    const metric = (identifier: string, number: number) => ({
      identifier,
      entity: 'metric_data',
      field: 'value',
      aggregation: 'MONTH',
      metric_number: number,
    });
    const investment = (identifier: string) => ({
      identifier,
      entity: 'deal_data',
      field: 'findos_investment_value',
      aggregation: 'FIXED',
      filter: { field: 'deal_type_id', operator: 'equals', value: 'Entry' },
    });
    const ensure = async (raw: unknown, refresh = false) => {
      const draft = formulaInput.parse(raw),
        old = find(draft.name);
      if (
        old &&
        (!refresh ||
          (old.TextEditor === parseFormula(draft.TextEditor).TextEditor &&
            old.description === draft.description))
      ) {
        console.log(`Existing KPI: ${draft.name}`);
        return;
      }
      const saved = await saveFormula(db, draft, rights, old?.objectId, old?.id);
      if (old) existing.splice(existing.indexOf(old), 1, saved);
      else existing.push(saved);
      console.log(`${old ? 'Updated' : 'Created'} KPI: ${draft.name}`);
    };
    const common = { unit: 'currency', decimals: 2 };
    await ensure({
      ...common,
      name: 'Findos Equity Value T0',
      TextEditor: 'A * 1000',
      variables: [reference('A', 'Entry FEQV')],
      description:
        'Findos-Anteil am Entry Equity Value gemäß bestehender KPI Entry FEQV. Entry-Daten aus DealData mit DealType Entry. Umrechnung der Quelldaten von Tausend in Währungseinheiten; Währung zum Berichtsstichtag.',
    });
    await ensure({
      ...common,
      name: 'Revenue Effect Findos',
      TextEditor: 'A * 1000',
      variables: [reference('A', 'Revenue Effect (Findos)')],
      description:
        'Findos Revenue Effect gemäß bestehender KPI Revenue Effect (Findos), einschließlich deren Entry-Filtern und LTM-Definition. Quelldaten in Tausend werden in Währungseinheiten umgerechnet.',
    });
    await ensure({
      ...common,
      name: 'Margin Effect Findos',
      TextEditor: 'A * 1000',
      variables: [reference('A', 'Margen Effect (Findos)')],
      description:
        'Findos Margin Effect gemäß bestehender KPI Margen Effect (Findos), einschließlich deren Entry-Filtern und LTM-Definition. Quelldaten in Tausend werden in Währungseinheiten umgerechnet.',
    });
    await ensure({
      ...common,
      name: 'Net Debt Effect Findos',
      TextEditor: '- A * 1000',
      variables: [reference('A', 'Net Debt Effekt (Findos)')],
      description:
        'Equity-Beitrag des Net Debt: negatives Vorzeichen der bestehenden KPI Net Debt Effekt (Findos), weil diese Current minus Entry berechnet. Höhere Schulden vermindern den Equity Value. MetricData 2900000 = Net Debt (Broad Definition); Entry aus DealData. Tausend in Währungseinheiten.',
    });
    await ensure({
      ...common,
      name: 'Capital Returns T1',
      TextEditor: 'A * 1000',
      variables: [
        {
          identifier: 'A',
          entity: 'capital_movements',
          field: 'value',
          aggregation: 'CUMULATIVE',
          filter: { field: 'type', operator: 'equals', value: 'Capital Return' },
        },
      ],
      description:
        'Summe aller CapitalMovements der Berichts-Company vom Typ Capital Return mit Datum vor dem ersten Tag des Folgemonats; der ausgewählte Monat ist vollständig eingeschlossen. Keine Untergrenze und keine YTD-Beschränkung. EUR-Quelldaten in Tausend werden in Währungseinheiten umgerechnet. Undatierte Bewegungen bleiben erhalten, werden aber mit Hinweis ausgeschlossen.',
    });
    await ensure({
      ...common,
      name: 'Capital Structur Effect T1',
      TextEditor: '( A * 1000 * B ) - ( C + D + E + F )',
      variables: [
        investment('A'),
        metric('B', 4101200),
        reference('C', 'Findos Equity Value T0'),
        reference('D', 'Revenue Effect Findos'),
        reference('E', 'Margin Effect Findos'),
        reference('F', 'Net Debt Effect Findos'),
      ],
      description:
        'Gemäß Vorgabe: initiales Findos Investment aus dem Entry-Deal × RCV (Metric 4101200 zum Stichtag), abzüglich Entry Findos Equity Value sowie Revenue-, Margin- und Net-Debt-Effekt. FindosInvestmentValue ist bereits EUR in Tausend, unabhängig von der DealData-Währung. Bei EUR keine FX-Umrechnung; RCV ist dimensionslos. Capital Returns werden separat gezeigt.',
    });
    await ensure(
      {
        ...common,
        name: 'Findos Equity Value T1',
        TextEditor: 'A * 1000 * B + C',
        variables: [investment('A'), metric('B', 4101200), reference('C', 'Capital Returns T1')],
        description:
          'Endwert der vollständigen Findos Equity Bridge: initiales Investment (DealData Entry, bereits EUR in Tausend) × RCV zum Stichtag plus kumulierte Capital Returns bis einschließlich Berichtsmonat. Entspricht T0 + Revenue + Margin + Net Debt + Capital Structure + Capital Returns. Alle Ergebnisse in Währungseinheiten; RCV dimensionslos.',
      },
      true
    );
    const items = bridgeDefinitions.map((definition) => {
      const formula = find(definition.name);
      if (!formula) throw new Error(`Bridge-KPI fehlt: ${definition.name}`);
      return formula.objectId as string;
    });
    const reports = (
      await db.query(`SELECT * FROM portal.report_definitions WHERE name=$1 AND ${current}`, [
        bridgeReportName,
      ])
    ).rows;
    if (reports.length > 1) throw new Error('Bridge-Report ist nicht eindeutig.');
    const old = reports[0],
      prior = old ? await reportWithItems(db, old.objectId) : null;
    if (!prior || JSON.stringify(prior.kpi_ids) !== JSON.stringify(items))
      await saveReport(
        db,
        {
          name: bridgeReportName,
          description:
            'Vollständige Findos Equity Bridge: T0, Revenue, Margin, Net Debt, Capital Structure, Capital Returns, T1. Versionierte KPIs mit Entry- und Monatskontext. Anzeige in Millionen, Ergebnisse in Währungseinheiten.',
          kpi_ids: items,
        },
        rights,
        old?.objectId,
        old?.id
      );
    console.log(`Bridge report: ${items.length}/${bridgeDefinitions.length} defined KPIs.`);
  });
} finally {
  await pool.end();
}
