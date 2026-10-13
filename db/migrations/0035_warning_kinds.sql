-- The alert kinds for managers' warnings (_lib/watch.py, 0034): a project
-- gone late, an escalation to the superadmins, and the morning summary.
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'project_late';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'escalation';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'daily_summary';
