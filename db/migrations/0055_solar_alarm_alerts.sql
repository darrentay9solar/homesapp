-- Alarms that matter, to the people who need them (docs/solar.md):
--
--   * an alert when FusionSolar raises an alarm: to the project manager who runs the plant's system
--     (superadmins when nobody does), and to its homeowner for major and critical ones;
--   * the app's own alarms (source 'app'): a plant making much less than similar plants are making at
--     the same moments ("Output below expected", "No output"), alerted to everyone on its project.
--
-- Each alarm is alerted once (notified_at); the ones already there when this arrived count as alerted.
-- FusionSolar's alarms clear when it stops listing them; the app's clear when the plant recovers.
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'solar_alarm';--> statement-breakpoint
ALTER TABLE "solar_alarms" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solar_alarms" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'fusionsolar';--> statement-breakpoint
ALTER TABLE "solar_alarms" DROP CONSTRAINT IF EXISTS "solar_alarms_source";--> statement-breakpoint
ALTER TABLE "solar_alarms" ADD CONSTRAINT "solar_alarms_source" CHECK ("source" IN ('fusionsolar', 'app'));--> statement-breakpoint
UPDATE "solar_alarms" SET "notified_at" = now() WHERE "notified_at" IS NULL;
