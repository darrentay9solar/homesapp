-- My Files: everyone can see what they've uploaded, including files later
-- removed from a project (the stored copy is kept; a PM can restore them).
--
-- The audit log is otherwise readable by project managers only. This adds
-- one narrow exception: the removal entries of your own uploads, so My Files
-- can say when a file was removed and by whom. Nothing else about the log
-- becomes visible. Policies are permissive, so this is OR-ed with the PM rule.
-- Re-runnable.
DROP POLICY IF EXISTS audit_log_own_removed_files ON audit_log;
--> statement-breakpoint
CREATE POLICY audit_log_own_removed_files ON audit_log
  FOR SELECT
  USING (
    entity_table = 'project_files'
    AND action = 'delete'
    AND (changes -> 'uploaded_by' ->> 'from') = NULLIF(current_setting('app.actor_uid', true), '')
  );
