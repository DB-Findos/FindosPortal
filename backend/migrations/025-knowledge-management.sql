CREATE TABLE portal.knowledge_spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.knowledge_spaces(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 name text NOT NULL, description text NOT NULL DEFAULT '', position integer NOT NULL DEFAULT 0, source_key text
);
CREATE TABLE portal.knowledge_sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.knowledge_sections(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 space_id uuid NOT NULL REFERENCES portal.object_registry(id), name text NOT NULL, position integer NOT NULL DEFAULT 0, source_key text
);
CREATE TABLE portal.knowledge_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.knowledge_entries(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 section_id uuid NOT NULL REFERENCES portal.object_registry(id), parent_id uuid REFERENCES portal.object_registry(id),
 title text NOT NULL, type text NOT NULL CHECK(type IN('process','meeting','policy','reference','checklist')),
 content_html text NOT NULL DEFAULT '', plain_text text NOT NULL DEFAULT '', tags text[] NOT NULL DEFAULT '{}',
 responsible_id uuid NOT NULL REFERENCES portal.object_registry(id), position integer NOT NULL DEFAULT 0,
 source_key text, source_url text, source_modified_at timestamptz, source_data jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE portal.knowledge_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL REFERENCES portal.object_registry(id),
 "priorId" uuid REFERENCES portal.knowledge_documents(id), "createdAt" timestamptz NOT NULL, "lastModifiedAt" timestamptz NOT NULL,
 "archivedAt" timestamptz, "createdBy" uuid NOT NULL REFERENCES portal.object_registry(id), "modifiedBy" uuid NOT NULL REFERENCES portal.object_registry(id),
 entry_id uuid NOT NULL REFERENCES portal.object_registry(id), name text NOT NULL, kind text NOT NULL DEFAULT 'template' CHECK(kind='template'),
 extension text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=26214400),
 sha256 text NOT NULL, url text NOT NULL CHECK(url LIKE 'https://%'), drive_id text NOT NULL, item_id text NOT NULL,
 uploaded_at timestamptz NOT NULL, storage_path text NOT NULL
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['knowledge_spaces','knowledge_sections','knowledge_entries','knowledge_documents'] LOOP
 EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("objectId") WHERE "archivedAt" IS NULL',t||'_current',t);
 EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("priorId") WHERE "priorId" IS NOT NULL',t||'_successor',t);
 EXECUTE format('CREATE INDEX %I ON portal.%I("objectId","lastModifiedAt")',t||'_history',t);
 EXECUTE format('ALTER TABLE portal.%I ADD CONSTRAINT %I CHECK("lastModifiedAt">="createdAt" AND ("archivedAt" IS NULL OR "archivedAt">="lastModifiedAt"))',t,t||'_dates');
 EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',t);
 EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER creator_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''createdBy'',''users'')',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER modifier_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''modifiedBy'',''users'')',t);
END LOOP; END $$;
CREATE UNIQUE INDEX knowledge_space_source ON portal.knowledge_spaces(source_key) WHERE "archivedAt" IS NULL AND source_key IS NOT NULL;
CREATE UNIQUE INDEX knowledge_section_source ON portal.knowledge_sections(source_key) WHERE "archivedAt" IS NULL AND source_key IS NOT NULL;
CREATE UNIQUE INDEX knowledge_entry_source ON portal.knowledge_entries(source_key) WHERE "archivedAt" IS NULL AND source_key IS NOT NULL;
CREATE INDEX knowledge_sections_space ON portal.knowledge_sections(space_id,position) WHERE "archivedAt" IS NULL;
CREATE INDEX knowledge_entries_section ON portal.knowledge_entries(section_id,position) WHERE "archivedAt" IS NULL;
CREATE INDEX knowledge_entries_parent ON portal.knowledge_entries(parent_id) WHERE "archivedAt" IS NULL;
CREATE INDEX knowledge_entries_search ON portal.knowledge_entries USING gin(to_tsvector('german',title||' '||plain_text)) WHERE "archivedAt" IS NULL;
CREATE INDEX knowledge_entries_tags ON portal.knowledge_entries USING gin(tags) WHERE "archivedAt" IS NULL;
CREATE INDEX knowledge_documents_entry ON portal.knowledge_documents(entry_id) WHERE "archivedAt" IS NULL;
CREATE CONSTRAINT TRIGGER space_ref AFTER INSERT ON portal.knowledge_sections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('space_id','knowledge_spaces');
CREATE CONSTRAINT TRIGGER section_ref AFTER INSERT ON portal.knowledge_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('section_id','knowledge_sections');
CREATE CONSTRAINT TRIGGER parent_ref AFTER INSERT ON portal.knowledge_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('parent_id','knowledge_entries');
CREATE CONSTRAINT TRIGGER responsible_ref AFTER INSERT ON portal.knowledge_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('responsible_id','users');
CREATE CONSTRAINT TRIGGER entry_ref AFTER INSERT ON portal.knowledge_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('entry_id','knowledge_entries');
INSERT INTO portal.entities(name) VALUES('knowledge_spaces'),('knowledge_sections'),('knowledge_entries'),('knowledge_documents');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",g.name='Administrators' OR e.name IN('knowledge_entries','knowledge_documents'),true,
 g.name='Administrators' OR e.name IN('knowledge_entries','knowledge_documents'),g.name='Administrators'
FROM portal.user_groups g CROSS JOIN portal.entities e WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name LIKE 'knowledge_%';
DO $$ DECLARE n text; BEGIN FOR n IN SELECT conname FROM pg_constraint WHERE conrelid='portal.application_modules'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%internal_path%' LOOP
 EXECUTE format('ALTER TABLE portal.application_modules DROP CONSTRAINT %I',n);
END LOOP; END $$;
ALTER TABLE portal.application_modules ADD CONSTRAINT application_internal_path CHECK(internal_path IS NULL OR internal_path IN('/portfolio/dashboard','/knowledge'));
WITH previous AS(UPDATE portal.application_modules SET "archivedAt"=clock_timestamp() WHERE key='knowledge-management' AND "archivedAt" IS NULL RETURNING *)
INSERT INTO portal.application_modules("objectId","priorId",key,name,external_url,internal_path,position)
SELECT "objectId",id,key,'Knowledge Management',NULL,'/knowledge',position FROM previous;
