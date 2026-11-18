ALTER TABLE "creator_leads" ADD COLUMN "email_source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_leads" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_leads" ADD COLUMN "email_searched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_leads" ADD COLUMN "email_search_note" text DEFAULT '' NOT NULL;