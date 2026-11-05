# Microsoft Entra Login

Der normale Passwort-Login bleibt bestehen. Zusätzlich gibt es auf der Loginseite **Microsoft Login** (Single-Tenant-Webanwendung, Authorization Code Flow mit PKCE). Die Anwendung prüft Signatur, Aussteller, Ziel-App, Ablauf, Tenant und Nonce des ID-Tokens. Tokens und Client Secret bleiben im Backend; es werden keine Graph-Rechte oder Refresh-Tokens für den Login angefordert.

## Konfiguration

Im Backend (`.env.local` lokal, Render Environment produktiv):

```dotenv
ENTRA_TENANT_ID=<Directory-Tenant-ID>
ENTRA_CLIENT_ID=<Application-Client-ID>
ENTRA_CLIENT_SECRET=<Secret-WERT>
# Alternativ zum CLIENT_SECRET wird ENTRA_VALUE unterstützt. ENTRA_SECRET_ID ist kein Secret-Wert.
ENTRA_REDIRECT_URI=http://localhost:3001/api/auth/entra/callback
```

In der App-Registrierung unter Authentication die Plattform **Web** hinzufügen:

- Lokal: `http://localhost:3001/api/auth/entra/callback`
- Render: `https://<Portal-Domain>/api/auth/entra/callback`

Produktiv müssen `APP_ORIGIN` und die Redirect-URI denselben HTTPS-Ursprung haben. Lokal führt Microsoft Login über den Hostnamen der Redirect-URI zum Frontend zurück (z. B. `http://localhost:5173`), damit Browser-Cookies beim Wechsel zwischen Backend und Frontend erhalten bleiben. Passwort-Login über `127.0.0.1` funktioniert weiterhin.

Migration: `npm run db:migrate` (Migration `029-entra-login`). Die Migration ergänzt nullable Identitätsfelder an versionierten Benutzern und legt die Gruppe `Inactive` mit standardmäßig verweigerten Entity-Rechten an. Bestehende Benutzer, Kennwörter und Gruppenzuordnungen bleiben erhalten.

## Registrierung und Freischaltung

Neue Microsoft-Identitäten bekommen einen Benutzer, einen referenzierten Contact und ausschließlich die Gruppe **Inactive**. Ein zufälliges, unbekanntes Passwort verhindert die normale Passwortanmeldung, solange kein Administrator ausdrücklich ein Passwort setzt. Die Registrierung wird dem authentifizierten neuen Benutzer in der Versionshistorie zugeordnet.

Der Benutzer kann sich anmelden, sieht aber nur den Hinweis auf die ausstehende Freischaltung. Der Browser lädt weder Navigation noch Entity-Katalog. REST und MCP verweigern Anwendungszugriff serverseitig, solange die Mitgliedschaft in `Inactive` besteht, unabhängig von weiteren Gruppenrechten. Eigener Anmeldestatus und Abmeldung bleiben möglich. Öffentliche Login-/Designinformationen sind weiterhin öffentlich.

Zur Freischaltung unter User Management die gewünschten berechtigten Gruppen hinzufügen und **Inactive entfernen**. Der Benutzer kann anschließend „Status aktualisieren“ wählen oder sich neu anmelden. `users.active=false` sperrt auch Microsoft Login und vorhandene Sessions.

Wiederkehrende Logins werden ausschließlich über die geprüfte Kombination Tenant-ID und Entra-Object-ID zugeordnet. Gleiche E-Mail-Adressen verknüpfen niemals automatisch bestehende Konten: In diesem Fall wird Microsoft Login mit einem verständlichen Hinweis abgewiesen; Passwort-Login bleibt verfügbar. Die Identitätsfelder sind nicht über generische Data-/MCP-Schreibzugriffe änderbar.
