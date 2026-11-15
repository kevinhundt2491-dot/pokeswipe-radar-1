CREATE TABLE "community_deal_votes" (
	"deal_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"vote" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_deals" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"price" numeric(10,2) NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"shop" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'singles' NOT NULL,
	"lang" text DEFAULT 'de' NOT NULL,
	"card_id" text,
	"market_price" numeric(10,2),
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"up" integer DEFAULT 0 NOT NULL,
	"down" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_pins" (
	"user_id" text PRIMARY KEY,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"cards" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipe_preferences" (
	"user_id" text PRIMARY KEY,
	"scores" jsonb DEFAULT '{}' NOT NULL,
	"swipes" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lang" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_banner" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_logo" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shop_accent" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "community_deal_votes_pair" ON "community_deal_votes" ("deal_id","user_id");--> statement-breakpoint
CREATE INDEX "community_deals_feed" ON "community_deals" ("status","id");--> statement-breakpoint
CREATE INDEX "community_deals_user" ON "community_deals" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "radar_pins_updated" ON "radar_pins" ("status","updated_at");--> statement-breakpoint
ALTER TABLE "community_deal_votes" ADD CONSTRAINT "community_deal_votes_deal_id_community_deals_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "community_deals"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_deal_votes" ADD CONSTRAINT "community_deal_votes_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_deals" ADD CONSTRAINT "community_deals_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "radar_pins" ADD CONSTRAINT "radar_pins_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "swipe_preferences" ADD CONSTRAINT "swipe_preferences_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;