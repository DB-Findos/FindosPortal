ALTER TABLE portal.users
  ADD COLUMN entra_tenant_id uuid,
  ADD COLUMN entra_object_id uuid,
  ADD CONSTRAINT users_entra_identity_pair CHECK ((entra_tenant_id IS NULL) = (entra_object_id IS NULL));

CREATE UNIQUE INDEX users_entra_identity_current
  ON portal.users(entra_tenant_id, entra_object_id) WHERE "archivedAt" IS NULL AND entra_tenant_id IS NOT NULL;

INSERT INTO portal.user_groups(name, description)
SELECT 'Inactive', 'Neue Microsoft-Benutzer ohne Zugriff. Zur Freischaltung aus dieser Gruppe entfernen und einer berechtigten Gruppe zuordnen.'
WHERE NOT EXISTS (SELECT 1 FROM portal.user_groups WHERE name='Inactive' AND "archivedAt" IS NULL);
