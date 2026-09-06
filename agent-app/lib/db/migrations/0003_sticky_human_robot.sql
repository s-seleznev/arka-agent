-- Existing JSONB rows are v1 and migrate lazily on their first authenticated read.
-- New rows use v2 immediately; separating the backfill value from the final
-- default prevents legacy JSON from being misclassified as v2.
ALTER TABLE "ReportView" ADD COLUMN "schemaVersion" integer DEFAULT 1 NOT NULL;
ALTER TABLE "ReportView" ALTER COLUMN "schemaVersion" SET DEFAULT 2;
