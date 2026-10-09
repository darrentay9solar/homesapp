-- Handover: the homeowner e-signs the installation certificate; a project
-- manager closes the project. And upload_intents, for clearing out uploads
-- that were started but never finished.
--
--   in_progress --Milestone 3 complete--> awaiting_signature
--     (request_handover_signature(): the crew's last field can trigger it, so
--      it runs as the owner after checking the caller is on the project)
--   awaiting_signature --the homeowner signs--> signed
--     (a project_signatures row by them first; then the status)
--   signed --a project manager closes--> closed   (closed_at/closed_by stamped)
--   awaiting_signature --a PM reopens a milestone--> in_progress
--
-- Once at handover the crew can no longer change the project or its files:
-- its fields are what the homeowner signed. A signature is never changed or
-- deleted. Re-runnable.

CREATE TABLE IF NOT EXISTS "upload_intents" (
	"key" text PRIMARY KEY NOT NULL,
	"uid" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "language" varchar(5) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_signatures" ADD COLUMN IF NOT EXISTS "signer_name" text;--> statement-breakpoint
ALTER TABLE "project_signatures" ADD COLUMN IF NOT EXISTS "certificate" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "closed_by" integer;--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT IF EXISTS "upload_intents_uid_users_uid_fk";--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_uid_users_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_intents_created_idx" ON "upload_intents" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_closed_by_users_uid_fk";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_closed_by_users_uid_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_projects_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_details_changed boolean;
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- A project manager: their own projects, and new ones are theirs.
  IF app_actor_type() = 'project_manager' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.project_manager_id IS DISTINCT FROM app_actor_uid() THEN
        RAISE EXCEPTION 'A project manager''s new project is run by them.' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.project_manager_id IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'This project is run by another project manager.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.project_manager_id IS DISTINCT FROM OLD.project_manager_id THEN
      RAISE EXCEPTION 'Only a superadmin can hand a project to another project manager.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'signed' THEN
        RAISE EXCEPTION 'Only the homeowner signs the handover certificate.' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'closed' AND OLD.status <> 'signed' THEN
        RAISE EXCEPTION 'A project closes once the homeowner has signed its handover certificate.' USING ERRCODE = '42501';
      END IF;
      IF OLD.status IN ('signed', 'closed') AND NOT (OLD.status = 'signed' AND NEW.status = 'closed') THEN
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
    IF OLD.status IN ('awaiting_signature', 'signed', 'closed') THEN
      RAISE EXCEPTION 'The project is at handover; its fields are now the signed record.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'pm_approved' AND NEW.status = 'in_progress') THEN
      RAISE EXCEPTION 'Only a project manager can change the project''s status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_files_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_runs_project(COALESCE(NEW.project_id, OLD.project_id)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_on_crew(COALESCE(NEW.project_id, OLD.project_id)) THEN
    IF EXISTS (SELECT 1 FROM projects p WHERE p.project_id = COALESCE(NEW.project_id, OLD.project_id)
                AND p.status IN ('awaiting_signature', 'signed', 'closed')) THEN
      RAISE EXCEPTION 'The project is at handover; its files are now the signed record.' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only the project''s crew or a project manager can add or remove its files.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION stamp_project_closed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at := now();
    NEW.closed_by := app_actor_uid();
  ELSIF NEW.status <> 'closed' THEN
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS stamp_project_closed ON projects;--> statement-breakpoint
CREATE TRIGGER stamp_project_closed
  BEFORE UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION stamp_project_closed();--> statement-breakpoint

-- Milestone 3 is complete: ask the homeowner to sign. Whoever completed it
-- (a crew member, usually) may trigger this, but only this one step.
CREATE OR REPLACE FUNCTION request_handover_signature(p_project integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (app_actor_runs_project(p_project) OR app_actor_on_crew(p_project)) THEN
    RAISE EXCEPTION 'You aren''t on this project.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project_milestones WHERE project_id = p_project AND milestone_no = 3) THEN
    RAISE EXCEPTION 'Milestone 3 isn''t complete yet.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE project_id = p_project AND homeowner_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Link the homeowner''s account first.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE projects SET status = 'awaiting_signature', updated_at = now()
   WHERE project_id = p_project AND status IN ('pm_approved', 'in_progress');
  RETURN FOUND;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_signatures_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Signatures are legal records and can''t be changed or deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.signed_by IS DISTINCT FROM app_actor_uid() OR NOT EXISTS (
       SELECT 1 FROM projects p JOIN users u ON u.uid = p.homeowner_id
        WHERE p.project_id = NEW.project_id AND p.homeowner_id = app_actor_uid()
          AND u.user_type = 'homeowner' AND u.active) THEN
    RAISE EXCEPTION 'Only the project''s homeowner signs its handover certificate, as themselves.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE project_id = NEW.project_id AND status = 'awaiting_signature') THEN
    RAISE EXCEPTION 'The project isn''t waiting for a signature.' USING ERRCODE = 'P0001';
  END IF;
  NEW.signed_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_signatures ON project_signatures;--> statement-breakpoint
CREATE TRIGGER guard_project_signatures
  BEFORE INSERT OR UPDATE OR DELETE ON project_signatures
  FOR EACH ROW EXECUTE FUNCTION guard_signatures_write();
