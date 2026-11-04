# Ansichtskontext und Chat

Der Chat erstellt beim Senden einen aktuellen Snapshot der geöffneten Ansicht. Er enthält sichtbare Texte, Tabellen, Eingaben und Filter sowie die exakten Berichtsdaten. SVG-Diagramme werden zusätzlich mit den aktuellen Theme-Farben als PNG-Bilder übermittelt. Company, Datum, Währung, Dimension und ausgewählte Serien gehören zum Kontext. Ungespeicherte KPI-Formeln, Variablen und Eingabemasken sind ausdrücklich als Entwürfe markiert.

`ViewContentProvider` verwaltet diesen Kontext ohne zusätzliche Datenbankabfragen. `useVisibleViewData(name, data)` registriert den tatsächlich gerenderten Zustand einer Component. Weitere Berichtsseiten sollten neben ihren Daten die aktuelle Auswahl und den Ladezustand registrieren. API-Leseantworten ergänzen Ansichten ohne eigene Registrierung; Auth-, Chat- und Design-Endpunkte sind dabei ausgeschlossen. Passwortfelder, Secrets und Base64-Dokumentinhalte werden nicht in den Textkontext übernommen.

Der Ansichtstext ist auf 80.000 Zeichen, strukturierte Quelldaten auf 220.000 Zeichen und Diagrammbilder auf sechs PNGs mit insgesamt 2 MB begrenzt. Auslassungen werden im Kontext ausdrücklich genannt und müssen bei Bedarf über die vorhandenen Datenbankwerkzeuge nachgeladen werden. Größen- oder Werkzeuglimits sind kein Beleg für fehlende Daten.

Seit Chat-Revision 3 wird die Anfrage zuerst geplant, anschließend je Teilaufgabe separat bearbeitet und geprüft und zuletzt zusammengeführt. Der gewählte Reasoning-Aufwand begrenzt den Workflow von Beginn an. Das vollständige Konzept, die Grenzen und der Live-Transport sind in [chat-orchestration.md](chat-orchestration.md) dokumentiert. Die alte pauschale Textprüfung auf vermutete Datenlücken wird nicht mehr verwendet.

`OPENAI_API_KEY` bleibt ausschließlich im Backend. `OPENAI_MODEL` bestimmt das vorausgewählte Arbeitsmodell; im Chat kann ein anderes freigegebenes Modell gewählt werden. `OPENAI_REVIEW_MODEL` bestimmt das separate Prüfmodell (Standard `gpt-5-mini`). Optional kann mit `OPENAI_PLANNER_MODEL` ein abweichendes Planungsmodell gesetzt werden; ohne diesen Wert wird das Prüfmodell verwendet. Die bestehenden API-Schlüssel werden weiterverwendet.

`get_company_report` berechnet Bridge und Income Statement mit denselben Engines wie die Oberfläche. Ohne explizites Datum gilt der letzte verfügbare Datenmonat. Gespeicherte KPIs werden mit `evaluate_kpi` berechnet. Erfolgreiche Leseergebnisse werden mit normalisierten Parametern innerhalb des gesamten Auftrags wiederverwendet. Vorschläge bleiben bis zur Bestätigung durch den Nutzer ungespeichert.

`POST /api/ai/chat/runs` nimmt einen Auftrag an, ohne dessen Ergebnis abzuwarten. SSE und kurze Statusabfragen liefern den Live-Fortschritt unabhängig vom langen Modellaufruf. `POST /api/ai/chat/runs/:id/cancel` fordert einen Abbruch an. Die vorhandene Route `/api/ai/chat` bleibt für ältere Clients verfügbar, verwendet aber bereits den neuen Orchestrator. Die neue Oberfläche erfordert Chat-Revision 3, damit sie niemals stillschweigend auf den alten, möglicherweise gepufferten Transport zurückfällt.

Der Aufgabenplan, öffentliche Prüfzusammenfassungen, Fortschritt und Budgets werden in den bestehenden Nachrichten-Metadaten gespeichert; eine Datenbankmigration ist dafür nicht nötig. Es werden keine internen Gedankengänge veröffentlicht. Fertige Chatverläufe bleiben wie bisher benutzergebunden abrufbar. Aktive Läufe sind derzeit an eine Node-Instanz gebunden; weitere Betriebshinweise stehen im Orchestrierungskonzept.

Nach einer Codeaktualisierung `npm run build` ausführen und den Backend-Prozess neu starten beziehungsweise auf Render neu deployen. Anschließend die Anwendung neu laden, damit neue Oberfläche und Backend zusammenpassen.

Offizielle Dokumentation: [Streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Function Calling](https://developers.openai.com/api/docs/guides/function-calling), [strukturierte Ausgaben](https://developers.openai.com/api/docs/guides/structured-outputs).
