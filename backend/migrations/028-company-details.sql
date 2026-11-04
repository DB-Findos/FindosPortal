ALTER TABLE portal.companies
  ADD COLUMN address_line text,
  ADD COLUMN postal_code text,
  ADD COLUMN city text,
  ADD COLUMN country text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN description text;

CREATE TABLE portal.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.company_contacts(id),
  "createdAt" timestamptz NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL,
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  company_id uuid NOT NULL REFERENCES portal.object_registry(id),
  contact_id uuid NOT NULL REFERENCES portal.object_registry(id),
  category text NOT NULL CHECK(category IN ('company','findos')),
  role text NOT NULL CHECK(length(trim(role)) BETWEEN 1 AND 500),
  notes text,
  CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX company_contacts_current ON portal.company_contacts("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX company_contacts_successor ON portal.company_contacts("priorId") WHERE "priorId" IS NOT NULL;
CREATE UNIQUE INDEX company_contacts_assignment ON portal.company_contacts(company_id,contact_id,category,lower(trim(role))) WHERE "archivedAt" IS NULL;
CREATE INDEX company_contacts_history ON portal.company_contacts("objectId","lastModifiedAt");
CREATE TRIGGER audit_insert BEFORE INSERT ON portal.company_contacts FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.company_contacts FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER company_contacts_company AFTER INSERT ON portal.company_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');
CREATE CONSTRAINT TRIGGER company_contacts_contact AFTER INSERT ON portal.company_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('contact_id','contacts');
CREATE CONSTRAINT TRIGGER company_contacts_creator AFTER INSERT ON portal.company_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER company_contacts_modifier AFTER INSERT ON portal.company_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
INSERT INTO portal.entities(name) VALUES('company_contacts');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',g.name='Administrators',g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='company_contacts';
