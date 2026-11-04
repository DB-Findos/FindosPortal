CREATE TABLE portal.application_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.application_modules(id),
  "createdAt" timestamptz NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL,
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
  key text NOT NULL,
  name text NOT NULL,
  external_url text CHECK(external_url IS NULL OR external_url ~ '^https?://'),
  internal_path text CHECK(internal_path IS NULL OR internal_path='/portfolio/dashboard'),
  position integer NOT NULL,
  CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX application_modules_current ON portal.application_modules("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX application_modules_key ON portal.application_modules(key) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX application_modules_successor ON portal.application_modules("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX application_modules_history ON portal.application_modules("objectId","lastModifiedAt");
CREATE TRIGGER audit_insert BEFORE INSERT ON portal.application_modules FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.application_modules FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.application_modules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.application_modules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
INSERT INTO portal.entities(name) VALUES('application_modules');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",false,true,g.name='Administrators',false
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='application_modules';
INSERT INTO portal.application_modules(key,name,internal_path,position) VALUES
 ('reporting','Reporting','/portfolio/dashboard',10),
 ('portfolio-management','Portfolio Management',NULL,20),
 ('crm','CRM',NULL,30),
 ('knowledge-management','Knowledge Management',NULL,40),
 ('entity-management','Entity Management',NULL,50),
 ('people-management','People Management',NULL,60),
 ('datev','Datev',NULL,70),
 ('lanes-planes','Lanes & Planes',NULL,80);

-- Keep the logical section identity and therefore all existing view/group links.
WITH previous AS (
 UPDATE portal.portfolio_sections SET "archivedAt"=clock_timestamp()
 WHERE name='portfolio-management' AND "archivedAt" IS NULL RETURNING *
)
INSERT INTO portal.portfolio_sections("objectId","priorId",name,label,icon,position)
SELECT "objectId",id,'portfolio-reporting','Portfolio Reporting',icon,position FROM previous;
