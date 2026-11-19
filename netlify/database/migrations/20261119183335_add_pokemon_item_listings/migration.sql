ALTER TABLE "listings" ADD COLUMN "listing_type" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "item_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "item_condition" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "extra_images" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX "listings_type" ON "listings" ("listing_type","status");