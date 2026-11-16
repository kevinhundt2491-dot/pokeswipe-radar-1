// Phase 7: Direktkauf mit Warenkorb über mehrere Verkäufer (Stripe Connect, „separate charges and transfers“)
//
// Ablauf:
//  1. Warenkorb (cart_items) – serverseitig, je Inserat eine Position mit Menge.
//  2. Checkout: Bestand wird atomar reserviert (listings.reserved), es entsteht ein Checkout (orders) und je Verkäufer
//     eine Teilbestellung in market_orders (checkout_id) mit ihren Positionen (order_items). EINE Stripe-Zahlung.
//  3. Zahlung bestätigt (Webhook oder Rückkehr): Bestand wird endgültig abgebucht, alle Teilbestellungen sind „bezahlt“.
//     Ab hier laufen Versand, Auszahlung (Transfer je Verkäufer mit source_transaction), Erstattung (Teilbetrag),
//     Reklamation, Widerruf und Rückbuchung über die bestehende Treuhand-Logik in server/market.ts.
//  4. Nicht bezahlt: Sitzung verfällt (checkout.session.expired oder Job) → Reservierungen werden freigegeben.
import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, profiles, listings, marketOrders, orders, orderItems, cartItems } from "../db/index.ts";
import type { AuthUser } from "./auth.ts";
import { stripe } from "./billing.ts";
import { effectivePlan, type PlanId } from "./plans.ts";
import { LEGAL_VERSION } from "./legal.ts";
import { notify } from "./prices.ts";
import { isBlockedBetween } from "./community.ts";
import { escrowBuyGate, escrowSellGate, refundOrder, syncSellerAccount } from "./market.ts";
import {
  groupCart, blockingProblems, sellerOrderTitle, validUnitPrice, validateBusinessProfile, optimizeCart,
  CART_MAX_LINES, CART_MAX_QTY, CHECKOUT_MAX_SELLERS, CHECKOUT_TTL_MIN, RESERVATION_GRACE_MIN, WITHDRAWAL_DAYS,
  type CartLine, type OptNeed, type OptOffer,
} from "./cart-logic.ts";
import { SHIP_COUNTRIES, AUTO_RELEASE_DAYS, SHIP_WINDOW_DAYS, CONDITIONS } from "./market-logic.ts";
import { VARIANT_LABELS, type Variant } from "./variant-logic.ts";
import { str, int, rows, rateLimit, clientIp, trustedOrigin, euro } from "./util.ts";
import { publicCache } from "./cache.ts";
import { log } from "./log.ts";
import { currentJob } from "./resilience.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
type Profile = typeof profiles.$inferSelect;

const origin = (c: any) => trustedOrigin(c) || process.env.URL || new URL(c.req.url).origin;
const eur = (cents: number) => euro(cents / 100);
const planOf = (r: any): PlanId => effectivePlan({
  plan: r.plan, planUntil: r.plan_until ? new Date(r.plan_until) : null, bonusUntil: r.bonus_until ? new Date(r.bonus_until) : null, bonusPlan: r.bonus_plan,
});

// ---------------------------------------------------------------------------
// Warenkorb laden (mit aktuellem Preis, Verfügbarkeit und Verkäuferstatus)
// ---------------------------------------------------------------------------
async function cartLines(userId: string): Promise<CartLine[]> {
  const list = rows(await db.execute(sql`
    SELECT ci.id AS cart_item_id, ci.quantity AS cart_qty, ci.price_cents_at_add, l.id AS listing_id, l.user_id AS seller_id, l.card_name, l.image,
      l.variant, l.condition, l.lang, l.card_id, l.status, l.buy_now, l.price::float AS price, l.shipping_cents, l.quantity, l.reserved,
      p.display_name AS seller_name, p.seller_type, p.stripe_account_ready, p.stripe_account_id, p.banned,
      p.plan, p.plan_until, p.bonus_until, p.bonus_plan
    FROM cart_items ci JOIN listings l ON l.id = ci.listing_id JOIN profiles p ON p.user_id = l.user_id
    WHERE ci.user_id = ${userId} ORDER BY ci.created_at`));
  return list.map((r: any) => ({
    cartItemId: Number(r.cart_item_id), listingId: Number(r.listing_id), sellerId: String(r.seller_id), sellerName: String(r.seller_name),
    sellerType: r.seller_type === "business" ? "business" : "private", sellerPlan: planOf(r),
    title: String(r.card_name), image: String(r.image || ""), variant: String(r.variant || "normal"), condition: String(r.condition || ""), lang: String(r.lang || "de"),
    cardId: r.card_id ? String(r.card_id) : null,
    unitCents: Math.round(Number(r.price) * 100), priceCentsAtAdd: Number(r.price_cents_at_add), shippingCents: Number(r.shipping_cents) || 0,
    quantity: Number(r.cart_qty), available: r.status === "active" ? Math.max(0, Number(r.quantity) - Number(r.reserved)) : 0,
    buyable: r.status === "active" && Boolean(r.buy_now) && Boolean(r.stripe_account_ready) && Boolean(r.stripe_account_id) && !r.banned && r.seller_id !== userId,
  }));
}

function cartView(lines: CartLine[]) {
  const g = groupCart(lines);
  const line = (l: CartLine) => ({
    cartItemId: l.cartItemId, listingId: l.listingId, title: l.title, image: l.image, variant: l.variant, variantLabel: VARIANT_LABELS[l.variant as Variant] || l.variant,
    condition: l.condition, conditionLabel: CONDITIONS[l.condition] || l.condition, lang: l.lang, cardId: l.cardId, unitCents: l.unitCents,
    priceCentsAtAdd: l.priceCentsAtAdd, quantity: l.quantity, available: l.available, shippingCents: l.shippingCents,
  });
  const okIds = new Set(g.groups.flatMap((x) => x.lines.map((l) => l.cartItemId)));
  return {
    groups: g.groups.map((x) => ({
      sellerId: x.sellerId, sellerName: x.sellerName, sellerType: x.sellerType, itemsCents: x.itemsCents, shippingCents: x.shippingCents,
      totalCents: x.totalCents, itemCount: x.itemCount, lines: x.lines.map(line),
    })),
    unavailable: lines.filter((l) => !okIds.has(l.cartItemId)).map(line),
    problems: g.problems,
    itemsCents: g.itemsCents, shippingCents: g.shippingCents, totalCents: g.totalCents,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    withdrawalDays: WITHDRAWAL_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Reservierungen
// ---------------------------------------------------------------------------
async function releaseReservations(checkoutId: number) {
  await db.update(cartItems).set({ reservedAt: null, reservedUntil: null, reservedCheckoutId: null }).where(eq(cartItems.reservedCheckoutId, checkoutId));
  const its = await db.select({ listingId: orderItems.listingId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.checkoutId, checkoutId));
  for (const i of its) {
    if (!i.listingId) continue;
    await db.execute(sql`UPDATE listings SET reserved = greatest(reserved - ${i.quantity}, 0), updated_at = now() WHERE id = ${i.listingId}`);
  }
}

/** Checkout abbrechen (nicht bezahlt): genau einmal Reservierungen freigeben und Teilbestellungen schließen. */
export async function expireCheckout(checkoutId: number, reason: "expired" | "cancelled" = "expired") {
  const [claimed] = await db.update(orders).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(orders.id, checkoutId), eq(orders.status, "awaiting_payment"))).returning();
  if (!claimed) return false;
  await releaseReservations(checkoutId);
  await db.update(marketOrders).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(marketOrders.checkoutId, checkoutId), eq(marketOrders.status, "awaiting_payment")));
  if (reason === "expired") await notify(claimed.buyerId, "⌛ Checkout abgelaufen", "Die Zahlung wurde nicht abgeschlossen – es wurde nichts berechnet. Die Karten liegen weiter in deinem Warenkorb.", "/?cart=1").catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Zahlung abschließen (Webhook checkout.session.completed oder Rückkehr des Käufers)
// ---------------------------------------------------------------------------
export async function fulfillCartSession(session: Stripe.Checkout.Session, expectedUserId?: string) {
  const s = stripe();
  if (!s) throw new Error("Stripe fehlt");
  const checkoutId = Number(session.metadata?.checkoutId);
  const buyerId = session.metadata?.userId;
  if (!checkoutId || !buyerId || session.client_reference_id !== buyerId) return { ok: false, reason: "invalid" };
  if (expectedUserId && expectedUserId !== buyerId) return { ok: false, reason: "foreign" };
  if (session.status !== "complete" || session.payment_status !== "paid") return { ok: false, reason: "unpaid" };
  const [co] = await db.select().from(orders).where(eq(orders.id, checkoutId)).limit(1);
  if (!co || co.buyerId !== buyerId || (co.stripeSessionId && co.stripeSessionId !== session.id)) return { ok: false, reason: "invalid" };
  if (co.status === "paid") return { ok: true, kind: "cart", checkoutId, alreadyProcessed: true };

  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  let chargeId: string | null = null;
  if (piId) {
    const pi = await s.paymentIntents.retrieve(piId);
    chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id || null;
  }
  const ship: any = (session as any).collected_information?.shipping_details || (session as any).shipping_details || null;
  const address = ship ? JSON.stringify({ name: ship.name || session.customer_details?.name || "", ...(ship.address || {}) }) : null;

  // Genau einmal anwenden. Auch ein schon als „abgelaufen“ markierter Checkout wird übernommen, falls Stripe die
  // Zahlung doch noch bestätigt hat (Reservierung ist dann frei → Bestand wird unten erneut geprüft).
  const [paid] = await db.update(orders).set({ status: "paid", paidAt: new Date(), paymentIntentId: piId, chargeId, stripeSessionId: session.id, updatedAt: new Date() })
    .where(and(eq(orders.id, checkoutId), inArray(orders.status, ["awaiting_payment", "cancelled"]))).returning();
  if (!paid) return { ok: true, kind: "cart", checkoutId, alreadyProcessed: true };
  const wasReserved = co.status === "awaiting_payment";

  const subs = await db.select().from(marketOrders).where(eq(marketOrders.checkoutId, checkoutId));
  const its = await db.select().from(orderItems).where(eq(orderItems.checkoutId, checkoutId));
  let refunded = 0;
  for (const so of subs) {
    const lines = its.filter((i) => i.marketOrderId === so.id);
    // Bestand endgültig abbuchen (Reservierung → verkauft). Fehlt Bestand, wird diese Teilbestellung erstattet.
    const taken: { listingId: number; quantity: number }[] = [];
    let short = false;
    for (const l of lines) {
      if (!l.listingId) { short = true; break; }
      const [r] = rows(await db.execute(sql`
        UPDATE listings SET quantity = quantity - ${l.quantity}, updated_at = now(),
          reserved = ${wasReserved ? sql`greatest(reserved - ${l.quantity}, 0)` : sql`reserved`},
          status = CASE WHEN quantity - ${l.quantity} <= 0 THEN 'sold' ELSE status END
        WHERE id = ${l.listingId} AND quantity >= ${l.quantity} AND (${wasReserved} OR (status = 'active' AND quantity - reserved >= ${l.quantity}))
        RETURNING id`));
      if (!r) { short = true; break; }
      taken.push({ listingId: l.listingId, quantity: l.quantity });
    }
    const [paidSo] = await db.update(marketOrders).set({
      status: "paid", paidAt: new Date(), paymentIntentId: piId, chargeId, shippingAddress: address, stripeSessionId: null, updatedAt: new Date(),
    }).where(and(eq(marketOrders.id, so.id), inArray(marketOrders.status, ["awaiting_payment", "cancelled"]))).returning();
    if (!paidSo) continue;
    if (short) {
      // Bereits abgebuchte Positionen dieser Teilbestellung zurücklegen, dann den Anteil erstatten
      for (const t of taken) await db.execute(sql`UPDATE listings SET quantity = quantity + ${t.quantity}, status = 'active', updated_at = now() WHERE id = ${t.listingId} AND status IN ('active','sold')`);
      if (wasReserved) for (const l of lines.filter((x) => x.listingId && !taken.some((t) => t.listingId === x.listingId))) {
        await db.execute(sql`UPDATE listings SET reserved = greatest(reserved - ${l.quantity}, 0) WHERE id = ${l.listingId}`);
      }
      try { await refundOrder(paidSo, "system", "Ein Artikel war beim Abschluss der Zahlung nicht mehr verfügbar.", { restock: false }); refunded++; }
      catch (e) { log.error("cart", "Erstattung nach Fehlbestand fehlgeschlagen", { orderId: so.id, err: e }); }
      continue;
    }
    await notify(so.sellerId, "💶 Bezahlt – bitte versenden", `„${so.title}“ für ${eur(so.priceCents + so.shippingCents)} ist bezahlt. Das Geld liegt sicher in der Treuhand. Bitte innerhalb von ${SHIP_WINDOW_DAYS} Tagen versenden und die Sendungsnummer eintragen.`, "/?orders=1");
  }
  // Gekaufte Positionen aus dem Warenkorb entfernen
  const bought = its.map((i) => i.listingId).filter((x): x is number => Boolean(x));
  if (bought.length) await db.delete(cartItems).where(and(eq(cartItems.userId, buyerId), inArray(cartItems.listingId, bought)));
  await notify(buyerId, "✅ Zahlung eingegangen", `${subs.length === 1 ? "Der Verkäufer wurde" : `${subs.length} Verkäufer wurden`} benachrichtigt. Das Geld wird je Verkäufer erst ausgezahlt, wenn du den Erhalt bestätigst.${refunded ? ` ${refunded} Teilbestellung(en) waren nicht mehr verfügbar und werden erstattet.` : ""}`, "/?orders=1");
  return { ok: true, kind: "cart", checkoutId, sellers: subs.length, refunded };
}

// ---------------------------------------------------------------------------
// Geplanter Job: abgelaufene Checkouts freigeben, Verkäuferstatus abgleichen
// ---------------------------------------------------------------------------
export async function runCartJobs() {
  const result = { expired: 0, completed: 0, sellersSynced: 0, errors: 0 };
  const s = stripe();
  const due = await db.select().from(orders).where(and(eq(orders.status, "awaiting_payment"),
    sql`${orders.expiresAt} < now() - make_interval(mins => ${RESERVATION_GRACE_MIN}::int)`)).limit(50);
  for (const co of due) {
    if (currentJob()?.near(5000)) { currentJob()?.markPartial("Zeitbudget: Checkouts offen"); break; }
    try {
      // Sicherheitsnetz: Wurde doch bezahlt (Webhook verpasst), abschließen statt freigeben
      if (s && co.stripeSessionId) {
        const session = await s.checkout.sessions.retrieve(co.stripeSessionId);
        if (session.status === "complete" && session.payment_status === "paid") { await fulfillCartSession(session); result.completed++; continue; }
        if (session.status === "open") await s.checkout.sessions.expire(session.id).catch(() => null);
      }
      if (await expireCheckout(co.id)) result.expired++;
    } catch (e) { result.errors++; log.error("cart", "Checkout-Ablauf fehlgeschlagen", { checkoutId: co.id, err: e }); }
  }
  // Verkäuferkonten mit Sofort-Kauf-Inseraten regelmäßig bei Stripe prüfen (Ersatz für account.updated-Events)
  if (s) {
    const sellers = await db.select().from(profiles).where(sql`${profiles.stripeAccountId} IS NOT NULL AND ${profiles.userId} IN (
      SELECT user_id FROM listings WHERE status = 'active' AND buy_now GROUP BY user_id)`)
      .orderBy(sql`random()`).limit(10);
    for (const p of sellers) {
      if (currentJob()?.near(4000)) break;
      try { await syncSellerAccount(p); result.sellersSynced++; } catch (e) { result.errors++; log.warn("cart", "Verkäuferstatus", { userId: p.userId, err: e }); }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Öffentliche Angebote zu einer Karte (Kartenseite /karte/*, In-App-Kartenansicht)
// ---------------------------------------------------------------------------
export async function offersForCard(cardId: string, limit = 12) {
  const list = rows(await db.execute(sql`
    SELECT l.id, l.card_name, l.image, l.price::float AS price, l.shipping_cents, l.condition, l.variant, l.lang, l.city,
      greatest(l.quantity - l.reserved, 0) AS available, p.display_name AS seller, p.seller_type, p.public_profile,
      (SELECT round(avg(r.stars)::numeric, 1)::float FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating,
      (SELECT count(*)::int FROM reviews r WHERE r.reviewee_id = l.user_id) AS rating_count
    FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.card_id = ${cardId} AND l.status = 'active' AND l.buy_now AND p.stripe_account_ready AND NOT p.banned AND l.quantity - l.reserved > 0
    ORDER BY (l.price * 100 + l.shipping_cents) ASC LIMIT ${limit}`));
  return list.map((l: any) => ({
    listingId: Number(l.id), title: String(l.card_name), image: String(l.image || ""), priceCents: Math.round(Number(l.price) * 100),
    shippingCents: Number(l.shipping_cents) || 0, condition: String(l.condition || ""), conditionLabel: CONDITIONS[l.condition] || "",
    variant: String(l.variant || "normal"), variantLabel: VARIANT_LABELS[l.variant as Variant] || "", lang: String(l.lang || "de"), city: String(l.city || ""),
    available: Number(l.available), seller: String(l.seller), sellerType: l.seller_type === "business" ? "business" : "private",
    rating: l.rating != null ? Number(l.rating) : null, ratingCount: Number(l.rating_count || 0),
  }));
}

// ---------------------------------------------------------------------------
// Phase 8: Warenkorb-Optimierer
// ---------------------------------------------------------------------------
async function optimizerProposal(userId: string, opts: { sameCondition?: boolean } = {}) {
  const lines = cartLines(userId);
  const all = await lines;
  const g = groupCart(all);
  const ok = g.groups.flatMap((x) => x.lines);
  if (!ok.length) return { lines: all, ok, result: null, offers: [] as OptOffer[], needs: [] as OptNeed[] };
  const needs: OptNeed[] = ok.map((l) => ({
    key: String(l.cartItemId), cardId: l.cardId, variant: l.variant, lang: l.lang, minCondition: l.condition,
    quantity: l.quantity, currentListingId: l.listingId, title: l.title,
  }));
  const cardIds = [...new Set(ok.map((l) => l.cardId).filter((x): x is string => Boolean(x)))];
  const cand = cardIds.length ? rows(await db.execute(sql`
    SELECT l.id, l.user_id, p.display_name, l.card_id, l.variant, l.lang, l.condition, l.price::float AS price, l.shipping_cents,
      greatest(l.quantity - l.reserved, 0) AS available
    FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.card_id IN (${sql.join(cardIds.map((id) => sql`${id}`), sql`, `)})
      AND l.status = 'active' AND l.buy_now AND p.stripe_account_ready AND p.stripe_account_id IS NOT NULL AND NOT p.banned
      AND l.user_id <> ${userId} AND l.quantity - l.reserved > 0
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = l.user_id) OR (b.blocker_id = l.user_id AND b.blocked_id = ${userId}))
    ORDER BY l.price ASC LIMIT 1500`)) : [];
  const offers = new Map<number, OptOffer>();
  for (const r of cand) {
    const unit = Math.round(Number(r.price) * 100);
    if (!validUnitPrice(unit)) continue;
    offers.set(Number(r.id), {
      listingId: Number(r.id), sellerId: String(r.user_id), sellerName: String(r.display_name), cardId: String(r.card_id),
      variant: String(r.variant || "normal"), lang: String(r.lang || "de"), condition: String(r.condition || ""),
      unitCents: unit, shippingCents: Number(r.shipping_cents) || 0, available: Number(r.available),
    });
  }
  // Die aktuellen Positionen sind immer Kandidaten (auch Karten ohne Katalog-ID, z. B. Sealed)
  for (const l of ok) {
    offers.set(l.listingId, {
      listingId: l.listingId, sellerId: l.sellerId, sellerName: l.sellerName, cardId: l.cardId, variant: l.variant, lang: l.lang,
      condition: l.condition, unitCents: l.unitCents, shippingCents: l.shippingCents, available: l.available,
    });
  }
  const offerList = [...offers.values()];
  const result = optimizeCart(needs, offerList, { sameCondition: opts.sameCondition });
  return { lines: all, ok, result, offers: offerList, needs };
}

function proposalView(p: Awaited<ReturnType<typeof optimizerProposal>>) {
  if (!p.result) return { possible: false, savingsCents: 0, currentCents: 0, optimizedCents: 0, changes: [] };
  const byId = new Map(p.offers.map((o) => [o.listingId, o]));
  const r = p.result;
  const sellersOf = (a: Record<string, { listingId: number }[]>) => new Set(Object.values(a).flat().map((x) => byId.get(x.listingId)?.sellerId)).size;
  return {
    possible: r.savingsCents > 0,
    currentCents: r.current?.totalCents ?? 0, optimizedCents: r.best?.totalCents ?? 0, savingsCents: r.savingsCents,
    currentShippingCents: r.current?.shippingCents ?? 0, optimizedShippingCents: r.best?.shippingCents ?? 0,
    sellersBefore: p.result.current ? p.result.current.sellers : 0, sellersAfter: sellersOf(r.assignment),
    changes: r.changed.map((key) => {
      const need = p.needs.find((n) => n.key === key)!;
      const from = byId.get(need.currentListingId)!;
      return {
        cartItemId: Number(key), title: need.title, quantity: need.quantity,
        from: { listingId: from.listingId, seller: from.sellerName, unitCents: from.unitCents, condition: from.condition, conditionLabel: CONDITIONS[from.condition] || from.condition },
        to: r.assignment[key].map((x) => {
          const o = byId.get(x.listingId)!;
          return { listingId: o.listingId, seller: o.sellerName, quantity: x.quantity, unitCents: o.unitCents, shippingCents: o.shippingCents, condition: o.condition, conditionLabel: CONDITIONS[o.condition] || o.condition };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerCart(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;

  // ---------------- Öffentlich: Angebote je Karte, Verkäuferangaben ----------------
  app.get("/api/marketplace/offers", async (c: any) => {
    if (!(await rateLimit(`offers:${clientIp(c)}`, 120, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const cardId = str(c.req.query("card"), 60);
    if (!/^[A-Za-z0-9.\-_]{2,60}$/.test(cardId)) return c.json({ error: "Ungültige Karte." }, 400);
    publicCache(c, "data", { varyQuery: ["card", "limit"], sMaxAge: 60, swr: 300 });
    return c.json({ cardId, offers: await offersForCard(cardId, int(c.req.query("limit"), 1, 30, 12)) });
  });

  app.get("/api/marketplace/sellers/:id", async (c: any) => {
    const id = str(c.req.param("id"), 80);
    const [p] = rows(await db.execute(sql`SELECT user_id, display_name, seller_type, business_name, business_address, business_email, business_phone, business_vat_id, business_register, public_profile
      FROM profiles WHERE user_id = ${id} AND NOT banned LIMIT 1`));
    if (!p) return c.json({ error: "Nicht gefunden" }, 404);
    const business = p.seller_type === "business";
    return c.json({
      id: p.user_id, name: p.display_name, sellerType: business ? "business" : "private",
      // Gewerbliche Verkäufer: Anbieterangaben sind Pflicht und öffentlich (Art. 246d § 1 Nr. 4 EGBGB)
      business: business ? { name: p.business_name, address: p.business_address, email: p.business_email, phone: p.business_phone, vatId: p.business_vat_id, register: p.business_register } : null,
    });
  });

  // ---------------- Verkäufer: privat oder gewerblich ----------------
  app.get("/api/seller/profile", auth, async (c: any) => {
    const p: Profile = c.get("profile");
    return c.json({
      sellerType: p.sellerType, businessName: p.businessName, businessAddress: p.businessAddress, businessEmail: p.businessEmail,
      businessPhone: p.businessPhone, businessVatId: p.businessVatId, businessRegister: p.businessRegister, businessUpdatedAt: p.businessUpdatedAt,
      listingLimitOverride: p.listingLimitOverride,
    });
  });

  app.put("/api/seller/profile", auth, async (c: any) => {
    const p: Profile = c.get("profile");
    const r = validateBusinessProfile(await body(c));
    if (!r.ok) return c.json({ error: r.error }, 400);
    // Wechsel des Verkäufertyps wirkt nur auf neue Bestellungen (market_orders.seller_type ist ein Snapshot)
    const [u] = await db.update(profiles).set({ ...r.value, businessUpdatedAt: new Date() }).where(eq(profiles.userId, p.userId)).returning();
    return c.json({ ok: true, sellerType: u.sellerType });
  });

  // Admin: höheres Inserate-Limit für Händler mit großem Bestand freigeben
  app.post("/api/admin/sellers/:id/listing-limit", auth, adminOnly, async (c: any) => {
    const id = str(c.req.param("id"), 80);
    const b = await body(c);
    const limit = b.limit === null || b.limit === 0 ? null : int(b.limit, 1, 1_000_000, 0) || null;
    const [u] = await db.update(profiles).set({ listingLimitOverride: limit }).where(eq(profiles.userId, id)).returning({ userId: profiles.userId });
    return u ? c.json({ ok: true, listingLimitOverride: limit }) : c.json({ error: "Nicht gefunden" }, 404);
  });

  // ---------------- Warenkorb ----------------
  app.get("/api/cart", auth, async (c: any) => c.json(cartView(await cartLines(c.get("user").id))));

  app.post("/api/cart/items", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!(await rateLimit(`cart:${user.id}`, 60, 60_000))) return c.json({ error: "Zu viele Änderungen in kurzer Zeit." }, 429);
    const b = await body(c);
    const listingId = int(b.listingId, 1, 2 ** 31 - 1, 0);
    const quantity = int(b.quantity, 1, CART_MAX_QTY, 1);
    if (!listingId) return c.json({ error: "Ungültiges Inserat." }, 400);
    const [l] = rows(await db.execute(sql`
      SELECT l.id, l.user_id, l.status, l.buy_now, l.price::float AS price, l.quantity, l.reserved, p.stripe_account_ready, p.banned
      FROM listings l JOIN profiles p ON p.user_id = l.user_id WHERE l.id = ${listingId}`));
    if (!l || l.status !== "active" || l.banned) return c.json({ error: "Inserat nicht mehr verfügbar." }, 404);
    if (l.user_id === user.id) return c.json({ error: "Das ist dein eigenes Inserat." }, 400);
    if (!l.buy_now || !l.stripe_account_ready) return c.json({ error: "Dieses Inserat ist nicht für den Kauf mit Käuferschutz freigeschaltet – nutze die Tauschanfrage." }, 409);
    if (await isBlockedBetween(user.id, String(l.user_id))) return c.json({ error: "Kauf nicht möglich." }, 403);
    const unitCents = Math.round(Number(l.price) * 100);
    if (!validUnitPrice(unitCents)) return c.json({ error: "Preis außerhalb des erlaubten Rahmens." }, 400);
    const available = Math.max(0, Number(l.quantity) - Number(l.reserved));
    const [existing] = await db.select().from(cartItems).where(and(eq(cartItems.userId, user.id), eq(cartItems.listingId, listingId))).limit(1);
    const want = Math.min(CART_MAX_QTY, (b.set === true ? 0 : existing?.quantity || 0) + quantity);
    if (want > available) return c.json({ error: available ? `Nur noch ${available} Stück verfügbar.` : "Gerade nicht verfügbar.", available }, 409);
    if (!existing) {
      const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM cart_items WHERE user_id = ${user.id}`));
      if (Number(n?.n || 0) >= CART_MAX_LINES) return c.json({ error: `Höchstens ${CART_MAX_LINES} verschiedene Artikel im Warenkorb.` }, 409);
      await db.insert(cartItems).values({ userId: user.id, listingId, sellerId: String(l.user_id), quantity: want, priceCentsAtAdd: unitCents }).onConflictDoNothing();
    } else {
      await db.update(cartItems).set({ quantity: want, priceCentsAtAdd: unitCents, sellerId: String(l.user_id) }).where(eq(cartItems.id, existing.id));
    }
    return c.json(cartView(await cartLines(user.id)), existing ? 200 : 201);
  });

  app.patch("/api/cart/items/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const quantity = int((await body(c)).quantity, 0, CART_MAX_QTY, -1);
    if (!id || quantity < 0) return c.json({ error: "Ungültige Menge." }, 400);
    if (quantity === 0) await db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.userId, user.id)));
    else {
      const [ci] = rows(await db.execute(sql`SELECT ci.id, greatest(l.quantity - l.reserved, 0) AS available, l.price::float AS price FROM cart_items ci JOIN listings l ON l.id = ci.listing_id WHERE ci.id = ${id} AND ci.user_id = ${user.id}`));
      if (!ci) return c.json({ error: "Nicht im Warenkorb." }, 404);
      if (quantity > Number(ci.available)) return c.json({ error: `Nur noch ${Number(ci.available)} Stück verfügbar.`, available: Number(ci.available) }, 409);
      await db.update(cartItems).set({ quantity, priceCentsAtAdd: Math.round(Number(ci.price) * 100) }).where(eq(cartItems.id, id));
    }
    return c.json(cartView(await cartLines(user.id)));
  });

  app.delete("/api/cart/items/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    await db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.userId, user.id)));
    return c.json(cartView(await cartLines(user.id)));
  });

  // ---------------- Phase 8: Warenkorb-Optimierer ----------------
  // Vorschlag berechnen (ändert nichts)
  app.post("/api/cart/optimize", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!(await rateLimit(`cartopt:${user.id}`, 20, 60_000))) return c.json({ error: "Zu viele Anfragen in kurzer Zeit." }, 429);
    const b = await body(c);
    return c.json(proposalView(await optimizerProposal(user.id, { sameCondition: b.sameCondition === true })));
  });

  // Vorschlag übernehmen: wird serverseitig neu berechnet; weicht der Gesamtpreis vom gezeigten ab → 409 mit neuem Vorschlag
  app.post("/api/cart/optimize/apply", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!(await rateLimit(`cartopt:${user.id}`, 20, 60_000))) return c.json({ error: "Zu viele Anfragen in kurzer Zeit." }, 429);
    const b = await body(c);
    const expected = int(b.expectedTotalCents, 0, 10 ** 9, -1);
    if (expected < 0) return c.json({ error: "Erwarteter Gesamtpreis fehlt." }, 400);
    const p = await optimizerProposal(user.id, { sameCondition: b.sameCondition === true });
    const view = proposalView(p);
    if (!p.result || !view.possible) return c.json({ error: "Dein Warenkorb ist bereits die günstigste Zusammenstellung.", proposal: view }, 409);
    if (view.optimizedCents !== expected) return c.json({ error: "Die Angebote haben sich gerade geändert. Bitte prüfe den neuen Vorschlag.", proposal: view }, 409);
    const r = p.result;
    // Ohne Transaktion, aber ausfallsicher: erst die Zielmengen je Inserat schreiben, dann die alten Positionen entfernen.
    // Bricht etwas ab, liegt schlimmstenfalls eine Karte doppelt im Warenkorb – es geht nie etwas verloren.
    const changed = new Set(r.changed);
    const desired = new Map<number, number>();
    for (const l of p.ok) if (!changed.has(String(l.cartItemId))) desired.set(l.listingId, (desired.get(l.listingId) || 0) + l.quantity);
    const touched = new Set<number>();
    for (const key of r.changed) for (const a of r.assignment[key]) { desired.set(a.listingId, (desired.get(a.listingId) || 0) + a.quantity); touched.add(a.listingId); }
    for (const listingId of touched) {
      const o = p.offers.find((x) => x.listingId === listingId)!;
      const quantity = Math.min(CART_MAX_QTY, desired.get(listingId)!);
      await db.insert(cartItems).values({ userId: user.id, listingId, sellerId: o.sellerId, quantity, priceCentsAtAdd: o.unitCents })
        .onConflictDoUpdate({ target: [cartItems.userId, cartItems.listingId], set: { quantity, priceCentsAtAdd: o.unitCents, sellerId: o.sellerId } });
    }
    const drop = p.ok.filter((l) => changed.has(String(l.cartItemId)) && !desired.has(l.listingId)).map((l) => l.cartItemId);
    if (drop.length) await db.delete(cartItems).where(and(eq(cartItems.userId, user.id), inArray(cartItems.id, drop)));
    log.info("cart", "Warenkorb optimiert", { userId: user.id, savingsCents: view.savingsCents, changed: r.changed.length });
    return c.json({ ok: true, savingsCents: view.savingsCents, cart: cartView(await cartLines(user.id)) });
  });

  // ---------------- Checkout (eine Zahlung, je Verkäufer eine Teilbestellung) ----------------
  app.post("/api/checkout/connect/session", auth, async (c: any) => {
    const s = stripe();
    if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
    const user: AuthUser = c.get("user"), buyer: Profile = c.get("profile");
    if (!user.confirmed) return c.json({ error: "Bitte bestätige zuerst deine E-Mail-Adresse." }, 403);
    if (!(await rateLimit(`checkout:${user.id}`, 10, 600_000))) return c.json({ error: "Zu viele Bestellungen in kurzer Zeit." }, 429);
    const b = await body(c);
    if (b.acceptTerms !== true) return c.json({ error: "Bitte bestätige die Kaufbedingungen.", needsConsent: true }, 428);

    const lines = await cartLines(user.id);
    if (!lines.length) return c.json({ error: "Dein Warenkorb ist leer." }, 400);
    const g = groupCart(lines);
    const blocking = blockingProblems(g.problems);
    if (blocking.length) return c.json({ error: "Einige Artikel sind nicht mehr verfügbar – bitte prüfe deinen Warenkorb.", problems: blocking, cart: cartView(lines) }, 409);
    // Preisänderung seit dem Hinzufügen: einmal bestätigen lassen (Preisangaben müssen vor der Bestellung stimmen)
    if (g.problems.some((p) => p.problem === "price_changed") && b.acceptPriceChanges !== true) {
      await Promise.all(lines.map((l) => db.update(cartItems).set({ priceCentsAtAdd: l.unitCents }).where(eq(cartItems.id, l.cartItemId))));
      return c.json({ error: "Preise haben sich geändert – bitte prüfe den neuen Gesamtpreis.", priceChanged: true, cart: cartView(await cartLines(user.id)) }, 409);
    }
    if (g.groups.length > CHECKOUT_MAX_SELLERS) return c.json({ error: `Höchstens ${CHECKOUT_MAX_SELLERS} Verkäufer pro Bestellung – bitte in mehreren Bestellungen kaufen.` }, 400);
    for (const grp of g.groups) {
      if (await isBlockedBetween(user.id, grp.sellerId)) return c.json({ error: `Kauf bei ${grp.sellerName} nicht möglich.` }, 403);
      const maxUnit = Math.max(...grp.lines.map((l) => l.unitCents));
      const [sp] = await db.select({ flaggedAt: profiles.flaggedAt }).from(profiles).where(eq(profiles.userId, grp.sellerId)).limit(1);
      const sellerGate = await escrowSellGate({ userId: grp.sellerId, flaggedAt: sp?.flaggedAt ?? null }, maxUnit);
      if (sellerGate) return c.json({ error: `${grp.sellerName} kann gerade nicht mit Käuferschutz verkaufen – bitte entferne die Artikel dieses Verkäufers.`, sellerId: grp.sellerId }, 403);
    }
    const buyerGate = await escrowBuyGate(buyer, g.totalCents);
    if (buyerGate) return c.json({ error: buyerGate }, 403);

    // 1. Bestand atomar reservieren (verhindert Überverkauf zwischen Checkout-Start und Zahlung)
    const reserved: { listingId: number; quantity: number }[] = [];
    const undo = async () => { for (const r of reserved) await db.execute(sql`UPDATE listings SET reserved = greatest(reserved - ${r.quantity}, 0) WHERE id = ${r.listingId}`); };
    for (const grp of g.groups) for (const l of grp.lines) {
      const [ok] = rows(await db.execute(sql`UPDATE listings SET reserved = reserved + ${l.quantity}, updated_at = now()
        WHERE id = ${l.listingId} AND status = 'active' AND buy_now AND quantity - reserved >= ${l.quantity} RETURNING id`));
      if (!ok) { await undo(); return c.json({ error: `„${l.title}“ wurde gerade von jemand anderem gekauft oder reserviert.`, listingId: l.listingId }, 409); }
      reserved.push({ listingId: l.listingId, quantity: l.quantity });
    }

    let checkoutId = 0;
    try {
      const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MIN * 60_000);
      const [co] = await db.insert(orders).values({
        buyerId: user.id, itemsCents: g.itemsCents, shippingCents: g.shippingCents, totalCents: g.totalCents, sellerCount: g.groups.length, expiresAt,
      }).returning();
      checkoutId = co.id;
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      for (const grp of g.groups) {
        const [so] = await db.insert(marketOrders).values({
          checkoutId: co.id, listingId: grp.lines.length === 1 ? grp.lines[0].listingId : null, buyerId: user.id, sellerId: grp.sellerId,
          title: sellerOrderTitle(grp.lines), image: grp.lines[0].image, status: "awaiting_payment",
          priceCents: grp.itemsCents, shippingCents: grp.shippingCents, feeCents: grp.feeCents, feeBps: grp.feeBps,
          itemCount: grp.itemCount, sellerType: grp.sellerType, payBy: new Date(expiresAt.getTime() + RESERVATION_GRACE_MIN * 60_000),
        }).returning();
        await db.insert(orderItems).values(grp.lines.map((l) => ({
          marketOrderId: so.id, checkoutId: co.id, listingId: l.listingId, cardId: l.cardId, title: l.title.slice(0, 160), image: l.image,
          variant: l.variant, condition: l.condition, lang: l.lang, quantity: l.quantity, unitCents: l.unitCents,
        })));
        const sellerLabel = `${grp.sellerName}${grp.sellerType === "business" ? " (gewerblich)" : " (privat)"}`;
        for (const l of grp.lines) {
          const details = [VARIANT_LABELS[l.variant as Variant], CONDITIONS[l.condition], l.lang.toUpperCase()].filter(Boolean).join(" · ");
          lineItems.push({ quantity: l.quantity, price_data: { currency: "eur", unit_amount: l.unitCents,
            product_data: { name: l.title.slice(0, 200), description: `${details ? `${details} – ` : ""}Verkäufer: ${sellerLabel}`.slice(0, 300) } } });
        }
        if (grp.shippingCents) lineItems.push({ quantity: 1, price_data: { currency: "eur", unit_amount: grp.shippingCents, product_data: { name: `Versand ${grp.sellerName}`.slice(0, 200) } } });
      }
      const o = origin(c);
      const hasBusiness = g.groups.some((x) => x.sellerType === "business");
      const session = await s.checkout.sessions.create({
        mode: "payment",
        client_reference_id: user.id,
        ...(buyer.stripeCustomerId ? { customer: buyer.stripeCustomerId } : { customer_email: buyer.email }),
        locale: "de",
        line_items: lineItems,
        shipping_address_collection: { allowed_countries: [...SHIP_COUNTRIES] as any },
        // Bewusst ohne automatic_tax: Verkäufer sind die einzelnen Händler/Privatpersonen, nicht die Plattform
        payment_intent_data: {
          transfer_group: `checkout_${co.id}`, description: `PokeSwipe Warenkorb #${co.id} (${g.groups.length} Verkäufer)`,
          metadata: { kind: "cart", checkoutId: String(co.id), buyerId: user.id },
        },
        metadata: { kind: "cart", checkoutId: String(co.id), userId: user.id, legal_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() },
        custom_text: { submit: { message: `Käuferschutz: Das Geld wird je Verkäufer erst ausgezahlt, wenn du den Erhalt bestätigst (spätestens ${AUTO_RELEASE_DAYS} Tage nach Versand). Du schließt je Verkäufer einen eigenen Kaufvertrag.${hasBusiness ? ` Bei gewerblichen Händlern hast du ${WITHDRAWAL_DAYS} Tage Widerrufsrecht.` : ""}` } },
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: `${o}/?cart=paid&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${o}/?cart=1`,
      }, { idempotencyKey: `cart-checkout-${co.id}` });
      await db.update(orders).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(orders.id, co.id));
      // Reservierung auch an den Warenkorb-Positionen vermerken (sichtbar im Warenkorb, freigegeben bei Ablauf/Abbruch)
      await db.update(cartItems).set({ reservedAt: new Date(), reservedUntil: new Date(expiresAt.getTime() + RESERVATION_GRACE_MIN * 60_000), reservedCheckoutId: co.id })
        .where(and(eq(cartItems.userId, user.id), inArray(cartItems.listingId, reserved.map((r) => r.listingId))));
      return c.json({ url: session.url, checkoutId: co.id }, 201);
    } catch (e: any) {
      log.error("cart", "Checkout konnte nicht gestartet werden", { checkoutId, err: e });
      if (checkoutId) await expireCheckout(checkoutId, "cancelled");
      else await undo();
      return c.json({ error: "Bezahlung konnte nicht gestartet werden. Bitte später erneut versuchen." }, 502);
    }
  });

  app.post("/api/checkout/connect/confirm", auth, async (c: any) => {
    const s = stripe();
    if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
    const sid = str((await body(c)).sessionId, 200);
    if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return c.json({ error: "Ungültige Sitzung" }, 400);
    const session = await s.checkout.sessions.retrieve(sid);
    if (session.metadata?.kind !== "cart") return c.json({ error: "Keine Warenkorb-Zahlung" }, 400);
    const r = await fulfillCartSession(session, c.get("user").id);
    if (!r.ok) return c.json({ error: "Zahlung konnte nicht bestätigt werden.", reason: r.reason }, 402);
    return c.json(r);
  });

  /** Checkout abbrechen (Käufer kehrt ohne Zahlung zurück) → Reservierung sofort freigeben */
  app.post("/api/checkout/connect/:id/cancel", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [co] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.buyerId, user.id))).limit(1);
    if (!co || co.status !== "awaiting_payment") return c.json({ ok: true, status: co?.status || "unknown" });
    const s = stripe();
    if (s && co.stripeSessionId) {
      const session = await s.checkout.sessions.retrieve(co.stripeSessionId);
      if (session.status === "complete") return c.json({ error: "Diese Bestellung ist bereits bezahlt." }, 409);
      if (session.status === "open") await s.checkout.sessions.expire(session.id).catch(() => null);
    }
    await expireCheckout(id, "cancelled");
    return c.json({ ok: true, status: "cancelled" });
  });

  app.get("/api/checkout/connect/open", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const list = await db.select({ id: orders.id, totalCents: orders.totalCents, expiresAt: orders.expiresAt }).from(orders)
      .where(and(eq(orders.buyerId, user.id), eq(orders.status, "awaiting_payment"))).limit(5);
    return c.json({ open: list });
  });

  app.post("/api/admin/cart/run", auth, adminOnly, async (c: any) => c.json(await runCartJobs()));
}
