CREATE TYPE "public"."visible_result" AS ENUM('WON', 'LOST', 'VOID', 'PENDING');--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "external_reference" text;--> statement-breakpoint
ALTER TABLE "bet_selections" ADD COLUMN "leg_score" text;--> statement-breakpoint
ALTER TABLE "bet_selections" ADD COLUMN "leg_result" "visible_result";--> statement-breakpoint
ALTER TABLE "bet_selections" ADD COLUMN "condition_status" "visible_result";--> statement-breakpoint
ALTER TABLE "bet_selections" ADD CONSTRAINT "bet_selections_leg_data_on_first_row" CHECK ("bet_selections"."position" = 0 OR ("bet_selections"."leg_score" IS NULL AND "bet_selections"."leg_result" IS NULL));--> statement-breakpoint
ALTER TABLE "bet_selections" ADD CONSTRAINT "bet_selections_leg_score_not_blank" CHECK ("bet_selections"."leg_score" IS NULL OR length(btrim("bet_selections"."leg_score")) > 0);