-- Preserve source decimal precision, pending values, and the distinct Findos Plan scenario.
ALTER TABLE portal.metric_data ALTER COLUMN value TYPE numeric;
ALTER TABLE portal.metric_data ALTER COLUMN value DROP NOT NULL;
ALTER TABLE portal.metric_data DROP CONSTRAINT IF EXISTS metric_data_scenario_check;
ALTER TABLE portal.metric_data ADD CONSTRAINT metric_data_scenario_check CHECK (scenario IN ('actual','budget','forecast','plan'));
