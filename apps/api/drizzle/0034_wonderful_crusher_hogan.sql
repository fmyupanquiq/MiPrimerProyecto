ALTER TABLE "stages" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD COLUMN "occurred_at_known" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stages_batch_idx" ON "stages" USING btree ("batch_id") WHERE "stages"."batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "financial_movements_batch_idx" ON "financial_movements" USING btree ("batch_id") WHERE "financial_movements"."batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bets_batch_idx" ON "bets" USING btree ("batch_id") WHERE "bets"."batch_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_unknown_date_only_imported" CHECK ("financial_movements"."occurred_at_known" OR "financial_movements"."batch_id" IS NOT NULL);