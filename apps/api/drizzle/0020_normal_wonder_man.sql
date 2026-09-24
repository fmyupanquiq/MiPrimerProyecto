CREATE TYPE "public"."reconciliation_status" AS ENUM('MATCHED', 'DISCREPANCY', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."integrity_check_status" AS ENUM('OK', 'ISSUES_FOUND');--> statement-breakpoint
CREATE TABLE "reconciliation_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"letfer_available" numeric(18, 2) NOT NULL,
	"official_available" numeric(18, 2) NOT NULL,
	"committed" numeric(18, 2) NOT NULL,
	"difference" numeric(18, 2) NOT NULL,
	"status" "reconciliation_status" NOT NULL,
	"performed_by" uuid NOT NULL,
	"note" text,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_checkpoints_letfer_available_nonneg" CHECK ("reconciliation_checkpoints"."letfer_available" >= 0),
	CONSTRAINT "reconciliation_checkpoints_official_available_nonneg" CHECK ("reconciliation_checkpoints"."official_available" >= 0),
	CONSTRAINT "reconciliation_checkpoints_committed_nonneg" CHECK ("reconciliation_checkpoints"."committed" >= 0),
	CONSTRAINT "reconciliation_checkpoints_invalidation_shape" CHECK (("reconciliation_checkpoints"."status" = 'INVALIDATED') = ("reconciliation_checkpoints"."invalidated_at" IS NOT NULL)
          AND ("reconciliation_checkpoints"."status" = 'INVALIDATED') = ("reconciliation_checkpoints"."invalidated_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "integrity_check_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"run_by" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" "integrity_check_status" NOT NULL,
	"findings" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_check_runs" ADD CONSTRAINT "integrity_check_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_check_runs" ADD CONSTRAINT "integrity_check_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_house_idx" ON "reconciliation_checkpoints" USING btree ("house_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_project_idx" ON "reconciliation_checkpoints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integrity_check_runs_project_idx" ON "integrity_check_runs" USING btree ("project_id","started_at");