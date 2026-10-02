CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('approval_request', 'approval_granted', 'approval_declined', 'assignment', 'visit_assigned', 'visit_reminder', 'visit_missed', 'milestone_complete', 'signature_request', 'signed', 'project_closed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'awaiting_homeowner', 'homeowner_declined', 'homeowner_approved', 'pm_approved', 'in_progress', 'awaiting_signature', 'signed', 'closed');--> statement-breakpoint
CREATE TABLE "contractor_group_members" (
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" integer,
	CONSTRAINT "contractor_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "contractor_groups" (
	"group_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"delivery_id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" bigint NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text,
	"provider_message_id" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" bigserial PRIMARY KEY NOT NULL,
	"recipient_uid" integer NOT NULL,
	"project_id" integer,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" integer,
	CONSTRAINT "project_assignments_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"project_id" integer NOT NULL,
	"milestone_no" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" integer,
	CONSTRAINT "project_milestones_project_id_milestone_no_pk" PRIMARY KEY("project_id","milestone_no"),
	CONSTRAINT "project_milestones_no_range" CHECK ("project_milestones"."milestone_no" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "site_check_ins" (
	"check_in_id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"visit_id" integer,
	"user_id" integer NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"crew_in" integer NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"distance_m" double precision,
	"checked_out_at" timestamp with time zone,
	"crew_out" integer
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"visit_id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" varchar(5),
	"works_note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reverts_audit_id" bigint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "project_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contractor_group_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contractor_text" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_lat" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_lng" double precision;--> statement-breakpoint
ALTER TABLE "contractor_group_members" ADD CONSTRAINT "contractor_group_members_group_id_contractor_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contractor_groups"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_group_members" ADD CONSTRAINT "contractor_group_members_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_group_members" ADD CONSTRAINT "contractor_group_members_added_by_users_uid_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("notification_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_uid_users_uid_fk" FOREIGN KEY ("recipient_uid") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_assigned_by_users_uid_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_completed_by_users_uid_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD CONSTRAINT "site_check_ins_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD CONSTRAINT "site_check_ins_visit_id_site_visits_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."site_visits"("visit_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD CONSTRAINT "site_check_ins_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_created_by_users_uid_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_group_members_user_idx" ON "contractor_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_uid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_assignments_user_idx" ON "project_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_check_ins_project_idx" ON "site_check_ins" USING btree ("project_id","checked_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "site_check_ins_user_idx" ON "site_check_ins" USING btree ("user_id","checked_in_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "site_visits_project_date_idx" ON "site_visits" USING btree ("project_id","scheduled_date");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contractor_group_id_contractor_groups_group_id_fk" FOREIGN KEY ("contractor_group_id") REFERENCES "public"."contractor_groups"("group_id") ON DELETE set null ON UPDATE no action;