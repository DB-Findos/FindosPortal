CREATE TABLE portal.capital_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.capital_movements(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
  name text NOT NULL,
  company_id uuid REFERENCES portal.object_registry(id),
  company_source_name text NOT NULL,
  movement_date date,
  source_date date,
  date_source text NOT NULL DEFAULT 'manual',
  value numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR' CHECK(currency ~ '^[A-Z]{3}$'),
  type text NOT NULL CHECK(type IN ('Capital Call','Capital Return')),
  reason text,
  source_file text,
  source_row integer,
  source_data jsonb NOT NULL DEFAULT '{}',
  CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX capital_movements_current ON portal.capital_movements("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX capital_movements_successor ON portal.capital_movements("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX capital_movements_company_date ON portal.capital_movements(company_id,type,movement_date) WHERE "archivedAt" IS NULL;
CREATE TRIGGER capital_movements_audit BEFORE INSERT ON portal.capital_movements FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER capital_movements_protect BEFORE UPDATE OR DELETE ON portal.capital_movements FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE CONSTRAINT TRIGGER capital_movements_company_ref AFTER INSERT ON portal.capital_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');
CREATE CONSTRAINT TRIGGER capital_movements_creator_ref AFTER INSERT ON portal.capital_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER capital_movements_modifier_ref AFTER INSERT ON portal.capital_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');
COMMENT ON COLUMN portal.capital_movements.value IS 'Original amount in thousands of the stated currency, same scale as DealData Findos Investment Value. Source snapshot retained in source_data.';
INSERT INTO portal.entities(name) VALUES('capital_movements');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',true,g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='capital_movements';

ALTER TABLE portal.variable_map DROP CONSTRAINT variable_map_aggregation_check;
ALTER TABLE portal.variable_map ADD CONSTRAINT variable_map_aggregation_check CHECK(aggregation IN ('MONTH','LTM','YTD','FIXED','KPI','CUMULATIVE'));
ALTER TABLE portal.variable_map DROP CONSTRAINT variable_map_source_shape;
ALTER TABLE portal.variable_map ADD CONSTRAINT variable_map_source_shape CHECK (
 (aggregation IN ('MONTH','LTM','YTD') AND entity='metric_data' AND field='value' AND metric_number IS NOT NULL AND metric_number>=0 AND record_id IS NULL AND target_kpi_id IS NULL)
 OR (aggregation='FIXED' AND entity<>'metric_data' AND metric_number IS NULL AND target_kpi_id IS NULL AND NOT prior_year AND dimension IS NULL)
 OR (aggregation='KPI' AND entity='kpi_formulas' AND field='result' AND target_kpi_id IS NOT NULL AND record_id IS NULL AND metric_number IS NULL AND NOT prior_year AND dimension IS NULL)
 OR (aggregation='CUMULATIVE' AND entity='capital_movements' AND field='value' AND metric_number IS NULL AND record_id IS NULL AND target_kpi_id IS NULL AND NOT prior_year AND dimension IS NULL)
);
