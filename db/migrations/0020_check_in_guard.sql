-- Who may record a GPS check-in.
--
-- The geofence (0007, 0013) decides WHERE a check-in may happen. Nothing
-- decided WHO: any signed-in account could record one for anybody on any
-- project. Found while testing the GPS rules. From the brief: the EPC team
-- checks in, as themselves, on a project they're on — and only once it's
-- approved. Check-ins are site evidence, so nobody deletes them. A project
-- manager may correct crew counts; the time and place stay fixed (0013).
-- The owner connection (migrations, seed scripts) is exempt. Re-runnable.

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
  IF app_actor_is_pm() THEN
    IF NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at THEN
      RAISE EXCEPTION 'Only the crew member who checked in can check out.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only the crew member who checked in can check out.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_site_check_ins ON site_check_ins;
--> statement-breakpoint
CREATE TRIGGER guard_site_check_ins
  BEFORE INSERT OR UPDATE OR DELETE ON site_check_ins
  FOR EACH ROW EXECUTE FUNCTION guard_check_ins_write();
