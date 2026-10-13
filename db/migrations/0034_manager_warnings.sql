-- Warnings for managers (_lib/watch.py, run by the 15-minute job).
--
--  * watch_alerts: which warning went to whom about what, so each goes once:
--      project_late    the day a project passes its target end date
--                      (subject: "<project_id>:<target date>")
--      escalation      a project 14 days late, or a check 30 days overdue,
--                      to the superadmins (subject says which)
--      daily_summary   the morning summary (subject: the day)
--    Written by the job only; nothing reads it but the job.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "watch_alerts" (
  "kind" text NOT NULL,
  "subject" text NOT NULL,
  "recipient_uid" integer NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "watch_alerts_pk" PRIMARY KEY ("kind", "subject", "recipient_uid"),
  CONSTRAINT "watch_alerts_kind" CHECK ("kind" IN ('project_late', 'escalation', 'daily_summary'))
);--> statement-breakpoint
ALTER TABLE "watch_alerts" DROP CONSTRAINT IF EXISTS "watch_alerts_recipient_fk";--> statement-breakpoint
ALTER TABLE "watch_alerts" ADD CONSTRAINT "watch_alerts_recipient_fk" FOREIGN KEY ("recipient_uid") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;
