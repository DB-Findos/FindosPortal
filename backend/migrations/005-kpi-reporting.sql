CREATE TABLE portal.kpi_formulas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,description text NOT NULL DEFAULT '',
 unit text NOT NULL DEFAULT '',decimals integer NOT NULL DEFAULT 2 CHECK(decimals BETWEEN 0 AND 10),
 "TextEditor" text NOT NULL,"TextDisplay" text NOT NULL,engine_version integer NOT NULL DEFAULT 1 CHECK(engine_version=1)
);
CREATE TABLE portal.variable_map (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),formula_id uuid NOT NULL REFERENCES portal.object_registry(id),
 formula_version_id uuid NOT NULL REFERENCES portal.kpi_formulas(id),identifier text NOT NULL CHECK(identifier ~ '^[A-Z]{1,3}$'),
 entity text NOT NULL,field text NOT NULL,name text NOT NULL,aggregation text NOT NULL CHECK(aggregation IN ('MONTH','LTM','YTD','FIXED','KPI')),
 prior_year boolean NOT NULL DEFAULT false,dimension text CHECK(dimension IN ('actual','budget','forecast','plan')),
 metric_number integer,record_id uuid REFERENCES portal.object_registry(id),target_kpi_id uuid REFERENCES portal.object_registry(id)
);
CREATE TABLE portal.report_definitions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,description text NOT NULL DEFAULT '');
CREATE TABLE portal.report_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),report_id uuid NOT NULL REFERENCES portal.object_registry(id),kpi_id uuid NOT NULL REFERENCES portal.object_registry(id),position integer NOT NULL CHECK(position>=0));
DO $$ DECLARE tab text; ref record; BEGIN
 FOREACH tab IN ARRAY ARRAY['kpi_formulas','variable_map','report_definitions','report_items'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ADD COLUMN "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),ADD COLUMN "priorId" uuid REFERENCES portal.%I(id),ADD COLUMN "createdAt" timestamptz NOT NULL,ADD COLUMN "lastModifiedAt" timestamptz NOT NULL,ADD COLUMN "archivedAt" timestamptz,ADD COLUMN "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,ADD COLUMN "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED',tab,tab);
  EXECUTE format('ALTER TABLE portal.%I ADD CHECK ("lastModifiedAt">="createdAt"),ADD CHECK ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt")',tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("objectId") WHERE "archivedAt" IS NULL',tab||'_current_object',tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("priorId") WHERE "priorId" IS NOT NULL',tab||'_single_successor',tab);
  EXECUTE format('CREATE INDEX %I ON portal.%I("objectId","lastModifiedAt")',tab||'_history',tab);
  EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',tab);
  EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',tab);
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'createdBy','users');
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'modifiedBy','users');
 END LOOP;
 FOR ref IN SELECT * FROM (VALUES ('variable_map','formula_id','kpi_formulas'),('variable_map','target_kpi_id','kpi_formulas'),('report_items','report_id','report_definitions'),('report_items','kpi_id','kpi_formulas')) AS refs(tab,col,target) LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',ref.col||'_type',ref.tab,ref.col,ref.target);
 END LOOP;
END $$;
CREATE UNIQUE INDEX kpi_formulas_name ON portal.kpi_formulas(name) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX variable_map_identifier ON portal.variable_map(formula_id,identifier) WHERE "archivedAt" IS NULL;
CREATE INDEX variable_map_version ON portal.variable_map(formula_version_id);
CREATE UNIQUE INDEX report_definitions_name ON portal.report_definitions(name) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX report_items_kpi ON portal.report_items(report_id,kpi_id) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX report_items_order ON portal.report_items(report_id,position) WHERE "archivedAt" IS NULL;
CREATE INDEX metrics_number_company_current ON portal.metrics(company_id,metric_number) WHERE "archivedAt" IS NULL;
INSERT INTO portal.entities(name) VALUES('kpi_formulas'),('variable_map'),('report_definitions'),('report_items');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',g.name='Administrators',g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name IN ('kpi_formulas','variable_map','report_definitions','report_items');
