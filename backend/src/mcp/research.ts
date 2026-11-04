import { z } from 'zod';
import { definitions, fields, entityName } from '../entities.js';
import { catalog, type Actor } from './data.js';
import { privateChatEntities } from '../services/chat-schema.js';
import { privateCustomReportEntities } from '../services/custom-reports/access.js';
import { searchFields, searchDefinition, compileSearch } from '../services/search.js';
import { sharedDocumentScope } from '../services/document-schema.js';
import { snapshot } from '../services/snapshot.js';
import { httpError } from '../shared/errors.js';

export const researchGuide = {
  workflow: [
    'Ziel aus Nutzerfrage und Verlauf bestimmen.',
    'Notwendige Schritte und benötigte Felder, Beziehungen, Filter und Berechnungen festlegen.',
    'Namen/IDs auflösen, passende Daten abrufen, Vollständigkeit und Einheiten prüfen.',
    'Ergebnis aus den tatsächlich geladenen Quellen erstellen.',
  ],
  identity:
    'objectId ist die stabile Referenz; id ist eine unveränderliche Objektversion. Nur archivedAt IS NULL ist aktuell. Eingehende Referenzen werden durch Filter der Kindtabelle abgefragt.',
  discovery:
    'get_data_model zeigt alle berechtigten Strukturen. search_database findet Datensätze über Entity-Grenzen; entity_offset blättert durch die Tabellen. describe_entity zeigt echte SQL-Typen und eingehende Beziehungen. query_entities holt ausgewählte Felder und Joins. aggregate_entities aggregiert ALLE gefilterten Datensätze, nicht nur eine geladene Seite.',
  reporting:
    'Datum, Company, Währung und Dimension aus Ansicht/Frage. MetricData ist eine Monats-Faktentabelle: metrics.company_id bzw. metric_data.company_id, metric_number, period, dimension und value. metrics liefert Namen, Einheiten und die Nummern. metric_id verweist auf eine company-spezifische Metric; metric_number ist companyübergreifend. Werte in CC/EUR nicht mischen; IndexRates rechnet Betrag/index_value nach EUR zum ersten Tag des Berichtsmonats. IR-Kennzahlen sind bereits EUR. RCV ist dimensionslos.',
  calculations:
    'get_company_report/evaluate_kpi/run_report liefern die gleiche Engine wie die Anwendung. KPIData sind materialisierte Monatswerte mit status, source_revision und currency_mode; Roh-Snapshots können veraltet sein. Fachliche Formeln mit der Engine auswerten. aggregate_entities dient Summen/Anzahlen/Verteilungen von Rohdaten; nicht automatisch verschiedenartige Kennzahlen oder Währungen summieren.',
  domains: {
    funds: 'Funds -> companies.fund_id -> metrics.company_id -> metric_data.metric_id.',
    deals:
      'deal_data.company_id; Entry/AddOn/Exit über deal_types bzw. deal_type_id. Entry-Werte aus DealData, nicht aus laufender MetricData ableiten.',
    kpis: 'kpi_formulas: TextEditor und TextDisplay. variable_map.formula_id und formula_version_id beschreiben Eingaben. find_formulas lädt bereits alle editierbaren Variablen; get_kpi_guide erklärt die Syntax.',
    knowledge:
      'knowledge_spaces -> knowledge_sections -> knowledge_entries; responsible_id ist der Verantwortliche. upToDate/reviewDueAt beschreiben die Aktualität. documents ist das zentrale Dokumentregister; knowledge_documents verknüpft Vorlagen.',
    comments:
      'performance_update_comments: metric_data_period und performance_update_date unterscheiden. comments enthält unter anderem Investoren-Reporting-Kommentare.',
    access:
      'Keine Umgehung von Rechten: private Chats/Dokumente nur mit ihren spezialisierten owner-geprüften Werkzeugen; Custom Reports über list_custom_reports/get_custom_report. Nicht zugängliche Daten sind keine fehlenden Daten.',
  },
  queryExample: {
    entity: 'metric_data',
    fields: [
      { alias: 'root', field: 'period' },
      { alias: 'root', field: 'value' },
    ],
    filters: [
      { alias: 'root', field: 'company_id', op: 'eq', value: 'COMPANY_OBJECT_ID' },
      { alias: 'root', field: 'dimension', op: 'eq', value: 'actual' },
    ],
    joins: [],
    order: [{ alias: 'root', field: 'period', direction: 'desc' }],
  },
  joins:
    'Beispiel: entity=companies, joins=[{from:"root",field:"fund_id",alias:"fund",type:"left"}], fields=[{alias:"root",field:"internal_name"},{alias:"fund",field:"name"}]. Nur deklarierte Referenzen sind zulässig.',
  missing:
    'Ein leerer Treffer mit einem Namen beweist keine Datenlücke. Namensvarianten, Company-Referenz, Dimension, Datum/Monatsgrenze und weitere Seiten prüfen. Fehlermeldung einer Berechnung zuerst anhand der Formelvariablen und Rohdaten untersuchen. Nur bei belegtem Fehlen oder echter fachlicher Mehrdeutigkeit nachfragen.',
};

export function getDataModel(actor: Actor) {
  return {
    guide: researchGuide,
    entities: catalog(actor).map((entity) => ({
      ...entity,
      fields: fields(entity.entity as keyof typeof definitions)
        .filter((field) => field.name !== 'password')
        .map((field) => ({ name: field.name, type: field.type, reference: field.reference })),
      specializedRead:
        privateChatEntities.has(entity.entity) ||
        privateCustomReportEntities.has(entity.entity) ||
        entity.entity === 'search_views',
    })),
  };
}

export async function inspectDataModel(actor: Actor) {
  const model = getDataModel(actor);
  const columns = await snapshot(
    async (db) =>
      (
        await db.query(
          `SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='portal' AND table_name=ANY($1::text[])`,
          [model.entities.map((entity) => entity.entity)]
        )
      ).rows
  );
  return {
    ...model,
    entities: model.entities.map((entity) => {
      const actual = columns.filter((column) => column.table_name === entity.entity);
      return {
        ...entity,
        availableInDatabase: actual.length > 0,
        fields: entity.fields
          .filter((field) => actual.some((column) => column.column_name === field.name))
          .map((field) => ({
            ...field,
            sqlType: actual.find((column) => column.column_name === field.name)!.data_type,
          })),
        declaredFieldsNotInDatabase: entity.fields
          .filter((field) => !actual.some((column) => column.column_name === field.name))
          .map((field) => field.name),
      };
    }),
    schemaNote:
      'Felder sind mit dem tatsächlichen SQL-Schema abgeglichen. declaredFieldsNotInDatabase kennzeichnet eine Code-/Migrationsabweichung und keine fehlenden Werte.',
  };
}

export const databaseSearchInput = z
  .object({
    query: z.string().trim().min(1).max(200),
    entities: z.array(z.string()).min(1).max(8).optional(),
    fields: z.array(z.string()).min(1).max(5).optional(),
    entity_offset: z.number().int().min(0).default(0),
    per_entity: z.number().int().min(1).max(10).default(3),
  })
  .strict();
const preferred = [
  'companies',
  'metrics',
  'kpi_formulas',
  'funds',
  'knowledge_entries',
  'contacts',
  'deal_data',
  'comments',
  'capital_movements',
];
const names = [
  'internal_name',
  'name',
  'title',
  'email',
  'description',
  'short_name',
  'company_internal_name',
  'comment_text',
  'plain_text',
  'key',
  'source_file',
];
export async function searchDatabase(actor: Actor, raw: unknown) {
  const input = databaseSearchInput.parse(raw);
  const eligible = catalog(actor).filter(
    (item) =>
      item.entity !== 'search_views' &&
      !privateChatEntities.has(item.entity) &&
      !privateCustomReportEntities.has(item.entity)
  );
  const requested = input.entities?.map(entityName);
  if (requested?.some((entity) => !eligible.some((item) => item.entity === entity)))
    throw httpError(
      403,
      'Mindestens eine Entity ist nicht über die allgemeine Datensuche zugänglich.'
    );
  const physical = await snapshot(
    async (db) =>
      (
        await db.query(
          `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='portal' AND table_name=ANY($1::text[])`,
          [eligible.map((item) => item.entity)]
        )
      ).rows
  );
  const candidates = eligible
    .filter((item) => !requested || requested.includes(item.entity as any))
    .map((item) => ({
      entity: item.entity,
      columns: (input.fields || names).filter(
        (field) =>
          searchFields(item.entity as keyof typeof definitions).includes(field) &&
          physical.some(
            (column) => column.table_name === item.entity && column.column_name === field
          )
      ),
    }))
    .filter((item) => item.columns.length)
    .sort(
      (a, b) =>
        (preferred.indexOf(a.entity) < 0 ? 999 : preferred.indexOf(a.entity)) -
        (preferred.indexOf(b.entity) < 0 ? 999 : preferred.indexOf(b.entity))
    );
  const selected = requested
    ? candidates
    : candidates.slice(input.entity_offset, input.entity_offset + 8);
  const words = input.query
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((word) => '%' + word.replace(/[\\%_]/g, '\\$&') + '%');
  if (!words.length)
    throw httpError(400, 'Bitte einen Suchbegriff mit Buchstaben oder Ziffern angeben.');
  const results = await Promise.all(
    selected.map(async ({ entity, columns }) => {
      try {
        return await snapshot(async (db) => {
          const kpi = entity === 'kpi_data';
          const values: unknown[] = [words, input.per_entity + 1];
          if (kpi)
            values.push(Object.keys(actor.rights).filter((name) => actor.rights[name]?.can_read));
          const expression = columns
            .map((field) => `coalesce("${field}"::text,'')`)
            .join("||' '||");
          const rows = (
            await db.query(
              `SELECT "objectId",id,${columns.map((field) => `left("${field}"::text,1200) AS "${field}"`).join(',')} FROM portal.${entity} WHERE "archivedAt" IS NULL AND ${sharedDocumentScope(entity)} AND (${expression}) ILIKE ALL($1::text[])${kpi ? ' AND required_entities <@ $3::text[]' : ''} ORDER BY "objectId" LIMIT $2`,
              values
            )
          ).rows;
          return {
            entity,
            fields: columns,
            rows: rows.slice(0, input.per_entity),
            hasMore: rows.length > input.per_entity,
          };
        });
      } catch (error) {
        return {
          entity,
          error: 'Abfrage technisch fehlgeschlagen; kein Beleg für fehlende Daten.',
          code: (error as { code?: string }).code,
        };
      }
    })
  );
  const next = requested
    ? null
    : input.entity_offset + selected.length < candidates.length
      ? input.entity_offset + selected.length
      : null;
  return {
    query: input.query,
    results,
    searchedEntities: selected.map((item) => item.entity),
    hasMoreEntities: next !== null,
    nextEntityOffset: next,
    hint: 'Treffer mit query_entities/get_record gezielt untersuchen. hasMore betrifft Zeilen einer Tabelle; nextEntityOffset weitere Tabellen. Keine vollständige Datenabdeckung aus einer einzelnen Seite ableiten.',
  };
}

export const aggregateInput = z
  .object({
    definition: searchDefinition,
    group_by: z.array(z.string()).max(4).default([]),
    measures: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
            op: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
            field: z.string().nullable(),
          })
          .strict()
      )
      .min(1)
      .max(10),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export function compileAggregate(actor: Actor, raw: unknown) {
  const input = aggregateInput.parse(raw),
    compiled = compileSearch(input.definition, actor.rights);
  const column = (name: string) => {
    if (!compiled.columns.includes(name))
      throw httpError(400, 'Aggregationsfeld muss in definition.fields stehen: ' + name);
    return `"${name}"`;
  };
  if (
    new Set([...input.group_by, ...input.measures.map((item) => item.name)]).size !==
    input.group_by.length + input.measures.length
  )
    throw httpError(400, 'Spalten und Aggregationsnamen müssen eindeutig sein.');
  const groups = input.group_by.map(column);
  const measures = input.measures.map((item) => {
    if (!item.field && item.op !== 'count')
      throw httpError(400, 'Für diese Aggregation ist ein Feld erforderlich.');
    const field = item.field ? column(item.field) : '*';
    if (['sum', 'avg'].includes(item.op) && compiled.fieldTypes[item.field!] !== 'number')
      throw httpError(400, 'SUM/AVG benötigt ein numerisches Feld.');
    return `${item.op === 'count_distinct' ? `count(DISTINCT ${field})` : `${item.op}(${field})`} AS "${item.name}"`;
  });
  return {
    sql: `SELECT ${[...groups, ...measures].join(',')} FROM (${compiled.sourceSql}) source${groups.length ? ' GROUP BY ' + groups.join(',') + ' ORDER BY ' + groups.map((group) => group + ' NULLS LAST').join(',') : ''} LIMIT $${compiled.values.length + 1} OFFSET $${compiled.values.length + 2}`,
    values: [...compiled.values, input.limit + 1, input.offset],
    input,
  };
}
export async function aggregateEntities(actor: Actor, raw: unknown) {
  const query = compileAggregate(actor, raw);
  return snapshot(async (db) => {
    const rows = (await db.query(query.sql, query.values)).rows;
    return {
      rows: rows.slice(0, query.input.limit),
      hasMore: rows.length > query.input.limit,
      nextOffset: rows.length > query.input.limit ? query.input.offset + query.input.limit : null,
      scope:
        'Aggregationen über alle passenden aktuellen Zeilen; nur Ergebnisgruppen sind paginiert. SQL-Anzahlen und numerische Beträge können als exakte Dezimalstrings zurückkommen.',
    };
  });
}
