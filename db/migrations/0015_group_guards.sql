-- Contractor groups decide which projects a contractor or EPC crew can open,
-- so changing them is as sensitive as changing someone's role: only an
-- active project manager may, enforced here as for accounts (0012).
-- The owner connection (migrations, seeds) is exempt.

CREATE OR REPLACE FUNCTION guard_pm_only_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_table_owner(TG_RELID) OR app_actor_is_pm() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Only a project manager can change contractor groups.'
    USING ERRCODE = '42501',
          DETAIL = format('%s on %s by actor %s', TG_OP, TG_TABLE_NAME,
                          COALESCE(app_actor_uid()::text, 'unset'));
END $$;
--> statement-breakpoint

CREATE TRIGGER guard_contractor_groups
  BEFORE INSERT OR UPDATE OR DELETE ON contractor_groups
  FOR EACH ROW EXECUTE FUNCTION guard_pm_only_write();
--> statement-breakpoint

CREATE TRIGGER guard_contractor_group_members
  BEFORE INSERT OR UPDATE OR DELETE ON contractor_group_members
  FOR EACH ROW EXECUTE FUNCTION guard_pm_only_write();
--> statement-breakpoint

-- Only contractor admins and EPC crew belong in contractor groups. A
-- homeowner in one would be able to open other people's projects.
CREATE OR REPLACE FUNCTION check_group_member_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
     WHERE u.uid = NEW.user_id AND u.user_type IN ('contractor', 'epc_team')
  ) THEN
    RAISE EXCEPTION 'Only contractor admins and EPC team members can join a contractor group.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER check_group_member_role
  BEFORE INSERT OR UPDATE ON contractor_group_members
  FOR EACH ROW EXECUTE FUNCTION check_group_member_role();
