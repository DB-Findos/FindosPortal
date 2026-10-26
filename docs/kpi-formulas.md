# KPI-Formeln und Reporting

## Bedienung

Unter **Einstellungen → KPIs & Reporting** werden KPI-Formeln und Standardberichte angelegt. Der Plus-Button erzeugt einen neuen Eintrag. Der Editor erstellt die Formel ausschließlich aus angeklickten Variablen, Zahlen, Operatoren und Klammern. Ein Klick auf einen Formelbaustein setzt die Einfügeposition dahinter. Farbige Rahmen zeigen zusammengehörige Klammerbereiche, rote Markierungen unvollständige Klammern. Die Schaltfläche „Formel prüfen“ validiert auf dem Server. Die Vorschau verwendet dieselbe Engine wie das Reporting.

Variablen können mehrfach angeklickt werden. Nicht verwendete Variablen werden nicht gespeichert. Zum Ersetzen einer Quelle einen neuen Variablenbaustein hinzufügen und den alten Formelbaustein entfernen. Die Datenbank erzeugt die Klartextnamen selbst; der Client kann sie nicht überschreiben.

Berichte enthalten eine geordnete Auswahl von KPIs. Auf der Hauptseite werden Bericht, Company, Berichtsmonat und Dimension ausgewählt. Ergebniswerte werden ausschließlich im Backend berechnet; das Frontend formatiert sie nur für die Anzeige. „Berechnungsgrundlage“ zeigt die tatsächlich verwendeten Variablenwerte und Zeiträume.

## Formelsprache, Version 1

`TextEditor` enthält einen normalisierten Ausdruck wie `( A / B - 1 ) * 100`. `TextDisplay` enthält denselben Ausdruck mit den vom Server erzeugten Namen, beispielsweise `[MetricData:Revenue [1000000] · MONTH]`. `engine_version=1` fixiert die Sprachversion.

Erlaubt sind dezimale Zahlen mit Punkt, Variablen `A` bis `Z`, danach `AA`, `AB` usw., die Operatoren `+`, `-`, `*`, `/`, `^` und runde Klammern. Der Editor wandelt ein eingegebenes Dezimalkomma in einen Punkt um. Funktionen, SQL, JavaScript, Attributzugriffe und frei ausführbarer Code sind nicht erlaubt. Keine Verwendung von `eval` oder `Function`.

Prioritäten: Klammern → Potenzen → unäres Vorzeichen → Multiplikation/Division → Addition/Subtraktion. Potenzen sind rechtsassoziativ: `2 ^ 3 ^ 2 = 512`; `-2 ^ 2 = -4`; `2 ^ -2 = 0.25`. Dezimalrechnung mit 40 signifikanten Stellen; Anzeige-Rundung erfolgt separat. Division durch null, nicht reelle oder nicht endliche Ergebnisse sind Fehler. Schutzgrenzen: 4.000 Zeichen, 512 Tokens, 100 Variablen je Formel, 12 KPI-Abhängigkeitsebenen, 1.000 aufgelöste Variablen je Bericht, Exponentenbetrag höchstens 1.000.

## Variablen und Zeiträume

MetricData wird über **Metric Number + Company aus dem Bericht** auf eine aktive Metric referenziert. Damit ist dieselbe KPI über Companies wiederverwendbar. Mehrere aktive Metrics mit derselben Number innerhalb einer Company führen zu einem Fehler. `field=value` und `entity=metric_data` sind festgelegt. Die Dimension kommt aus dem Bericht oder aus einer expliziten Variablenüberschreibung, z. B. Budget-Vergleich.

| Aggregation | Zeitraum für Berichtsmonat März 2025 |
| --- | --- |
| MONTH | März 2025 |
| LTM | Summe April 2024 bis März 2025 |
| YTD | Summe Januar bis März 2025 |
| MONTH + V12P | März 2024 |
| LTM + V12P | Summe April 2023 bis März 2024 |
| YTD + V12P | Summe Januar bis März 2024 |

V12P wird als `prior_year=true` gespeichert und verschiebt zuerst den Berichtsmonat um zwölf Monate. Alle Kalendermonate werden vollständig eingeschlossen; der Tag im Berichtsdatum ändert das Ergebnis nicht. Ein vorhandener Wert `0` ist gültig. Fehlende Monate und `NULL` sind fehlende Daten und werden **nicht** zu null ergänzt. Mehrere aktive Werte derselben Metric/Dimension im selben Monat gelten als mehrdeutig, auch bei unterschiedlichen Tagen. LTM/YTD sind Summen von Monatswerten, keine Summen bereits kumulierter Jahresstände. Es findet keine automatische Währungs- oder Einheitenumrechnung statt.

`FIXED` bindet ein numerisches Feld einer verfügbaren Entity an die stabile `record_id`. Es wird immer die aktive Objektversion gelesen, unabhängig vom Berichtsdatum. Numerische Felder stehen in einem serverseitigen Katalog; Text, Kennwörter, Bilddaten und beliebige SQL-Ausdrücke sind keine mathematischen Variablen. „Fest“ bedeutet datumsunabhängig, nicht unveränderlich: eine Änderung des Quelldatensatzes wirkt auf spätere Berechnungen.

`KPI` verweist über `target_kpi_id` auf eine andere KPI. Sie wird mit demselben Berichtskontext und ihrer aktuellen Formelversion ausgewertet. Zyklen werden beim Speichern unter einem gemeinsamen Transaktions-Lock geprüft und zusätzlich zur Laufzeit abgefangen.

## Persistenz und Berechtigungen

`kpi_formulas`, `variable_map`, `report_definitions` und `report_items` verwenden wie alle anderen Entities `id`, `objectId`, `priorId`, `createdAt`, `lastModifiedAt`, `archivedAt`, `createdBy`, `modifiedBy`. Jede Änderung archiviert die aktuelle Version und erzeugt eine neue. Beim Formelwechsel erhalten sämtliche verwendeten Mappings eine neue Version. `formula_id` referenziert die logische Formel, `formula_version_id` ihre konkrete Version. Ein zusammengesetzter Fremdschlüssel garantiert die Zugehörigkeit. Historische Mappings bleiben vollständig erhalten. Berichtspositionen sind ebenfalls versioniert.

Schreibzugriffe auf diese Entities erfolgen über die spezialisierten `/api/kpi`-Routen. Generische Data-Management-Schreibzugriffe sind gesperrt. Die Entities und ihre Historie bleiben im Data Management lesbar. Optimistische Sperren mit `If-Match` verhindern Überschreiben paralleler Änderungen. Verwendete Formeln und feste Quelldatensätze können nicht archiviert werden; eigene Mappings bzw. Berichtspositionen werden zusammen mit dem Elternobjekt archiviert.

CRUD-Rechte gelten für die Formel-/Berichtsentity und ihre Mapping-/Positionsentity. Für Auswertungen sind zusätzlich Leserechte auf sämtliche verwendeten Quellen nötig, auch auf Quellen referenzierter KPIs. Neue Entities sind initial nur für Administrators freigegeben; anderen Nutzergruppen können Rechte im bestehenden User Management zugewiesen werden. Berichte sind gemeinsam nutzbare Definitionen entsprechend diesen Entity-Rechten. Einzelne fehlende oder fehlerhafte KPIs verhindern nicht die Anzeige der übrigen Berichtswerte. Berechnungen laufen in einer konsistenten, schreibgeschützten Datenbanktransaktion.

Historie dokumentiert Formel-/Mappingänderungen. Sie ist kein eingefrorener historischer Bericht: Berechnungen lesen aktuelle Datenversionen und aktuelle referenzierte KPIs, keine damaligen Snapshots.

## Standardbericht und Betrieb

`backend/src/seed-reporting.ts` legt idempotent sieben Standard-KPIs und „Standardreporting · Performance“ an: Umsatz Monat/LTM/YTD/Vorjahresmonat, Umsatzwachstum, Adjusted EBITDA Monat und Adjusted EBITDA-Marge. Grundlage sind die vorhandenen Metric Numbers **1000000 (Revenue)** und **1300300 (Adjusted EBITDA)**. Bestehende gleichnamige Definitionen werden nicht überschrieben. Absolute Werte behalten die Einheit der Quelldaten; Anzeigeeinheiten bei Bedarf im Editor pflegen. Fehlende Metrics/Monate werden ausdrücklich angezeigt.

```powershell
npm run db:migrate
node --import tsx backend/src/seed-reporting.ts
npm run build
npm start
```

Tests mit separater Branch-Umgebung, niemals Testdaten auf production:

```powershell
node --import tsx --test backend/src/tests/kpi-language.test.ts
$env:TSX_TSCONFIG_PATH='frontend/tsconfig.json'
node --import tsx --test frontend/tests/KpiEditor.test.tsx
Remove-Item Env:TSX_TSCONFIG_PATH
node --env-file=.imports/kpi-test.env --import tsx backend/src/tests/kpi-database.ts
# Test-API auf Port 3002 mit derselben Branch-Umgebung starten; zuvor seed-reporting.ts ausführen.
node --env-file=.imports/kpi-test.env --import tsx backend/src/tests/kpi-e2e.ts
```
