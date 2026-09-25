CREATE TYPE "public"."maintenance_status" AS ENUM('COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."maintenance_trigger" AS ENUM('MANUAL', 'SCHEDULED');--> statement-breakpoint
CREATE TABLE "maintenance_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" "maintenance_trigger" NOT NULL,
	"run_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" "maintenance_status" NOT NULL,
	"retention_days" integer NOT NULL,
	"purged" jsonb NOT NULL,
	"error_message" text,
	CONSTRAINT "maintenance_runs_retention_positive" CHECK ("maintenance_runs"."retention_days" > 0),
	CONSTRAINT "maintenance_runs_manual_has_author" CHECK ("maintenance_runs"."trigger" <> 'MANUAL' OR "maintenance_runs"."run_by" IS NOT NULL),
	CONSTRAINT "maintenance_runs_error_only_when_failed" CHECK (("maintenance_runs"."status" = 'FAILED') = ("maintenance_runs"."error_message" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "maintenance_runs" ADD CONSTRAINT "maintenance_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_runs_started_idx" ON "maintenance_runs" USING btree ("started_at");