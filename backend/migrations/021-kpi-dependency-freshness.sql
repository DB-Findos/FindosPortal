ALTER TABLE portal.kpi_data ADD COLUMN formula_versions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE portal.kpi_data ADD CONSTRAINT kpi_data_formula_versions_object CHECK(jsonb_typeof(formula_versions)='object');
DROP TRIGGER kpi_inputs_changed ON portal.kpi_formulas;
DROP TRIGGER kpi_inputs_changed ON portal.variable_map;
CREATE FUNCTION portal.kpi_definition_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME='kpi_formulas' THEN target:=NEW."objectId";
  ELSE target:=NEW.formula_id; END IF;
  INSERT INTO portal.kpi_calculation_jobs(scope,formula_id,revision,requested_by)
    SELECT 'formula:'||target::text,target,revision,nullif(current_setting('portal.actor_id',true),'')::uuid
    FROM portal.kpi_calculation_state WHERE singleton
    ON CONFLICT (scope) WHERE status='pending' DO UPDATE
      SET revision=EXCLUDED.revision,requested_at=clock_timestamp(),requested_by=EXCLUDED.requested_by;
  RETURN NULL;
END $$;
CREATE TRIGGER kpi_definition_changed AFTER INSERT OR UPDATE ON portal.kpi_formulas FOR EACH ROW EXECUTE FUNCTION portal.kpi_definition_changed();
CREATE TRIGGER kpi_definition_changed AFTER INSERT OR UPDATE ON portal.variable_map FOR EACH ROW EXECUTE FUNCTION portal.kpi_definition_changed();
-- Dependency-version proof allows unrelated KPIs to retain their warm cache.
-- Old cache entries without that proof remain ineligible until rebuilt.
INSERT INTO portal.kpi_calculation_jobs(scope,revision,requested_by)
SELECT 'all',revision,nullif(current_setting('portal.actor_id',true),'')::uuid FROM portal.kpi_calculation_state WHERE singleton
ON CONFLICT (scope) WHERE status='pending' DO UPDATE SET revision=EXCLUDED.revision,requested_at=clock_timestamp();
