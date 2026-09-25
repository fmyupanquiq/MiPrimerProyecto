CREATE TYPE "public"."account_deletion_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "account_deletion_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "account_deletion_requests_status_shape" CHECK (("account_deletion_requests"."status" = 'PENDING' AND "account_deletion_requests"."decided_by" IS NULL AND "account_deletion_requests"."decided_at" IS NULL)
          OR ("account_deletion_requests"."status" <> 'PENDING' AND "account_deletion_requests"."decided_by" IS NOT NULL AND "account_deletion_requests"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "account_deletion_requests_user_idx" ON "account_deletion_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_one_pending" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" = 'PENDING';