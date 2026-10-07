-- Alerts: every notification links to what it's about, and can reach the
-- person's phone (Web Push) as well as the Alerts screen.
-- Re-runnable.

ALTER TYPE "public"."notification_channel" ADD VALUE IF NOT EXISTS 'push';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'crew_arrived_late';--> statement-breakpoint

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "subscription_id" serial PRIMARY KEY NOT NULL,
  "uid" integer NOT NULL REFERENCES "public"."users"("uid") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_success_at" timestamp with time zone,
  "failures" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_uid_idx" ON "push_subscriptions" ("uid");
--> statement-breakpoint

-- A subscription is added by the person whose phone it is. After that only
-- its delivery bookkeeping changes; it can be removed (turning notifications
-- off, or the push service saying the phone is gone). Not audited: like
-- notifications themselves, it's system bookkeeping, not anyone's decision.
CREATE OR REPLACE FUNCTION guard_push_subscriptions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.uid IS DISTINCT FROM app_actor_uid() THEN
    RAISE EXCEPTION 'You can only turn on notifications for yourself.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.uid, NEW.endpoint, NEW.p256dh, NEW.auth, NEW.created_at)
                          IS DISTINCT FROM (OLD.uid, OLD.endpoint, OLD.p256dh, OLD.auth, OLD.created_at) THEN
    RAISE EXCEPTION 'A notification subscription can''t be moved to someone else.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_push_subscriptions ON push_subscriptions;--> statement-breakpoint
CREATE TRIGGER guard_push_subscriptions
  BEFORE INSERT OR UPDATE OR DELETE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION guard_push_subscriptions();
