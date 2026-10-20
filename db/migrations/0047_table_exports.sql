-- Every list can be downloaded to Excel as its table shows it, filtered and
-- sorted (POST /export/table.xlsx). Each download is still recorded in
-- data_exports; these are the lists it may name.
--
-- Re-runnable.

ALTER TABLE "data_exports" DROP CONSTRAINT IF EXISTS "data_exports_values";--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_values" CHECK (
  "what" IN ('projects', 'people', 'maintenance', 'files', 'invoices', 'site_visits')
  AND "row_count" >= 0
);
