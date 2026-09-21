ALTER TABLE "users" ALTER COLUMN "global_role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "system_role";--> statement-breakpoint
DROP TYPE "public"."system_role";