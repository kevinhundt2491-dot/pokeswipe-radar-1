CREATE TABLE "seller_accounts" (
	"user_id" text PRIMARY KEY,
	"stripe_connect_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"requirements_due" jsonb DEFAULT '[]' NOT NULL,
	"disabled_reason" text,
	"psttg_tax_data_complete" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "seller_id" text;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "reserved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "reserved_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "reserved_checkout_id" integer;--> statement-breakpoint
ALTER TABLE "seller_dac7_stats" ADD COLUMN "threshold_warning_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_dac7_stats" ADD COLUMN "threshold_warning_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_dac7_stats" ADD COLUMN "reporting_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "cart_items_seller" ON "cart_items" ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_accounts_stripe" ON "seller_accounts" ("stripe_connect_account_id");--> statement-breakpoint
CREATE INDEX "seller_accounts_status" ON "seller_accounts" ("verification_status");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_seller_id_profiles_user_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seller_accounts" ADD CONSTRAINT "seller_accounts_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE VIEW "psttg_annual_metrics" AS (SELECT user_id AS seller_id, year, transactions AS completed_sales_count,
  greatest(gross_cents - refunded_cents, 0) AS total_gross_eur_cents, refunded_cents AS refunded_eur_cents,
  fee_cents AS platform_fee_eur_cents, threshold_warning_sent, reporting_required, updated_at
  FROM seller_dac7_stats);--> statement-breakpoint
INSERT INTO "seller_accounts" ("user_id", "stripe_connect_account_id", "charges_enabled", "payouts_enabled", "transfers_active", "verification_status", "psttg_tax_data_complete")
SELECT p."user_id", p."stripe_account_id", false, p."stripe_account_ready", p."stripe_account_ready",
  CASE WHEN p."stripe_account_ready" THEN 'verified' ELSE 'pending' END,
  EXISTS (SELECT 1 FROM "seller_tax_info" t WHERE t."user_id" = p."user_id")
FROM "profiles" p WHERE p."stripe_account_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "cart_items" c SET "seller_id" = l."user_id" FROM "listings" l WHERE l."id" = c."listing_id" AND c."seller_id" IS NULL;--> statement-breakpoint
UPDATE "seller_dac7_stats" SET
  "reporting_required" = ("transactions" >= 30 OR "gross_cents" - "refunded_cents" >= 200000),
  "threshold_warning_sent" = ("reminders_sent" > 0);
