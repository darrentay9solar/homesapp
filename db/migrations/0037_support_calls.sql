-- Support: a video call in a conversation (_routes/support.py, POST /support/{id}/call).
--
--  * support_messages.kind 'call': the body is the meeting's link (Google
--    Meet, Microsoft Teams or Zoom, checked by the API). Only someone looking
--    after the conversation (its project manager, or a superadmin) starts one;
--    everyone in it gets a Join button.
--
-- Re-runnable.

ALTER TABLE "support_messages" DROP CONSTRAINT IF EXISTS "support_messages_values";--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_values" CHECK (
  "kind" IN ('text', 'assistant', 'event', 'call')
  AND btrim("body") <> '' AND length("body") <= 4000
  AND (("kind" = 'assistant') = ("sender_uid" IS NULL))
  AND ("kind" <> 'call' OR "body" ~ '^https://[^\s]+$')
);--> statement-breakpoint

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
    IF NEW.kind = 'call' AND NOT app_actor_handles_support(NEW.thread_id) THEN
      RAISE EXCEPTION 'Only the project manager looking after this conversation can start a video call.' USING ERRCODE = '42501';
    END IF;
    IF v_thread.status = 'settled' AND NEW.kind IN ('text', 'call') THEN
      RAISE EXCEPTION 'This conversation is settled. Reopen it to write.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
