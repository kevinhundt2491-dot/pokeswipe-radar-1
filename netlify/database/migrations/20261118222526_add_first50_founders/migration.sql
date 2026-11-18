ALTER TABLE "profiles" ADD COLUMN "first50_rank" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "first50_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_first50_rank" ON "profiles" ("first50_rank");