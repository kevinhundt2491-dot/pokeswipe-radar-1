CREATE TABLE "creator_applications" (
	"id" serial PRIMARY KEY,
	"channel_name" text NOT NULL,
	"platform" text NOT NULL,
	"channel_url" text DEFAULT '' NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"email" text NOT NULL,
	"wish_code" text DEFAULT '' NOT NULL,
	"promo_id" integer,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"lead_id" integer,
	"ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creator_leads" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"category" text DEFAULT 'packopening' NOT NULL,
	"platform" text DEFAULT 'youtube' NOT NULL,
	"channel_url" text DEFAULT '' NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"socials" jsonb DEFAULT '[]' NOT NULL,
	"promo_id" integer,
	"promo_code" text DEFAULT '' NOT NULL,
	"template" text DEFAULT 'A' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"custom_body" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"followup_sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"optout_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_outreach_log" (
	"id" serial PRIMARY KEY,
	"lead_id" integer,
	"kind" text DEFAULT 'initial' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"ok" boolean DEFAULT false NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"resend_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_suppressions" (
	"email" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_claims" (
	"nonce" text PRIMARY KEY,
	"fb_uid" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "binder_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "creator_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "creator_applications_status" ON "creator_applications" ("status","created_at");--> statement-breakpoint
CREATE INDEX "creator_leads_status" ON "creator_leads" ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_leads_optout" ON "creator_leads" ("optout_token");--> statement-breakpoint
CREATE INDEX "creator_outreach_log_created" ON "creator_outreach_log" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "presence_claims_fb_user" ON "presence_claims" ("fb_uid","user_id");--> statement-breakpoint
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_promo_id_promo_codes_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "creator_leads" ADD CONSTRAINT "creator_leads_promo_id_promo_codes_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "creator_outreach_log" ADD CONSTRAINT "creator_outreach_log_lead_id_creator_leads_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "creator_leads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "presence_claims" ADD CONSTRAINT "presence_claims_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;