CREATE TYPE "public"."permission_scope" AS ENUM('GLOBAL', 'PROJECT');--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"scope" "permission_scope" NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"scope" "permission_scope" NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	CONSTRAINT "roles_system_shape" CHECK (("roles"."is_system" = ("roles"."key" IS NOT NULL)) AND (NOT "roles"."is_system" OR "roles"."project_id" IS NULL)),
	CONSTRAINT "roles_project_scope" CHECK ("roles"."project_id" IS NULL OR "roles"."scope" = 'PROJECT')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "global_role_id" uuid;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_unique" ON "roles" USING btree ("key") WHERE "roles"."key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_project_name_unique" ON "roles" USING btree ("project_id","name") WHERE "roles"."project_id" IS NOT NULL AND "roles"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_global_role_id_roles_id_fk" FOREIGN KEY ("global_role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;