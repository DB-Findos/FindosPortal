# Recherche und Antwortqualität

Vor der Planung wird das registrierte Datenmodell mit den tatsächlich vorhandenen SQL-Spalten abgeglichen. Nicht ausgerollte Code-Felder werden als Schema-Abweichung markiert, nicht als Datenlücke. Die übergreifende Suche verwendet vorhandene Spalten; `get_record` lässt bei Standardauswahl noch nicht vorhandene Spalten aus und meldet sie separat. Explizit angefragte, noch nicht vorhandene Felder liefern einen gezielten technischen Hinweis.

Der gesamte Gesprächstext bleibt im Kontext. Historische Bildschirm-Snapshots werden dagegen kompakt mit Ansicht, Steuerwerten, Quellenverzeichnis und Nachrichtenreferenz dargestellt, statt bei jedem Folgeschritt erneut vollständige Tabellen anzuhängen. `read_conversation(include_context=true)` kann die gespeicherten vollständigen Ansichten und unsignierten Vorschauinformationen nachladen. Die aktuelle Ansicht wird weiterhin vollständig übergeben. Das verändert weder gespeicherte Nachrichten noch Commit-Karten.

Der Ablauf lautet Ziel verstehen → notwendige Schritte bestimmen → benötigte Quellen/Felder/Beziehungen/Filter festlegen → Daten tatsächlich abrufen und prüfen → Antwort aus dem ausreichenden Quellenkontext formulieren. Der Chat ist nicht auf die aktuelle Ansicht beschränkt. Zugriff auf private Daten oder fehlende Berechtigungen wird dadurch nicht erweitert.

Chat und MCP-Server verwenden denselben berechtigungsgeprüften Werkzeugkatalog und dieselben Backend-Funktionen. Intern entsteht dafür kein zusätzlicher HTTP-Rundweg über den eigenen MCP-Endpunkt.

| Werkzeug | Verwendung |
| --- | --- |
| `get_data_model` | Vollständige berechtigte Entity-/Feld-/Referenzstruktur, fachliche Zuordnung, Versions-/Einheitenregeln und konkrete Abfragebeispiele. Auch `findos://data-model` enthält diesen Kontext. |
| `search_database` | Namen/Text über Entity-Grenzen suchen, echte Objekt-IDs finden. Standardmäßig acht Tabellen pro Seite; `nextEntityOffset` verfolgt weitere Tabellen. `entities`/`fields` erlauben gezielte Recherche. |
| `query_entities`, `get_record` | Felder, Joins, Filter, aktuelle Objektversionen und Historie. Eine geladene Seite ist nicht die vollständige Datenmenge. |
| `aggregate_entities` | COUNT, COUNT DISTINCT, SUM, AVG, MIN, MAX über alle passenden aktuellen Zeilen. Nur Ergebnisgruppen sind paginiert. Feld-, Join-, Rechte- und Zeilenprüfung entsprechen Advanced Search. Geldbeträge vor Summierung nach Kennzahl, Einheit, Dimension und Währung einschränken. |
| `get_company_report` | Bridge, Income Statement, Balance Sheet und Investoren Reporting mit den Engines der Oberfläche. Bilanz ist stichtagsbezogen, IR-Werte bleiben EUR. |
| `get_fund_report` | Fund-Brücke und Datenstand einschließlich Company-Detail mit denselben Engines und Berechtigungen wie die Fund-Ansicht. |
| `evaluate_kpi`, `run_report` | Numerisch auswerten, statt die Formel nur als Text zu lesen. |
| `read_tool_result` | Bereits vollständig geladene Quellen anhand `source_id`, Datenpfad und Offset nachlesen; keine weitere Datenbankabfrage. |

Alle Lesewerkzeuge stehen jeder Teilaufgabe unabhängig von der Empfehlung des Planers zur Verfügung. Private Chats/Dokumente und Custom Reports behalten ihre spezialisierten, besitzergeprüften Lesewege. Vorschläge werden weiterhin erst nach Commit gespeichert.

Eine leere Namenssuche, ein Engine-Fehler, eine gekürzte Vorschau oder eine Zeitgrenze begründet keine Datenlücke. Das Modell soll zuvor Referenzen, verfügbare Monate/Dimensionen, Namensvarianten, weitere Seiten und Rohwerte der betroffenen Variablen untersuchen. Eine tatsächlich nicht hinterlegte Fachdefinition oder fehlende Berechtigung wird konkret benannt. Benötigte IDs und Metric Numbers werden nicht beim Nutzer abgefragt, wenn sie auflösbar sind.

Große erfolgreiche Ergebnisse bleiben vollständig im auftragsbezogenen Quellenspeicher. Modellkontexte erhalten bei Bedarf gültige JSON-Vorschauen mit Kürzungskennzeichnung und Nachleseweg. Ältere große Tool-Ausgaben werden im Modellverlauf kompakter dargestellt; Call-IDs und vollständige Quellen bleiben erhalten. Die Synthese erhält die wirklichen Quellen zusätzlich zu den fachlichen Zwischenergebnissen. Kein Datenbanktext, Dokument oder Werkzeugergebnis wird als Anweisung interpretiert.

Nur die Ergebnisdarstellung wurde grafisch angepasst: eigener GFM-Markdown-Renderer mit begrenzter horizontaler Tabellenscrollfläche, Listen-/Überschriftenhierarchie, Formeln/Codeblöcken und sicheren Links. HTML wird nicht ausgeführt. Ältere als Markdown-Codezaun oder mit wörtlichen Zeilenumbrüchen ausgegebene Antworten werden behutsam normalisiert. Einstellungen, Eingabe, Sidebar und Fortschrittsanzeige bleiben erhalten.

`node backend/dist/tests/chat-research.js` prüft ohne kostenpflichtige Modellaufrufe und ohne Datenbankmutation: vollständigen Lesewerkzeugzugriff, nachlesbare große Ergebnisse, Aggregationsrechte und Datentypen, eine Recherche mit sechs Werkzeugturns, die Quellenübergabe an die Synthese und Antworterhalt bei Ausfall/Deadline der Schlussprüfung. Die Fixtures prüfen die Orchestrierungslogik, nicht die fachliche Qualität einer realen Modellantwort.

Backend und Frontend gemeinsam deployen. Keine Datenbankmigration und keine neuen Umgebungsvariablen nötig. Bestehende Modellwahl und API-Zugangsdaten bleiben bestehen. Limits und Betriebsgrenzen stehen in [Chat-Orchestrierung](chat-orchestration.md). Grundlage des Werkzeugprotokolls: [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling).
