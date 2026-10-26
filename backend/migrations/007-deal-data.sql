CREATE TABLE portal.deal_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "priorId" uuid REFERENCES portal.deal_types(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL,
  "modifiedBy" uuid NOT NULL,
  name text NOT NULL CHECK (name IN ('Entry', 'AddOn', 'Exit'))
);

CREATE UNIQUE INDEX deal_types_active_name_key
  ON portal.deal_types(name) WHERE "archivedAt" IS NULL;

CREATE TABLE portal.deal_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "objectId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "priorId" uuid REFERENCES portal.deal_data(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  "createdBy" uuid NOT NULL,
  "modifiedBy" uuid NOT NULL,
  name text NOT NULL,
  company_id uuid NOT NULL,
  company_internal_name text,
  company_source_id uuid,
  company_currency text CHECK (company_currency IS NULL OR company_currency ~ '^[A-Z]{3}$'),
  deal_type_id uuid NOT NULL,
  findos_investment text,
  findos_investment_value numeric,
  findos_investment_index_value numeric,
  findos_investment_type text,
  deal_date date NOT NULL,
  revenue_ltm numeric,
  ebitda_ltm numeric,
  ebita_ltm numeric,
  multiple_ebitda numeric,
  multiple_ebita numeric,
  fixed_ev numeric,
  transaction_cost numeric,
  overfunding numeric,
  transaction_cost_other numeric,
  debt_financing numeric,
  findos_share numeric,
  index_value numeric,
  purchase_price_total numeric,
  comment text,
  data_provider_id text,
  external_id text,
  data_currency text CHECK (data_currency IS NULL OR data_currency ~ '^[A-Z]{3}$'),
  source_id uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE UNIQUE INDEX deal_data_active_source_key
  ON portal.deal_data(source_id) WHERE "archivedAt" IS NULL;
CREATE INDEX deal_data_company_date_idx ON portal.deal_data(company_id, deal_date) WHERE "archivedAt" IS NULL;
CREATE INDEX deal_data_type_date_idx ON portal.deal_data(deal_type_id, deal_date) WHERE "archivedAt" IS NULL;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['deal_types', 'deal_data'] LOOP
    EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("objectId") WHERE "archivedAt" IS NULL', table_name || '_object_current_key', table_name);
    EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()', table_name);
    EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()', table_name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)', table_name, 'createdBy', 'users');
    EXECUTE format('CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)', table_name, 'modifiedBy', 'users');
  END LOOP;
END $$;

CREATE TRIGGER deal_data_company_logical_ref
  BEFORE INSERT ON portal.deal_data FOR EACH ROW
  EXECUTE FUNCTION portal.validate_logical_reference('company_id', 'companies');
CREATE TRIGGER deal_data_type_logical_ref
  BEFORE INSERT ON portal.deal_data FOR EACH ROW
  EXECUTE FUNCTION portal.validate_logical_reference('deal_type_id', 'deal_types');

INSERT INTO portal.entities(name)
VALUES ('deal_types'), ('deal_data');

INSERT INTO portal.permissions(group_id, entity_id, can_create, can_read, can_update, can_delete)
SELECT groups."objectId", entities."objectId", true, true, true, true
FROM portal.user_groups groups
CROSS JOIN portal.entities entities
WHERE groups.name = 'Administrators'
  AND entities.name IN ('deal_types', 'deal_data')
  AND groups."archivedAt" IS NULL
  AND entities."archivedAt" IS NULL;

INSERT INTO portal.deal_types(name)
VALUES ('Entry'), ('AddOn'), ('Exit');
