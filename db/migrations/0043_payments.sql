-- Payments: the admin fee, monthly invoices for the solar power generated,
-- and the Admin (finance) account type.
--
--  * user_type 'finance' (shown as "Admin"): full rights to payments and
--    invoices; read-only everywhere else, every project included.
--  * one homeowner, one project: a homeowner account is on at most one
--    project and one system.
--  * finance_settings (one row): the company's details for the invoice
--    header, its PayNow QR, the admin fee (3,500), the plan's length (8
--    years), days to pay, and the invoice's design.
--  * invoices: the admin fee (per project, paid before the handover) and one
--    per month for the power a system generated (kWh x the contract's rate),
--    for the plan's years from the month it was turned on. Issued, then paid
--    (marked by Admin, or matched from the bank's statement) or voided. The
--    homeowner can attach proof of a payment.
--  * bank_statements: each statement uploaded, its lines and what matched.
--
-- Written by Admin and superadmins only (the homeowner only adds proof to
-- their own invoice); every change audited.
--
-- Re-runnable.

ALTER TYPE "public"."user_type" ADD VALUE IF NOT EXISTS 'finance';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'invoice_issued';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'payment_received';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'payment_proof';--> statement-breakpoint

-- ------------------------------------------------------------------ one homeowner, one project

CREATE UNIQUE INDEX IF NOT EXISTS "projects_one_per_homeowner" ON "projects" USING btree ("homeowner_id") WHERE "homeowner_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "systems_one_per_homeowner" ON "maintenance_systems" USING btree ("homeowner_id") WHERE "homeowner_id" IS NOT NULL;--> statement-breakpoint

-- ------------------------------------------------------------------ settings

CREATE TABLE IF NOT EXISTS "finance_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "company_name" text DEFAULT '9 Solar Home' NOT NULL,
  "company_address" text,
  "company_uen" text,
  "company_email" text,
  "company_phone" text,
  "logo_key" text,
  "qr_key" text,
  "pay_note" text DEFAULT 'Scan the QR with your banking app (PayNow) and put the invoice number as the reference.' NOT NULL,
  "admin_fee" numeric(12, 2) DEFAULT 3500 NOT NULL,
  "plan_years" integer DEFAULT 8 NOT NULL,
  "due_days" integer DEFAULT 14 NOT NULL,
  "accent" text DEFAULT '#0B8A5A' NOT NULL,
  "invoice_title" text DEFAULT 'INVOICE' NOT NULL,
  "intro" text,
  "footer" text,
  "terms" text,
  "show" jsonb DEFAULT '{"logo": true, "qr": true, "uen": true, "kwh": true, "terms": true}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "finance_settings_one" CHECK ("id" = 1),
  CONSTRAINT "finance_settings_values" CHECK (
    btrim("company_name") <> '' AND "admin_fee" >= 0 AND "plan_years" BETWEEN 1 AND 30
    AND "due_days" BETWEEN 0 AND 90 AND "accent" ~ '^#[0-9A-Fa-f]{6}$' AND btrim("invoice_title") <> ''
  )
);--> statement-breakpoint
INSERT INTO "finance_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint

-- ------------------------------------------------------------------ invoices

CREATE TABLE IF NOT EXISTS "invoices" (
  "invoice_id" serial PRIMARY KEY NOT NULL,
  "number" text NOT NULL,
  "kind" text NOT NULL,
  "project_id" integer,
  "system_id" integer,
  "homeowner_id" integer,
  "bill_to" text NOT NULL,
  "bill_address" text,
  "bill_email" text,
  "period" date,
  "kwh" numeric(10, 2),
  "rate" numeric(10, 4),
  "amount" numeric(12, 2) NOT NULL,
  "issued_on" date DEFAULT current_date NOT NULL,
  "due_on" date NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "paid_on" date,
  "paid_amount" numeric(12, 2),
  "paid_via" text,
  "paid_ref" text,
  "confirmed_by" integer,
  "proof_key" text,
  "proof_at" timestamp with time zone,
  "proof_note" text,
  "void_reason" text,
  "notes" text,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_values" CHECK (
    "kind" IN ('admin_fee', 'monthly') AND "status" IN ('issued', 'paid', 'void')
    AND "amount" >= 0 AND btrim("bill_to") <> '' AND "due_on" >= "issued_on"
    -- Which project or system it's for is checked when it's issued (the API): an invoice stays on
    -- record even if its project or system is later removed.
    AND ("kind" <> 'monthly' OR ("period" IS NOT NULL AND "kwh" IS NOT NULL AND "rate" IS NOT NULL
         AND extract(day FROM "period") = 1))
    AND ("status" <> 'paid' OR ("paid_on" IS NOT NULL AND "paid_amount" IS NOT NULL AND "paid_via" IN ('manual', 'statement')))
    AND ("status" <> 'void' OR btrim(coalesce("void_reason", '')) <> '')
  )
);--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_values";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_values" CHECK (
  "kind" IN ('admin_fee', 'monthly') AND "status" IN ('issued', 'paid', 'void')
  AND "amount" >= 0 AND btrim("bill_to") <> '' AND "due_on" >= "issued_on"
  AND ("kind" <> 'monthly' OR ("period" IS NOT NULL AND "kwh" IS NOT NULL AND "rate" IS NOT NULL AND extract(day FROM "period") = 1))
  AND ("status" <> 'paid' OR ("paid_on" IS NOT NULL AND "paid_amount" IS NOT NULL AND "paid_via" IN ('manual', 'statement')))
  AND ("status" <> 'void' OR btrim(coalesce("void_reason", '')) <> '')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_number_idx" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_one_fee_idx" ON "invoices" USING btree ("project_id") WHERE "kind" = 'admin_fee' AND "status" <> 'void';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_one_month_idx" ON "invoices" USING btree ("system_id", "period") WHERE "kind" = 'monthly' AND "status" <> 'void';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_homeowner_idx" ON "invoices" USING btree ("homeowner_id");--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_project_fk";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_system_fk";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."maintenance_systems"("system_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_homeowner_fk";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_homeowner_fk" FOREIGN KEY ("homeowner_id") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bank_statements" (
  "statement_id" serial PRIMARY KEY NOT NULL,
  "file_name" text NOT NULL,
  "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "matched" integer DEFAULT 0 NOT NULL,
  "uploaded_by" integer,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone
);--> statement-breakpoint

-- ------------------------------------------------------------------ who may write

CREATE OR REPLACE FUNCTION app_actor_handles_finance() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_actor_type()::text IN ('finance', 'superadmin')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_finance_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_handles_finance() THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('invoices', 'finance_settings') THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- A homeowner attaches proof of payment to their own invoice, and nothing else.
  IF TG_TABLE_NAME = 'invoices' AND TG_OP = 'UPDATE' AND OLD.homeowner_id = app_actor_uid()
     AND OLD.status = 'issued' AND NEW.status = 'issued'
     AND (to_jsonb(NEW) - 'proof_key' - 'proof_at' - 'proof_note' - 'updated_at')
       = (to_jsonb(OLD) - 'proof_key' - 'proof_at' - 'proof_note' - 'updated_at') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only Admin and superadmins handle payments and invoices.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_finance_settings_write ON finance_settings;--> statement-breakpoint
CREATE TRIGGER guard_finance_settings_write BEFORE INSERT OR UPDATE OR DELETE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION guard_finance_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_invoices_write ON invoices;--> statement-breakpoint
CREATE TRIGGER guard_invoices_write BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_finance_write();--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_bank_statements_write ON bank_statements;--> statement-breakpoint
CREATE TRIGGER guard_bank_statements_write BEFORE INSERT OR UPDATE OR DELETE ON bank_statements
  FOR EACH ROW EXECUTE FUNCTION guard_finance_write();--> statement-breakpoint

-- An invoice is never deleted, only voided, so the record stays.
CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'An invoice is voided, not deleted, so it stays on record.' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoices_no_delete ON invoices;--> statement-breakpoint
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_no_delete();--> statement-breakpoint

-- The admin fee is paid before a project is handed over to Maintenance.
CREATE OR REPLACE FUNCTION projects_fee_before_handover() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'maintenance' AND OLD.status::text IS DISTINCT FROM 'maintenance'
     AND NOT app_is_table_owner(TG_RELID)
     AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = NEW.project_id AND i.kind = 'admin_fee' AND i.status = 'paid') THEN
    RAISE EXCEPTION 'The admin fee isn''t paid yet. Admin confirms it before the project moves to Maintenance.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_fee_before_handover ON projects;--> statement-breakpoint
CREATE TRIGGER projects_fee_before_handover BEFORE UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_fee_before_handover();--> statement-breakpoint

-- ------------------------------------------------------------------ audit

DROP TRIGGER IF EXISTS audit_finance_settings ON finance_settings;--> statement-breakpoint
CREATE TRIGGER audit_finance_settings AFTER INSERT OR UPDATE OR DELETE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_invoices ON invoices;--> statement-breakpoint
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('invoice_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_bank_statements ON bank_statements;--> statement-breakpoint
CREATE TRIGGER audit_bank_statements AFTER INSERT OR UPDATE OR DELETE ON bank_statements
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('statement_id');
--> statement-breakpoint

-- Admin accounts, like project managers', are a superadmin's to create and change.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('guard_users_write'::regproc);
  d := replace(d, $q$(TG_OP <> 'INSERT' AND OLD.user_type::text = 'project_manager')$q$,
                  $q$(TG_OP <> 'INSERT' AND OLD.user_type::text IN ('project_manager', 'finance'))$q$);
  d := replace(d, $q$(TG_OP <> 'DELETE' AND NEW.user_type::text = 'project_manager')$q$,
                  $q$(TG_OP <> 'DELETE' AND NEW.user_type::text IN ('project_manager', 'finance'))$q$);
  EXECUTE d;
END $do$;
