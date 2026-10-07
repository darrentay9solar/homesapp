-- Account settings: people manage their own name, email, mobile and role.
--
--  * Name: editable by its owner directly (already allowed by guard_users_write).
--  * Email: the sign-in address. Changed only after Clerk has verified the new
--    one, through set_own_email(); still never by a plain UPDATE from the app.
--  * Mobile: changed only after a code sent to the new number is confirmed,
--    through set_own_mobile(). A plain self-UPDATE of contact_no is refused.
--  * Password: lives in Clerk; record_password_change() notes when, so the
--    audit log shows it.
--  * Role: asked for in role_change_requests; a project manager decides.
--
-- Every change lands in the audit log through the existing triggers.
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'role_request';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'role_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'role_rejected';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."role_request_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_verified_at timestamp with time zone;--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamp with time zone;--> statement-breakpoint

-- ------------------------------------------------------ verification codes

CREATE TABLE IF NOT EXISTS "verification_codes" (
  "code_id" serial PRIMARY KEY NOT NULL,
  "uid" integer NOT NULL REFERENCES "public"."users"("uid") ON DELETE cascade,
  "purpose" varchar(16) NOT NULL,
  "target" varchar(32) NOT NULL,
  "code_hash" text NOT NULL,
  "channel" varchar(12),
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "verification_codes_purpose" CHECK ("purpose" in ('mobile')),
  CONSTRAINT "verification_codes_channel" CHECK ("channel" in ('whatsapp', 'sms', 'dev'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_codes_uid_idx" ON "verification_codes" ("uid", "created_at");
--> statement-breakpoint

-- A person's codes are their own: created for themselves, tried by
-- themselves, never deleted by the app.
CREATE OR REPLACE FUNCTION guard_verification_codes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Verification codes are not deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.uid IS DISTINCT FROM app_actor_uid() THEN
    RAISE EXCEPTION 'You can only verify your own details.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.uid, NEW.purpose, NEW.target, NEW.code_hash, NEW.expires_at, NEW.created_at)
                          IS DISTINCT FROM
                          (OLD.uid, OLD.purpose, OLD.target, OLD.code_hash, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'A code can only be tried or used, not changed.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_verification_codes ON verification_codes;--> statement-breakpoint
CREATE TRIGGER guard_verification_codes
  BEFORE INSERT OR UPDATE OR DELETE ON verification_codes
  FOR EACH ROW EXECUTE FUNCTION guard_verification_codes();
--> statement-breakpoint

-- ---------------------------------------------------- role change requests

CREATE TABLE IF NOT EXISTS "role_change_requests" (
  "request_id" serial PRIMARY KEY NOT NULL,
  "uid" integer NOT NULL REFERENCES "public"."users"("uid") ON DELETE cascade,
  "from_type" "user_type" NOT NULL,
  "requested_type" "user_type" NOT NULL,
  "reason" text,
  "status" "role_request_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by" integer REFERENCES "public"."users"("uid") ON DELETE set null,
  "decision_note" text,
  CONSTRAINT "role_change_requests_differs" CHECK ("requested_type" <> "from_type")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_change_requests_one_pending"
  ON "role_change_requests" ("uid") WHERE "status" = 'pending';
--> statement-breakpoint

-- The requester asks (for themselves, from the role they actually have) or
-- cancels; only a project manager decides; a decision is final.
CREATE OR REPLACE FUNCTION guard_role_change_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
  v_type user_type;
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Role requests are kept as a record.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT user_type INTO v_type FROM users WHERE uid = NEW.uid AND active;
    IF NEW.uid IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'You can only ask to change your own role.' USING ERRCODE = '42501';
    END IF;
    IF v_type IS NULL OR NEW.from_type <> v_type OR NEW.status <> 'pending'
       OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL THEN
      RAISE EXCEPTION 'A new request starts as pending, from your current role.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.request_id, NEW.uid, NEW.from_type, NEW.requested_type, NEW.reason, NEW.created_at)
     IS DISTINCT FROM (OLD.request_id, OLD.uid, OLD.from_type, OLD.requested_type, OLD.reason, OLD.created_at) THEN
    RAISE EXCEPTION 'A request can only be decided or cancelled, not edited.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'cancelled' AND v_actor = OLD.uid THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('approved', 'rejected') AND app_actor_is_pm() AND NEW.decided_by = v_actor THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only a project manager can decide a role request.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_role_change_requests ON role_change_requests;--> statement-breakpoint
CREATE TRIGGER guard_role_change_requests
  BEFORE INSERT OR UPDATE OR DELETE ON role_change_requests
  FOR EACH ROW EXECUTE FUNCTION guard_role_change_requests();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_role_change_requests ON role_change_requests;--> statement-breakpoint
CREATE TRIGGER audit_role_change_requests
  AFTER INSERT OR UPDATE OR DELETE ON role_change_requests
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('request_id');
--> statement-breakpoint

-- ------------------------------------------------------------------ users

-- Same rules as before, plus: people can't set their own mobile (or the dates
-- of their verified steps) with a plain UPDATE; those go through the
-- functions below, which the API calls only after the step is verified.
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
      NEW.invited_by, NEW.clerk_invitation_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.uid, OLD.user_type, OLD.email, OLD.active, OLD.invited_at,
      OLD.invited_by, OLD.clerk_invitation_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Role, email and account status can only be changed by a project manager.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.contact_no, NEW.mobile_verified_at, NEW.password_changed_at)
     IS DISTINCT FROM (OLD.contact_no, OLD.mobile_verified_at, OLD.password_changed_at)
  THEN
    RAISE EXCEPTION 'Your mobile number changes only after you confirm the code sent to it.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id AND OLD.clerk_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This account is already linked to a login.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

-- SECURITY DEFINER: runs as the table owner, so the guard above lets it
-- through; the audit trigger still records the acting person (app.actor_uid).
CREATE OR REPLACE FUNCTION set_own_email(p_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_actor_uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET email = lower(btrim(p_email)), updated_at = now() WHERE uid = app_actor_uid() AND active;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_own_mobile(p_contact text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_actor_uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET contact_no = p_contact, mobile_verified_at = now(), updated_at = now()
   WHERE uid = app_actor_uid() AND active;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_password_change() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_actor_uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET password_changed_at = now(), updated_at = now() WHERE uid = app_actor_uid() AND active;
END $$;
