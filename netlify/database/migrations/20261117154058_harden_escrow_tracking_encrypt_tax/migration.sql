ALTER TABLE "market_orders" ADD COLUMN "tracking_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "tracking_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "tracking_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "tracking_alert_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "label_shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_tax_info" ADD COLUMN "birth_date_enc" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "market_orders_tracking" ON "market_orders" ("status","carrier","tracking_checked_at");--> statement-breakpoint
-- § 4 Abs. 5 Nr. 4 PStTG: meldepflichtig ab 30 Verkäufen ODER MEHR ALS 2.000 € (genau 2.000,00 € ist noch ausgenommen)
UPDATE "seller_dac7_stats" SET "reporting_required" = ("transactions" >= 30 OR "gross_cents" - "refunded_cents" > 200000);
