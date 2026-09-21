CREATE TABLE "invitation_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invitation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitation_acceptances_outcome" CHECK ("invitation_acceptances"."outcome" IN ('ADDED', 'REACTIVATED'))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"single_use" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"restricted_email" text,
	"consumed_at" timestamp with time zone,
	"consumed_by" uuid,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invitations_email_normalized" CHECK ("invitations"."restricted_email" IS NULL OR "invitations"."restricted_email" = lower(btrim("invitations"."restricted_email"))),
	CONSTRAINT "invitations_consumed_consistency" CHECK (("invitations"."consumed_at" IS NULL) = ("invitations"."consumed_by" IS NULL)),
	CONSTRAINT "invitations_consumed_single_use" CHECK ("invitations"."consumed_at" IS NULL OR "invitations"."single_use"),
	CONSTRAINT "invitations_disabled_consistency" CHECK (("invitations"."disabled_at" IS NULL) = ("invitations"."disabled_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invitation_acceptances" ADD CONSTRAINT "invitation_acceptances_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_acceptances" ADD CONSTRAINT "invitation_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_consumed_by_users_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_acceptances_unique" ON "invitation_acceptances" USING btree ("invitation_id","user_id");--> statement-breakpoint
CREATE INDEX "invitation_acceptances_user_idx" ON "invitation_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_project_idx" ON "invitations" USING btree ("project_id","created_at");