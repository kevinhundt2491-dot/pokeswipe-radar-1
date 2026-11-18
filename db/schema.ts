import { sql } from "drizzle-orm";
import {
  pgTable, pgView, serial, text, timestamp, integer, numeric, boolean, date, index, uniqueIndex, jsonb, doublePrecision,
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
  // Phase 5: Shop-Branding (Banner, Logo, Akzentfarbe)
  shopBanner: text("shop_banner").notNull().default(""),
  shopLogo: text("shop_logo").notNull().default(""),
  shopAccent: text("shop_accent").notNull().default(""),
  // Empfehlungsprogramm
  referralCode: text("referral_code"),
  referredBy: text("referred_by"),
  referralRewarded: boolean("referral_rewarded").notNull().default(false),
  usedTrial: boolean("used_trial").notNull().default(false),
  bonusUntil: timestamp("bonus_until", { withTimezone: true }),
  bonusPlan: text("bonus_plan").notNull().default("premium"), // Tarif während bonusUntil: premium | pro (Stufen-Belohnungen)
  referredVia: integer("referred_via"), // share_links.id, über den die Anmeldung kam
  // Gestaffeltes Empfehlungssystem: Zeitpunkt, an dem der geworbene Nutzer „echt“ wurde (E-Mail bestätigt oder erste Aktion)
  // – erst dann bekommen Werber und Freund ihre Pro-Tage. NULL = ausstehend.
  referralQualifiedAt: timestamp("referral_qualified_at", { withTimezone: true }),
  // „App teilen & 14 Tage Pro testen“ (einmalig)
  shareTrialAt: timestamp("share_trial_at", { withTimezone: true }),
  // Wechsel-Bonus (einmalig beim Import einer Sammlung aus einer anderen App)
  switchBonusAt: timestamp("switch_bonus_at", { withTimezone: true }),
  planInterval: text("plan_interval").notNull().default("month"), // month | year
  // Phase 9: Herkunft des bezahlten Tarifs – stripe (Web/Android) | apple (In-App-Kauf über RevenueCat)
  planSource: text("plan_source").notNull().default("stripe"),
  appStoreOriginalTxId: text("app_store_original_tx_id"),
  // Bindung: tägliche Serie, Bestenliste, Wochen-Report
  streak: integer().notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  lastCheckin: date("last_checkin"),
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  weeklyReport: boolean("weekly_report").notNull().default(true),
  lastWeeklyReport: timestamp("last_weekly_report", { withTimezone: true }),
  // Phase 4: öffentliches Profil /u/<name> (nur mit Zustimmung), Community-Moderation, Stripe-Connect-Verkäuferkonto
  bio: text().notNull().default(""),
  emailConfirmed: boolean("email_confirmed").notNull().default(false),
  publicProfile: boolean("public_profile").notNull().default(false),
  showWishlist: boolean("show_wishlist").notNull().default(true),
  showValueTier: boolean("show_value_tier").notNull().default(false),
  mutedUntil: timestamp("muted_until", { withTimezone: true }),
  stripeAccountId: text("stripe_account_id"),
  stripeAccountReady: boolean("stripe_account_ready").notNull().default(false),
  sellerTermsAt: timestamp("seller_terms_at", { withTimezone: true }),
  // Phase 6: Betrugsschutz – Markierung nach Rückbuchungen (Chargebacks) oder Admin-Prüfung
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  flagReason: text("flag_reason").notNull().default(""),
  chargebacks: integer().notNull().default(0),
  // Phase 7: Direktkauf – privater oder gewerblicher Verkäufer (Art. 246d EGBGB, Widerrufsrecht) und Anbieterangaben
  sellerType: text("seller_type").notNull().default("private"), // private | business
  businessName: text("business_name").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  businessEmail: text("business_email").notNull().default(""),
  businessPhone: text("business_phone").notNull().default(""),
  businessVatId: text("business_vat_id").notNull().default(""),
  businessRegister: text("business_register").notNull().default(""),
  businessUpdatedAt: timestamp("business_updated_at", { withTimezone: true }),
  // Vom Admin freigegebenes Inserate-Limit für Händler mit großem Bestand (überschreibt das Tarif-Limit, wenn höher)
  listingLimitOverride: integer("listing_limit_override"),
  // Profil-Upgrade: Avatar (z. B. von Google/Facebook) und geräteübergreifende App-Einstellungen (Sprache, Ansicht, Marktplatz-Filter)
  avatarUrl: text("avatar_url").notNull().default(""),
  uiPrefs: jsonb("ui_prefs").notNull().default({}),
  // „Freunde einladen“-Belohnung: eigene Karten-Uploads (Binder + Marktplatz), erfolgreiche Einladungs-Anmeldungen
  // und der Zeitpunkt, an dem die Gründer-Sammler-Vorteile freigeschaltet wurden (5 Uploads ODER 1 Anmeldung)
  cardUploads: integer("card_uploads").notNull().default(0),
  referralSignups: integer("referral_signups").notNull().default(0),
  founderAt: timestamp("founder_at", { withTimezone: true }),
  // Live-Online-Radar: Sammlung / Tausch-Karten für andere angemeldete Sammler sichtbar (Binder-Vorschau, jederzeit abschaltbar)
  binderVisible: boolean("binder_visible").notNull().default(true),
  // Creator-Programm: verifiziertes „Creator“-Abzeichen (gesetzt bei Freigabe durch den Admin)
  creatorAt: timestamp("creator_at", { withTimezone: true }),
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
  // Phase 6: getrennter Cardmarket-Preis der Reverse-Holo-Variante (TCGdex-Felder *-holo)
  reverseTrend: numeric("reverse_trend", { precision: 10, scale: 2 }),
  reverseAvg: numeric("reverse_avg", { precision: 10, scale: 2 }),
  reverseLow: numeric("reverse_low", { precision: 10, scale: 2 }),
  reverseAvg7: numeric("reverse_avg7", { precision: 10, scale: 2 }),
  reverseAvg30: numeric("reverse_avg30", { precision: 10, scale: 2 }),
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
  // Phase 6: Preise je Variante in EUR, z. B. {"normal":{"price":1.2,"low":0.8},"reverse_holo":{…},"first_edition":{…}}
  variantPrices: jsonb("variant_prices"),
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
  // Phase 6: Reverse-Holo-Verlauf getrennt
  reverseTrend: numeric("reverse_trend", { precision: 10, scale: 2 }),
  reverseAvg: numeric("reverse_avg", { precision: 10, scale: 2 }),
  reverseLow: numeric("reverse_low", { precision: 10, scale: 2 }),
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
  // Phase 6: Kartenvariante – normal | reverse_holo | holo | first_edition | shadowless | promo
  variant: text().notNull().default("normal"),
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
  // Phase 4: Sofort-Kauf mit Käuferschutz (Treuhand über Stripe Connect)
  buyNow: boolean("buy_now").notNull().default(false),
  shippingCents: integer("shipping_cents").notNull().default(0),
  condition: text().notNull().default(""),
  // Phase 5: Sprache des Drucks (de | en | ja) – für den Sprachfilter in Händler-Shops
  lang: text().notNull().default("de"),
  // Phase 6: Kartenvariante (siehe portfolio_items.variant) und Herkunft aus dem Portfolio
  variant: text().notNull().default("normal"),
  portfolioItemId: integer("portfolio_item_id"),
  // Phase 7: Bestand (Händler), Reservierung während des Checkouts, Herkunft (Bulk-Import) und Druck (EN/JA)
  quantity: integer().notNull().default(1),
  reserved: integer().notNull().default(0),
  externalSku: text("external_sku"),
  source: text().notNull().default("manual"), // manual | csv
  importId: integer("import_id"),
  printId: text("print_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("listings_status").on(t.status, t.createdAt), index("listings_user").on(t.userId),
  uniqueIndex("listings_user_sku").on(t.userId, t.externalSku),
  index("listings_card_buy").on(t.cardId, t.status, t.buyNow),
]);

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
  // Phase 6: strukturierter Tausch (trade_items), Wertausgleich und Versand je Seite
  // status zusätzlich: shipping (angenommen, Versand läuft)
  matchId: integer("match_id"),
  cashCents: integer("cash_cents").notNull().default(0), // Wertausgleich in Cent
  cashPayer: text("cash_payer").notNull().default(""), // from | to | ""
  fromValueCents: integer("from_value_cents").notNull().default(0),
  toValueCents: integer("to_value_cents").notNull().default(0),
  fromCarrier: text("from_carrier").notNull().default(""),
  fromTracking: text("from_tracking").notNull().default(""),
  fromShippedAt: timestamp("from_shipped_at", { withTimezone: true }),
  toCarrier: text("to_carrier").notNull().default(""),
  toTracking: text("to_tracking").notNull().default(""),
  toShippedAt: timestamp("to_shipped_at", { withTimezone: true }),
  fromReceivedAt: timestamp("from_received_at", { withTimezone: true }),
  toReceivedAt: timestamp("to_received_at", { withTimezone: true }),
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
  tradeId: integer("trade_id").references(() => trades.id, { onDelete: "cascade" }),
  // Phase 4: Bewertungen nach Treuhand-Käufen (genau eine von trade_id / order_id ist gesetzt)
  orderId: integer("order_id"),
  reviewerId: text("reviewer_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  revieweeId: text("reviewee_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  stars: integer().notNull(),
  comment: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("reviews_trade_reviewer").on(t.tradeId, t.reviewerId),
  uniqueIndex("reviews_order_reviewer").on(t.orderId, t.reviewerId),
  index("reviews_reviewee").on(t.revieweeId),
]);

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
  // Automatische Preise (Phase 2, Job update-sealed-prices): eBay-Verkäufe/-Angebote + Community-Inserate.
  // price_locked = Admin-Override (CSV/Formular) – der Job lässt den Referenzpreis dann unverändert.
  priceLocked: boolean("price_locked").notNull().default(false),
  autoPrice: numeric("auto_price", { precision: 10, scale: 2 }),
  autoPriceAt: timestamp("auto_price_at", { withTimezone: true }),
  autoPriceSource: text("auto_price_source"), // ebay-sold | ebay-auction | ebay-ask | community
  autoSample: integer("auto_sample").notNull().default(0),
  ebayQuery: text("ebay_query").notNull().default(""), // optionaler Suchbegriff (sonst aus dem Namen gebildet)
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
  // Phase 6: gewünschte Variante ("" = egal)
  variant: text().notNull().default(""),
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
  // Phase 9: Health-Monitor – ok | degraded | paused (nach 3 Fehlversuchen in Folge: „Selektor-Update nötig“)
  health: text().notNull().default("ok"),
  healthReason: text("health_reason").notNull().default(""),
  /** Erfolgreiche Extraktionsstufe: jsonld | meta | selector */
  lastLayer: text("last_layer").notNull().default(""),
  /** Status, der noch eine zweite Bestätigung braucht (unsichere Stufe „selector“) */
  pendingStatus: text("pending_status"),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
}, (t) => [index("restock_watches_active").on(t.active, t.lastCheckedAt)]);

// Phase 9: Beobachter eines Produkts – bekommen Community-Restock-Meldungen zu genau diesem Produkt sofort per Push
export const restockWatchFollows = pgTable("restock_watch_follows", {
  watchId: integer("watch_id").notNull().references(() => restockWatches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("restock_watch_follows_pk").on(t.watchId, t.userId), index("restock_watch_follows_user").on(t.userId)]);

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
  // Ohne Anmeldung: Kündigung wird erst nach Klick auf den Bestätigungslink an die Konto-E-Mail bei Stripe angewendet
  confirmTokenHash: text("confirm_token_hash"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
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

// Video-Promo-Links (?promo=CODE) – vom Admin angelegte Kampagnen-Codes mit Gratis-Pro-Tagen
export const promoCodes = pgTable("promo_codes", {
  id: serial().primaryKey(),
  code: text().notNull(), // GROSSBUCHSTABEN, z. B. START30
  label: text().notNull().default(""), // interner Name, z. B. „TikTok Dario“
  days: integer().notNull().default(30),
  maxRedemptions: integer("max_redemptions"), // NULL = unbegrenzt
  redemptions: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("promo_codes_code").on(t.code)]);

// Einlösungen – höchstens eine pro Code und Konto
export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial().primaryKey(),
  promoId: integer("promo_id").notNull().references(() => promoCodes.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  days: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("promo_redemptions_unique").on(t.promoId, t.userId), index("promo_redemptions_user").on(t.userId)]);

// ---------------------------------------------------------------------------
// Phase 2: Live Flip-Radar, Verkaufspreise (Sold Comps) & PSA-Werte
// ---------------------------------------------------------------------------
// Ziele (Karte, Druck, Sealed), die der Job flip-radar-sync reihum bei eBay abfragt
export const flipTargets = pgTable("flip_targets", {
  id: text().primaryKey(), // "<kind>:<targetId>", z. B. card:sv03.5-199, print:ja:SV2a-201, sealed:12
  targetKind: text("target_kind").notNull(), // card | print | sealed
  targetId: text("target_id").notNull(),
  query: text().notNull().default(""),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastOffers: integer("last_offers").notNull().default(0),
  lastDeals: integer("last_deals").notNull().default(0),
  insightsAt: timestamp("insights_at", { withTimezone: true }),
  errors: integer().notNull().default(0),
}, (t) => [index("flip_targets_synced").on(t.lastSyncedAt)]);

// Echte Einzelangebote (eBay Browse API) mit Abgleich gegen den Referenz-Marktpreis
export const marketOffers = pgTable("market_offers", {
  id: text().primaryKey(), // "ebay:<itemId>"
  source: text().notNull().default("ebay"),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  gradeKey: text("grade_key").notNull().default("raw"), // raw | psa10 | psa9 | psa8 | bgs | cgc | other
  grade: text().notNull().default(""), // Anzeige, z. B. "PSA 10"
  rawCondition: text("raw_condition").notNull().default(""), // nm | lp | dmg | ""
  lang: text(), // de | en | ja | null (aus dem Titel)
  title: text().notNull(),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
  shipping: numeric({ precision: 10, scale: 2 }),
  total: numeric({ precision: 10, scale: 2 }).notNull(),
  buyingOption: text("buying_option").notNull(), // FIXED_PRICE | AUCTION
  bidCount: integer("bid_count").notNull().default(0),
  endAt: timestamp("end_at", { withTimezone: true }),
  itemUrl: text("item_url").notNull(),
  image: text().notNull().default(""),
  seller: text().notNull().default(""),
  sellerFeedbackPct: numeric("seller_feedback_pct", { precision: 5, scale: 1 }),
  sellerFeedbackScore: integer("seller_feedback_score"),
  itemCondition: text("item_condition").notNull().default(""),
  country: text().notNull().default(""),
  refPrice: numeric("ref_price", { precision: 10, scale: 2 }),
  refSource: text("ref_source"), // cardmarket | tcgplayer | sold | sealed
  discountPct: numeric("discount_pct", { precision: 5, scale: 1 }),
  isDeal: boolean("is_deal").notNull().default(false),
  suspicious: boolean().notNull().default(false),
  status: text().notNull().default("active"), // active | gone | ended
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  goneAt: timestamp("gone_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
}, (t) => [
  index("market_offers_target").on(t.targetKind, t.targetId, t.status),
  index("market_offers_deals").on(t.status, t.isDeal, t.discountPct),
]);

// Verkaufte Exemplare (eBay Marketplace Insights, beendete Auktionen mit Geboten, abgeschlossene Tausch-Hub-Verkäufe)
export const soldComps = pgTable("sold_comps", {
  id: serial().primaryKey(),
  externalId: text("external_id").notNull(),
  source: text().notNull(), // ebay-sold | ebay-auction | community
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  gradeKey: text("grade_key").notNull().default("raw"),
  grade: text().notNull().default(""),
  lang: text(),
  title: text().notNull().default(""),
  price: numeric({ precision: 10, scale: 2 }).notNull(), // EUR inkl. Versand
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  url: text().notNull().default(""),
  // Phase 8: Verkäufe im eigenen Marktplatz (source = "pokeswipe") mit Variante, Zustand und Bestellbezug
  variant: text().notNull().default("normal"),
  condition: text().notNull().default(""),
  marketOrderId: integer("market_order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sold_comps_external").on(t.externalId), index("sold_comps_target").on(t.targetKind, t.targetId, t.gradeKey, t.soldAt),
  index("sold_comps_condition").on(t.targetKind, t.targetId, t.variant, t.condition, t.soldAt),
  index("sold_comps_order").on(t.marketOrderId),
]);

// Verdichtete Werte je Zustand/Grading (Median 30/90 Tage, günstigstes aktives Angebot)
export const gradeValues = pgTable("grade_values", {
  id: serial().primaryKey(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  gradeKey: text("grade_key").notNull(),
  median90: numeric("median_90", { precision: 10, scale: 2 }),
  median30: numeric("median_30", { precision: 10, scale: 2 }),
  sample90: integer("sample_90").notNull().default(0),
  sample30: integer("sample_30").notNull().default(0),
  low90: numeric("low_90", { precision: 10, scale: 2 }),
  high90: numeric("high_90", { precision: 10, scale: 2 }),
  askLow: numeric("ask_low", { precision: 10, scale: 2 }),
  askCount: integer("ask_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("grade_values_target_grade").on(t.targetKind, t.targetId, t.gradeKey)]);

// Protokoll der Läufe (Admin-Zentrale)
export const flipSyncRuns = pgTable("flip_sync_runs", {
  id: serial().primaryKey(),
  job: text().notNull(), // flip | sealed
  mode: text().notNull(), // live | demo
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  queries: integer().notNull().default(0),
  offers: integer().notNull().default(0),
  deals: integer().notNull().default(0),
  comps: integer().notNull().default(0),
  updated: integer().notNull().default(0),
  error: text(),
}, (t) => [index("flip_sync_runs_job").on(t.job, t.startedAt)]);

// ---------------------------------------------------------------------------
// Phase 3: On-Device-Scanner – Bild-Fingerabdrücke je Karte/Druck (Referenz für die Erkennung im Browser)
// ---------------------------------------------------------------------------
export const cardHashes = pgTable("card_hashes", {
  id: text().primaryKey(), // "card:<id>" (deutsch) oder "print:<lang>:<id>" (en/ja)
  targetKind: text("target_kind").notNull(), // card | print
  targetId: text("target_id").notNull(),
  lang: text().notNull(), // de | en | ja
  // je 64 Bit als 16 Hex-Zeichen: pHash Artwork, dHash Artwork, pHash ganze Karte
  artP: text("art_p"),
  artD: text("art_d"),
  fullP: text("full_p"),
  sourceImage: text("source_image").notNull().default(""),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer().notNull().default(0),
  error: text(),
}, (t) => [index("card_hashes_lang").on(t.lang), index("card_hashes_target").on(t.targetKind, t.targetId)]);

// ---------------------------------------------------------------------------
// Phase 4: Authentifizierte Community (Pull-Wall, Live-Chat), Follower, Blockieren, Moderation
// ---------------------------------------------------------------------------
export const communityPosts = pgTable("community_posts", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  caption: text().notNull().default(""),
  image: text().notNull().default(""), // /api/images/<uuid> oder TCGdex-Bild
  cardId: text("card_id"),
  status: text().notNull().default("visible"), // visible | hidden (wartet auf Prüfung) | removed
  flagReason: text("flag_reason"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("community_posts_feed").on(t.status, t.id), index("community_posts_user").on(t.userId, t.id)]);

export const communityComments = pgTable("community_comments", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  body: text().notNull(),
  status: text().notNull().default("visible"),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("community_comments_post").on(t.postId, t.id), index("community_comments_user").on(t.userId, t.createdAt)]);

export const communityLikes = pgTable("community_likes", {
  postId: integer("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("community_likes_post_user").on(t.postId, t.userId)]);

export const chatMessages = pgTable("chat_messages", {
  id: serial().primaryKey(),
  room: text().notNull().default("global"),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  body: text().notNull(),
  status: text().notNull().default("visible"),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("chat_messages_room").on(t.room, t.id), index("chat_messages_user").on(t.userId, t.createdAt)]);

export const userBlocks = pgTable("user_blocks", {
  blockerId: text("blocker_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  blockedId: text("blocked_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("user_blocks_pair").on(t.blockerId, t.blockedId), index("user_blocks_blocked").on(t.blockedId)]);

export const follows = pgTable("follows", {
  followerId: text("follower_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  followeeId: text("followee_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("follows_pair").on(t.followerId, t.followeeId), index("follows_followee").on(t.followeeId)]);

// Protokoll aller Moderations-Aktionen (Admins und automatischer Filter)
export const moderationLog = pgTable("moderation_log", {
  id: serial().primaryKey(),
  actorId: text("actor_id"), // null = automatischer Filter
  action: text().notNull(), // hide | restore | remove | mute | unmute | ban | unban | auto_hide | auto_block
  targetType: text("target_type").notNull(), // post | comment | chat | user | listing | order
  targetId: text("target_id").notNull(),
  userId: text("user_id"), // betroffener Nutzer
  reason: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("moderation_log_created").on(t.createdAt), index("moderation_log_user").on(t.userId)]);

// ---------------------------------------------------------------------------
// Phase 4: P2P-Marktplatz mit Treuhand (Stripe Connect Express, getrennte Zahlung & Auszahlung)
// ---------------------------------------------------------------------------
export const marketOrders = pgTable("market_orders", {
  id: serial().primaryKey(),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  buyerId: text("buyer_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  sellerId: text("seller_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  title: text().notNull(),
  image: text().notNull().default(""),
  // offered → awaiting_payment → paid → shipped → released (oder refunded / cancelled / disputed)
  status: text().notNull().default("awaiting_payment"),
  priceCents: integer("price_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  feeCents: integer("fee_cents").notNull().default(0),
  feeBps: integer("fee_bps").notNull().default(0),
  message: text().notNull().default(""),
  stripeSessionId: text("stripe_session_id"),
  paymentIntentId: text("payment_intent_id"),
  chargeId: text("charge_id"),
  transferId: text("transfer_id"),
  refundId: text("refund_id"),
  shippingAddress: text("shipping_address"), // JSON, erst nach Zahlung für den Verkäufer sichtbar
  carrier: text().notNull().default(""),
  trackingNumber: text("tracking_number").notNull().default(""),
  disputeReason: text("dispute_reason").notNull().default(""),
  // Phase 6: Rückbuchung (Stripe-Dispute) – Bestellung eingefroren, Status vorher gemerkt
  frozen: boolean().notNull().default(false),
  stripeDisputeId: text("stripe_dispute_id"),
  disputeStatus: text("dispute_status").notNull().default(""), // "" | open | won | lost
  statusBeforeDispute: text("status_before_dispute").notNull().default(""),
  transferReversalId: text("transfer_reversal_id"),
  payBy: timestamp("pay_by", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  releaseAfter: timestamp("release_after", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  // Phase 7: Teilbestellung eines Warenkorb-Checkouts (eine Zahlung, je Verkäufer eine market_orders-Zeile)
  checkoutId: integer("checkout_id"),
  itemCount: integer("item_count").notNull().default(1),
  // Verkäufertyp zum Kaufzeitpunkt – gewerblich: 14 Tage Widerrufsrecht für Verbraucher
  sellerType: text("seller_type").notNull().default("private"),
  withdrawalUntil: timestamp("withdrawal_until", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawalNote: text("withdrawal_note").notNull().default(""),
  returnTracking: text("return_tracking").notNull().default(""),
  // Treuhand-Härtung: DHL-Sendungsverfolgung. Die Auszahlungsfrist startet erst ab bestätigter Zustellung.
  // tracking_status: "" | pre-transit | transit | delivered | failure | unknown (DHL Unified Tracking API)
  trackingStatus: text("tracking_status").notNull().default(""),
  trackingCheckedAt: timestamp("tracking_checked_at", { withTimezone: true }),
  trackingChecks: integer("tracking_checks").notNull().default(0),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  // Admin-Hinweis „kein Versandnachweis“ (genau einmal je Bestellung)
  trackingAlertAt: timestamp("tracking_alert_at", { withTimezone: true }),
  labelShippedAt: timestamp("label_shipped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("market_orders_checkout").on(t.checkoutId),
  index("market_orders_tracking").on(t.status, t.carrier, t.trackingCheckedAt),
  index("market_orders_buyer").on(t.buyerId, t.createdAt),
  index("market_orders_seller").on(t.sellerId, t.createdAt),
  index("market_orders_status").on(t.status, t.releaseAfter),
  uniqueIndex("market_orders_session").on(t.stripeSessionId),
]);

// ---------------------------------------------------------------------------
// Phase 4: Native App (Capacitor) – Push-Tokens für iOS (APNs über FCM) und Android (FCM)
// ---------------------------------------------------------------------------
export const nativePushTokens = pgTable("native_push_tokens", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  token: text().notNull(),
  platform: text().notNull(), // ios | android
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("native_push_tokens_token").on(t.token), index("native_push_tokens_user").on(t.userId)]);

// ---------------------------------------------------------------------------
// Phase 5: Preference-Learning der Swipe-Arena, geteilte Community-Deals, Sammler-Radar über die eigene API
// ---------------------------------------------------------------------------
// Gelernte Vorlieben je Nutzer: Punktwerte je Merkmal (r:<Seltenheit>, l:<Sprache>, s:<Sprache>:<Set>, p:<Preisband>)
export const swipePreferences = pgTable("swipe_preferences", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  scores: jsonb().notNull().default({}),
  swipes: integer().notNull().default(0),
  likes: integer().notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Von Nutzern gemeldete Schnäppchen (für alle sichtbar, mit Abstimmung „noch da / weg“)
export const communityDeals = pgTable("community_deals", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  title: text().notNull(),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
  url: text().notNull().default(""),
  shop: text().notNull().default(""),
  category: text().notNull().default("singles"), // singles | sealed
  lang: text().notNull().default("de"),
  cardId: text("card_id"),
  marketPrice: numeric("market_price", { precision: 10, scale: 2 }),
  status: text().notNull().default("visible"), // visible | hidden (Prüfung) | removed
  flagReason: text("flag_reason"),
  up: integer().notNull().default(0),
  down: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("community_deals_feed").on(t.status, t.id), index("community_deals_user").on(t.userId, t.createdAt)]);

export const communityDealVotes = pgTable("community_deal_votes", {
  dealId: integer("deal_id").notNull().references(() => communityDeals.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  vote: integer().notNull(), // 1 = noch verfügbar, -1 = weg / kein Deal
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("community_deal_votes_pair").on(t.dealId, t.userId)]);

// Sammler-Radar: ein Pin pro Konto, Koordinaten serverseitig auf ~1 km gerundet
export const radarPins = pgTable("radar_pins", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  name: text().notNull(),
  city: text().notNull(),
  cards: text().notNull(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  status: text().notNull().default("visible"), // visible | hidden | removed
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("radar_pins_updated").on(t.status, t.updatedAt)]);

// ---------------------------------------------------------------------------
// Phase 6: echtes Swipe-Trading, strukturierte Tausche, DAC7, verteiltes Rate-Limiting, Job-Absicherung
// ---------------------------------------------------------------------------
// Rechts-Swipe auf ein Tausch-Inserat = verbindliches Interesse
export const swipeLikes = pgTable("swipe_likes", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  listingId: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  cardId: text("card_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("swipe_likes_user_listing").on(t.userId, t.listingId),
  index("swipe_likes_owner").on(t.ownerId, t.userId),
]);

// Gegenseitiges Interesse zweier Sammler (user_a < user_b, alphabetisch sortiert)
export const tradeMatches = pgTable("trade_matches", {
  id: serial().primaryKey(),
  userA: text("user_a").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  userB: text("user_b").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  // Was A von B möchte / was B von A möchte (Inserat oder doppelte Portfolio-Karte)
  aWantsListingId: integer("a_wants_listing_id").references(() => listings.id, { onDelete: "set null" }),
  bWantsListingId: integer("b_wants_listing_id").references(() => listings.id, { onDelete: "set null" }),
  bWantsPortfolioItemId: integer("b_wants_portfolio_item_id").references(() => portfolioItems.id, { onDelete: "set null" }),
  aWantsPortfolioItemId: integer("a_wants_portfolio_item_id").references(() => portfolioItems.id, { onDelete: "set null" }),
  reason: text().notNull().default("like"), // like | wishlist
  status: text().notNull().default("open"), // open | proposed | traded | dismissed
  tradeId: integer("trade_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("trade_matches_pair_listing").on(t.userA, t.userB, t.aWantsListingId, t.bWantsListingId),
  index("trade_matches_a").on(t.userA, t.status),
  index("trade_matches_b").on(t.userB, t.status),
]);

// Karten eines Tauschs (beide Seiten), Wert beim Angebot eingefroren
export const tradeItems = pgTable("trade_items", {
  id: serial().primaryKey(),
  tradeId: integer("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  side: text().notNull(), // from (bietet der Anfragende) | to (bietet der Inserent)
  ownerId: text("owner_id").notNull(),
  portfolioItemId: integer("portfolio_item_id").references(() => portfolioItems.id, { onDelete: "set null" }),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  cardId: text("card_id"),
  printId: text("print_id"),
  name: text().notNull(),
  image: text().notNull().default(""),
  variant: text().notNull().default("normal"),
  condition: text().notNull().default("NM"),
  lang: text().notNull().default("de"),
  quantity: integer().notNull().default(1),
  valueCents: integer("value_cents").notNull().default(0),
}, (t) => [index("trade_items_trade").on(t.tradeId, t.side)]);

// DAC7 (Plattformen-Steuertransparenzgesetz): Pflichtangaben meldepflichtiger Verkäufer
export const sellerTaxInfo = pgTable("seller_tax_info", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  sellerType: text("seller_type").notNull().default("individual"), // individual | entity
  legalName: text("legal_name").notNull(),
  street: text().notNull(),
  postalCode: text("postal_code").notNull(),
  city: text().notNull(),
  country: text().notNull().default("DE"),
  birthDate: date("birth_date"), // nur Alt-Einträge im Klartext – neue Einträge: birth_date_enc
  // AES-256-GCM verschlüsselt (server/vault.ts): Geburtsdatum, Steuer-ID und IBAN
  birthDateEnc: text("birth_date_enc").notNull().default(""),
  taxId: text("tax_id").notNull(), // Steuer-Identifikationsnummer (TIN) – verschlüsselt
  vatId: text("vat_id").notNull().default(""),
  businessRegNo: text("business_reg_no").notNull().default(""),
  iban: text().notNull().default(""), // verschlüsselt
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// DAC7-Jahreszähler je Verkäufer (wird bei jeder Auszahlung/Erstattung fortgeschrieben)
export const sellerDac7Stats = pgTable("seller_dac7_stats", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  year: integer().notNull(),
  transactions: integer().notNull().default(0),
  grossCents: integer("gross_cents").notNull().default(0),
  feeCents: integer("fee_cents").notNull().default(0),
  refundedCents: integer("refunded_cents").notNull().default(0),
  q1Cents: integer("q1_cents").notNull().default(0),
  q2Cents: integer("q2_cents").notNull().default(0),
  q3Cents: integer("q3_cents").notNull().default(0),
  q4Cents: integer("q4_cents").notNull().default(0),
  remindersSent: integer("reminders_sent").notNull().default(0),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  commercialFlag: boolean("commercial_flag").notNull().default(false),
  // Phase 10: Vorwarnung ab 25 Verkäufen oder 1.700 € (einmal je Jahr) und Markierung für den PStTG-Export ab 30 / 2.000 €
  thresholdWarningSent: boolean("threshold_warning_sent").notNull().default(false),
  thresholdWarningAt: timestamp("threshold_warning_at", { withTimezone: true }),
  reportingRequired: boolean("reporting_required").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("seller_dac7_user_year").on(t.userId, t.year), index("seller_dac7_year").on(t.year, t.grossCents)]);

// PStTG-Jahresübersicht je Verkäufer (Sicht auf seller_dac7_stats – eine Quelle, keine doppelte Zählung)
export const psttgAnnualMetrics = pgView("psttg_annual_metrics", {
  sellerId: text("seller_id").notNull(),
  year: integer().notNull(),
  completedSalesCount: integer("completed_sales_count").notNull(),
  totalGrossEurCents: integer("total_gross_eur_cents").notNull(),
  refundedEurCents: integer("refunded_eur_cents").notNull(),
  platformFeeEurCents: integer("platform_fee_eur_cents").notNull(),
  thresholdWarningSent: boolean("threshold_warning_sent").notNull(),
  reportingRequired: boolean("reporting_required").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).as(sql`SELECT user_id AS seller_id, year, transactions AS completed_sales_count,
  greatest(gross_cents - refunded_cents, 0) AS total_gross_eur_cents, refunded_cents AS refunded_eur_cents,
  fee_cents AS platform_fee_eur_cents, threshold_warning_sent, reporting_required, updated_at
  FROM seller_dac7_stats`);

// Phase 10: Stripe-Connect-Express-Verkäuferkonto (Spiegel des Stripe-Status, aktualisiert per account.updated und Abgleich)
export const sellerAccounts = pgTable("seller_accounts", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  stripeConnectAccountId: text("stripe_connect_account_id").notNull(),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  transfersActive: boolean("transfers_active").notNull().default(false),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending | verified | restricted | disabled
  requirementsDue: jsonb("requirements_due").notNull().default([]),
  disabledReason: text("disabled_reason"),
  psttgTaxDataComplete: boolean("psttg_tax_data_complete").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("seller_accounts_stripe").on(t.stripeConnectAccountId), index("seller_accounts_status").on(t.verificationStatus)]);

// Verteiltes Rate-Limiting (gilt instanzübergreifend)
export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  count: integer().notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (t) => [index("rate_limits_reset").on(t.resetAt)]);

// Zustand der Circuit-Breaker je externer Quelle (TCGdex, eBay, Shops …)
export const jobCircuits = pgTable("job_circuits", {
  name: text().primaryKey(),
  failures: integer().notNull().default(0),
  openUntil: timestamp("open_until", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Laufprotokoll aller geplanten Jobs (Dauer, Ergebnis, Fehler) – Grundlage für Alarme in der Admin-Zentrale
export const jobRuns = pgTable("job_runs", {
  id: serial().primaryKey(),
  job: text().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text().notNull().default("ok"), // ok | partial | error | skipped
  detail: text().notNull().default(""),
}, (t) => [index("job_runs_job").on(t.job, t.startedAt)]);

// Strukturiertes Fehlerprotokoll des Backends
export const errorLog = pgTable("error_log", {
  id: serial().primaryKey(),
  scope: text().notNull(),
  message: text().notNull(),
  context: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("error_log_created").on(t.createdAt), index("error_log_scope").on(t.scope, t.createdAt)]);

// ---------------------------------------------------------------------------
// Phase 7: Direktkauf – Warenkorb, Checkout über mehrere Verkäufer, Auszahlungen, Händler-Bestands-Import
// ---------------------------------------------------------------------------
export const cartItems = pgTable("cart_items", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  listingId: integer("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  quantity: integer().notNull().default(1),
  priceCentsAtAdd: integer("price_cents_at_add").notNull(),
  // Phase 10: Verkäufer der Position und Reservierung während eines laufenden Checkouts (Schutz vor Doppelverkauf)
  sellerId: text("seller_id").references(() => profiles.userId, { onDelete: "cascade" }),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  reservedCheckoutId: integer("reserved_checkout_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("cart_items_user_listing").on(t.userId, t.listingId), index("cart_items_seller").on(t.sellerId)]);

// Ein Checkout = eine Stripe-Zahlung; je Verkäufer entsteht eine Teilbestellung in market_orders (checkout_id)
export const orders = pgTable("orders", {
  id: serial().primaryKey(),
  buyerId: text("buyer_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  status: text().notNull().default("awaiting_payment"), // awaiting_payment | paid | cancelled
  itemsCents: integer("items_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  sellerCount: integer("seller_count").notNull().default(1),
  stripeSessionId: text("stripe_session_id"),
  paymentIntentId: text("payment_intent_id"),
  chargeId: text("charge_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("orders_session").on(t.stripeSessionId), index("orders_buyer").on(t.buyerId, t.createdAt), index("orders_status").on(t.status, t.expiresAt)]);

// Positionen einer Teilbestellung (Snapshot zum Kaufzeitpunkt)
export const orderItems = pgTable("order_items", {
  id: serial().primaryKey(),
  marketOrderId: integer("market_order_id").notNull().references(() => marketOrders.id, { onDelete: "cascade" }),
  checkoutId: integer("checkout_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  cardId: text("card_id"),
  title: text().notNull(),
  image: text().notNull().default(""),
  variant: text().notNull().default("normal"),
  condition: text().notNull().default(""),
  lang: text().notNull().default("de"),
  quantity: integer().notNull(),
  unitCents: integer("unit_cents").notNull(),
}, (t) => [index("order_items_order").on(t.marketOrderId), index("order_items_checkout").on(t.checkoutId)]);

// Auszahlungsprotokoll je Teilbestellung (Transfer an das Connect-Konto, ggf. Rückholung)
export const sellerPayouts = pgTable("seller_payouts", {
  id: serial().primaryKey(),
  marketOrderId: integer("market_order_id").notNull().references(() => marketOrders.id, { onDelete: "cascade" }),
  sellerId: text("seller_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  stripeTransferId: text("stripe_transfer_id").notNull(),
  reversalId: text("reversal_id"),
  status: text().notNull().default("paid"), // paid | reversed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("seller_payouts_transfer").on(t.stripeTransferId), index("seller_payouts_seller").on(t.sellerId, t.createdAt)]);

// Händler-Bestands-Import (CSV im Cardmarket-, TCGplayer- oder freien Format) – verarbeitet in einer Background Function
export const sellerImports = pgTable("seller_imports", {
  id: serial().primaryKey(),
  sellerId: text("seller_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  filename: text().notNull().default(""),
  format: text().notNull().default("generic"), // cardmarket | tcgplayer | generic
  blobKey: text("blob_key").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text().notNull().default("queued"), // queued | running | done | failed
  options: jsonb().notNull().default({}),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  createdRows: integer("created_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  reviewRows: integer("review_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  message: text().notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("seller_imports_seller").on(t.sellerId, t.createdAt)]);

export const sellerImportRows = pgTable("seller_import_rows", {
  id: serial().primaryKey(),
  importId: integer("import_id").notNull().references(() => sellerImports.id, { onDelete: "cascade" }),
  rowNo: integer("row_no").notNull(),
  raw: jsonb().notNull(),
  status: text().notNull(), // created | updated | review | error | skipped | resolved
  listingId: integer("listing_id"),
  candidates: jsonb(),
  message: text().notNull().default(""),
}, (t) => [index("seller_import_rows_import").on(t.importId, t.status)]);

// ---------------------------------------------------------------------------
// Phase 8: Versandetiketten (DHL Parcel DE Shipping API v2) mit den eigenen Geschäftskunden-Zugangsdaten des Händlers
// ---------------------------------------------------------------------------
export const sellerShippingAccounts = pgTable("seller_shipping_accounts", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  provider: text().notNull().default("dhl"),
  username: text().notNull(),
  // AES-256-GCM verschlüsselt (Schlüssel liegt getrennt von der Datenbank in Netlify Blobs)
  passwordEnc: text("password_enc").notNull(),
  ekp: text().notNull(), // 10-stellige DHL-Kundennummer (EKP)
  participation: jsonb().notNull().default({}), // Teilnahme je Produkt, z. B. { "V01PAK": "01", "V62KP": "01" }
  sandbox: boolean().notNull().default(false),
  senderName: text("sender_name").notNull(),
  senderStreet: text("sender_street").notNull(),
  senderHouse: text("sender_house").notNull().default(""),
  senderZip: text("sender_zip").notNull(),
  senderCity: text("sender_city").notNull(),
  senderCountry: text("sender_country").notNull().default("DEU"),
  senderEmail: text("sender_email").notNull().default(""),
  defaultProduct: text("default_product").notNull().default("V62KP"),
  defaultWeightG: integer("default_weight_g").notNull().default(500),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shippingLabels = pgTable("shipping_labels", {
  id: serial().primaryKey(),
  marketOrderId: integer("market_order_id").notNull().references(() => marketOrders.id, { onDelete: "cascade" }),
  sellerId: text("seller_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  provider: text().notNull().default("dhl"),
  product: text().notNull(),
  shipmentNo: text("shipment_no").notNull(),
  weightG: integer("weight_g").notNull(),
  blobKey: text("blob_key").notNull(),
  sandbox: boolean().notNull().default(false),
  status: text().notNull().default("created"), // created | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (t) => [index("shipping_labels_order").on(t.marketOrderId, t.status), uniqueIndex("shipping_labels_shipment").on(t.provider, t.shipmentNo)]);

// ---------------------------------------------------------------------------
// Phase 9: Eigene Preis-Pipeline – verdichtete Marktwerte je Karte, Variante und Stufe
// Stufen: nm | lp | mp | hp | dmg (Rohkarten) und psa8 | psa9 | psa10 (Graded)
// Quellen: TCGdex/Cardmarket-Referenz, eBay-Verkäufe (sold_comps), PokeSwipe-Verkäufe, Graded-Verkäufe (grade_values)
// ---------------------------------------------------------------------------
export const marketValuations = pgTable("market_valuations", {
  id: serial().primaryKey(),
  cardId: text("card_id").notNull(),
  variant: text().notNull().default("normal"),
  tier: text().notNull(),
  value: numeric({ precision: 10, scale: 2 }),
  low: numeric({ precision: 10, scale: 2 }),
  high: numeric({ precision: 10, scale: 2 }),
  /** 0–100: wie belastbar der Wert ist (Anzahl Verkäufe, Alter, Übereinstimmung der Quellen) */
  confidence: integer().notNull().default(0),
  sampleSize: integer("sample_size").notNull().default(0),
  /** Gewichtete Anteile je Quelle, z. B. {"cardmarket":0.6,"ebay":0.3,"pokeswipe":0.1} */
  sources: jsonb().notNull().default({}),
  trend7: doublePrecision("trend_7"),
  trend30: doublePrecision("trend_30"),
  /** Zeitpunkt der jüngsten Quelldaten (für „Zuletzt aktualisiert“) */
  dataAt: timestamp("data_at", { withTimezone: true }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("market_valuations_key").on(t.cardId, t.variant, t.tier), index("market_valuations_computed").on(t.computedAt)]);

export const marketValuationHistory = pgTable("market_valuation_history", {
  id: serial().primaryKey(),
  cardId: text("card_id").notNull(),
  variant: text().notNull().default("normal"),
  tier: text().notNull(),
  day: date().notNull(),
  value: numeric({ precision: 10, scale: 2 }).notNull(),
  confidence: integer().notNull().default(0),
}, (t) => [uniqueIndex("market_valuation_history_key").on(t.cardId, t.variant, t.tier, t.day)]);

// ---------------------------------------------------------------------------
// Phase 9: Selbstlernender Scanner – echte Kamera-Fingerabdrücke bestätigter Scans
// ---------------------------------------------------------------------------
export const scanLearnedHashes = pgTable("scan_learned_hashes", {
  id: serial().primaryKey(),
  /** "card:<id>" oder "print:<lang>:<id>" wie im Scan-Index */
  targetKey: text("target_key").notNull(),
  lang: text().notNull(),
  artP: text("art_p").notNull(),
  artD: text("art_d").notNull(),
  fullP: text("full_p").notNull(),
  /** Farb-Signatur (16 × 4 Bit als Hex) – null bei älteren Clients */
  color: text(),
  /** confirm (Nutzer hat übernommen) | ai (KI-Foto-Scan) | admin */
  source: text().notNull().default("confirm"),
  hits: integer().notNull().default(1),
  /** Unterschiedliche Konten, die diesen Fingerabdruck bestätigt haben */
  confirmations: integer().notNull().default(1),
  /** Im Index aktiv (plausibel zum Referenzbild oder mehrfach bestätigt) */
  active: boolean().notNull().default(false),
  firstUserId: text("first_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("scan_learned_hashes_target").on(t.targetKey), index("scan_learned_hashes_lang").on(t.lang, t.active)]);

export const scanLearnVotes = pgTable("scan_learn_votes", {
  hashId: integer("hash_id").notNull().references(() => scanLearnedHashes.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("scan_learn_votes_pk").on(t.hashId, t.userId)]);

// ---------------------------------------------------------------------------
// Creator-Programm: Bewerbungen (/creator), Creator-Finder & kontrollierter Outreach (Admin-Zentrale)
// ---------------------------------------------------------------------------
export const creatorApplications = pgTable("creator_applications", {
  id: serial().primaryKey(),
  channelName: text("channel_name").notNull(),
  platform: text().notNull(), // youtube | tiktok | instagram | twitch | discord
  channelUrl: text("channel_url").notNull().default(""),
  followers: integer().notNull().default(0),
  email: text().notNull(),
  wishCode: text("wish_code").notNull().default(""),
  promoId: integer("promo_id").references(() => promoCodes.id, { onDelete: "set null" }),
  message: text().notNull().default(""),
  status: text().notNull().default("new"), // new | approved | rejected
  leadId: integer("lead_id"),
  ipHash: text("ip_hash").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("creator_applications_status").on(t.status, t.createdAt)]);

export const creatorLeads = pgTable("creator_leads", {
  id: serial().primaryKey(),
  name: text().notNull(),
  category: text().notNull().default("packopening"), // packopening | flohmarkt | micro | community | top
  platform: text().notNull().default("youtube"),
  channelUrl: text("channel_url").notNull().default(""),
  followers: integer().notNull().default(0),
  email: text().notNull().default(""),
  socials: jsonb().notNull().default([]), // gefundene Social-Handles (Kontakt-Extraktor)
  promoId: integer("promo_id").references(() => promoCodes.id, { onDelete: "set null" }),
  promoCode: text("promo_code").notNull().default(""),
  template: text().notNull().default("A"), // A | B | C | D
  subject: text().notNull().default(""),
  body: text().notNull().default(""),
  customBody: boolean("custom_body").notNull().default(false),
  status: text().notNull().default("ready"), // ready | queued | sent | replied | active | paused | optout
  placeholder: boolean().notNull().default(false), // Platzhalter-Slot aus der Starter-Liste
  source: text().notNull().default("manual"), // seed | manual | application
  notes: text().notNull().default(""),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  followupSentAt: timestamp("followup_sent_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  optoutToken: text("optout_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("creator_leads_status").on(t.status, t.scheduledAt), uniqueIndex("creator_leads_optout").on(t.optoutToken)]);

// Versandprotokoll (Tageslimit & Abstand zwischen E-Mails)
export const creatorOutreachLog = pgTable("creator_outreach_log", {
  id: serial().primaryKey(),
  leadId: integer("lead_id").references(() => creatorLeads.id, { onDelete: "set null" }),
  kind: text().notNull().default("initial"), // initial | followup
  email: text().notNull().default(""),
  ok: boolean().notNull().default(false),
  error: text().notNull().default(""),
  resendId: text("resend_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("creator_outreach_log_created").on(t.createdAt)]);

// Abgemeldete Adressen – erhalten nie wieder Outreach-Mails
export const creatorSuppressions = pgTable("creator_suppressions", {
  email: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Live-Online-Radar: Zuordnung anonyme Firebase-Präsenz ↔ Konto (fälschungssicher über eine geheime Nonce,
// die nur der Besitzer der Firebase-UID in seinen Präsenz-Eintrag schreiben kann)
// ---------------------------------------------------------------------------
export const presenceClaims = pgTable("presence_claims", {
  nonce: text().primaryKey(),
  fbUid: text("fb_uid").notNull(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("presence_claims_fb_user").on(t.fbUid, t.userId)]);
