CREATE TABLE "direct_messages" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"status" text DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" serial PRIMARY KEY,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "card_intent" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "card_meta" jsonb;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "category" text DEFAULT 'pull' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "card_intent" text;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "card_meta" jsonb;--> statement-breakpoint
CREATE INDEX "community_posts_category" ON "community_posts" ("category","id");--> statement-breakpoint
CREATE INDEX "direct_messages_pair" ON "direct_messages" ("user_id","recipient_id","id");--> statement-breakpoint
CREATE INDEX "direct_messages_recipient" ON "direct_messages" ("recipient_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair" ON "friendships" ("requester_id","addressee_id");--> statement-breakpoint
CREATE INDEX "friendships_addressee" ON "friendships" ("addressee_id","status");--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_profiles_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_profiles_user_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_profiles_user_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;