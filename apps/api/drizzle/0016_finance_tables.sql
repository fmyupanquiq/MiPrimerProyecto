CREATE TYPE "public"."stage_status" AS ENUM('ACTIVE', 'CLOSED', 'TRASHED');--> statement-breakpoint
CREATE TYPE "public"."house_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."movement_direction" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('INITIAL_CAPITAL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'EXTRAORDINARY');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_stake" numeric(18, 2) NOT NULL,
	"status" "stage_status" DEFAULT 'ACTIVE' NOT NULL,
	"purge_eligible_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	"deleted_by" uuid,
	CONSTRAINT "stages_name_not_blank" CHECK (length(btrim("stages"."name")) > 0),
	CONSTRAINT "stages_unit_stake_positive" CHECK ("stages"."unit_stake" > 0),
	CONSTRAINT "stages_trash_consistency" CHECK (("stages"."status" = 'TRASHED') = ("stages"."deleted_at" IS NOT NULL)
        AND ("stages"."status" = 'TRASHED') = ("stages"."purge_eligible_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "house_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "houses_name_not_blank" CHECK (length(btrim("houses"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"direction" "movement_direction",
	"house_id" uuid,
	"from_house_id" uuid,
	"to_house_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "financial_movements_amount_positive" CHECK ("financial_movements"."amount" > 0),
	CONSTRAINT "financial_movements_house_shape" CHECK (("financial_movements"."type" = 'TRANSFER'
            AND "financial_movements"."house_id" IS NULL
            AND "financial_movements"."from_house_id" IS NOT NULL
            AND "financial_movements"."to_house_id" IS NOT NULL
            AND "financial_movements"."from_house_id" <> "financial_movements"."to_house_id")
          OR ("financial_movements"."type" <> 'TRANSFER'
            AND "financial_movements"."house_id" IS NOT NULL
            AND "financial_movements"."from_house_id" IS NULL
            AND "financial_movements"."to_house_id" IS NULL)),
	CONSTRAINT "financial_movements_direction_shape" CHECK (("financial_movements"."type" IN ('INITIAL_CAPITAL', 'DEPOSIT') AND "financial_movements"."direction" = 'CREDIT')
          OR ("financial_movements"."type" = 'WITHDRAWAL' AND "financial_movements"."direction" = 'DEBIT')
          OR ("financial_movements"."type" = 'EXTRAORDINARY' AND "financial_movements"."direction" IN ('CREDIT', 'DEBIT'))
          OR ("financial_movements"."type" = 'TRANSFER' AND "financial_movements"."direction" IS NULL)),
	CONSTRAINT "financial_movements_reason_required" CHECK ("financial_movements"."type" NOT IN ('WITHDRAWAL', 'EXTRAORDINARY')
          OR ("financial_movements"."reason" IS NOT NULL AND length(btrim("financial_movements"."reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "withdrawal_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "withdrawal_requests_amount_positive" CHECK ("withdrawal_requests"."amount" > 0),
	CONSTRAINT "withdrawal_requests_reason_not_blank" CHECK (length(btrim("withdrawal_requests"."reason")) > 0),
	CONSTRAINT "withdrawal_requests_status_shape" CHECK (("withdrawal_requests"."status" = 'PENDING'
            AND "withdrawal_requests"."decided_by" IS NULL AND "withdrawal_requests"."decided_at" IS NULL AND "withdrawal_requests"."movement_id" IS NULL)
          OR ("withdrawal_requests"."status" = 'APPROVED'
            AND "withdrawal_requests"."decided_by" IS NOT NULL AND "withdrawal_requests"."decided_at" IS NOT NULL AND "withdrawal_requests"."movement_id" IS NOT NULL)
          OR ("withdrawal_requests"."status" IN ('REJECTED', 'CANCELLED')
            AND "withdrawal_requests"."decided_by" IS NOT NULL AND "withdrawal_requests"."decided_at" IS NOT NULL AND "withdrawal_requests"."movement_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "houses" ADD CONSTRAINT "houses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_from_house_id_houses_id_fk" FOREIGN KEY ("from_house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_to_house_id_houses_id_fk" FOREIGN KEY ("to_house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movements" ADD CONSTRAINT "financial_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_movement_id_financial_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."financial_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stages_project_idx" ON "stages" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_project_active_unique" ON "stages" USING btree ("project_id") WHERE "stages"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "houses_project_idx" ON "houses" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "financial_movements_project_idx" ON "financial_movements" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "financial_movements_stage_idx" ON "financial_movements" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "financial_movements_house_idx" ON "financial_movements" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "financial_movements_from_house_idx" ON "financial_movements" USING btree ("from_house_id");--> statement-breakpoint
CREATE INDEX "financial_movements_to_house_idx" ON "financial_movements" USING btree ("to_house_id");--> statement-breakpoint
CREATE INDEX "financial_movements_operation_idx" ON "financial_movements" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_project_idx" ON "withdrawal_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_house_idx" ON "withdrawal_requests" USING btree ("house_id","status");