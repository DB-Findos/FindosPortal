CREATE TABLE portal.document_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL,
 "priorId" uuid REFERENCES portal.document_types(id), "createdAt" timestamptz NOT NULL,
 "lastModifiedAt" timestamptz NOT NULL, "archivedAt" timestamptz,
 "createdBy" uuid NOT NULL, "modifiedBy" uuid NOT NULL,
 key text NOT NULL, name text NOT NULL, description text
);
CREATE TABLE portal.document_origins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL,
 "priorId" uuid REFERENCES portal.document_origins(id), "createdAt" timestamptz NOT NULL,
 "lastModifiedAt" timestamptz NOT NULL, "archivedAt" timestamptz,
 "createdBy" uuid NOT NULL, "modifiedBy" uuid NOT NULL,
 key text NOT NULL, name text NOT NULL, description text
);
CREATE TABLE portal.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL,
 "priorId" uuid REFERENCES portal.documents(id), "createdAt" timestamptz NOT NULL,
 "lastModifiedAt" timestamptz NOT NULL, "archivedAt" timestamptz,
 "createdBy" uuid NOT NULL, "modifiedBy" uuid NOT NULL,
 name text NOT NULL, description text,
 document_type_id uuid NOT NULL, origin_id uuid NOT NULL,
 url text NOT NULL CHECK(url LIKE 'https://%' OR url LIKE '/api/ai/documents/%/content'),
 extension text NOT NULL DEFAULT '', mime_type text NOT NULL DEFAULT 'application/octet-stream',
 size_bytes bigint CHECK(size_bytes>=0), uploaded_at timestamptz,
 sha256 text, storage_provider text NOT NULL DEFAULT 'external',
 drive_id text, item_id text, storage_path text,
 source_entity text, source_object_id uuid,
 knowledge_entry_id uuid, conversation_id uuid, owner_id uuid,
 company_id uuid, fund_id uuid,
 visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN('shared','private')),
 CHECK(visibility<>'private' OR owner_id IS NOT NULL)
);
DO $$ DECLARE t text; r record; BEGIN
 FOREACH t IN ARRAY ARRAY['document_types','document_origins','documents'] LOOP
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("objectId") WHERE "archivedAt" IS NULL',t||'_current',t);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I("priorId") WHERE "priorId" IS NOT NULL',t||'_successor',t);
  EXECUTE format('CREATE INDEX %I ON portal.%I("objectId","lastModifiedAt")',t||'_history',t);
  EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',t);
  EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',t);
  EXECUTE format('CREATE CONSTRAINT TRIGGER creator_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''createdBy'',''users'')',t);
  EXECUTE format('CREATE CONSTRAINT TRIGGER modifier_ref AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(''modifiedBy'',''users'')',t);
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
 ('document_type_id','document_types'),('origin_id','document_origins'),
 ('knowledge_entry_id','knowledge_entries'),('conversation_id','chat_conversations'),
 ('owner_id','users'),('company_id','companies'),('fund_id','funds')
 ) x(col,target) LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON portal.documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',r.col||'_ref',r.col,r.target);
 END LOOP;
END $$;
CREATE UNIQUE INDEX document_type_key ON portal.document_types(key) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX document_origin_key ON portal.document_origins(key) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX document_source_key ON portal.documents(source_entity,source_object_id) WHERE "archivedAt" IS NULL AND source_object_id IS NOT NULL;
CREATE INDEX documents_classification ON portal.documents(document_type_id,origin_id) WHERE "archivedAt" IS NULL;
CREATE INDEX documents_knowledge ON portal.documents(knowledge_entry_id) WHERE "archivedAt" IS NULL;
CREATE INDEX documents_owner ON portal.documents(owner_id) WHERE "archivedAt" IS NULL;
INSERT INTO portal.document_types(key,name) VALUES
 ('template','Vorlage'),('report','Bericht'),('contract','Vertrag'),('presentation','Präsentation'),('other','Sonstiges');
INSERT INTO portal.document_origins(key,name) VALUES
 ('knowledge-management','Knowledge Management'),('chat-upload','Chat-Upload'),('ai-generated','KI-generiert'),('manual','Manuell');
INSERT INTO portal.entities(name) VALUES('documents'),('document_types'),('document_origins');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
 SELECT g."objectId",e."objectId",g.name='Administrators',true,g.name='Administrators',g.name='Administrators'
 FROM portal.user_groups g CROSS JOIN portal.entities e
 WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL AND e.name IN('documents','document_types','document_origins');

-- Specialized source records keep their attachment/ownership behavior. Metadata is registered
-- centrally in the same transaction. Unlinking an attachment does not delete the document.
CREATE FUNCTION portal.register_source_document(source_table text, payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE type_id uuid; origin uuid; existing uuid; is_chat boolean;
BEGIN
 is_chat:=source_table='chat_documents';
 IF source_table NOT IN('knowledge_documents','chat_documents') THEN RAISE EXCEPTION 'Unsupported document source'; END IF;
 SELECT "objectId" INTO existing FROM portal.documents WHERE source_entity=source_table AND source_object_id=(payload->>'objectId')::uuid AND "archivedAt" IS NULL;
 IF existing IS NOT NULL THEN RETURN; END IF;
 SELECT "objectId" INTO type_id FROM portal.document_types WHERE key=CASE WHEN is_chat THEN 'other' ELSE 'template' END AND "archivedAt" IS NULL;
 SELECT "objectId" INTO origin FROM portal.document_origins WHERE key=CASE WHEN NOT is_chat THEN 'knowledge-management' WHEN payload->>'source'='generated' THEN 'ai-generated' ELSE 'chat-upload' END AND "archivedAt" IS NULL;
 INSERT INTO portal.documents(name,document_type_id,origin_id,url,extension,mime_type,size_bytes,uploaded_at,sha256,
 storage_provider,drive_id,item_id,storage_path,source_entity,source_object_id,knowledge_entry_id,conversation_id,owner_id,visibility)
 VALUES(payload->>'name',type_id,origin,payload->>'url',ltrim(payload->>'extension','.'),payload->>'mime_type',(payload->>'size_bytes')::bigint,
 coalesce((payload->>'uploaded_at')::timestamptz,(payload->>'document_at')::timestamptz),payload->>'sha256',
 CASE WHEN is_chat THEN 'database' ELSE 'sharepoint' END,payload->>'drive_id',payload->>'item_id',payload->>'storage_path',
 source_table,(payload->>'objectId')::uuid,(payload->>'entry_id')::uuid,(payload->>'conversation_id')::uuid,(payload->>'owner_id')::uuid,
 CASE WHEN is_chat THEN 'private' ELSE 'shared' END);
END $$;
CREATE FUNCTION portal.register_uploaded_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM portal.register_source_document(TG_TABLE_NAME,to_jsonb(NEW)); RETURN NEW;
END $$;
CREATE TRIGGER register_document AFTER INSERT ON portal.knowledge_documents FOR EACH ROW EXECUTE FUNCTION portal.register_uploaded_document();
CREATE TRIGGER register_document AFTER INSERT ON portal.chat_documents FOR EACH ROW EXECUTE FUNCTION portal.register_uploaded_document();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT ON("objectId") * FROM portal.knowledge_documents ORDER BY "objectId","lastModifiedAt" DESC LOOP
  PERFORM portal.register_source_document('knowledge_documents',to_jsonb(r));
 END LOOP;
 FOR r IN SELECT DISTINCT ON("objectId") * FROM portal.chat_documents ORDER BY "objectId","lastModifiedAt" DESC LOOP
  PERFORM portal.register_source_document('chat_documents',to_jsonb(r));
 END LOOP;
END $$;
