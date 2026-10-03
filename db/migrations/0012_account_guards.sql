-- Who may create, change and approve accounts — enforced in Postgres.
--
-- The admin pages check the same rules first so people get a civil message.
-- These triggers are what make them true: a bug in a route handler, a
-- forgotten check, or a hand-written query on the app connection still
-- cannot create an account or turn someone into a project manager.
--
-- The owner connection (migrations, seed scripts) is exempt. That is how the
-- very first project manager gets created, and the app never holds it.

CREATE OR REPLACE FUNCTION app_actor_uid() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_uid', true), '')::integer
$$;
--> statement-breakpoint

-- SECURITY DEFINER so the answer does not depend on what the caller may read:
-- if users gains row level security later, this must still see the actor.
CREATE OR REPLACE FUNCTION app_actor_is_pm() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
     WHERE u.uid = app_actor_uid()
       AND u.user_type = 'project_manager'
       AND u.active
  )
$$;
--> statement-breakpoint

-- True for the role that owns the table (and its members) — i.e. migrations
-- and maintenance scripts, never the application role.
CREATE OR REPLACE FUNCTION app_is_table_owner(p_table regclass) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, c.relowner, 'MEMBER')
    FROM pg_class c WHERE c.oid = p_table
$$;
--> statement-breakpoint

-- ------------------------------------------------------------------ users

CREATE OR REPLACE FUNCTION guard_users_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF app_actor_is_pm() THEN
    -- Never let the last active project manager disappear: with nobody left
    -- to approve requests, the only way back in is the owner connection.
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

  -- Everyone else may edit only their own profile, and never the fields that
  -- decide what they can do.
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

  -- Accepting an invitation links the Clerk login once. After that the link
  -- is fixed: re-pointing it would hand this account to another login.
  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id AND OLD.clerk_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This account is already linked to a login.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER guard_users_write
  BEFORE INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_users_write();
--> statement-breakpoint

-- ------------------------------------------------------- account requests

CREATE OR REPLACE FUNCTION guard_account_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The requester has no account yet, so there is no actor to check. What
    -- they cannot do is arrive pre-approved.
    NEW.status        := 'pending';
    NEW.created_at    := now();
    NEW.decided_at    := NULL;
    NEW.decided_by    := NULL;
    NEW.decision_note := NULL;
    NEW.granted_uid   := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Account requests are kept as a record. Reject it instead.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT app_actor_is_pm() THEN
    RAISE EXCEPTION 'Only a project manager can decide an account request.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %.', OLD.status
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.clerk_user_id, NEW.email) IS DISTINCT FROM (OLD.clerk_user_id, OLD.email) THEN
    RAISE EXCEPTION 'The login a request belongs to cannot be changed.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'pending' THEN
    RETURN NEW; -- a PM tidying details before deciding
  END IF;

  IF NEW.status = 'approved' AND NOT EXISTS (
       SELECT 1 FROM users u
        WHERE u.uid = NEW.granted_uid AND u.clerk_user_id = NEW.clerk_user_id)
  THEN
    RAISE EXCEPTION 'Approve through approve_account_request(), which creates the account.'
      USING ERRCODE = '42501';
  END IF;

  NEW.decided_at := now();
  NEW.decided_by := app_actor_uid();
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER guard_account_requests
  BEFORE INSERT OR UPDATE OR DELETE ON account_requests
  FOR EACH ROW EXECUTE FUNCTION guard_account_requests();
--> statement-breakpoint

CREATE TRIGGER audit_account_requests
  AFTER INSERT OR UPDATE OR DELETE ON account_requests
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('request_id');
--> statement-breakpoint

-- Creates the account and closes the request in one statement, so there is
-- never an account without its approval or an approval without its account.
-- SECURITY INVOKER on purpose: it runs as the caller, so both triggers above
-- still decide whether the caller is allowed.
CREATE OR REPLACE FUNCTION approve_account_request(
  p_request_id integer,
  p_user_type  user_type,
  p_note       text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r     account_requests%ROWTYPE;
  v_uid integer;
BEGIN
  SELECT * INTO r FROM account_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account request %.', p_request_id;
  END IF;

  INSERT INTO users (clerk_user_id, full_name, user_type, contact_no, ic_last4,
                     email, address, postal_code)
  VALUES (r.clerk_user_id, r.full_name, p_user_type, r.contact_no, r.ic_last4,
          lower(r.email), r.address, r.postal_code)
  RETURNING uid INTO v_uid;

  UPDATE account_requests
     SET status = 'approved', granted_uid = v_uid, decision_note = p_note
   WHERE request_id = p_request_id;

  RETURN v_uid;
END $$;
