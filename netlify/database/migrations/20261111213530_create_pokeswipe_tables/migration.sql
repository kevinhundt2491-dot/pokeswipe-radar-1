CREATE TABLE "cards" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"trend" numeric(10,2),
	"avg" numeric(10,2),
	"low" numeric(10,2),
	"avg7" numeric(10,2),
	"avg30" numeric(10,2),
	"price_updated_at" timestamp with time zone,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "free_boost_usage" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"listing_id" integer NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"card_id" text,
	"card_name" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"price" numeric(10,2) NOT NULL,
	"want" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"boosted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"stripe_session_id" text NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"listing_id" integer,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_items" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"card_id" text,
	"name" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"purchase_price" numeric(10,2),
	"manual_value" numeric(10,2),
	"condition" text DEFAULT 'NM' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"value" numeric(12,2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"target_price" numeric(10,2) NOT NULL,
	"direction" text DEFAULT 'below' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY,
	"card_id" text NOT NULL,
	"day" date NOT NULL,
	"trend" numeric(10,2),
	"avg" numeric(10,2),
	"low" numeric(10,2)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"plan_until" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan_checked_at" timestamp with time zone,
	"banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"reporter_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY,
	"trade_id" integer NOT NULL,
	"reviewer_id" text NOT NULL,
	"reviewee_id" text NOT NULL,
	"stars" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_messages" (
	"id" serial PRIMARY KEY,
	"trade_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY,
	"listing_id" integer,
	"from_user" text NOT NULL,
	"to_user" text NOT NULL,
	"offer" text NOT NULL,
	"request" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"from_confirmed" boolean DEFAULT false NOT NULL,
	"to_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "free_boost_user_month" ON "free_boost_usage" ("user_id","month");--> statement-breakpoint
CREATE INDEX "listings_status" ON "listings" ("status","created_at");--> statement-breakpoint
CREATE INDEX "listings_user" ON "listings" ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "portfolio_user" ON "portfolio_items" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshot_user_day" ON "portfolio_snapshots" ("user_id","day");--> statement-breakpoint
CREATE INDEX "alerts_user" ON "price_alerts" ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_card" ON "price_alerts" ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_card_day" ON "price_history" ("card_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_display_name_lower" ON "profiles" ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_trade_reviewer" ON "reviews" ("trade_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewee" ON "reviews" ("reviewee_id");--> statement-breakpoint
CREATE INDEX "trade_messages_trade" ON "trade_messages" ("trade_id","id");--> statement-breakpoint
CREATE INDEX "trades_from" ON "trades" ("from_user");--> statement-breakpoint
CREATE INDEX "trades_to" ON "trades" ("to_user");--> statement-breakpoint
ALTER TABLE "free_boost_usage" ADD CONSTRAINT "free_boost_usage_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_profiles_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_trade_id_trades_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_profiles_user_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_id_profiles_user_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_messages" ADD CONSTRAINT "trade_messages_trade_id_trades_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_messages" ADD CONSTRAINT "trade_messages_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_from_user_profiles_user_id_fkey" FOREIGN KEY ("from_user") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_to_user_profiles_user_id_fkey" FOREIGN KEY ("to_user") REFERENCES "profiles"("user_id") ON DELETE CASCADE;