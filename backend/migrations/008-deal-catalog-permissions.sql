-- Repair catalog visibility for the Deal entities on databases that received
-- the initial Deal migration before the administrator permission rows existed.
INSERT INTO portal.entities(name)
SELECT source.name
FROM (VALUES ('deal_types'), ('deal_data')) AS source(name)
WHERE NOT EXISTS (
  SELECT 1 FROM portal.entities entities
  WHERE entities.name = source.name AND entities."archivedAt" IS NULL
);

WITH required AS (
  SELECT groups."objectId" AS group_id, entities."objectId" AS entity_id
  FROM portal.user_groups groups
  CROSS JOIN portal.entities entities
  WHERE groups.name = 'Administrators'
    AND groups."archivedAt" IS NULL
    AND entities."archivedAt" IS NULL
    AND entities.name IN ('deal_types', 'deal_data')
), archived AS (
  UPDATE portal.permissions permissions
  SET "archivedAt" = clock_timestamp()
  FROM required
  WHERE permissions.group_id = required.group_id
    AND permissions.entity_id = required.entity_id
    AND permissions."archivedAt" IS NULL
    AND NOT (
      permissions.can_create AND permissions.can_read AND permissions.can_update AND permissions.can_delete
    )
  RETURNING permissions.*
)
INSERT INTO portal.permissions(
  "objectId", "priorId", group_id, entity_id, can_create, can_read, can_update, can_delete
)
SELECT archived."objectId", archived.id, archived.group_id, archived.entity_id, true, true, true, true
FROM archived
UNION ALL
SELECT gen_random_uuid(), NULL, required.group_id, required.entity_id, true, true, true, true
FROM required
WHERE NOT EXISTS (
  SELECT 1 FROM portal.permissions permissions
  WHERE permissions.group_id = required.group_id
    AND permissions.entity_id = required.entity_id
    AND permissions."archivedAt" IS NULL
);
