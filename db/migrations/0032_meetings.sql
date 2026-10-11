-- Meetings and calendars; the maintenance stage; maintenance reminders.
--
--  * project_status 'closed' becomes 'maintenance': a handed-over project's
--    development phase is done and it's in maintenance. Every database
--    function comparing against the old value is rewritten to the new one.
--  * meetings: one row per meeting, on 30-minute marks (Singapore keeps
--    whole-hour offsets, so marks in UTC are marks locally). A meeting can be
--    a maintenance check (system_id + check_key) and can belong to a project.
--    meeting_people: who's invited (the organiser too, accepted), and their
--    answer. calendar_blocks: time a person has blocked out themselves.
--    A person is busy when they've accepted a meeting or blocked the time;
--    an invitation they haven't answered doesn't block anything yet.
--  * Who may write (guard_meetings_write, guard_meeting_people_write,
--    guard_calendar_blocks_write): the organiser arranges, changes and
--    cancels a meeting (a superadmin too); each person answers only for
--    themselves, and accepting a time they're already busy at is refused;
--    blocks are a person's own. Every change is audited.
--  * maintenance_reminders: which reminder (14 days before, on the day,
--    overdue) went out for which check, so each goes once.
--
-- Re-runnable.

-- ------------------------------------------------------------ the maintenance stage

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'project_status' AND e.enumlabel = 'closed') THEN
    ALTER TYPE "public"."project_status" RENAME VALUE 'closed' TO 'maintenance';
  END IF;
END $$;--> statement-breakpoint

-- Functions keep their source as text, so a renamed value would fail at run
-- time: rewrite every one that names it.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosrc LIKE '%''closed''%' LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), '''closed''', '''maintenance''');
  END LOOP;
END $$;--> statement-breakpoint

-- ------------------------------------------------------------------ notifications

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'meeting_request';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'meeting_response';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'meeting_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'maintenance_due';--> statement-breakpoint

-- ------------------------------------------------------------------ meetings

CREATE TABLE IF NOT EXISTS "meetings" (
  "meeting_id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "kind" text DEFAULT 'meeting' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "place" text DEFAULT 'online' NOT NULL,
  "location" text,
  "online_link" text,
  "notes" text,
  "organiser_id" integer NOT NULL,
  "project_id" integer,
  "system_id" integer,
  "check_key" text,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_organiser_id_users_uid_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organiser_id_users_uid_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_cancelled_by_users_uid_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_cancelled_by_users_uid_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_project_id_projects_project_id_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_system_id_maintenance_systems_system_id_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_system_id_maintenance_systems_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_values";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_values" CHECK (
  btrim("title") <> ''
  AND "kind" IN ('meeting', 'maintenance_check')
  AND "place" IN ('online', 'site', 'office', 'phone')
  AND "ends_at" > "starts_at"
  AND "ends_at" - "starts_at" <= interval '12 hours'
  AND mod(extract(epoch FROM "starts_at")::bigint, 1800) = 0
  AND mod(extract(epoch FROM "ends_at")::bigint, 1800) = 0
  AND ("check_key" IS NULL OR "check_key" IN ('six_month', 'one_year'))
  AND ("kind" <> 'maintenance_check' OR ("system_id" IS NOT NULL AND "check_key" IS NOT NULL))
  AND ("online_link" IS NULL OR "online_link" ~ '^https://')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_time_idx" ON "meetings" USING btree ("starts_at", "ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_system_idx" ON "meetings" USING btree ("system_id", "check_key");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meeting_people" (
  "meeting_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "response" text DEFAULT 'pending' NOT NULL,
  "responded_at" timestamp with time zone,
  CONSTRAINT "meeting_people_pk" PRIMARY KEY ("meeting_id", "user_id"),
  CONSTRAINT "meeting_people_response" CHECK ("response" IN ('pending', 'accepted', 'declined'))
);--> statement-breakpoint
ALTER TABLE "meeting_people" DROP CONSTRAINT IF EXISTS "meeting_people_meeting_id_meetings_meeting_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_people" ADD CONSTRAINT "meeting_people_meeting_id_meetings_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("meeting_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_people" DROP CONSTRAINT IF EXISTS "meeting_people_user_id_users_uid_fk";--> statement-breakpoint
ALTER TABLE "meeting_people" ADD CONSTRAINT "meeting_people_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_people_user_idx" ON "meeting_people" USING btree ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "calendar_blocks" (
  "block_id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_blocks_values" CHECK (
    "ends_at" > "starts_at"
    AND "ends_at" - "starts_at" <= interval '62 days'
    AND mod(extract(epoch FROM "starts_at")::bigint, 1800) = 0
    AND mod(extract(epoch FROM "ends_at")::bigint, 1800) = 0
  )
);--> statement-breakpoint
ALTER TABLE "calendar_blocks" DROP CONSTRAINT IF EXISTS "calendar_blocks_user_id_users_uid_fk";--> statement-breakpoint
ALTER TABLE "calendar_blocks" ADD CONSTRAINT "calendar_blocks_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_blocks_user_idx" ON "calendar_blocks" USING btree ("user_id", "starts_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "maintenance_reminders" (
  "system_id" integer NOT NULL,
  "check_key" text NOT NULL,
  "due" date NOT NULL,
  "stage" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_reminders_pk" PRIMARY KEY ("system_id", "check_key", "due", "stage"),
  CONSTRAINT "maintenance_reminders_values" CHECK ("check_key" IN ('six_month', 'one_year') AND "stage" IN ('soon', 'due', 'overdue'))
);--> statement-breakpoint
ALTER TABLE "maintenance_reminders" DROP CONSTRAINT IF EXISTS "maintenance_reminders_system_id_fk";--> statement-breakpoint
ALTER TABLE "maintenance_reminders" ADD CONSTRAINT "maintenance_reminders_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ------------------------------------------------------------------ busy

-- Whether this person is busy between these times: a meeting they've
-- accepted (other than the one named) or time they've blocked out.
CREATE OR REPLACE FUNCTION app_person_busy(p_user integer, p_from timestamptz, p_to timestamptz, p_except integer DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
      SELECT 1 FROM meeting_people mp JOIN meetings m ON m.meeting_id = mp.meeting_id
       WHERE mp.user_id = p_user AND mp.response = 'accepted' AND m.cancelled_at IS NULL
         AND m.meeting_id IS DISTINCT FROM p_except
         AND m.starts_at < p_to AND m.ends_at > p_from)
      OR EXISTS (
      SELECT 1 FROM calendar_blocks b
       WHERE b.user_id = p_user AND b.starts_at < p_to AND b.ends_at > p_from)
$$;
--> statement-breakpoint

-- ------------------------------------------------------------------ who may write

CREATE OR REPLACE FUNCTION guard_meetings_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_uid() IS NULL OR app_actor_type() IS NULL THEN
    RAISE EXCEPTION 'Sign in to arrange a meeting.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.organiser_id IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'A meeting is arranged by the person sending it.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.organiser_id IS DISTINCT FROM app_actor_uid() AND NOT app_actor_is_superadmin() THEN
    RAISE EXCEPTION 'Only the person who arranged this meeting can change it.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A meeting is cancelled, not deleted, so it stays on record.' USING ERRCODE = '42501';
  END IF;
  IF NEW.organiser_id IS DISTINCT FROM OLD.organiser_id THEN
    RAISE EXCEPTION 'A meeting''s organiser can''t be changed.' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This meeting was cancelled.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_meetings_write ON meetings;--> statement-breakpoint
CREATE TRIGGER guard_meetings_write BEFORE INSERT OR UPDATE OR DELETE ON meetings
  FOR EACH ROW EXECUTE FUNCTION guard_meetings_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_meeting_people_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_meeting meetings;
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE meeting_id = COALESCE(NEW.meeting_id, OLD.meeting_id);
  IF NOT app_is_table_owner(TG_RELID) THEN
    IF app_actor_uid() IS NULL OR app_actor_type() IS NULL THEN
      RAISE EXCEPTION 'Sign in to answer a meeting.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP IN ('INSERT', 'DELETE') THEN
      IF v_meeting.organiser_id IS DISTINCT FROM app_actor_uid() AND NOT app_actor_is_superadmin() THEN
        RAISE EXCEPTION 'Only the person who arranged this meeting can change who''s invited.' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.user_id IS DISTINCT FROM app_actor_uid()
          AND NOT (NEW.response = 'pending' AND (v_meeting.organiser_id = app_actor_uid() OR app_actor_is_superadmin())) THEN
      -- Only a person answers for themselves; the organiser may only ask again (back to pending) after a change.
      RAISE EXCEPTION 'Only you can answer for yourself.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.meeting_id <> OLD.meeting_id OR NEW.user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'An invitation can''t be moved to someone else.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Accepting a time you're already busy at would double-book you.
  IF TG_OP <> 'DELETE' AND NEW.response = 'accepted' AND v_meeting.cancelled_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.response IS DISTINCT FROM 'accepted')
     AND app_person_busy(NEW.user_id, v_meeting.starts_at, v_meeting.ends_at, v_meeting.meeting_id) THEN
    RAISE EXCEPTION 'That time is already taken in % calendar.',
      CASE WHEN NEW.user_id = app_actor_uid() THEN 'your' ELSE 'their' END USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.response IS DISTINCT FROM COALESCE(OLD.response, 'pending') THEN
    NEW.responded_at := CASE WHEN NEW.response = 'pending' THEN NULL ELSE now() END;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_meeting_people_write ON meeting_people;--> statement-breakpoint
CREATE TRIGGER guard_meeting_people_write BEFORE INSERT OR UPDATE OR DELETE ON meeting_people
  FOR EACH ROW EXECUTE FUNCTION guard_meeting_people_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_calendar_blocks_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(NEW.user_id, OLD.user_id) IS DISTINCT FROM app_actor_uid() OR app_actor_type() IS NULL THEN
    RAISE EXCEPTION 'You can only block out time in your own calendar.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'You can only block out time in your own calendar.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_calendar_blocks_write ON calendar_blocks;--> statement-breakpoint
CREATE TRIGGER guard_calendar_blocks_write BEFORE INSERT OR UPDATE OR DELETE ON calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION guard_calendar_blocks_write();--> statement-breakpoint

-- ------------------------------------------------------------------ audit

DROP TRIGGER IF EXISTS audit_meetings ON meetings;--> statement-breakpoint
CREATE TRIGGER audit_meetings AFTER INSERT OR UPDATE OR DELETE ON meetings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('meeting_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_meeting_people ON meeting_people;--> statement-breakpoint
CREATE TRIGGER audit_meeting_people AFTER INSERT OR UPDATE OR DELETE ON meeting_people
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('meeting_id', 'user_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_calendar_blocks ON calendar_blocks;--> statement-breakpoint
CREATE TRIGGER audit_calendar_blocks AFTER INSERT OR UPDATE OR DELETE ON calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('block_id');
--> statement-breakpoint

-- ------------------------------------------------------------------ exports

-- Each Excel export: who took which list, and how many rows. An export is
-- an act on personal data, so it's kept like any other change: insert only,
-- by the person exporting, and audited.
CREATE TABLE IF NOT EXISTS "data_exports" (
  "export_id" serial PRIMARY KEY NOT NULL,
  "what" text NOT NULL,
  "row_count" integer NOT NULL,
  "exported_by" integer NOT NULL,
  "exported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "data_exports_values" CHECK ("what" IN ('projects', 'people') AND "row_count" >= 0)
);--> statement-breakpoint
ALTER TABLE "data_exports" DROP CONSTRAINT IF EXISTS "data_exports_exported_by_users_uid_fk";--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_exported_by_users_uid_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_data_exports_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'The record of an export can''t be changed.' USING ERRCODE = '42501';
  END IF;
  IF NEW.exported_by IS DISTINCT FROM app_actor_uid() OR COALESCE(app_actor_type() NOT IN ('project_manager', 'superadmin'), true) THEN
    RAISE EXCEPTION 'Only a project manager can export.' USING ERRCODE = '42501';
  END IF;
  NEW.exported_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_data_exports_write ON data_exports;--> statement-breakpoint
CREATE TRIGGER guard_data_exports_write BEFORE INSERT OR UPDATE OR DELETE ON data_exports
  FOR EACH ROW EXECUTE FUNCTION guard_data_exports_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_data_exports ON data_exports;--> statement-breakpoint
CREATE TRIGGER audit_data_exports AFTER INSERT OR UPDATE OR DELETE ON data_exports
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('export_id');
