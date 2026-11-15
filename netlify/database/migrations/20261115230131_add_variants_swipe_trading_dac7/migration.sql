CREATE TABLE "error_log" (
	"id" serial PRIMARY KEY,
	"scope" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_circuits" (
	"name" text PRIMARY KEY,
	"failures" integer DEFAULT 0 NOT NULL,
	"open_until" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"last_success_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_dac7_stats" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"transactions" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"q1_cents" integer DEFAULT 0 NOT NULL,
	"q2_cents" integer DEFAULT 0 NOT NULL,
	"q3_cents" integer DEFAULT 0 NOT NULL,
	"q4_cents" integer DEFAULT 0 NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"commercial_flag" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_tax_info" (
	"user_id" text PRIMARY KEY,
	"seller_type" text DEFAULT 'individual' NOT NULL,
	"legal_name" text NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'DE' NOT NULL,
	"birth_date" date,
	"tax_id" text NOT NULL,
	"vat_id" text DEFAULT '' NOT NULL,
	"business_reg_no" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipe_likes" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"listing_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"card_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"id" serial PRIMARY KEY,
	"trade_id" integer NOT NULL,
	"side" text NOT NULL,
	"owner_id" text NOT NULL,
	"portfolio_item_id" integer,
	"listing_id" integer,
	"card_id" text,
	"print_id" text,
	"name" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT 'normal' NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"lang" text DEFAULT 'de' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_matches" (
	"id" serial PRIMARY KEY,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"a_wants_listing_id" integer,
	"b_wants_listing_id" integer,
	"b_wants_portfolio_item_id" integer,
	"a_wants_portfolio_item_id" integer,
	"reason" text DEFAULT 'like' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"trade_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "variant_prices" jsonb;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reverse_trend" numeric(10,2);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reverse_avg" numeric(10,2);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reverse_low" numeric(10,2);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reverse_avg7" numeric(10,2);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reverse_avg30" numeric(10,2);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "variant" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "portfolio_item_id" integer;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "stripe_dispute_id" text;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "dispute_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "status_before_dispute" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "transfer_reversal_id" text;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN "variant" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "reverse_trend" numeric(10,2);--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "reverse_avg" numeric(10,2);--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "reverse_low" numeric(10,2);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "flag_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "chargebacks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "match_id" integer;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cash_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cash_payer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "from_value_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "to_value_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "from_carrier" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "from_tracking" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "from_shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "to_carrier" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "to_tracking" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "to_shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "from_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "to_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD COLUMN "variant" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "error_log_created" ON "error_log" ("created_at");--> statement-breakpoint
CREATE INDEX "error_log_scope" ON "error_log" ("scope","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_job" ON "job_runs" ("job","started_at");--> statement-breakpoint
CREATE INDEX "rate_limits_reset" ON "rate_limits" ("reset_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_dac7_user_year" ON "seller_dac7_stats" ("user_id","year");--> statement-breakpoint
CREATE INDEX "seller_dac7_year" ON "seller_dac7_stats" ("year","gross_cents");--> statement-breakpoint
CREATE UNIQUE INDEX "swipe_likes_user_listing" ON "swipe_likes" ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "swipe_likes_owner" ON "swipe_likes" ("owner_id","user_id");--> statement-breakpoint
CREATE INDEX "trade_items_trade" ON "trade_items" ("trade_id","side");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_matches_pair_listing" ON "trade_matches" ("user_a","user_b","a_wants_listing_id","b_wants_listing_id");--> statement-breakpoint
CREATE INDEX "trade_matches_a" ON "trade_matches" ("user_a","status");--> statement-breakpoint
CREATE INDEX "trade_matches_b" ON "trade_matches" ("user_b","status");--> statement-breakpoint
ALTER TABLE "seller_dac7_stats" ADD CONSTRAINT "seller_dac7_stats_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_tax_info" ADD CONSTRAINT "seller_tax_info_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "swipe_likes" ADD CONSTRAINT "swipe_likes_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "swipe_likes" ADD CONSTRAINT "swipe_likes_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "swipe_likes" ADD CONSTRAINT "swipe_likes_owner_id_profiles_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_portfolio_item_id_portfolio_items_id_fkey" FOREIGN KEY ("portfolio_item_id") REFERENCES "portfolio_items"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_user_a_profiles_user_id_fkey" FOREIGN KEY ("user_a") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_user_b_profiles_user_id_fkey" FOREIGN KEY ("user_b") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_a_wants_listing_id_listings_id_fkey" FOREIGN KEY ("a_wants_listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_b_wants_listing_id_listings_id_fkey" FOREIGN KEY ("b_wants_listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_b_wants_portfolio_item_id_portfolio_items_id_fkey" FOREIGN KEY ("b_wants_portfolio_item_id") REFERENCES "portfolio_items"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trade_matches" ADD CONSTRAINT "trade_matches_a_wants_portfolio_item_id_portfolio_items_id_fkey" FOREIGN KEY ("a_wants_portfolio_item_id") REFERENCES "portfolio_items"("id") ON DELETE SET NULL;