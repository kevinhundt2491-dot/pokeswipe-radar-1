CREATE TABLE "seller_shipping_accounts" (
	"user_id" text PRIMARY KEY,
	"provider" text DEFAULT 'dhl' NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"ekp" text NOT NULL,
	"participation" jsonb DEFAULT '{}' NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"sender_name" text NOT NULL,
	"sender_street" text NOT NULL,
	"sender_house" text DEFAULT '' NOT NULL,
	"sender_zip" text NOT NULL,
	"sender_city" text NOT NULL,
	"sender_country" text DEFAULT 'DEU' NOT NULL,
	"sender_email" text DEFAULT '' NOT NULL,
	"default_product" text DEFAULT 'V62KP' NOT NULL,
	"default_weight_g" integer DEFAULT 500 NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_labels" (
	"id" serial PRIMARY KEY,
	"market_order_id" integer NOT NULL,
	"seller_id" text NOT NULL,
	"provider" text DEFAULT 'dhl' NOT NULL,
	"product" text NOT NULL,
	"shipment_no" text NOT NULL,
	"weight_g" integer NOT NULL,
	"blob_key" text NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sold_comps" ADD COLUMN "variant" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "sold_comps" ADD COLUMN "condition" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sold_comps" ADD COLUMN "market_order_id" integer;--> statement-breakpoint
CREATE INDEX "shipping_labels_order" ON "shipping_labels" ("market_order_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_labels_shipment" ON "shipping_labels" ("provider","shipment_no");--> statement-breakpoint
CREATE INDEX "sold_comps_condition" ON "sold_comps" ("target_kind","target_id","variant","condition","sold_at");--> statement-breakpoint
CREATE INDEX "sold_comps_order" ON "sold_comps" ("market_order_id");--> statement-breakpoint
ALTER TABLE "seller_shipping_accounts" ADD CONSTRAINT "seller_shipping_accounts_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_market_order_id_market_orders_id_fkey" FOREIGN KEY ("market_order_id") REFERENCES "market_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_seller_id_profiles_user_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;