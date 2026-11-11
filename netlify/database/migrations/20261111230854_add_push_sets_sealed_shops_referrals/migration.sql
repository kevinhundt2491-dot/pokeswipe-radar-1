CREATE TABLE "affiliate_clicks" (
	"id" serial PRIMARY KEY,
	"partner" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_scans" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_alerts" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"target_price" numeric(10,2) NOT NULL,
	"direction" text DEFAULT 'below' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_price_history" (
	"id" serial PRIMARY KEY,
	"product_id" integer NOT NULL,
	"day" date NOT NULL,
	"ref_price" numeric(10,2),
	"community_avg" numeric(10,2),
	"listing_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_products" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'display' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"ref_price" numeric(10,2),
	"ref_updated_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_sets" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"set_id" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "sealed_product_id" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_slug" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referral_rewarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "used_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bonus_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "affiliate_clicks_partner" ON "affiliate_clicks" ("partner","created_at");--> statement-breakpoint
CREATE INDEX "card_scans_user" ON "card_scans" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_shop_slug" ON "profiles" ("shop_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_referral_code" ON "profiles" ("referral_code");--> statement-breakpoint
CREATE INDEX "push_user" ON "push_subscriptions" ("user_id");--> statement-breakpoint
CREATE INDEX "sealed_alerts_user" ON "sealed_alerts" ("user_id");--> statement-breakpoint
CREATE INDEX "sealed_alerts_product" ON "sealed_alerts" ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_history_product_day" ON "sealed_price_history" ("product_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_sets_user_set" ON "tracked_sets" ("user_id","set_id");--> statement-breakpoint
ALTER TABLE "card_scans" ADD CONSTRAINT "card_scans_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sealed_alerts" ADD CONSTRAINT "sealed_alerts_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sealed_alerts" ADD CONSTRAINT "sealed_alerts_product_id_sealed_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "sealed_products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sealed_price_history" ADD CONSTRAINT "sealed_price_history_product_id_sealed_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "sealed_products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tracked_sets" ADD CONSTRAINT "tracked_sets_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;