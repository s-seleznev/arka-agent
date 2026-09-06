CREATE TABLE "UploadedFile" (
	"contentType" varchar(255) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"extractedText" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pathname" text NOT NULL,
	"size" integer NOT NULL,
	"textStatus" varchar DEFAULT 'unsupported' NOT NULL,
	"userId" uuid NOT NULL,
	CONSTRAINT "UploadedFile_pathname_unique" UNIQUE("pathname")
);
--> statement-breakpoint
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
