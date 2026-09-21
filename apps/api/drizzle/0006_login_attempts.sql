CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_normalized" text NOT NULL,
	"ip" text,
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email_normalized","attempted_at");