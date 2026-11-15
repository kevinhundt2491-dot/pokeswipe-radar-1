CREATE TABLE "graded_cards" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"card_id" text,
	"name" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"company" text DEFAULT 'PSA' NOT NULL,
	"grade" numeric(3,1) NOT NULL,
	"cert_number" text DEFAULT '' NOT NULL,
	"purchase_price" numeric(10,2),
	"value" numeric(10,2),
	"value_updated_at" timestamp with time zone,
	"submission_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_submissions" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"company" text DEFAULT 'PSA' NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"card_count" integer DEFAULT 1 NOT NULL,
	"declared_value" numeric(10,2),
	"cost" numeric(10,2),
	"status" text DEFAULT 'prep' NOT NULL,
	"sent_day" date,
	"expected_day" date,
	"tracking" text DEFAULT '' NOT NULL,
	"submission_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restock_confirmations" (
	"id" serial PRIMARY KEY,
	"drop_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restock_drops" (
	"id" serial PRIMARY KEY,
	"watch_id" integer,
	"kind" text DEFAULT 'restock' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"title" text NOT NULL,
	"shop" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"price" numeric(10,2),
	"uvp" numeric(10,2),
	"reported_by" text,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"live_at" timestamp with time zone,
	"paid_notified" boolean DEFAULT false NOT NULL,
	"free_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restock_subscriptions" (
	"user_id" text PRIMARY KEY,
	"enabled" boolean DEFAULT true NOT NULL,
	"preorders" boolean DEFAULT true NOT NULL,
	"shops" text DEFAULT '' NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"max_price" numeric(10,2),
	"uvp_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restock_watches" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'display' NOT NULL,
	"shop" text NOT NULL,
	"url" text NOT NULL,
	"uvp" numeric(10,2),
	"release_day" date,
	"auto_check" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_price" numeric(10,2),
	"last_checked_at" timestamp with time zone,
	"last_change_at" timestamp with time zone,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "graded_cards_user" ON "graded_cards" ("user_id");--> statement-breakpoint
CREATE INDEX "grading_submissions_user" ON "grading_submissions" ("user_id");--> statement-breakpoint
CREATE INDEX "grading_submissions_due" ON "grading_submissions" ("status","expected_day");--> statement-breakpoint
CREATE UNIQUE INDEX "restock_confirmations_drop_user" ON "restock_confirmations" ("drop_id","user_id");--> statement-breakpoint
CREATE INDEX "restock_drops_status" ON "restock_drops" ("status","live_at");--> statement-breakpoint
CREATE INDEX "restock_watches_active" ON "restock_watches" ("active","last_checked_at");--> statement-breakpoint
ALTER TABLE "graded_cards" ADD CONSTRAINT "graded_cards_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "graded_cards" ADD CONSTRAINT "graded_cards_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "grading_submissions" ADD CONSTRAINT "grading_submissions_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restock_confirmations" ADD CONSTRAINT "restock_confirmations_drop_id_restock_drops_id_fkey" FOREIGN KEY ("drop_id") REFERENCES "restock_drops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restock_confirmations" ADD CONSTRAINT "restock_confirmations_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restock_drops" ADD CONSTRAINT "restock_drops_watch_id_restock_watches_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "restock_watches"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "restock_drops" ADD CONSTRAINT "restock_drops_reported_by_profiles_user_id_fkey" FOREIGN KEY ("reported_by") REFERENCES "profiles"("user_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "restock_subscriptions" ADD CONSTRAINT "restock_subscriptions_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;