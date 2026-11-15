CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY,
	"room" text DEFAULT 'global' NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_comments" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_likes" (
	"post_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"card_id" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"followee_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" serial PRIMARY KEY,
	"listing_id" integer,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"title" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"price_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"stripe_session_id" text,
	"payment_intent_id" text,
	"charge_id" text,
	"transfer_id" text,
	"refund_id" text,
	"shipping_address" text,
	"carrier" text DEFAULT '' NOT NULL,
	"tracking_number" text DEFAULT '' NOT NULL,
	"dispute_reason" text DEFAULT '' NOT NULL,
	"pay_by" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"release_after" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_log" (
	"id" serial PRIMARY KEY,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"user_id" text,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_push_tokens" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "buy_now" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "shipping_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "condition" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_profile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_wishlist" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_value_tier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "stripe_account_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "seller_terms_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "order_id" integer;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "trade_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_messages_room" ON "chat_messages" ("room","id");--> statement-breakpoint
CREATE INDEX "chat_messages_user" ON "chat_messages" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "community_comments_post" ON "community_comments" ("post_id","id");--> statement-breakpoint
CREATE INDEX "community_comments_user" ON "community_comments" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_likes_post_user" ON "community_likes" ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "community_posts_feed" ON "community_posts" ("status","id");--> statement-breakpoint
CREATE INDEX "community_posts_user" ON "community_posts" ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_pair" ON "follows" ("follower_id","followee_id");--> statement-breakpoint
CREATE INDEX "follows_followee" ON "follows" ("followee_id");--> statement-breakpoint
CREATE INDEX "market_orders_buyer" ON "market_orders" ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "market_orders_seller" ON "market_orders" ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "market_orders_status" ON "market_orders" ("status","release_after");--> statement-breakpoint
CREATE UNIQUE INDEX "market_orders_session" ON "market_orders" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "moderation_log_created" ON "moderation_log" ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_log_user" ON "moderation_log" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_push_tokens_token" ON "native_push_tokens" ("token");--> statement-breakpoint
CREATE INDEX "native_push_tokens_user" ON "native_push_tokens" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_reviewer" ON "reviews" ("order_id","reviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_pair" ON "user_blocks" ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked" ON "user_blocks" ("blocked_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_community_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_post_id_community_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_profiles_user_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_profiles_user_id_fkey" FOREIGN KEY ("followee_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_buyer_id_profiles_user_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_seller_id_profiles_user_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_profiles_user_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_profiles_user_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;