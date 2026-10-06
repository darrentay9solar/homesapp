-- Site visits: the dates the EPC team must be on site, and their reminders.
--
-- Re-runnable.
CREATE TABLE IF NOT EXISTS "visit_reminders" (
	"visit_id" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_reminders_visit_id_kind_pk" PRIMARY KEY("visit_id","kind"),
	CONSTRAINT "visit_reminders_kind" CHECK ("visit_reminders"."kind" in ('before', 'missed'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_reminders_visit_id_site_visits_visit_id_fk') THEN
    ALTER TABLE "visit_reminders" ADD CONSTRAINT "visit_reminders_visit_id_site_visits_visit_id_fk"
      FOREIGN KEY ("visit_id") REFERENCES "public"."site_visits"("visit_id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- A visit's time, when given, is HH:MM on the 24-hour clock.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_visits_time_format') THEN
    ALTER TABLE site_visits ADD CONSTRAINT site_visits_time_format
      CHECK (scheduled_time IS NULL OR scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') NOT VALID;
  END IF;
END $$;
--> statement-breakpoint

-- Who may schedule, move or cancel a visit: a project manager or the
-- project's crew (the brief: "the admin team or the project manager"), once
-- the project is approved and before handover. A visit someone has checked
-- in for is a record of what happened; it can't be moved or cancelled.
CREATE OR REPLACE FUNCTION guard_visits_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pid integer := COALESCE(NEW.project_id, OLD.project_id);
  v_status project_status;
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT (app_actor_is_pm() OR app_actor_on_crew(v_pid)) THEN
    RAISE EXCEPTION 'Only a project manager or the project''s crew can schedule site visits.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM projects WHERE project_id = v_pid;
  IF v_status NOT IN ('pm_approved', 'in_progress') THEN
    RAISE EXCEPTION 'Site visits can be scheduled once the project is approved, and until handover.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM site_check_ins c
     WHERE c.visit_id = OLD.visit_id
        OR (c.project_id = OLD.project_id AND (c.checked_in_at AT TIME ZONE 'Asia/Singapore')::date = OLD.scheduled_date)
  ) THEN
    RAISE EXCEPTION 'The crew has checked in for this visit, so it stays as a record.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_site_visits ON site_visits;
--> statement-breakpoint
CREATE TRIGGER guard_site_visits
  BEFORE INSERT OR UPDATE OR DELETE ON site_visits
  FOR EACH ROW EXECUTE FUNCTION guard_visits_write();
