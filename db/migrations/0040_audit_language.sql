-- The audit log leaves out a person switching the app's language (English / 中文):
-- it's a preference, not a change to anyone's record. Everything else on an
-- account is recorded as before. (The Audit page also hides earlier
-- language-only entries; see api/_routes/audit.py.)
--
-- Re-runnable.

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
  v_restores    bigint;
  v_reason      text;
  v_operation   uuid;
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
  BEGIN
    v_restores := NULLIF(current_setting('app.restores_audit_id', true), '')::bigint;
  EXCEPTION WHEN others THEN
    v_restores := NULL;
  END;
  BEGIN
    v_operation := NULLIF(current_setting('app.audit_operation', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_operation := NULL;
  END;
  v_reason := NULLIF(btrim(current_setting('app.audit_reason', true)), '');

  IF (v_reverts IS NOT NULL OR v_restores IS NOT NULL) AND (v_reason IS NULL OR length(v_reason) < 10) THEN
    RAISE EXCEPTION 'A revert or restore needs a reason of at least 10 characters.'
      USING ERRCODE = 'P0001';
  END IF;

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

  -- Not worth recording (0040): a person switching the app's language.
  IF TG_TABLE_NAME = 'users' THEN
    v_changes := v_changes - 'language';
    IF TG_OP = 'UPDATE' AND (v_changes - 'updated_at') = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;

  v_entity_id := v_row ->> TG_ARGV[0];
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_entity_key := v_entity_key || jsonb_build_object(TG_ARGV[i], v_row -> TG_ARGV[i]);
  END LOOP;

  v_project_id := CASE WHEN v_row ? 'project_id' THEN (v_row ->> 'project_id')::integer END;

  INSERT INTO audit_log (
    actor_uid, actor_email, actor_name, actor_role, actor_clerk_id,
    action, entity_table, entity_id, entity_key, project_id, changes,
    reverts_audit_id, restores_audit_id, reason, operation_id
  ) VALUES (
    v_actor_uid, v_email, v_name, v_role, v_clerk,
    v_action, TG_TABLE_NAME, v_entity_id, v_entity_key, v_project_id, v_changes,
    v_reverts, v_restores, v_reason, v_operation
  );

  RETURN NULL;
END $$;
