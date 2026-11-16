CREATE TABLE "market_valuation_history" (
	"id" serial PRIMARY KEY,
	"card_id" text NOT NULL,
	"variant" text DEFAULT 'normal' NOT NULL,
	"tier" text NOT NULL,
	"day" date NOT NULL,
	"value" numeric(10,2) NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_valuations" (
	"id" serial PRIMARY KEY,
	"card_id" text NOT NULL,
	"variant" text DEFAULT 'normal' NOT NULL,
	"tier" text NOT NULL,
	"value" numeric(10,2),
	"low" numeric(10,2),
	"high" numeric(10,2),
	"confidence" integer DEFAULT 0 NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"sources" jsonb DEFAULT '{}' NOT NULL,
	"trend_7" double precision,
	"trend_30" double precision,
	"data_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restock_watch_follows" (
	"watch_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_learn_votes" (
	"hash_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_learned_hashes" (
	"id" serial PRIMARY KEY,
	"target_key" text NOT NULL,
	"lang" text NOT NULL,
	"art_p" text NOT NULL,
	"art_d" text NOT NULL,
	"full_p" text NOT NULL,
	"color" text,
	"source" text DEFAULT 'confirm' NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"confirmations" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"first_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan_source" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "app_store_original_tx_id" text;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "health" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "health_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "last_layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "pending_status" text;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restock_watches" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "market_valuation_history_key" ON "market_valuation_history" ("card_id","variant","tier","day");--> statement-breakpoint
CREATE UNIQUE INDEX "market_valuations_key" ON "market_valuations" ("card_id","variant","tier");--> statement-breakpoint
CREATE INDEX "market_valuations_computed" ON "market_valuations" ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "restock_watch_follows_pk" ON "restock_watch_follows" ("watch_id","user_id");--> statement-breakpoint
CREATE INDEX "restock_watch_follows_user" ON "restock_watch_follows" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_learn_votes_pk" ON "scan_learn_votes" ("hash_id","user_id");--> statement-breakpoint
CREATE INDEX "scan_learned_hashes_target" ON "scan_learned_hashes" ("target_key");--> statement-breakpoint
CREATE INDEX "scan_learned_hashes_lang" ON "scan_learned_hashes" ("lang","active");--> statement-breakpoint
ALTER TABLE "restock_watch_follows" ADD CONSTRAINT "restock_watch_follows_watch_id_restock_watches_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "restock_watches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restock_watch_follows" ADD CONSTRAINT "restock_watch_follows_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scan_learn_votes" ADD CONSTRAINT "scan_learn_votes_hash_id_scan_learned_hashes_id_fkey" FOREIGN KEY ("hash_id") REFERENCES "scan_learned_hashes"("id") ON DELETE CASCADE;