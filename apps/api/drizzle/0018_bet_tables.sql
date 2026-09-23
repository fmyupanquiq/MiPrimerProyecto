CREATE TYPE "public"."bet_status" AS ENUM('PENDING', 'WON', 'LOST', 'VOID', 'CASHOUT');--> statement-breakpoint
CREATE TYPE "public"."bet_type" AS ENUM('SIMPLE', 'CREATED', 'MULTIPLE');--> statement-breakpoint
ALTER TYPE "public"."movement_type" ADD VALUE 'BET_PLACEMENT';--> statement-breakpoint
ALTER TYPE "public"."movement_type" ADD VALUE 'BET_SETTLEMENT';--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"bet_type" "bet_type" NOT NULL,
	"stake" numeric(10, 4) NOT NULL,
	"official_amount" numeric(18, 2),
	"visible_total_odds" numeric(12, 6) NOT NULL,
	"official_potential_return" numeric(18, 2),
	"official_realized_return" numeric(18, 2),
	"status" "bet_status" DEFAULT 'PENDING' NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"placed_time_known" boolean DEFAULT true NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_time_known" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	"deleted_by" uuid,
	"purge_eligible_at" timestamp with time zone,
	CONSTRAINT "bets_stake_positive" CHECK ("bets"."stake" > 0),
	CONSTRAINT "bets_official_amount_positive" CHECK ("bets"."official_amount" IS NULL OR "bets"."official_amount" > 0),
	CONSTRAINT "bets_visible_odds_positive" CHECK ("bets"."visible_total_odds" > 0),
	CONSTRAINT "bets_official_potential_return_nonneg" CHECK ("bets"."official_potential_return" IS NULL OR "bets"."official_potential_return" >= 0),
	CONSTRAINT "bets_settlement_shape" CHECK (("bets"."status" = 'PENDING'
            AND "bets"."settled_at" IS NULL AND "bets"."official_realized_return" IS NULL)
          OR ("bets"."status" = 'LOST'
            AND "bets"."settled_at" IS NOT NULL AND "bets"."official_realized_return" IS NULL)
          OR ("bets"."status" IN ('WON', 'VOID', 'CASHOUT')
            AND "bets"."settled_at" IS NOT NULL
            AND "bets"."official_realized_return" IS NOT NULL
            AND "bets"."official_realized_return" >= 0)),
	CONSTRAINT "bets_trash_consistency" CHECK (("bets"."deleted_at" IS NOT NULL) = ("bets"."purge_eligible_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "bet_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bet_id" uuid NOT NULL,
	"event_group" integer NOT NULL,
	"position" integer NOT NULL,
	"sport" text,
	"event" text NOT NULL,
	"market" text,
	"selection" text NOT NULL,
	"visible_odds" numeric(12, 6) NOT NULL,
	CONSTRAINT "bet_selections_event_group_nonneg" CHECK ("bet_selections"."event_group" >= 0),
	CONSTRAINT "bet_selections_position_nonneg" CHECK ("bet_selections"."position" >= 0),
	CONSTRAINT "bet_selections_event_not_blank" CHECK (length(btrim("bet_selections"."event")) > 0),
	CONSTRAINT "bet_selections_selection_not_blank" CHECK (length(btrim("bet_selections"."selection")) > 0),
	CONSTRAINT "bet_selections_odds_positive" CHECK ("bet_selections"."visible_odds" > 0)
);
--> statement-breakpoint
ALTER TABLE "financial_movements" DROP CONSTRAINT "financial_movements_direction_shape";--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_selections" ADD CONSTRAINT "bet_selections_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_project_idx" ON "bets" USING btree ("project_id","placed_at");--> statement-breakpoint
CREATE INDEX "bets_stage_idx" ON "bets" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "bets_house_idx" ON "bets" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "bets_created_by_idx" ON "bets" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "bet_selections_bet_idx" ON "bet_selections" USING btree ("bet_id","event_group","position");--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_direction_shape" CHECK (("financial_movements"."type" IN ('INITIAL_CAPITAL', 'DEPOSIT') AND "financial_movements"."direction" = 'CREDIT')
          OR ("financial_movements"."type" IN ('WITHDRAWAL', 'BET_PLACEMENT') AND "financial_movements"."direction" = 'DEBIT')
          OR ("financial_movements"."type" = 'BET_SETTLEMENT' AND "financial_movements"."direction" = 'CREDIT')
          OR ("financial_movements"."type" = 'EXTRAORDINARY' AND "financial_movements"."direction" IN ('CREDIT', 'DEBIT'))
          OR ("financial_movements"."type" = 'TRANSFER' AND "financial_movements"."direction" IS NULL));