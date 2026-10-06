-- Creating projects, as the brief describes it, and who may change what.
--
-- Re-runnable: every statement is idempotent.
ALTER TYPE "public"."file_category" ADD VALUE IF NOT EXISTS 'fusion_solar_access';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "homeowner_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "homeowner_contact_no" varchar(32);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "created_by" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "target_end_date" date;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_created_by_users_uid_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_uid_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Everything in Create Project is mandatory. NOT VALID: enforced for every
-- new or changed row, without failing on half-filled test rows from before.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_required_on_create') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_required_on_create CHECK (
      btrim(name) <> '' AND btrim(address) <> ''
      AND (homeowner_id IS NOT NULL OR btrim(coalesce(homeowner_name, '')) <> '')
      AND btrim(coalesce(homeowner_contact_no, '')) <> ''
      AND installation_start_date IS NOT NULL AND target_end_date IS NOT NULL
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_dates_in_order') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_dates_in_order
      CHECK (target_end_date >= installation_start_date);
  END IF;
END $$;--> statement-breakpoint

-- Only a project manager creates or deletes a project, and only a project
-- manager changes its details: name, address and site, homeowner, contractor,
-- owner and dates. Crews fill in milestone fields, which are not in this
-- list. The owner connection (migrations, seeds) is exempt.
CREATE OR REPLACE FUNCTION guard_projects_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Only a project manager can create or delete a project.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.name, NEW.address, NEW.postal_code, NEW.site_lat, NEW.site_lng, NEW.check_in_radius_m,
      NEW.homeowner_id, NEW.homeowner_name, NEW.homeowner_contact_no,
      NEW.contractor_group_id, NEW.contractor_text, NEW.project_manager_id, NEW.created_by,
      NEW.installation_start_date, NEW.target_end_date)
     IS DISTINCT FROM
     (OLD.name, OLD.address, OLD.postal_code, OLD.site_lat, OLD.site_lng, OLD.check_in_radius_m,
      OLD.homeowner_id, OLD.homeowner_name, OLD.homeowner_contact_no,
      OLD.contractor_group_id, OLD.contractor_text, OLD.project_manager_id, OLD.created_by,
      OLD.installation_start_date, OLD.target_end_date) THEN
    RAISE EXCEPTION 'Only a project manager can change a project''s details or dates.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_projects ON projects;--> statement-breakpoint
CREATE TRIGGER guard_projects
  BEFORE INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION guard_projects_write();--> statement-breakpoint

-- The homeowner must be a homeowner account, and the project manager a PM.
CREATE OR REPLACE FUNCTION check_project_people() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.homeowner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.homeowner_id AND user_type = 'homeowner'
  ) THEN
    RAISE EXCEPTION 'The homeowner must be a homeowner account.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.project_manager_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.project_manager_id AND user_type = 'project_manager'
  ) THEN
    RAISE EXCEPTION 'The project''s owner must be a project manager.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS check_project_people ON projects;--> statement-breakpoint
CREATE TRIGGER check_project_people
  BEFORE INSERT OR UPDATE OF homeowner_id, project_manager_id ON projects
  FOR EACH ROW EXECUTE FUNCTION check_project_people();--> statement-breakpoint

-- Named individuals on a project: only a PM assigns them, and only crews
-- (contractor admins and EPC) can be assigned.
CREATE OR REPLACE FUNCTION guard_assignments_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (app_is_table_owner(TG_RELID) OR app_actor_is_pm()) THEN
    RAISE EXCEPTION 'Only a project manager can assign people to a project.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM users WHERE uid = NEW.user_id AND user_type IN ('contractor', 'epc_team')
  ) THEN
    RAISE EXCEPTION 'Only contractor admins and EPC team members can be assigned to a project.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_assignments ON project_assignments;--> statement-breakpoint
CREATE TRIGGER guard_project_assignments
  BEFORE INSERT OR UPDATE OR DELETE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_assignments_write();
