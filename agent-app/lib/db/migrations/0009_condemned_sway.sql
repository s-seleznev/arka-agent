CREATE TABLE "RuleBinding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ruleId" uuid NOT NULL,
	"farmId" uuid NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"provenance" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RuleDefinition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"snapshotId" uuid NOT NULL,
	"sourceCompanyId" text NOT NULL,
	"sourceListId" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"normalized" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RuleSourceSnapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"parserVersion" text NOT NULL,
	"rowCount" integer NOT NULL,
	"importedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ReportView" ALTER COLUMN "schemaVersion" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "ReportView" ADD COLUMN "ruleContext" jsonb;--> statement-breakpoint
ALTER TABLE "RuleBinding" ADD CONSTRAINT "RuleBinding_ruleId_RuleDefinition_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."RuleDefinition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RuleDefinition" ADD CONSTRAINT "RuleDefinition_snapshotId_RuleSourceSnapshot_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."RuleSourceSnapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "RuleBinding_version_uq" ON "RuleBinding" USING btree ("ruleId","farmId","version");--> statement-breakpoint
CREATE INDEX "RuleBinding_farm_idx" ON "RuleBinding" USING btree ("farmId","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "RuleDefinition_source_key_uq" ON "RuleDefinition" USING btree ("snapshotId","sourceCompanyId","sourceListId");--> statement-breakpoint
CREATE INDEX "RuleDefinition_name_idx" ON "RuleDefinition" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "RuleSourceSnapshot_source_version_uq" ON "RuleSourceSnapshot" USING btree ("sha256","parserVersion");