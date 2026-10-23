-- Maintenance the project manager starts (docs/maintenance.md): homeowners don't see a system's check
-- schedule; they hear when its manager starts maintenance, are invited to the visit, and hear when it's done.
--
--   maintenance_jobs   one piece of maintenance on a system: for one of its yearly checks, or not tied to
--                      one; started -> done or cancelled; at most one open at a time per system
--
-- The 6-month check comes back as a record for the office (maintenance_systems.six_month_due and
-- six_month_done_on, kept since 0031): no reminders, no workflow, never shown to the homeowner.
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'maintenance_started';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'maintenance_done';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "maintenance_jobs" (
  "job_id" serial PRIMARY KEY,
  "system_id" integer NOT NULL REFERENCES "maintenance_systems"("system_id") ON DELETE CASCADE,
  "check_key" text,
  "status" text NOT NULL DEFAULT 'started',
  "note" text,
  "started_by" integer REFERENCES "users"("uid") ON DELETE SET NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_by" integer REFERENCES "users"("uid") ON DELETE SET NULL,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "maintenance_jobs_values" CHECK (
    "status" IN ('started', 'done', 'cancelled')
    AND ("check_key" IS NULL OR "check_key" ~ '^year_([2-9]|[1-3][0-9]|40)$')
    AND (("status" = 'started') = ("finished_at" IS NULL))
    AND ("note" IS NULL OR char_length("note") <= 1000)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_jobs_one_open" ON "maintenance_jobs" ("system_id") WHERE "status" = 'started';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_jobs_system" ON "maintenance_jobs" ("system_id", "started_at");--> statement-breakpoint

-- Who may start or finish maintenance: as for recording a check (0046): a superadmin, or the project
-- manager looking after the system (any project manager while nobody is).
CREATE OR REPLACE FUNCTION guard_maintenance_jobs_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_run_by integer;
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_type() IS DISTINCT FROM 'project_manager' THEN
    RAISE EXCEPTION 'Only 9 Solar Home''s project managers look after maintenance.' USING ERRCODE = '42501';
  END IF;
  SELECT run_by INTO v_run_by FROM maintenance_systems WHERE system_id = COALESCE(NEW.system_id, OLD.system_id);
  IF v_run_by IS NOT NULL AND v_run_by IS DISTINCT FROM app_actor_uid() THEN
    RAISE EXCEPTION 'This system is looked after by another project manager.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Maintenance is called off, not deleted: it stays on the record.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_maintenance_jobs_write ON maintenance_jobs;--> statement-breakpoint
CREATE TRIGGER guard_maintenance_jobs_write BEFORE INSERT OR UPDATE OR DELETE ON maintenance_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_maintenance_jobs_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_maintenance_jobs ON maintenance_jobs;--> statement-breakpoint
CREATE TRIGGER audit_maintenance_jobs AFTER INSERT OR UPDATE OR DELETE ON maintenance_jobs
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('job_id');
