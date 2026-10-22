-- Solar monitoring from Huawei FusionSolar (its Northbound API), so the app shows what
-- FusionSolar shows and nobody needs FusionSolar itself (docs/solar.md).
--
--   solar_plants     every FusionSolar plant, linked to the app's system at that address; its
--                    latest live figures (power now, today, this month and year, in total)
--   solar_readings   yield (kWh) and income by hour, day, month and year, per plant
--   solar_devices    each plant's inverters, with their latest power and state
--   solar_alarms     FusionSolar's alarms, active and cleared
--   solar_sync       the sync's own bookkeeping: when each kind of call last ran, the
--                    session token, how far the history import has got. Not readable by the app's
--                    login beyond what the sync needs; never shown.
--
-- Written by the sync (api/_lib/solar_sync.py: the 15-minute job, and scripts/solar_import.py
-- for the history). A finished month's kWh also goes into system_output, which the monthly
-- invoices read. Re-runnable.

CREATE TABLE IF NOT EXISTS "solar_plants" (
  "station_code" text PRIMARY KEY,
  "name" text NOT NULL,
  "address" text,
  "capacity_kwp" numeric(10, 3),
  "grid_connected_on" date,
  "latitude" numeric(9, 6),
  "longitude" numeric(9, 6),
  "system_id" integer UNIQUE REFERENCES "maintenance_systems"("system_id") ON DELETE SET NULL,
  -- How the link was made: by address when the plant first came in, or by a person.
  "linked_by" text CHECK ("linked_by" IS NULL OR "linked_by" IN ('address', 'person')),
  "health" text CHECK ("health" IS NULL OR "health" IN ('normal', 'faulty', 'disconnected')),
  "current_kw" numeric(12, 3),
  "today_kwh" numeric(14, 3),
  "month_kwh" numeric(14, 3),
  "year_kwh" numeric(14, 3),
  "total_kwh" numeric(16, 3),
  "today_income" numeric(14, 2),
  "total_income" numeric(16, 2),
  "live_at" timestamp with time zone,
  "seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solar_plants_system" ON "solar_plants" ("system_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "solar_readings" (
  "station_code" text NOT NULL REFERENCES "solar_plants"("station_code") ON DELETE CASCADE,
  "period" text NOT NULL CHECK ("period" IN ('hour', 'day', 'month', 'year')),
  -- The start of the hour, day, month or year, Singapore time.
  "at" timestamp with time zone NOT NULL,
  "kwh" numeric(14, 3),
  "income" numeric(14, 2),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("station_code", "period", "at")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "solar_devices" (
  "dev_id" bigint PRIMARY KEY,
  "station_code" text NOT NULL REFERENCES "solar_plants"("station_code") ON DELETE CASCADE,
  "name" text,
  "serial" text,
  "type_id" integer,
  "model" text,
  "active_kw" numeric(12, 3),
  "today_kwh" numeric(14, 3),
  "total_kwh" numeric(16, 3),
  "state" text,
  "live_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solar_devices_plant" ON "solar_devices" ("station_code");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "solar_alarms" (
  "alarm_id" serial PRIMARY KEY,
  "station_code" text NOT NULL REFERENCES "solar_plants"("station_code") ON DELETE CASCADE,
  "device" text NOT NULL DEFAULT '',
  "name" text NOT NULL,
  -- FusionSolar's levels: critical, major, minor, warning.
  "level" text NOT NULL CHECK ("level" IN ('critical', 'major', 'minor', 'warning')),
  "cause" text,
  "suggestion" text,
  "raised_at" timestamp with time zone NOT NULL,
  "cleared_at" timestamp with time zone,
  "seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE ("station_code", "device", "name", "raised_at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solar_alarms_active" ON "solar_alarms" ("station_code") WHERE "cleared_at" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "solar_sync" (
  "key" text PRIMARY KEY,
  "value" jsonb,
  "at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- A finished month's kWh from FusionSolar into system_output (what the monthly invoices are
-- made from). system_output is a manager's record (its guard wants a project manager), so the
-- sync, which isn't a person, does it only through this: for one month, the linked plants'
-- figures, and only where they differ. The audit log shows it as done outside the app.
CREATE OR REPLACE FUNCTION solar_month_into_output(p_month date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  IF p_month IS NULL OR p_month >= date_trunc('month', now() AT TIME ZONE 'Asia/Singapore')::date THEN
    RAISE EXCEPTION 'Only a month that has finished.';
  END IF;
  INSERT INTO system_output (system_id, month, kwh)
  SELECT p.system_id, date_trunc('month', p_month)::date, round(r.kwh, 3)
    FROM solar_readings r JOIN solar_plants p USING (station_code)
   WHERE r.period = 'month'
     AND r.at = (date_trunc('month', p_month)::timestamp AT TIME ZONE 'Asia/Singapore')
     AND p.system_id IS NOT NULL AND r.kwh IS NOT NULL AND r.kwh >= 0
  ON CONFLICT (system_id, month) DO UPDATE SET kwh = excluded.kwh, updated_at = now()
   WHERE system_output.kwh IS DISTINCT FROM excluded.kwh;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION solar_month_into_output(date) FROM PUBLIC;--> statement-breakpoint
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION solar_month_into_output(date) TO gethomeapps_app';
  END IF;
END $do$;
