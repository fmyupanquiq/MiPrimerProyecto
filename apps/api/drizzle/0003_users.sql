CREATE TYPE "public"."system_role" AS ENUM('USER', 'GLOBAL_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'DELETED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_ref" text,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"system_role" "system_role" DEFAULT 'USER' NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	"deleted_by" uuid,
	CONSTRAINT "users_deleted_consistency" CHECK (("users"."status" = 'DELETED') = ("users"."deleted_at" IS NOT NULL)),
	CONSTRAINT "users_names_not_blank" CHECK (length(btrim("users"."first_name")) > 0 AND length(btrim("users"."last_name")) > 0),
	CONSTRAINT "users_email_format" CHECK ("users"."email" = btrim("users"."email") AND length("users"."email") BETWEEN 3 AND 254)
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;