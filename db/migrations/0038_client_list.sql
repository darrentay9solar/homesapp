-- 9 Solar Home's project list in the app (scripts/import_client_list.py):
-- every client's record, monthly solar output, billing periods, feedback,
-- and the inverter warranties.
--
--  * Projects and maintenance systems keep the client record the list has:
--    project code (9SH…), salutation, email, signed date, salesperson
--    (projects: the Sales field), referrer, solar plan, rate per kWh, EPC,
--    PPA and phase (projects), the inverter's and dongle's serial numbers,
--    installation dates (systems), the monthly output estimate and billing
--    period (systems), and a note on where imported values came from.
--    A project closed into maintenance carries its record with it.
--  * system_output: kWh generated per system per month.
--  * system_billing: the billing period for each month (an owner-side
--    period such as "18 Jul – 17 Aug 2026", or "Full Calendar Month").
--  * client_feedback: what a homeowner said, on a project or a system.
--  * inverter_models: each inverter model's phase, price and warranty.
--    Seen by project managers and superadmins only (the API decides).
--
-- Written by project managers and superadmins (and the owner, for imports);
-- every change audited.
--
-- Re-runnable.

-- ------------------------------------------------------------------ the client record

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "salutation" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "homeowner_email" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "signed_on" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "referrer" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "solar_plan" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rate_per_kwh" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "ppa_kind" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "ppa_years" smallint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "phase" smallint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "dongle_serial" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "import_ref" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "record_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_project_code_idx" ON "projects" USING btree ("project_code") WHERE "project_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_record_values";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_record_values" CHECK (
  ("ppa_kind" IS NULL OR "ppa_kind" IN ('ppa', 'value_buy'))
  AND ("ppa_years" IS NULL OR "ppa_years" BETWEEN 1 AND 40)
  AND ("phase" IS NULL OR "phase" IN (1, 3))
  AND ("rate_per_kwh" IS NULL OR "rate_per_kwh" >= 0)
);--> statement-breakpoint

ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "project_code" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "salutation" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "homeowner_email" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "signed_on" date;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "salesperson" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "referrer" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "solar_plan" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "rate_per_kwh" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "epc" text;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "inverter_serials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "dongle_serials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "installation_start" date;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "installation_end" date;--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "est_monthly_kwh" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD COLUMN IF NOT EXISTS "billing_period" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_systems_project_code_idx" ON "maintenance_systems" USING btree ("project_code") WHERE "project_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_systems" DROP CONSTRAINT IF EXISTS "maintenance_systems_record_values";--> statement-breakpoint
ALTER TABLE "maintenance_systems" ADD CONSTRAINT "maintenance_systems_record_values" CHECK (
  ("rate_per_kwh" IS NULL OR "rate_per_kwh" >= 0) AND ("est_monthly_kwh" IS NULL OR "est_monthly_kwh" >= 0)
);--> statement-breakpoint

-- ------------------------------------------------------------------ output, billing, feedback, inverters

CREATE TABLE IF NOT EXISTS "system_output" (
  "system_id" integer NOT NULL,
  "month" date NOT NULL,
  "kwh" numeric(10, 2) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_output_pk" PRIMARY KEY ("system_id", "month"),
  CONSTRAINT "system_output_values" CHECK ("kwh" >= 0 AND extract(day from "month") = 1)
);--> statement-breakpoint
ALTER TABLE "system_output" DROP CONSTRAINT IF EXISTS "system_output_system_fk";--> statement-breakpoint
ALTER TABLE "system_output" ADD CONSTRAINT "system_output_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "system_billing" (
  "system_id" integer NOT NULL,
  "month" date NOT NULL,
  "period" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_billing_pk" PRIMARY KEY ("system_id", "month"),
  CONSTRAINT "system_billing_values" CHECK (btrim("period") <> '' AND extract(day from "month") = 1)
);--> statement-breakpoint
ALTER TABLE "system_billing" DROP CONSTRAINT IF EXISTS "system_billing_system_fk";--> statement-breakpoint
ALTER TABLE "system_billing" ADD CONSTRAINT "system_billing_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_feedback" (
  "feedback_id" serial PRIMARY KEY NOT NULL,
  "project_id" integer,
  "system_id" integer,
  "body" text NOT NULL,
  "import_ref" text,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_feedback_values" CHECK (btrim("body") <> '' AND length("body") <= 4000 AND ("project_id" IS NOT NULL OR "system_id" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "client_feedback" DROP CONSTRAINT IF EXISTS "client_feedback_project_fk";--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" DROP CONSTRAINT IF EXISTS "client_feedback_system_fk";--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" DROP CONSTRAINT IF EXISTS "client_feedback_created_by_fk";--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_feedback_import_idx" ON "client_feedback" USING btree ("import_ref") WHERE "import_ref" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inverter_models" (
  "model_key" text PRIMARY KEY NOT NULL,
  "model" text NOT NULL,
  "phase" smallint,
  "price_ex_gst" numeric(10, 2),
  "price_incl_gst" numeric(10, 2),
  "warranty_years" smallint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inverter_models_values" CHECK (
    btrim("model") <> '' AND ("phase" IS NULL OR "phase" IN (1, 3))
    AND ("warranty_years" IS NULL OR "warranty_years" BETWEEN 1 AND 40)
    AND ("price_ex_gst" IS NULL OR "price_ex_gst" >= 0) AND ("price_incl_gst" IS NULL OR "price_incl_gst" >= 0)
  )
);--> statement-breakpoint

-- ------------------------------------------------------------------ who may write

CREATE OR REPLACE FUNCTION guard_manager_records_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() OR app_actor_type() = 'project_manager' THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'client_feedback' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only 9 Solar Home''s project managers keep these records.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_system_output_write ON system_output;--> statement-breakpoint
CREATE TRIGGER guard_system_output_write BEFORE INSERT OR UPDATE OR DELETE ON system_output
  FOR EACH ROW EXECUTE FUNCTION guard_manager_records_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_system_billing_write ON system_billing;--> statement-breakpoint
CREATE TRIGGER guard_system_billing_write BEFORE INSERT OR UPDATE OR DELETE ON system_billing
  FOR EACH ROW EXECUTE FUNCTION guard_manager_records_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_client_feedback_write ON client_feedback;--> statement-breakpoint
CREATE TRIGGER guard_client_feedback_write BEFORE INSERT OR UPDATE OR DELETE ON client_feedback
  FOR EACH ROW EXECUTE FUNCTION guard_manager_records_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_inverter_models_write ON inverter_models;--> statement-breakpoint
CREATE TRIGGER guard_inverter_models_write BEFORE INSERT OR UPDATE OR DELETE ON inverter_models
  FOR EACH ROW EXECUTE FUNCTION guard_manager_records_write();--> statement-breakpoint

-- ------------------------------------------------------------------ audit

DROP TRIGGER IF EXISTS audit_system_output ON system_output;--> statement-breakpoint
CREATE TRIGGER audit_system_output AFTER INSERT OR UPDATE OR DELETE ON system_output
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('system_id', 'month');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_system_billing ON system_billing;--> statement-breakpoint
CREATE TRIGGER audit_system_billing AFTER INSERT OR UPDATE OR DELETE ON system_billing
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('system_id', 'month');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_client_feedback ON client_feedback;--> statement-breakpoint
CREATE TRIGGER audit_client_feedback AFTER INSERT OR UPDATE OR DELETE ON client_feedback
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('feedback_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_inverter_models ON inverter_models;--> statement-breakpoint
CREATE TRIGGER audit_inverter_models AFTER INSERT OR UPDATE OR DELETE ON inverter_models
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('model_key');--> statement-breakpoint

-- ------------------------------------------------------------------ a closed project keeps its record

CREATE OR REPLACE FUNCTION maintenance_from_project(p projects) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_on date := COALESCE(p.sp_turn_on_inspection_date, (COALESCE(p.closed_at, now()) AT TIME ZONE 'Asia/Singapore')::date);
  v_count integer := COALESCE(p.panel_quantity_actual, p.panel_quantity_estimate);
  v_name text;
  v_epc text;
BEGIN
  SELECT COALESCE(u.full_name, u.email) INTO v_name FROM users u WHERE u.uid = p.homeowner_id;
  SELECT g.name INTO v_epc FROM contractor_groups g WHERE g.group_id = p.contractor_group_id;
  INSERT INTO maintenance_systems (
    project_id, address, postal_code, run_by, homeowner_id, homeowner_name, homeowner_contact_no,
    panels, kwp, inverters, turned_on_on, six_month_due, one_year_due,
    project_code, salutation, homeowner_email, signed_on, salesperson, referrer, solar_plan, rate_per_kwh,
    epc, ppa_kind, ppa_years, phase, inverter_serials, dongle_serials, installation_start, installation_end
  ) VALUES (
    p.project_id, p.address, p.postal_code, p.project_manager_id, p.homeowner_id,
    COALESCE(v_name, p.homeowner_name), p.homeowner_contact_no,
    CASE WHEN v_count IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('count', v_count, 'wp', p.panel_capacity)) END,
    CASE WHEN v_count IS NOT NULL AND p.panel_capacity IS NOT NULL
         THEN round(v_count * p.panel_capacity / 1000.0, 3) END,
    CASE WHEN btrim(COALESCE(p.inverter_to_order, '')) = '' THEN '{}'::text[]
         ELSE ARRAY[btrim(p.inverter_to_order)] END,
    v_on, (v_on + interval '6 months')::date, (v_on + interval '1 year')::date,
    p.project_code, p.salutation, p.homeowner_email, p.signed_on, p.sales, p.referrer, p.solar_plan, p.rate_per_kwh,
    COALESCE(v_epc, NULLIF(btrim(COALESCE(p.contractor_text, '')), '')), p.ppa_kind, p.ppa_years, p.phase,
    CASE WHEN btrim(COALESCE(p.inverter_serial_number, '')) = '' THEN '{}'::text[] ELSE ARRAY[btrim(p.inverter_serial_number)] END,
    CASE WHEN btrim(COALESCE(p.dongle_serial, '')) = '' THEN '{}'::text[] ELSE ARRAY[btrim(p.dongle_serial)] END,
    p.installation_start_date, COALESCE(p.installation_end_date, p.target_end_date)
  )
  ON CONFLICT (project_id) DO NOTHING;
  -- What the homeowner said about the project stays with its system.
  UPDATE client_feedback f SET system_id = m.system_id
    FROM maintenance_systems m WHERE m.project_id = p.project_id AND f.project_id = p.project_id AND f.system_id IS NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION maintenance_from_project(projects) OWNER TO neondb_owner;
