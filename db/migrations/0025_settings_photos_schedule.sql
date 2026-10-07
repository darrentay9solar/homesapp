-- Settings, profile pictures, scheduled disable/enable, files by type.
--
--  * users.language / notification_prefs: the person's own settings.
--  * users.avatar_*: their own picture; a project manager can change anyone's.
--  * users.disable_on / enable_on / disabled_reason: set only by a project
--    manager. apply_account_schedule() disables accounts on their expiry date
--    and enables ones whose enable date has come; it runs on each sign-in
--    check, when People opens, and with the 15-minute scheduled job.
--  * project_files.kind: image or document, the folder a file is stored in.
-- Re-runnable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamp with time zone;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_by integer REFERENCES users(uid) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS language varchar(5) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS disable_on date;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS enable_on date;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason varchar(12);--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_language') THEN
    ALTER TABLE users ADD CONSTRAINT users_language CHECK (language IN ('en', 'zh'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_disabled_reason') THEN
    ALTER TABLE users ADD CONSTRAINT users_disabled_reason CHECK (disabled_reason IS NULL OR disabled_reason IN ('manual', 'scheduled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_schedule_order') THEN
    -- An enable date after the expiry would switch the account on for nothing.
    ALTER TABLE users ADD CONSTRAINT users_schedule_order CHECK (enable_on IS NULL OR disable_on IS NULL OR enable_on < disable_on);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE project_files ADD COLUMN IF NOT EXISTS kind varchar(10) DEFAULT 'document' NOT NULL;--> statement-breakpoint
UPDATE project_files SET kind = CASE WHEN content_type LIKE 'image/%' THEN 'image' ELSE 'document' END
 WHERE kind IS DISTINCT FROM CASE WHEN content_type LIKE 'image/%' THEN 'image' ELSE 'document' END;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_files_kind') THEN
    ALTER TABLE project_files ADD CONSTRAINT project_files_kind CHECK (kind IN ('image', 'document'));
  END IF;
END $$;
--> statement-breakpoint

-- ------------------------------------------------------------------ users

-- As 0022, plus: the dates that disable or enable an account are a project
-- manager's to set, not the person's own. (Their picture, language and
-- notification settings are theirs.)
CREATE OR REPLACE FUNCTION guard_users_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
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
--> statement-breakpoint

-- Disables accounts whose expiry date has come, and enables disabled ones
-- whose enable date has, in Singapore time. Never disables the last active
-- project manager. Returns how many accounts changed. SECURITY DEFINER so it
-- can run on anyone's sign-in; with no actor set, the audit log records the
-- change as the system's.
CREATE OR REPLACE FUNCTION apply_account_schedule() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_n integer := 0;
  v_k integer;
  r record;
BEGIN
  PERFORM set_config('app.actor_uid', '', true);
  UPDATE users SET active = true, disabled_reason = NULL, enable_on = NULL, updated_at = now()
   WHERE NOT active AND enable_on IS NOT NULL AND enable_on <= v_today
     AND (disable_on IS NULL OR disable_on > v_today);
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;
  FOR r IN SELECT uid, user_type FROM users WHERE active AND disable_on IS NOT NULL AND disable_on <= v_today ORDER BY uid LOOP
    IF r.user_type = 'project_manager' AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.uid <> r.uid AND u.user_type = 'project_manager' AND u.active) THEN
      CONTINUE;
    END IF;
    UPDATE users SET active = false, disabled_reason = 'scheduled', updated_at = now() WHERE uid = r.uid;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
