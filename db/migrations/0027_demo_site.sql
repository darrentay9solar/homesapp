-- The demonstration site (api/_lib/demo.py).
--
--  * users.is_demo: a sample person a visitor on the demo site can try the app
--    as, without a password. Set only by the database owner, which means only
--    scripts/reset_and_seed.py --target dev; production never has any.
--  * The demo also needs the database's own marker, app.environment = 'demo',
--    which the same script sets on the dev database (ALTER DATABASE ... SET).
-- Re-runnable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ------------------------------------------------------------------ users

-- As 0026, plus: only the database owner (scripts/reset_and_seed.py on the
-- dev database) marks someone as a sample person for the demo site.
CREATE OR REPLACE FUNCTION guard_users_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.is_demo) OR (TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'Only the database owner marks sample people for the demo.'
      USING ERRCODE = '42501';
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
