CREATE TABLE "cancellations" (
	"id" serial PRIMARY KEY,
	"reference" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"contract_ref" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'ordentlich' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"timing" text DEFAULT 'next' NOT NULL,
	"requested_date" date,
	"status" text DEFAULT 'received' NOT NULL,
	"effective_at" timestamp with time zone,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_sets" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"serie_id" text DEFAULT '' NOT NULL,
	"serie_name" text DEFAULT '' NOT NULL,
	"abbreviation" text DEFAULT '' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"release_date" date,
	"card_count_official" integer DEFAULT 0 NOT NULL,
	"card_count_total" integer DEFAULT 0 NOT NULL,
	"cards_imported_at" timestamp with time zone,
	"details_checked_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "set_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "local_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "rarity" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "illustrator" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "set_id" text;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "uvp" numeric(10,2);--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "cardmarket_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "price_source" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellations_reference" ON "cancellations" ("reference");--> statement-breakpoint
CREATE INDEX "cancellations_email" ON "cancellations" ("email");--> statement-breakpoint
CREATE INDEX "cancellations_user" ON "cancellations" ("user_id");--> statement-breakpoint
CREATE INDEX "card_sets_release" ON "card_sets" ("release_date");--> statement-breakpoint
CREATE INDEX "cards_set_id" ON "cards" ("set_id","local_id");--> statement-breakpoint
CREATE INDEX "cards_checked_at" ON "cards" ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_products_slug" ON "sealed_products" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_products_ean" ON "sealed_products" ("ean");--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE SET NULL;