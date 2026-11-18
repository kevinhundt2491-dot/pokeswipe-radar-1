ALTER TABLE "profiles" ADD COLUMN "avatar_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "ui_prefs" jsonb DEFAULT '{}' NOT NULL;