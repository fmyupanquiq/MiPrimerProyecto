CREATE TYPE "public"."bet_correction_kind" AS ENUM('RETURN_CONFIRMATION', 'SETTLEMENT_CORRECTION', 'REOPEN', 'TRASH_REVERSAL', 'RESTORE_REPOST');--> statement-breakpoint
ALTER TYPE "public"."movement_type" ADD VALUE 'REVERSAL';--> statement-breakpoint
CREATE TABLE "bet_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"bet_id" uuid NOT NULL,
	"kind" "bet_correction_kind" NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_corrections_reason_required" CHECK ("bet_corrections"."kind" = 'RETURN_CONFIRMATION'
          OR ("bet_corrections"."reason" IS NOT NULL AND length(btrim("bet_corrections"."reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "financial_movements" DROP CONSTRAINT "financial_movements_direction_shape";--> statement-breakpoint
ALTER TABLE "financial_movements" DROP CONSTRAINT "financial_movements_reason_required";--> statement-breakpoint
ALTER TABLE "bets" DROP CONSTRAINT "bets_settlement_shape";--> statement-breakpoint
ALTER TABLE "financial_movements" ADD COLUMN "reverses_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD COLUMN "correction_id" uuid;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "calculated_realized_return" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "amount_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_corrections" ADD CONSTRAINT "bet_corrections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_corrections" ADD CONSTRAINT "bet_corrections_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_corrections" ADD CONSTRAINT "bet_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bet_corrections_bet_idx" ON "bet_corrections" USING btree ("bet_id","created_at");--> statement-breakpoint
CREATE INDEX "bet_corrections_project_idx" ON "bet_corrections" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_reverses_movement_id_financial_movements_id_fk" FOREIGN KEY ("reverses_movement_id") REFERENCES "public"."financial_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_correction_id_bet_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."bet_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_movements_one_reversal_per_row" ON "financial_movements" USING btree ("reverses_movement_id") WHERE "financial_movements"."reverses_movement_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "financial_movements_correction_idx" ON "financial_movements" USING btree ("correction_id");--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_reversal_shape" CHECK (("financial_movements"."type" = 'REVERSAL') = ("financial_movements"."reverses_movement_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_direction_shape" CHECK (("financial_movements"."type" IN ('INITIAL_CAPITAL', 'DEPOSIT') AND "financial_movements"."direction" = 'CREDIT')
          OR ("financial_movements"."type" IN ('WITHDRAWAL', 'BET_PLACEMENT') AND "financial_movements"."direction" = 'DEBIT')
          OR ("financial_movements"."type" = 'BET_SETTLEMENT' AND "financial_movements"."direction" = 'CREDIT')
          OR ("financial_movements"."type" IN ('EXTRAORDINARY', 'REVERSAL')
            AND "financial_movements"."direction" IN ('CREDIT', 'DEBIT'))
          OR ("financial_movements"."type" = 'TRANSFER' AND "financial_movements"."direction" IS NULL));--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_reason_required" CHECK ("financial_movements"."type" NOT IN ('WITHDRAWAL', 'EXTRAORDINARY', 'REVERSAL')
          OR ("financial_movements"."reason" IS NOT NULL AND length(btrim("financial_movements"."reason")) > 0));--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_returns_nonneg" CHECK (("bets"."official_realized_return" IS NULL OR "bets"."official_realized_return" >= 0)
          AND ("bets"."calculated_realized_return" IS NULL OR "bets"."calculated_realized_return" >= 0));--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_amount_confirmed_requires_official" CHECK (NOT "bets"."amount_confirmed" OR "bets"."official_amount" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_settlement_shape" CHECK (("bets"."status" = 'PENDING'
            AND "bets"."settled_at" IS NULL
            AND "bets"."official_realized_return" IS NULL
            AND "bets"."calculated_realized_return" IS NULL)
          OR ("bets"."status" = 'LOST'
            AND "bets"."settled_at" IS NOT NULL
            AND "bets"."official_realized_return" IS NULL
            AND "bets"."calculated_realized_return" IS NULL)
          OR ("bets"."status" = 'WON'
            AND "bets"."settled_at" IS NOT NULL
            AND ("bets"."official_realized_return" IS NOT NULL
                 OR "bets"."calculated_realized_return" IS NOT NULL))
          OR ("bets"."status" IN ('VOID', 'CASHOUT')
            AND "bets"."settled_at" IS NOT NULL
            AND "bets"."official_realized_return" IS NOT NULL
            AND "bets"."calculated_realized_return" IS NULL));