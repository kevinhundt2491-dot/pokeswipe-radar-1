ALTER TABLE "profiles" ADD COLUMN "card_uploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referral_signups" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "founder_at" timestamp with time zone;