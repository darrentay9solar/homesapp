-- Admin (finance) downloads the lists it looks after as Excel (projects, maintenance, invoices),
-- and each download is recorded like everyone else's (data_exports). Before this only
-- project managers and superadmins could record one.
--
-- Re-runnable.

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
       OR (app_actor_type() = 'finance' AND NEW.what IN ('projects', 'maintenance', 'invoices'))
     ) THEN
    RAISE EXCEPTION 'Only a project manager can export.' USING ERRCODE = '42501';
  END IF;
  NEW.exported_at := now();
  RETURN NEW;
END $$;
