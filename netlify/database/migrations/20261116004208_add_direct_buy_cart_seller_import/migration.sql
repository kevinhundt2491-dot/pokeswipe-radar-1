CREATE TABLE "cart_items" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"listing_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_cents_at_add" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY,
	"market_order_id" integer NOT NULL,
	"checkout_id" integer NOT NULL,
	"listing_id" integer,
	"card_id" text,
	"title" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT 'normal' NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"lang" text DEFAULT 'de' NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY,
	"buyer_id" text NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"items_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"seller_count" integer DEFAULT 1 NOT NULL,
	"stripe_session_id" text,
	"payment_intent_id" text,
	"charge_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_import_rows" (
	"id" serial PRIMARY KEY,
	"import_id" integer NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"status" text NOT NULL,
	"listing_id" integer,
	"candidates" jsonb,
	"message" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_imports" (
	"id" serial PRIMARY KEY,
	"seller_id" text NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'generic' NOT NULL,
	"blob_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"options" jsonb DEFAULT '{}' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"review_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_payouts" (
	"id" serial PRIMARY KEY,
	"market_order_id" integer NOT NULL,
	"seller_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"stripe_transfer_id" text NOT NULL,
	"reversal_id" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cancellations" ADD COLUMN "confirm_token_hash" text;--> statement-breakpoint
ALTER TABLE "cancellations" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "external_sku" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "print_id" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "checkout_id" integer;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "item_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "seller_type" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "withdrawal_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "withdrawal_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "return_tracking" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "seller_type" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_vat_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_register" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "business_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "listing_limit_override" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_listing" ON "cart_items" ("user_id","listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_user_sku" ON "listings" ("user_id","external_sku");--> statement-breakpoint
CREATE INDEX "listings_card_buy" ON "listings" ("card_id","status","buy_now");--> statement-breakpoint
CREATE INDEX "market_orders_checkout" ON "market_orders" ("checkout_id");--> statement-breakpoint
CREATE INDEX "order_items_order" ON "order_items" ("market_order_id");--> statement-breakpoint
CREATE INDEX "order_items_checkout" ON "order_items" ("checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_session" ON "orders" ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "orders_buyer" ON "orders" ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status" ON "orders" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "seller_import_rows_import" ON "seller_import_rows" ("import_id","status");--> statement-breakpoint
CREATE INDEX "seller_imports_seller" ON "seller_imports" ("seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_payouts_transfer" ON "seller_payouts" ("stripe_transfer_id");--> statement-breakpoint
CREATE INDEX "seller_payouts_seller" ON "seller_payouts" ("seller_id","created_at");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_market_order_id_market_orders_id_fkey" FOREIGN KEY ("market_order_id") REFERENCES "market_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_checkout_id_orders_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_listings_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_profiles_user_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_import_rows" ADD CONSTRAINT "seller_import_rows_import_id_seller_imports_id_fkey" FOREIGN KEY ("import_id") REFERENCES "seller_imports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_imports" ADD CONSTRAINT "seller_imports_seller_id_profiles_user_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_payouts" ADD CONSTRAINT "seller_payouts_market_order_id_market_orders_id_fkey" FOREIGN KEY ("market_order_id") REFERENCES "market_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_payouts" ADD CONSTRAINT "seller_payouts_seller_id_profiles_user_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;