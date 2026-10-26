ALTER TABLE portal.variable_map
  ADD COLUMN IF NOT EXISTS filter jsonb;

ALTER TABLE portal.variable_map
  DROP CONSTRAINT IF EXISTS variable_map_filter_object;
ALTER TABLE portal.variable_map
  ADD CONSTRAINT variable_map_filter_object
  CHECK (filter IS NULL OR jsonb_typeof(filter) = 'object');
