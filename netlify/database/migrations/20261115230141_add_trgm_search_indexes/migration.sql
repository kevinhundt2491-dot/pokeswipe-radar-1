-- Serverseitige Kartensuche (/api/search): Trigram-Indizes für tippfehlertolerante Suche
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_name_trgm" ON "cards" USING gin (lower("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_set_name_trgm" ON "cards" USING gin (lower("set_name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_illustrator_trgm" ON "cards" USING gin (lower(coalesce("illustrator", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_local_id_plain" ON "cards" (ltrim("local_id", '0'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_prints_name_trgm" ON "card_prints" USING gin (lower("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_prints_set_trgm" ON "card_prints" USING gin (lower("set_name" || ' ' || "set_code") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_prints_local_id_plain" ON "card_prints" (ltrim("local_id", '0'));
