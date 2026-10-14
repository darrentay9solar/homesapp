-- A project manager chooses who runs a project they create: themselves or any
-- other active project manager (or superadmin). A project with no manager yet
-- (imported from the project list) can be taken on by any project manager.
-- Handing over a project that already has a manager stays a superadmin's.
--
-- Re-runnable.

CREATE OR REPLACE FUNCTION public.guard_projects_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_details_changed boolean;
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- A project manager: their own projects. A new one is run by whichever active
  -- project manager they choose (themselves or another, 0041); one with no
  -- manager yet (from the project list) any of them may take on.
  IF app_actor_type() = 'project_manager' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.project_manager_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM users u WHERE u.uid = NEW.project_manager_id AND u.active
             AND u.user_type IN ('project_manager', 'superadmin')) THEN
        RAISE EXCEPTION 'A project is run by an active project manager.' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.project_manager_id IS NULL AND TG_OP = 'UPDATE' THEN
      IF NEW.project_manager_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM users u WHERE u.uid = NEW.project_manager_id AND u.active
             AND u.user_type IN ('project_manager', 'superadmin')) THEN
        RAISE EXCEPTION 'A project is run by an active project manager.' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF OLD.project_manager_id IS DISTINCT FROM app_actor_uid() THEN
        RAISE EXCEPTION 'This project is run by another project manager.' USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.project_manager_id IS DISTINCT FROM OLD.project_manager_id THEN
        RAISE EXCEPTION 'Only a superadmin can hand a project to another project manager.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'signed' THEN
        RAISE EXCEPTION 'Only the homeowner signs the handover certificate.' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'maintenance' AND OLD.status <> 'signed' THEN
        RAISE EXCEPTION 'A project closes once the homeowner has signed its handover certificate.' USING ERRCODE = '42501';
      END IF;
      IF OLD.status IN ('signed', 'maintenance') AND NOT (OLD.status = 'signed' AND NEW.status = 'maintenance') THEN
        RAISE EXCEPTION 'The handover certificate is signed, so the project can''t go back a step.' USING ERRCODE = '42501';
      END IF;
    END IF;
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
         AND NEW.status IN ('homeowner_approved', 'homeowner_declined'))
       AND NOT (OLD.status = 'awaiting_signature' AND NEW.status = 'signed' AND EXISTS (
         SELECT 1 FROM project_signatures s WHERE s.project_id = OLD.project_id AND s.signed_by = app_actor_uid())) THEN
      RAISE EXCEPTION 'The project isn''t waiting for your approval.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- The crew: milestone fields on their own projects. The one status change
  -- they cause is the first piece of work starting an approved project.
  IF app_actor_on_crew(OLD.project_id) THEN
    IF OLD.status IN ('awaiting_signature', 'signed', 'maintenance') THEN
      RAISE EXCEPTION 'The project is at handover; its fields are now the signed record.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'pm_approved' AND NEW.status = 'in_progress') THEN
      RAISE EXCEPTION 'Only a project manager can change the project''s status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $function$;
--> statement-breakpoint
-- Crew on a project made in this same transaction: whoever creates a project
-- for another project manager adds its crew as they create it.
CREATE OR REPLACE FUNCTION public.guard_assignments_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT (app_is_table_owner(TG_RELID) OR app_actor_runs_project(COALESCE(NEW.project_id, OLD.project_id))
          OR (TG_OP = 'INSERT' AND EXISTS (
                SELECT 1 FROM projects p WHERE p.project_id = NEW.project_id
                   AND p.created_by = app_actor_uid() AND p.xmin = pg_current_xact_id()::xid))) THEN
    RAISE EXCEPTION 'Only a project manager can assign people to a project.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.user_id AND user_type IN ('contractor', 'epc_team')
  ) THEN
    RAISE EXCEPTION 'Only contractor admins and EPC team members can be assigned to a project.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
