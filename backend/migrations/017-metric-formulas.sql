CREATE TABLE portal.metric_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.metric_formulas(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  name text NOT NULL,
  company_id uuid REFERENCES portal.object_registry(id),
  company_source_name text,
  metric_id uuid REFERENCES portal.object_registry(id),
  dynamo_metric_id uuid,
  metric_source_name text,
  metric_number integer,
  dimension text NOT NULL CHECK (dimension IN ('actual','budget','forecast','plan')),
  formula_type text NOT NULL CHECK (formula_type IN ('Data','Range','Formula')),
  accumulation_formula_id text,
  accumulation_formula_name text,
  accumulation_formula_number text,
  monthly_formula_id text,
  monthly_formula_name text,
  monthly_formula_number text,
  range_from integer,
  range_to integer,
  source_created_at timestamptz,
  source_modified_at timestamptz,
  source_file text NOT NULL,
  source_row integer NOT NULL,
  source_data jsonb NOT NULL,
  engine_version integer NOT NULL DEFAULT 1 CHECK(engine_version=1),
  evaluation_rules jsonb NOT NULL,
  CHECK (range_from IS NULL OR range_to IS NULL OR range_from <= range_to),
  CHECK ("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX metric_formulas_current ON portal.metric_formulas("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX metric_formulas_successor ON portal.metric_formulas("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX metric_formulas_company_dimension ON portal.metric_formulas(company_id,dimension,metric_number) WHERE "archivedAt" IS NULL;
CREATE TRIGGER metric_formulas_audit BEFORE INSERT ON portal.metric_formulas FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER metric_formulas_protect BEFORE UPDATE OR DELETE ON portal.metric_formulas FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER metric_formulas_company_ref AFTER INSERT ON portal.metric_formulas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');
CREATE CONSTRAINT TRIGGER metric_formulas_metric_ref AFTER INSERT ON portal.metric_formulas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('metric_id','metrics');
CREATE CONSTRAINT TRIGGER metric_formulas_creator_ref AFTER INSERT ON portal.metric_formulas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER metric_formulas_modifier_ref AFTER INSERT ON portal.metric_formulas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
COMMENT ON TABLE portal.metric_formulas IS 'Dynamo metric configuration. Original Excel columns in source_data; versioned interpretation contract in evaluation_rules. References in formulas use Dynamo Metric UUIDs = metrics.objectId.';
INSERT INTO portal.entities(name) VALUES ('metric_formulas');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",false,true,false,false
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='metric_formulas';
