-- Files with no project yet (My Files → Unassigned): 9 Solar Home's staff
-- upload documents and photos before they know, or before there is, a
-- project for them, then assign each to a project and the milestone slot it
-- belongs in (api/_routes/files.py). Staff only: project managers and
-- superadmins upload, see and assign them; crews and homeowners only ever
-- upload onto a project.
--
-- Assigning moves the row to project_files, keeping the stored copy where it
-- is, under the project's usual checks (the slot must be open to the person
-- assigning it, as for an upload; guard_files_write still applies).
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "unassigned_files" (
  "file_id" serial PRIMARY KEY NOT NULL,
  "url" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "kind" text NOT NULL,
  "note" text,
  "uploaded_by" integer,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "unassigned_files_values" CHECK (
    btrim("file_name") <> '' AND length("file_name") <= 200 AND "size_bytes" >= 0
    AND "kind" IN ('image', 'document') AND "url" ~ '^unassigned/'
    AND ("note" IS NULL OR length("note") <= 500)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unassigned_files_url_idx" ON "unassigned_files" USING btree ("url");--> statement-breakpoint
ALTER TABLE "unassigned_files" DROP CONSTRAINT IF EXISTS "unassigned_files_uploaded_by_fk";--> statement-breakpoint
ALTER TABLE "unassigned_files" ADD CONSTRAINT "unassigned_files_uploaded_by_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_unassigned_files_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only 9 Solar Home''s project managers keep files that aren''t on a project yet.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_unassigned_files_write ON unassigned_files;--> statement-breakpoint
CREATE TRIGGER guard_unassigned_files_write BEFORE INSERT OR UPDATE OR DELETE ON unassigned_files
  FOR EACH ROW EXECUTE FUNCTION guard_unassigned_files_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_unassigned_files ON unassigned_files;--> statement-breakpoint
CREATE TRIGGER audit_unassigned_files AFTER INSERT OR UPDATE OR DELETE ON unassigned_files
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('file_id');
