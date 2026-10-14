-- Reminders before a meeting (_lib/meeting_reminders.py, run by the 15-minute job).
--
--  * meeting_reminders: which reminder (a day before, or soon: within 30
--    minutes of the start) went to whom, so each goes once.
--  * notification_kind 'meeting_reminder'.
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'meeting_reminder';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meeting_reminders" (
  "meeting_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "stage" text NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meeting_reminders_pk" PRIMARY KEY ("meeting_id", "user_id", "stage", "starts_at"),
  CONSTRAINT "meeting_reminders_stage" CHECK ("stage" IN ('day', 'soon'))
);--> statement-breakpoint
ALTER TABLE "meeting_reminders" DROP CONSTRAINT IF EXISTS "meeting_reminders_meeting_fk";--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_meeting_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("meeting_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reminders" DROP CONSTRAINT IF EXISTS "meeting_reminders_user_fk";--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;
