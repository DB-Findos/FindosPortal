CREATE TABLE portal.kpi_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
  "priorId" uuid REFERENCES portal.kpi_data(id),
  "createdAt" timestamptz NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL,
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
  "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,
  kpi_id uuid NOT NULL REFERENCES portal.object_registry(id),
  formula_version_id uuid NOT NULL REFERENCES portal.kpi_formulas(id),
  company_id uuid NOT NULL REFERENCES portal.object_registry(id),
  name text NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period)=1),
  value numeric,
  dimension text NOT NULL CHECK (dimension IN ('actual','budget','forecast','plan')),
  currency_mode text NOT NULL CHECK (currency_mode IN ('CC','EUR')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','missing','error')),
  message text,
  source_revision bigint NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  required_entities text[] NOT NULL,
  result jsonb NOT NULL,
  CHECK (status <> 'ok' OR value IS NOT NULL),
  CHECK ("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))
);
CREATE UNIQUE INDEX kpi_data_current_object ON portal.kpi_data("objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX kpi_data_single_successor ON portal.kpi_data("priorId") WHERE "priorId" IS NOT NULL;
CREATE INDEX kpi_data_history ON portal.kpi_data("objectId","lastModifiedAt");
CREATE UNIQUE INDEX kpi_data_context ON portal.kpi_data(kpi_id,company_id,period,dimension,currency_mode) WHERE "archivedAt" IS NULL;
CREATE INDEX kpi_data_report ON portal.kpi_data(company_id,period,dimension,currency_mode,source_revision) WHERE "archivedAt" IS NULL;
CREATE TRIGGER audit_insert BEFORE INSERT ON portal.kpi_data FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert();
CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.kpi_data FOR EACH ROW EXECUTE FUNCTION portal.protect_version();
CREATE TRIGGER kpi_reference BEFORE INSERT ON portal.kpi_data FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('kpi_id','kpi_formulas');
CREATE TRIGGER company_reference BEFORE INSERT ON portal.kpi_data FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('company_id','companies');
CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.kpi_data DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('createdBy','users');
CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.kpi_data DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('modifiedBy','users');

-- Technical state/queue are mutable, while published KPIData is versioned.
CREATE TABLE portal.kpi_calculation_state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL);
INSERT INTO portal.kpi_calculation_state VALUES(true,1);
CREATE TABLE portal.kpi_calculation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  formula_id uuid REFERENCES portal.object_registry(id),
  requested_by uuid REFERENCES portal.object_registry(id),
  revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  progress integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  successful integer NOT NULL DEFAULT 0,
  missing integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  message text
);
CREATE UNIQUE INDEX kpi_jobs_pending ON portal.kpi_calculation_jobs(scope) WHERE status='pending';
CREATE UNIQUE INDEX kpi_jobs_one_running ON portal.kpi_calculation_jobs((true)) WHERE status='running';
CREATE INDEX kpi_jobs_recent ON portal.kpi_calculation_jobs(requested_at DESC);

CREATE FUNCTION portal.kpi_inputs_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_revision bigint;
BEGIN
  UPDATE portal.kpi_calculation_state SET revision=revision+1 WHERE singleton RETURNING revision INTO next_revision;
  INSERT INTO portal.kpi_calculation_jobs(scope,revision,requested_by)
    VALUES('all',next_revision,nullif(current_setting('portal.actor_id',true),'')::uuid)
    ON CONFLICT (scope) WHERE status='pending' DO UPDATE
      SET revision=EXCLUDED.revision,requested_at=clock_timestamp(),requested_by=EXCLUDED.requested_by;
  RETURN NULL;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['kpi_formulas','variable_map','companies','funds','metrics','metric_data','index_rates','deal_data','deal_types','capital_movements'] LOOP
    EXECUTE format('CREATE TRIGGER kpi_inputs_changed AFTER INSERT OR UPDATE OR DELETE ON portal.%I FOR EACH STATEMENT EXECUTE FUNCTION portal.kpi_inputs_changed()',tab);
  END LOOP;
END $$;
INSERT INTO portal.entities(name) VALUES('kpi_data');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",false,
  g.name='Administrators' OR EXISTS(
    SELECT 1 FROM portal.permissions p JOIN portal.entities f ON f."objectId"=p.entity_id
    WHERE p.group_id=g."objectId" AND p.can_read AND p."archivedAt" IS NULL AND f."archivedAt" IS NULL AND f.name='kpi_formulas'
  ),false,false
FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name='kpi_data';
INSERT INTO portal.kpi_calculation_jobs(scope,revision,requested_by)
VALUES('all',1,nullif(current_setting('portal.actor_id',true),'')::uuid);
COMMENT ON TABLE portal.kpi_data IS 'Versioned monthly KPI materialization. A cache entry is reusable only for its exact company/month/dimension/currency, active formula version and current source revision. Missing data remains null.';
