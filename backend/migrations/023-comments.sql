CREATE TABLE portal.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.comments(id),
  "createdAt" timestamptz NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL,
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  company_id uuid REFERENCES portal.object_registry(id),
  company_source_name text,
  period date NOT NULL,
  type text NOT NULL DEFAULT 'Investoren Reporting',
  comment_text text,
  source_id uuid,
  source_file text,
  source_row integer,
  mapping_note text,
  source_data jsonb NOT NULL DEFAULT '{}',
  CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX comments_current ON portal.comments("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX comments_successor ON portal.comments("priorId") WHERE "priorId" IS NOT NULL;
CREATE UNIQUE INDEX comments_source ON portal.comments(source_id) WHERE "archivedAt" IS NULL AND source_id IS NOT NULL;
CREATE INDEX comments_history ON portal.comments("objectId","lastModifiedAt");
CREATE INDEX comments_reporting ON portal.comments(company_id,type,period) WHERE "archivedAt" IS NULL;
CREATE TRIGGER audit_insert BEFORE INSERT ON portal.comments FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.comments FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER comments_company AFTER INSERT ON portal.comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');
CREATE CONSTRAINT TRIGGER comments_creator AFTER INSERT ON portal.comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER comments_modifier AFTER INSERT ON portal.comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
INSERT INTO portal.entities(name) VALUES('comments');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',true,g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='comments';
