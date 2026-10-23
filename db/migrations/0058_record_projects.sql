-- Records imported from 9 Solar Home's lists (api/_lib/to_fill.py, client_list.record_projects): each
-- imported maintenance system gets a handed-over project holding the project's part of the flow, so its
-- manager can complete it like a project handed over in the app.
--
-- Those systems were handed over before the app, with any admin fee settled outside it: a record project
-- (import_ref 'record:...') moves to Maintenance without an admin-fee invoice. Every other project still
-- needs its fee paid first (0043).
--
-- Re-runnable.

CREATE OR REPLACE FUNCTION projects_fee_before_handover() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'maintenance' AND OLD.status::text IS DISTINCT FROM 'maintenance'
     AND NOT app_is_table_owner(TG_RELID)
     AND COALESCE(NEW.import_ref, '') NOT LIKE 'record:%'
     AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = NEW.project_id AND i.kind = 'admin_fee' AND i.status = 'paid') THEN
    RAISE EXCEPTION 'The admin fee isn''t paid yet. Admin confirms it before the project moves to Maintenance.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
