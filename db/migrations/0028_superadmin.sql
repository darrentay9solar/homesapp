-- A superadmin, and project managers limited to the projects they run.
--
--  * user_type 'superadmin': unfettered access. Sees and edits every project,
--    manages every page and every account, including project managers'.
--    Superadmin accounts exist only by being put straight into the database
--    (by its owner); the app can never create one, grant the role, or change
--    one (beyond the person's own name, picture and settings).
--  * A project manager runs their own projects (projects.project_manager_id):
--    they see and change only those, and only a superadmin hands a project to
--    another manager. They manage every account except project managers' and
--    superadmins': only a superadmin creates, approves or changes those.
--  * The audit log follows the same lines: a superadmin reads all of it; a
--    project manager reads what happened on their projects, the people and
--    group changes other than other managers' accounts, and anything they did.
--  * Location sharing is gone (0026's users.share_location and
--    user_locations): a person's whereabouts come only from their check-ins.
--
-- Comparisons use user_type::text so the new value needn't be committed before
-- these functions are created. Re-runnable.

ALTER TYPE "public"."user_type" ADD VALUE IF NOT EXISTS 'superadmin';--> statement-breakpoint

-- ------------------------------------------------------------ location sharing

DROP TRIGGER IF EXISTS forget_location ON users;--> statement-breakpoint
DROP FUNCTION IF EXISTS forget_location();--> statement-breakpoint
DROP TABLE IF EXISTS user_locations;--> statement-breakpoint
DROP FUNCTION IF EXISTS guard_user_locations();--> statement-breakpoint
ALTER TABLE users DROP COLUMN IF EXISTS share_location;--> statement-breakpoint
ALTER TABLE users DROP COLUMN IF EXISTS share_location_changed_at;--> statement-breakpoint

-- ------------------------------------------------------------------ who's who

-- The acting person's role, if their account is active. SECURITY DEFINER so
-- the answer doesn't depend on what the caller may read.
CREATE OR REPLACE FUNCTION app_actor_type() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_type::text FROM users u WHERE u.uid = app_actor_uid() AND u.active
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_actor_is_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_actor_type() = 'superadmin', false)
$$;
--> statement-breakpoint

-- "Is a project manager or above": every guard that let a project manager
-- through now lets a superadmin through too.
CREATE OR REPLACE FUNCTION app_actor_is_pm() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_actor_type() IN ('project_manager', 'superadmin'), false)
$$;
--> statement-breakpoint

-- Runs this project: a superadmin always; a project manager when it's theirs.
CREATE OR REPLACE FUNCTION app_actor_runs_project(p_project integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE app_actor_type()
    WHEN 'superadmin' THEN true
    WHEN 'project_manager' THEN EXISTS (
      SELECT 1 FROM projects p WHERE p.project_id = p_project AND p.project_manager_id = app_actor_uid())
    ELSE false
  END
$$;
--> statement-breakpoint

-- An audit entry about another project manager's or a superadmin's account,
-- which only a superadmin may read.
CREATE OR REPLACE FUNCTION app_audit_about_admin(p_table text, p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_table = 'users' AND p_id ~ '^[0-9]+$' AND EXISTS (
    SELECT 1 FROM users u
     WHERE u.uid = p_id::integer AND u.user_type::text IN ('project_manager', 'superadmin')
       AND u.uid IS DISTINCT FROM app_actor_uid())
$$;
--> statement-breakpoint

-- ------------------------------------------------------------------ audit log

DROP POLICY IF EXISTS audit_log_pm_read ON audit_log;--> statement-breakpoint
DROP POLICY IF EXISTS audit_log_admin_read ON audit_log;--> statement-breakpoint
CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT
  USING (
    app_actor_is_superadmin()
    OR (app_actor_type() = 'project_manager' AND (
         actor_uid = app_actor_uid()
         OR (project_id IS NOT NULL AND app_actor_runs_project(project_id))
         OR (project_id IS NULL AND NOT app_audit_about_admin(entity_table, entity_id))
    ))
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_projects_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_details_changed boolean;
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- A project manager: their own projects, and new ones are theirs.
  IF app_actor_type() = 'project_manager' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.project_manager_id IS DISTINCT FROM app_actor_uid() THEN
        RAISE EXCEPTION 'A project manager''s new project is run by them.' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.project_manager_id IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'This project is run by another project manager.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.project_manager_id IS DISTINCT FROM OLD.project_manager_id THEN
      RAISE EXCEPTION 'Only a superadmin can hand a project to another project manager.' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Only a project manager can create or delete a project.' USING ERRCODE = '42501';
  END IF;

  v_details_changed :=
     (NEW.name, NEW.address, NEW.postal_code, NEW.site_lat, NEW.site_lng, NEW.check_in_radius_m,
      NEW.homeowner_id, NEW.homeowner_name, NEW.homeowner_contact_no,
      NEW.contractor_group_id, NEW.contractor_text, NEW.project_manager_id, NEW.created_by,
      NEW.installation_start_date, NEW.target_end_date)
     IS DISTINCT FROM
     (OLD.name, OLD.address, OLD.postal_code, OLD.site_lat, OLD.site_lng, OLD.check_in_radius_m,
      OLD.homeowner_id, OLD.homeowner_name, OLD.homeowner_contact_no,
      OLD.contractor_group_id, OLD.contractor_text, OLD.project_manager_id, OLD.created_by,
      OLD.installation_start_date, OLD.target_end_date);
  IF v_details_changed THEN
    RAISE EXCEPTION 'Only a project manager can change a project''s details or dates.' USING ERRCODE = '42501';
  END IF;

  -- The homeowner: their decision on their own project, and nothing else.
  IF OLD.homeowner_id IS NOT NULL AND OLD.homeowner_id = app_actor_uid() THEN
    IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RAISE EXCEPTION 'A homeowner can approve or decline their project, but not change it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         OLD.status IN ('awaiting_homeowner', 'homeowner_declined')
         AND NEW.status IN ('homeowner_approved', 'homeowner_declined')) THEN
      RAISE EXCEPTION 'The project isn''t waiting for your approval.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- The crew: milestone fields on their own projects. The one status change
  -- they cause is the first piece of work starting an approved project.
  IF app_actor_on_crew(OLD.project_id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'pm_approved' AND NEW.status = 'in_progress') THEN
      RAISE EXCEPTION 'Only a project manager can change the project''s status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_project_people() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.homeowner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.homeowner_id AND user_type = 'homeowner'
  ) THEN
    RAISE EXCEPTION 'The homeowner must be a homeowner account.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.project_manager_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.project_manager_id AND user_type::text IN ('project_manager', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'The project must be run by a project manager.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assignments_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (app_is_table_owner(TG_RELID) OR app_actor_runs_project(COALESCE(NEW.project_id, OLD.project_id))) THEN
    RAISE EXCEPTION 'Only a project manager can assign people to a project.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.user_id AND user_type IN ('contractor', 'epc_team')
  ) THEN
    RAISE EXCEPTION 'Only contractor admins and EPC team members can be assigned to a project.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_milestones_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_runs_project(COALESCE(NEW.project_id, OLD.project_id)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND app_actor_on_crew(NEW.project_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only a project manager can reopen a milestone.' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_files_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_runs_project(COALESCE(NEW.project_id, OLD.project_id)) OR app_actor_on_crew(COALESCE(NEW.project_id, OLD.project_id)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only the project''s crew or a project manager can add or remove its files.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_homeowner_ic(p_project integer, p_ic text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_homeowner integer;
BEGIN
  IF NOT (app_actor_runs_project(p_project) OR app_actor_on_crew(p_project)) THEN
    RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
  END IF;
  SELECT homeowner_id INTO v_homeowner FROM projects WHERE project_id = p_project;
  IF v_homeowner IS NULL THEN
    RAISE EXCEPTION 'Link the homeowner''s account first.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE users SET ic_last4 = NULLIF(upper(btrim(p_ic)), ''), updated_at = now() WHERE uid = v_homeowner;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_check_ins_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
  v_status project_status;
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Check-ins are site evidence and can''t be deleted.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id
       OR NOT EXISTS (SELECT 1 FROM users WHERE uid = v_actor AND user_type = 'epc_team' AND active)
       OR NOT app_actor_on_crew(NEW.project_id) THEN
      RAISE EXCEPTION 'Only the EPC crew on this project can check in, and only as themselves.' USING ERRCODE = '42501';
    END IF;
    SELECT status INTO v_status FROM projects WHERE project_id = NEW.project_id;
    IF v_status NOT IN ('pm_approved', 'in_progress') THEN
      RAISE EXCEPTION 'Check-in opens once the project is approved, and closes at handover.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the person checks themselves out; a PM may correct crew counts.
  IF v_actor IS NOT NULL AND v_actor = OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF app_actor_runs_project(OLD.project_id) THEN
    IF NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at THEN
      RAISE EXCEPTION 'Only the crew member who checked in can check out.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only the crew member who checked in can check out.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_visits_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pid integer := COALESCE(NEW.project_id, OLD.project_id);
  v_status project_status;
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT (app_actor_runs_project(v_pid) OR app_actor_on_crew(v_pid)) THEN
    RAISE EXCEPTION 'Only a project manager or the project''s crew can schedule site visits.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM projects WHERE project_id = v_pid;
  IF v_status NOT IN ('pm_approved', 'in_progress') THEN
    RAISE EXCEPTION 'Site visits can be scheduled once the project is approved, and until handover.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM site_check_ins c
     WHERE c.visit_id = OLD.visit_id
        OR (c.project_id = OLD.project_id AND (c.checked_in_at AT TIME ZONE 'Asia/Singapore')::date = OLD.scheduled_date)
  ) THEN
    RAISE EXCEPTION 'The crew has checked in for this visit, so it stays as a record.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_account_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.requested_type::text = 'superadmin' THEN
    RAISE EXCEPTION 'Superadmin accounts are added directly in the database.' USING ERRCODE = '42501';
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
  IF TG_OP IN ('INSERT', 'UPDATE') AND (NEW.requested_type::text = 'superadmin' OR NEW.from_type::text = 'superadmin') THEN
    RAISE EXCEPTION 'Superadmin accounts are managed directly in the database.' USING ERRCODE = '42501';
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
    IF 'project_manager' IN (NEW.requested_type::text, NEW.from_type::text) AND NOT app_actor_is_superadmin() THEN
      RAISE EXCEPTION 'Only a superadmin can decide a request to become, or stop being, a project manager.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only a project manager can decide a role request.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
-- ------------------------------------------------------------------ users

-- As 0027 (sample people; who changes what), with superadmins and project
-- managers' accounts protected, and location sharing gone.
CREATE OR REPLACE FUNCTION guard_users_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor integer := app_actor_uid();
  v_type text := app_actor_type();
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.is_demo) OR (TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'Only the database owner marks sample people for the demo.'
      USING ERRCODE = '42501';
  END IF;

  -- Superadmin accounts live in the database alone. The person may change
  -- their own name, picture and settings; nothing else, and nobody else.
  IF (TG_OP <> 'INSERT' AND OLD.user_type::text = 'superadmin')
     OR (TG_OP <> 'DELETE' AND NEW.user_type::text = 'superadmin') THEN
    IF NOT (TG_OP = 'UPDATE' AND v_actor = OLD.uid AND v_type = 'superadmin') THEN
      RAISE EXCEPTION 'Superadmin accounts are managed directly in the database.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_type = 'superadmin' THEN
    RETURN COALESCE(NEW, OLD);
  ELSIF v_type = 'project_manager' THEN
    -- Every account except project managers'; their own only as themselves.
    IF (TG_OP <> 'INSERT' AND OLD.user_type::text = 'project_manager')
       OR (TG_OP <> 'DELETE' AND NEW.user_type::text = 'project_manager') THEN
      IF NOT (TG_OP = 'UPDATE' AND v_actor = OLD.uid) THEN
        RAISE EXCEPTION 'Only a superadmin can create or change project manager accounts.'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RETURN COALESCE(NEW, OLD);
    END IF;
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
  FOR r IN SELECT uid, user_type FROM users WHERE active AND disable_on IS NOT NULL AND disable_on <= v_today AND user_type::text <> 'superadmin' ORDER BY uid LOOP
    IF r.user_type = 'project_manager' AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.uid <> r.uid AND u.user_type = 'project_manager' AND u.active) THEN
      CONTINUE;
    END IF;
    UPDATE users SET active = false, disabled_reason = 'scheduled', updated_at = now() WHERE uid = r.uid;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
