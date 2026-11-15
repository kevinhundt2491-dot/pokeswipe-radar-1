CREATE TABLE "card_print_prices" (
	"id" serial PRIMARY KEY,
	"print_id" text NOT NULL,
	"day" date NOT NULL,
	"price_eur" numeric(10,2),
	"cm_trend" numeric(10,2),
	"tcg_market_usd" numeric(10,2)
);
--> statement-breakpoint
CREATE TABLE "card_prints" (
	"id" text PRIMARY KEY,
	"lang" text NOT NULL,
	"tcgdex_id" text NOT NULL,
	"base_card_id" text,
	"name" text NOT NULL,
	"set_id" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"set_code" text DEFAULT '' NOT NULL,
	"local_id" text DEFAULT '' NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"rarity" text,
	"category" text,
	"dex_id" integer,
	"cm_trend" numeric(10,2),
	"cm_low" numeric(10,2),
	"cm_avg7" numeric(10,2),
	"cm_avg30" numeric(10,2),
	"cm_updated_at" timestamp with time zone,
	"tcg_market_usd" numeric(10,2),
	"tcg_low_usd" numeric(10,2),
	"tcg_variant" text,
	"tcg_updated_at" timestamp with time zone,
	"price_eur" numeric(10,2),
	"low_eur" numeric(10,2),
	"price_source" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text PRIMARY KEY,
	"per_eur" numeric(12,4) NOT NULL,
	"rate_day" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_sets" (
	"lang" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"serie_id" text DEFAULT '' NOT NULL,
	"serie_name" text DEFAULT '' NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"release_date" date,
	"card_count_official" integer DEFAULT 0 NOT NULL,
	"card_count_total" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cards_imported_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN "lang" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN "print_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "card_print_prices_day" ON "card_print_prices" ("print_id","day");--> statement-breakpoint
CREATE INDEX "card_prints_lang_set" ON "card_prints" ("lang","set_id","local_id");--> statement-breakpoint
CREATE INDEX "card_prints_checked" ON "card_prints" ("lang","checked_at");--> statement-breakpoint
CREATE INDEX "card_prints_base" ON "card_prints" ("base_card_id");--> statement-breakpoint
CREATE INDEX "card_prints_dex" ON "card_prints" ("dex_id");--> statement-breakpoint
CREATE INDEX "card_prints_price" ON "card_prints" ("lang","price_eur");--> statement-breakpoint
CREATE INDEX "portfolio_print" ON "portfolio_items" ("print_id");--> statement-breakpoint
CREATE UNIQUE INDEX "print_sets_lang_id" ON "print_sets" ("lang","id");--> statement-breakpoint
CREATE INDEX "print_sets_release" ON "print_sets" ("lang","release_date");--> statement-breakpoint
ALTER TABLE "card_print_prices" ADD CONSTRAINT "card_print_prices_print_id_card_prints_id_fkey" FOREIGN KEY ("print_id") REFERENCES "card_prints"("id") ON DELETE CASCADE;