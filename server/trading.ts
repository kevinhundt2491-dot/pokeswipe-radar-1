// Echtes Swipe-Trading (Phase 6)
// • Rechts-Swipe auf ein Tausch-Inserat = verbindlicher swipe_like
// • Bei jedem Like (und jedem neuen Wunschlisten-Eintrag) wird sofort auf gegenseitiges Interesse geprüft:
//   Nutzer B hat ein Inserat von A geliked ODER eine Karte auf der Wunschliste, die A inseriert bzw. doppelt besitzt.
//   Treffer → trade_match + Push an beide + vorausgefüllter, strukturierter Tauschvorschlag mit Marktwert-Vergleich.
// • Tausche bestehen aus strukturierten Positionen (trade_items) aus Portfolio/Inseraten, optional mit Wertausgleich,
//   und durchlaufen Annahme → Versand je Seite (Sendungsnummer) → Erhalt je Seite → Abschluss (Karten wechseln das Portfolio).
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, profiles, listings, portfolioItems, cards, cardPrints, swipeLikes, tradeMatches, tradeItems, trades, tradeMessages,
} from "../db/index.ts";
import { notify } from "./prices.ts";
import { isBlockedBetween } from "./community.ts";
import { str, int, rows, rateLimit } from "./util.ts";
import { itemUnitValue, normalizeVariant, VARIANT_LABELS, type VariantPrices } from "./variant-logic.ts";
import {
  orderPair, tradeBalance, suggestCash, parseCash, tradeTransition, bestCounterpart, TRADE_MAX_ITEMS_PER_SIDE,
  TRADE_STATUS_LABEL, type MatchCandidate, type TradeRole, type TradeStatus,
} from "./trading-logic.ts";
import { trackingUrl } from "./market-logic.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
const ID_MAX = 2 ** 31 - 1;
const cents = (eur: number) => Math.round(eur * 100);

// ---------------------------------------------------------------------------
// Bewertung von Positionen (Marktwert je Variante & Zustand, in Cent)
// ---------------------------------------------------------------------------
async function valuePortfolioItems(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const list = await db.select({
    id: portfolioItems.id, userId: portfolioItems.userId, cardId: portfolioItems.cardId, printId: portfolioItems.printId,
    name: portfolioItems.name, image: portfolioItems.image, quantity: portfolioItems.quantity, variant: portfolioItems.variant,
    condition: portfolioItems.condition, lang: portfolioItems.lang, manualValue: portfolioItems.manualValue,
    trend: cards.trend, avg: cards.avg, low: cards.low, reverseTrend: cards.reverseTrend, reverseAvg: cards.reverseAvg, reverseLow: cards.reverseLow,
    printPrices: cardPrints.variantPrices,
  }).from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId)).leftJoin(cardPrints, eq(cardPrints.id, portfolioItems.printId))
    .where(inArray(portfolioItems.id, ids));
  return new Map(list.map((i) => [i.id, { ...i, valueCents: cents(itemUnitValue(i, i, i.printPrices as VariantPrices).unit) }]));
}

async function valueListings(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const list = await db.select({
    id: listings.id, userId: listings.userId, cardId: listings.cardId, cardName: listings.cardName, image: listings.image,
    price: listings.price, status: listings.status, variant: listings.variant, condition: listings.condition, lang: listings.lang,
    portfolioItemId: listings.portfolioItemId,
    trend: cards.trend, avg: cards.avg, low: cards.low, reverseTrend: cards.reverseTrend, reverseAvg: cards.reverseAvg, reverseLow: cards.reverseLow,
  }).from(listings).leftJoin(cards, eq(cards.id, listings.cardId)).where(inArray(listings.id, ids));
  return new Map(list.map((l) => {
    const v = itemUnitValue(l, { variant: l.variant, condition: l.condition || "NM", manualValue: l.price });
    return [l.id, { ...l, valueCents: cents(v.unit || Number(l.price) || 0) }];
  }));
}

// ---------------------------------------------------------------------------
// Match-Erkennung
// ---------------------------------------------------------------------------
/** Was möchte `wanter` vom `owner`? Likes auf aktive Inserate und Wunschlisten-Treffer (Inserate + doppelte Karten). */
async function interestsOf(wanterId: string, ownerId: string): Promise<MatchCandidate[]> {
  const liked = rows(await db.execute(sql`
    SELECT l.id AS listing_id, COALESCE(c.trend, c.avg, l.price)::float AS value
    FROM swipe_likes s JOIN listings l ON l.id = s.listing_id LEFT JOIN cards c ON c.id = l.card_id
    WHERE s.user_id = ${wanterId} AND s.owner_id = ${ownerId} AND l.status = 'active' AND l.user_id = ${ownerId}
    ORDER BY s.created_at DESC LIMIT 20`));
  const wishListings = rows(await db.execute(sql`
    SELECT l.id AS listing_id, COALESCE(c.trend, c.avg, l.price)::float AS value
    FROM wishlist_items w JOIN listings l ON l.card_id = w.card_id LEFT JOIN cards c ON c.id = l.card_id
    WHERE w.user_id = ${wanterId} AND l.user_id = ${ownerId} AND l.status = 'active'
      AND (w.variant = '' OR w.variant = l.variant)
    LIMIT 20`));
  const wishDupes = rows(await db.execute(sql`
    SELECT p.id AS item_id, COALESCE(c.trend, c.avg, p.manual_value, 0)::float AS value
    FROM wishlist_items w JOIN portfolio_items p ON p.card_id = w.card_id LEFT JOIN cards c ON c.id = p.card_id
    WHERE w.user_id = ${wanterId} AND p.user_id = ${ownerId} AND p.quantity >= 2
      AND (w.variant = '' OR w.variant = p.variant)
    LIMIT 20`));
  return [
    ...liked.map((r: any) => ({ reason: "like" as const, listingId: Number(r.listing_id), portfolioItemId: null, valueCents: cents(Number(r.value) || 0) })),
    ...wishListings.map((r: any) => ({ reason: "wishlist" as const, listingId: Number(r.listing_id), portfolioItemId: null, valueCents: cents(Number(r.value) || 0) })),
    ...wishDupes.map((r: any) => ({ reason: "wishlist" as const, listingId: null, portfolioItemId: Number(r.item_id), valueCents: cents(Number(r.value) || 0) })),
  ];
}

/**
 * Prüft gegenseitiges Interesse zwischen `liker` (möchte `wantedListingId` von `owner`) und `owner`.
 * Legt bei Treffer ein Match an (idempotent) und benachrichtigt beide Seiten genau einmal.
 */
export async function detectMatch(likerId: string, ownerId: string, wanted: { listingId: number | null; portfolioItemId: number | null }) {
  if (likerId === ownerId) return null;
  if (await isBlockedBetween(likerId, ownerId)) return null;
  const counter = bestCounterpart(await interestsOf(ownerId, likerId));
  if (!counter) return null;
  const pair = orderPair(likerId, ownerId);
  // a_wants = was user_a von user_b möchte
  const likerWants = { listingId: wanted.listingId, portfolioItemId: wanted.portfolioItemId };
  const ownerWants = { listingId: counter.listingId, portfolioItemId: counter.portfolioItemId };
  const aWants = pair.swapped ? ownerWants : likerWants;
  const bWants = pair.swapped ? likerWants : ownerWants;

  const [existingOpen] = await db.select().from(tradeMatches).where(and(
    eq(tradeMatches.userA, pair.userA), eq(tradeMatches.userB, pair.userB), inArray(tradeMatches.status, ["open", "proposed"]),
  )).limit(1);
  if (existingOpen) return { match: existingOpen, created: false };

  const [created] = await db.insert(tradeMatches).values({
    userA: pair.userA, userB: pair.userB,
    aWantsListingId: aWants.listingId, aWantsPortfolioItemId: aWants.portfolioItemId,
    bWantsListingId: bWants.listingId, bWantsPortfolioItemId: bWants.portfolioItemId,
    reason: counter.reason,
  }).onConflictDoNothing().returning();
  if (!created) return null;

  const names = await db.select({ id: profiles.userId, name: profiles.displayName }).from(profiles).where(inArray(profiles.userId, [likerId, ownerId]));
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name || "Ein Sammler";
  const link = `/?tab=trades&match=${created.id}`;
  await notify(likerId, "🔥 It's a Match!", `${nameOf(ownerId)} möchte auch etwas von dir. Dein Tauschvorschlag ist vorbereitet.`, link);
  await notify(ownerId, "🔥 It's a Match!", `${nameOf(likerId)} hat deine Karte gewischt – und du suchst etwas von ${nameOf(likerId)}. Tauschvorschlag ansehen.`, link);
  return { match: created, created: true };
}

/** Nach neuem Wunschlisten-Eintrag: Hat jemand, der diese Karte inseriert, schon eines meiner Inserate geliked? */
export async function checkMatchesAfterWishlist(userId: string, cardId: string) {
  const owners = rows(await db.execute(sql`
    SELECT DISTINCT ON (l.user_id) l.user_id, l.id AS listing_id FROM listings l
    WHERE l.card_id = ${cardId} AND l.status = 'active' AND l.user_id <> ${userId}
      AND EXISTS (SELECT 1 FROM swipe_likes s WHERE s.user_id = l.user_id AND s.owner_id = ${userId})
    LIMIT 10`));
  let matches = 0;
  for (const o of owners) {
    const r = await detectMatch(userId, String(o.user_id), { listingId: Number(o.listing_id), portfolioItemId: null });
    if (r?.created) matches++;
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Vorschlag aus einem Match
// ---------------------------------------------------------------------------
async function proposalFor(matchId: number, userId: string) {
  const [m] = await db.select().from(tradeMatches).where(and(
    eq(tradeMatches.id, matchId), or(eq(tradeMatches.userA, userId), eq(tradeMatches.userB, userId)),
  )).limit(1);
  if (!m) return null;
  const meIsA = m.userA === userId;
  const partnerId = meIsA ? m.userB : m.userA;
  const iWant = meIsA ? { l: m.aWantsListingId, p: m.aWantsPortfolioItemId } : { l: m.bWantsListingId, p: m.bWantsPortfolioItemId };
  const theyWant = meIsA ? { l: m.bWantsListingId, p: m.bWantsPortfolioItemId } : { l: m.aWantsListingId, p: m.aWantsPortfolioItemId };
  const listingMap = await valueListings([iWant.l, theyWant.l].filter((x): x is number => !!x));
  const itemMap = await valuePortfolioItems([iWant.p, theyWant.p].filter((x): x is number => !!x));

  const toPosition = (w: { l: number | null; p: number | null }, owner: string) => {
    if (w.l) {
      const l = listingMap.get(w.l);
      if (!l || l.userId !== owner || l.status !== "active") return null;
      return { listingId: l.id, portfolioItemId: l.portfolioItemId ?? null, name: l.cardName, image: l.image, cardId: l.cardId, variant: normalizeVariant(l.variant),
        condition: l.condition || "NM", lang: l.lang, quantity: 1, valueCents: l.valueCents };
    }
    if (w.p) {
      const i = itemMap.get(w.p);
      if (!i || i.userId !== owner) return null;
      return { listingId: null, portfolioItemId: i.id, name: i.name, image: i.image, cardId: i.cardId, variant: normalizeVariant(i.variant),
        condition: i.condition, lang: i.lang, quantity: 1, valueCents: i.valueCents };
    }
    return null;
  };
  const want = toPosition(iWant, partnerId);
  // Was der Partner von mir möchte: sein Like auf mein Inserat – das Inserat zeigt idealerweise auf ein Portfolio-Stück
  const give = toPosition(theyWant, userId);
  const giveList = give ? [give] : [];
  const wantList = want ? [want] : [];
  const balance = tradeBalance(giveList, wantList);
  const cash = suggestCash(balance.fromValue, balance.toValue);
  const [partner] = await db.select({ name: profiles.displayName, city: profiles.city }).from(profiles).where(eq(profiles.userId, partnerId)).limit(1);
  return {
    match: { id: m.id, status: m.status, reason: m.reason, createdAt: m.createdAt, tradeId: m.tradeId },
    partner: { id: partnerId, name: partner?.name || "Sammler", city: partner?.city || "" },
    give: giveList.map((x) => ({ ...x, variantLabel: VARIANT_LABELS[x.variant] })),
    want: wantList.map((x) => ({ ...x, variantLabel: VARIANT_LABELS[x.variant] })),
    balance, suggestedCash: cash, stale: !want || !give,
  };
}

// ---------------------------------------------------------------------------
// Positionen eines neuen Tauschs prüfen
// ---------------------------------------------------------------------------
type PosInput = { portfolioItemId?: unknown; listingId?: unknown; quantity?: unknown };
type Position = {
  ownerId: string; portfolioItemId: number | null; listingId: number | null; cardId: string | null; printId: string | null;
  name: string; image: string; variant: string; condition: string; lang: string; quantity: number; valueCents: number;
};

async function resolvePositions(raw: unknown, ownerId: string, allowPortfolio: boolean): Promise<Position[] | { error: string; status: 400 | 403 | 404 | 409 }> {
  const list: PosInput[] = Array.isArray(raw) ? raw : [];
  if (list.length > TRADE_MAX_ITEMS_PER_SIDE) return { error: `Höchstens ${TRADE_MAX_ITEMS_PER_SIDE} Karten pro Seite.`, status: 400 };
  const pIds: number[] = [], lIds: number[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") return { error: "Ungültige Kartenauswahl.", status: 400 };
    const pid = int(x.portfolioItemId, 1, ID_MAX, 0), lid = int(x.listingId, 1, ID_MAX, 0);
    if (!pid && !lid) return { error: "Ungültige Kartenauswahl.", status: 400 };
    if (pid) pIds.push(pid); else lIds.push(lid);
  }
  if (new Set(pIds).size !== pIds.length || new Set(lIds).size !== lIds.length) return { error: "Jede Karte nur einmal auswählen.", status: 400 };
  const items = await valuePortfolioItems(pIds);
  const lst = await valueListings(lIds);
  const out: Position[] = [];
  for (const x of list) {
    const pid = int(x.portfolioItemId, 1, ID_MAX, 0);
    if (pid) {
      const i = items.get(pid);
      if (!i || i.userId !== ownerId) return { error: "Eine ausgewählte Karte gehört nicht zur Sammlung.", status: 404 };
      if (!allowPortfolio) return { error: "Diese Karte ist nicht für einen Tausch freigegeben.", status: 403 };
      const quantity = int(x.quantity, 1, 999, 1);
      if (quantity > i.quantity) return { error: `„${i.name}“: nur ${i.quantity} Stück vorhanden.`, status: 409 };
      out.push({ ownerId, portfolioItemId: i.id, listingId: null, cardId: i.cardId, printId: i.printId, name: i.name, image: i.image,
        variant: normalizeVariant(i.variant), condition: i.condition, lang: i.lang, quantity, valueCents: i.valueCents });
    } else {
      const lid = int(x.listingId, 1, ID_MAX, 0);
      const l = lst.get(lid);
      if (!l || l.userId !== ownerId || l.status !== "active") return { error: "Ein ausgewähltes Inserat ist nicht mehr verfügbar.", status: 404 };
      out.push({ ownerId, portfolioItemId: l.portfolioItemId ?? null, listingId: l.id, cardId: l.cardId, printId: null, name: l.cardName, image: l.image,
        variant: normalizeVariant(l.variant), condition: l.condition || "NM", lang: l.lang, quantity: 1, valueCents: l.valueCents });
    }
  }
  return out;
}

async function tradeItemsFor(tradeIds: number[]) {
  if (!tradeIds.length) return new Map<number, any[]>();
  const list = await db.select().from(tradeItems).where(inArray(tradeItems.tradeId, tradeIds));
  const map = new Map<number, any[]>();
  for (const i of list) {
    const arr = map.get(i.tradeId) ?? [];
    arr.push({ ...i, variantLabel: VARIANT_LABELS[normalizeVariant(i.variant)] });
    map.set(i.tradeId, arr);
  }
  return map;
}

/** Nach Abschluss: Karten wechseln die Sammlung (Abgeber −, Empfänger +), beteiligte Inserate gelten als getauscht. */
async function settleTrade(tradeId: number, fromUser: string, toUser: string) {
  const items = await db.select().from(tradeItems).where(eq(tradeItems.tradeId, tradeId));
  for (const it of items) {
    const receiver = it.side === "from" ? toUser : fromUser;
    if (it.portfolioItemId) {
      const [src] = await db.select().from(portfolioItems).where(and(eq(portfolioItems.id, it.portfolioItemId), eq(portfolioItems.userId, it.ownerId))).limit(1);
      if (src) {
        if (src.quantity > it.quantity) await db.update(portfolioItems).set({ quantity: src.quantity - it.quantity }).where(eq(portfolioItems.id, src.id));
        else await db.delete(portfolioItems).where(eq(portfolioItems.id, src.id));
      }
    }
    await db.insert(portfolioItems).values({
      userId: receiver, cardId: it.cardId, printId: it.printId, name: it.name, image: it.image, quantity: it.quantity,
      variant: it.variant, condition: it.condition, lang: it.lang, manualValue: it.valueCents ? (it.valueCents / 100).toFixed(2) : null,
    });
    if (it.listingId) await db.update(listings).set({ status: "sold" }).where(and(eq(listings.id, it.listingId), eq(listings.status, "active")));
  }
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerTrading(app: any, { auth, body }: Hlp) {
  // Rechts-Swipe auf ein Inserat
  app.post("/api/swipe/like", auth, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`like-l:${user.id}`, 120, 60_000))) return c.json({ error: "Zu viele Swipes – bitte kurz warten." }, 429);
    const listingId = int((await body(c)).listingId, 1, ID_MAX, 0);
    if (!listingId) return c.json({ error: "Ungültiges Inserat." }, 400);
    const [l] = await db.select({ id: listings.id, userId: listings.userId, cardId: listings.cardId, status: listings.status })
      .from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l || l.status !== "active") return c.json({ error: "Inserat nicht mehr verfügbar." }, 404);
    if (l.userId === user.id) return c.json({ error: "Das ist dein eigenes Inserat." }, 400);
    if (await isBlockedBetween(user.id, l.userId)) return c.json({ error: "Mit diesem Sammler ist kein Tausch möglich." }, 403);
    const [like] = await db.insert(swipeLikes).values({ userId: user.id, listingId: l.id, ownerId: l.userId, cardId: l.cardId })
      .onConflictDoNothing().returning();
    const result = await detectMatch(user.id, l.userId, { listingId: l.id, portfolioItemId: null });
    return c.json({
      liked: true, new: Boolean(like),
      match: result ? { id: result.match.id, created: result.created } : null,
      proposal: result ? await proposalFor(result.match.id, user.id) : null,
    }, like ? 201 : 200);
  });

  app.delete("/api/swipe/like/:listingId", auth, async (c: any) => {
    const listingId = int(c.req.param("listingId"), 1, ID_MAX, 0);
    if (!listingId) return c.json({ error: "Ungültiges Inserat." }, 400);
    await db.delete(swipeLikes).where(and(eq(swipeLikes.userId, c.get("user").id), eq(swipeLikes.listingId, listingId)));
    return c.json({ ok: true });
  });

  // Meine Matches (offen und vorgeschlagen)
  app.get("/api/matches", auth, async (c: any) => {
    const userId = c.get("user").id;
    const list = rows(await db.execute(sql`
      SELECT m.id, m.status, m.reason, m.created_at, m.trade_id,
        CASE WHEN m.user_a = ${userId} THEN m.user_b ELSE m.user_a END AS partner_id,
        p.display_name AS partner_name, p.city AS partner_city,
        lw.card_name AS want_name, lw.image AS want_image, lg.card_name AS give_name, lg.image AS give_image,
        pg.name AS give_item_name, pg.image AS give_item_image, pw.name AS want_item_name, pw.image AS want_item_image
      FROM trade_matches m
      JOIN profiles p ON p.user_id = CASE WHEN m.user_a = ${userId} THEN m.user_b ELSE m.user_a END
      LEFT JOIN listings lw ON lw.id = CASE WHEN m.user_a = ${userId} THEN m.a_wants_listing_id ELSE m.b_wants_listing_id END
      LEFT JOIN listings lg ON lg.id = CASE WHEN m.user_a = ${userId} THEN m.b_wants_listing_id ELSE m.a_wants_listing_id END
      LEFT JOIN portfolio_items pw ON pw.id = CASE WHEN m.user_a = ${userId} THEN m.a_wants_portfolio_item_id ELSE m.b_wants_portfolio_item_id END
      LEFT JOIN portfolio_items pg ON pg.id = CASE WHEN m.user_a = ${userId} THEN m.b_wants_portfolio_item_id ELSE m.a_wants_portfolio_item_id END
      WHERE (m.user_a = ${userId} OR m.user_b = ${userId}) AND m.status IN ('open', 'proposed') AND NOT p.banned
      ORDER BY m.created_at DESC LIMIT 50`));
    return c.json({
      matches: list.map((m: any) => ({
        id: m.id, status: m.status, reason: m.reason, createdAt: m.created_at, tradeId: m.trade_id,
        partner: { id: m.partner_id, name: m.partner_name, city: m.partner_city },
        want: { name: m.want_name || m.want_item_name || "", image: m.want_image || m.want_item_image || "" },
        give: { name: m.give_name || m.give_item_name || "", image: m.give_image || m.give_item_image || "" },
      })),
    });
  });

  app.get("/api/matches/:id/proposal", auth, async (c: any) => {
    const id = int(c.req.param("id"), 1, ID_MAX, 0);
    if (!id) return c.json({ error: "Ungültiges Match." }, 400);
    const p = await proposalFor(id, c.get("user").id);
    if (!p) return c.json({ error: "Match nicht gefunden." }, 404);
    return c.json(p);
  });

  app.post("/api/matches/:id/dismiss", auth, async (c: any) => {
    const userId = c.get("user").id;
    const id = int(c.req.param("id"), 1, ID_MAX, 0);
    if (!id) return c.json({ error: "Ungültiges Match." }, 400);
    const [m] = await db.update(tradeMatches).set({ status: "dismissed", updatedAt: new Date() }).where(and(
      eq(tradeMatches.id, id), or(eq(tradeMatches.userA, userId), eq(tradeMatches.userB, userId)), eq(tradeMatches.status, "open"),
    )).returning();
    if (!m) return c.json({ error: "Match nicht gefunden oder schon bearbeitet." }, 404);
    return c.json({ ok: true });
  });

  // Meine Tausche inkl. Positionen
  app.get("/api/trades", auth, async (c: any) => {
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
    const items = await tradeItemsFor(list.map((t: any) => Number(t.id)));
    return c.json({
      trades: list.map((t: any) => {
        const its = items.get(Number(t.id)) ?? [];
        return {
          ...t, role: t.from_user === userId ? "sender" : "receiver", statusLabel: TRADE_STATUS_LABEL[t.status as TradeStatus] ?? t.status,
          items: its, structured: its.length > 0,
          fromTrackingUrl: t.from_tracking ? trackingUrl(t.from_carrier, t.from_tracking) : "",
          toTrackingUrl: t.to_tracking ? trackingUrl(t.to_carrier, t.to_tracking) : "",
        };
      }),
    });
  });

  // Strukturierter Tauschvorschlag
  app.post("/api/trades", auth, async (c: any) => {
    const user = c.get("user"), profile = c.get("profile");
    const b = await body(c);
    const listingId = int(b.listingId, 0, ID_MAX, 0);
    const matchId = int(b.matchId, 0, ID_MAX, 0);
    // Live-Online-Radar: Tauschangebot direkt aus der Binder-Vorschau (Karten aus der freigegebenen Sammlung des Partners)
    const binderPartner = !listingId && !matchId ? str(b.partnerId, 80) : "";
    if (!listingId && !matchId && !binderPartner) return c.json({ error: "Bitte ein Inserat oder Match angeben." }, 400);
    if (binderPartner && binderPartner === user.id) return c.json({ error: "Das ist deine eigene Sammlung." }, 400);

    // Partner bestimmen
    let partnerId = binderPartner;
    let match: typeof tradeMatches.$inferSelect | undefined;
    if (matchId) {
      [match] = await db.select().from(tradeMatches).where(and(
        eq(tradeMatches.id, matchId), or(eq(tradeMatches.userA, user.id), eq(tradeMatches.userB, user.id)), inArray(tradeMatches.status, ["open", "proposed"]),
      )).limit(1);
      if (!match) return c.json({ error: "Match nicht gefunden oder schon abgeschlossen." }, 404);
      partnerId = match.userA === user.id ? match.userB : match.userA;
    }
    let anchor: typeof listings.$inferSelect | undefined;
    if (listingId) {
      [anchor] = await db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.status, "active"))).limit(1);
      if (!anchor) return c.json({ error: "Inserat nicht mehr verfügbar." }, 404);
      if (anchor.userId === user.id) return c.json({ error: "Das ist dein eigenes Inserat." }, 400);
      if (partnerId && partnerId !== anchor.userId) return c.json({ error: "Inserat und Match passen nicht zusammen." }, 400);
      partnerId = anchor.userId;
    }
    if (await isBlockedBetween(user.id, partnerId)) return c.json({ error: "Tauschanfrage nicht möglich." }, 403);
    const [partner] = await db.select({ banned: profiles.banned, binderVisible: profiles.binderVisible }).from(profiles).where(eq(profiles.userId, partnerId)).limit(1);
    if (!partner || partner.banned) return c.json({ error: "Dieser Sammler ist nicht verfügbar." }, 404);
    if (binderPartner && !partner.binderVisible) return c.json({ error: "Dieser Sammler zeigt seine Sammlung gerade nicht – frag ihn im Chat." }, 403);

    // Positionen: was ich gebe (aus meiner Sammlung/meinen Inseraten), was ich möchte (Inserate des Partners; Sammlungs-Karten nur aus einem Match)
    const give = await resolvePositions(b.give, user.id, true);
    if (!Array.isArray(give)) return c.json({ error: give.error }, give.status);
    const wantRaw: PosInput[] = Array.isArray(b.want) ? [...b.want] : [];
    if (anchor && !wantRaw.some((w) => int(w?.listingId, 1, ID_MAX, 0) === anchor!.id)) wantRaw.unshift({ listingId: anchor.id });
    const matchItems = new Set([match?.aWantsPortfolioItemId, match?.bWantsPortfolioItemId].filter(Boolean) as number[]);
    for (const w of wantRaw) {
      const pid = int(w?.portfolioItemId, 1, ID_MAX, 0);
      if (pid && !binderPartner && !matchItems.has(pid)) return c.json({ error: "Karten aus fremden Sammlungen sind nur über ein Match tauschbar." }, 403);
    }
    const want = await resolvePositions(wantRaw, partnerId, matchItems.size > 0 || Boolean(binderPartner));
    if (!Array.isArray(want)) return c.json({ error: want.error }, want.status);
    const cash = parseCash(b.cashCents, b.cashPayer);
    if ("error" in cash) return c.json({ error: cash.error }, 400);
    if (!want.length) return c.json({ error: "Bitte mindestens eine Karte des Partners auswählen." }, 400);
    if (!give.length && !(cash.cashCents > 0 && cash.payer === "from")) {
      return c.json({ error: "Bitte mindestens eine eigene Karte oder einen Wertausgleich anbieten." }, 400);
    }

    // Doppelte offene Anfrage für dasselbe Inserat verhindern, Tageslimit
    if (anchor) {
      const [dup] = await db.select({ id: trades.id }).from(trades).where(and(
        eq(trades.listingId, anchor.id), eq(trades.fromUser, user.id), inArray(trades.status, ["pending", "accepted", "shipping"]),
      )).limit(1);
      if (dup) return c.json({ error: "Du hast für dieses Inserat schon eine offene Anfrage.", tradeId: dup.id }, 409);
    }
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(trades)
      .where(and(eq(trades.fromUser, user.id), sql`${trades.createdAt} > now() - interval '1 day'`));
    if (Number(r?.n ?? 0) >= 30) return c.json({ error: "Tageslimit für Tauschanfragen erreicht." }, 429);

    const balance = tradeBalance(give, want, cash.cashCents, cash.payer);
    const summary = (list: Position[]) => list.map((x) => `${x.quantity > 1 ? `${x.quantity}× ` : ""}${x.name} (${VARIANT_LABELS[normalizeVariant(x.variant)]}, ${x.condition})`).join(", ");
    const offerText = [summary(give), cash.cashCents && cash.payer === "from" ? `+ ${(cash.cashCents / 100).toFixed(2).replace(".", ",")} € Ausgleich` : ""]
      .filter(Boolean).join(" ").slice(0, 400) || "Wertausgleich";
    const [trade] = await db.insert(trades).values({
      listingId: anchor?.id ?? want.find((w) => w.listingId)?.listingId ?? null,
      fromUser: user.id, toUser: partnerId, offer: offerText, request: summary(want).slice(0, 400),
      matchId: match?.id ?? null, cashCents: cash.cashCents, cashPayer: cash.payer,
      fromValueCents: balance.fromValue, toValueCents: balance.toValue,
    }).returning();
    await db.insert(tradeItems).values([
      ...give.map((p) => ({ tradeId: trade.id, side: "from", ...p })),
      ...want.map((p) => ({ tradeId: trade.id, side: "to", ...p })),
    ]);
    if (match) await db.update(tradeMatches).set({ status: "proposed", tradeId: trade.id, updatedAt: new Date() }).where(eq(tradeMatches.id, match.id));
    const msg = str(b.message, 1000);
    if (msg) await db.insert(tradeMessages).values({ tradeId: trade.id, userId: user.id, body: msg });
    await notify(partnerId, "🤝 Neue Tauschanfrage", `${profile.displayName} bietet ${offerText} für ${summary(want).slice(0, 120)}.`, "/?tab=trades");
    return c.json({ ...trade, items: [...give.map((p) => ({ ...p, side: "from" })), ...want.map((p) => ({ ...p, side: "to" }))], balance }, 201);
  });

  app.get("/api/trades/:id", auth, async (c: any) => {
    const userId = c.get("user").id;
    const id = int(c.req.param("id"), 1, ID_MAX, 0);
    if (!id) return c.json({ error: "Ungültiger Tausch." }, 400);
    const [t] = await db.select().from(trades).where(and(eq(trades.id, id), or(eq(trades.fromUser, userId), eq(trades.toUser, userId)))).limit(1);
    if (!t) return c.json({ error: "Tausch nicht gefunden" }, 404);
    const items = (await tradeItemsFor([id])).get(id) ?? [];
    return c.json({
      trade: { ...t, role: t.fromUser === userId ? "sender" : "receiver", statusLabel: TRADE_STATUS_LABEL[t.status as TradeStatus] ?? t.status },
      items, balance: tradeBalance(items.filter((i) => i.side === "from"), items.filter((i) => i.side === "to"), t.cashCents, t.cashPayer as any),
    });
  });

  app.post("/api/trades/:id/action", auth, async (c: any) => {
    const user = c.get("user"), profile = c.get("profile");
    const b = await body(c);
    const id = int(c.req.param("id"), 1, ID_MAX, 0);
    if (!id) return c.json({ error: "Ungültiger Tausch." }, 400);
    const [t] = await db.select().from(trades).where(and(eq(trades.id, id), or(eq(trades.fromUser, user.id), eq(trades.toUser, user.id)))).limit(1);
    if (!t) return c.json({ error: "Tausch nicht gefunden" }, 404);
    const role: TradeRole = t.toUser === user.id ? "receiver" : "sender";
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(tradeItems).where(eq(tradeItems.tradeId, id));
    const hasItems = Number(cnt?.n ?? 0) > 0;
    const res = tradeTransition({ ...t, status: t.status as TradeStatus, hasItems }, role, { action: b.action, carrier: b.carrier, tracking: b.tracking });
    if (!res.ok) return c.json({ error: res.error }, res.status);

    // Beim Annehmen: Sind alle Karten noch vorhanden (nicht inzwischen verkauft/anders getauscht)?
    if (b.action === "accept" && hasItems) {
      const its = await db.select().from(tradeItems).where(eq(tradeItems.tradeId, id));
      const pIds = its.map((i) => i.portfolioItemId).filter((x): x is number => !!x);
      const owned = pIds.length ? await db.select({ id: portfolioItems.id, userId: portfolioItems.userId, quantity: portfolioItems.quantity })
        .from(portfolioItems).where(inArray(portfolioItems.id, pIds)) : [];
      for (const i of its) {
        if (i.portfolioItemId) {
          const o = owned.find((x) => x.id === i.portfolioItemId);
          if (!o || o.userId !== i.ownerId || o.quantity < i.quantity) return c.json({ error: `„${i.name}“ ist nicht mehr in der angebotenen Menge vorhanden.` }, 409);
        }
        if (i.listingId && !i.portfolioItemId) {
          const [l] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, i.listingId)).limit(1);
          if (!l || l.status !== "active") return c.json({ error: `Das Inserat „${i.name}“ ist nicht mehr aktiv.` }, 409);
        }
      }
    }

    // Optimistische Sperre: nur anwenden, wenn sich der Status seit dem Laden nicht geändert hat
    const [updated] = await db.update(trades).set({ ...(res.updates as any), updatedAt: new Date() })
      .where(and(eq(trades.id, id), eq(trades.status, t.status),
        // Versand/Erhalt pro Seite nur einmal (verhindert Doppelklicks über zwei Geräte)
        b.action === "ship" ? sql`${role === "sender" ? trades.fromShippedAt : trades.toShippedAt} IS NULL` : undefined,
        b.action === "received" ? sql`${role === "sender" ? trades.toReceivedAt : trades.fromReceivedAt} IS NULL` : undefined,
      )).returning();
    if (!updated) return c.json({ error: "Diese Aktion ist gerade nicht möglich." }, 409);

    if (res.completed) {
      if (hasItems) await settleTrade(id, t.fromUser, t.toUser);
      else if (t.listingId) await db.update(listings).set({ status: "sold" }).where(eq(listings.id, t.listingId));
      if (t.matchId) await db.update(tradeMatches).set({ status: "traded", updatedAt: new Date() }).where(eq(tradeMatches.id, t.matchId));
    }
    if (["declined", "cancelled"].includes(String(updated.status)) && t.matchId) {
      await db.update(tradeMatches).set({ status: "open", tradeId: null, updatedAt: new Date() }).where(and(eq(tradeMatches.id, t.matchId), eq(tradeMatches.status, "proposed")));
    }
    const other = role === "receiver" ? t.fromUser : t.toUser;
    await notify(other, res.message, `${profile.displayName} • ${t.request}`.slice(0, 300), "/?tab=trades");
    return c.json({ ...updated, statusLabel: TRADE_STATUS_LABEL[updated.status as TradeStatus] ?? updated.status });
  });
}
