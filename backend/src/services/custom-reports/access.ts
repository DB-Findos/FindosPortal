/** Private, per-record access rules are enforced by the specialized report service. */
export const privateCustomReportEntities = new Set(['custom_reports', 'custom_report_shares']);
export const reportVisibility = (
  alias: string,
  parameter: string
) => `(${alias}.owner_id=${parameter} OR EXISTS (
 SELECT 1 FROM portal.custom_report_shares s WHERE s.report_id=${alias}."objectId" AND s."archivedAt" IS NULL
 AND (s.user_id=${parameter} OR EXISTS (SELECT 1 FROM portal.user_group_memberships gm
 JOIN portal.user_groups g ON g."objectId"=gm.group_id AND g."archivedAt" IS NULL
 WHERE gm.user_id=${parameter} AND gm.group_id=s.group_id AND gm."archivedAt" IS NULL))))`;
