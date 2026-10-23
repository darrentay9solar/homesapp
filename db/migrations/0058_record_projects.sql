-- Records imported from 9 Solar Home's lists (api/_lib/to_fill.py, client_list.record_projects): each
-- imported maintenance system gets a handed-over project holding the project's part of the flow, so its
-- manager can complete it like a project handed over in the app.
--
-- Those systems were handed over before the app, with any admin fee settled outside it: a record project
-- (import_ref 'record:...') moves to Maintenance without an admin-fee invoice. Every other project still
-- needs its fee paid first (0043).
--
-- Also: Admin records its downloads of Solar's tables (the export guard, 0049).
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
--> statement-breakpoint

-- Admin (finance) sees Solar, so it downloads Solar's tables too (as 0049 lets it for the lists it
-- looks after); each download is recorded like everyone else's.
CREATE OR REPLACE FUNCTION guard_data_exports_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'The record of an export can''t be changed.' USING ERRCODE = '42501';
  END IF;
  IF NEW.exported_by IS DISTINCT FROM app_actor_uid()
     OR NOT (
       COALESCE(app_actor_type() IN ('project_manager', 'superadmin'), false)
       OR (app_actor_type() = 'finance' AND NEW.what IN ('projects', 'maintenance', 'invoices', 'solar', 'solar_report'))
     ) THEN
    RAISE EXCEPTION 'Only a project manager can export.' USING ERRCODE = '42501';
  END IF;
  NEW.exported_at := now();
  RETURN NEW;
END $$;
