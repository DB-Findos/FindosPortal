export type ChatProgress = {
  stage:
    | 'context'
    | 'planning'
    | 'task'
    | 'model'
    | 'tool'
    | 'review'
    | 'retry'
    | 'synthesis'
    | 'complete'
    | 'warning';
  summary: string;
  at: string;
  elapsed_ms: number;
  taskId?: string;
  taskTitle?: string;
  status?: 'pending' | 'running' | 'checking' | 'accepted' | 'blocked' | 'failed' | 'info';
  details?: string[];
  reason?: string;
  plan?: {
    objective: string;
    scope: string[];
    tasks: { id: string; title: string; criteria: string[] }[];
    effort: string;
    maxRepairs: number;
    maxSeconds: number;
  };
};
const activities: Record<string, string> = {
  get_data_model: 'Datenmodell, Beziehungen und Abfrageregeln laden',
  get_fund_report: 'Fund-Bericht mit der Berechnungsengine der Anwendung laden',
  search_database: 'Passende Daten in den verfügbaren Entities suchen',
  aggregate_entities: 'Gefilterte Daten vollständig zusammenfassen',
  read_tool_result: 'Bereits geladene Quelldaten gezielt nachlesen',
  get_custom_report_guide: 'Custom-Report-Modul laden',
  preview_custom_report: 'HTML-Bericht mit aktuellen Daten prüfen',
  propose_custom_report: 'Custom Report zur Übernahme vorbereiten',
  run_custom_report: 'Custom Report im Berichtskontext auswerten',
  list_custom_reports: 'Eigene und geteilte Berichte suchen',
  get_custom_report: 'HTML-Vorlage und Datenmapping laden',
  list_entities: 'Verfügbare Entities und Zugriffsrechte ermitteln',
  describe_entity: 'Felder und Beziehungen der Entity untersuchen',
  query_entities: 'Datensätze mit passenden Filtern abfragen',
  get_record: 'Datensatz und Referenzen nachschlagen',
  resolve_metric: 'Kennzahl und Metric Number zuordnen',
  find_formulas: 'Bestehende KPI-Formeln und Variablen vergleichen',
  get_formula: 'Gespeicherte KPI-Formel laden',
  get_kpi_guide: 'Formelformat und Berechnungsregeln nachschlagen',
  validate_formula: 'Formelstruktur überprüfen',
  evaluate_kpi: 'KPI im gewählten Berichtskontext berechnen',
  evaluate_report: 'Berichtskennzahlen berechnen',
  run_report: 'Gespeicherte Berichtskennzahlen berechnen',
  get_company_report: 'Company-Bericht mit der tatsächlichen Berechnungsengine auswerten',
  propose_change: 'Änderungsvorschlag validieren und zur Übernahme vorbereiten',
  read_document: 'Referenziertes Dokument lesen',
  create_document: 'Angefordertes Dokument erstellen',
  read_conversation: 'Gespeicherten Gesprächskontext nachschlagen',
  list_conversations: 'Eigene Konversationen nachschlagen',
  list_views: 'Gespeicherte Ansichten nachschlagen',
};
export function toolActivity(name: string) {
  return activities[name] || 'Anwendungsdaten mit einem Werkzeug prüfen';
}
export function toolOutcome(name: string, result: unknown) {
  const data = result as {
    error?: unknown;
    rows?: unknown[];
    candidates?: unknown[];
    hasMore?: boolean;
    proposed?: boolean;
  } | null;
  if (data?.error) return 'Abfrage konnte nicht ausgeführt werden; Ursache wird geprüft.';
  if (data?.proposed) return 'Änderungsvorschlag erfolgreich vorbereitet; noch nicht übernommen.';
  const rows = Array.isArray(result) ? result : data?.rows || data?.candidates;
  if (Array.isArray(rows))
    return `${rows.length} Ergebnisse geladen${data?.hasMore ? '; weitere Seiten verfügbar' : ''}.`;
  return `${toolActivity(name)}: abgeschlossen.`;
}
