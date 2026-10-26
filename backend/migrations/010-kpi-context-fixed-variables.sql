ALTER TABLE portal.variable_map
  DROP CONSTRAINT IF EXISTS variable_map_source_shape;

ALTER TABLE portal.variable_map
  ADD CONSTRAINT variable_map_source_shape CHECK (
    (aggregation IN ('MONTH','LTM','YTD') AND entity='metric_data' AND field='value' AND metric_number IS NOT NULL AND metric_number>=0 AND record_id IS NULL AND target_kpi_id IS NULL)
    OR (aggregation='FIXED' AND entity<>'metric_data' AND metric_number IS NULL AND target_kpi_id IS NULL AND NOT prior_year AND dimension IS NULL)
    OR (aggregation='KPI' AND entity='kpi_formulas' AND field='result' AND target_kpi_id IS NOT NULL AND record_id IS NULL AND metric_number IS NULL AND NOT prior_year AND dimension IS NULL)
  );
