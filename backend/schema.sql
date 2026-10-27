BEGIN;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE TABLE IF NOT EXISTS portal.contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text NOT NULL, last_name text NOT NULL, email text NOT NULL, phone text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(email)), password_hash text NOT NULL,
 contact_id uuid NOT NULL UNIQUE REFERENCES portal.contacts(id) ON DELETE RESTRICT, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal.user_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal.user_group_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE, group_id uuid NOT NULL REFERENCES portal.user_groups(id) ON DELETE CASCADE, UNIQUE(user_id,group_id));
CREATE TABLE IF NOT EXISTS portal.entities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS portal.permissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES portal.user_groups(id) ON DELETE CASCADE, entity_id uuid NOT NULL REFERENCES portal.entities(id) ON DELETE CASCADE,
 can_create boolean NOT NULL DEFAULT false, can_read boolean NOT NULL DEFAULT false, can_update boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false, UNIQUE(group_id,entity_id)
);
CREATE TABLE IF NOT EXISTS portal.funds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, currency text NOT NULL DEFAULT 'EUR' CHECK(length(currency)=3), description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fund_id uuid NOT NULL REFERENCES portal.funds(id) ON DELETE RESTRICT, name text NOT NULL, industry text, website text, currency text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS portal.metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES portal.companies(id) ON DELETE RESTRICT, name text NOT NULL, unit text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,name));
ALTER TABLE portal.companies ADD COLUMN IF NOT EXISTS internal_name text;
ALTER TABLE portal.metrics ADD COLUMN IF NOT EXISTS metric_number integer CHECK(metric_number >= 0);
ALTER TABLE portal.metrics ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE portal.metrics ADD COLUMN IF NOT EXISTS important boolean NOT NULL DEFAULT false;
ALTER TABLE portal.metrics ADD COLUMN IF NOT EXISTS currency text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$');
CREATE TABLE IF NOT EXISTS portal.metric_data (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metric_id uuid NOT NULL REFERENCES portal.metrics(id) ON DELETE RESTRICT, period date NOT NULL, value numeric(24,6) NOT NULL, scenario text NOT NULL DEFAULT 'actual' CHECK(scenario IN ('actual','budget','forecast')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(metric_id,period,scenario));
CREATE TABLE IF NOT EXISTS portal.index_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 as_of_date date NOT NULL, period date NOT NULL,
 base_currency text NOT NULL CHECK(base_currency ~ '^[A-Z]{3}$'), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 index_value numeric(24,10) NOT NULL CHECK(index_value > 0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(base_currency,currency,as_of_date)
);
CREATE INDEX IF NOT EXISTS companies_fund_idx ON portal.companies(fund_id);
CREATE INDEX IF NOT EXISTS metrics_company_idx ON portal.metrics(company_id);
CREATE INDEX IF NOT EXISTS metric_data_metric_idx ON portal.metric_data(metric_id);
CREATE INDEX IF NOT EXISTS memberships_group_idx ON portal.user_group_memberships(group_id);
INSERT INTO portal.entities(name) VALUES ('contacts'),('users'),('user_groups'),('user_group_memberships'),('entities'),('permissions'),('funds'),('companies'),('metrics'),('metric_data') ON CONFLICT DO NOTHING;
-- Grant access to the new entity to existing administrators only on its first creation.
-- Re-running migrations preserves subsequent permission edits.
WITH new_entity AS (
 INSERT INTO portal.entities(name) VALUES ('index_rates') ON CONFLICT DO NOTHING RETURNING id
)
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g.id,e.id,g.name='Administrators',g.name='Administrators',g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN new_entity e ON CONFLICT DO NOTHING;
INSERT INTO portal.permissions(group_id,entity_id) SELECT g.id,e.id FROM portal.user_groups g CROSS JOIN portal.entities e ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION portal.initialize_group_permissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO portal.permissions(group_id,entity_id) SELECT NEW.id,id FROM portal.entities; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS initialize_group_permissions ON portal.user_groups;
CREATE TRIGGER initialize_group_permissions AFTER INSERT ON portal.user_groups FOR EACH ROW EXECUTE FUNCTION portal.initialize_group_permissions();
COMMIT;
