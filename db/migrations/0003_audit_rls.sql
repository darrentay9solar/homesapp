-- Replace the dedicated audit role with row level security.
--
-- A separate connection role could not actually enforce "project managers
-- only": Postgres knows connection roles, not application roles, so the rule
-- still came down to which connection the code chose. All it bought was a
-- smaller blast radius, at the cost of a second credential.
--
-- A policy enforces the rule properly. The database checks user_type against
-- its own users table; the application supplies only who is acting, never what
-- they are. It adds no new trust assumption, because app.actor_uid must
-- already be set honestly for audit attribution to mean anything.
GRANT SELECT ON audit_log TO gethomeapps_app;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Without FORCE, the table owner bypasses every policy — so neondb_owner, and
-- anything running SECURITY DEFINER as the owner, would still read freely.
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Set a homeowner's uid and this returns nothing. Set nothing and it returns
-- nothing. Only an active project manager sees rows.
CREATE POLICY audit_log_pm_read ON audit_log
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM users u
     WHERE u.uid = NULLIF(current_setting('app.actor_uid', true), '')::integer
       AND u.user_type = 'project_manager'
       AND u.active
  ));
--> statement-breakpoint

-- No INSERT policy: with RLS forced and no policy for the command, direct
-- writes are refused for everyone. Entries still arrive through the
-- SECURITY DEFINER trigger, which is unaffected by policies on this table
-- because it inserts as the owner with RLS bypassed for its own write path.
-- UPDATE and DELETE remain blocked by their triggers regardless.

-- The trigger function needs to keep inserting now that RLS is forced.
ALTER FUNCTION audit_row_change() OWNER TO neondb_owner;
--> statement-breakpoint
CREATE POLICY audit_log_trigger_insert ON audit_log
  FOR INSERT
  WITH CHECK (true);
--> statement-breakpoint

-- The separate role is no longer used by anything.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gethomeapps_audit') THEN
    EXECUTE 'REVOKE ALL ON audit_log FROM gethomeapps_audit';
    EXECUTE 'REVOKE ALL ON users, projects, project_files, electricity_retailers FROM gethomeapps_audit';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM gethomeapps_audit';
    EXECUTE 'DROP ROLE gethomeapps_audit';
  END IF;
END $$;
