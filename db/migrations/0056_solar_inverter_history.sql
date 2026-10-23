-- The rest of FusionSolar's inverter charts (docs/solar.md):
--
--   solar_device_power.readings   every reading an inverter gives each 5 minutes (strings' and phases'
--                                 voltage and current, temperature, efficiency, frequency...), numbers only,
--                                 as FusionSolar names them; kept with the row (31 days)
--   solar_device_yield            each inverter's kWh by day, month and year (FusionSolar's device report);
--                                 kept with the plant
--   solar_devices.installed_kwp   each inverter's installed size as FusionSolar has it: summed, a plant's size
--                                 when its plant list gives none
--
-- Re-runnable.

ALTER TABLE "solar_device_power" ADD COLUMN IF NOT EXISTS "readings" jsonb;--> statement-breakpoint
ALTER TABLE "solar_devices" ADD COLUMN IF NOT EXISTS "installed_kwp" numeric(10, 3);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "solar_device_yield" (
  "dev_id" bigint NOT NULL REFERENCES "solar_devices"("dev_id") ON DELETE CASCADE,
  "period" text NOT NULL CHECK ("period" IN ('day', 'month', 'year')),
  "at" timestamp with time zone NOT NULL,
  "kwh" numeric(14, 3),
  PRIMARY KEY ("dev_id", "period", "at")
);
