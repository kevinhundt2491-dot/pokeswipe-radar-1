CREATE TABLE "flip_sync_runs" (
	"id" serial PRIMARY KEY,
	"job" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"queries" integer DEFAULT 0 NOT NULL,
	"offers" integer DEFAULT 0 NOT NULL,
	"deals" integer DEFAULT 0 NOT NULL,
	"comps" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "flip_targets" (
	"id" text PRIMARY KEY,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_offers" integer DEFAULT 0 NOT NULL,
	"last_deals" integer DEFAULT 0 NOT NULL,
	"insights_at" timestamp with time zone,
	"errors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_values" (
	"id" serial PRIMARY KEY,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"grade_key" text NOT NULL,
	"median_90" numeric(10,2),
	"median_30" numeric(10,2),
	"sample_90" integer DEFAULT 0 NOT NULL,
	"sample_30" integer DEFAULT 0 NOT NULL,
	"low_90" numeric(10,2),
	"high_90" numeric(10,2),
	"ask_low" numeric(10,2),
	"ask_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_offers" (
	"id" text PRIMARY KEY,
	"source" text DEFAULT 'ebay' NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"grade_key" text DEFAULT 'raw' NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"raw_condition" text DEFAULT '' NOT NULL,
	"lang" text,
	"title" text NOT NULL,
	"price" numeric(10,2) NOT NULL,
	"shipping" numeric(10,2),
	"total" numeric(10,2) NOT NULL,
	"buying_option" text NOT NULL,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"end_at" timestamp with time zone,
	"item_url" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"seller" text DEFAULT '' NOT NULL,
	"seller_feedback_pct" numeric(5,1),
	"seller_feedback_score" integer,
	"item_condition" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"ref_price" numeric(10,2),
	"ref_source" text,
	"discount_pct" numeric(5,1),
	"is_deal" boolean DEFAULT false NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sold_comps" (
	"id" serial PRIMARY KEY,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"grade_key" text DEFAULT 'raw' NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"lang" text,
	"title" text DEFAULT '' NOT NULL,
	"price" numeric(10,2) NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "price_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "auto_price" numeric(10,2);--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "auto_price_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "auto_price_source" text;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "auto_sample" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "ebay_query" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "flip_sync_runs_job" ON "flip_sync_runs" ("job","started_at");--> statement-breakpoint
CREATE INDEX "flip_targets_synced" ON "flip_targets" ("last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_values_target_grade" ON "grade_values" ("target_kind","target_id","grade_key");--> statement-breakpoint
CREATE INDEX "market_offers_target" ON "market_offers" ("target_kind","target_id","status");--> statement-breakpoint
CREATE INDEX "market_offers_deals" ON "market_offers" ("status","is_deal","discount_pct");--> statement-breakpoint
CREATE UNIQUE INDEX "sold_comps_external" ON "sold_comps" ("external_id");--> statement-breakpoint
CREATE INDEX "sold_comps_target" ON "sold_comps" ("target_kind","target_id","grade_key","sold_at");