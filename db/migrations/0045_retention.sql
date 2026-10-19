-- Personal data (PDPA): non-essential data is kept for one year, then deleted.
--
-- purge_old_data() deletes, once a day (the 15-minute job calls it; it skips a
-- run within 20 hours of the last), anything non-essential that's more than a
-- year old:
--
--   notifications (and their delivery records)     a year after they were sent
--   verification codes                             a year after they were made
--   phones and browsers for notifications          a year after last reached
--   access and role requests, decided              a year after the decision
--   busy times and meetings                        a year after they ended
--   support conversations, settled                 a year after they were settled
--   records of reminders and warnings sent         a year after they went
--   abandoned upload records                       a year after they were made
--
-- Essential, and kept: projects, systems, contracts, invoices, payments and
-- bank statements, signatures and certificates, files, site visits and
-- check-ins, accounts, exports and the audit log (docs/pdpa.md).
--
-- Deleting an audited row would copy it into the audit log, keeping what is
-- being deleted. So the purge writes its transaction into retention_runs,
-- which only the database owner can write, and the audit trigger skips the
-- changes of a transaction found there. The run itself, with its counts, is
-- the record. The app's login may call the function, not change what it does:
-- the year is fixed here.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "retention_runs" (
  "txid" bigint PRIMARY KEY,
  "ran_at" timestamp with time zone NOT NULL DEFAULT now(),
  "counts" jsonb
);--> statement-breakpoint
REVOKE ALL ON "retention_runs" FROM PUBLIC;--> statement-breakpoint
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_app') THEN
    EXECUTE 'REVOKE ALL ON retention_runs FROM gethomeapps_app';
  END IF;
END $do$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_old_data() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cutoff timestamptz := now() - interval '1 year';
  tally jsonb := '{}'::jsonb;
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM retention_runs WHERE ran_at > now() - interval '20 hours') THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  INSERT INTO retention_runs (txid) VALUES (txid_current());

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

  UPDATE retention_runs SET counts = tally WHERE txid = txid_current();
  RETURN tally;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_old_data() FROM PUBLIC;--> statement-breakpoint
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION purge_old_data() TO gethomeapps_app';
  END IF;
END $do$;
--> statement-breakpoint

-- The audit trigger leaves the purge's own deletes out (see above): a check
-- added at the top of its body, after the line that is just BEGIN.
DO $do$
DECLARE
  d text;
  pos integer;
BEGIN
  d := pg_get_functiondef('audit_row_change'::regproc);
  IF position('retention_runs' IN d) = 0 THEN
    pos := position(E'\nBEGIN' IN d);
    IF pos = 0 THEN
      RAISE EXCEPTION 'audit_row_change has changed shape; update 0045 to match';
    END IF;
    pos := pos + length(E'\nBEGIN');
    d := substr(d, 1, pos - 1)
      || E'\n  -- The yearly clean-up of non-essential data (0045) is recorded as a run, not row by row.'
      || E'\n  IF EXISTS (SELECT 1 FROM retention_runs WHERE txid = txid_current()) THEN'
      || E'\n    RETURN NULL;'
      || E'\n  END IF;'
      || substr(d, pos);
    EXECUTE d;
  END IF;
END $do$;
