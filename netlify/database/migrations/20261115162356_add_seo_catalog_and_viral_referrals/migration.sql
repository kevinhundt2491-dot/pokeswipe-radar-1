CREATE TABLE "catalog_import_runs" (
	"id" serial PRIMARY KEY,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"sets_imported" integer DEFAULT 0 NOT NULL,
	"prices" integer DEFAULT 0 NOT NULL,
	"species" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pokemon_species" (
	"dex_id" integer PRIMARY KEY,
	"name_de" text NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"card_count" integer DEFAULT 0 NOT NULL,
	"priced_count" integer DEFAULT 0 NOT NULL,
	"top_card_id" text,
	"top_price" numeric(10,2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT 'premium' NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'invite' NOT NULL,
	"target" text DEFAULT '/' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"unique_visitors" integer DEFAULT 0 NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_visits" (
	"id" serial PRIMARY KEY,
	"share_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "dex_id" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "hp" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "types" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "variants" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "regulation_mark" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "details_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bonus_plan" text DEFAULT 'premium' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "referred_via" integer;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "contents" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "booster_count" integer;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "cards_dex_id" ON "cards" ("dex_id");--> statement-breakpoint
CREATE INDEX "catalog_import_runs_started" ON "catalog_import_runs" ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pokemon_species_slug" ON "pokemon_species" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_unique" ON "referral_rewards" ("user_id","kind","reference");--> statement-breakpoint
CREATE INDEX "referral_rewards_user" ON "referral_rewards" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_code" ON "share_links" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_user_target" ON "share_links" ("user_id","target");--> statement-breakpoint
CREATE UNIQUE INDEX "share_visits_share_visitor" ON "share_visits" ("share_id","visitor_hash");--> statement-breakpoint
CREATE INDEX "share_visits_owner_day" ON "share_visits" ("owner_id","day");--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_visits" ADD CONSTRAINT "share_visits_share_id_share_links_id_fkey" FOREIGN KEY ("share_id") REFERENCES "share_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_visits" ADD CONSTRAINT "share_visits_owner_id_profiles_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;