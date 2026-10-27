CREATE TABLE portal.performance_update_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL,
  "priorId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL,
  "modifiedBy" uuid NOT NULL,
  company_id uuid,
  company_source_name text NOT NULL,
  metric_data_period date,
  performance_update_date date,
  comment_text text NOT NULL,
  text_type text,
  source_file text,
  slide_number integer,
  paragraph_number integer,
  slide_id text,
  mapping_note text,
  capture_type text,
  source_row integer NOT NULL
);
CREATE UNIQUE INDEX performance_update_comments_current_object
  ON portal.performance_update_comments("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX performance_update_comments_successor
  ON portal.performance_update_comments("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX performance_update_comments_period
  ON portal.performance_update_comments(metric_data_period, company_id)
  WHERE "archivedAt" IS NULL;
ALTER TABLE portal.performance_update_comments
  ADD CONSTRAINT performance_update_comments_object_fk FOREIGN KEY ("objectId") REFERENCES portal.object_registry(id),
  ADD CONSTRAINT performance_update_comments_prior_fk FOREIGN KEY ("priorId") REFERENCES portal.performance_update_comments(id),
  ADD CONSTRAINT performance_update_comments_creator_fk FOREIGN KEY ("createdBy") REFERENCES portal.object_registry(id),
  ADD CONSTRAINT performance_update_comments_modifier_fk FOREIGN KEY ("modifiedBy") REFERENCES portal.object_registry(id),
  ADD CONSTRAINT performance_update_comments_company_fk FOREIGN KEY (company_id) REFERENCES portal.object_registry(id),
  ADD CONSTRAINT performance_update_comments_dates_ck CHECK ("lastModifiedAt" >= "createdAt" AND ("archivedAt" IS NULL OR "archivedAt" >= "lastModifiedAt"));
CREATE TRIGGER performance_update_comments_audit_insert
  BEFORE INSERT ON portal.performance_update_comments
  FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER performance_update_comments_protect_versions
  BEFORE UPDATE OR DELETE ON portal.performance_update_comments
  FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER performance_update_comments_company_ref
  AFTER INSERT ON portal.performance_update_comments DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');

INSERT INTO portal.entities(name) VALUES ('performance_update_comments');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",false,true,false,false
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL
  AND e.name='performance_update_comments';
