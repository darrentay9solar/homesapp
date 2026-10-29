-- GetApps (9 Solar Fintech, docs/editions.md): its project workflow, and groups of projects under one contract.
-- 9 Solar Home's database gets the same tables and leaves them empty.
--
--   project_groups             a contract covering many sites: its name, reference and client
--   project_phases             a group's phases (Phase 1, Phase 2, as many as needed), in order
--   projects.group_id/phase_id which group and phase a project belongs to (either may be empty)
--   project_steps              one line per workflow item done on a project: when, by whom, what was
--                              entered (an inverter's serial and size) and a note. The items themselves
--                              are defined in code (api/_lib/workflow.py), except the checklists below
--   workflow_checklist_items   the Mechanical Works and Electrical Works checklists, read from the Excel
--                              sheets a superadmin uploads; each project ticks them off (project_steps,
--                              step 'check:<item_id>')
--   project_files.step         a drawing uploaded for one workflow item (category 'workflow')
--
-- Re-runnable.

ALTER TYPE "public"."file_category" ADD VALUE IF NOT EXISTS 'workflow';--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN IF NOT EXISTS "step" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_files_step" ON "project_files" ("project_id", "step") WHERE "step" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_groups" (
  "group_id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "contract_ref" text,
  "client" text,
  "notes" text,
  "created_by" integer REFERENCES "users"("uid") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "project_groups_values" CHECK (
    btrim("name") <> '' AND char_length("name") <= 200
    AND ("contract_ref" IS NULL OR char_length("contract_ref") <= 100)
    AND ("client" IS NULL OR char_length("client") <= 200)
    AND ("notes" IS NULL OR char_length("notes") <= 2000)
  )
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_phases" (
  "phase_id" serial PRIMARY KEY,
  "group_id" integer NOT NULL REFERENCES "project_groups"("group_id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "project_phases_values" CHECK (btrim("name") <> '' AND char_length("name") <= 100)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_phases_name" ON "project_phases" ("group_id", lower("name"));--> statement-breakpoint

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "group_id" integer REFERENCES "project_groups"("group_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "phase_id" integer REFERENCES "project_phases"("phase_id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_group" ON "projects" ("group_id", "phase_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_steps" (
  "step_id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("project_id") ON DELETE CASCADE,
  "step" text NOT NULL,
  "done_at" timestamp with time zone NOT NULL DEFAULT now(),
  "done_by" integer REFERENCES "users"("uid") ON DELETE SET NULL,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "note" text,
  CONSTRAINT "project_steps_values" CHECK (
    "step" ~ '^([a-z0-9_]{1,60}|check:[0-9]{1,9})$'
    AND ("note" IS NULL OR char_length("note") <= 1000)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_steps_one" ON "project_steps" ("project_id", "step");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_checklist_items" (
  "item_id" serial PRIMARY KEY,
  "stage" text NOT NULL,
  "sort" integer NOT NULL,
  "label" text NOT NULL,
  "source_file" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_checklist_items_values" CHECK (
    "stage" IN ('mechanical', 'electrical') AND btrim("label") <> '' AND char_length("label") <= 300
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_checklist_items_stage" ON "workflow_checklist_items" ("stage", "sort") WHERE "active";--> statement-breakpoint

-- Who may write: groups, phases and checklists are the office's (a superadmin or a project manager,
-- "HQ Staff" in GetApps); a project's workflow lines, anyone working on projects (the API checks the
-- project is theirs). Nothing here is deleted by the app except a ticked line taken back.
CREATE OR REPLACE FUNCTION guard_getapps_office_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin() OR app_actor_type() = 'project_manager' THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'project_groups' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only the office changes groups, phases and checklists.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_project_steps_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_superadmin()
     OR app_actor_type() IN ('project_manager', 'epc_team', 'contractor') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only the project''s team records its workflow.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_groups_write ON project_groups;--> statement-breakpoint
CREATE TRIGGER guard_project_groups_write BEFORE INSERT OR UPDATE OR DELETE ON project_groups
  FOR EACH ROW EXECUTE FUNCTION guard_getapps_office_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_phases_write ON project_phases;--> statement-breakpoint
CREATE TRIGGER guard_project_phases_write BEFORE INSERT OR UPDATE OR DELETE ON project_phases
  FOR EACH ROW EXECUTE FUNCTION guard_getapps_office_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_workflow_checklist_items_write ON workflow_checklist_items;--> statement-breakpoint
CREATE TRIGGER guard_workflow_checklist_items_write BEFORE INSERT OR UPDATE OR DELETE ON workflow_checklist_items
  FOR EACH ROW EXECUTE FUNCTION guard_getapps_office_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_project_steps_write ON project_steps;--> statement-breakpoint
CREATE TRIGGER guard_project_steps_write BEFORE INSERT OR UPDATE OR DELETE ON project_steps
  FOR EACH ROW EXECUTE FUNCTION guard_project_steps_write();--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_project_groups ON project_groups;--> statement-breakpoint
CREATE TRIGGER audit_project_groups AFTER INSERT OR UPDATE OR DELETE ON project_groups
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('group_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_project_phases ON project_phases;--> statement-breakpoint
CREATE TRIGGER audit_project_phases AFTER INSERT OR UPDATE OR DELETE ON project_phases
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('phase_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_project_steps ON project_steps;--> statement-breakpoint
CREATE TRIGGER audit_project_steps AFTER INSERT OR UPDATE OR DELETE ON project_steps
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('step_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_workflow_checklist_items ON workflow_checklist_items;--> statement-breakpoint
CREATE TRIGGER audit_workflow_checklist_items AFTER INSERT OR UPDATE OR DELETE ON workflow_checklist_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('item_id');
