-- Audit entries that can be grouped by project and reverted exactly.
--
-- Re-runnable: every statement is idempotent.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "entity_key" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "project_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_project_idx" ON "audit_log" USING btree ("project_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_reverts_idx" ON "audit_log" USING btree ("reverts_audit_id");--> statement-breakpoint

-- Same capture as before, plus three things:
--   entity_key        every column named in the trigger's arguments, so a
--                     composite key (milestones, memberships, assignments)
--                     still identifies one row;
--   project_id        read from the whole row, not the diff;
--   reverts_audit_id  set per transaction by the revert action through
--                     app.reverts_audit_id, so the undo points at what it
--                     undid. Unset means an ordinary change.
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
  v_row         jsonb;
  v_changes     jsonb := '{}'::jsonb;
  v_key         text;
  v_redacted    text[] := audit_redacted_columns();
  v_entity_id   text;
  v_entity_key  jsonb := '{}'::jsonb;
  v_project_id  integer;
  v_reverts     bigint;
  i             integer;
BEGIN
  BEGIN
    v_actor_uid := NULLIF(current_setting('app.actor_uid', true), '')::integer;
  EXCEPTION WHEN others THEN
    v_actor_uid := NULL;
  END;

  BEGIN
    v_reverts := NULLIF(current_setting('app.reverts_audit_id', true), '')::bigint;
  EXCEPTION WHEN others THEN
    v_reverts := NULL;
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

  IF TG_OP = 'UPDATE' AND v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  -- The row as it now stands, or as it last stood if deleted.
  v_row := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;

  v_entity_id := v_row ->> TG_ARGV[0];
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_entity_key := v_entity_key || jsonb_build_object(TG_ARGV[i], v_row -> TG_ARGV[i]);
  END LOOP;

  v_project_id := CASE WHEN v_row ? 'project_id' THEN (v_row ->> 'project_id')::integer END;

  INSERT INTO audit_log (
    actor_uid, actor_email, actor_name, actor_role, actor_clerk_id,
    action, entity_table, entity_id, entity_key, project_id, changes, reverts_audit_id
  ) VALUES (
    v_actor_uid, v_email, v_name, v_role, v_clerk,
    v_action, TG_TABLE_NAME, v_entity_id, v_entity_key, v_project_id, v_changes, v_reverts
  );

  RETURN NULL;
END $$;--> statement-breakpoint

-- Composite keys: name every key column so entity_key identifies one row.
DROP TRIGGER IF EXISTS audit_contractor_group_members ON contractor_group_members;--> statement-breakpoint
CREATE TRIGGER audit_contractor_group_members
  AFTER INSERT OR UPDATE OR DELETE ON contractor_group_members
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('group_id', 'user_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_project_assignments ON project_assignments;--> statement-breakpoint
CREATE TRIGGER audit_project_assignments
  AFTER INSERT OR UPDATE OR DELETE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('project_id', 'user_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_project_milestones ON project_milestones;--> statement-breakpoint
CREATE TRIGGER audit_project_milestones
  AFTER INSERT OR UPDATE OR DELETE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('project_id', 'milestone_no');
