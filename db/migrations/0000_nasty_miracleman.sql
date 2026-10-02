CREATE TYPE "public"."file_category" AS ENUM('panel_pictures', 'inverter_pictures', 'utility_bill', 'moc_change', 'gst_proof', 'sp_forms_signed', 'sp_submission_screenshot', 'pvl_letter', 'sp_appointment_letter', 'final_submission_documents', 'handover_docs', 'completion_form_signed');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('homeowner', 'project_manager', 'contractor', 'epc_team');--> statement-breakpoint
CREATE TABLE "electricity_retailers" (
	"retailer_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_retailers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"file_id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"category" "file_category" NOT NULL,
	"url" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" varchar(120),
	"size_bytes" integer,
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"project_id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"homeowner_id" integer,
	"installation_start_date" date,
	"installation_end_date" date,
	"confirmed_by_homeowner" boolean,
	"waterproofing" boolean,
	"create_group_chat" boolean,
	"panel_quantity_estimate" integer,
	"panel_quantity_actual" integer,
	"panel_capacity" integer,
	"inverter_to_order" text,
	"inverter_collected" boolean,
	"inverter_date" date,
	"inverter_serial_number" varchar(120),
	"scaffolding_removal" boolean,
	"scaffolding_removal_date" date,
	"inverter_commission_grid_connection" boolean,
	"commission_date" date,
	"rcb_breaker_replacement" boolean,
	"rcb_breaker_replacement_date" date,
	"electricity_retailer_id" integer,
	"retailer_contract_end_date" date,
	"sp_application_status" boolean,
	"sp_submission_date" date,
	"pvl_received_date" date,
	"pre_inspection_date" date,
	"sp_appointment_letter_received_date" date,
	"meter_replacement_date" date,
	"sp_turn_on_inspection_date" date,
	"as_built_pv_layout" boolean,
	"fusion_solar_app_access" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text,
	"full_name" text,
	"user_type" "user_type" NOT NULL,
	"contact_no" varchar(32),
	"ic_last4" varchar(4),
	"email" varchar(320) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_ic_last4_format" CHECK ("users"."ic_last4" ~ '^[0-9]{3}[A-Za-z]$')
);
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_uploaded_by_users_uid_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_homeowner_id_users_uid_fk" FOREIGN KEY ("homeowner_id") REFERENCES "public"."users"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_electricity_retailer_id_electricity_retailers_retailer_id_fk" FOREIGN KEY ("electricity_retailer_id") REFERENCES "public"."electricity_retailers"("retailer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree ("email");