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
}, (t) => [index("portfolio_user").on(t.userId)]);

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
});

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
