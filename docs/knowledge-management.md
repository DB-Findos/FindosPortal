# Knowledge Management

Der integrierte Portalbereich ist über die Anwendungskachel und `/knowledge` erreichbar. Er verwendet die vorhandene Anmeldung, Berechtigungen, Designsprache und den anwendungsweiten KI-Chat.

## Datenmodell und Bearbeitung

Migration `025-knowledge-management` ergänzt vier versionierte Entities:

| Entity | Inhalt |
| --- | --- |
| `knowledge_spaces` | Bereiche, z. B. Findos Wiki und Deal Team |
| `knowledge_sections` | Abschnitte eines Bereichs |
| `knowledge_entries` | Artikel, Unterseiten, Typ, Tags, HTML und durchsuchbarer Klartext |
| `knowledge_documents` | Technische Zuordnung von Vorlagen zu Knowledge-Einträgen; zentrale Dokumentmetadaten stehen in `documents` |

Alle verwenden die bestehende unveränderliche Historisierung mit `objectId`, `priorId`, Erstellern und Bearbeitern. Änderungen erzeugen eine neue Version. Der verantwortliche Benutzer wird serverseitig auf den angemeldeten Bearbeiter gesetzt; auch ein Vorlagen-Upload oder das Entfernen einer Verknüpfung versioniert den zugehörigen Eintrag. Änderungen fremder Versionen werden über `If-Match` mit HTTP 409 abgewiesen.

Die spezialisierten Endpunkte liegen unter `/api/knowledge`. Generische Data-Management- und MCP-Schreibzugriffe auf diese Entities sind gesperrt, damit HTML-Bereinigung, Benutzerzuordnung und Strukturregeln immer angewendet werden. Lesen bleibt entsprechend den Entity-Berechtigungen möglich. Bestehende Nutzergruppen erhalten Lesezugriff sowie Erstellen/Bearbeiten von Einträgen und Vorlagen; das Anlegen von Bereichen/Abschnitten und Entfernen von Vorlagen bleibt Administratoren vorbehalten. Die Berechtigungen sind anschließend über das bestehende Berechtigungsmodell änderbar.

Der native Rich-Text-Editor verwendet `contenteditable`, Selection/Range und die Undo-Historie des Browsers, ohne zusätzliche Editor-Bibliothek. Unterstützt werden Überschriften, Listen, Hervorhebungen, Ausrichtung, Zitate, Links und Tabellen. Eingefügtes HTML wird im Browser und vor dem Speichern nochmals auf dem Server bereinigt. Skripte, eingebettete Inhalte und fremde Formatierungen werden entfernt. Details und Versionsübersicht stehen einklappbar unter der Überschrift.

## Themen und Aktualitätsprüfung

Nutzer außerhalb der Gruppe `Administrators` wechseln in der Knowledge-Navigation zwischen **Meine Themen** und **Alle Themen**. Meine Themen filtert serverseitig nach `responsible_id` des angemeldeten Benutzers; Bereiche und Abschnitte bleiben erhalten. Eigene Unterseiten ohne eigenen übergeordneten Eintrag werden im jeweiligen Abschnitt direkt angezeigt. Administratoren sehen alle Einträge sowie eine Übersicht mit Gesamtzahl, Einträgen mit Inhalt, geprüften aktuellen Einträgen und offenen Prüfungen. Diese Filter ersetzen nicht die vorhandenen Entity-Berechtigungen.

Migration `027-knowledge-reviews` ergänzt `upToDate` (anfangs false), `reviewCycleMonths` (anfangs 12), `reviewedAt`, `reviewedBy` und `reviewDueAt`. Im Editor kann der Benutzer einen Zyklus von 1–120 Monaten einstellen und den gepflegten Inhalt als geprüft bestätigen. Speichern mit aktivierter Bestätigung setzt Prüfzeit und Prüfer auf den aktuellen Zeitpunkt und Benutzer. Die Datenbank berechnet den nächsten Termin mit Kalendermonaten. Leere Inhalte können nicht als aktuell bestätigt werden.

Abgelaufene Bestätigungen erzeugen automatisch eine neue, nicht aktuelle Objektversion. Ein schlanker, gegen parallele Ausführung gesicherter Prozess prüft beim API-Start und alle fünf Minuten; Knowledge-Aufrufe und lesende Data-Management-Aufrufe prüfen ebenfalls, höchstens einmal pro Minute. Die Hintergrundaktion verwendet den aktiven `ADMIN_EMAIL`-Benutzer als Audit-Akteur und verändert die fachliche Verantwortlichkeit nicht. Knowledge-Anzeigen prüfen zusätzlich den Fälligkeitstermin, damit abgelaufene Bestätigungen sofort als offen erscheinen. Der Chat-Schalter liegt anwendungsweit unten rechts mit Abstand zur Gerätekante.

## Import der Ausgangsinhalte

Nach der Migration:

```powershell
node backend/dist/import-knowledge.js "C:/Users/baumann/Downloads/Knowledge_Management_v2.html" --apply
```

Ohne `--apply` wird die Transaktion zurückgerollt. Das Skript liest ausschließlich das Seed-JSON der HTML-Datei und führt keinen Demo-Code aus. Importiert werden Findos Wiki (25 Einträge) und Deal Team (48 Einträge, in der Vorlage `deal`/Deal Management). Abschnitte, Unterseiten, Tags, Originalverweise und vorhandene Inhalte bleiben erhalten. Zwanzig Wiki-Einträge enthalten in der Vorlage lediglich einen Titel/Quellverweis und bleiben entsprechend ohne erfundenen Artikelinhalt.

Stabile Quellschlüssel verhindern doppelte Importe und schützen zwischenzeitliche Bearbeitungen. Der erste Import wird dem aktiven Benutzer aus `ADMIN_EMAIL` zugeordnet. Vorhandene Einträge und die Originaldatei werden lokal unter dem von Git ausgeschlossenen Verzeichnis `.imports/knowledge` gesichert. Originale Autorenangaben bleiben ausschließlich als Quellenmetadaten erhalten.

## Vorlagen in SharePoint

Ziel ist der technische Speicherordner KM in der Site Data & AI. Nutzer laden Vorlagen ausschließlich über die Anwendung herunter; SharePoint-Zugriff erfolgt serverseitig mit der App-Registrierung und erfordert keine direkten Nutzerfreigaben. Die Standardkonfiguration enthält die konkrete Drive- und Ordner-ID. Das Backend prüft den Zielordner vor dem Upload. Die App verwendet Microsoft Graph mit folgenden Backend-Umgebungsvariablen:

```dotenv
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
```

Die vorhandenen Variablen `GRAPH_TENANT`, `GRAPH_APPLICATION_ID` und `GRAPH_VALUE` werden ebenfalls unterstützt (Tenant-ID, Client-ID und Client-Secret-Wert). Alternativ werden die gleichnamigen Variablen mit Präfix `AZURE_`, `MICROSOFT_`, `GRAPH_` oder `SHAREPOINT_` unterstützt. Optional überschreiben `KM_SHAREPOINT_DRIVE_ID` und `KM_SHAREPOINT_FOLDER_ID` die Ordnerreferenz. Die Registrierung benötigt Schreibzugriff auf diese Site. Zugangsdaten bleiben im Backend.

Vorlagen bis 25 MB werden binär direkt vom Backend in SharePoint hochgeladen. In PostgreSQL stehen ausschließlich Referenzen und Metadaten. Migration `026-document-registry` registriert jedes Dokument zusätzlich automatisch in der zentralen Entity `documents`, sichtbar als Dokumente im Data Management; Dokumenttypen und Herkünfte sind eigene Stammdaten. Siehe [Zentrales Dokumentregister](documents.md). Dateinamen erhalten einen eindeutigen Präfix. Scheitert die anschließende Datenbankspeicherung, wird die gerade hochgeladene Datei wieder entfernt. Das Entfernen einer vorhandenen Vorlage im Portal archiviert dagegen nur ihre Verknüpfung; die SharePoint-Datei bleibt für ältere Versionen verfügbar.

## Durchgeführte Prüfung

- Vollständiger Frontend-/Backend-Build.
- Migration und Import auf einem isolierten Neon-Zweig; Abgleich aller 73 Einträge.
- API-Prüfung von Versionierung, Benutzerzuordnung, Feldvalidierung, Schreibschutz, Suche und HTML-Bereinigung.
- Prüfung des Upload-Ablaufs mit echter isolierter Datenbank und simuliertem Microsoft Graph: Binärinhalt, Metadaten, Zugriffsfehler, ungültige Dateiendung, Größenabweichung und Archivierung.
- Separate Edge-Instanz bei Desktop-, iPad- und Mobilgrößen: Darstellung, Details, Formatierung, Undo/Redo, Tabellen und sicheres Einfügen; keine Seitenüberläufe.

Ein echter Upload mit der App-Registrierung konnte lokal nicht geprüft werden, da dem Testprozess keine Microsoft-Zugangsdaten vorlagen. Die tatsächliche Registrierung und deren SharePoint-Berechtigungen werden erst mit der konfigurierten Backend-Umgebung wirksam.
