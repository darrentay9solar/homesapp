-- Power through the day, as FusionSolar draws it (docs/solar.md): each inverter's output every 5
-- minutes (FusionSolar's getDevFiveMinutes), and each plant's, the sum of its inverters'.
--
--   solar_device_power   an inverter's kW at each 5 minutes; kept 7 days
--   solar_plant_power    a plant's kW at each 5 minutes; kept 90 days (older days chart from the
--                        hourly kWh in solar_readings, kept with the plant)
--
-- Written by the sync; the old points go in api/_lib/retention.py. Re-runnable.

CREATE TABLE IF NOT EXISTS "solar_device_power" (
  "dev_id" bigint NOT NULL REFERENCES "solar_devices"("dev_id") ON DELETE CASCADE,
  "at" timestamp with time zone NOT NULL,
  "kw" numeric(12, 3),
  PRIMARY KEY ("dev_id", "at")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solar_plant_power" (
  "station_code" text NOT NULL REFERENCES "solar_plants"("station_code") ON DELETE CASCADE,
  "at" timestamp with time zone NOT NULL,
  "kw" numeric(12, 3),
  PRIMARY KEY ("station_code", "at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solar_plant_power_at" ON "solar_plant_power" ("at");
