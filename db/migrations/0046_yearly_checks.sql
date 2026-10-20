-- Maintenance checks are yearly (api/_lib/checks.py): none in a system's first
-- year, then one a year from 24 months after turn-on, for the years of its
-- maintenance plan (else its contract's). The 6-month check is gone.
--
--   maintenance_checks     when each year's check was done (one row per done check;
--                          undoing it deletes the row). When it's due isn't stored:
--                          it follows from the turn-on date.
--   meetings.check_key and maintenance_reminders.check_key are now "year_<n>";
--   the older 'six_month' and 'one_year' stay allowed for the rows already there.
--   A handed-over project no longer gets 6-month and 1-year dates.
--
-- maintenance_systems.six_month_* and one_year_* are left as they were (no
-- longer read), so nothing already recorded is lost.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "maintenance_checks" (
  "system_id" integer NOT NULL,
  "year" smallint NOT NULL,
  "done_on" date NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_checks_pk" PRIMARY KEY ("system_id", "year"),
  CONSTRAINT "maintenance_checks_values" CHECK ("year" BETWEEN 2 AND 40)
);--> statement-breakpoint
ALTER TABLE "maintenance_checks" DROP CONSTRAINT IF EXISTS "maintenance_checks_system_fk";--> statement-breakpoint
ALTER TABLE "maintenance_checks" ADD CONSTRAINT "maintenance_checks_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Who may record a check: a superadmin, or the project manager looking after
-- the system (or any project manager while nobody is) — as for the system itself.
CREATE OR REPLACE FUNCTION guard_maintenance_checks_write() RETURNS trigger
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
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_maintenance_checks_write ON maintenance_checks;--> statement-breakpoint
CREATE TRIGGER guard_maintenance_checks_write BEFORE INSERT OR UPDATE OR DELETE ON maintenance_checks
  FOR EACH ROW EXECUTE FUNCTION guard_maintenance_checks_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_maintenance_checks ON maintenance_checks;--> statement-breakpoint
CREATE TRIGGER audit_maintenance_checks AFTER INSERT OR UPDATE OR DELETE ON maintenance_checks
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('system_id', 'year');--> statement-breakpoint

-- ------------------------------------------------------------------ check keys

ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_check_key";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_check_key" CHECK (
  "check_key" IS NULL OR "check_key" IN ('six_month', 'one_year') OR "check_key" ~ '^year_([2-9]|[1-3][0-9]|40)$'
);--> statement-breakpoint
-- meetings_values (0042) also limits check_key to the old two: rebuilt without that line.
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_values";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_values" CHECK (
  btrim("title") <> ''
  AND "kind" IN ('meeting', 'maintenance_check')
  -- 'site' and 'office' only from an app still running the older code during a release.
  AND "place" IN ('online', 'physical', 'phone', 'site', 'office')
  AND "ends_at" > "starts_at"
  AND "ends_at" - "starts_at" <= interval '12 hours'
  AND mod(extract(epoch FROM "starts_at")::bigint, 1800) = 0
  AND mod(extract(epoch FROM "ends_at")::bigint, 1800) = 0
  AND ("kind" <> 'maintenance_check' OR ("system_id" IS NOT NULL AND "check_key" IS NOT NULL))
  AND ("online_link" IS NULL OR "online_link" ~ '^https://')
  AND ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{6}$')
  AND cardinality("reminders") <= 5
  AND 0 <= ALL ("reminders") AND 40320 >= ALL ("reminders")
  AND ("repeat" IS NULL OR "repeat" IN ('daily', 'weekdays', 'weekly', 'fortnightly', 'monthly_day', 'monthly_weekday', 'yearly'))
  AND (("series_id" IS NULL) = ("repeat" IS NULL))
);--> statement-breakpoint

ALTER TABLE "maintenance_reminders" DROP CONSTRAINT IF EXISTS "maintenance_reminders_values";--> statement-breakpoint
ALTER TABLE "maintenance_reminders" ADD CONSTRAINT "maintenance_reminders_values" CHECK (
  ("check_key" IN ('six_month', 'one_year') OR "check_key" ~ '^year_([2-9]|[1-3][0-9]|40)$')
  AND "stage" IN ('soon', 'due', 'overdue')
);--> statement-breakpoint

-- ------------------------------------------------- a handed-over project

-- As 0038, without the 6-month and 1-year dates.
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
    panels, kwp, inverters, turned_on_on,
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
    v_on,
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
