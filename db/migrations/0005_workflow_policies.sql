-- Audit triggers for the new tables, and row level security for notifications.

-- Assignment and membership changes are exactly what a project manager needs
-- to reconstruct: who gave whom access to what, and when.
CREATE TRIGGER audit_contractor_groups
  AFTER INSERT OR UPDATE OR DELETE ON contractor_groups
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('group_id');
--> statement-breakpoint
CREATE TRIGGER audit_contractor_group_members
  AFTER INSERT OR UPDATE OR DELETE ON contractor_group_members
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('group_id');
--> statement-breakpoint
CREATE TRIGGER audit_project_assignments
  AFTER INSERT OR UPDATE OR DELETE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('project_id');
--> statement-breakpoint
CREATE TRIGGER audit_site_visits
  AFTER INSERT OR UPDATE OR DELETE ON site_visits
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('visit_id');
--> statement-breakpoint
CREATE TRIGGER audit_site_check_ins
  AFTER INSERT OR UPDATE OR DELETE ON site_check_ins
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('check_in_id');
--> statement-breakpoint
CREATE TRIGGER audit_project_milestones
  AFTER INSERT OR UPDATE OR DELETE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('project_id');
--> statement-breakpoint

-- Deliberately NOT audited: notifications and notification_deliveries. They
-- are system-generated in volume and record nothing about who did what, so
-- auditing them would bury the entries that matter.

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Each person reads only their own, by the same mechanism the audit log uses.
CREATE POLICY notifications_own_read ON notifications
  FOR SELECT
  USING (recipient_uid = NULLIF(current_setting('app.actor_uid', true), '')::integer);
--> statement-breakpoint

-- Marking it read is the only change a recipient may make to their own row.
CREATE POLICY notifications_own_update ON notifications
  FOR UPDATE
  USING (recipient_uid = NULLIF(current_setting('app.actor_uid', true), '')::integer)
  WITH CHECK (recipient_uid = NULLIF(current_setting('app.actor_uid', true), '')::integer);
--> statement-breakpoint

-- Sending to someone else is ordinary, so inserts are not limited to the actor.
CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Delivery rows follow their notification: visible only if it is.
CREATE POLICY notification_deliveries_own ON notification_deliveries
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM notifications n
     WHERE n.notification_id = notification_deliveries.notification_id
       AND n.recipient_uid = NULLIF(current_setting('app.actor_uid', true), '')::integer
  ));
--> statement-breakpoint
CREATE POLICY notification_deliveries_insert ON notification_deliveries
  FOR INSERT WITH CHECK (true);
--> statement-breakpoint

-- The sender moves a delivery from queued to sent or failed.
CREATE POLICY notification_deliveries_update ON notification_deliveries
  FOR UPDATE USING (true) WITH CHECK (true);
--> statement-breakpoint

-- A revert points at the entry it undoes. Added after the fact so the
-- self-reference does not complicate the table's own creation.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_reverts_fk
  FOREIGN KEY (reverts_audit_id) REFERENCES audit_log(audit_id) ON DELETE SET NULL;
