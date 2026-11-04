# Data Management filters and editable search results

Data Management tables have a Filter button. The panel reuses Advanced Search's reference joins, AND filters and ordering. Apply/reset runs the filter on the database across all pages; the existing quick text search still searches the current page only. Display fields, pinned columns, history and record actions remain available. The panel scrolls internally within the viewport.

`POST /api/search/query` accepts optional `root_records: true` for Data Management. It uses the same validated query compiler and read permissions, including KPI source permissions, but returns the complete root records through publicRow (no password hashes). Root fields need not be selected as search columns. This option is a read operation and does not require create permission.

Normal Advanced Search results additionally return `recordRefs`, aligned with the rows, containing stable identities and versions for root/joined records independent of displayed columns. A fixed actions column offers editing for permitted, mutable entities; when multiple linked entities can be edited the target is selectable. Empty LEFT JOIN references and specialized/read-only entities are not editable through the generic form.

Opening an editor fetches the latest full record using `GET /api/data/:entity/:objectId`. Read and source permissions are enforced. RecordForm uses the existing PATCH endpoint with If-Match and version history; field validation remains below each input. Saving refreshes the same filtered result/page and adjusts the page if it no longer exists. No database migration or new environment variables are needed.
