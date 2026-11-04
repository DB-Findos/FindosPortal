CREATE TABLE portal.custom_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.custom_reports(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 owner_id uuid NOT NULL REFERENCES portal.object_registry(id), name text NOT NULL, description text NOT NULL DEFAULT '',
 html text NOT NULL, mapping jsonb NOT NULL, engine_version integer NOT NULL DEFAULT 1 CHECK(engine_version=1),
 CHECK(jsonb_typeof(mapping)='array'),
 CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE TABLE portal.custom_report_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.custom_report_shares(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 report_id uuid NOT NULL REFERENCES portal.object_registry(id), user_id uuid REFERENCES portal.object_registry(id), group_id uuid REFERENCES portal.object_registry(id),
 CHECK((user_id IS NULL)<>(group_id IS NULL)),
 CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['custom_reports','custom_report_shares'] LOOP
 EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("objectId") WHERE "archivedAt" IS NULL',t||'_current',t);
 EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("priorId") WHERE "priorId" IS NOT NULL',t||'_successor',t);
 EXECUTE format('CREATE INDEX %I ON portal.%I("objectId","lastModifiedAt")',t||'_history',t);
 EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',t);
 EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER creator_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''createdBy'',''users'')',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER modifier_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''modifiedBy'',''users'')',t);
END LOOP; END $$;
CREATE INDEX custom_reports_owner ON portal.custom_reports(owner_id) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX custom_report_share_user ON portal.custom_report_shares(report_id,user_id) WHERE "archivedAt" IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX custom_report_share_group ON portal.custom_report_shares(report_id,group_id) WHERE "archivedAt" IS NULL AND group_id IS NOT NULL;
CREATE CONSTRAINT TRIGGER owner_ref AFTER INSERT ON portal.custom_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('owner_id','users');
CREATE CONSTRAINT TRIGGER report_ref AFTER INSERT ON portal.custom_report_shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('report_id','custom_reports');
CREATE CONSTRAINT TRIGGER user_ref AFTER INSERT ON portal.custom_report_shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('user_id','users');
CREATE CONSTRAINT TRIGGER group_ref AFTER INSERT ON portal.custom_report_shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('group_id','user_groups');
INSERT INTO portal.entities(name) VALUES('custom_reports'),('custom_report_shares');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",true,true,true,true FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name IN ('custom_reports','custom_report_shares');
