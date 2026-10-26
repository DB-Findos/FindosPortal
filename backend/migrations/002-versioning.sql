-- Run by the migration runner in one transaction, after the baseline.
CREATE TABLE IF NOT EXISTS portal.object_registry (id uuid PRIMARY KEY, entity text NOT NULL);
CREATE TABLE IF NOT EXISTS portal.images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,mime_type text NOT NULL,data_base64 text NOT NULL);
CREATE TABLE IF NOT EXISTS portal.design_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text NOT NULL UNIQUE DEFAULT 'application',logo_id uuid,primary_color text NOT NULL,secondary_color text NOT NULL,accent_color text NOT NULL,background_color text NOT NULL,surface_color text NOT NULL,text_color text NOT NULL);

DO $$ DECLARE tab text; actor uuid; col record; constraint_row record; cols text;
BEGIN
 SELECT u.id INTO actor FROM portal.users u JOIN portal.user_group_memberships m ON m.user_id=u.id JOIN portal.user_groups g ON g.id=m.group_id WHERE g.name='Administrators' ORDER BY u.created_at LIMIT 1;
 IF actor IS NULL THEN SELECT id INTO actor FROM portal.users ORDER BY created_at LIMIT 1; END IF;
 PERFORM set_config('portal.actor_id',coalesce(actor::text,''),true);
 -- Drop version-bound foreign keys before replacing them with logical identities.
 FOR constraint_row IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='portal' AND c.contype='f' LOOP
  EXECUTE format('ALTER TABLE portal.%I DROP CONSTRAINT %I',constraint_row.relname,constraint_row.conname);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['contacts','users','user_groups','user_group_memberships','entities','permissions','funds','companies','metrics','metric_data','index_rates','images','design_settings'] LOOP
  EXECUTE format('INSERT INTO portal.object_registry(id,entity) SELECT id,$1 FROM portal.%I',tab) USING tab;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['contacts','users','user_groups','user_group_memberships','entities','permissions','funds','companies','metrics','metric_data','index_rates','images','design_settings'] LOOP
  EXECUTE format('ALTER TABLE portal.%I ADD COLUMN "objectId" uuid, ADD COLUMN "priorId" uuid, ADD COLUMN "createdAt" timestamptz, ADD COLUMN "lastModifiedAt" timestamptz, ADD COLUMN "archivedAt" timestamptz, ADD COLUMN "createdBy" uuid, ADD COLUMN "modifiedBy" uuid',tab);
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='portal' AND table_name=tab AND column_name='created_at') THEN
   EXECUTE format('UPDATE portal.%I SET "objectId"=id,"createdAt"=created_at,"lastModifiedAt"=created_at,"createdBy"=$1,"modifiedBy"=$1',tab) USING actor;
   EXECUTE format('ALTER TABLE portal.%I DROP COLUMN created_at',tab);
  ELSE
   EXECUTE format('UPDATE portal.%I SET "objectId"=id,"createdAt"=now(),"lastModifiedAt"=now(),"createdBy"=$1,"modifiedBy"=$1',tab) USING actor;
  END IF;
  EXECUTE format('ALTER TABLE portal.%I ALTER COLUMN "objectId" SET NOT NULL,ALTER COLUMN "createdAt" SET NOT NULL,ALTER COLUMN "lastModifiedAt" SET NOT NULL,ALTER COLUMN "createdBy" SET NOT NULL,ALTER COLUMN "modifiedBy" SET NOT NULL',tab);
  EXECUTE format('ALTER TABLE portal.%I ADD CHECK ("lastModifiedAt">="createdAt"),ADD CHECK ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt")',tab);
  -- Business keys apply to current versions only.
  FOR constraint_row IN SELECT c.conname,c.conkey FROM pg_constraint c WHERE c.conrelid=format('portal.%I',tab)::regclass AND c.contype='u' LOOP
   SELECT string_agg(quote_ident(a.attname),',' ORDER BY ord.n) INTO cols FROM unnest(constraint_row.conkey) WITH ORDINALITY ord(attnum,n) JOIN pg_attribute a ON a.attrelid=format('portal.%I',tab)::regclass AND a.attnum=ord.attnum;
   EXECUTE format('ALTER TABLE portal.%I DROP CONSTRAINT %I',tab,constraint_row.conname);
   EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I (%s) WHERE "archivedAt" IS NULL',constraint_row.conname,tab,cols);
  END LOOP;
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("objectId") WHERE "archivedAt" IS NULL',tab||'_current_object',tab);
  EXECUTE format('CREATE INDEX %I ON portal.%I ("objectId","lastModifiedAt")',tab||'_history',tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("priorId") WHERE "priorId" IS NOT NULL',tab||'_single_successor',tab);
  EXECUTE format('ALTER TABLE portal.%I ADD FOREIGN KEY ("objectId") REFERENCES portal.object_registry(id),ADD FOREIGN KEY ("priorId") REFERENCES portal.%I(id),ADD FOREIGN KEY ("createdBy") REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED,ADD FOREIGN KEY ("modifiedBy") REFERENCES portal.object_registry(id) DEFERRABLE INITIALLY DEFERRED',tab,tab);
 END LOOP;
 FOR col IN SELECT * FROM (VALUES ('users','contact_id'),('user_group_memberships','user_id'),('user_group_memberships','group_id'),('permissions','group_id'),('permissions','entity_id'),('companies','fund_id'),('metrics','company_id'),('metric_data','metric_id'),('design_settings','logo_id')) AS refs(tab,col) LOOP
  EXECUTE format('ALTER TABLE portal.%I ADD FOREIGN KEY (%I) REFERENCES portal.object_registry(id)',col.tab,col.col);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION portal.audit_version_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid; previous record; actual_entity text;
BEGIN
 actor:=nullif(current_setting('portal.actor_id',true),'')::uuid;
 IF actor IS NULL THEN RAISE EXCEPTION 'An authenticated audit actor is required' USING ERRCODE='23514'; END IF;
 NEW."objectId":=coalesce(NEW."objectId",NEW.id);
 IF NEW."priorId" IS NULL THEN
  IF EXISTS(SELECT 1 FROM portal.object_registry WHERE id=NEW."objectId") THEN RAISE EXCEPTION 'Object identity already exists' USING ERRCODE='23505'; END IF;
  NEW."createdAt":=clock_timestamp();NEW."createdBy":=actor;
  INSERT INTO portal.object_registry(id,entity) VALUES(NEW."objectId",TG_TABLE_NAME);
 ELSE
  EXECUTE format('SELECT * FROM portal.%I WHERE id=$1',TG_TABLE_NAME) INTO previous USING NEW."priorId";
  IF previous.id IS NULL OR previous."objectId"<>NEW."objectId" OR previous."archivedAt" IS NULL THEN RAISE EXCEPTION 'Invalid version chain' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=previous."createdAt";NEW."createdBy":=previous."createdBy";
 END IF;
 NEW."lastModifiedAt":=clock_timestamp();NEW."modifiedBy":=actor;NEW."archivedAt":=NULL;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION portal.protect_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Versions cannot be physically deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('portal.allow_archive',true) IS DISTINCT FROM 'on' OR OLD."archivedAt" IS NOT NULL OR NEW."archivedAt" IS NULL OR (to_jsonb(OLD)-'archivedAt') IS DISTINCT FROM (to_jsonb(NEW)-'archivedAt') THEN
  RAISE EXCEPTION 'Versions are immutable; archive and create a successor' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION portal.validate_logical_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref_id uuid; actual_entity text; active_version uuid;
BEGIN
 ref_id:=(to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 IF ref_id IS NULL THEN RETURN NEW; END IF;
 SELECT entity INTO actual_entity FROM portal.object_registry WHERE id=ref_id;
 IF actual_entity IS DISTINCT FROM TG_ARGV[1] THEN RAISE EXCEPTION 'Invalid logical reference %.%',TG_TABLE_NAME,TG_ARGV[0] USING ERRCODE='23503'; END IF;
 IF TG_WHEN='BEFORE' THEN
  EXECUTE format('SELECT id FROM portal.%I WHERE "objectId"=$1 AND "archivedAt" IS NULL FOR SHARE',TG_ARGV[1]) INTO active_version USING ref_id;
  IF active_version IS NULL THEN RAISE EXCEPTION 'Referenced object is archived' USING ERRCODE='23503'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM portal.object_registry WHERE id=ref_id) THEN RAISE EXCEPTION 'Missing identity' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; ref record;
BEGIN
 FOREACH tab IN ARRAY ARRAY['contacts','users','user_groups','user_group_memberships','entities','permissions','funds','companies','metrics','metric_data','index_rates','images','design_settings'] LOOP
  EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',tab);
  EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',tab);
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'createdBy','users');
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'modifiedBy','users');
 END LOOP;
 FOR ref IN SELECT * FROM (VALUES ('users','contact_id','contacts'),('user_group_memberships','user_id','users'),('user_group_memberships','group_id','user_groups'),('permissions','group_id','user_groups'),('permissions','entity_id','entities'),('companies','fund_id','funds'),('metrics','company_id','companies'),('metric_data','metric_id','metrics'),('design_settings','logo_id','images')) AS refs(tab,col,target) LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',ref.col||'_type',ref.tab,ref.col,ref.target);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION portal.initialize_group_permissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."priorId" IS NULL THEN INSERT INTO portal.permissions(group_id,entity_id) SELECT NEW."objectId","objectId" FROM portal.entities WHERE "archivedAt" IS NULL; END IF;
 RETURN NEW;
END $$;
INSERT INTO portal.entities(name) VALUES('images'),('design_settings');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators',g.name='Administrators',g.name='Administrators',g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e WHERE g."archivedAt" IS NULL AND e.name IN ('images','design_settings') AND e."archivedAt" IS NULL;
