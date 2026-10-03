-- Re-runnable on purpose: the first attempt added the enum value on the
-- development branch and then stopped at the type change, because Postgres
-- will not cast boolean to integer without being told how.
ALTER TYPE "public"."file_category" ADD VALUE IF NOT EXISTS 'as_built_pv_layout';--> statement-breakpoint
-- true meant "submitted", which is the first step (1 = submitted to LEW);
-- anything else becomes 3 = unchecked.
ALTER TABLE "projects" ALTER COLUMN "sp_application_status" SET DATA TYPE integer
  USING (CASE WHEN "sp_application_status" IS TRUE THEN 1 ELSE 3 END);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "sp_application_status" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "sp_application_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_sp_application_status_values";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sp_application_status_values"
  CHECK ("sp_application_status" IN (1, 2, 3));--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "as_built_pv_layout";--> statement-breakpoint
COMMENT ON COLUMN "projects"."sp_application_status" IS
  '1 = submitted to LEW, 2 = LEW submitted to SP, 3 = unchecked';--> statement-breakpoint
COMMENT ON COLUMN "projects"."panel_capacity" IS 'Watts per panel';
