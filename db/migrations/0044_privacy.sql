-- Personal data (Singapore's PDPA): each person's agreement to the privacy notice, and when.
--
--  * users.privacy_accepted_at / privacy_version: when they agreed, and to which
--    version of the notice (/privacy). Only the person records it.
--  * account_requests.privacy_accepted_at: agreed when asking for access; carried
--    to the account when it's approved.
--
-- Re-runnable.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "privacy_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "privacy_version" text;--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "privacy_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "privacy_version" text;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_users_privacy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN NEW;
  END IF;
  -- The person themself, or the approval carrying over what they agreed to when they asked for access.
  IF (NEW.privacy_accepted_at, NEW.privacy_version) IS DISTINCT FROM (OLD.privacy_accepted_at, OLD.privacy_version)
     AND app_actor_uid() IS DISTINCT FROM OLD.uid
     AND NOT EXISTS (
       SELECT 1 FROM account_requests r
       WHERE r.granted_uid = OLD.uid
         AND r.privacy_accepted_at = NEW.privacy_accepted_at
         AND r.privacy_version IS NOT DISTINCT FROM NEW.privacy_version
     ) THEN
    RAISE EXCEPTION 'Only the person agrees to the privacy notice.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_users_privacy ON users;--> statement-breakpoint
CREATE TRIGGER guard_users_privacy BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_users_privacy();
