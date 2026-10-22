-- data_exports may also name the Solar lists (docs/solar.md) and the access review (docs/iso/README.md):
-- 0051 let them be downloaded but this list didn't name them, so their downloads were refused.
--
-- Re-runnable.

ALTER TABLE "data_exports" DROP CONSTRAINT IF EXISTS "data_exports_values";--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_values" CHECK (
  "what" IN ('projects', 'people', 'maintenance', 'files', 'invoices', 'site_visits', 'solar', 'solar_report', 'access_review')
  AND "row_count" >= 0
);
