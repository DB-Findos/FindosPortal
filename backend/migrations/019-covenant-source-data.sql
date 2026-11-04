-- Optional source metadata preserves non-numeric Covenant states, original
-- period ends, units under review and externally observed Target versions.
-- The normal immutable audit/version columns retain their existing meaning.
ALTER TABLE portal.metrics ADD COLUMN source_data jsonb;
ALTER TABLE portal.metric_data ADD COLUMN source_data jsonb;
ALTER TABLE portal.metrics ADD CONSTRAINT metrics_source_data_object
  CHECK (source_data IS NULL OR jsonb_typeof(source_data) = 'object');
ALTER TABLE portal.metric_data ADD CONSTRAINT metric_data_source_data_object
  CHECK (source_data IS NULL OR jsonb_typeof(source_data) = 'object');
