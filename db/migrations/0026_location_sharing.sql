-- Sharing your location with project managers.
--
--  * users.share_location: the person's own choice. Only they can turn it on
--    or off (a project manager can ask, through an alert, but can't switch it
--    on for them). Turning it off deletes their last known location.
--  * user_locations: one row per person, their last known position while
--    sharing, sent by their phone while the app is open. Not audited: it
--    changes every few minutes and isn't anyone's decision; the choice to
--    share is (on users, which is audited).
--  * notification_kind 'location_request': a PM asked someone to share.
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'location_request';--> statement-breakpoint

ALTER TABLE users ADD COLUMN IF NOT EXISTS share_location boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_location_changed_at timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_locations" (
  "uid" integer PRIMARY KEY NOT NULL REFERENCES "public"."users"("uid") ON DELETE cascade,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "accuracy_m" real,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_locations_lat" CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT "user_locations_lng" CHECK (lng BETWEEN -180 AND 180),
  CONSTRAINT "user_locations_accuracy" CHECK (accuracy_m IS NULL OR accuracy_m >= 0)
);
--> statement-breakpoint

-- Only the person themselves writes their location, and only while sharing.
CREATE OR REPLACE FUNCTION guard_user_locations() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(NEW.uid, OLD.uid) IS DISTINCT FROM app_actor_uid() THEN
    RAISE EXCEPTION 'Only the person can share their own location.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE uid = NEW.uid AND share_location AND active) THEN
    RAISE EXCEPTION 'Turn on location sharing first.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_user_locations ON user_locations;--> statement-breakpoint
CREATE TRIGGER guard_user_locations
  BEFORE INSERT OR UPDATE OR DELETE ON user_locations
  FOR EACH ROW EXECUTE FUNCTION guard_user_locations();
--> statement-breakpoint

-- Turning sharing off (or the account being disabled) forgets the last
-- location straight away. SECURITY DEFINER: a PM disabling an account must
-- be able to clear it too.
CREATE OR REPLACE FUNCTION forget_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.share_location AND NOT NEW.share_location) OR (OLD.active AND NOT NEW.active) THEN
    DELETE FROM user_locations WHERE uid = NEW.uid;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS forget_location ON users;--> statement-breakpoint
CREATE TRIGGER forget_location
  AFTER UPDATE OF share_location, active ON users
  FOR EACH ROW EXECUTE FUNCTION forget_location();
--> statement-breakpoint

-- ------------------------------------------------------------------ users

-- As 0025, plus: whether someone shares their location is theirs alone. A
-- project manager can't turn it on (or off) for anyone else.
CREATE OR REPLACE FUNCTION guard_users_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.share_location, NEW.share_location_changed_at) IS DISTINCT FROM (OLD.share_location, OLD.share_location_changed_at)
     AND v_actor IS DISTINCT FROM OLD.uid THEN
    RAISE EXCEPTION 'Only the person can choose to share their location.'
      USING ERRCODE = '42501';
  END IF;

  IF app_actor_is_pm() THEN
    IF OLD.user_type = 'project_manager' AND OLD.active
       AND (TG_OP = 'DELETE' OR NEW.user_type <> 'project_manager' OR NOT NEW.active)
       AND NOT EXISTS (
         SELECT 1 FROM users u
          WHERE u.uid <> OLD.uid AND u.user_type = 'project_manager' AND u.active)
    THEN
      RAISE EXCEPTION 'At least one active project manager must remain.'
        USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Only a project manager can create accounts.'
      USING ERRCODE = '42501',
            DETAIL = format('actor %s is not an active project manager', COALESCE(v_actor::text, 'unset'));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only a project manager can remove accounts.'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor IS DISTINCT FROM OLD.uid THEN
    RAISE EXCEPTION 'You can only change your own profile.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.uid, NEW.user_type, NEW.email, NEW.active, NEW.invited_at,
      NEW.invited_by, NEW.clerk_invitation_id, NEW.created_at,
      NEW.disable_on, NEW.enable_on, NEW.disabled_reason)
     IS DISTINCT FROM
     (OLD.uid, OLD.user_type, OLD.email, OLD.active, OLD.invited_at,
      OLD.invited_by, OLD.clerk_invitation_id, OLD.created_at,
      OLD.disable_on, OLD.enable_on, OLD.disabled_reason)
  THEN
    RAISE EXCEPTION 'Role, email, account status and its dates can only be changed by a project manager.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.contact_no, NEW.mobile_verified_at, NEW.password_changed_at)
     IS DISTINCT FROM (OLD.contact_no, OLD.mobile_verified_at, OLD.password_changed_at)
  THEN
    RAISE EXCEPTION 'Your mobile number changes only after you confirm the code sent to it.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.avatar_updated_by IS DISTINCT FROM OLD.avatar_updated_by AND NEW.avatar_updated_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'A picture change is recorded as yours.' USING ERRCODE = '42501';
  END IF;

  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id AND OLD.clerk_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This account is already linked to a login.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
