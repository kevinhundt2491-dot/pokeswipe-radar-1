CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"days" integer DEFAULT 30 NOT NULL,
	"max_redemptions" integer,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" serial PRIMARY KEY,
	"promo_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referral_qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "share_trial_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code" ON "promo_codes" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_unique" ON "promo_redemptions" ("promo_id","user_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_user" ON "promo_redemptions" ("user_id");--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
-- Start-Kampagne für Video-Links (TikTok, Reels, Shorts): ?promo=START30 = 30 Tage Pro, unbegrenzt einlösbar (im Admin abschaltbar)
INSERT INTO "promo_codes" ("code", "label", "days", "max_redemptions", "active", "created_by") VALUES ('START30', 'Video-Kampagne (TikTok, Reels, Shorts)', 30, NULL, true, 'system') ON CONFLICT DO NOTHING;
