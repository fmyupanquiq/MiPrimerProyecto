ALTER TABLE "import_batches" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "acknowledgment_reason" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_acknowledgment_shape" CHECK (("import_batches"."acknowledged_at" IS NOT NULL AND "import_batches"."acknowledged_by" IS NOT NULL
            AND "import_batches"."acknowledgment_reason" IS NOT NULL
            AND length(btrim("import_batches"."acknowledgment_reason")) > 0)
          OR ("import_batches"."acknowledged_at" IS NULL AND "import_batches"."acknowledged_by" IS NULL
            AND "import_batches"."acknowledgment_reason" IS NULL));