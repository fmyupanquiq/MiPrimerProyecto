CREATE TYPE "public"."ticket_mime_type" AS ENUM('image/jpeg', 'image/png', 'application/pdf');--> statement-breakpoint
CREATE TYPE "public"."ticket_analysis_status" AS ENUM('COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"bet_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" "ticket_mime_type" NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_size_positive" CHECK ("tickets"."size_bytes" > 0),
	CONSTRAINT "tickets_size_within_limit" CHECK ("tickets"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "ticket_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"analyzed_by" uuid NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "ticket_analysis_status" NOT NULL,
	"error_message" text,
	"extraction" jsonb,
	"confidence_by_field" jsonb
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_analyses" ADD CONSTRAINT "ticket_analyses_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_analyses" ADD CONSTRAINT "ticket_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_analyses" ADD CONSTRAINT "ticket_analyses_analyzed_by_users_id_fk" FOREIGN KEY ("analyzed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_project_idx" ON "tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tickets_bet_idx" ON "tickets" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "tickets_uploaded_by_idx" ON "tickets" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "ticket_analyses_ticket_idx" ON "ticket_analyses" USING btree ("ticket_id","analyzed_at");--> statement-breakpoint
CREATE INDEX "ticket_analyses_project_idx" ON "ticket_analyses" USING btree ("project_id","analyzed_at");