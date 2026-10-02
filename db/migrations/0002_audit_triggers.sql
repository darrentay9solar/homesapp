-- Audit log: capture, access control, and immutability.
--
-- The guarantees here live in Postgres rather than in application code, so a
-- forgotten check or a direct SQL session cannot bypass them.

-- ---------------------------------------------------------------- capture

-- Columns never copied into the log. The fact of the change is recorded; the
-- value is not. ic_last4 is personal data under the PDPA and the audit table
-- is the one place nothing can ever be deleted from.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_redacted_columns() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['ic_last4']::text[] $$;

-- SECURITY DEFINER so it runs as the table owner. That is what lets the
-- application role write audit entries without being granted INSERT on
-- audit_log directly — it can neither forge an entry nor suppress one.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_uid   integer;
  v_email       varchar(320);
  v_name        text;
  v_role        user_type;
  v_clerk       text;
  v_action      audit_action;
  v_old         jsonb;
  v_new         jsonb;
  v_changes     jsonb := '{}'::jsonb;
  v_key         text;
  v_redacted    text[] := audit_redacted_columns();
  v_entity_id   text;
BEGIN
  -- Set per request from the verified Clerk session. Absent means something
  -- wrote outside the app — a console session, a script — which is logged as
  -- an unattributed change rather than not logged at all.
  BEGIN
    v_actor_uid := NULLIF(current_setting('app.actor_uid', true), '')::integer;
  EXCEPTION WHEN others THEN
    v_actor_uid := NULL;
  END;

  IF v_actor_uid IS NOT NULL THEN
    SELECT u.email, u.full_name, u.user_type, u.clerk_user_id
      INTO v_email, v_name, v_role, v_clerk
      FROM users u WHERE u.uid = v_actor_uid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new := to_jsonb(NEW);
    v_old := '{}'::jsonb;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
  ELSE
    v_action := 'delete';
    v_new := '{}'::jsonb;
    v_old := to_jsonb(OLD);
  END IF;

  -- Record only what actually differs, so an UPDATE touching one field does
  -- not produce a diff of all thirty-four.
  FOR v_key IN SELECT k FROM jsonb_object_keys(v_old || v_new) AS k LOOP
    IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
      IF v_key = ANY(v_redacted) THEN
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', '<redacted>', 'to', '<redacted>'));
      ELSE
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
      END IF;
    END IF;
  END LOOP;

  -- Nothing changed (an UPDATE that set every column to its existing value).
  IF TG_OP = 'UPDATE' AND v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  -- TG_ARGV[0] names the primary key column, which differs per table.
  v_entity_id := COALESCE(v_new ->> TG_ARGV[0], v_old ->> TG_ARGV[0]);

  INSERT INTO audit_log (
    actor_uid, actor_email, actor_name, actor_role, actor_clerk_id,
    action, entity_table, entity_id, changes
  ) VALUES (
    v_actor_uid, v_email, v_name, v_role, v_clerk,
    v_action, TG_TABLE_NAME, v_entity_id, v_changes
  );

  RETURN NULL; -- AFTER trigger; return value is ignored
END $$;

-- ------------------------------------------------------------- immutability

-- Blocks UPDATE and DELETE on audit_log for everyone, including the owner and
-- anything with SECURITY DEFINER. Revoking privileges alone would still leave
-- the table owner able to rewrite history.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING HINT = 'Audit entries cannot be changed or removed once written.';
END $$;

--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- ---------------------------------------------------------------- triggers

--> statement-breakpoint
CREATE TRIGGER audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('uid');

--> statement-breakpoint
CREATE TRIGGER audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('project_id');

--> statement-breakpoint
CREATE TRIGGER audit_project_files
  AFTER INSERT OR UPDATE OR DELETE ON project_files
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('file_id');

--> statement-breakpoint
CREATE TRIGGER audit_electricity_retailers
  AFTER INSERT OR UPDATE OR DELETE ON electricity_retailers
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('retailer_id');

-- ------------------------------------------------------------------ access

-- A login-less role created here so the migration carries no password. The
-- credential is set separately by `npm run db:audit-role`.
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_audit') THEN
    CREATE ROLE gethomeapps_audit NOLOGIN;
  END IF;
END $$;

-- The application role gets nothing at all on this table: it cannot read
-- entries, and it cannot write them except through the triggers above.
--> statement-breakpoint
REVOKE ALL ON audit_log FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_app') THEN
    EXECUTE 'REVOKE ALL ON audit_log FROM gethomeapps_app';
    EXECUTE 'REVOKE ALL ON SEQUENCE audit_log_audit_id_seq FROM gethomeapps_app';
  END IF;
END $$;

-- Read-only, and only this role. Deliberately no UPDATE or DELETE.
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gethomeapps_audit;
--> statement-breakpoint
GRANT SELECT ON audit_log TO gethomeapps_audit;

-- The audit view needs to resolve actor names and project titles.
--> statement-breakpoint
GRANT SELECT ON users, projects, project_files, electricity_retailers TO gethomeapps_audit;
