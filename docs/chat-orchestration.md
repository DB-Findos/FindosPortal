# Chat-Orchestrierung

Der sichtbare Ablauf orientiert sich an einem Chat mit laufender Aktivitätsanzeige. Die Anwendung implementiert dafür einen eigenen, expliziten Workflow; sie behauptet nicht, interne Abläufe von ChatGPT nachzubilden. Angezeigt werden Aufträge, Werkzeuge, überprüfbare Ergebnisse und Gründe für Nachbesserungen, keine internen Gedankengänge.

## Verbindlicher Ablauf

1. **Ziel → Schritte → Datenbedarf:** Ein eigener Prompt erhält die vollständige berechtigte Entity-/Feld-/Referenzstruktur und bestimmt Ziel, notwendige Schritte, konkrete `data_requirements` (Quellen, Beziehungen, Company, Datum, Dimension, Währung), Umfang und Abschlusskriterien. Eine Begrüßung wird ohne zusätzliche Synthese-/Prüfaufrufe direkt beantwortet.
2. **Daten beschaffen und bearbeiten:** Jede Teilaufgabe erhält Datenmodell, Datenbedarf, Vorgängerergebnisse und gemeinsame Quellen. Alle lesenden MCP-Werkzeuge bleiben verfügbar; der Planer kann den Zugriff nicht auf eine Werkzeugauswahl begrenzen. Erfolgreiche Abfragen werden anhand normalisierter Parameter wiederverwendet. Unabhängige Leseaufrufe laufen in Gruppen von maximal vier parallel; Vorschläge bleiben sequenziell. Identische Wiederholungen werden zur Auswertung vorhandener Quellen zurückgeführt.
3. **Zwischenergebnis prüfen:** Ein separates, leichtes Modell prüft nur die vorher festgelegten Kriterien. Eine Nachbesserung muss Kriterium, beobachtetes Problem, erforderliche Korrektur und gegebenenfalls Quellen benennen. Keine allgemeine Suche nach immer neuen Verbesserungen. Wortmuster wie „fehlt“ lösen keine Wiederholung aus.
4. **Gezielt nachbessern oder Grenze festhalten:** Nur die betroffene Teilaufgabe wird innerhalb ihres festgelegten Budgets erneut bearbeitet. Identische ungeklärte Prüfpunkte ohne neue Erkenntnis führen zu einem nachvollziehbaren Abschluss dieses Teilauftrags. Technische Fehler, fehlende Berechtigungen, nicht definierte Fachlogik und belegte Datenlücken bleiben unterscheidbar.
5. **Mit tatsächlichen Quellen zusammenführen:** Die Synthese erhält Zwischenergebnisse UND die geladenen Quelldaten. Erfolgreiche Engine-Auswertungen bleiben auch bei ausgefallener Zwischenprüfung verfügbar. Der Schlusscheck prüft den ursprünglichen Auftrag; bei erfolgreichem Gesamtcheck ist die Antwort vollständig. Fällt ausschließlich der Schlusscheck technisch aus oder erreicht seine Deadline, bleibt die bereits formulierte Antwort mit ungeprüftem Status erhalten. Nachweislich beanstandete Entwürfe werden nicht ungeprüft als Fallback ausgegeben. Technische Grenzen werden nicht als fehlende Daten dargestellt.

## Umfang und Reasoning

Serverseitige Obergrenzen werden vor der Planung anhand des gewählten Reasoning-Aufwands gesetzt. Der Plan kann diese Grenzen unterschreiten, aber niemals erhöhen. Er enthält die tatsächlich vorgesehenen Aufgaben und Prüfziele. Zeit, Modellaufrufe, echte Werkzeugausführungen und Nachbesserungen werden getrennt gezählt. Cache-Treffer werden als Wiederverwendung angezeigt.

| Aufwand | Max. Teilaufgaben | Werkzeuge | Modellaufrufe | Nachbesserungen je Aufgabe | Zeitrahmen |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ohne / Minimal | 1 | 18 | 14 | 0 | 180 s |
| Niedrig | 2 | 32 | 26 | 1 | 300 s |
| Mittel | 3 | 56 | 44 | 1 | 600 s |
| Hoch | 4 | 80 | 64 | 2 | 900 s |
| Sehr hoch | 5 | 100 | 80 | 2 | 1200 s |
| Maximal | 6 | 128 | 100 | 2 | 1500 s |

Bei ausgeschöpften Budgets erscheinen die erreichten Ergebnisse und die konkret noch offenen Prüfkriterien. Ein Limit ist kein Nachweis für fehlende Daten. Änderungen bleiben geprüfte Vorschläge, die ausschließlich über den Commit-Button gespeichert werden.

Pro Aufgabe stehen 8–32 statt zuvor 3–8 Modellturns bereit. Vor Erreichen des Aufruflimits oder bei weniger als 75 Sekunden Restzeit wird neue Recherche zugunsten eines quellenbasierten Abschlusses beendet. Zusammenfassungen verwenden das ausgewählte Modell mit geringem Reasoning-Aufwand; die eigentliche Untersuchung verwendet weiterhin den gewählten Aufwand. Einzelne Modellaufrufe dürfen maximal 180 Sekunden und höchstens bis zur Deadline laufen. Höhere Einstellungen erlauben längere und potenziell teurere Untersuchungen; abgeschlossene Aufgaben werden sofort beendet. Siehe [Recherche und Datenzugriff](chat-research.md).

## Live-Transport

`POST /api/ai/chat/runs` bestätigt die Annahme sofort. Die Bearbeitung läuft unabhängig von dieser kurzen HTTP-Anfrage. `GET /api/ai/chat/runs/:id/events` liefert nummerierte SSE-Ereignisse; `GET /api/ai/chat/runs/:id?after=N` liefert nur neue Ereignisse als kurze JSON-Antwort. Der Browser nutzt beide Wege mit Deduplizierung. Dadurch kann ein gepufferter Stream die Fortschrittsanzeige nicht bis zur finalen Antwort zurückhalten. Ein fehlgeschlagener Kanal beendet nicht automatisch die Berechnung. Abbruch erfolgt explizit über den eigenen Abbruch-Endpunkt.

Die aktuelle Laufzeitverwaltung gehört zu einer Node-Instanz. Sie begrenzt gleichzeitig laufende Anfragen und räumt abgeschlossene Läufe auf. Fertige Nachrichten, Prüfzusammenfassungen und Zeitstempel bleiben wie bisher in PostgreSQL gespeichert. Ein Neustart kann eine laufende Berechnung unterbrechen; es wird kein bereits laufender Auftrag automatisch erneut mit möglichen Seiteneffekten ausgeführt. Für horizontale Skalierung ist der Laufzeitspeicher durch einen gemeinsamen Job-/Event-Store zu ersetzen. Dafür ist die Transportlogik vom Orchestrator getrennt.

## Darstellung

Während der Bearbeitung sind die laufende Zeit, die aktuelle Phase und der Aufgabenplan sichtbar. Aufgaben besitzen eigene Zustände und aufklappbare Ergebnis-/Prüfdetails. Eine weitere Runde zeigt beispielsweise das konkrete abweichende Datum und die beabsichtigte Korrektur, statt pauschal „Datenlücken“ zu behaupten. Auch ein Abbruch oder ein technisches Problem bleibt in der Zeitleiste erhalten. Nach Abschluss wird dieselbe kompakte Zeitleiste aus den Nachrichten-Metadaten angezeigt.

Referenzen: [OpenAI: Streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [OpenAI: Function Calling](https://developers.openai.com/api/docs/guides/function-calling).
