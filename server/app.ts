import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, desc, eq, gt, sql, inArray, or } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import {
  db, profiles, cards, priceHistory, portfolioItems, portfolioSnapshots, priceAlerts, notifications,
  listings, trades, tradeMessages, reviews, reports, payments, freeBoostUsage, calendarEvents, cardPrints,
} from "../db/index.ts";
import { verifyIdentityToken, ensureProfile, isAdmin, type AuthUser } from "./auth.ts";
import { PLANS, BOOST_DAYS, BOOST_PRICE_CENTS, effectivePlan, listingLimit, type PlanId } from "./plans.ts";
import { registerFeatures, ensureReferralCode, extraMe, applyShopUpdates, activeAlertCount, findSealed, notifySealedListing, trialDays } from "./features.ts";
import { registerGrowth, notifyWishlistListing } from "./growth.ts";
import { registerCollector } from "./collector.ts";
import { registerDrops } from "./drops.ts";
import { registerVoiceover } from "./voiceover.ts";
import { registerMake } from "./make.ts";
import { registerLegal, LEGAL_VERSION } from "./legal.ts";
import { registerCatalog } from "./catalog.ts";
import { registerSeo } from "./seo.ts";
import { registerViral, qualifyReferral } from "./viral.ts";
import { isActiveActionPath } from "./referral-logic.ts";
import { registerIntlCatalog, printForPortfolio } from "./intl-catalog.ts";
import { registerIntegrations, webhookSecrets, recordWebhook } from "./integrations.ts";
import { registerFlip } from "./flip.ts";
import { registerScanIndex } from "./scan-index.ts";
import { registerQuickList } from "./quick-list.ts";
import { registerCommunity, afterCommunityReport, applyModeration, isBlockedBetween, COMMUNITY_TARGETS } from "./community.ts";
import { registerProfiles } from "./profiles.ts";
import { psttgNotice } from "./dac7.ts";
import { registerDemand, notifyOwnersOfWish } from "./demand.ts";
import { registerMarket, syncSellerAccount, fulfillOrderSession, buyNowListingGate, handleDisputeCreated, handleChargeRefunded, handleDisputeUpdated, handleDisputeClosed } from "./market.ts";
import { registerArena } from "./arena.ts";
import { registerCart, fulfillCartSession, expireCheckout } from "./cart.ts";
import { registerSellerImport } from "./seller-import.ts";
import { registerTrading } from "./trading.ts";
import { registerSearch } from "./search.ts";
import { registerDealsRadar } from "./deals-radar.ts";
import { registerShops } from "./shops.ts";
import { registerNative } from "./native.ts";
import { profileSlug } from "./community-logic.ts";
import { sanitizeAvatarUrl, mergePrefs, sanitizePrefs } from "./profile-prefs-logic.ts";
import {
  itemUnitValue, availableVariants, normalizeVariant, normalizeCondition, parseVariant, VARIANT_LABELS, CONDITION_CODES, type VariantPrices,
} from "./variant-logic.ts";
import { CONDITIONS, MARKET_MAX_SHIPPING_CENTS } from "./market-logic.ts";
import { CARD_ID_RE, getCard, cardPrice, evaluateAlerts, notify, runTracker, cardmarketPartnerId } from "./prices.ts";
import { stripe, getOrCreateCustomer, applySubscription, syncProfilePlan, createTaxedCheckout, customerSubscriptions, reconcileCustomer, reconcileSubscriptions } from "./billing.ts";
import { hadTrial } from "./billing-logic.ts";
import { publicCache } from "./cache.ts";
import { str, money, int, rows, rateLimit, clientIp, sameOriginWrites, securityHeaders, euro, trustedOrigin } from "./util.ts";
import { log } from "./log.ts";
import { registerOps } from "./ops.ts";
import { registerFounder, founderInfo, syncFounderQuiet, isFounder } from "./founder.ts";
import { isUploadPath, boostAllowance, alertAllowance } from "./founder-logic.ts";
import { registerBinder } from "./binder.ts";
import { registerConditionPrices } from "./condition-prices.ts";
import { registerValuation, pricesDegraded } from "./valuation.ts";
import { freshnessLabel, isStale } from "./valuation-logic.ts";
import { registerShipping } from "./shipping.ts";
import { registerAlerts } from "./alerts.ts";

type Profile = typeof profiles.$inferSelect;
type Vars = { user: AuthUser; profile: Profile; plan: PlanId };

const app = new Hono<{ Variables: Vars }>();
app.use("/api/*", securityHeaders);
app.use("/api/*", sameOriginWrites);
// Schutz vor übergroßen Anfragen (Speicher-/DoS-Schutz); Bilder werden im Browser vorher verkleinert
app.use("/api/*", bodyLimit({
  maxSize: 6 * 1024 * 1024,
  onError: (c) => c.json({ error: "Die Anfrage ist zu groß. Bitte weniger oder kleinere Bilder senden." }, 413),
}));

// Empfehlungs- und Promo-Links (?ref=CODE / ?promo=CODE) auf öffentlichen Seiten (Karten, Pulls, Einladung …) merken,
// damit der Code auch nach dem Wechsel in die App beim Registrieren ankommt (1st-Party-Cookie, 30 Tage, kein Tracking).
app.use("*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" || c.req.path.startsWith("/api/")) return;
  const ref = c.req.query("ref"), promo = c.req.query("promo");
  const cookie = (k: string, v: string) => {
    c.header("Set-Cookie", `${k}=${encodeURIComponent(v)}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`, { append: true });
    c.header("Cache-Control", "private, no-store"); // persönliche Antwort nie im CDN zwischenspeichern
    c.header("Netlify-CDN-Cache-Control", "no-store");
  };
  if (ref && /^[A-Za-z0-9]{6,10}$/.test(ref)) cookie("ps_ref", ref.toUpperCase());
  if (promo && /^[A-Za-z0-9_-]{3,24}$/.test(promo)) cookie("ps_promo", promo.toUpperCase());
});

app.onError((err, c) => {
  log.error("api", "API-Fehler", { method: c.req.method, path: c.req.path, err });
  return c.json({ error: "Interner Fehler. Bitte später erneut versuchen." }, 500);
});

// ---------------------------------------------------------------------------
// Login-Pflicht
// ---------------------------------------------------------------------------
const auth = async (c: any, next: any) => {
  const user = await verifyIdentityToken(c);
  if (!user) return c.json({ error: "Bitte melde dich an." }, 401);
  let profile = await ensureProfile(user);
  profile = await syncProfilePlan(profile);
  // Bestätigte E-Mail (Netlify Identity) merken – fließt in den Trust-Score der Community ein
  if (user.confirmed && !profile.emailConfirmed) {
    await db.update(profiles).set({ emailConfirmed: true }).where(eq(profiles.userId, user.id));
    profile = { ...profile, emailConfirmed: true };
  }
  if (profile.banned && c.req.method !== "GET") return c.json({ error: "Dein Konto ist gesperrt." }, 403);
  if (c.req.method !== "GET" && !(await rateLimit(`w:${user.id}`, 60, 60_000))) {
    return c.json({ error: "Zu viele Aktionen in kurzer Zeit. Bitte kurz warten." }, 429);
  }
  c.set("user", user);
  c.set("profile", profile);
  c.set("plan", effectivePlan(profile));
  // Gestaffelte Empfehlung: Bonus-Tage für Werber & Freund erst nach bestätigter E-Mail ODER erster aktiver Aktion
  // (Karte scannen, zur Sammlung hinzufügen, auf die Wunschliste setzen)
  const pendingReferral = Boolean(profile.referredBy && !profile.referralQualifiedAt && !profile.banned);
  if (pendingReferral && profile.emailConfirmed) await qualifyReferral(profile.userId, "email").catch((e) => log.warn("viral", "Empfehlung nicht freigeschaltet", { err: e }));
  await next();
  if (pendingReferral && !profile.emailConfirmed && c.res.status < 300 && isActiveActionPath(c.req.method, c.req.path)) {
    await qualifyReferral(profile.userId, "action").catch((e) => log.warn("viral", "Empfehlung nicht freigeschaltet", { err: e }));
  }
  // Gründer-Sammler: nach jedem Karten-Upload (Binder oder Marktplatz) Zähler im Profil aktualisieren & ggf. freischalten
  if (c.res.status < 300 && isUploadPath(c.req.method, c.req.path)) await syncFounderQuiet(profile.userId);
};

const adminOnly = async (c: any, next: any) => {
  if (!isAdmin(c.get("user"))) return c.json({ error: "Nur für Admins." }, 403);
  await next();
};

const body = async (c: any): Promise<Record<string, any>> => {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
};

const monthKey = () => new Date().toISOString().slice(0, 7);

async function freeBoostsLeft(userId: string, plan: PlanId, founder = false) {
  // Gründer-Sammler bekommen zusätzliche Gratis-Boosts (kostenlose Top-Platzierung)
  const allowance = boostAllowance(PLANS[plan].freeBoostsPerMonth, founder);
  if (!allowance) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(freeBoostUsage)
    .where(and(eq(freeBoostUsage.userId, userId), eq(freeBoostUsage.month, monthKey())));
  return Math.max(0, allowance - Number(r?.n ?? 0));
}

async function ratingOf(userId: string) {
  const [r] = await db.select({
    avg: sql<number>`coalesce(round(avg(${reviews.stars})::numeric, 1), 0)::float`,
    count: sql<number>`count(*)::int`,
  }).from(reviews).where(eq(reviews.revieweeId, userId));
  return { avg: Number(r?.avg ?? 0), count: Number(r?.count ?? 0) };
}

app.get("/api/health", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Konto
// ---------------------------------------------------------------------------
app.get("/api/me", auth, async (c) => {
  const user = c.get("user"), profile = c.get("profile"), plan = c.get("plan");
  const [counts] = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM portfolio_items WHERE user_id = ${user.id}) AS portfolio,
      (SELECT count(*)::int FROM price_alerts WHERE user_id = ${user.id} AND active) AS alerts,
      (SELECT count(*)::int FROM listings WHERE user_id = ${user.id} AND status = 'active') AS listings,
      (SELECT count(*)::int FROM notifications WHERE user_id = ${user.id} AND NOT read) AS unread,
      (SELECT count(*)::int FROM trades WHERE (to_user = ${user.id} AND status = 'pending')) AS open_trades
  `));
  return c.json({
    hasBilling: Boolean(profile.stripeCustomerId),
    id: user.id,
    email: user.email,
    displayName: profile.displayName,
    city: profile.city,
    // Profil-Upgrade: Avatar & Einstellungen dauerhaft im Konto (zusätzlich lokal zwischengespeichert)
    avatarUrl: profile.avatarUrl || "",
    prefs: sanitizePrefs(profile.uiPrefs),
    plan,
    planInfo: PLANS[plan],
    planUntil: profile.planUntil,
    cancelAtPeriodEnd: profile.cancelAtPeriodEnd,
    planSource: profile.planSource, // stripe | apple (In-App-Kauf) – Kündigung bei Apple-Abos über die iPhone-Einstellungen
    isAdmin: isAdmin(user),
    emailConfirmed: user.confirmed,
    profileSlug: profileSlug(profile.displayName),
    publicProfile: profile.publicProfile,
    sellerReady: profile.stripeAccountReady,
    // Phase 10: PStTG-Hinweis (ab 25 Verkäufen / 1.700 € im Jahr) – nur für Verkäufer mit Connect-Konto
    psttg: profile.stripeAccountId ? await psttgNotice(user.id).catch(() => null) : null,
    usage: counts,
    rating: await ratingOf(user.id),
    freeBoostsLeft: await freeBoostsLeft(user.id, plan, isFounder(profile)),
    paymentsEnabled: Boolean(stripe()),
    plans: PLANS,
    boost: { priceCents: BOOST_PRICE_CENTS, days: BOOST_DAYS },
    ...(await extraMe(c, profile, plan)),
    // „Freunde einladen & Karten hochladen“: Fortschritt & Gründer-Sammler-Vorteile (Zähler dauerhaft im Profil)
    founder: await founderInfo(user.id).catch(() => null),
    alertLimit: alertAllowance(PLANS[plan].alerts, isFounder(profile)),
  });
});

app.put("/api/me", auth, async (c) => {
  const b = await body(c);
  const user = c.get("user");
  const updates: Partial<Profile> = {};
  if (b.displayName !== undefined) {
    let name = str(b.displayName, 24).replace(/[^\p{L}\p{N}_.\-@]/gu, "");
    if (!name.startsWith("@")) name = "@" + name;
    if (name.length < 4) return c.json({ error: "Der Name braucht mindestens 3 Zeichen." }, 400);
    const [taken] = await db.select({ id: profiles.userId }).from(profiles)
      .where(sql`lower(${profiles.displayName}) = lower(${name}) AND ${profiles.userId} <> ${user.id}`).limit(1);
    if (taken) return c.json({ error: "Dieser Name ist schon vergeben." }, 409);
    updates.displayName = name;
  }
  if (b.city !== undefined) updates.city = str(b.city, 60);
  if (b.avatarUrl !== undefined) {
    const avatar = sanitizeAvatarUrl(b.avatarUrl);
    if (String(b.avatarUrl ?? "").trim() && !avatar) return c.json({ error: "Dieses Profilbild wird nicht unterstützt." }, 400);
    updates.avatarUrl = avatar;
  }
  if (b.prefs !== undefined) updates.uiPrefs = mergePrefs(c.get("profile").uiPrefs, b.prefs);
  const shopError = await applyShopUpdates(b, c.get("profile"), c.get("plan"), updates);
  if (shopError) return c.json({ error: shopError }, 400);
  if (Object.keys(updates).length) await db.update(profiles).set(updates).where(eq(profiles.userId, user.id));
  return c.json({ ok: true, ...updates });
});

// ---------------------------------------------------------------------------
// Karten & Preise (öffentlich)
// ---------------------------------------------------------------------------
app.get("/api/cards/:id", async (c) => {
  const id = c.req.param("id");
  if (!CARD_ID_RE.test(id)) return c.json({ error: "Ungültige Karten-ID" }, 400);
  if (!(await rateLimit(`card:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
  const card = await getCard(id);
  if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
  const history = await db.select({ day: priceHistory.day, trend: priceHistory.trend, avg: priceHistory.avg, low: priceHistory.low })
    .from(priceHistory).where(eq(priceHistory.cardId, id)).orderBy(desc(priceHistory.day)).limit(90);
  publicCache(c, "data"); // öffentlich, ohne Login-/Cookie-Bezug
  const updatedAt = card.priceUpdatedAt ?? card.checkedAt ?? null;
  return c.json({
    card: { ...card, price: cardPrice(card) }, history: history.reverse(),
    // Preise stammen immer aus der eigenen Datenbank – Zeitstempel & Hinweis, falls die Quelle gerade ausfällt
    priceInfo: { updatedAt, freshness: freshnessLabel(updatedAt), stale: isStale(updatedAt), degraded: await pricesDegraded() },
  });
});

// ---------------------------------------------------------------------------
// Portfolio mit Wertentwicklung
// ---------------------------------------------------------------------------
app.get("/api/portfolio", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const items = await db.select({
    id: portfolioItems.id, cardId: portfolioItems.cardId, name: portfolioItems.name, image: portfolioItems.image,
    quantity: portfolioItems.quantity, purchasePrice: portfolioItems.purchasePrice, manualValue: portfolioItems.manualValue,
    condition: portfolioItems.condition, addedAt: portfolioItems.addedAt, lang: portfolioItems.lang, printId: portfolioItems.printId,
    variant: portfolioItems.variant,
    trend: cards.trend, avg: cards.avg, low: cards.low, avg7: cards.avg7, avg30: cards.avg30, setName: cards.setName,
    reverseTrend: cards.reverseTrend, reverseAvg: cards.reverseAvg, reverseLow: cards.reverseLow, reverseAvg30: cards.reverseAvg30,
    availableVariants: cards.variants, priceUpdatedAt: cards.priceUpdatedAt, printVariantPrices: cardPrints.variantPrices,
  }).from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId))
    .leftJoin(cardPrints, eq(cardPrints.id, portfolioItems.printId))
    .where(eq(portfolioItems.userId, user.id)).orderBy(desc(portfolioItems.addedAt));

  let total = 0, cost = 0, costCovered = 0;
  const enriched = items.map(({ printVariantPrices, ...i }) => {
    const v = itemUnitValue(i, i, printVariantPrices as VariantPrices);
    const unit = v.unit;
    const value = unit * i.quantity;
    total += value;
    if (i.purchasePrice !== null) { cost += Number(i.purchasePrice) * i.quantity; costCovered += value; }
    // 30-Tage-Veränderung je Variante (Reverse Holo hat einen eigenen Verlauf)
    const nowRaw = v.variant === "reverse_holo" && v.exactVariant ? Number(i.reverseTrend ?? i.reverseAvg ?? 0) : cardPrice(i);
    const base = Number((v.variant === "reverse_holo" && v.exactVariant ? i.reverseAvg30 : i.avg30) ?? 0);
    const change30 = v.live && nowRaw && base ? ((nowRaw - base) / base) * 100 : null;
    return {
      ...i, variantLabel: VARIANT_LABELS[v.variant], unitValue: unit, value, live: v.live, change30,
      exactVariant: v.exactVariant, conditionFactor: v.conditionFactor, variants: availableVariants(i.availableVariants),
    };
  });

  const movers = enriched.filter((i) => i.change30 !== null)
    .sort((a, b) => Math.abs(b.change30!) - Math.abs(a.change30!)).slice(0, 5);

  const history = PLANS[plan].history
    ? (await db.select({ day: portfolioSnapshots.day, value: portfolioSnapshots.value }).from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.userId, user.id)).orderBy(desc(portfolioSnapshots.day)).limit(180)).reverse()
    : [];

  return c.json({
    items: enriched,
    total,
    cost,
    gain: costCovered - cost,
    gainPct: cost ? ((costCovered - cost) / cost) * 100 : null,
    movers,
    history,
    historyLocked: !PLANS[plan].history,
    limit: PLANS[plan].portfolio,
  });
});

async function checkPortfolioLimit(userId: string, plan: PlanId, adding: number) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems).where(eq(portfolioItems.userId, userId));
  return Number(r?.n ?? 0) + adding <= PLANS[plan].portfolio;
}

app.post("/api/portfolio", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const b = await body(c);
  if (!(await checkPortfolioLimit(user.id, plan, 1))) {
    return c.json({ error: `Limit erreicht (${PLANS[plan].portfolio} Karten im Tarif ${PLANS[plan].label}).`, upgrade: true }, 402);
  }
  let name = str(b.name, 120), image = "", cardId: string | null = null;
  // Mehrsprachiger Katalog: englischer/japanischer Druck (z. B. "ja:SV2a-201")
  let lang = "de", printId: string | null = null, printValue: string | null = null;
  if (b.printId) {
    const print = await printForPortfolio(str(b.printId, 50));
    if (!print) return c.json({ error: "Karte nicht gefunden" }, 404);
    lang = print.lang; printId = print.id; name = name || print.name; image = print.image;
    // Englische Drucke teilen sich das Cardmarket-Produkt mit der deutschen Karte → Live-Wert über cards
    if (print.baseCardId) cardId = print.baseCardId;
    else printValue = print.priceEur;
  } else if (b.cardId) {
    const id = str(b.cardId, 40);
    if (!CARD_ID_RE.test(id)) return c.json({ error: "Ungültige Karten-ID" }, 400);
    const card = await getCard(id);
    if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
    cardId = card.id; name = name || card.name; image = card.image;
  }
  if (!name) return c.json({ error: "Bitte einen Kartennamen angeben." }, 400);
  const variant = parseVariant(b.variant);
  if (!variant) return c.json({ error: "Unbekannte Kartenvariante." }, 400);
  if (b.condition !== undefined && b.condition !== "" && !(CONDITION_CODES as readonly string[]).includes(String(b.condition))) {
    return c.json({ error: "Unbekannter Zustand." }, 400);
  }
  const [item] = await db.insert(portfolioItems).values({
    userId: user.id,
    cardId,
    name,
    image: image || safeImage(b.image),
    quantity: int(b.quantity, 1, 999, 1),
    purchasePrice: money(b.purchasePrice),
    manualValue: money(b.manualValue) ?? printValue,
    condition: normalizeCondition(b.condition),
    lang,
    printId,
    variant,
  }).returning();
  return c.json(item, 201);
});

app.post("/api/portfolio/import", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const b = await body(c);
  const list = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems).where(eq(portfolioItems.userId, user.id));
  const room = Math.max(0, PLANS[plan].portfolio - Number(r?.n ?? 0));
  // CSV-/Listen-Import: Karten-ID (falls erkannt), Anzahl, Variante, Zustand, Sprache und Einkaufspreis übernehmen
  const wanted = list.slice(0, room);
  const ids = [...new Set(wanted.map((i: any) => str(i?.cardId, 40)).filter((id: string) => CARD_ID_RE.test(id)))] as string[];
  const known = ids.length ? await db.select({ id: cards.id, name: cards.name, image: cards.image }).from(cards).where(inArray(cards.id, ids)) : [];
  const knownMap = new Map(known.map((k) => [k.id, k]));
  const values = wanted.map((i: any) => {
    const k = knownMap.get(str(i?.cardId, 40));
    return {
      userId: user.id,
      cardId: k?.id ?? null,
      name: str(i?.name, 120) || k?.name || "Pokémon Karte",
      image: safeImage(i?.img) || k?.image || "",
      quantity: int(i?.quantity, 1, 999, 1),
      manualValue: money(i?.value),
      purchasePrice: money(i?.purchasePrice),
      variant: normalizeVariant(i?.variant),
      condition: normalizeCondition(i?.condition),
      lang: ["de", "en", "ja"].includes(String(i?.lang)) ? String(i.lang) : "de",
    };
  });
  if (values.length) await db.insert(portfolioItems).values(values);
  return c.json({ imported: values.length, skipped: list.length - values.length });
});

app.patch("/api/portfolio/:id", auth, async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const updates: Record<string, any> = {};
  if (b.quantity !== undefined) updates.quantity = int(b.quantity, 1, 999, 1);
  if (b.purchasePrice !== undefined) updates.purchasePrice = money(b.purchasePrice);
  if (b.manualValue !== undefined) updates.manualValue = money(b.manualValue);
  if (b.variant !== undefined) {
    const v = parseVariant(b.variant);
    if (!v) return c.json({ error: "Unbekannte Kartenvariante." }, 400);
    updates.variant = v;
  }
  if (b.condition !== undefined) {
    if (!(CONDITION_CODES as readonly string[]).includes(String(b.condition))) return c.json({ error: "Unbekannter Zustand." }, 400);
    updates.condition = String(b.condition);
  }
  if (!Object.keys(updates).length) return c.json({ error: "Nichts zu ändern." }, 400);
  const [item] = await db.update(portfolioItems).set(updates)
    .where(and(eq(portfolioItems.id, id), eq(portfolioItems.userId, user.id))).returning();
  if (!item) return c.json({ error: "Nicht gefunden" }, 404);
  return c.json(item);
});

app.delete("/api/portfolio/:id", auth, async (c) => {
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  await db.delete(portfolioItems).where(and(eq(portfolioItems.id, id), eq(portfolioItems.userId, c.get("user").id)));
  return c.json({ ok: true });
});

app.get("/api/portfolio/export.csv", auth, async (c) => {
  if (c.get("plan") !== "pro") return c.json({ error: "CSV-Export ist im Pro-Trader-Tarif enthalten.", upgrade: true }, 402);
  const items = await db.select({ name: portfolioItems.name, quantity: portfolioItems.quantity, purchasePrice: portfolioItems.purchasePrice,
    manualValue: portfolioItems.manualValue, trend: cards.trend, avg: cards.avg, low: cards.low, reverseTrend: cards.reverseTrend,
    reverseAvg: cards.reverseAvg, reverseLow: cards.reverseLow, setName: cards.setName, variant: portfolioItems.variant,
    condition: portfolioItems.condition, lang: portfolioItems.lang, printVariantPrices: cardPrints.variantPrices })
    .from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId)).leftJoin(cardPrints, eq(cardPrints.id, portfolioItems.printId))
    .where(eq(portfolioItems.userId, c.get("user").id));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ["Karte;Set;Variante;Zustand;Sprache;Anzahl;Einkaufspreis;Marktwert je Stück"]
    .concat(items.map((i) => {
      const v = itemUnitValue(i, i, i.printVariantPrices as VariantPrices);
      return [i.name, i.setName, VARIANT_LABELS[v.variant], i.condition, i.lang, i.quantity, i.purchasePrice, v.unit ? v.unit.toFixed(2) : ""].map(esc).join(";");
    }))
    .join("\n");
  return c.body("﻿" + csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="pokeswipe-portfolio.csv"',
  });
});

// ---------------------------------------------------------------------------
// Preisalarme & Benachrichtigungen
// ---------------------------------------------------------------------------
app.get("/api/alerts", auth, async (c) => {
  const list = await db.select({
    id: priceAlerts.id, cardId: priceAlerts.cardId, targetPrice: priceAlerts.targetPrice, direction: priceAlerts.direction,
    lastTriggeredAt: priceAlerts.lastTriggeredAt, name: cards.name, image: cards.image, setName: cards.setName,
    trend: cards.trend, avg: cards.avg, low: cards.low, avg7: cards.avg7, avg30: cards.avg30, checkedAt: cards.checkedAt,
  }).from(priceAlerts).innerJoin(cards, eq(cards.id, priceAlerts.cardId))
    .where(and(eq(priceAlerts.userId, c.get("user").id), eq(priceAlerts.active, true))).orderBy(desc(priceAlerts.createdAt));

  const ids = [...new Set(list.map((a) => a.cardId))];
  const hist = ids.length
    ? await db.select({ cardId: priceHistory.cardId, day: priceHistory.day, trend: priceHistory.trend }).from(priceHistory)
        .where(and(inArray(priceHistory.cardId, ids), sql`${priceHistory.day} > CURRENT_DATE - 30`)).orderBy(priceHistory.day)
    : [];
  return c.json({
    alerts: list.map((a) => ({ ...a, price: cardPrice(a), history: hist.filter((h) => h.cardId === a.cardId).map((h) => Number(h.trend)) })),
    limit: alertAllowance(PLANS[c.get("plan")].alerts, isFounder(c.get("profile"))),
  });
});

app.post("/api/alerts", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const b = await body(c);
  const cardId = str(b.cardId, 40);
  const target = money(b.targetPrice);
  if (!CARD_ID_RE.test(cardId) || !target || Number(target) <= 0) return c.json({ error: "Bitte Karte und Zielpreis angeben." }, 400);
  const alertLimit = alertAllowance(PLANS[plan].alerts, isFounder(c.get("profile")));
  if ((await activeAlertCount(user.id)) >= alertLimit) {
    return c.json({ error: `Limit erreicht: ${alertLimit} Preisalarme im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
  }
  const card = await getCard(cardId);
  if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
  const [alert] = await db.insert(priceAlerts).values({
    userId: user.id, cardId: card.id, targetPrice: target, direction: b.direction === "above" ? "above" : "below",
  }).returning();
  await evaluateAlerts(card.id);
  return c.json(alert, 201);
});

app.delete("/api/alerts/:id", auth, async (c) => {
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, c.get("user").id)));
  return c.json({ ok: true });
});

app.get("/api/notifications", auth, async (c) => {
  const userId = c.get("user").id;
  const list = await db.select().from(notifications).where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt)).limit(40);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return c.json({ notifications: list, unread: Number(r?.n ?? 0) });
});

app.post("/api/notifications/read", auth, async (c) => {
  await db.update(notifications).set({ read: true })
    .where(and(eq(notifications.userId, c.get("user").id), eq(notifications.read, false)));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Bilder (Netlify Blobs)
// ---------------------------------------------------------------------------
const ALLOWED_IMAGE_HOSTS = ["assets.tcgdex.net", "images.pokemontcg.io", "raw.githubusercontent.com"];
function safeImage(v: unknown): string {
  const s = str(v, 400);
  if (s.startsWith("/api/images/")) return /^\/api\/images\/[a-f0-9-]{36}$/.test(s) ? s : "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" && ALLOWED_IMAGE_HOSTS.includes(u.hostname) ? u.href : "";
  } catch {
    return "";
  }
}

async function storeDataUrlImage(dataUrl: unknown, userId: string): Promise<string> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return "";
  if (m[2].length > 820_000) return "";
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 600_000) return "";
  // Inhalt muss zum angegebenen Bildtyp passen (Magic Bytes), sonst nicht speichern
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (!((m[1] === "image/jpeg" && isJpeg) || (m[1] === "image/png" && isPng) || (m[1] === "image/webp" && isWebp))) return "";
  const key = crypto.randomUUID();
  await getStore("listing-images").set(key, new Uint8Array(bytes).buffer, { metadata: { type: m[1], userId } });
  return `/api/images/${key}`;
}

app.get("/api/images/:key", async (c) => {
  const key = c.req.param("key");
  if (!/^[a-f0-9-]{36}$/.test(key)) return c.notFound();
  const res = await getStore("listing-images").getWithMetadata(key, { type: "arrayBuffer" });
  if (!res) return c.notFound();
  const type = String(res.metadata?.type || "");
  return c.body(res.data as ArrayBuffer, 200, {
    "Content-Type": ["image/jpeg", "image/png", "image/webp"].includes(type) ? type : "application/octet-stream",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

// ---------------------------------------------------------------------------
// Marktplatz / Tausch-Hub
// ---------------------------------------------------------------------------
app.get("/api/listings", async (c) => {
  const q = str(c.req.query("q"), 60).toLowerCase();
  const mine = c.req.query("mine") === "1";
  // ?ids=1,2,3 – gezielt einzelne Inserate laden (z. B. Angebot zu einer fehlenden Binder-Karte)
  const ids = String(c.req.query("ids") || "").split(",").map((x) => int(x, 1, 2 ** 31 - 1, 0)).filter(Boolean).slice(0, 50);
  const idFilter = ids.length ? sql`AND l.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
  let userFilter = sql``;
  if (mine) {
    const u = await verifyIdentityToken(c);
    if (!u) return c.json({ error: "Bitte melde dich an." }, 401);
    userFilter = sql`AND l.user_id = ${u.id}`;
  }
  const like = `%${q.replace(/[%_\\]/g, "")}%`;
  const list = rows(await db.execute(sql`
    SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.want, l.city, l.created_at, l.user_id,
      l.status, l.sealed_product_id, l.print_id, l.portfolio_item_id, (l.boosted_until > now()) AS boosted, l.boosted_until,
      (l.buy_now AND p.stripe_account_ready) AS buy_now, l.shipping_cents, l.condition, l.variant, l.lang,
      p.display_name AS seller, p.public_profile AS seller_public,
      (SELECT b.badge FROM user_badges b WHERE b.user_id = l.user_id AND b.badge IN ('ref-vip', 'ref-community') ORDER BY (b.badge = 'ref-vip') DESC LIMIT 1) AS seller_badge,
      (p.founder_at IS NOT NULL) AS seller_founder,
      ((p.plan = 'pro' AND p.plan_until > now()) OR (p.bonus_plan = 'pro' AND p.bonus_until > now())) AS verified,
      (CASE WHEN l.variant = 'reverse_holo' THEN COALESCE(c.reverse_trend, c.reverse_avg, c.trend, c.avg) ELSE COALESCE(c.trend, c.avg) END)::float AS market_price,
      (SELECT round(avg(r.stars)::numeric, 1)::float FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating,
      (SELECT count(*)::int FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating_count
    FROM listings l
    JOIN profiles p ON p.user_id = l.user_id
    LEFT JOIN cards c ON c.id = l.card_id
    WHERE ${mine ? sql`l.status IN ('active','sold')` : sql`l.status = 'active' AND NOT p.banned`} ${userFilter} ${idFilter}
      AND (${q}::text = '' OR lower(l.card_name) LIKE ${like} OR lower(l.city) LIKE ${like})
    ORDER BY (l.boosted_until > now()) DESC NULLS LAST, ((p.plan = 'pro' AND p.plan_until > now()) OR (p.bonus_plan = 'pro' AND p.bonus_until > now())) DESC, l.created_at DESC
    LIMIT 80
  `));
  c.header("Cache-Control", "no-store");
  return c.json({
    listings: list.map((l: any) => {
      let priceCheck: string | null = null;
      if (l.market_price) {
        const r = l.price / l.market_price;
        priceCheck = r < 0.85 ? "deal" : r <= 1.1 ? "fair" : "high";
      }
      return { ...l, priceCheck, seller_slug: profileSlug(l.seller), variant_label: VARIANT_LABELS[normalizeVariant(l.variant)] };
    }),
  });
});

app.post("/api/listings", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan"), profile = c.get("profile");
  const b = await body(c);
  // Höchstens 20 Inserate pro Anfrage – mehr wird mit 413 abgelehnt statt stillschweigend abgeschnitten
  if (Array.isArray(b.items) && b.items.length > 20) return c.json({ error: "Höchstens 20 Inserate pro Anfrage – bitte in kleineren Blöcken senden oder den Bestands-Import nutzen.", max: 20 }, 413);
  const input: any[] = Array.isArray(b.items) ? b.items : [b];
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(listings)
    .where(and(eq(listings.userId, user.id), eq(listings.status, "active")));
  const limit = listingLimit(plan, profile.listingLimitOverride);
  const room = limit - Number(r?.n ?? 0);
  if (room <= 0) {
    return c.json({ error: `Limit erreicht: ${limit} aktive Inserate im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
  }
  // Phase 6: Wertgrenze je Vertrauensstufe, Sperre nach Rückbuchung und DAC7-Sperre für Sofort-Kauf-Inserate
  const sellGate = await buyNowListingGate(profile, input.slice(0, room));
  if (sellGate) return c.json({ error: sellGate }, 403);
  const created = [];
  for (const it of input.slice(0, room)) {
    const cardName = str(it.card ?? it.cardName, 120);
    const price = money(it.price);
    if (!cardName || price === null) continue;
    let cardId: string | null = null, image = "", sealedProductId: number | null = null, printId: string | null = null, printLang = "";
    if (it.printId) {
      // Englischer/japanischer Druck (z. B. aus dem Live-Scanner): Bild & Sprache vom Druck, Live-Preis über die deutsche Partnerkarte
      const print = await printForPortfolio(str(it.printId, 50));
      if (print) {
        printId = print.id; printLang = print.lang; image = print.image;
        if (print.baseCardId && CARD_ID_RE.test(print.baseCardId)) cardId = print.baseCardId;
      }
    } else if (it.cardId && CARD_ID_RE.test(String(it.cardId))) {
      const card = await getCard(String(it.cardId));
      if (card) { cardId = card.id; image = card.image; }
    } else if (it.sealedProductId) {
      const sp = await findSealed(int(it.sealedProductId, 1, 2 ** 31 - 1, 0));
      if (sp) { sealedProductId = sp.id; image = sp.image; }
    }
    if (typeof it.img === "string" && it.img.startsWith("data:")) image = (await storeDataUrlImage(it.img, user.id)) || image;
    else image = image || safeImage(it.img);
    // Sofort-Kauf mit Käuferschutz nur mit verifiziertem Stripe-Connect-Verkäuferkonto
    const buyNow = it.buyNow === true && profile.stripeAccountReady && Number(price) >= 1;
    const shippingCents = buyNow ? int(it.shippingCents, 0, MARKET_MAX_SHIPPING_CENTS, 0) : 0;
    const condition = CONDITIONS[String(it.condition || "")] ? String(it.condition) : "";
    // Phase 5: Sprache des Drucks für den DE/EN/JP-Filter in Händler-Shops
    const lang = printLang || (["de", "en", "ja"].includes(String(it.lang)) ? String(it.lang) : "de");
    // Phase 6: Kartenvariante und optionale Verknüpfung mit einem eigenen Portfolio-Eintrag (für strukturierte Tausche)
    const variant = sealedProductId ? "normal" : parseVariant(it.variant);
    if (!variant) return c.json({ error: `„${cardName}“: unbekannte Kartenvariante.` }, 400);
    let portfolioItemId: number | null = null;
    if (it.portfolioItemId !== undefined && it.portfolioItemId !== null && it.portfolioItemId !== "") {
      const pid = int(it.portfolioItemId, 1, 2 ** 31 - 1, 0);
      const [own] = pid ? await db.select({ id: portfolioItems.id }).from(portfolioItems)
        .where(and(eq(portfolioItems.id, pid), eq(portfolioItems.userId, user.id))).limit(1) : [];
      if (!own) return c.json({ error: "Die verknüpfte Karte ist nicht in deiner Sammlung." }, 404);
      portfolioItemId = own.id;
    }
    const [row] = await db.insert(listings).values({
      userId: user.id, cardId, sealedProductId, printId, cardName, image, price, buyNow, shippingCents, condition, lang, variant, portfolioItemId,
      // Herkunft „scan“: aus dem Live-Scanner inseriert (Swipe-Radar zeigt sie als „Frisch gescannt“)
      ...(it.source === "scan" ? { source: "scan" } : {}),
      want: str(it.want, 120) || "Tausch / Gebot",
      city: str(it.city, 60) || profile.city || "Deutschland",
    }).returning();
    created.push(row);

    // Echtzeit-Deal-Alarm: Nutzer benachrichtigen, deren Zielpreis für diese Karte erreicht ist
    if (cardId) {
      const watchers = await db.selectDistinct({ userId: priceAlerts.userId }).from(priceAlerts).where(and(
        eq(priceAlerts.cardId, cardId), eq(priceAlerts.active, true), eq(priceAlerts.direction, "below"),
        sql`${priceAlerts.targetPrice} >= ${price}`, sql`${priceAlerts.userId} <> ${user.id}`,
      ));
      for (const w of watchers.slice(0, 200)) {
        await notify(w.userId, `🤝 Neues Inserat unter deinem Zielpreis`, `${cardName} für ${euro(Number(price))} in ${row.city} (${profile.displayName}).`, "/?tab=map");
      }
    }
  }
  for (const row of created) {
    if (row.sealedProductId) await notifySealedListing(row, profile.displayName, user.id);
    if (row.cardId) await notifyWishlistListing(row, profile.displayName, user.id);
  }
  if (!created.length) return c.json({ error: "Bitte Kartenname und Preis angeben." }, 400);
  return c.json({ created: created.length, skipped: input.length - created.length, listings: created }, 201);
});

app.post("/api/listings/:id/status", auth, async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const status = b.status === "sold" ? "sold" : "removed";
  const owner = isAdmin(user) ? sql`true` : eq(listings.userId, user.id);
  const [row] = await db.update(listings).set({ status }).where(and(eq(listings.id, id), owner)).returning();
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Sicherer Tausch: Anfragen, privater Chat, beidseitige Bestätigung, Bewertungen
// ---------------------------------------------------------------------------
async function loadTrade(id: number, userId: string) {
  const [t] = await db.select().from(trades)
    .where(and(eq(trades.id, id), or(eq(trades.fromUser, userId), eq(trades.toUser, userId)))).limit(1);
  return t;
}

// Liste, strukturierte Anfrage (trade_items) und Statusaktionen: server/trading.ts (registerTrading)

app.get("/api/trades/:id/messages", auth, async (c) => {
  const userId = c.get("user").id;
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const t = await loadTrade(id, userId);
  if (!t) return c.json({ error: "Tausch nicht gefunden" }, 404);
  const after = int(c.req.query("after"), 0, 2 ** 31 - 1, 0);
  const list = await db.select({ id: tradeMessages.id, userId: tradeMessages.userId, body: tradeMessages.body, createdAt: tradeMessages.createdAt, name: profiles.displayName })
    .from(tradeMessages).innerJoin(profiles, eq(profiles.userId, tradeMessages.userId))
    .where(and(eq(tradeMessages.tradeId, id), gt(tradeMessages.id, after))).orderBy(tradeMessages.id).limit(200);
  return c.json({ trade: t, messages: list.map((m) => ({ ...m, mine: m.userId === userId })) });
});

app.post("/api/trades/:id/messages", auth, async (c) => {
  const user = c.get("user"), profile = c.get("profile");
  if (!(await rateLimit(`msg:${user.id}`, 20, 60_000))) return c.json({ error: "Bitte nicht so schnell schreiben." }, 429);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const t = await loadTrade(id, user.id);
  if (!t) return c.json({ error: "Tausch nicht gefunden" }, 404);
  if (["declined", "cancelled"].includes(t.status)) return c.json({ error: "Dieser Tausch ist geschlossen." }, 409);
  const text = str((await body(c)).body, 1000);
  if (!text) return c.json({ error: "Leere Nachricht" }, 400);
  const [m] = await db.insert(tradeMessages).values({ tradeId: id, userId: user.id, body: text }).returning();
  await db.update(trades).set({ updatedAt: new Date() }).where(eq(trades.id, id));
  const other = t.toUser === user.id ? t.fromUser : t.toUser;
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, other), eq(notifications.read, false), sql`${notifications.title} LIKE '💬%'`,
      sql`${notifications.createdAt} > now() - interval '10 minutes'`));
  if (!Number(recent?.n)) await notify(other, `💬 Neue Nachricht von ${profile.displayName}`, text.slice(0, 120), "/?tab=trades");
  return c.json(m, 201);
});

app.post("/api/trades/:id/review", auth, async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const t = await loadTrade(id, user.id);
  if (!t || t.status !== "completed") return c.json({ error: "Bewerten geht erst nach abgeschlossenem Tausch." }, 409);
  const stars = int(b.stars, 1, 5, 0);
  if (!stars) return c.json({ error: "Bitte 1 bis 5 Sterne vergeben." }, 400);
  const reviewee = t.toUser === user.id ? t.fromUser : t.toUser;
  const [rev] = await db.insert(reviews).values({ tradeId: id, reviewerId: user.id, revieweeId: reviewee, stars, comment: str(b.comment, 500) })
    .onConflictDoNothing().returning();
  if (!rev) return c.json({ error: "Du hast diesen Tausch schon bewertet." }, 409);
  await notify(reviewee, `⭐ Neue Bewertung: ${stars}/5`, str(b.comment, 120));
  return c.json(rev, 201);
});

app.get("/api/users/:id", async (c) => {
  const id = str(c.req.param("id"), 80);
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, id)).limit(1);
  if (!p || p.banned) return c.json({ error: "Nicht gefunden" }, 404);
  const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(trades)
    .where(and(eq(trades.status, "completed"), or(eq(trades.fromUser, id), eq(trades.toUser, id))));
  const latest = await db.select({ stars: reviews.stars, comment: reviews.comment, createdAt: reviews.createdAt, reviewer: profiles.displayName })
    .from(reviews).innerJoin(profiles, eq(profiles.userId, reviews.reviewerId))
    .where(eq(reviews.revieweeId, id)).orderBy(desc(reviews.createdAt)).limit(10);
  return c.json({
    id: p.userId, slug: profileSlug(p.displayName), publicProfile: p.publicProfile, sellerVerified: p.stripeAccountReady,
    displayName: p.displayName, city: p.city, memberSince: p.createdAt,
    verified: effectivePlan(p) === "pro", rating: await ratingOf(id), completedTrades: Number(done?.n ?? 0), reviews: latest,
  });
});

app.post("/api/reports", auth, async (c) => {
  const user = c.get("user");
  if (!(await rateLimit(`report:${user.id}`, 5, 600_000))) return c.json({ error: "Zu viele Meldungen." }, 429);
  const b = await body(c);
  const targetType = ["listing", "user", "trade", "event", "order", ...COMMUNITY_TARGETS].includes(b.targetType) ? b.targetType : null;
  const reason = str(b.reason, 500);
  if (!targetType || !b.targetId || reason.length < 3) return c.json({ error: "Bitte einen Grund angeben." }, 400);
  const targetId = str(b.targetId, 80);
  // Pro Nutzer und Ziel nur eine offene Meldung (zählt für das automatische Ausblenden)
  const [dup] = await db.select({ id: reports.id }).from(reports).where(and(eq(reports.reporterId, user.id), eq(reports.targetType, targetType), eq(reports.targetId, targetId), eq(reports.status, "open"))).limit(1);
  if (dup) return c.json({ ok: true, duplicate: true }, 200);
  await db.insert(reports).values({ reporterId: user.id, targetType, targetId, reason });
  await afterCommunityReport(targetType, targetId);
  return c.json({ ok: true }, 201);
});

// ---------------------------------------------------------------------------
// Zahlungen (Stripe Checkout) – Freischaltung nur nach serverseitiger Prüfung
// ---------------------------------------------------------------------------
/** Nachweis der Bestell-Zustimmung (AGB-Version, Zeitpunkt, Verlangen des sofortigen Leistungsbeginns) in Stripe. */
const consentMeta = () => ({ legal_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString(), early_start_requested: "true" });

function appOrigin(c: any) {
  return trustedOrigin(c) || process.env.URL || new URL(c.req.url).origin;
}

app.post("/api/billing/checkout", auth, async (c) => {
  const s = stripe();
  if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
  const b = await body(c);
  const plan = b.plan === "pro" ? "pro" : b.plan === "premium" ? "premium" : null;
  if (!plan) return c.json({ error: "Unbekannter Tarif" }, 400);
  const yearly = b.interval === "year";
  const profile = c.get("profile");
  // Bestellhinweise (AGB, Widerrufsbelehrung, sofortiger Leistungsbeginn) müssen bestätigt sein
  if (b.acceptTerms !== true || b.earlyStart !== true) {
    return c.json({ error: "Bitte bestätige vor der Bestellung die AGB und den sofortigen Leistungsbeginn.", needsConsent: true }, 428);
  }
  if (c.get("plan") === plan && !profile.cancelAtPeriodEnd && (profile.planInterval === "year") === yearly) {
    return c.json({ error: "Dieser Tarif ist bereits aktiv." }, 409);
  }
  const customer = await getOrCreateCustomer(s, profile);
  // Sperre direkt bei Stripe (nicht nur in der App-Datenbank): läuft schon ein Abo, wird es verknüpft,
  // doppelte Abos werden beendet, und es gibt weder ein zweites gleiches Abo noch eine zweite Testphase.
  const existing = await customerSubscriptions(s, customer);
  let trial = await trialDays(profile);
  if (hadTrial(existing.all) || existing.live.length) trial = 0;
  if (existing.live.length) {
    const r = await reconcileCustomer(s, customer, { allSubs: existing.all });
    const kept = existing.live.find((x) => x.id === r.kept);
    const keptInterval = kept?.items?.data?.[0]?.price?.recurring?.interval === "year";
    if (kept && kept.metadata?.plan === plan && keptInterval === yearly && !kept.cancel_at_period_end) {
      return c.json({ error: "Dieses Abo ist bei dir bereits aktiv. Melde dich ab und wieder an, falls es noch nicht angezeigt wird.", relinked: true }, 409);
    }
  }
  const origin = appOrigin(c);
  // Phase 6: Stripe Tax (automatische Umsatzsteuer), Rückfall ohne Steuerberechnung, falls im Dashboard nicht aktiv
  const session = await createTaxedCheckout(s, {
    mode: "subscription",
    customer,
    client_reference_id: profile.userId,
    locale: "de",
    allow_promotion_codes: true,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: yearly ? PLANS[plan].yearlyPriceCents : PLANS[plan].priceCents,
        tax_behavior: "inclusive", // Endpreise inkl. USt (B2C)
        recurring: { interval: yearly ? "year" : "month" },
        product_data: {
          name: `PokeSwipe ${PLANS[plan].label}${yearly ? " (Jahresabo)" : ""}`,
          description: yearly ? "Jahresabo, Kündigung zum Laufzeitende jederzeit möglich" : "Monatsabo, jederzeit kündbar",
        },
      },
    }],
    metadata: { userId: profile.userId, kind: "subscription", plan, interval: yearly ? "year" : "month", ...consentMeta() },
    custom_text: { submit: { message: `${trial ? `Die ersten ${trial} Tage sind kostenlos, danach ` : ""}${euro((yearly ? PLANS[plan].yearlyPriceCents : PLANS[plan].priceCents) / 100)} pro ${yearly ? "Jahr" : "Monat"}, verlängert sich automatisch, jederzeit kündbar. Mit dem Klick schließt du eine zahlungspflichtige Bestellung ab.` } },
    subscription_data: {
      metadata: { userId: profile.userId, plan, ...consentMeta() },
      ...(trial ? { trial_period_days: trial } : {}),
    },
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancel`,
  });
  return c.json({ url: session.url });
});

app.post("/api/billing/boost", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan"), profile = c.get("profile");
  const b = await body(c);
  const listingId = int(b.listingId, 1, 2 ** 31 - 1, 0);
  const [listing] = await db.select().from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.userId, user.id), eq(listings.status, "active"))).limit(1);
  if (!listing) return c.json({ error: "Inserat nicht gefunden" }, 404);

  const allowance = boostAllowance(PLANS[plan].freeBoostsPerMonth, isFounder(profile));
  if ((await freeBoostsLeft(user.id, plan, isFounder(profile))) > 0) {
    // Erst reservieren, dann zählen: parallele Anfragen können das Monatskontingent nicht überschreiten
    const month = monthKey();
    const [usage] = await db.insert(freeBoostUsage).values({ userId: user.id, listingId, month }).returning({ id: freeBoostUsage.id });
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(freeBoostUsage)
      .where(and(eq(freeBoostUsage.userId, user.id), eq(freeBoostUsage.month, month), sql`${freeBoostUsage.id} <= ${usage.id}`));
    if (Number(r?.n ?? 0) <= allowance) {
      const until = await extendBoost(listingId);
      return c.json({ boosted: true, boostedUntil: until, included: true });
    }
    await db.delete(freeBoostUsage).where(eq(freeBoostUsage.id, usage.id));
  }

  const s = stripe();
  if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
  if (b.acceptTerms !== true || b.earlyStart !== true) {
    return c.json({ error: "Bitte bestätige vor der Bestellung die AGB und den sofortigen Leistungsbeginn.", needsConsent: true, kind: "boost" }, 428);
  }
  const origin = appOrigin(c);
  const session = await createTaxedCheckout(s, {
    mode: "payment",
    customer: await getOrCreateCustomer(s, profile),
    client_reference_id: user.id,
    locale: "de",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: BOOST_PRICE_CENTS,
        tax_behavior: "inclusive",
        product_data: { name: `Inserat-Boost (${BOOST_DAYS} Tage)`, description: listing.cardName.slice(0, 200) },
      },
    }],
    metadata: { userId: user.id, kind: "boost", listingId: String(listingId), ...consentMeta() },
    custom_text: { submit: { message: `Einmalig ${euro(BOOST_PRICE_CENTS / 100)} für ${BOOST_DAYS} Tage. Mit dem Klick schließt du eine zahlungspflichtige Bestellung ab.` } },
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancel`,
  });
  return c.json({ url: session.url });
});

async function extendBoost(listingId: number) {
  const [row] = await db.update(listings).set({
    boostedUntil: sql`GREATEST(COALESCE(${listings.boostedUntil}, now()), now()) + make_interval(days => ${BOOST_DAYS}::int)`,
  }).where(eq(listings.id, listingId)).returning();
  return row?.boostedUntil;
}

/** Wendet eine bezahlte Checkout-Session genau einmal an. */
async function fulfillSession(sessionId: string, expectedUserId?: string) {
  const s = stripe();
  if (!s) throw new Error("Stripe fehlt");
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  // Marktplatz-Käufe (Treuhand) laufen getrennt und zählen nicht als Plattform-Umsatz
  if (session.metadata?.kind === "order") return fulfillOrderSession(session, expectedUserId);
  if (session.metadata?.kind === "cart") return fulfillCartSession(session, expectedUserId);
  const userId = session.metadata?.userId;
  if (!userId || session.client_reference_id !== userId) return { ok: false, reason: "invalid" };
  if (expectedUserId && userId !== expectedUserId) return { ok: false, reason: "foreign" };
  if (session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) {
    return { ok: false, reason: "unpaid" };
  }
  const kind = session.metadata?.kind;
  const [inserted] = await db.insert(payments).values({
    userId, stripeSessionId: session.id, kind: kind || "unknown",
    listingId: kind === "boost" ? Number(session.metadata?.listingId) || null : null,
    amountCents: session.amount_total ?? 0,
  }).onConflictDoNothing().returning();

  if (kind === "subscription" && session.subscription && typeof session.subscription === "object") {
    const [before] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (session.subscription.status === "trialing") {
      await db.update(profiles).set({ usedTrial: true }).where(eq(profiles.userId, userId));
    }
    await applySubscription(userId, session.subscription);
    // Beim Tarifwechsel das alte Abo sofort beenden, damit niemand doppelt zahlt
    if (inserted && before?.stripeSubscriptionId && before.stripeSubscriptionId !== session.subscription.id) {
      try { await s.subscriptions.cancel(before.stripeSubscriptionId, { prorate: true }); } catch (e) { console.warn("Altes Abo nicht gekündigt", e); }
    }
    if (inserted) await notify(userId, `👑 ${PLANS[(session.metadata?.plan as PlanId) || "premium"].label} ist aktiv!`, "Danke für deine Unterstützung. Alle Vorteile sind freigeschaltet.");
  } else if (kind === "boost" && inserted) {
    const listingId = Number(session.metadata?.listingId);
    if (listingId) await extendBoost(listingId);
    await notify(userId, "🚀 Boost aktiv", `Dein Inserat steht jetzt ${BOOST_DAYS} Tage ganz oben.`);
  }
  return { ok: true, kind, alreadyProcessed: !inserted };
}

app.post("/api/billing/confirm", auth, async (c) => {
  if (!stripe()) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
  const sessionId = str((await body(c)).sessionId, 200);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return c.json({ error: "Ungültige Sitzung" }, 400);
  const result = await fulfillSession(sessionId, c.get("user").id);
  if (!result.ok) return c.json({ error: "Zahlung konnte nicht bestätigt werden.", reason: (result as any).reason }, 402);
  return c.json(result);
});

app.post("/api/billing/cancel", auth, async (c) => {
  const s = stripe(), profile = c.get("profile");
  if (profile.planSource === "apple" && !profile.stripeSubscriptionId) {
    return c.json({ error: "Dein Abo läuft über den Apple App Store. Kündigen kannst du es auf dem iPhone unter Einstellungen → Apple-ID → Abonnements.", apple: true }, 409);
  }
  if (!s || !profile.stripeSubscriptionId) return c.json({ error: "Kein aktives Abo." }, 404);
  const resume = (await body(c)).resume === true;
  const sub = await s.subscriptions.update(profile.stripeSubscriptionId, { cancel_at_period_end: !resume });
  const updated = await applySubscription(profile.userId, sub);
  return c.json({ ok: true, cancelAtPeriodEnd: updated?.cancelAtPeriodEnd, planUntil: updated?.planUntil });
});

// Phase 6: Stripe-Kundenportal (Zahlungsmethode, Rechnungen, Rechnungsadresse, Abo verwalten)
app.post("/api/billing/portal", auth, async (c) => {
  const s = stripe(), profile = c.get("profile");
  if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
  if (!profile.stripeCustomerId) return c.json({ error: "Für dein Konto gibt es noch keine Zahlungen oder Rechnungen." }, 400);
  if (!(await rateLimit(`portal:${profile.userId}`, 10, 600_000))) return c.json({ error: "Bitte kurz warten und erneut versuchen." }, 429);
  try {
    const portal = await s.billingPortal.sessions.create({ customer: profile.stripeCustomerId, locale: "de", return_url: `${appOrigin(c)}/` });
    return c.json({ url: portal.url });
  } catch (e: any) {
    log.error("billing", "Kundenportal-Sitzung fehlgeschlagen", { userId: profile.userId, err: e });
    const notSetUp = /configuration|portal/i.test(String(e?.message));
    return c.json({ error: notSetUp ? "Das Kundenportal ist im Stripe-Dashboard noch nicht eingerichtet (Einstellungen → Billing → Kundenportal)." : "Das Kundenportal ist gerade nicht erreichbar. Bitte später erneut versuchen." }, 502);
  }
});

// Stripe-Webhook: aktiv, sobald STRIPE_WEBHOOK_SECRET gesetzt ist ODER der Webhook in der Admin-Zentrale
// automatisch eingerichtet wurde (Geheimnis in Netlify Blobs). Kündigungen & Zahlungsausfälle greifen sofort.
async function profileForSubscription(sub: any) {
  const userId = sub?.metadata?.userId;
  if (userId) {
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (p) return p;
  }
  const customer = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  if (!customer) return null;
  const [p] = await db.select().from(profiles).where(eq(profiles.stripeCustomerId, customer)).limit(1);
  return p ?? null;
}

// Signatur-Geheimnisse werden bei jeder Anfrage frisch gelesen: STRIPE_WEBHOOK_SECRET (Netlify-Variable) und/oder
// das per „Stripe-Webhook einrichten“ gespeicherte whsec_…-Geheimnis – der Endpunkt ist sofort nach dem Klick aktiv.
// /api/stripe/webhook ist ein Alias für manuell in Stripe angelegte Endpunkte.
const stripeWebhook = async (c: any) => {
  const s = stripe();
  const secrets = await webhookSecrets();
  if (!s || !secrets.length) {
    console.warn(`Stripe-Webhook abgelehnt: ${!s ? "STRIPE_SECRET_KEY fehlt" : "kein Signatur-Geheimnis – in der Admin-Zentrale unter Integrationen „Stripe-Webhook einrichten“ klicken"}`);
    return c.json({ error: "Webhook nicht konfiguriert" }, 503);
  }
  const sig = c.req.header("stripe-signature") || "";
  const raw = await c.req.text();
  let event: any = null;
  for (const secret of secrets) {
    try { event = await s.webhooks.constructEventAsync(raw, sig, secret); break; } catch {}
  }
  if (!event) { await recordWebhook("", "Ungültige Signatur"); return c.json({ error: "Ungültige Signatur" }, 400); }
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfillSession((event.data.object as any).id);
    } else if (event.type === "checkout.session.expired") {
      // Phase 7: Warenkorb-Checkout nicht bezahlt → Reservierungen sofort freigeben
      const so = event.data.object as any;
      if (so.metadata?.kind === "cart" && Number(so.metadata?.checkoutId)) await expireCheckout(Number(so.metadata.checkoutId));
    } else if (event.type === "payment_intent.succeeded") {
      // Phase 10: Sicherheitsnetz für Treuhand-Zahlungen – Checkout-Session zur Zahlung suchen und abschließen (idempotent)
      const pi = event.data.object as any;
      if (pi.metadata?.kind === "order" || pi.metadata?.kind === "cart") {
        const list = await s.checkout.sessions.list({ payment_intent: String(pi.id), limit: 1 });
        if (list.data[0]) await fulfillSession(list.data[0].id);
      }
    } else if (event.type === "charge.refunded") {
      // Phase 10: Erstattung außerhalb der App (Stripe-Dashboard) → Treuhand-Bestellung schließen bzw. pausieren
      await handleChargeRefunded(event.data.object as any);
    } else if (event.type === "account.updated") {
      // Phase 7: Status eines Connect-Kontos übernehmen (kommt nur bei einem Connect-Endpunkt an; sonst gleicht runCartJobs regelmäßig ab)
      const acct = event.data.object as any;
      const [p] = await db.select().from(profiles).where(eq(profiles.stripeAccountId, String(acct.id))).limit(1);
      if (p) await syncSellerAccount(p);
    } else if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as any;
      const p = await profileForSubscription(sub);
      // Nur das aktuelle Abo darf den Status ändern (alte Abos nach Tarifwechsel werden ignoriert)
      if (p && (!p.stripeSubscriptionId || p.stripeSubscriptionId === sub.id)) await applySubscription(p.userId, sub);
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const inv = event.data.object as any;
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id || inv.parent?.subscription_details?.subscription;
      if (subId) {
        const sub = await s.subscriptions.retrieve(String(subId));
        const p = await profileForSubscription(sub);
        if (p && (!p.stripeSubscriptionId || p.stripeSubscriptionId === sub.id)) {
          await applySubscription(p.userId, sub);
          if (event.type === "invoice.payment_failed") {
            await notify(p.userId, "⚠️ Zahlung fehlgeschlagen", "Die Abbuchung für dein Abo hat nicht geklappt. Bitte prüfe deine Zahlungsmethode – Stripe versucht es automatisch erneut.");
          }
        }
      }
    } else if (event.type === "charge.dispute.created") {
      // Phase 6: Rückbuchungen – Treuhand-Bestellung einfrieren bzw. Abo-Kunden markieren (Logik in server/market.ts)
      await handleDisputeCreated(event.data.object as any);
    } else if (event.type === "charge.dispute.updated") {
      await handleDisputeUpdated(event.data.object as any);
    } else if (event.type === "charge.dispute.closed") {
      await handleDisputeClosed(event.data.object as any);
    }
    await recordWebhook(event.type);
  } catch (e: any) {
    log.error("stripe-webhook", "Webhook-Verarbeitung fehlgeschlagen", { type: event.type, err: e });
    await recordWebhook(event.type, `${event.type}: ${String(e?.message || e)}`);
    return c.json({ error: "Verarbeitung fehlgeschlagen" }, 500); // Stripe wiederholt die Zustellung automatisch
  }
  return c.json({ received: true });
};
app.post("/api/billing/webhook", stripeWebhook);
app.post("/api/stripe/webhook", stripeWebhook);

// ---------------------------------------------------------------------------
// Admin: Moderation & Einnahmen-Überblick (Rolle "admin" in Netlify Identity)
// ---------------------------------------------------------------------------
// Interner Analyse-Bericht (PDF) – liegt nur im Blob-Speicher, nicht im öffentlichen Repository
app.get("/api/admin/report.pdf", auth, adminOnly, async (c) => {
  const pdf = await getStore("admin-files").get("analyse-bericht.pdf", { type: "arrayBuffer" });
  if (!pdf) return c.json({ error: "Kein Bericht hinterlegt." }, 404);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="PokeSwipe-Radar-Analyse.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
});

app.get("/api/admin/overview", auth, adminOnly, async (c) => {
  const [stats] = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM profiles) AS users,
      (SELECT count(*)::int FROM profiles WHERE plan = 'premium' AND plan_until > now()) AS premium,
      (SELECT count(*)::int FROM profiles WHERE plan = 'pro' AND plan_until > now()) AS pro,
      (SELECT count(*)::int FROM profiles WHERE plan = 'premium' AND plan_until > now() AND plan_interval = 'year') AS premium_yearly,
      (SELECT count(*)::int FROM profiles WHERE plan = 'pro' AND plan_until > now() AND plan_interval = 'year') AS pro_yearly,
      (SELECT count(*)::int FROM listings WHERE status = 'active') AS active_listings,
      (SELECT count(*)::int FROM trades WHERE status = 'completed') AS completed_trades,
      (SELECT coalesce(sum(amount_cents), 0)::int FROM payments WHERE created_at > date_trunc('month', now())) AS revenue_month_cents
  `));
  const open = rows(await db.execute(sql`
    SELECT r.*, p.display_name AS reporter FROM reports r JOIN profiles p ON p.user_id = r.reporter_id
    WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 100
  `));
  const mrr = ((stats.premium - stats.premium_yearly) * PLANS.premium.priceCents + stats.premium_yearly * PLANS.premium.yearlyPriceCents / 12
    + (stats.pro - stats.pro_yearly) * PLANS.pro.priceCents + stats.pro_yearly * PLANS.pro.yearlyPriceCents / 12) / 100;
  return c.json({ stats: { ...stats, mrr }, reports: open });
});

app.post("/api/admin/reports/:id", auth, adminOnly, async (c) => {
  const b = await body(c);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const [rep] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!rep) return c.json({ error: "Nicht gefunden" }, 404);
  // Community-Inhalte (Pull-Wall, Kommentare, Chat): Inhalt entfernen bzw. Autor sperren
  if ((COMMUNITY_TARGETS as readonly string[]).includes(rep.targetType)) {
    const actorId = c.get("user").id;
    if (b.removeListing) await applyModeration({ actorId, targetType: rep.targetType, targetId: rep.targetId, action: "remove", reason: rep.reason });
    if (b.banUser) await applyModeration({ actorId, targetType: rep.targetType, targetId: rep.targetId, action: "ban", reason: rep.reason });
    await db.update(reports).set({ status: b.dismiss ? "dismissed" : "resolved" }).where(eq(reports.id, id));
    return c.json({ ok: true });
  }
  if (b.removeListing && rep.targetType === "listing") {
    await db.update(listings).set({ status: "removed" }).where(eq(listings.id, Number(rep.targetId) || 0));
  }
  if (b.removeListing && rep.targetType === "event") {
    await db.update(calendarEvents).set({ status: "removed" }).where(eq(calendarEvents.id, Number(rep.targetId) || 0));
  }
  if (b.banUser) {
    let target = rep.targetType === "user" ? rep.targetId : "";
    if (rep.targetType === "listing") {
      const [l] = await db.select({ userId: listings.userId }).from(listings).where(eq(listings.id, Number(rep.targetId) || 0));
      target = l?.userId || "";
    }
    if (rep.targetType === "event") {
      const [ev] = await db.select({ userId: calendarEvents.createdBy }).from(calendarEvents).where(eq(calendarEvents.id, Number(rep.targetId) || 0));
      target = ev?.userId || "";
    }
    if (target) {
      await db.update(profiles).set({ banned: true }).where(eq(profiles.userId, target));
      await db.update(listings).set({ status: "removed" }).where(and(eq(listings.userId, target), eq(listings.status, "active")));
    }
  }
  await db.update(reports).set({ status: b.dismiss ? "dismissed" : "resolved" }).where(eq(reports.id, id));
  return c.json({ ok: true });
});

// Wird vom geplanten Tracker aufgerufen (und manuell von Admins)
// Abo-Abgleich Stripe → App manuell starten (?dryRun=1 zeigt nur, was passieren würde)
app.post("/api/admin/billing/reconcile", auth, adminOnly, async (c) => {
  const dryRun = c.req.query("dryRun") === "1";
  return c.json(await reconcileSubscriptions({ dryRun, deadlineAt: Date.now() + 25_000 }));
});
app.post("/api/admin/run-tracker", auth, adminOnly, async (c) => c.json(await runTracker({ maxCards: 40 })));

registerShops(app, { auth, body, storeDataUrlImage, ratingOf }); // Phase 5: Händler-Shops mit Branding & OG-Seite (vor registerFeatures)
registerFeatures(app, { auth, adminOnly, body, safeImage, storeDataUrlImage, ratingOf });
registerGrowth(app, { auth, adminOnly, body, ratingOf });
registerCollector(app, { auth, body });
registerDrops(app, { auth, adminOnly, body });
registerLegal(app, { auth, adminOnly, body });
registerSeo(app); // vor registerCatalog: eigene Teil-Sitemaps vor dem Muster /sitemaps/:file
registerCommunity(app, { auth, adminOnly, body, safeImage, storeDataUrlImage });
registerArena(app, { auth, body }); // Phase 5: Preference-Learning & Booster-Simulator
registerTrading(app, { auth, body }); // Phase 6: Swipe-Likes, Matches, strukturierte Tausche
registerSearch(app); // Phase 6: /api/search über den eigenen Katalog (pg_trgm)
registerDealsRadar(app, { auth, body }); // Phase 5: geteilte Community-Deals & Sammler-Radar mit Login-Pflicht
registerProfiles(app, { auth, body }); // ebenfalls vor registerCatalog (/sitemaps/profiles.xml)
registerDemand(app, { auth }); // Marktplatz füllen: Nachfrage aus Wunschlisten → Inserate
registerMarket(app, { auth, adminOnly, body });
// Phase 7: Warenkorb & Checkout über mehrere Verkäufer, Händler-Bestands-Import
registerCart(app, { auth, adminOnly, body });
registerConditionPrices(app); // Phase 8: Preise nach Zustand & Sold Comps aus dem eigenen Marktplatz
registerValuation(app); // Phase 9: eigene Preis-Pipeline (NM … Damaged, PSA 8/9/10) mit Stale-While-Revalidate
registerShipping(app, { auth, body }); // Phase 8: DHL-Versandetiketten mit eigenen Händler-Zugangsdaten
registerAlerts(app, { auth, adminOnly, body }); // Phase 8: Browser-Fehlerberichte, Testalarm, Alarm-Verlauf
registerSellerImport(app, { auth, adminOnly, body });
registerNative(app, { auth, body });
registerCatalog(app, { auth, adminOnly, body });
registerViral(app, { auth, adminOnly, body, ensureCode: ensureReferralCode });
registerIntlCatalog(app, { auth, adminOnly });
registerFlip(app, { auth, adminOnly, body });
registerScanIndex(app, { auth, adminOnly });
registerQuickList(app, { auth, body }); // Schnell-Inserieren aus dem Scanner: faire Preisvorschläge für viele Karten
registerIntegrations(app, { auth, adminOnly });
registerVoiceover(app, { auth, adminOnly, body });
registerMake(app, { auth, adminOnly, body }); // Make.com-Webhook für Auto-Reels (Admin-Zentrale)
registerFounder(app, { auth }); // „Freunde einladen & Karten hochladen“ → Gründer-Sammler-Vorteile
registerBinder(app, { auth }); // Set-Ordner & Binder-Ansicht mit Live-Marktplatz-Abgleich
registerOps(app, { auth, adminOnly }); // Betrieb: Job-Läufe, Circuits & Fehlerprotokoll für Admins

// Öffentliche (nicht geheime) Client-Konfiguration. Der Firebase-Web-API-Schlüssel ist laut Firebase kein
// Geheimnis, sondern nur eine Projekt-Kennung – die Sicherheit kommt aus den Datenbank-Regeln.
app.get("/api/public-config", (c) => {
  const key = (process.env.FIREBASE_WEB_API_KEY || "").trim();
  c.header("Cache-Control", "public, max-age=600");
  // Nur öffentliche Kennungen (keine Geheimnisse): Firebase-Web-Key und Cardmarket-Partnerkürzel
  return c.json({ firebaseApiKey: /^[A-Za-z0-9_-]{20,60}$/.test(key) ? key : null, cardmarketPartnerId: cardmarketPartnerId() || null });
});

app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

// Falls Seitenaufrufe außerhalb von /api beim Server landen: zur App weiterleiten (/shop/<name> rendert server/shops.ts)
app.all("*", (c) => (c.req.method === "GET" ? c.redirect("/", 302) : c.json({ error: "Nicht gefunden" }, 404)));

export default app;
