-- Maintenance: the systems 9 Solar Home looks after once they're turned on.
--
--  * maintenance_systems: one row per installed system: what's on the roof,
--    the contract (PPA term, maintenance plan), the turn-on date and the two
--    scheduled checks (6 months, 1 year), roof access and any urgent issue.
--  * A project that's handed over (status 'closed') becomes a maintenance
--    record by itself (convert_to_maintenance): its development phase is done
--    and the project is kept, read-only, as the record's history.
--  * Systems from before the app (the 28 Aug 2026 project listing) are
--    imported with no project, no manager and no homeowner; a superadmin
--    assigns them later. import_ref keeps a re-import from adding them twice.
--  * Who may change what (guard_maintenance_write): a superadmin anything; a
--    project manager the records they run and unassigned ones, but only a
--    superadmin hands a record to a manager, adds one by hand or deletes one.
--    Every change is audited, under the project when there is one.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "maintenance_systems" (
  "system_id" serial PRIMARY KEY NOT NULL,
  "project_id" integer,
  "import_ref" text,
  "address" text NOT NULL,
  "postal_code" varchar(6),
  "run_by" integer,
  "homeowner_id" integer,
  "homeowner_name" text,
  "homeowner_contact_no" varchar(32),
  "ppa_kind" text,
  "ppa_years" smallint,
  "plan_years" smallint,
  "plan_excludes_first_year" boolean,
  "panels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "kwp" numeric(8, 3),
  "phase" smallint,
  "inverters" text[] DEFAULT '{}'::text[] NOT NULL,
  "turned_on_on" date,
  "six_month_due" date,
  "six_month_done_on" date,
  "one_year_due" date,
  "one_year_done_on" date,
  "roof_access" boolean,
  "urgent" boolean DEFAULT false NOT NULL,
  "urgent_note" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "maintenance_systems" DROP CONSTRAINT IF EXISTS "maintenance_systems_project_id_projects_project_id_fk";--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_systems" DROP CONSTRAINT IF EXISTS "maintenance_systems_run_by_users_uid_fk";--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_run_by_users_uid_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_systems" DROP CONSTRAINT IF EXISTS "maintenance_systems_homeowner_id_users_uid_fk";--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_homeowner_id_users_uid_fk" FOREIGN KEY ("homeowner_id") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "maintenance_systems" DROP CONSTRAINT IF EXISTS "maintenance_systems_values";--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_values" CHECK (
  btrim("address") <> ''
  AND ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{6}$')
  AND ("ppa_kind" IS NULL OR "ppa_kind" IN ('ppa', 'value_buy'))
  AND ("ppa_years" IS NULL OR "ppa_years" BETWEEN 1 AND 40)
  AND ("ppa_kind" IS DISTINCT FROM 'ppa' OR "ppa_years" IS NOT NULL)
  AND ("plan_years" IS NULL OR "plan_years" BETWEEN 1 AND 40)
  AND ("phase" IS NULL OR "phase" IN (1, 3))
  AND ("kwp" IS NULL OR "kwp" >= 0)
  AND jsonb_typeof("panels") = 'array'
  AND ("six_month_due" IS NULL OR "turned_on_on" IS NULL OR "six_month_due" >= "turned_on_on")
  AND ("one_year_due" IS NULL OR "six_month_due" IS NULL OR "one_year_due" >= "six_month_due")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_systems_project_idx" ON "maintenance_systems" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_systems_import_idx" ON "maintenance_systems" USING btree ("import_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_systems_run_by_idx" ON "maintenance_systems" USING btree ("run_by");--> statement-breakpoint

-- --------------------------------------------------------------- who may write

CREATE OR REPLACE FUNCTION guard_maintenance_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_type() IS DISTINCT FROM 'project_manager' THEN
    RAISE EXCEPTION 'Only 9 Solar Home''s project managers look after maintenance.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Only a superadmin can add or remove a maintenance record.' USING ERRCODE = '42501';
  END IF;
  IF OLD.run_by IS NOT NULL AND OLD.run_by IS DISTINCT FROM app_actor_uid() THEN
    RAISE EXCEPTION 'This system is looked after by another project manager.' USING ERRCODE = '42501';
  END IF;
  IF NEW.run_by IS DISTINCT FROM OLD.run_by THEN
    RAISE EXCEPTION 'Only a superadmin can hand a system to a project manager.' USING ERRCODE = '42501';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.import_ref IS DISTINCT FROM OLD.import_ref THEN
    RAISE EXCEPTION 'Where a maintenance record came from can''t be changed.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS guard_maintenance_write ON maintenance_systems;--> statement-breakpoint
CREATE TRIGGER guard_maintenance_write
  BEFORE INSERT OR UPDATE OR DELETE ON maintenance_systems
  FOR EACH ROW EXECUTE FUNCTION guard_maintenance_write();--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_maintenance_systems ON maintenance_systems;--> statement-breakpoint
CREATE TRIGGER audit_maintenance_systems
  AFTER INSERT OR UPDATE OR DELETE ON maintenance_systems
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('system_id');--> statement-breakpoint

-- ------------------------------------------------- a handed-over project

-- The record a project becomes: its address, its people, what went on the
-- roof, and its checks counted from the SP turn-on inspection (or, without
-- one, the day it was closed). The contract terms aren't in the project, so
-- they're left for the manager to fill in.
CREATE OR REPLACE FUNCTION maintenance_from_project(p projects) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_on date := COALESCE(p.sp_turn_on_inspection_date, (COALESCE(p.closed_at, now()) AT TIME ZONE 'Asia/Singapore')::date);
  v_count integer := COALESCE(p.panel_quantity_actual, p.panel_quantity_estimate);
  v_name text;
BEGIN
  SELECT COALESCE(u.full_name, u.email) INTO v_name FROM users u WHERE u.uid = p.homeowner_id;
  INSERT INTO maintenance_systems (
    project_id, address, postal_code, run_by, homeowner_id, homeowner_name, homeowner_contact_no,
    panels, kwp, inverters, turned_on_on, six_month_due, one_year_due
  ) VALUES (
    p.project_id, p.address, p.postal_code, p.project_manager_id, p.homeowner_id,
    COALESCE(v_name, p.homeowner_name), p.homeowner_contact_no,
    CASE WHEN v_count IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('count', v_count, 'wp', p.panel_capacity)) END,
    CASE WHEN v_count IS NOT NULL AND p.panel_capacity IS NOT NULL
         THEN round(v_count * p.panel_capacity / 1000.0, 3) END,
    CASE WHEN btrim(COALESCE(p.inverter_to_order, '')) = '' THEN '{}'::text[]
         ELSE ARRAY[btrim(p.inverter_to_order)] END,
    v_on, (v_on + interval '6 months')::date, (v_on + interval '1 year')::date
  )
  ON CONFLICT (project_id) DO NOTHING;
END $$;
--> statement-breakpoint
ALTER FUNCTION maintenance_from_project(projects) OWNER TO neondb_owner;--> statement-breakpoint

CREATE OR REPLACE FUNCTION convert_to_maintenance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed') THEN
    PERFORM maintenance_from_project(NEW);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS convert_to_maintenance ON projects;--> statement-breakpoint
CREATE TRIGGER convert_to_maintenance
  AFTER INSERT OR UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION convert_to_maintenance();--> statement-breakpoint

-- Projects handed over before this migration.
SELECT maintenance_from_project(p) FROM projects p
 WHERE p.status = 'closed'
   AND NOT EXISTS (SELECT 1 FROM maintenance_systems m WHERE m.project_id = p.project_id);
