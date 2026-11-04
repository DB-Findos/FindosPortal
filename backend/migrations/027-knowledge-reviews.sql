ALTER TABLE portal.knowledge_entries
 ADD COLUMN "upToDate" boolean NOT NULL DEFAULT false,
 ADD COLUMN "reviewCycleMonths" integer NOT NULL DEFAULT 12 CHECK("reviewCycleMonths" BETWEEN 1 AND 120),
 ADD COLUMN "reviewedAt" timestamptz,
 ADD COLUMN "reviewedBy" uuid,
 ADD COLUMN "reviewDueAt" timestamptz,
 ADD CONSTRAINT knowledge_review_valid CHECK(NOT "upToDate" OR ("reviewedAt" IS NOT NULL AND "reviewDueAt">"reviewedAt"));
CREATE CONSTRAINT TRIGGER reviewer_ref AFTER INSERT ON portal.knowledge_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal.validate_logical_reference('reviewedBy','users');
CREATE INDEX knowledge_reviews_due ON portal.knowledge_entries("reviewDueAt") WHERE "archivedAt" IS NULL AND "upToDate";
CREATE INDEX knowledge_responsible ON portal.knowledge_entries(responsible_id) WHERE "archivedAt" IS NULL;

CREATE FUNCTION portal.set_knowledge_review_deadline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."upToDate" THEN
  NEW."reviewDueAt":=NEW."reviewedAt"+make_interval(months=>NEW."reviewCycleMonths");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_deadline BEFORE INSERT ON portal.knowledge_entries FOR EACH ROW EXECUTE FUNCTION portal.set_knowledge_review_deadline();

-- Expiry creates an audited successor instead of modifying immutable business fields.
CREATE FUNCTION portal.expire_knowledge_reviews() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r portal.knowledge_entries; affected integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('knowledge-review-expiry')) THEN RETURN 0; END IF;
 FOR r IN SELECT * FROM portal.knowledge_entries WHERE "archivedAt" IS NULL AND "upToDate" AND "reviewDueAt"<=clock_timestamp() FOR UPDATE SKIP LOCKED LOOP
  UPDATE portal.knowledge_entries SET "archivedAt"=clock_timestamp() WHERE id=r.id;
  INSERT INTO portal.knowledge_entries
   SELECT (jsonb_populate_record(NULL::portal.knowledge_entries,
    to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'priorId',r.id,'upToDate',false))).*;
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $$;
