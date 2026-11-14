import { Hono } from "hono";
import { and, desc, eq, gt, sql, inArray, or } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import {
  db, profiles, cards, priceHistory, portfolioItems, portfolioSnapshots, priceAlerts, notifications,
  listings, trades, tradeMessages, reviews, reports, payments, freeBoostUsage, calendarEvents,
} from "../db/index.ts";
import { verifyIdentityToken, ensureProfile, isAdmin, type AuthUser } from "./auth.ts";
import { PLANS, BOOST_DAYS, BOOST_PRICE_CENTS, effectivePlan, type PlanId } from "./plans.ts";
import { registerFeatures, extraMe, applyShopUpdates, activeAlertCount, findSealed, notifySealedListing, trialDays } from "./features.ts";
import { registerGrowth, notifyWishlistListing } from "./growth.ts";
import { CARD_ID_RE, getCard, cardPrice, evaluateAlerts, notify, runTracker } from "./prices.ts";
import { stripe, getOrCreateCustomer, applySubscription, syncProfilePlan } from "./billing.ts";
import { str, money, int, rows, rateLimit, clientIp, sameOriginWrites, securityHeaders, euro, trustedOrigin } from "./util.ts";

type Profile = typeof profiles.$inferSelect;
type Vars = { user: AuthUser; profile: Profile; plan: PlanId };

const app = new Hono<{ Variables: Vars }>();
app.use("/api/*", securityHeaders);
app.use("/api/*", sameOriginWrites);

app.onError((err, c) => {
  console.error("API-Fehler", c.req.method, c.req.path, err);
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
  if (profile.banned && c.req.method !== "GET") return c.json({ error: "Dein Konto ist gesperrt." }, 403);
  if (c.req.method !== "GET" && !rateLimit(`w:${user.id}`, 60, 60_000)) {
    return c.json({ error: "Zu viele Aktionen in kurzer Zeit. Bitte kurz warten." }, 429);
  }
  c.set("user", user);
  c.set("profile", profile);
  c.set("plan", effectivePlan(profile));
  await next();
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

async function freeBoostsLeft(userId: string, plan: PlanId) {
  const allowance = PLANS[plan].freeBoostsPerMonth;
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
    id: user.id,
    email: user.email,
    displayName: profile.displayName,
    city: profile.city,
    plan,
    planInfo: PLANS[plan],
    planUntil: profile.planUntil,
    cancelAtPeriodEnd: profile.cancelAtPeriodEnd,
    isAdmin: isAdmin(user),
    usage: counts,
    rating: await ratingOf(user.id),
    freeBoostsLeft: await freeBoostsLeft(user.id, plan),
    paymentsEnabled: Boolean(stripe()),
    plans: PLANS,
    boost: { priceCents: BOOST_PRICE_CENTS, days: BOOST_DAYS },
    ...(await extraMe(c, profile, plan)),
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
  if (!rateLimit(`card:${clientIp(c)}`, 60, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
  const card = await getCard(id);
  if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
  const history = await db.select({ day: priceHistory.day, trend: priceHistory.trend, avg: priceHistory.avg, low: priceHistory.low })
    .from(priceHistory).where(eq(priceHistory.cardId, id)).orderBy(desc(priceHistory.day)).limit(90);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ card: { ...card, price: cardPrice(card) }, history: history.reverse() });
});

// ---------------------------------------------------------------------------
// Portfolio mit Wertentwicklung
// ---------------------------------------------------------------------------
app.get("/api/portfolio", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const items = await db.select({
    id: portfolioItems.id, cardId: portfolioItems.cardId, name: portfolioItems.name, image: portfolioItems.image,
    quantity: portfolioItems.quantity, purchasePrice: portfolioItems.purchasePrice, manualValue: portfolioItems.manualValue,
    condition: portfolioItems.condition, addedAt: portfolioItems.addedAt,
    trend: cards.trend, avg: cards.avg, low: cards.low, avg7: cards.avg7, avg30: cards.avg30, setName: cards.setName,
    priceUpdatedAt: cards.priceUpdatedAt,
  }).from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId))
    .where(eq(portfolioItems.userId, user.id)).orderBy(desc(portfolioItems.addedAt));

  let total = 0, cost = 0, costCovered = 0;
  const enriched = items.map((i) => {
    const live = cardPrice(i);
    const unit = live || Number(i.manualValue ?? 0);
    const value = unit * i.quantity;
    total += value;
    if (i.purchasePrice !== null) { cost += Number(i.purchasePrice) * i.quantity; costCovered += value; }
    const base = Number(i.avg30 ?? 0);
    const change30 = live && base ? ((live - base) / base) * 100 : null;
    return { ...i, unitValue: unit, value, live: Boolean(live), change30 };
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
  if (b.cardId) {
    const id = str(b.cardId, 40);
    if (!CARD_ID_RE.test(id)) return c.json({ error: "Ungültige Karten-ID" }, 400);
    const card = await getCard(id);
    if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
    cardId = card.id; name = name || card.name; image = card.image;
  }
  if (!name) return c.json({ error: "Bitte einen Kartennamen angeben." }, 400);
  const [item] = await db.insert(portfolioItems).values({
    userId: user.id,
    cardId,
    name,
    image: image || safeImage(b.image),
    quantity: int(b.quantity, 1, 999, 1),
    purchasePrice: money(b.purchasePrice),
    manualValue: money(b.manualValue),
    condition: ["M", "NM", "EX", "GD", "LP", "PL", "PO", "PSA10", "PSA9"].includes(b.condition) ? b.condition : "NM",
  }).returning();
  return c.json(item, 201);
});

app.post("/api/portfolio/import", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const b = await body(c);
  const list = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems).where(eq(portfolioItems.userId, user.id));
  const room = Math.max(0, PLANS[plan].portfolio - Number(r?.n ?? 0));
  const values = list.slice(0, room).map((i: any) => ({
    userId: user.id,
    name: str(i?.name, 120) || "Pokémon Karte",
    image: safeImage(i?.img),
    manualValue: money(i?.value),
  }));
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
    manualValue: portfolioItems.manualValue, trend: cards.trend, setName: cards.setName })
    .from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId)).where(eq(portfolioItems.userId, c.get("user").id));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ["Karte;Set;Anzahl;Einkaufspreis;Marktwert (Trend)"]
    .concat(items.map((i) => [i.name, i.setName, i.quantity, i.purchasePrice, i.trend ?? i.manualValue].map(esc).join(";")))
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
    limit: PLANS[c.get("plan")].alerts,
  });
});

app.post("/api/alerts", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan");
  const b = await body(c);
  const cardId = str(b.cardId, 40);
  const target = money(b.targetPrice);
  if (!CARD_ID_RE.test(cardId) || !target || Number(target) <= 0) return c.json({ error: "Bitte Karte und Zielpreis angeben." }, 400);
  if ((await activeAlertCount(user.id)) >= PLANS[plan].alerts) {
    return c.json({ error: `Limit erreicht: ${PLANS[plan].alerts} Preisalarme im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
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
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 600_000) return "";
  const key = crypto.randomUUID();
  await getStore("listing-images").set(key, new Uint8Array(bytes).buffer, { metadata: { type: m[1], userId } });
  return `/api/images/${key}`;
}

app.get("/api/images/:key", async (c) => {
  const key = c.req.param("key");
  if (!/^[a-f0-9-]{36}$/.test(key)) return c.notFound();
  const res = await getStore("listing-images").getWithMetadata(key, { type: "arrayBuffer" });
  if (!res) return c.notFound();
  return c.body(res.data as ArrayBuffer, 200, {
    "Content-Type": String(res.metadata?.type || "image/jpeg"),
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

// ---------------------------------------------------------------------------
// Marktplatz / Tausch-Hub
// ---------------------------------------------------------------------------
app.get("/api/listings", async (c) => {
  const q = str(c.req.query("q"), 60).toLowerCase();
  const mine = c.req.query("mine") === "1";
  let userFilter = sql``;
  if (mine) {
    const u = await verifyIdentityToken(c);
    if (!u) return c.json({ error: "Bitte melde dich an." }, 401);
    userFilter = sql`AND l.user_id = ${u.id}`;
  }
  const like = `%${q.replace(/[%_\\]/g, "")}%`;
  const list = rows(await db.execute(sql`
    SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.want, l.city, l.created_at, l.user_id,
      l.status, l.sealed_product_id, (l.boosted_until > now()) AS boosted, l.boosted_until,
      p.display_name AS seller,
      (p.plan = 'pro' AND p.plan_until > now()) AS verified,
      COALESCE(c.trend, c.avg)::float AS market_price,
      (SELECT round(avg(r.stars)::numeric, 1)::float FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating,
      (SELECT count(*)::int FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating_count
    FROM listings l
    JOIN profiles p ON p.user_id = l.user_id
    LEFT JOIN cards c ON c.id = l.card_id
    WHERE ${mine ? sql`l.status IN ('active','sold')` : sql`l.status = 'active' AND NOT p.banned`} ${userFilter}
      AND (${q}::text = '' OR lower(l.card_name) LIKE ${like} OR lower(l.city) LIKE ${like})
    ORDER BY (l.boosted_until > now()) DESC NULLS LAST, (p.plan = 'pro' AND p.plan_until > now()) DESC, l.created_at DESC
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
      return { ...l, priceCheck };
    }),
  });
});

app.post("/api/listings", auth, async (c) => {
  const user = c.get("user"), plan = c.get("plan"), profile = c.get("profile");
  const b = await body(c);
  const input: any[] = Array.isArray(b.items) ? b.items.slice(0, 20) : [b];
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(listings)
    .where(and(eq(listings.userId, user.id), eq(listings.status, "active")));
  const room = PLANS[plan].listings - Number(r?.n ?? 0);
  if (room <= 0) {
    return c.json({ error: `Limit erreicht: ${PLANS[plan].listings} aktive Inserate im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
  }
  const created = [];
  for (const it of input.slice(0, room)) {
    const cardName = str(it.card ?? it.cardName, 120);
    const price = money(it.price);
    if (!cardName || price === null) continue;
    let cardId: string | null = null, image = "", sealedProductId: number | null = null;
    if (it.cardId && CARD_ID_RE.test(String(it.cardId))) {
      const card = await getCard(String(it.cardId));
      if (card) { cardId = card.id; image = card.image; }
    } else if (it.sealedProductId) {
      const sp = await findSealed(int(it.sealedProductId, 1, 2 ** 31 - 1, 0));
      if (sp) { sealedProductId = sp.id; image = sp.image; }
    }
    if (typeof it.img === "string" && it.img.startsWith("data:")) image = (await storeDataUrlImage(it.img, user.id)) || image;
    else image = image || safeImage(it.img);
    const [row] = await db.insert(listings).values({
      userId: user.id, cardId, sealedProductId, cardName, image, price,
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

app.get("/api/trades", auth, async (c) => {
  const userId = c.get("user").id;
  const list = rows(await db.execute(sql`
    SELECT t.*, l.card_name AS listing_card, l.image AS listing_image, l.price::float AS listing_price,
      pf.display_name AS from_name, pt.display_name AS to_name,
      EXISTS (SELECT 1 FROM reviews r WHERE r.trade_id = t.id AND r.reviewer_id = ${userId}) AS reviewed,
      (SELECT count(*)::int FROM trade_messages m WHERE m.trade_id = t.id) AS message_count
    FROM trades t
    JOIN profiles pf ON pf.user_id = t.from_user
    JOIN profiles pt ON pt.user_id = t.to_user
    LEFT JOIN listings l ON l.id = t.listing_id
    WHERE t.from_user = ${userId} OR t.to_user = ${userId}
    ORDER BY t.updated_at DESC
    LIMIT 60
  `));
  return c.json({ trades: list.map((t: any) => ({ ...t, role: t.from_user === userId ? "sender" : "receiver" })) });
});

app.post("/api/trades", auth, async (c) => {
  const user = c.get("user"), profile = c.get("profile");
  const b = await body(c);
  const listingId = int(b.listingId, 1, 2 ** 31 - 1, 0);
  const offer = str(b.offer, 400);
  if (!listingId || offer.length < 3) return c.json({ error: "Bitte beschreibe dein Angebot." }, 400);
  const [listing] = await db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.status, "active"))).limit(1);
  if (!listing) return c.json({ error: "Inserat nicht mehr verfügbar." }, 404);
  if (listing.userId === user.id) return c.json({ error: "Das ist dein eigenes Inserat." }, 400);
  const [dup] = await db.select({ id: trades.id }).from(trades).where(and(
    eq(trades.listingId, listingId), eq(trades.fromUser, user.id), inArray(trades.status, ["pending", "accepted"]),
  )).limit(1);
  if (dup) return c.json({ error: "Du hast für dieses Inserat schon eine offene Anfrage.", tradeId: dup.id }, 409);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(trades)
    .where(and(eq(trades.fromUser, user.id), sql`${trades.createdAt} > now() - interval '1 day'`));
  if (Number(r?.n ?? 0) >= 30) return c.json({ error: "Tageslimit für Tauschanfragen erreicht." }, 429);

  const [trade] = await db.insert(trades).values({
    listingId, fromUser: user.id, toUser: listing.userId, offer, request: listing.cardName,
  }).returning();
  const msg = str(b.message, 1000);
  if (msg) await db.insert(tradeMessages).values({ tradeId: trade.id, userId: user.id, body: msg });
  await notify(listing.userId, "🤝 Neue Tauschanfrage", `${profile.displayName} möchte „${listing.cardName}“ – Angebot: ${offer}`, "/?tab=trades");
  return c.json(trade, 201);
});

app.post("/api/trades/:id/action", auth, async (c) => {
  const user = c.get("user"), profile = c.get("profile");
  const b = await body(c);
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  const t = await loadTrade(id, user.id);
  if (!t) return c.json({ error: "Tausch nicht gefunden" }, 404);
  const isReceiver = t.toUser === user.id;
  const other = isReceiver ? t.fromUser : t.toUser;
  const action = String(b.action || "");
  let updates: Partial<typeof trades.$inferInsert> | null = null;
  let message = "";

  if ((action === "accept" || action === "decline") && isReceiver && t.status === "pending") {
    updates = { status: action === "accept" ? "accepted" : "declined" };
    message = action === "accept" ? "✅ Tausch angenommen" : "❌ Tausch abgelehnt";
  } else if (action === "cancel" && ["pending", "accepted"].includes(t.status)) {
    updates = { status: "cancelled" };
    message = "🚫 Tausch abgebrochen";
  } else if (action === "complete" && t.status === "accepted") {
    const fromConfirmed = t.fromConfirmed || !isReceiver;
    const toConfirmed = t.toConfirmed || isReceiver;
    updates = { fromConfirmed, toConfirmed, status: fromConfirmed && toConfirmed ? "completed" : "accepted" };
    message = updates.status === "completed" ? "🏆 Tausch abgeschlossen – bitte bewerten" : "📦 Partner hat den Erhalt bestätigt";
  }
  if (!updates) return c.json({ error: "Diese Aktion ist gerade nicht möglich." }, 409);

  const [updated] = await db.update(trades).set({ ...updates, updatedAt: new Date() }).where(eq(trades.id, id)).returning();
  if (updated.status === "completed" && t.listingId) {
    await db.update(listings).set({ status: "sold" }).where(eq(listings.id, t.listingId));
  }
  await notify(other, message, `${profile.displayName} • ${t.request}`, "/?tab=trades");
  return c.json(updated);
});

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
  if (!rateLimit(`msg:${user.id}`, 20, 60_000)) return c.json({ error: "Bitte nicht so schnell schreiben." }, 429);
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
    displayName: p.displayName, city: p.city, memberSince: p.createdAt,
    verified: effectivePlan(p) === "pro", rating: await ratingOf(id), completedTrades: Number(done?.n ?? 0), reviews: latest,
  });
});

app.post("/api/reports", auth, async (c) => {
  const user = c.get("user");
  if (!rateLimit(`report:${user.id}`, 5, 600_000)) return c.json({ error: "Zu viele Meldungen." }, 429);
  const b = await body(c);
  const targetType = ["listing", "user", "trade", "event"].includes(b.targetType) ? b.targetType : null;
  const reason = str(b.reason, 500);
  if (!targetType || !b.targetId || reason.length < 3) return c.json({ error: "Bitte einen Grund angeben." }, 400);
  await db.insert(reports).values({ reporterId: user.id, targetType, targetId: str(b.targetId, 80), reason });
  return c.json({ ok: true }, 201);
});

// ---------------------------------------------------------------------------
// Zahlungen (Stripe Checkout) – Freischaltung nur nach serverseitiger Prüfung
// ---------------------------------------------------------------------------
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
  if (c.get("plan") === plan && !profile.cancelAtPeriodEnd && (profile.planInterval === "year") === yearly) {
    return c.json({ error: "Dieser Tarif ist bereits aktiv." }, 409);
  }
  const trial = await trialDays(profile);
  const customer = await getOrCreateCustomer(s, profile);
  const origin = appOrigin(c);
  const session = await s.checkout.sessions.create({
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
        recurring: { interval: yearly ? "year" : "month" },
        product_data: {
          name: `PokeSwipe ${PLANS[plan].label}${yearly ? " (Jahresabo)" : ""}`,
          description: yearly ? "Jahresabo, Kündigung zum Laufzeitende jederzeit möglich" : "Monatsabo, jederzeit kündbar",
        },
      },
    }],
    metadata: { userId: profile.userId, kind: "subscription", plan, interval: yearly ? "year" : "month" },
    subscription_data: {
      metadata: { userId: profile.userId, plan },
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

  if ((await freeBoostsLeft(user.id, plan)) > 0) {
    await db.insert(freeBoostUsage).values({ userId: user.id, listingId, month: monthKey() });
    const until = await extendBoost(listingId);
    return c.json({ boosted: true, boostedUntil: until, included: true });
  }

  const s = stripe();
  if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
  const origin = appOrigin(c);
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer: await getOrCreateCustomer(s, profile),
    client_reference_id: user.id,
    locale: "de",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: BOOST_PRICE_CENTS,
        product_data: { name: `Inserat-Boost (${BOOST_DAYS} Tage)`, description: listing.cardName.slice(0, 200) },
      },
    }],
    metadata: { userId: user.id, kind: "boost", listingId: String(listingId) },
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
  if (!result.ok) return c.json({ error: "Zahlung konnte nicht bestätigt werden.", reason: result.reason }, 402);
  return c.json(result);
});

app.post("/api/billing/cancel", auth, async (c) => {
  const s = stripe(), profile = c.get("profile");
  if (!s || !profile.stripeSubscriptionId) return c.json({ error: "Kein aktives Abo." }, 404);
  const resume = (await body(c)).resume === true;
  const sub = await s.subscriptions.update(profile.stripeSubscriptionId, { cancel_at_period_end: !resume });
  const updated = await applySubscription(profile.userId, sub);
  return c.json({ ok: true, cancelAtPeriodEnd: updated?.cancelAtPeriodEnd, planUntil: updated?.planUntil });
});

// Optionaler Stripe-Webhook (aktiv, sobald STRIPE_WEBHOOK_SECRET gesetzt ist)
app.post("/api/billing/webhook", async (c) => {
  const s = stripe(), secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return c.json({ error: "Webhook nicht konfiguriert" }, 503);
  const sig = c.req.header("stripe-signature") || "";
  let event;
  try {
    event = await s.webhooks.constructEventAsync(await c.req.text(), sig, secret);
  } catch {
    return c.json({ error: "Ungültige Signatur" }, 400);
  }
  if (event.type === "checkout.session.completed") {
    await fulfillSession((event.data.object as any).id);
  } else if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as any;
    const userId = sub.metadata?.userId;
    const [p] = userId ? await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1) : [];
    if (p && (!p.stripeSubscriptionId || p.stripeSubscriptionId === sub.id)) await applySubscription(userId, sub);
  }
  return c.json({ received: true });
});

// ---------------------------------------------------------------------------
// Admin: Moderation & Einnahmen-Überblick (Rolle "admin" in Netlify Identity)
// ---------------------------------------------------------------------------
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
app.post("/api/admin/run-tracker", auth, adminOnly, async (c) => c.json(await runTracker({ maxCards: 40 })));

registerFeatures(app, { auth, adminOnly, body, safeImage, storeDataUrlImage, ratingOf });
registerGrowth(app, { auth, adminOnly, body, ratingOf });

app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

// Falls Seitenaufrufe außerhalb von /api beim Server landen: zur App weiterleiten
app.get("/shop/:slug", (c) => c.redirect(`/?shop=${encodeURIComponent(c.req.param("slug").toLowerCase().slice(0, 30))}`, 302));
app.all("*", (c) => (c.req.method === "GET" ? c.redirect("/", 302) : c.json({ error: "Nicht gefunden" }, 404)));

export default app;
