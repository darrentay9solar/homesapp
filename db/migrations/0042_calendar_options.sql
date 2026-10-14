-- The meeting form, like Google Calendar's:
--
--  * place: "On site" and "At the office" become one, "physical", with the
--    address's postal code (postal_code).
--  * reminders: when each person is reminded, in minutes before the start
--    (up to five, up to four weeks before); an hour before unless chosen.
--    meeting_reminders.stage records which one went (the minutes); 'day' and
--    'soon' stay for the reminders sent before this.
--  * repeating meetings: each occurrence is its own meeting (its own answers,
--    busy time and audit), sharing a series_id (the first one's meeting_id),
--    with the rule it repeats by (repeat) for the screens to say so.
--
-- Re-runnable.

ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "postal_code" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "reminders" integer[] DEFAULT '{60}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "series_id" integer;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "repeat" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_series_idx" ON "meetings" USING btree ("series_id", "starts_at");--> statement-breakpoint

-- The owner's connection rewrites the place without the guard (it bypasses it).
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_values";--> statement-breakpoint
UPDATE "meetings" SET "place" = 'physical' WHERE "place" IN ('site', 'office');--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_values" CHECK (
  btrim("title") <> ''
  AND "kind" IN ('meeting', 'maintenance_check')
  -- 'site' and 'office' only from an app still running the older code during a release.
  AND "place" IN ('online', 'physical', 'phone', 'site', 'office')
  AND "ends_at" > "starts_at"
  AND "ends_at" - "starts_at" <= interval '12 hours'
  AND mod(extract(epoch FROM "starts_at")::bigint, 1800) = 0
  AND mod(extract(epoch FROM "ends_at")::bigint, 1800) = 0
  AND ("check_key" IS NULL OR "check_key" IN ('six_month', 'one_year'))
  AND ("kind" <> 'maintenance_check' OR ("system_id" IS NOT NULL AND "check_key" IS NOT NULL))
  AND ("online_link" IS NULL OR "online_link" ~ '^https://')
  AND ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{6}$')
  AND cardinality("reminders") <= 5
  AND 0 <= ALL ("reminders") AND 40320 >= ALL ("reminders")
  AND ("repeat" IS NULL OR "repeat" IN ('daily', 'weekdays', 'weekly', 'fortnightly', 'monthly_day', 'monthly_weekday', 'yearly'))
  AND (("series_id" IS NULL) = ("repeat" IS NULL))
);--> statement-breakpoint

ALTER TABLE "meeting_reminders" DROP CONSTRAINT IF EXISTS "meeting_reminders_stage";--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_stage" CHECK ("stage" IN ('day', 'soon') OR "stage" ~ '^[0-9]{1,5}$');
