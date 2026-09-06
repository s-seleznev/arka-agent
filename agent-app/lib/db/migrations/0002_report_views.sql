CREATE TABLE "ReportView" (
	"chatId" uuid NOT NULL,
	"columns" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"entityType" varchar DEFAULT 'animal' NOT NULL,
	"farmId" uuid NOT NULL,
	"filters" jsonb NOT NULL,
	"groupBy" jsonb NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"sort" jsonb NOT NULL,
	"title" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ReportView" ADD CONSTRAINT "ReportView_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;