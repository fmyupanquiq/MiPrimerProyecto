CREATE TABLE "bet_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"ticket_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text
);
--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "bet_drafts" ADD CONSTRAINT "bet_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_drafts" ADD CONSTRAINT "bet_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_drafts" ADD CONSTRAINT "bet_drafts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bet_drafts_owner_idx" ON "bet_drafts" USING btree ("project_id","created_by","updated_at") WHERE "bet_drafts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bets_client_request_unique" ON "bets" USING btree ("project_id","created_by","client_request_id") WHERE "bets"."client_request_id" IS NOT NULL;
--> statement-breakpoint
-- `updated_at` lo mantiene `set_updated_at` (0000_base_functions.sql), como en el resto de tablas.
CREATE TRIGGER bet_drafts_set_updated_at BEFORE UPDATE ON bet_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
