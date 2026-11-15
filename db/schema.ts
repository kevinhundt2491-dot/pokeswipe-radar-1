import {
  pgTable, serial, text, timestamp, integer, numeric, boolean, date, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// Nutzerprofil – user_id ist die Netlify-Identity-ID
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text().notNull(),
  displayName: text("display_name").notNull(),
  city: text().notNull().default(""),
  plan: text().notNull().default("free"), // free | premium | pro
  planUntil: timestamp("plan_until", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  planCheckedAt: timestamp("plan_checked_at", { withTimezone: true }),
  banned: boolean().notNull().default(false),
  // Händler-Shop (Pro Trader)
  shopSlug: text("shop_slug"),
  shopTitle: text("shop_title").notNull().default(""),
  shopBio: text("shop_bio").notNull().default(""),
  // Empfehlungsprogramm
  referralCode: text("referral_code"),
  referredBy: text("referred_by"),
  referralRewarded: boolean("referral_rewarded").notNull().default(false),
  usedTrial: boolean("used_trial").notNull().default(false),
  bonusUntil: timestamp("bonus_until", { withTimezone: true }),
  bonusPlan: text("bonus_plan").notNull().default("premium"), // Tarif während bonusUntil: premium | pro (Stufen-Belohnungen)
  referredVia: integer("referred_via"), // share_links.id, über den die Anmeldung kam
  // Wechsel-Bonus (einmalig beim Import einer Sammlung aus einer anderen App)
  switchBonusAt: timestamp("switch_bonus_at", { withTimezone: true }),
  planInterval: text("plan_interval").notNull().default("month"), // month | year
  // Bindung: tägliche Serie, Bestenliste, Wochen-Report
  streak: integer().notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  lastCheckin: date("last_checkin"),
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  weeklyReport: boolean("weekly_report").notNull().default(true),
  lastWeeklyReport: timestamp("last_weekly_report", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("profiles_display_name_lower").on(t.displayName),
  uniqueIndex("profiles_shop_slug").on(t.shopSlug),
  uniqueIndex("profiles_referral_code").on(t.referralCode),
]);

// Karten-Stammdaten + letzter Cardmarket-Preis (TCGdex)
export const cards = pgTable("cards", {
  id: text().primaryKey(), // TCGdex-ID, z. B. sv03.5-199
  name: text().notNull(),
  setName: text("set_name").notNull().default(""),
  image: text().notNull().default(""),
  trend: numeric({ precision: 10, scale: 2 }),
  avg: numeric({ precision: 10, scale: 2 }),
  low: numeric({ precision: 10, scale: 2 }),
  avg7: numeric({ precision: 10, scale: 2 }),
  avg30: numeric({ precision: 10, scale: 2 }),
  priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  // Katalog-Felder (deutscher Kartenkatalog, automatisch aus TCGdex importiert)
  setId: text("set_id"),
  localId: text("local_id"),
  rarity: text(),
  category: text(), // Pokémon | Trainer | Energie
  illustrator: text(),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  // Detaildaten (beim Preisabruf aus TCGdex befüllt) – Grundlage für Pokémon-Seiten & strukturierte Daten
  dexId: integer("dex_id"), // National-Pokédex-Nr. (erste, falls mehrere)
  hp: integer(),
  types: text(), // kommagetrennt, z. B. "Feuer"
  stage: text(), // Basis | Phase 1 | Phase 2 …
  variants: text(), // kommagetrennt: normal,reverse,holo,firstEdition
  regulationMark: text("regulation_mark"),
  detailsAt: timestamp("details_at", { withTimezone: true }),
}, (t) => [index("cards_set_id").on(t.setId, t.localId), index("cards_checked_at").on(t.checkedAt), index("cards_dex_id").on(t.dexId)]);

// Pokémon-Arten (aus dem Katalog abgeleitet) – öffentliche Seiten /pokemon/<name> für Suchanfragen wie „Glurak Karten Wert“
export const pokemonSpecies = pgTable("pokemon_species", {
  dexId: integer("dex_id").primaryKey(),
  nameDe: text("name_de").notNull(),
  nameEn: text("name_en").notNull().default(""),
  slug: text().notNull(),
  cardCount: integer("card_count").notNull().default(0),
  pricedCount: integer("priced_count").notNull().default(0),
  topCardId: text("top_card_id"),
  topPrice: numeric("top_price", { precision: 10, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("pokemon_species_slug").on(t.slug)]);

// Protokoll der automatischen Katalog-Importe (Admin-Zentrale, Fehlersuche)
export const catalogImportRuns = pgTable("catalog_import_runs", {
  id: serial().primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  setsImported: integer("sets_imported").notNull().default(0),
  prices: integer().notNull().default(0),
  species: integer().notNull().default(0),
  errors: integer().notNull().default(0),
  note: text().notNull().default(""),
}, (t) => [index("catalog_import_runs_started").on(t.startedAt)]);

// Deutscher Set-Katalog (TCGdex) – Grundlage für öffentliche Set-Seiten und den Karten-Import
export const cardSets = pgTable("card_sets", {
  id: text().primaryKey(), // TCGdex-Set-ID, z. B. sv08
  name: text().notNull(),
  slug: text().notNull().default(""),
  serieId: text("serie_id").notNull().default(""),
  serieName: text("serie_name").notNull().default(""),
  abbreviation: text().notNull().default(""),
  logo: text().notNull().default(""),
  symbol: text().notNull().default(""),
  releaseDate: date("release_date"),
  cardCountOfficial: integer("card_count_official").notNull().default(0),
  cardCountTotal: integer("card_count_total").notNull().default(0),
  // Import-Status: wann die Kartenliste und zuletzt die Preise geholt wurden
  cardsImportedAt: timestamp("cards_imported_at", { withTimezone: true }),
  detailsCheckedAt: timestamp("details_checked_at", { withTimezone: true }),
  priority: integer().notNull().default(0), // höher = früher importieren (neue Sets zuerst)
  active: boolean().notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("card_sets_release").on(t.releaseDate)]);

// ---------------------------------------------------------------------------
// Mehrsprachiger Katalog: englische und japanische Drucke mit eigenen Set-Codes, Nummern, Bildern
// und getrennten Preis-Feeds. Der deutsche Katalog bleibt in `cards`/`card_sets` (unverändert).
// ---------------------------------------------------------------------------
export const printSets = pgTable("print_sets", {
  lang: text().notNull(), // en | ja
  id: text().notNull(), // TCGdex-Set-ID der Sprache, z. B. sv03.5 (en) oder SV2a (ja)
  name: text().notNull(),
  serieId: text("serie_id").notNull().default(""),
  serieName: text("serie_name").notNull().default(""),
  code: text().notNull().default(""), // offizielles Kürzel (z. B. MEW) oder Set-ID
  logo: text().notNull().default(""),
  symbol: text().notNull().default(""),
  releaseDate: date("release_date"),
  cardCountOfficial: integer("card_count_official").notNull().default(0),
  cardCountTotal: integer("card_count_total").notNull().default(0),
  priority: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  cardsImportedAt: timestamp("cards_imported_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("print_sets_lang_id").on(t.lang, t.id), index("print_sets_release").on(t.lang, t.releaseDate)]);

export const cardPrints = pgTable("card_prints", {
  id: text().primaryKey(), // "<lang>:<TCGdex-ID>", z. B. en:sv03.5-199 oder ja:SV2a-201
  lang: text().notNull(),
  tcgdexId: text("tcgdex_id").notNull(),
  // Deutsche Karte mit demselben Cardmarket-Produkt (nur en; gleiche TCGdex-ID) – für Portfolio & Wunschliste
  baseCardId: text("base_card_id"),
  name: text().notNull(),
  setId: text("set_id").notNull(),
  setName: text("set_name").notNull().default(""),
  setCode: text("set_code").notNull().default(""),
  localId: text("local_id").notNull().default(""),
  number: text().notNull().default(""), // Anzeige-Nummer, z. B. 199/165
  image: text().notNull().default(""),
  rarity: text(),
  category: text(),
  dexId: integer("dex_id"),
  // Preis-Feed 1: Cardmarket (EUR) – Produkt der jeweiligen Sprache (ja hat eigene Cardmarket-Produkte)
  cmTrend: numeric("cm_trend", { precision: 10, scale: 2 }),
  cmLow: numeric("cm_low", { precision: 10, scale: 2 }),
  cmAvg7: numeric("cm_avg7", { precision: 10, scale: 2 }),
  cmAvg30: numeric("cm_avg30", { precision: 10, scale: 2 }),
  cmUpdatedAt: timestamp("cm_updated_at", { withTimezone: true }),
  // Preis-Feed 2: TCGplayer (USD) – Marktpreis/Tiefstpreis der teuersten Variante
  tcgMarketUsd: numeric("tcg_market_usd", { precision: 10, scale: 2 }),
  tcgLowUsd: numeric("tcg_low_usd", { precision: 10, scale: 2 }),
  tcgVariant: text("tcg_variant"),
  tcgUpdatedAt: timestamp("tcg_updated_at", { withTimezone: true }),
  // Abgeleiteter Referenzpreis in EUR (Feed-Wahl je Sprache, USD über EZB-Kurs umgerechnet)
  priceEur: numeric("price_eur", { precision: 10, scale: 2 }),
  lowEur: numeric("low_eur", { precision: 10, scale: 2 }),
  priceSource: text("price_source"), // cardmarket | tcgplayer
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
}, (t) => [
  index("card_prints_lang_set").on(t.lang, t.setId, t.localId),
  index("card_prints_checked").on(t.lang, t.checkedAt),
  index("card_prints_base").on(t.baseCardId),
  index("card_prints_dex").on(t.dexId),
  index("card_prints_price").on(t.lang, t.priceEur),
]);

export const cardPrintPrices = pgTable("card_print_prices", {
  id: serial().primaryKey(),
  printId: text("print_id").notNull().references(() => cardPrints.id, { onDelete: "cascade" }),
  day: date().notNull(),
  priceEur: numeric("price_eur", { precision: 10, scale: 2 }),
  cmTrend: numeric("cm_trend", { precision: 10, scale: 2 }),
  tcgMarketUsd: numeric("tcg_market_usd", { precision: 10, scale: 2 }),
}, (t) => [uniqueIndex("card_print_prices_day").on(t.printId, t.day)]);

// Wechselkurse (EZB-Referenzkurse, täglich): Einheiten der Währung je 1 EUR
export const fxRates = pgTable("fx_rates", {
  currency: text().primaryKey(), // USD | JPY
  perEur: numeric("per_eur", { precision: 12, scale: 4 }).notNull(),
  rateDay: date("rate_day").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceHistory = pgTable("price_history", {
  id: serial().primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  day: date().notNull(),
  trend: numeric({ precision: 10, scale: 2 }),
  avg: numeric({ precision: 10, scale: 2 }),
  low: numeric({ precision: 10, scale: 2 }),
}, (t) => [uniqueIndex("price_history_card_day").on(t.cardId, t.day)]);

export const portfolioItems = pgTable("portfolio_items", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id").references(() => cards.id),
  name: text().notNull(),
  image: text().notNull().default(""),
  quantity: integer().notNull().default(1),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  manualValue: numeric("manual_value", { precision: 10, scale: 2 }),
  condition: text().notNull().default("NM"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  // Sprachvariante (Mehrsprachiger Katalog): de | en | ja; print_id verweist auf card_prints (en/ja)
  lang: text().notNull().default("de"),
  printId: text("print_id"),
}, (t) => [index("portfolio_user").on(t.userId), index("portfolio_print").on(t.printId)]);

// Täglicher Schnappschuss des Portfolio-Werts pro Nutzer
export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  day: date().notNull(),
  value: numeric({ precision: 12, scale: 2 }).notNull(),
}, (t) => [uniqueIndex("portfolio_snapshot_user_day").on(t.userId, t.day)]);

export const priceAlerts = pgTable("price_alerts", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id").notNull().references(() => cards.id),
  targetPrice: numeric("target_price", { precision: 10, scale: 2 }).notNull(),
  direction: text().notNull().default("below"), // below | above
  active: boolean().notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("alerts_user").on(t.userId), index("alerts_card").on(t.cardId)]);

export const notifications = pgTable("notifications", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  title: text().notNull(),
  body: text().notNull().default(""),
  link: text().notNull().default(""),
  read: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notifications_user").on(t.userId, t.createdAt)]);

export const listings = pgTable("listings", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id").references(() => cards.id),
  cardName: text("card_name").notNull(),
  image: text().notNull().default(""),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
  want: text().notNull().default(""),
  city: text().notNull().default(""),
  status: text().notNull().default("active"), // active | sold | removed
  sealedProductId: integer("sealed_product_id"),
  boostedUntil: timestamp("boosted_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("listings_status").on(t.status, t.createdAt), index("listings_user").on(t.userId)]);

export const trades = pgTable("trades", {
  id: serial().primaryKey(),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  fromUser: text("from_user").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  toUser: text("to_user").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  offer: text().notNull(),
  request: text().notNull(),
  status: text().notNull().default("pending"), // pending | accepted | declined | cancelled | completed
  fromConfirmed: boolean("from_confirmed").notNull().default(false),
  toConfirmed: boolean("to_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("trades_from").on(t.fromUser), index("trades_to").on(t.toUser)]);

export const tradeMessages = pgTable("trade_messages", {
  id: serial().primaryKey(),
  tradeId: integer("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  body: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("trade_messages_trade").on(t.tradeId, t.id)]);

export const reviews = pgTable("reviews", {
  id: serial().primaryKey(),
  tradeId: integer("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  revieweeId: text("reviewee_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  stars: integer().notNull(),
  comment: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("reviews_trade_reviewer").on(t.tradeId, t.reviewerId), index("reviews_reviewee").on(t.revieweeId)]);

export const reports = pgTable("reports", {
  id: serial().primaryKey(),
  reporterId: text("reporter_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(), // listing | user | trade
  targetId: text("target_id").notNull(),
  reason: text().notNull(),
  status: text().notNull().default("open"), // open | resolved | dismissed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Verarbeitete Stripe-Checkouts (verhindert doppelte Gutschrift)
export const payments = pgTable("payments", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  kind: text().notNull(), // subscription | boost
  listingId: integer("listing_id"),
  amountCents: integer("amount_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Inklusive Boosts für Pro-Abonnenten (pro Monat)
export const freeBoostUsage = pgTable("free_boost_usage", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  listingId: integer("listing_id").notNull(),
  month: text().notNull(), // YYYY-MM
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("free_boost_user_month").on(t.userId, t.month)]);

// Web-Push-Abos (ein Eintrag pro Gerät/Browser)
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("push_user").on(t.userId)]);

// Verfolgte Sets für den Set-Fortschritt
export const trackedSets = pgTable("tracked_sets", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  setId: text("set_id").notNull(),
  setName: text("set_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tracked_sets_user_set").on(t.userId, t.setId)]);

// Sealed-Produkte (Displays, ETBs, Top-Trainer-Boxen) mit Admin-Referenzpreis
export const sealedProducts = pgTable("sealed_products", {
  id: serial().primaryKey(),
  name: text().notNull(),
  setName: text("set_name").notNull().default(""),
  kind: text().notNull().default("display"), // display | etb | ttb | bundle | booster | tin | collection | other
  image: text().notNull().default(""),
  refPrice: numeric("ref_price", { precision: 10, scale: 2 }),
  refUpdatedAt: timestamp("ref_updated_at", { withTimezone: true }),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Katalog-/Import-Felder für Sealed-Produkte (SEO-Seiten & automatischer Preis-Import)
  slug: text(),
  setId: text("set_id"),
  uvp: numeric({ precision: 10, scale: 2 }),
  ean: text(),
  releaseDate: date("release_date"),
  cardmarketUrl: text("cardmarket_url").notNull().default(""),
  priceSource: text("price_source").notNull().default("admin"), // admin | import | community
  contents: text().notNull().default(""), // Inhalt, z. B. "36 Booster" oder "9 Booster, 65 Hüllen, Würfel"
  boosterCount: integer("booster_count"), // für „Preis pro Booster“
  description: text().notNull().default(""),
}, (t) => [uniqueIndex("sealed_products_slug").on(t.slug), uniqueIndex("sealed_products_ean").on(t.ean)]);

export const sealedPriceHistory = pgTable("sealed_price_history", {
  id: serial().primaryKey(),
  productId: integer("product_id").notNull().references(() => sealedProducts.id, { onDelete: "cascade" }),
  day: date().notNull(),
  refPrice: numeric("ref_price", { precision: 10, scale: 2 }),
  communityAvg: numeric("community_avg", { precision: 10, scale: 2 }),
  listingCount: integer("listing_count").notNull().default(0),
}, (t) => [uniqueIndex("sealed_history_product_day").on(t.productId, t.day)]);

export const sealedAlerts = pgTable("sealed_alerts", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => sealedProducts.id, { onDelete: "cascade" }),
  targetPrice: numeric("target_price", { precision: 10, scale: 2 }).notNull(),
  direction: text().notNull().default("below"),
  active: boolean().notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sealed_alerts_user").on(t.userId), index("sealed_alerts_product").on(t.productId)]);

// Kamera-Scans (für Tageslimits)
export const cardScans = pgTable("card_scans", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  result: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("card_scans_user").on(t.userId, t.createdAt)]);

// Klicks auf Partner-Links (Grading-Affiliate)
export const affiliateClicks = pgTable("affiliate_clicks", {
  id: serial().primaryKey(),
  partner: text().notNull(),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("affiliate_clicks_partner").on(t.partner, t.createdAt)]);

// Wunschliste: Karten, die ein Nutzer sucht (optional mit Höchstpreis)
export const wishlistItems = pgTable("wishlist_items", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id").notNull().references(() => cards.id),
  maxPrice: numeric("max_price", { precision: 10, scale: 2 }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("wishlist_user_card").on(t.userId, t.cardId), index("wishlist_card").on(t.cardId)]);

// Verdiente Abzeichen
export const userBadges = pgTable("user_badges", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  badge: text().notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("user_badges_user_badge").on(t.userId, t.badge)]);

// Kalender: Set-Releases (Admin) und Events wie Tauschbörsen oder Turniere (Community)
export const calendarEvents = pgTable("calendar_events", {
  id: serial().primaryKey(),
  kind: text().notNull().default("event"), // release | event
  title: text().notNull(),
  day: date().notNull(),
  city: text().notNull().default(""),
  url: text().notNull().default(""),
  description: text().notNull().default(""),
  createdBy: text("created_by").references(() => profiles.userId, { onDelete: "set null" }),
  status: text().notNull().default("active"), // active | removed
  remindersSent: boolean("reminders_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("calendar_events_day").on(t.status, t.day)]);

export const calendarReminders = pgTable("calendar_reminders", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => calendarEvents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("calendar_reminders_user_event").on(t.userId, t.eventId), index("calendar_reminders_event").on(t.eventId)]);

// Tägliche Shop-Statistik für Pro-Trader
export const shopStats = pgTable("shop_stats", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  day: date().notNull(),
  views: integer().notNull().default(0),
  listingViews: integer("listing_views").notNull().default(0),
}, (t) => [uniqueIndex("shop_stats_user_day").on(t.userId, t.day)]);

// ---------------------------------------------------------------------------
// Restock- & Vorbestell-Radar
// ---------------------------------------------------------------------------
// Beobachtete Produktseiten (Admin): ein Produkt in einem Online-Shop, optional automatisch geprüft
export const restockWatches = pgTable("restock_watches", {
  id: serial().primaryKey(),
  name: text().notNull(),
  setName: text("set_name").notNull().default(""),
  kind: text().notNull().default("display"), // display | etb | ttb | bundle | booster | tin | collection | other
  shop: text().notNull(), // amazon | pokemoncenter | smyths | mueller | mediamarkt | saturn | otto | galeria | thalia | spielemax | cardmarket | other
  url: text().notNull(),
  uvp: numeric({ precision: 10, scale: 2 }),
  releaseDay: date("release_day"),
  autoCheck: boolean("auto_check").notNull().default(true),
  status: text().notNull().default("unknown"), // unknown | in_stock | preorder | out_of_stock
  lastPrice: numeric("last_price", { precision: 10, scale: 2 }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastChangeAt: timestamp("last_change_at", { withTimezone: true }),
  failCount: integer("fail_count").notNull().default(0),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("restock_watches_active").on(t.active, t.lastCheckedAt)]);

// Gemeldete oder automatisch erkannte Drops (Restock oder Vorbestellung)
export const restockDrops = pgTable("restock_drops", {
  id: serial().primaryKey(),
  watchId: integer("watch_id").references(() => restockWatches.id, { onDelete: "set null" }),
  kind: text().notNull().default("restock"), // restock | preorder
  source: text().notNull().default("auto"), // auto | admin | community
  title: text().notNull(),
  shop: text().notNull(),
  url: text().notNull().default(""),
  city: text().notNull().default(""), // nur bei Laden-Meldungen
  price: numeric({ precision: 10, scale: 2 }),
  uvp: numeric({ precision: 10, scale: 2 }),
  reportedBy: text("reported_by").references(() => profiles.userId, { onDelete: "set null" }),
  confirmations: integer().notNull().default(0),
  status: text().notNull().default("pending"), // pending (Community, noch nicht bestätigt) | live | removed
  liveAt: timestamp("live_at", { withTimezone: true }),
  paidNotified: boolean("paid_notified").notNull().default(false),
  freeNotified: boolean("free_notified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("restock_drops_status").on(t.status, t.liveAt)]);

export const restockConfirmations = pgTable("restock_confirmations", {
  id: serial().primaryKey(),
  dropId: integer("drop_id").notNull().references(() => restockDrops.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("restock_confirmations_drop_user").on(t.dropId, t.userId)]);

// Wer Restock-Alarme bekommt (Filter nur für Pro Trader)
export const restockSubscriptions = pgTable("restock_subscriptions", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  enabled: boolean().notNull().default(true),
  preorders: boolean().notNull().default(true),
  shops: text().notNull().default(""), // kommagetrennt, leer = alle
  keywords: text().notNull().default(""), // kommagetrennt, leer = alle
  maxPrice: numeric("max_price", { precision: 10, scale: 2 }),
  uvpOnly: boolean("uvp_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Graded-Portfolio & Grading-Einsendungen
// ---------------------------------------------------------------------------
export const gradedCards = pgTable("graded_cards", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id").references(() => cards.id),
  name: text().notNull(),
  image: text().notNull().default(""),
  company: text().notNull().default("PSA"), // PSA | CGC | BGS | TAG | other
  grade: numeric({ precision: 3, scale: 1 }).notNull(),
  certNumber: text("cert_number").notNull().default(""),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  value: numeric({ precision: 10, scale: 2 }),
  valueUpdatedAt: timestamp("value_updated_at", { withTimezone: true }),
  submissionId: integer("submission_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("graded_cards_user").on(t.userId)]);

export const gradingSubmissions = pgTable("grading_submissions", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  company: text().notNull().default("PSA"),
  service: text().notNull().default(""),
  title: text().notNull().default(""),
  cardCount: integer("card_count").notNull().default(1),
  declaredValue: numeric("declared_value", { precision: 10, scale: 2 }),
  cost: numeric({ precision: 10, scale: 2 }),
  status: text().notNull().default("prep"), // prep | sent | arrived | grading | shipped | done
  sentDay: date("sent_day"),
  expectedDay: date("expected_day"),
  tracking: text().notNull().default(""),
  submissionNumber: text("submission_number").notNull().default(""),
  notes: text().notNull().default(""),
  reminderSent: boolean("reminder_sent").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("grading_submissions_user").on(t.userId), index("grading_submissions_due").on(t.status, t.expectedDay)]);

// Kündigungen über den Kündigungsbutton (§ 312k BGB) – Nachweis mit Eingangszeitpunkt
export const cancellations = pgTable("cancellations", {
  id: serial().primaryKey(),
  reference: text().notNull(), // Kündigungsnummer für die Bestätigung, z. B. K-20261115-7F3A9C
  userId: text("user_id").references(() => profiles.userId, { onDelete: "set null" }),
  name: text().notNull(),
  email: text().notNull(),
  contractRef: text("contract_ref").notNull().default(""),
  kind: text().notNull().default("ordentlich"), // ordentlich | ausserordentlich
  reason: text().notNull().default(""),
  timing: text().notNull().default("next"), // next = nächstmöglicher Zeitpunkt | date = Wunschtermin
  requestedDate: date("requested_date"),
  status: text().notNull().default("received"), // received | applied | no_contract | review
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  verified: boolean().notNull().default(false), // true = beim Absenden angemeldet
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("cancellations_reference").on(t.reference), index("cancellations_email").on(t.email), index("cancellations_user").on(t.userId)]);

// ---------------------------------------------------------------------------
// Virales Wachstum: verfolgte Teilen-Links, Besuche und Empfehlungs-Belohnungen
// ---------------------------------------------------------------------------
export const shareLinks = pgTable("share_links", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  code: text().notNull(), // Kurzcode für /s/<code>
  kind: text().notNull().default("invite"), // invite | card | set | pokemon | sealed | portfolio | pull | trends
  target: text().notNull().default("/"), // eigener Pfad, auf den /s/<code> weiterleitet
  title: text().notNull().default(""),
  clicks: integer().notNull().default(0),
  uniqueVisitors: integer("unique_visitors").notNull().default(0),
  signups: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("share_links_code").on(t.code), uniqueIndex("share_links_user_target").on(t.userId, t.target)]);

export const shareVisits = pgTable("share_visits", {
  id: serial().primaryKey(),
  shareId: integer("share_id").notNull().references(() => shareLinks.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  visitorHash: text("visitor_hash").notNull(), // gehashte IP + Browser (kein Klartext, DSGVO)
  day: date().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("share_visits_share_visitor").on(t.shareId, t.visitorHash), index("share_visits_owner_day").on(t.ownerId, t.day)]);

// Gutgeschriebene Empfehlungs-Belohnungen (Nachweis + verhindert doppelte Gutschrift)
export const referralRewards = pgTable("referral_rewards", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  kind: text().notNull(), // paid_referral | milestone_3 | milestone_5 | milestone_10 | milestone_25
  reference: text().notNull().default(""), // z. B. ID des geworbenen Nutzers
  plan: text().notNull().default("premium"),
  days: integer().notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("referral_rewards_unique").on(t.userId, t.kind, t.reference), index("referral_rewards_user").on(t.userId)]);
