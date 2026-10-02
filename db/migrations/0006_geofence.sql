ALTER TABLE "projects" ADD COLUMN "postal_code" varchar(6);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "geocoded_address" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "geocode_source" varchar(32);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "check_in_radius_m" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD COLUMN "accuracy_m" double precision;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD COLUMN "checkout_lat" double precision;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD COLUMN "checkout_lng" double precision;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD COLUMN "checkout_distance_m" double precision;--> statement-breakpoint
ALTER TABLE "site_check_ins" ADD COLUMN "checkout_accuracy_m" double precision;