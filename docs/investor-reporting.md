# Investoren Reporting

Company → Investoren Reporting shows the latest available IR quarter and the three preceding calendar quarters, newest first. A selected month limits the available quarters. Missing values remain missing; comments are matched to the same Company and quarter without falling back to another quarter.

The report reads `actual` MetricData using these fixed Metric Numbers:

| Row | Ist Vorjahr | LTM | Findos Case |
| --- | --- | --- | --- |
| Revenue | 6000001 | 6000002 | 6000003 |
| Normalized EBITDA | 6000101 | 6000102 | 6000103 |
| Normalized EBITA | 6000201 | 6000202 | 6000203 |
| Net debt | 6000301 | 6000302 | 6000303 |

IR values have source unit `000`; the report displays thousands without dividing by 1,000 again. Margins equal the corresponding EBITDA/EBITA value divided by Revenue. Changes equal LTM/comparison − 1; a missing value or zero denominator produces an empty result. Labels do not invent forecast years or fiscal year ends absent from the source.

All IR inputs are already in EUR (thousands). Values are never converted, even when Company or Metric metadata contains another currency. The report therefore has a fixed EUR context and no currency selector.

`portal.comments` is the versioned Comment Entity, available to Data Management and the existing Entity/MCP tools. `type = Investoren Reporting` distinguishes these records from future comment types. `company_id` references a logical Company; `period` stores the source month. Source UUID, source filename, source row and full original data are retained. Imports match existing legal/internal Company names only; unmapped names remain unassigned with a mapping note, not guessed.

Run imports after migrations:

```powershell
npm run build --workspace @findos/backend
node backend/dist/migrate.js
node backend/dist/import-investor-comments.js 'C:/path/Comments_02_Nov_2026.xlsx' --apply
```

Without `--apply`, the import transaction rolls back. Imports take an advisory lock, use source UUIDs to avoid duplicates, preserve history on changes, back up existing comments and source XLSX under `.imports/investor-comments`, and reconcile the complete source row count before committing. Empty source comment cells are retained as null and excluded from report text.
