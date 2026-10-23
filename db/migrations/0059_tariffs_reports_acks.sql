-- SP's electricity tariff, monthly solar reports, and acknowledging an alarm (docs/solar.md, docs/tariffs.md):
--
--   sp_tariffs                 SP Group's household tariff each quarter and what it's made of (energy,
--                              network, market support, market admin and power system operation), before
--                              GST, and with it; read from SP Group's tariff page each day. Earlier months'
--                              totals come from data.gov.sg (SP Group's own series), without the parts.
--   solar_alarms.acknowledged  who saw an alarm, when, and what they noted (FusionSolar's own "acknowledge"
--                              can't be reached: the app reads FusionSolar, never changes it)
--   notification kind          solar_report: a month's summary of each plant, to its manager and homeowner
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'solar_report';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sp_tariffs" (
  "starts_on" date PRIMARY KEY,
  "ends_on" date,
  "cents_without_gst" numeric(8, 4) NOT NULL,
  "cents_with_gst" numeric(8, 4),
  "energy_cents" numeric(8, 4),
  "network_cents" numeric(8, 4),
  "mss_cents" numeric(8, 4),
  "market_admin_cents" numeric(8, 4),
  "source" text NOT NULL CHECK ("source" IN ('sp_group', 'data_gov_sg')),
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "solar_alarms" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solar_alarms" ADD COLUMN IF NOT EXISTS "acknowledged_by" integer REFERENCES "users"("uid");--> statement-breakpoint
ALTER TABLE "solar_alarms" ADD COLUMN IF NOT EXISTS "ack_note" text;--> statement-breakpoint

-- Who acknowledged what is a record: in the audit log like every other change by a person.
DROP TRIGGER IF EXISTS audit_solar_alarms ON solar_alarms;--> statement-breakpoint
CREATE TRIGGER audit_solar_alarms AFTER UPDATE OF acknowledged_at, acknowledged_by, ack_note ON solar_alarms
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('alarm_id');
