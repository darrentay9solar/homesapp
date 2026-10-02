CREATE TABLE "project_signatures" (
	"signature_id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"signed_by" integer NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_url" text NOT NULL,
	"certificate_hash" varchar(64),
	"certificate_url" text,
	"signed_ip" varchar(45),
	"signed_user_agent" text
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "name" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_manager_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sales" varchar(160);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "current_stage" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "postal_code" varchar(6);--> statement-breakpoint
ALTER TABLE "project_signatures" ADD CONSTRAINT "project_signatures_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signatures" ADD CONSTRAINT "project_signatures_signed_by_users_uid_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_signatures_project_idx" ON "project_signatures" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_users_uid_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;