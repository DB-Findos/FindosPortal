-- Bind VariableMap to the exact version of its own logical formula.
ALTER TABLE portal.kpi_formulas ADD CONSTRAINT kpi_formula_version_identity UNIQUE(id,"objectId");
ALTER TABLE portal.variable_map ADD CONSTRAINT variable_map_formula_version_identity
 FOREIGN KEY(formula_version_id,formula_id) REFERENCES portal.kpi_formulas(id,"objectId");
ALTER TABLE portal.variable_map ADD CONSTRAINT variable_map_source_shape CHECK (
 (aggregation IN ('MONTH','LTM','YTD') AND entity='metric_data' AND field='value' AND metric_number IS NOT NULL AND metric_number>=0 AND record_id IS NULL AND target_kpi_id IS NULL)
 OR (aggregation='FIXED' AND entity<>'metric_data' AND record_id IS NOT NULL AND metric_number IS NULL AND target_kpi_id IS NULL AND NOT prior_year AND dimension IS NULL)
 OR (aggregation='KPI' AND entity='kpi_formulas' AND field='result' AND target_kpi_id IS NOT NULL AND record_id IS NULL AND metric_number IS NULL AND NOT prior_year AND dimension IS NULL)
);
CREATE FUNCTION portal.validate_kpi_fixed_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entity text; active_version uuid;
BEGIN
 IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
 SELECT entity INTO target_entity FROM portal.object_registry WHERE id=NEW.record_id;
 IF target_entity IS DISTINCT FROM NEW.entity THEN RAISE EXCEPTION 'Invalid fixed KPI reference' USING ERRCODE='23503'; END IF;
 EXECUTE format('SELECT id FROM portal.%I WHERE "objectId"=$1 AND "archivedAt" IS NULL FOR SHARE',target_entity) INTO active_version USING NEW.record_id;
 IF active_version IS NULL THEN RAISE EXCEPTION 'Fixed KPI reference is archived' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kpi_fixed_reference BEFORE INSERT ON portal.variable_map FOR EACH ROW EXECUTE FUNCTION portal.validate_kpi_fixed_reference();
