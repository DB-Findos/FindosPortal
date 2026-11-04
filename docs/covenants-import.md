# Covenant import

`npm run db:import-covenants -- --file="C:/path/Findos_Covenants_Datenbankinput.xlsx"`

Run `npm run db:migrate` first. The import uses the existing DATABASE_URL and ADMIN_EMAIL audit actor. Without `--apply`, the script rolls back its transaction. The npm command includes `--apply`.

The source workbook is input data, including its ReadMe; no embedded instructions are executed. The namespace-aware OOXML reader handles its prefixed XML without rewriting the workbook. Empty cells stay null, cached formula errors or invalid keys abort the import.

## Mapping

`backend/src/services/covenant-import-mapping.ts` records every Company/Covenant assignment explicitly. Ann-Sophie maps to the existing Angelina Company. Company IDs, existing Metric objectIds and existing Metric Numbers stay unchanged. Leverage Ratio / Senior Leverage keep 4004100. The existing second Covenant slot remains 4004200 and receives the company's canonical name, such as DSCR or Cash Flow Cover. Targets are separate Metrics at base number + 1, using dimension actual rather than budget.

Additional, distinct Covenants get separate numbers. Alexa's EBITDA/Net Interest remains separate from Interest Cover Ratio; Carl's Gross Leverage Ratio and Julia's Leverage Ratio (excl. VL) remain separate from Leverage Ratio. Baldo keeps its existing Liquidity (4004300) and EBITDA (4004400) identities, renamed Minimum Liquidity and Minimum EBITDA. Sissi's Interest Cover keeps 4004400. All assignments are saved in the import report.

## Values, status and units

Current is the authoritative current Value/Target dataset. Missing rows are skipped and never erase an existing value. Explicit statuses (including Waived) are stored even when Amount is null and can replace an earlier numeric value. A waived value with a number preserves both. No null is converted to zero. Ratios have unit Ratio and no currency; raw absolute amounts remain unchanged. The workbook does not substantiate the units/scales for Baldo's Minimum EBITDA / Minimum Liquidity, Pagode's Minimum Cash / Minimum EBITDA, or Valeria's Capex. Their source_unit and unit_confirmed=false remain recorded; no currency/scale conversion is inferred. Existing absolute Metric unit/currency metadata is preserved, while new unknown absolute Metrics use Unspecified and no asserted currency.

PeriodEnd is preserved in source_data. MetricData.period uses the existing first-of-month convention for that same quarter-end month. No forward filling or creation of unobserved quarters. Exceptions and raw Sources are not promoted into additional current observations. The complete workbook and pre-import database rows are saved locally under .imports/backups.

## History and provenance

TargetHistory is imported in version order and reconciled against Current, without double importing the final target. Previous versions use the normal immutable audit chain (stable objectId, priorId, archivedAt). createdAt/lastModifiedAt represent actual database ingestion, while first_observed_date/replaced_at/last_observed_date preserve the external observation timeline separately. These source dates are not contractual effective dates.

Migration 019 adds optional source_data objects to Metrics and MetricData. They contain the canonical definition, original names, status, operator, target scope, original period, source file hash, source row references and referenced raw source records. This metadata is exposed read-only in Data Management. Reimports retain already recorded target version keys and avoid duplicate records. Value updates, metadata/name changes and denormalized MetricData details are versioned too. Unrelated periods/dimensions retain their values.

The transaction verifies every imported current value/status/source, every historical target version key, unchanged existing Metric Numbers, and database constraints before commit. Any mismatch rolls back all data changes. Backups and reconciliation reports are written under .imports; these files are gitignored.

## Performance Update

Performance Data reads the actual stored Covenant Metrics and their +1 Targets. It no longer substitutes an EBITDA/interest calculation for 4004200. Canonical company-specific names and separate extra Covenants are displayed along with explicit statuses. No status-only value is shown as zero.
