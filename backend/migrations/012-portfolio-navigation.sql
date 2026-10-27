-- Persisted navigation catalog and group visibility rules.
DO $$ DECLARE tab text; item record; actor uuid; BEGIN
 SELECT u."objectId" INTO actor FROM portal.users u
 JOIN portal.user_group_memberships m ON m.user_id=u."objectId" AND m."archivedAt" IS NULL
 JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL
 WHERE g.name='Administrators' AND u."archivedAt" IS NULL ORDER BY u."createdAt" LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'An active administrator is required to seed navigation'; END IF;
 PERFORM set_config('portal.actor_id',actor::text,true);
 FOREACH tab IN ARRAY ARRAY['portfolio_sections','portfolio_views','portfolio_navigation_access'] LOOP
  EXECUTE format('CREATE TABLE portal.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "objectId" uuid NOT NULL DEFAULT gen_random_uuid(), "priorId" uuid, "createdAt" timestamptz NOT NULL DEFAULT now(), "lastModifiedAt" timestamptz NOT NULL DEFAULT now(), "archivedAt" timestamptz, "createdBy" uuid NOT NULL, "modifiedBy" uuid NOT NULL)',tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("objectId") WHERE "archivedAt" IS NULL',tab||'_current',tab);
  EXECUTE format('CREATE UNIQUE INDEX %I ON portal.%I ("priorId") WHERE "priorId" IS NOT NULL',tab||'_successor',tab);
  EXECUTE format('ALTER TABLE portal.%I ADD CONSTRAINT %I FOREIGN KEY ("priorId") REFERENCES portal.%I(id), ADD CONSTRAINT %I FOREIGN KEY ("objectId") REFERENCES portal.object_registry(id), ADD CONSTRAINT %I FOREIGN KEY ("createdBy") REFERENCES portal.object_registry(id), ADD CONSTRAINT %I FOREIGN KEY ("modifiedBy") REFERENCES portal.object_registry(id)',tab,tab||'_prior_fk',tab,tab||'_object_fk',tab||'_creator_fk',tab||'_modifier_fk');
  EXECUTE format('CREATE TRIGGER audit_insert BEFORE INSERT ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.audit_version_insert()',tab);
  EXECUTE format('CREATE TRIGGER protect_versions BEFORE UPDATE OR DELETE ON portal.%I FOR EACH ROW EXECUTE FUNCTION portal.protect_version()',tab);
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_creator AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'createdBy','users');
  EXECUTE format('CREATE CONSTRAINT TRIGGER audit_modifier AFTER INSERT ON portal.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference(%L,%L)',tab,'modifiedBy','users');
 END LOOP;
 ALTER TABLE portal.portfolio_sections ADD COLUMN name text NOT NULL, ADD COLUMN label text NOT NULL, ADD COLUMN icon text NOT NULL DEFAULT 'folder', ADD COLUMN position integer NOT NULL DEFAULT 0;
 ALTER TABLE portal.portfolio_views ADD COLUMN section_id uuid NOT NULL, ADD COLUMN name text NOT NULL, ADD COLUMN label text NOT NULL, ADD COLUMN path text NOT NULL, ADD COLUMN icon text NOT NULL DEFAULT 'layout-dashboard', ADD COLUMN position integer NOT NULL DEFAULT 0;
 ALTER TABLE portal.portfolio_navigation_access ADD COLUMN group_id uuid NOT NULL, ADD COLUMN view_id uuid NOT NULL, ADD COLUMN can_read boolean NOT NULL DEFAULT false;
 CREATE UNIQUE INDEX portfolio_section_name ON portal.portfolio_sections(name) WHERE "archivedAt" IS NULL;
 CREATE UNIQUE INDEX portfolio_view_path ON portal.portfolio_views(path) WHERE "archivedAt" IS NULL;
 ALTER TABLE portal.portfolio_views ADD CONSTRAINT portfolio_views_section_fk FOREIGN KEY (section_id) REFERENCES portal.object_registry(id);
 ALTER TABLE portal.portfolio_navigation_access ADD CONSTRAINT portfolio_access_group_fk FOREIGN KEY (group_id) REFERENCES portal.object_registry(id), ADD CONSTRAINT portfolio_access_view_fk FOREIGN KEY (view_id) REFERENCES portal.object_registry(id);
 CREATE TRIGGER section_ref BEFORE INSERT ON portal.portfolio_views FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('section_id','portfolio_sections');
 CREATE TRIGGER access_group_ref BEFORE INSERT ON portal.portfolio_navigation_access FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('group_id','user_groups');
 CREATE TRIGGER access_view_ref BEFORE INSERT ON portal.portfolio_navigation_access FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('view_id','portfolio_views');
 INSERT INTO portal.entities(name) VALUES ('portfolio_sections'),('portfolio_views'),('portfolio_navigation_access');
 INSERT INTO portal.permissions(group_id,entity_id,can_create,can_read,can_update,can_delete)
 SELECT g."objectId",e."objectId",g.name='Administrators',g.name='Administrators',g.name='Administrators',g.name='Administrators'
 FROM portal.user_groups g CROSS JOIN portal.entities e
 WHERE g."archivedAt" IS NULL AND e."archivedAt" IS NULL
 AND e.name IN ('portfolio_sections','portfolio_views','portfolio_navigation_access');
 INSERT INTO portal.portfolio_sections(name,label,icon,position) VALUES ('portfolio-management','Portfolio Management','briefcase-business',10);
 INSERT INTO portal.portfolio_views(section_id,name,label,path,icon,position)
 SELECT s."objectId",v.name,v.label,v.path,v.icon,v.position::integer FROM portal.portfolio_sections s CROSS JOIN (VALUES
  ('dashboard','Dashboard','/portfolio/dashboard','layout-dashboard',10::integer),
  ('company','Company','/portfolio/company','building-2',20::integer),
  ('fund','Fund','/portfolio/fund','wallet-cards',30::integer)
 ) AS v(name,label,path,icon,position) WHERE s.name='portfolio-management' AND s."archivedAt" IS NULL;
 INSERT INTO portal.portfolio_navigation_access(group_id,view_id,can_read)
 SELECT g."objectId",v."objectId",true FROM portal.user_groups g CROSS JOIN portal.portfolio_views v
 WHERE g.name='Administrators' AND g."archivedAt" IS NULL AND v."archivedAt" IS NULL;
END $$;
