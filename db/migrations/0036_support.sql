-- Support: a homeowner asks; an assistant answers what it can; a person
-- settles the rest (_routes/support.py, _lib/assistant.py).
--
--  * support_threads: one conversation. Its status:
--      assistant  talking with the assistant (common questions)
--      waiting    asked for a person; nobody from 9 Solar Home has answered yet
--      open       a person is on it
--      settled    done (either side can reopen it)
--    handled_by is the project manager looking after it: the project's own,
--    or whoever a superadmin hands it to.
--  * support_members: who is in the conversation and how far they've read.
--    The person who asked, the manager, and anyone the manager brings in,
--    on the project or not.
--  * support_messages: what was said. Insert only: a conversation is a
--    record, so nothing in it is edited or deleted. kind: text (a person),
--    assistant (the assistant's answer), event (someone joined, it was
--    settled, ...).
--  * support_faq: the answers the assistant gives, written and kept up to
--    date by project managers.
--
-- Who may write is checked here as well as in the API. Threads, members
-- and answers are audited; messages are their own record.
--
-- Re-runnable.

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'support_request';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'support_message';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'support_added';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'support_settled';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_threads" (
  "thread_id" serial PRIMARY KEY NOT NULL,
  "subject" text NOT NULL,
  "opened_by" integer NOT NULL,
  "project_id" integer,
  "handled_by" integer,
  "status" text DEFAULT 'assistant' NOT NULL,
  "asked_at" timestamp with time zone,
  "answered_at" timestamp with time zone,
  "settled_at" timestamp with time zone,
  "settled_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_threads_values" CHECK (
    "status" IN ('assistant', 'waiting', 'open', 'settled')
    AND btrim("subject") <> '' AND length("subject") <= 120
  )
);--> statement-breakpoint
ALTER TABLE "support_threads" DROP CONSTRAINT IF EXISTS "support_threads_opened_by_fk";--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_opened_by_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" DROP CONSTRAINT IF EXISTS "support_threads_project_fk";--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" DROP CONSTRAINT IF EXISTS "support_threads_handled_by_fk";--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_handled_by_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" DROP CONSTRAINT IF EXISTS "support_threads_settled_by_fk";--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_settled_by_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_threads_opened_by_idx" ON "support_threads" USING btree ("opened_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_threads_handled_by_idx" ON "support_threads" USING btree ("handled_by");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_members" (
  "thread_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "added_by" integer,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_read_id" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "support_members_pk" PRIMARY KEY ("thread_id", "user_id")
);--> statement-breakpoint
ALTER TABLE "support_members" DROP CONSTRAINT IF EXISTS "support_members_thread_fk";--> statement-breakpoint
ALTER TABLE "support_members" ADD CONSTRAINT "support_members_thread_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_members" DROP CONSTRAINT IF EXISTS "support_members_user_fk";--> statement-breakpoint
ALTER TABLE "support_members" ADD CONSTRAINT "support_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_members_user_idx" ON "support_members" USING btree ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_messages" (
  "message_id" bigserial PRIMARY KEY NOT NULL,
  "thread_id" integer NOT NULL,
  "sender_uid" integer,
  "kind" text DEFAULT 'text' NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_messages_values" CHECK (
    "kind" IN ('text', 'assistant', 'event')
    AND btrim("body") <> '' AND length("body") <= 4000
    AND (("kind" = 'assistant') = ("sender_uid" IS NULL))
  )
);--> statement-breakpoint
ALTER TABLE "support_messages" DROP CONSTRAINT IF EXISTS "support_messages_thread_fk";--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" DROP CONSTRAINT IF EXISTS "support_messages_sender_fk";--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_fk" FOREIGN KEY ("sender_uid") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_thread_idx" ON "support_messages" USING btree ("thread_id", "message_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_faq" (
  "faq_id" serial PRIMARY KEY NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "question_zh" text,
  "answer_zh" text,
  "position" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_faq_values" CHECK (
    btrim("question") <> '' AND length("question") <= 300
    AND btrim("answer") <> '' AND length("answer") <= 3000
    AND ("question_zh" IS NULL OR length("question_zh") <= 300)
    AND ("answer_zh" IS NULL OR length("answer_zh") <= 3000)
  )
);--> statement-breakpoint
ALTER TABLE "support_faq" DROP CONSTRAINT IF EXISTS "support_faq_updated_by_fk";--> statement-breakpoint
ALTER TABLE "support_faq" ADD CONSTRAINT "support_faq_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ------------------------------------------------------------------ who

-- Whether the acting person looks after this conversation: a superadmin
-- always; a project manager when it's theirs to handle (handled by them, or
-- about a project they run).
CREATE OR REPLACE FUNCTION app_actor_handles_support(p_thread integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_actor_is_superadmin() OR (
    app_actor_type() = 'project_manager' AND EXISTS (
      SELECT 1 FROM support_threads t
        LEFT JOIN projects p ON p.project_id = t.project_id
       WHERE t.thread_id = p_thread
         AND (t.handled_by = app_actor_uid() OR p.project_manager_id = app_actor_uid())))
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_actor_in_support(p_thread integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM support_members m WHERE m.thread_id = p_thread AND m.user_id = app_actor_uid())
$$;
--> statement-breakpoint

-- ------------------------------------------------------------------ who may write

CREATE OR REPLACE FUNCTION guard_support_threads_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_uid() IS NULL OR app_actor_type() IS NULL THEN
    RAISE EXCEPTION 'Sign in to ask for help.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.opened_by IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'A question is asked by the person asking it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('assistant', 'waiting') THEN
      RAISE EXCEPTION 'A new question starts with the assistant or waiting for a person.' USING ERRCODE = '42501';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM projects p WHERE p.project_id = NEW.project_id AND p.homeowner_id = app_actor_uid())
       AND NOT app_actor_on_crew(NEW.project_id) THEN
      RAISE EXCEPTION 'You can only ask about your own project.' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A support conversation is settled, not deleted, so it stays on record.' USING ERRCODE = '42501';
  END IF;
  IF NEW.opened_by IS DISTINCT FROM OLD.opened_by OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Who asked, and about which project, can''t be changed.' USING ERRCODE = '42501';
  END IF;
  IF NOT app_actor_handles_support(OLD.thread_id) THEN
    -- The person who asked may ask for a person, settle it, or reopen it; nothing else.
    IF OLD.opened_by IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'Only the person who asked, or their project manager, can change this conversation.' USING ERRCODE = '42501';
    END IF;
    IF NEW.handled_by IS DISTINCT FROM OLD.handled_by AND OLD.handled_by IS NOT NULL THEN
      RAISE EXCEPTION 'Only 9 Solar Home can hand a conversation to someone else.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'open' AND OLD.status <> 'open' THEN
      RAISE EXCEPTION 'A conversation opens when 9 Solar Home answers.' USING ERRCODE = '42501';
    END IF;
    IF NEW.subject IS DISTINCT FROM OLD.subject THEN
      RAISE EXCEPTION 'The subject can''t be changed.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.handled_by IS DISTINCT FROM OLD.handled_by AND NEW.handled_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.uid = NEW.handled_by AND u.active AND u.user_type IN ('project_manager', 'superadmin')) THEN
    RAISE EXCEPTION 'A conversation is handled by a project manager.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_support_threads_write ON support_threads;--> statement-breakpoint
CREATE TRIGGER guard_support_threads_write BEFORE INSERT OR UPDATE OR DELETE ON support_threads
  FOR EACH ROW EXECUTE FUNCTION guard_support_threads_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_support_members_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_thread support_threads;
BEGIN
  SELECT * INTO v_thread FROM support_threads WHERE thread_id = COALESCE(NEW.thread_id, OLD.thread_id);
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF app_actor_uid() IS NULL OR app_actor_type() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Each person only moves their own "read up to" mark.
    IF NEW.user_id IS DISTINCT FROM app_actor_uid() OR NEW.thread_id <> OLD.thread_id OR NEW.user_id <> OLD.user_id
       OR NEW.added_by IS DISTINCT FROM OLD.added_by OR NEW.added_at IS DISTINCT FROM OLD.added_at THEN
      RAISE EXCEPTION 'You can only mark your own conversations read.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF app_actor_handles_support(NEW.thread_id) THEN
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.uid = NEW.user_id AND u.active) THEN
        RAISE EXCEPTION 'Only someone with an active account can join a conversation.' USING ERRCODE = '42501';
      END IF;
      NEW.added_by := app_actor_uid();
      NEW.added_at := now();
      RETURN NEW;
    END IF;
    IF NEW.user_id = app_actor_uid() AND v_thread.opened_by = app_actor_uid() THEN
      NEW.added_by := app_actor_uid();
      NEW.added_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the project manager looking after this conversation can bring someone in.' USING ERRCODE = '42501';
  END IF;
  -- DELETE
  IF NOT app_actor_handles_support(OLD.thread_id) THEN
    RAISE EXCEPTION 'Only the project manager looking after this conversation can take someone out of it.' USING ERRCODE = '42501';
  END IF;
  IF OLD.user_id = v_thread.opened_by THEN
    RAISE EXCEPTION 'The person who asked stays in their conversation.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_support_members_write ON support_members;--> statement-breakpoint
CREATE TRIGGER guard_support_members_write BEFORE INSERT OR UPDATE OR DELETE ON support_members
  FOR EACH ROW EXECUTE FUNCTION guard_support_members_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_support_messages_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_thread support_threads;
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'What was said in a conversation stays as it was said.' USING ERRCODE = '42501';
  END IF;
  IF app_actor_uid() IS NULL OR app_actor_type() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_thread FROM support_threads WHERE thread_id = NEW.thread_id;
  IF NEW.kind = 'assistant' THEN
    -- The assistant answers the person who asked, while they're talking with it.
    IF v_thread.opened_by IS DISTINCT FROM app_actor_uid() OR v_thread.status <> 'assistant' THEN
      RAISE EXCEPTION 'The assistant only answers while you''re talking with it.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.sender_uid IS DISTINCT FROM app_actor_uid() THEN
      RAISE EXCEPTION 'A message is sent by the person writing it.' USING ERRCODE = '42501';
    END IF;
    IF NOT app_actor_in_support(NEW.thread_id) AND NOT app_actor_handles_support(NEW.thread_id) THEN
      RAISE EXCEPTION 'You''re not in this conversation.' USING ERRCODE = '42501';
    END IF;
    IF v_thread.status = 'settled' AND NEW.kind = 'text' THEN
      RAISE EXCEPTION 'This conversation is settled. Reopen it to write.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_support_messages_write ON support_messages;--> statement-breakpoint
CREATE TRIGGER guard_support_messages_write BEFORE INSERT OR UPDATE OR DELETE ON support_messages
  FOR EACH ROW EXECUTE FUNCTION guard_support_messages_write();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_support_faq_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(app_actor_type() NOT IN ('project_manager', 'superadmin'), true) THEN
    RAISE EXCEPTION 'Only a project manager can change the assistant''s answers.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Turn an answer off instead; it stays on record.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_by := app_actor_uid();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_support_faq_write ON support_faq;--> statement-breakpoint
CREATE TRIGGER guard_support_faq_write BEFORE INSERT OR UPDATE OR DELETE ON support_faq
  FOR EACH ROW EXECUTE FUNCTION guard_support_faq_write();--> statement-breakpoint

-- ------------------------------------------------------------------ audit

DROP TRIGGER IF EXISTS audit_support_threads ON support_threads;--> statement-breakpoint
CREATE TRIGGER audit_support_threads AFTER INSERT OR UPDATE OR DELETE ON support_threads
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('thread_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_support_members ON support_members;--> statement-breakpoint
CREATE TRIGGER audit_support_members AFTER INSERT OR DELETE ON support_members
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('thread_id', 'user_id');--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_support_faq ON support_faq;--> statement-breakpoint
CREATE TRIGGER audit_support_faq AFTER INSERT OR UPDATE OR DELETE ON support_faq
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('faq_id');
