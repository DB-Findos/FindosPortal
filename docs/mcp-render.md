# Findos Portal MCP und Render

Der Server ist im bestehenden Express-Backend integriert. Der Endpunkt ist `POST /mcp` mit MCP Streamable HTTP (stateless, JSON-Antworten). Frontend, API und MCP können zusammen als ein Render Web Service laufen. Neon bleibt die Datenbank; keine Migration erforderlich.

Der Anwendungs-Chat verwendet dieselbe Werkzeugregistrierung, Parameterprüfung und Services direkt im Backend. OpenAI führt iterativ Function Calls aus; es werden keine Datenbank-Zugangsdaten an das Modell geschickt. Ein zusätzlicher HTTP-Aufruf an den eigenen MCP ist intern nicht nötig. Externe MCP-Clients nutzen `/mcp`.

## Auf Render starten

1. Projekt inklusive `package-lock.json` und `render.yaml` in ein privates Git-Repository pushen. `.env.local`, `.mcp-tokens` und `.imports` bleiben lokal. `.env.example` enthält nur Platzhalter.
2. In Render **New → Blueprint** wählen, Repository verbinden, `render.yaml` übernehmen. Die Vorlage verwendet einen kostenpflichtigen Starter Web Service; den Plan bei Bedarf vor dem Anlegen ändern.
3. Folgende Environment Variables setzen:

| Variable         | Wert                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Bestehende Neon-Verbindungszeichenfolge aus `.env.local`, bevorzugt gepoolt                       |
| `JWT_SECRET`     | Dasselbe Secret wie lokal, wenn lokal erzeugte MCP-Tokens verwendet werden; mindestens 32 Zeichen |
| `APP_ORIGIN`     | Exakte Render-URL, z. B. `https://findos-portal.onrender.com`, ohne abschließenden Slash          |
| `OPENAI_API_KEY` | Bestehender Schlüssel; nur für den integrierten Chat erforderlich                                 |
| `OPENAI_MODEL`   | `gpt-5-mini`, oder die bisher verwendete Modellkennung                                            |

Die Vorlage setzt `HOST=0.0.0.0`, `NODE_ENV=production`, `TRUST_PROXY=1`. Render setzt `PORT`. Optional `MCP_ALLOWED_ORIGINS` als kommaseparierte Liste für Browser-Clients; ohne Origin-Header funktionieren serverseitige MCP-Clients. Browser-CORS ist nicht aktiviert: Browser nutzen die gleiche Origin oder einen eigenen Backend-Proxy.

Build: `npm ci --include=dev && npm run build` · Start: `npm start` · Health Check: `/api/health`.

Es werden weder Seed noch Migration beim Start ausgeführt. Bestehende Nutzer und Daten bleiben erhalten. Nach dem Deployment ist die App unter der Render-URL erreichbar, der MCP unter `https://DEIN-SERVICE.onrender.com/mcp`.

## MCP-Zugang erzeugen

Im Projektordner, mit `.env.local` und einem existierenden aktiven Benutzer:

```powershell
npm run mcp:token -- --email DEINE-ANMELDE-EMAIL --days 7
```

Für Zugriff auf die bestätigte Übernahme zusätzlich `--write`:

```powershell
npm run mcp:token -- --email DEINE-ANMELDE-EMAIL --days 7 --write
```

Der Token wird in `.mcp-tokens/` gespeichert, nicht im Terminal ausgegeben. Er ist 1–30 Tage gültig, nur für MCP nutzbar und an den Nutzer gebunden. Dessen aktive Gruppenrechte werden bei jedem Request erneut gelesen. Deaktivierung des Nutzers sperrt den Zugriff, Wechsel des `JWT_SECRET` widerruft sämtliche Tokens und Web-Sessions. Einzelne Token-Widerrufe/OAuth sind noch nicht implementiert.

Im MCP-Client konfigurieren:

```json
{
  "mcpServers": {
    "findos-portal": {
      "url": "https://DEIN-SERVICE.onrender.com/mcp",
      "headers": { "Authorization": "Bearer TOKEN_AUS_DER_DATEI" }
    }
  }
}
```

Die genaue Konfiguration heißt je nach Client `headers` oder `http_headers`; nutze dessen Secret-/Environment-Verwaltung. Ein Link im Prompt allein verbindet keinen MCP: Der Client muss Streamable HTTP und einen konfigurierbaren Bearer-Header unterstützen. OAuth-only Connectors benötigen später einen OAuth-Adapter. Zugangstoken niemals in den Prompt schreiben.

Optional in der OpenAI Responses API als Remote-MCP-Tool (Aufruf von einem eigenen Backend):

```js
{
  type: 'mcp',
  server_label: 'findos_portal',
  server_url: 'https://DEIN-SERVICE.onrender.com/mcp',
  authorization: process.env.FINDOS_MCP_TOKEN,
  require_approval: 'always'
}
```

Das Render-Backend braucht keinen `FINDOS_MCP_TOKEN`; dieser gehört in den externen Client. Der interne Portal-Chat verwendet den angemeldeten Nutzer, keine gemeinsam genutzte Admin-Identität.

## Verfügbare Werkzeuge

| Werkzeug           | Zweck                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `list_entities`    | Alle registrierten, lesbaren Entities mit Rechten und Referenzen                                                         |
| `describe_entity`  | Felder, Datentypen aus Postgres, Pflichtfelder, ausgehende/eingehende Beziehungen                                        |
| `query_entities`   | Filter, Feldwahl, Sortierung, Paging und INNER/LEFT JOINs über Referenzen                                                |
| `get_record`       | Datensatz und paginierte Versionshistorie per objectId                                                                   |
| `resolve_metric`   | Metric Number über Namen/Teilbegriffe finden, optional Company-Filter                                                    |
| `list_views`       | Eigene gespeicherte Such-Views und Definitionen                                                                          |
| `get_kpi_guide`    | Formelgrammatik, Variablenformat, numerische Quellen und Company-/Zeitkontext                                            |
| `get_formula`      | KPI samt zugehöriger VariableMap-Version                                                                                 |
| `validate_formula` | Serverseitige Validierung und TextDisplay                                                                                |
| `evaluate_kpi`     | Entwurf oder gespeicherte KPI für Company/Datum/Dimension auswerten                                                      |
| `run_report`       | Gespeicherten Bericht auswerten                                                                                          |
| `propose_change`   | Validierte Vorschau für Formel, Report, View, Datensatz oder Archivierung                                                |
| `commit_change`    | Vorschau mit Schreibberechtigung übernehmen; externe Clients müssen die Nutzerbestätigung für dieses Werkzeug aktivieren |

Außerdem: Resource `findos://data-model` und MCP-Prompt `portal-assistant` mit der Arbeitsanleitung.

Alle aktuell registrierten Anwendungs-Entities sind zugänglich, soweit der Nutzer Leserechte hat. Neue Entities werden über `backend/src/entities.ts` registriert und erscheinen automatisch. Keine freien SQL-/DDL-Befehle. Passwortwerte sind ausgeschlossen; Passwörter und Nutzerkonten werden über die Nutzerverwaltung geändert. Systemkatalog/VariableMap/Report Items werden über ihre spezialisierten Services geschrieben. Private Views sind nur für ihren Besitzer sichtbar. Bilder sind mit Metadaten zugänglich; Base64-Daten nur per expliziter Feldwahl in `get_record`.

Abfragen sind auf Seiten mit maximal 100 Zeilen begrenzt. `hasMore` und `nextOffset` beachten. Referenzen verwenden `objectId`; Änderungen benötigen die gelesene Version `id` als `expected_version`. Die vorhandene Historisierung, Referenzprüfung und KPI-Engine gelten auch hier.

Vorschläge sind 30 Minuten gültig, unveränderbar signiert und an den Nutzer gebunden. Beim Commit werden Rechte und Versionen erneut geprüft. Wiederholtes Erstellen desselben signierten Vorschlags erzeugt keinen zweiten Datensatz, auch nach Server-Neustart. Wiederholte Updates/Archivierungen scheitern nach dem ersten Erfolg an der Versionsprüfung; bei Netzwerkfehlern den aktuellen Datensatz lesen. Veraltete oder abgelaufene Vorschläge neu erstellen lassen.

## Beispielprompts und Untersuchung

> Nutze den Findos-MCP. Untersuche zunächst Entities, Beziehungen und den KPI-Leitfaden. Erstelle Revenue Effect, Margin Effect und Net Debt Effect als Vorschläge. Entry-Werte kommen aus DealData mit DealType Entry. Suche Net Debt (Broad Definition) nach Namen. Die Kennzahlen gelten für alle Shareholder ohne Findos-Bezug. Prüfe die Formeln, bevor du sie zur Übernahme anbietest.

Beispiel `query_entities`, um Entry-Deals einer Company zu prüfen:

```json
{
  "definition": {
    "entity": "deal_data",
    "joins": [{ "alias": "deal_type", "from": "root", "field": "deal_type_id", "type": "inner" }],
    "fields": [
      { "alias": "root", "field": "objectId" },
      { "alias": "root", "field": "ebitda_ltm" },
      { "alias": "deal_type", "field": "name" }
    ],
    "filters": [
      { "alias": "root", "field": "company_id", "op": "eq", "value": "COMPANY_OBJECT_ID" },
      { "alias": "deal_type", "field": "name", "op": "eq", "value": "Entry" }
    ],
    "order": []
  },
  "limit": 20,
  "offset": 0
}
```

Der interne Chat darf bis zu 12 Modellrunden, 40 Werkzeugaufrufe und rund 4 Minuten pro Nachricht verwenden; einzelne Modellaufrufe maximal 90 Sekunden. Vorschlagskarten entstehen direkt aus erfolgreich validierten Werkzeugergebnissen. Ein Klick übernimmt die Änderung, und die API-Kontexte laden sichtbare Daten neu.

## Schnelle Prüfung

```powershell
npm run build
npm run test:mcp:smoke
```

Der Smoke Check verwendet `ADMIN_EMAIL` aus der lokalen Konfiguration, startet eine temporäre API auf freiem lokalen Port und beendet sie anschließend. Er prüft Authentifizierung, Ursprung, MCP-Handshake, Tool-Liste, echte Schema-/Metric-Abfragen sowie eine ungespeicherte Formelvorschau. Keine Datenbankänderungen, keine OpenAI-Aufrufe.

Technische Referenzen: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling), [OpenAI Remote MCP](https://developers.openai.com/api/docs/guides/tools-remote-mcp), [Render Blueprint](https://render.com/docs/blueprint-spec).
