# Findos Portal

React + TypeScript + Vite in `frontend/`, Node.js + Express + TypeScript in `backend/`. PostgreSQL is linked to Neon project `jolly-king-25750737`, branch `production` (org `org-winter-grass-84243314`). `neon deploy` provisions the database configuration; it does not host the React or Express application.

## Start

```powershell
npm install
npx neon@latest deploy
npm run setup:env
# The initial email and randomly generated password are in .env.local.
# You can change ADMIN_EMAIL / ADMIN_PASSWORD before the first migration.
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: http://127.0.0.1:5173 · API: http://127.0.0.1:3001. Seed creates the initial administrator once and does not overwrite existing passwords. Credentials are read from `.env.local`, never committed. No public registration.

```powershell
npm run build
npm start
```

Express then serves the compiled frontend at http://127.0.0.1:3001. In local development both the configured Vite origin and the Express loopback origin are accepted. For external hosting, set `APP_ORIGIN` to the actual HTTPS origin and `NODE_ENV=production` (secure cookies); place Express behind an HTTPS reverse proxy. The server binds to loopback. Configure the reverse proxy and any trusted proxy hop explicitly for your deployment.

## KI-Chat

Set `OPENAI_API_KEY` in `.env.local` to enable the application-wide **Findos KI** sidebar. `OPENAI_MODEL` is optional and defaults to `gpt-5-mini`. The key remains exclusively in the Express backend. The chat receives the current route/view and the permitted application data model. It can explain entities and propose KPI formulas; a formula is written only after the user selects **Formel übernehmen**, where it passes the same permissions and formula validation as the normal KPI editor.

## Data model

Application tables live in the separate `portal` schema, preserving existing schemas. The Data Management tree lists thirteen entities, including Images and Design Settings. The entity catalog is read-only; schema changes go through tracked SQL migrations, not arbitrary SQL from the browser.

- `users.contact_id → contacts.objectId` (mandatory, one contact per current user)
- `companies.fund_id → funds.objectId` (mandatory)
- `metrics.company_id → companies.objectId` (mandatory)
- `metric_data.metric_id → metrics.objectId` (mandatory)
- `user_group_memberships` joins users to one or more groups.
- `permissions` contains unique group/entity pairs with create/read/update/delete flags. Every new group starts with one deny-all row per entity. Group grants combine with OR; no group means no access.
- MetricData has a date, numeric value and actual/budget/forecast scenario; each metric/date/scenario combination is unique. Referenced business parents cannot be deleted while children exist.

Create a Contact first, then a User referencing it. Create groups in User Management. Assign users in Data Management → Membership. Edit group rights in Data Management → Permission. These actions require the corresponding entity permissions. Reference dropdowns require read access to their target entities. Avoid removing the last administrator's group or administrative grants; recovery would require a database administrator.

## Findos master data import

`backend/src/import-master-data.ts` imports only Fund IDs/names/currencies and Company IDs/names/fund references/industries/websites from a locally prepared Findos MCP snapshot. Dynamo's `Investor` entity is labeled Company. Fund references use the raw source IDs, since resolved display strings can be incomplete. Source IDs become portal IDs so repeat imports do not create duplicates. Existing conflicting records cause a rollback and are never overwritten. Empty values stay null; valid bare website hostnames receive `https://`; invalid websites are omitted. Companies without exactly one known Fund are reported and skipped to honor the mandatory relationship.

The confidential snapshot is kept in the gitignored `.imports/findos-master-data.json`; it is not served to the frontend or committed. Preview with `npx tsx backend/src/import-master-data.ts` (transaction rolled back). Apply with `npx tsx backend/src/import-master-data.ts --apply`. Both modes read back and compare all selected fields and Fund links before finishing. The import does not create additional entities or copy reporting/custom fields.

## Internal names and Metrics workbook

Company `internal_name` is populated from SharePoint `PBI/Aktuell/DIM_Company.xlsx`, matching its unique `Name (ID)` to the existing Company record and then updating by Company UUID. It is editable and visible in Data Management. Metrics retain the workbook's `Internal ID` as their stable `objectId` (and initial version ID) and reference the matched Company through its logical UUID. Imported fields are name, metric number, unit, currency, section, important flag and description. The source creation date is retained in the local source snapshot; portal `createdAt` records the import time. No MetricData values are created from this definitions-only workbook.

The read-only extractor is `backend/scripts/extract-xlsx.ps1`; it decodes XLSX XML without executing formulas or embedded content and rejects formula/error cells. Input workbooks and extracted JSON stay in `.imports/`. `backend/src/import-metrics.ts` verifies the source workbook's SHA-256, exact unique Company matches, all imported fields and foreign keys in a transaction. Run without flags for a rolled-back preview, or with `--apply` to commit. Repeated imports reuse IDs; differing existing metrics or internal names cause a rollback. Detailed row-level exclusions and provenance are written to `.imports/metrics-import-report.json`.

The 19 October 2026 import contains 4,153 valid Metric definitions for 21 existing Companies, plus Internal Names for all 30 Companies. It excludes 483 rows for the two model Companies and Test Company that were intentionally not imported, plus one unnamed Medperion row with no metric number/unit. The importer reports these omissions and blocks unexpected unmatched companies.

## IndexRates

`portal.index_rates`, shown as **IndexRates** in Data Management, stores the six columns from SharePoint `PBI/Aktuell/Index Exchange Rate Values.xlsx`: name, as-of date, base currency, currency, index value and period. The first import includes all 994 source rows for EUR/CHF, EUR/DKK, EUR/EUR and EUR/NOK. Name labels contain snapshot dates; those labels are preserved and are not used to infer the rate's date. Dates come from the actual Excel date columns and remain date-only strings through the API. Rate values use exact `numeric(24,10)` storage and must be positive. Base currency/currency/as-of-date is unique.

`npx tsx backend/src/import-index-rates.ts` previews the import in a rolled-back transaction; add `--apply` to commit. Source files, SHA-256 provenance and readback verification reports are in the gitignored `.imports/` folder. Existing equal rates are reused; conflicting rows cause a rollback. No source rows are omitted. The new entity has the same CRUD permissions and field selector as other tables. The initial migration grants existing Administrators access only when first registering this entity; later migrations preserve permission edits. Other existing groups and all newly created groups start with no access to IndexRates.

## Architecture

Frontend: `main.tsx` wires providers and BrowserRouter only. `app/` owns routes, `pages/` owns screens, `layouts/` owns shells, `components/` contains individual layout/data/common components, `contexts/` contains API, authentication and theme providers, `types/` contains contracts and `utils/` contains shared labels. All HTTP requests use `useApi()`; cookies remain HttpOnly. Routes include `/login`, `/`, `/settings/users`, `/settings/users/groups`, `/settings/data/:entity` and `/settings/design`. The fixed Topbar remains visible while scrolling. Field selection is remembered per entity in browser storage.

Backend: `server.ts` starts/stops the process, `app.ts` assembles middleware and routers, `routes/` handles HTTP, `middleware/` handles JWT/errors, `repositories/` implements transactional versioned persistence, `services/` handles image validation/import actors/bootstrap, and `migrations/` contains tracked database changes. `npm run format` and `npm run format:check` enforce one formatting configuration.

## Design & Layout

The application-wide design has six colors: primary, secondary, accent, background, surface and text. Saved values are applied through CSS variables; readable text on primary buttons is derived from the selected primary color. The logo appears on the login page and fixed Topbar. PNG, JPEG and WebP up to 1 MiB are accepted, validated by type/signature and stored as raw Base64 in the versioned Images entity. SVG is not accepted. The Design Settings entity references the logo's logical `objectId`. Replacing a logo creates a new Image version. Removing it archives the active Image after updating the settings. Logo and palette writes commit together. The public `/api/design` read endpoint exposes only branding needed by the login screen; changing it requires the corresponding Design Settings and Images permissions.

## Object versioning

Every domain entity has exactly the requested metadata: `id` identifies a version, `objectId` the logical object, `priorId` the preceding version, `createdAt`/`createdBy` the original creation, `lastModifiedAt`/`modifiedBy` the new version's creation and `archivedAt` its retirement. Updates lock the current row, archive it, then insert its successor in one transaction. Deletion archives; it does not remove history. Old business values and creator metadata cannot be changed. Unique business keys apply to current versions; only one current version and one successor per prior version are permitted. All lists and authentication/permissions use current versions.

References and JWT subjects use stable `objectId`, anchored in the internal `object_registry` table, with entity-type checks and active-reference validation. Historical versions retain their references. `schema_migrations` and `object_registry` are infrastructure, not additional domain entities. Existing source UUIDs are preserved as logical IDs. Existing creation timestamps are preserved; creator metadata for pre-versioning rows is backfilled to the existing administrator who owned the migration. A protected local pre-migration snapshot is saved in `.imports/backups/` (contains sensitive application data, never commit it).

API: create via `POST /api/data/:entity`; update/archive via `PATCH`/`DELETE /api/data/:entity/:objectId` with `If-Match: <current version id>`. A stale version returns HTTP 409. Read history via `GET /api/data/:entity/:objectId/history`, or the history button in the table. Password hashes are excluded from current responses and history. The repository is the required path for updates; database triggers reject unversioned mutations and physical deletes. Group/user removal archives associated authorization relationships. Imported source records are compared using logical IDs and current versions; the import tools set an audited actor and use versioned updates when needed.

## Authentication

Own JWT middleware verifies HS256, issuer, audience and expiry. Tokens live in HttpOnly, SameSite=Strict cookies (Secure in production), expire after eight hours, and are never stored in localStorage. Every protected request checks the active user and current database permissions. Passwords use bcrypt (cost 12). The API validates inputs, uses parameterized values and an entity/column allowlist, limits login attempts, rejects foreign-origin mutations and requires a custom request header. Logout clears the browser cookie; previously copied tokens remain valid until expiry unless the account is deactivated. No refresh tokens or password recovery flow yet.

## Database & verification

The long-lived Express process uses a shared, node-postgres-compatible pool. For Neon URLs it defaults to the official `@neondatabase/serverless` WebSocket transport over encrypted port 443, including interactive transactions. This keeps login and versioned writes working on networks where PostgreSQL TCP port 5432 is unreachable. Other PostgreSQL hosts use `pg` over TCP. Set `DB_TRANSPORT=tcp` or `DB_TRANSPORT=websocket` to override the selection. Pool/Client query and transaction methods are shared through `database/connection.ts`; both transports preserve date-only values. See the [official Neon driver documentation](https://github.com/neondatabase/serverless).

`DATABASE_URL` is backend-only. Migrations use the same connection factory with `DATABASE_URL_UNPOOLED` when supplied; otherwise they derive the direct Neon host from the pooled URL. Migration is transactional and repeatable. Existing unrelated tables are not modified. Temporary database connection failures return HTTP 503 with a useful message instead of a generic login error. Run `npx tsx --test backend/src/tests/database-transport.test.ts` for transport/date/error-response regression checks.

With the built app running, `npm run test:e2e` checks authentication, stable object relationships, version chains, immutable history, optimistic concurrency, current group grants, account deactivation, logo Base64/versioning, six-color persistence and BrowserRouter deep links. Temporary test objects are archived in reverse dependency order; their histories remain. Design tests restore the previous visible branding but also leave audit history. Run these tests on an isolated database branch, with `TEST_BASE_URL` targeting that branch's local API. `backend/src/tests/migration-integrity.ts` checks metadata, source counts and direct SQL mutation protection. Migration 002 and the complete E2E suite were tested on a temporary Neon copy of production before applying to production. The migration runner tracks applied migrations and never reruns the old baseline against versioned tables.
## MCP und Render

Der MCP-Endpunkt `/mcp` und der integrierte KI-Chat verwenden gemeinsame Werkzeuge für Datenmodell, Abfragen, KPI-Validierung und bestätigte Änderungen. Deployment, Tokens, Client-Konfiguration und Beispiele: [MCP/Render-Anleitung](docs/mcp-render.md).

