CREATE TYPE "public"."account_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'account_created';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'account_request';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'account_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'account_rejected';--> statement-breakpoint
CREATE TABLE "account_requests" (
	"request_id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"full_name" text NOT NULL,
	"requested_type" "user_type" NOT NULL,
	"contact_no" varchar(32),
	"ic_last4" varchar(4),
	"address" text,
	"postal_code" varchar(6),
	"note" text,
	"status" "account_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" integer,
	"decision_note" text,
	"granted_uid" integer,
	CONSTRAINT "account_requests_ic_last4_format" CHECK ("account_requests"."ic_last4" ~ '^[0-9]{3}[A-Za-z]$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_invitation_id" text;--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_decided_by_users_uid_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_granted_uid_users_uid_fk" FOREIGN KEY ("granted_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_requests_one_pending_idx" ON "account_requests" USING btree ("clerk_user_id") WHERE "account_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "account_requests_status_idx" ON "account_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_users_uid_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;