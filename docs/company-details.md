# Unternehmensdetails

Der Tab **Details** in der Portfolio-Unternehmensansicht zeigt Stammdaten, Adresse,
den verknüpften Fonds sowie Personen und ihre Rollen. Unternehmenskontakte und
das interne Findos-Team werden getrennt dargestellt. Beide verwenden bestehende
`contacts`; eine interne Person benötigt für diese Zuordnung keinen Portal-Login.
Mehrere Rollen je Person und Unternehmen sind möglich.

## Rechte

- Der Tab erfordert `companies.can_read`.
- Stammdaten bearbeiten erfordert `companies.can_update`.
- Der Fonds wird nur mit `funds.can_read` angezeigt.
- Personenbereiche erfordern `company_contacts.can_read` und `contacts.can_read`.
- Verknüpfen, Ändern und Entfernen erfordern die jeweilige Create-, Update- oder
  Delete-Berechtigung auf `company_contacts`.
- Kontakt anlegen bzw. bearbeiten erfordert separat Create bzw. Update auf `contacts`.
- Diese Rechte werden serverseitig geprüft. Verknüpfungen verwenden dieselbe
  Versionierung, Änderungshistorie und Konfliktprüfung wie andere Entities.
- Entfernen archiviert nur die Verknüpfung; der Kontakt bleibt erhalten.

Auch die übrigen Unternehmens-Tabs werden anhand der Leserechte ihrer Datenquellen
gefiltert. Nicht erlaubte Tab-URLs zeigen den ersten erlaubten Tab.

## Datenbank

Migration `028-company-details` ergänzt optionale Adress-/Kontaktfelder in
`companies` und die versionierte Entity `company_contacts`. Neue Rechte werden
zunächst nur für die Administratorengruppe aktiviert. Andere Gruppen erhalten
sie über die bestehende Berechtigungsverwaltung.

Vor dem Einsatz muss die Migration über den vorhandenen Migrationsprozess
angewendet werden (`npm run db:migrate`). Zuerst in einer Testdatenbank prüfen.

Tests: `npx tsx --test backend/src/tests/company-details.test.ts frontend/tests/company-tabs.test.ts`.
