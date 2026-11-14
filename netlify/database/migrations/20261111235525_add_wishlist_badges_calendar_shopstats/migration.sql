CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY,
	"kind" text DEFAULT 'event' NOT NULL,
	"title" text NOT NULL,
	"day" date NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'active' NOT NULL,
	"reminders_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_reminders" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_stats" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"listing_views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"badge" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"max_price" numeric(10,2),
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_interval" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "best_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_checkin" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "leaderboard_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weekly_report" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_weekly_report" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "calendar_events_day" ON "calendar_events" ("status","day");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_reminders_user_event" ON "calendar_reminders" ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "calendar_reminders_event" ON "calendar_reminders" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_stats_user_day" ON "shop_stats" ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "user_badges_user_badge" ON "user_badges" ("user_id","badge");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_user_card" ON "wishlist_items" ("user_id","card_id");--> statement-breakpoint
CREATE INDEX "wishlist_card" ON "wishlist_items" ("card_id");--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_profiles_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("user_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_event_id_calendar_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_stats" ADD CONSTRAINT "shop_stats_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");