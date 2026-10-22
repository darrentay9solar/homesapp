-- The rest of what FusionSolar shows (docs/solar.md), checked against the real account:
--
--   solar_plants     energy fed into the grid and used today (FusionSolar's day_on_grid_energy and
--                    day_use_energy, where a plant has a meter)
--   solar_readings   specific yield (kWh per kWp) for each day, month and year (perpower_ratio)
--   solar_devices    every device (inverters, and WiFi dongles too), its software version and
--                    optimisers, and an inverter's full live readings as FusionSolar gives them:
--                    power, reactive power, power factor, efficiency, frequency, temperature, each
--                    phase's voltage and current, each PV string's voltage and current, each MPPT's
--                    energy, and when it started and stopped today
--
-- Re-runnable.

ALTER TABLE "solar_plants" ADD COLUMN IF NOT EXISTS "today_feed_in_kwh" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "solar_plants" ADD COLUMN IF NOT EXISTS "today_use_kwh" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "solar_readings" ADD COLUMN IF NOT EXISTS "specific_yield" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "solar_devices" ADD COLUMN IF NOT EXISTS "software_version" text;--> statement-breakpoint
ALTER TABLE "solar_devices" ADD COLUMN IF NOT EXISTS "optimizers" integer;--> statement-breakpoint
-- FusionSolar's own field names and numbers (no names, serials or addresses): {"a_u": 231.4, "pv1_u": 412.0, ...}.
ALTER TABLE "solar_devices" ADD COLUMN IF NOT EXISTS "readings" jsonb;
