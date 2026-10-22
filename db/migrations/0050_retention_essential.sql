-- Personal data (PDPA): when essential records go, and the audit log's entries about deleted records
-- (9 Solar Home's decisions, 22 Oct 2026; docs/pdpa.md).
--
--   Essential records: 5 years after the contract ends. A system's contract runs from the month
--   it was turned on for its plan's years, at least the 8-year plan (longer if its PPA or
--   maintenance plan is longer), so "8 + 5 years". Gone together: the system, its project, the
--   project's milestones, visits, check-ins, signatures and files, the invoices of both, its
--   output and billing records, checks and feedback. A project that never became a system goes
--   13 years after it was last changed. The homeowner's account, once nothing of theirs is left,
--   keeps no personal details ("Former customer").
--   Staff uploads with no project (unassigned_files) are kept.
--
--   The audit log: an entry about a record that no longer exists goes once it is 13 years old
--   (whichever comes later: the record's deletion, or 13 years).
--
-- purge_old_data() (0045) does all of this in one run, once a day; the files' storage keys are
-- returned so the job removes them from storage too (api/_lib/retention.py). The audit log's
-- append-only guard lets only that run delete, the same way the audit trigger leaves it out.
--
-- Re-runnable.

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The daily retention run (purge_old_data, recorded in retention_runs, which only the
  -- database owner can write) removes entries about records deleted 13+ years ago.
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM retention_runs WHERE txid = txid_current()) THEN
    RETURN CASE WHEN TG_LEVEL = 'ROW' THEN OLD ELSE NULL END;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING HINT = 'Audit entries cannot be changed or removed once written.';
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_old_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cutoff timestamptz := now() - interval '1 year';
  cut13 timestamptz := now() - interval '13 years';
  tally jsonb := '{}'::jsonb;
  n integer;
  sys_ids integer[];
  proj_ids integer[];
  owners integer[];
  keys text[];
  tbl text;
  total integer;
BEGIN
  IF EXISTS (SELECT 1 FROM retention_runs WHERE ran_at > now() - interval '20 hours') THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  INSERT INTO retention_runs (txid) VALUES (txid_current());

  -- Non-essential: a year after they stop being needed (0045).
  DELETE FROM notifications WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('notifications', n);
  DELETE FROM notification_deliveries WHERE coalesce(sent_at, failed_at, queued_at) < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('notification_deliveries', n);
  DELETE FROM verification_codes WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('verification_codes', n);
  DELETE FROM push_subscriptions WHERE coalesce(last_success_at, created_at) < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('push_subscriptions', n);
  DELETE FROM account_requests WHERE status <> 'pending' AND coalesce(decided_at, created_at) < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('account_requests', n);
  DELETE FROM role_change_requests WHERE status <> 'pending' AND coalesce(decided_at, created_at) < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('role_change_requests', n);
  DELETE FROM calendar_blocks WHERE ends_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('calendar_blocks', n);
  DELETE FROM meetings WHERE ends_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('meetings', n);
  DELETE FROM support_threads WHERE status = 'settled' AND coalesce(settled_at, updated_at) < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('support_threads', n);
  DELETE FROM visit_reminders WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('visit_reminders', n);
  DELETE FROM maintenance_reminders WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('maintenance_reminders', n);
  DELETE FROM meeting_reminders WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('meeting_reminders', n);
  DELETE FROM watch_alerts WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('watch_alerts', n);
  DELETE FROM upload_intents WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('upload_intents', n);

  -- Essential: 5 years after the contract ends (at least the 8-year plan from turn-on).
  SELECT coalesce(array_agg(s.system_id), '{}') INTO sys_ids
    FROM maintenance_systems s
   WHERE (coalesce(s.turned_on_on, s.signed_on, s.created_at::date)
          + make_interval(years => greatest(8, coalesce(s.plan_years, 0), coalesce(s.ppa_years, 0)) + 5)) < now();
  SELECT coalesce(array_agg(DISTINCT p.project_id), '{}') INTO proj_ids
    FROM projects p
   WHERE p.project_id IN (SELECT s.project_id FROM maintenance_systems s WHERE s.system_id = ANY (sys_ids))
      OR (NOT EXISTS (SELECT 1 FROM maintenance_systems s WHERE s.project_id = p.project_id)
          AND coalesce(p.closed_at, p.updated_at, p.created_at) < cut13);
  SELECT coalesce(array_agg(DISTINCT x.uid), '{}') INTO owners FROM (
    SELECT homeowner_id AS uid FROM maintenance_systems WHERE system_id = ANY (sys_ids) AND homeowner_id IS NOT NULL
    UNION SELECT homeowner_id FROM projects WHERE project_id = ANY (proj_ids) AND homeowner_id IS NOT NULL) x;

  -- Their files, so the job also removes them from storage.
  SELECT coalesce(array_agg(k), '{}') INTO keys FROM (
    SELECT url AS k FROM project_files WHERE project_id = ANY (proj_ids)
    UNION SELECT signature_url FROM project_signatures WHERE project_id = ANY (proj_ids)
    UNION SELECT certificate_url FROM project_signatures WHERE project_id = ANY (proj_ids)
    UNION SELECT proof_key FROM invoices WHERE project_id = ANY (proj_ids) OR system_id = ANY (sys_ids)
  ) f WHERE k IS NOT NULL AND k <> '';

  DELETE FROM invoices WHERE project_id = ANY (proj_ids) OR system_id = ANY (sys_ids);
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('invoices', n);
  DELETE FROM maintenance_systems WHERE system_id = ANY (sys_ids);
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('systems', n);
  DELETE FROM projects WHERE project_id = ANY (proj_ids);
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('projects', n);

  -- A homeowner with nothing left keeps no personal details.
  UPDATE users u
     SET full_name = 'Former customer', email = 'removed-' || u.uid || '@invalid.example', contact_no = NULL,
         address = NULL, postal_code = NULL, ic_last4 = NULL, avatar_key = NULL, active = false,
         clerk_user_id = NULL
   WHERE u.uid = ANY (owners) AND u.user_type = 'homeowner'
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.homeowner_id = u.uid)
     AND NOT EXISTS (SELECT 1 FROM maintenance_systems s WHERE s.homeowner_id = u.uid);
  GET DIAGNOSTICS n = ROW_COUNT; tally := tally || jsonb_build_object('former_customers', n);

  -- The audit log: entries about records that no longer exist, once 13 years old.
  total := 0;
  FOR tbl IN SELECT DISTINCT entity_table FROM audit_log WHERE occurred_at < cut13 LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      DELETE FROM audit_log a WHERE a.occurred_at < cut13 AND a.entity_table = tbl;
    ELSE
      EXECUTE format(
        'DELETE FROM audit_log a WHERE a.occurred_at < $1 AND a.entity_table = $2 '
        'AND NOT EXISTS (SELECT 1 FROM public.%I t WHERE to_jsonb(t) @> a.entity_key)', tbl)
      USING cut13, tbl;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  tally := tally || jsonb_build_object('audit_entries', total);

  UPDATE retention_runs SET counts = tally WHERE txid = txid_current();
  RETURN tally || jsonb_build_object('files', to_jsonb(keys));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_old_data() FROM PUBLIC;--> statement-breakpoint
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION purge_old_data() TO gethomeapps_app';
  END IF;
END $do$;
