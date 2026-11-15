CREATE TABLE "card_hashes" (
	"id" text PRIMARY KEY,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"lang" text NOT NULL,
	"art_p" text,
	"art_d" text,
	"full_p" text,
	"source_image" text DEFAULT '' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "card_hashes_lang" ON "card_hashes" ("lang");--> statement-breakpoint
CREATE INDEX "card_hashes_target" ON "card_hashes" ("target_kind","target_id");