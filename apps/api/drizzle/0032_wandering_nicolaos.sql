CREATE TYPE "public"."import_batch_status" AS ENUM('UPLOADED', 'VALIDATED', 'IMPORTED', 'ANNULLED');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('VALID', 'TEMPLATE', 'EMPTY', 'PARTIAL', 'INVALID');--> statement-breakpoint
CREATE TYPE "public"."import_traffic_light" AS ENUM('GREEN', 'YELLOW', 'RED');--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"house_id" uuid,
	"status" "import_batch_status" DEFAULT 'UPLOADED' NOT NULL,
	"original_name" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_size_bytes" integer NOT NULL,
	"source_file" "bytea" NOT NULL,
	"is_rehearsal" boolean DEFAULT false NOT NULL,
	"stage_plan" jsonb,
	"report" jsonb,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_valid" integer DEFAULT 0 NOT NULL,
	"rows_template" integer DEFAULT 0 NOT NULL,
	"rows_empty" integer DEFAULT 0 NOT NULL,
	"rows_partial" integer DEFAULT 0 NOT NULL,
	"rows_invalid" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"imported_at" timestamp with time zone,
	"imported_by" uuid,
	"import_reason" text,
	"annulled_at" timestamp with time zone,
	"annulled_by" uuid,
	"annulment_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_batches_name_not_blank" CHECK (length(btrim("import_batches"."original_name")) > 0),
	CONSTRAINT "import_batches_sha256_format" CHECK ("import_batches"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_sha256_matches_file" CHECK (encode(sha256("import_batches"."source_file"), 'hex') = "import_batches"."source_sha256"),
	CONSTRAINT "import_batches_size_matches_file" CHECK ("import_batches"."source_size_bytes" = octet_length("import_batches"."source_file")),
	CONSTRAINT "import_batches_size_limit" CHECK ("source_size_bytes" > 0 AND "source_size_bytes" <= 10485760),
	CONSTRAINT "import_batches_counters_non_negative" CHECK ("import_batches"."rows_total" >= 0 AND "import_batches"."rows_valid" >= 0 AND "import_batches"."rows_template" >= 0
          AND "import_batches"."rows_empty" >= 0 AND "import_batches"."rows_partial" >= 0 AND "import_batches"."rows_invalid" >= 0),
	CONSTRAINT "import_batches_house_required" CHECK ("import_batches"."status" = 'UPLOADED' OR "import_batches"."house_id" IS NOT NULL),
	CONSTRAINT "import_batches_validated_shape" CHECK ("import_batches"."status" = 'UPLOADED'
          OR ("import_batches"."validated_at" IS NOT NULL AND "import_batches"."validated_by" IS NOT NULL)),
	CONSTRAINT "import_batches_imported_shape" CHECK ("import_batches"."status" NOT IN ('IMPORTED', 'ANNULLED')
          OR ("import_batches"."imported_at" IS NOT NULL AND "import_batches"."imported_by" IS NOT NULL
              AND "import_batches"."import_reason" IS NOT NULL AND length(btrim("import_batches"."import_reason")) > 0
              AND "import_batches"."report" IS NOT NULL)),
	CONSTRAINT "import_batches_not_imported_shape" CHECK ("import_batches"."status" IN ('IMPORTED', 'ANNULLED')
          OR ("import_batches"."imported_at" IS NULL AND "import_batches"."imported_by" IS NULL
              AND "import_batches"."import_reason" IS NULL)),
	CONSTRAINT "import_batches_annulled_shape" CHECK (("import_batches"."status" = 'ANNULLED'
            AND "import_batches"."annulled_at" IS NOT NULL AND "import_batches"."annulled_by" IS NOT NULL
            AND "import_batches"."annulment_reason" IS NOT NULL
            AND length(btrim("import_batches"."annulment_reason")) > 0)
          OR ("import_batches"."status" <> 'ANNULLED'
            AND "import_batches"."annulled_at" IS NULL AND "import_batches"."annulled_by" IS NULL
            AND "import_batches"."annulment_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_values" jsonb NOT NULL,
	"normalized" jsonb,
	"status" "import_row_status" NOT NULL,
	"traffic_light" "import_traffic_light",
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_bet_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_row_number_positive" CHECK ("import_rows"."row_number" > 0),
	CONSTRAINT "import_rows_findings_is_array" CHECK (jsonb_typeof("import_rows"."findings") = 'array'),
	CONSTRAINT "import_rows_created_bet_only_valid" CHECK ("import_rows"."created_bet_id" IS NULL OR "import_rows"."status" = 'VALID')
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_annulled_by_users_id_fk" FOREIGN KEY ("annulled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_bet_id_bets_id_fk" FOREIGN KEY ("created_bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_project_idx" ON "import_batches" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_one_import_per_file" ON "import_batches" USING btree ("project_id","house_id","source_sha256") WHERE "import_batches"."status" = 'IMPORTED';--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_unique" ON "import_rows" USING btree ("import_batch_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_created_bet_unique" ON "import_rows" USING btree ("created_bet_id") WHERE "import_rows"."created_bet_id" IS NOT NULL;