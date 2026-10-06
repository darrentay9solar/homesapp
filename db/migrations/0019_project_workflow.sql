-- The project workflow: who may move a project along, and who may fill it in.
--
--   Homeowner      approves or declines their own project. Nothing else.
--   Crew           (contractor admins and EPC on the project — through its
--                  contractor group or named on it) fill in milestone fields,
--                  upload files, and record a completed milestone.
--   Project manager  everything, including details, dates and reopening a
--                  milestone.
--
-- The API checks the same rules first so people get a clear message; these
-- triggers make them true whatever calls the database. The owner connection
-- (migrations, seed scripts) is exempt. Re-runnable.

-- Is the actor on this project's crew?
CREATE OR REPLACE FUNCTION app_actor_on_crew(p_project integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
      JOIN contractor_group_members m ON m.group_id = p.contractor_group_id
      JOIN users u ON u.uid = m.user_id AND u.active
     WHERE p.project_id = p_project AND m.user_id = app_actor_uid()
  ) OR EXISTS (
    SELECT 1 FROM project_assignments a JOIN users u ON u.uid = a.user_id AND u.active
     WHERE a.project_id = p_project AND a.user_id = app_actor_uid()
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- projects

CREATE OR REPLACE FUNCTION guard_projects_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_details_changed boolean;
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Only a project manager can create or delete a project.' USING ERRCODE = '42501';
  END IF;

  v_details_changed :=
     (NEW.name, NEW.address, NEW.postal_code, NEW.site_lat, NEW.site_lng, NEW.check_in_radius_m,
      NEW.homeowner_id, NEW.homeowner_name, NEW.homeowner_contact_no,
      NEW.contractor_group_id, NEW.contractor_text, NEW.project_manager_id, NEW.created_by,
      NEW.installation_start_date, NEW.target_end_date)
     IS DISTINCT FROM
     (OLD.name, OLD.address, OLD.postal_code, OLD.site_lat, OLD.site_lng, OLD.check_in_radius_m,
      OLD.homeowner_id, OLD.homeowner_name, OLD.homeowner_contact_no,
      OLD.contractor_group_id, OLD.contractor_text, OLD.project_manager_id, OLD.created_by,
      OLD.installation_start_date, OLD.target_end_date);
  IF v_details_changed THEN
    RAISE EXCEPTION 'Only a project manager can change a project''s details or dates.' USING ERRCODE = '42501';
  END IF;

  -- The homeowner: their decision on their own project, and nothing else.
  IF OLD.homeowner_id IS NOT NULL AND OLD.homeowner_id = app_actor_uid() THEN
    IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RAISE EXCEPTION 'A homeowner can approve or decline their project, but not change it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         OLD.status IN ('awaiting_homeowner', 'homeowner_declined')
         AND NEW.status IN ('homeowner_approved', 'homeowner_declined')) THEN
      RAISE EXCEPTION 'The project isn''t waiting for your approval.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- The crew: milestone fields on their own projects. The one status change
  -- they cause is the first piece of work starting an approved project.
  IF app_actor_on_crew(OLD.project_id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'pm_approved' AND NEW.status = 'in_progress') THEN
      RAISE EXCEPTION 'Only a project manager can change the project''s status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------- milestones

-- Recording a milestone as complete: the crew or a PM. Reopening one
-- (deleting the record) is a project manager's decision.
CREATE OR REPLACE FUNCTION guard_milestones_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND app_actor_on_crew(NEW.project_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only a project manager can reopen a milestone.' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_milestones ON project_milestones;
--> statement-breakpoint
CREATE TRIGGER guard_project_milestones
  BEFORE INSERT OR UPDATE OR DELETE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION guard_milestones_write();
--> statement-breakpoint

-- ---------------------------------------------------------------- files

CREATE OR REPLACE FUNCTION guard_files_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() OR app_actor_on_crew(COALESCE(NEW.project_id, OLD.project_id)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only the project''s crew or a project manager can add or remove its files.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_files ON project_files;
--> statement-breakpoint
CREATE TRIGGER guard_project_files
  BEFORE INSERT OR UPDATE OR DELETE ON project_files
  FOR EACH ROW EXECUTE FUNCTION guard_files_write();
--> statement-breakpoint

-- ------------------------------------------------ homeowner's IC (last 4)

-- The brief has the crew record the homeowner's IC last 4. It lives on the
-- homeowner's account, which only a PM may edit, so this one narrow path
-- lets the project's crew set exactly that field — still attributed to them
-- in the audit log (which records that it changed, never the value).
CREATE OR REPLACE FUNCTION set_homeowner_ic(p_project integer, p_ic text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_homeowner integer;
BEGIN
  IF NOT (app_actor_is_pm() OR app_actor_on_crew(p_project)) THEN
    RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
  END IF;
  SELECT homeowner_id INTO v_homeowner FROM projects WHERE project_id = p_project;
  IF v_homeowner IS NULL THEN
    RAISE EXCEPTION 'Link the homeowner''s account first.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE users SET ic_last4 = NULLIF(upper(btrim(p_ic)), ''), updated_at = now() WHERE uid = v_homeowner;
END $$;
--> statement-breakpoint

-- ------------------------------------------------- electricity retailers

-- The retailers a Singapore home can be with, so "Current Electricity
-- Retailer" is a choice rather than free text. More can be added from the form.
INSERT INTO electricity_retailers (name) VALUES
  ('SP Group'), ('Geneco'), ('Keppel Electric'), ('Senoko Energy'), ('Tuas Power'),
  ('Sembcorp Power'), ('Pacific Light Energy'), ('Union Power'), ('Flo Energy')
ON CONFLICT (name) DO NOTHING;
