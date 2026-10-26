ALTER TABLE portal.metric_data RENAME COLUMN scenario TO dimension;
ALTER TABLE portal.metric_data ADD COLUMN company_id uuid REFERENCES portal.object_registry(id);
ALTER TABLE portal.metric_data ADD COLUMN name text;
ALTER TABLE portal.metric_data ADD COLUMN currency text;
CREATE INDEX metric_data_company_current ON portal.metric_data(company_id) WHERE "archivedAt" IS NULL;

CREATE FUNCTION portal.metric_data_details() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metric record;
BEGIN
 SELECT m.company_id,m.name,m.currency INTO metric FROM portal.metrics m WHERE m."objectId"=NEW.metric_id AND m."archivedAt" IS NULL;
 IF metric IS NULL THEN RAISE EXCEPTION 'Metric is unavailable' USING ERRCODE='23503'; END IF;
 NEW.company_id:=metric.company_id;
 NEW.name:=metric.name;
 NEW.currency:=coalesce(metric.currency,NEW.currency);
 RETURN NEW;
END $$;
CREATE TRIGGER a_metric_data_details BEFORE INSERT ON portal.metric_data FOR EACH ROW EXECUTE FUNCTION portal.metric_data_details();
CREATE TRIGGER company_id_type BEFORE INSERT ON portal.metric_data FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');

CREATE TABLE portal.search_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES portal.object_registry(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 definition jsonb NOT NULL,
 "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.search_views(id),
 "createdAt" timestamptz NOT NULL,
 "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz,
 "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
 "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
 CHECK ("lastModifiedAt">="createdAt"),
 CHECK ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt")
);
CREATE UNIQUE INDEX search_views_current_object ON portal.search_views("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX search_views_current_name ON portal.search_views(owner_id,name) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX search_views_single_successor ON portal.search_views("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX search_views_history ON portal.search_views("objectId","lastModifiedAt");
CREATE TRIGGER audit_insert BEFORE INSERT ON portal.search_views FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.search_views FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE TRIGGER owner_id_type BEFORE INSERT ON portal.search_views FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('owner_id','users');
CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.search_views DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.search_views DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
INSERT INTO portal.entities(name) VALUES('search_views');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',true,g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='search_views';
