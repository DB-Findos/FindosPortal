DO $$
DECLARE item record; tab text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('chat_conversations', 'owner_id uuid NOT NULL, title text NOT NULL, model text NOT NULL, reasoning_effort text NOT NULL DEFAULT ''medium'''),
  ('chat_messages', 'conversation_id uuid NOT NULL, role text NOT NULL CHECK(role IN (''user'',''assistant'')), content text NOT NULL, sent_at timestamptz NOT NULL DEFAULT clock_timestamp(), reply_to_id uuid, response_time_ms bigint CHECK(response_time_ms >= 0), model text NOT NULL, reasoning_effort text NOT NULL, status text NOT NULL DEFAULT ''complete'' CHECK(status IN (''complete'',''error'')), metadata jsonb NOT NULL DEFAULT ''{}''::jsonb'),
  ('chat_documents', 'owner_id uuid NOT NULL, conversation_id uuid NOT NULL, name text NOT NULL, document_at timestamptz NOT NULL DEFAULT clock_timestamp(), url text NOT NULL, extension text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 0 AND 5242880), source text NOT NULL CHECK(source IN (''upload'',''generated'')), sha256 text NOT NULL, data_base64 text NOT NULL, extracted_text text, extraction_note text'),
  ('chat_message_files', 'message_id uuid NOT NULL, document_id uuid NOT NULL')
 ) AS t(name, columns) LOOP
  tab := item.name;
  EXECUTE format('CREATE TABLE portal.%I (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL DEFAULT gen_random_uuid(),
    "priorId" uuid REFERENCES portal.%I(id), "createdAt" timestamptz NOT NULL DEFAULT now(),
    "lastModifiedAt" timestamptz NOT NULL DEFAULT now(), "archivedAt" timestamptz,
    "createdBy" uuid NOT NULL, "modifiedBy" uuid NOT NULL, %s)', tab, tab, item.columns);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("objectId") WHERE "archivedAt" IS NULL', tab || '_current', tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("priorId") WHERE "priorId" IS NOT NULL', tab || '_successor', tab);
  EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',tab);
  EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',tab);
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'createdBy','users');
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'modifiedBy','users');
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('chat_conversations','owner_id','users'), ('chat_messages','conversation_id','chat_conversations'),
  ('chat_messages','reply_to_id','chat_messages'), ('chat_documents','owner_id','users'),
  ('chat_documents','conversation_id','chat_conversations'), ('chat_message_files','message_id','chat_messages'),
  ('chat_message_files','document_id','chat_documents')
 ) AS t(tab,col,target) LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',item.col||'_ref',item.tab,item.col,item.target);
 END LOOP;
END $$;
CREATE INDEX chat_conversations_owner ON portal.chat_conversations(owner_id) WHERE "archivedAt" IS NULL;
CREATE INDEX chat_messages_conversation ON portal.chat_messages(conversation_id,sent_at,"objectId") WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX chat_messages_reply ON portal.chat_messages(reply_to_id) WHERE "archivedAt" IS NULL AND reply_to_id IS NOT NULL;
CREATE UNIQUE INDEX chat_message_files_pair ON portal.chat_message_files(message_id,document_id) WHERE "archivedAt" IS NULL;
CREATE INDEX chat_documents_conversation ON portal.chat_documents(conversation_id) WHERE "archivedAt" IS NULL;
INSERT INTO portal.entities(name) VALUES ('chat_conversations'),('chat_messages'),('chat_documents'),('chat_message_files');
INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
SELECT g."objectId",e."objectId",false,true,false,false FROM portal.user_groups g CROSS JOIN portal.entities e
WHERE g.name='Administrators' AND g."archivedAt" IS NULL AND e."archivedAt" IS NULL
AND e.name IN ('chat_conversations','chat_messages','chat_documents','chat_message_files');
