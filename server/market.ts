// Phase 4: P2P-Marktplatz mit Treuhand über Stripe Connect (Express-Konten für Verkäufer)
//
// Ablauf („separate charges and transfers“): Der Käufer bezahlt an die Plattform, das Geld bleibt auf dem
// Plattform-Konto. Ausgezahlt (Transfer an das Express-Konto des Verkäufers, abzüglich Provision) wird erst,
// wenn der Käufer den Erhalt bestätigt oder AUTO_RELEASE_DAYS nach dem Versand ohne Reklamation.
// Reklamationen entscheidet ein Admin (Erstattung oder Auszahlung). Die Lieferadresse sieht der Verkäufer erst
// nach erfolgreicher Zahlung. Provision je Tarif des Verkäufers, mit Rabatt für Pro-Pass-Inhaber.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, profiles, listings, marketOrders, reviews, moderationLog } from "../db/index.ts";
import { isAdmin, type AuthUser } from "./auth.ts";
import { stripe } from "./billing.ts";
import { effectivePlan, type PlanId } from "./plans.ts";
import { LEGAL_VERSION } from "./legal.ts";
import { notify } from "./prices.ts";
import { isBlockedBetween, forgetTrust, trustFor } from "./community.ts";
import { checkEscrowLimit } from "./community-logic.ts";
import { registerDac7, recordDac7Release, recordDac7Refund, dac7SellerBlock, runDac7Reminders } from "./dac7.ts";
import {
  feeFor, nextStatus, validOffer, validTracking, trackingUrl, MARKET_FEE_BPS, MARKET_MIN_PRICE_CENTS, MARKET_MAX_PRICE_CENTS,
  PAY_WINDOW_HOURS, SHIP_WINDOW_DAYS, AUTO_RELEASE_DAYS, OFFER_TTL_HOURS, SHIP_COUNTRIES, CARRIERS, CONDITIONS,
  type OrderStatus, type OrderRole, type OrderAction,
} from "./market-logic.ts";
import { str, int, money, rows, rateLimit, trustedOrigin, euro } from "./util.ts";
import { log } from "./log.ts";
import { currentJob } from "./resilience.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
type Order = typeof marketOrders.$inferSelect;
type Profile = typeof profiles.$inferSelect;

const origin = (c: any) => trustedOrigin(c) || process.env.URL || new URL(c.req.url).origin;
const eur = (cents: number) => euro(cents / 100);

// ---------------------------------------------------------------------------
// Verkäuferkonto (Stripe Connect Express)
// ---------------------------------------------------------------------------
function accountReady(a: Stripe.Account) {
  return Boolean(a.details_submitted && a.payouts_enabled && a.capabilities?.transfers === "active");
}

/** Liest den Status des Express-Kontos bei Stripe und speichert „verifiziert ja/nein“. */
export async function syncSellerAccount(p: Profile) {
  const s = stripe();
  if (!s || !p.stripeAccountId) return { connected: false, ready: false, requirements: [] as string[] };
  const acct = await s.accounts.retrieve(p.stripeAccountId);
  const ready = accountReady(acct);
  if (ready !== p.stripeAccountReady) {
    await db.update(profiles).set({ stripeAccountReady: ready }).where(eq(profiles.userId, p.userId));
    // Ohne verifiziertes Konto keine Sofort-Kauf-Inserate
    if (!ready) await db.update(listings).set({ buyNow: false }).where(and(eq(listings.userId, p.userId), eq(listings.buyNow, true)));
    forgetTrust(p.userId);
  }
  return {
    connected: true, ready, payoutsEnabled: Boolean(acct.payouts_enabled), detailsSubmitted: Boolean(acct.details_submitted),
    requirements: (acct.requirements?.currently_due || []).slice(0, 10), disabledReason: acct.requirements?.disabled_reason || null,
  };
}

// ---------------------------------------------------------------------------
// Zahlung abschließen (Checkout-Session) – aufgerufen vom Stripe-Webhook und nach der Rückkehr des Käufers
// ---------------------------------------------------------------------------
export async function fulfillOrderSession(session: Stripe.Checkout.Session, expectedUserId?: string) {
  const s = stripe();
  if (!s) throw new Error("Stripe fehlt");
  const orderId = Number(session.metadata?.orderId);
  const buyerId = session.metadata?.userId;
  if (!orderId || !buyerId || session.client_reference_id !== buyerId) return { ok: false, reason: "invalid" };
  if (expectedUserId && expectedUserId !== buyerId) return { ok: false, reason: "foreign" };
  if (session.status !== "complete" || session.payment_status !== "paid") return { ok: false, reason: "unpaid" };
  const [order] = await db.select().from(marketOrders).where(eq(marketOrders.id, orderId)).limit(1);
  if (!order || order.buyerId !== buyerId) return { ok: false, reason: "invalid" };
  if (order.stripeSessionId && order.stripeSessionId !== session.id) return { ok: false, reason: "invalid" };
  if (order.status !== "awaiting_payment") return { ok: true, kind: "order", orderId, alreadyProcessed: true };

  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  let chargeId: string | null = null;
  if (piId) {
    const pi = await s.paymentIntents.retrieve(piId);
    chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id || null;
  }
  const ship: any = (session as any).collected_information?.shipping_details || (session as any).shipping_details || null;
  const address = ship ? JSON.stringify({ name: ship.name || session.customer_details?.name || "", ...(ship.address || {}) }) : null;

  // Genau einmal anwenden (paralleler Webhook + Rückkehr des Käufers)
  const [paid] = await db.update(marketOrders).set({
    status: "paid", paidAt: new Date(), paymentIntentId: piId, chargeId, shippingAddress: address, stripeSessionId: session.id, updatedAt: new Date(),
  }).where(and(eq(marketOrders.id, orderId), eq(marketOrders.status, "awaiting_payment"))).returning();
  if (!paid) return { ok: true, kind: "order", orderId, alreadyProcessed: true };

  // Doppelverkauf verhindern: ist das Inserat schon an jemand anderen bezahlt verkauft, sofort erstatten
  if (paid.listingId) {
    const [other] = rows(await db.execute(sql`
      SELECT id FROM market_orders WHERE listing_id = ${paid.listingId} AND id <> ${paid.id}
        AND status IN ('paid', 'shipped', 'disputed', 'releasing', 'released') LIMIT 1`));
    if (other) {
      await refundOrder(paid, "system", "Die Karte wurde zeitgleich an einen anderen Käufer verkauft.");
      return { ok: true, kind: "order", orderId, refunded: true };
    }
    await db.update(listings).set({ status: "sold" }).where(eq(listings.id, paid.listingId));
    // Andere offene Angebote/Bestellungen für dieses Inserat schließen
    const others = await db.update(marketOrders).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(marketOrders.listingId, paid.listingId), inArray(marketOrders.status, ["offered", "awaiting_payment"]), sql`${marketOrders.id} <> ${paid.id}`))
      .returning({ buyerId: marketOrders.buyerId });
    for (const o of others) await notify(o.buyerId, "ℹ️ Karte verkauft", `„${paid.title}“ wurde an einen anderen Käufer verkauft. Dein Angebot ist erloschen.`, "/?orders=1");
  }
  await notify(paid.sellerId, "💶 Bezahlt – bitte versenden", `„${paid.title}“ für ${eur(paid.priceCents + paid.shippingCents)} ist bezahlt. Das Geld liegt sicher in der Treuhand. Bitte innerhalb von ${SHIP_WINDOW_DAYS} Tagen versenden und die Sendungsnummer eintragen.`, "/?orders=1");
  await notify(paid.buyerId, "✅ Zahlung eingegangen", `„${paid.title}“: Der Verkäufer wurde benachrichtigt. Das Geld wird erst ausgezahlt, wenn du den Erhalt bestätigst.`, "/?orders=1");
  return { ok: true, kind: "order", orderId };
}

// ---------------------------------------------------------------------------
// Auszahlung & Erstattung (idempotent über Stripe-Idempotency-Keys und Zwischenstatus)
// ---------------------------------------------------------------------------
export async function releaseOrder(order: Order, actor: OrderRole, note = "") {
  const s = stripe();
  if (!s) throw new Error("Zahlungen sind nicht eingerichtet.");
  const [seller] = await db.select().from(profiles).where(eq(profiles.userId, order.sellerId)).limit(1);
  if (!seller?.stripeAccountId) throw new Error("Verkäuferkonto fehlt.");
  // Eingefrorene Bestellungen (Rückbuchung) werden nie ausgezahlt
  const [lock] = await db.update(marketOrders).set({ status: "releasing", updatedAt: new Date() })
    .where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, order.status), eq(marketOrders.frozen, false))).returning();
  if (!lock) return null;
  try {
    const amount = order.priceCents + order.shippingCents - order.feeCents;
    const transfer = await s.transfers.create({
      amount, currency: "eur", destination: seller.stripeAccountId, transfer_group: `order_${order.id}`,
      ...(order.chargeId ? { source_transaction: order.chargeId } : {}),
      description: `PokeSwipe Verkauf #${order.id}: ${order.title}`.slice(0, 200),
      metadata: { orderId: String(order.id), buyerId: order.buyerId, sellerId: order.sellerId },
    }, { idempotencyKey: `release-order-${order.id}` });
    const releasedAt = new Date();
    const [done] = await db.update(marketOrders).set({ status: "released", transferId: transfer.id, releasedAt, updatedAt: releasedAt })
      .where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, "releasing"))).returning();
    if (!done) {
      // Während der Auszahlung kam eine Rückbuchung herein: Transfer merken und sofort zurückholen
      const [frozen] = await db.update(marketOrders).set({ transferId: transfer.id, releasedAt, statusBeforeDispute: "released", updatedAt: releasedAt })
        .where(eq(marketOrders.id, order.id)).returning();
      await recordDac7Release(order, releasedAt).catch((e) => log.error("market", "DAC7-Zähler (Auszahlung)", { orderId: order.id, err: e }));
      if (frozen?.frozen) await reverseForDispute(frozen);
      return null;
    }
    await recordDac7Release(order, releasedAt).catch((e) => log.error("market", "DAC7-Zähler (Auszahlung)", { orderId: order.id, err: e }));
    await notify(order.sellerId, "💸 Auszahlung freigegeben", `${eur(amount)} für „${order.title}“ sind unterwegs auf dein Konto (Provision ${eur(order.feeCents)}).${note ? ` ${note}` : ""}`, "/?orders=1");
    if (actor !== "buyer") await notify(order.buyerId, "✅ Kauf abgeschlossen", `„${order.title}“ ist abgeschlossen. Bitte bewerte den Verkäufer.`, "/?orders=1");
    else await notify(order.buyerId, "⭐ Danke! Bitte bewerten", `Wie lief der Kauf von „${order.title}“?`, "/?orders=1");
    forgetTrust(order.sellerId); forgetTrust(order.buyerId);
    return done;
  } catch (e) {
    await db.update(marketOrders).set({ status: order.status, updatedAt: new Date() }).where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, "releasing")));
    throw e;
  }
}

export async function refundOrder(order: Order, actor: OrderRole, reason: string) {
  const s = stripe();
  if (!s) throw new Error("Zahlungen sind nicht eingerichtet.");
  if (!order.paymentIntentId) throw new Error("Keine Zahlung gefunden.");
  const [fresh] = await db.select({ frozen: marketOrders.frozen }).from(marketOrders).where(eq(marketOrders.id, order.id)).limit(1);
  if (fresh?.frozen) throw Object.assign(new Error("Die Bestellung ist wegen einer Rückbuchung eingefroren."), { status: 409 });
  const refund = await s.refunds.create({ payment_intent: order.paymentIntentId, reason: "requested_by_customer", metadata: { orderId: String(order.id), actor } },
    { idempotencyKey: `refund-order-${order.id}` });
  const [done] = await db.update(marketOrders).set({ status: "refunded", refundId: refund.id, disputeReason: reason || order.disputeReason, updatedAt: new Date() })
    .where(and(eq(marketOrders.id, order.id), inArray(marketOrders.status, ["paid", "shipped", "disputed"]))).returning();
  if (done && order.listingId) {
    // Inserat wieder freigeben, falls es durch diese Bestellung als verkauft markiert wurde
    const [still] = rows(await db.execute(sql`SELECT 1 AS x FROM market_orders WHERE listing_id = ${order.listingId} AND id <> ${order.id} AND status IN ('paid','shipped','disputed','releasing','released') LIMIT 1`));
    if (!still) await db.update(listings).set({ status: "active" }).where(and(eq(listings.id, order.listingId), eq(listings.status, "sold")));
  }
  await notify(order.buyerId, "↩️ Geld erstattet", `${eur(order.priceCents + order.shippingCents)} für „${order.title}“ werden zurückgebucht (je nach Bank 5–10 Tage). ${reason}`.trim(), "/?orders=1");
  await notify(order.sellerId, "↩️ Bestellung erstattet", `„${order.title}“ wurde dem Käufer erstattet. ${reason}`.trim(), "/?orders=1");
  return done;
}

// ---------------------------------------------------------------------------
// Phase 6: Betrugsschutz – Wertgrenzen je Vertrauensstufe, Sperre markierter Konten, DAC7-Sperre
// ---------------------------------------------------------------------------
const trustScoreOf = async (userId: string) => (await trustFor([userId])).get(userId)?.score ?? 0;

/** Fehlermeldung, wenn der Käufer diesen Betrag (Preis + Versand) nicht per Treuhand bezahlen darf, sonst null. */
export async function escrowBuyGate(buyer: Pick<Profile, "userId" | "flaggedAt">, amountCents: number): Promise<string | null> {
  const r = checkEscrowLimit("buy", await trustScoreOf(buyer.userId), Boolean(buyer.flaggedAt), amountCents);
  return r.ok ? null : r.error;
}

/** Fehlermeldung, wenn der Verkäufer ein Sofort-Kauf-Inserat/einen Verkauf zu diesem Preis nicht anbieten darf, sonst null. */
export async function escrowSellGate(seller: { userId: string; flaggedAt?: Date | string | null }, priceCents: number): Promise<string | null> {
  const r = checkEscrowLimit("sell", await trustScoreOf(seller.userId), Boolean(seller.flaggedAt), priceCents);
  if (!r.ok) return r.error;
  return dac7SellerBlock(seller.userId);
}

/** Für POST /api/listings: prüft alle Sofort-Kauf-Inserate einer Anfrage (höchster Preis zählt). */
export async function buyNowListingGate(profile: Profile, items: any[]): Promise<string | null> {
  if (!profile.stripeAccountReady) return null; // ohne verifiziertes Konto wird ohnehin kein Sofort-Kauf gespeichert
  const prices = items.filter((it) => it && it.buyNow === true).map((it) => { const m = money(it.price); return m === null ? 0 : Math.round(Number(m) * 100); });
  if (!prices.length) return null;
  return escrowSellGate(profile, Math.max(...prices));
}

async function adminUserIds(): Promise<string[]> {
  return rows(await db.execute(sql`SELECT user_id FROM profiles
    WHERE lower(email) IN (SELECT trim(x) FROM unnest(regexp_split_to_array(lower(${process.env.ADMIN_EMAILS || ""}), '[,; ]+')) x WHERE x <> '') LIMIT 5`))
    .map((a: any) => String(a.user_id));
}
async function notifyAdmins(title: string, text: string, link = "/?orders=1") {
  for (const id of await adminUserIds()) await notify(id, title, text, link);
}

// ---------------------------------------------------------------------------
// Phase 6: Rückbuchungen (Stripe-Disputes) – einfrieren, Auszahlung zurückholen, Käufer markieren
// ---------------------------------------------------------------------------
type DisputeLike = {
  id: string; status: string; amount?: number; reason?: string;
  charge: string | { id: string; customer?: unknown } | null; payment_intent?: string | { id: string } | null;
};
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : (v as any)?.id ? String((v as any).id) : null);
const WON = ["won", "warning_closed", "prevented"];
const DISPUTE_REASONS: Record<string, string> = {
  fraudulent: "Zahlung nicht autorisiert", product_not_received: "Ware nicht erhalten", product_unacceptable: "Ware nicht wie beschrieben",
  duplicate: "doppelte Abbuchung", subscription_canceled: "Abo gekündigt", credit_not_processed: "Gutschrift nicht erhalten", unrecognized: "Abbuchung nicht erkannt",
};
const reasonText = (d: DisputeLike) => DISPUTE_REASONS[String(d.reason)] || "sonstiger Grund";

async function orderForDispute(d: DisputeLike): Promise<Order | null> {
  const chargeId = idOf(d.charge), piId = idOf(d.payment_intent);
  if (!chargeId && !piId) return null;
  const [o] = await db.select().from(marketOrders).where(or(
    chargeId ? eq(marketOrders.chargeId, chargeId) : sql`false`,
    piId ? eq(marketOrders.paymentIntentId, piId) : sql`false`,
  )).limit(1);
  return o ?? null;
}

/** Markiert ein Konto nach einer Rückbuchung (genau einmal je Dispute, nachvollziehbar im Moderationsprotokoll). */
async function flagForChargeback(userId: string, disputeId: string, targetType: "order" | "subscription", reason: string) {
  const [seen] = await db.select({ id: moderationLog.id }).from(moderationLog)
    .where(and(eq(moderationLog.action, "chargeback"), eq(moderationLog.targetId, disputeId))).limit(1);
  if (seen) return false;
  await db.insert(moderationLog).values({ action: "chargeback", targetType, targetId: disputeId, userId, reason: reason.slice(0, 300) });
  await db.update(profiles).set({
    flaggedAt: sql`coalesce(${profiles.flaggedAt}, now())`, flagReason: reason.slice(0, 300), chargebacks: sql`${profiles.chargebacks} + 1`,
  }).where(eq(profiles.userId, userId));
  forgetTrust(userId);
  return true;
}

/** Holt eine bereits erfolgte Auszahlung an den Verkäufer zurück (gleicht das Verkäuferguthaben aus). */
async function reverseForDispute(o: Order): Promise<Order> {
  const s = stripe();
  if (!s || !o.transferId || o.transferReversalId) return o;
  const amount = o.priceCents + o.shippingCents - o.feeCents;
  const reversal = await s.transfers.createReversal(o.transferId, {
    description: `Rückbuchung (Chargeback) Bestellung #${o.id}`.slice(0, 200),
    metadata: { orderId: String(o.id), disputeId: o.stripeDisputeId || "" },
  }, { idempotencyKey: `dispute-reversal-${o.stripeDisputeId || `order-${o.id}`}` });
  const [u] = await db.update(marketOrders).set({ transferReversalId: reversal.id, updatedAt: new Date() }).where(eq(marketOrders.id, o.id)).returning();
  await notify(o.sellerId, "⚠️ Rückbuchung: Auszahlung zurückgeholt",
    `Der Käufer von „${o.title}“ hat die Zahlung bei seiner Bank zurückgebucht (Chargeback). ${eur(amount)} wurden von deinem Verkäuferkonto zurückgeholt, bis die Bank entscheidet. Wir legen mit Sendungsverfolgung und Chatverlauf Widerspruch ein – gewinnen wir, bekommst du den Betrag automatisch zurück.`, "/?orders=1");
  return u ?? o;
}

/** Dispute zu einer Plattform-Zahlung (Abo/Boost): zahlendes Konto markieren. */
async function flagPlatformDispute(d: DisputeLike) {
  const s = stripe();
  let customer = typeof d.charge === "object" && d.charge ? idOf((d.charge as any).customer) : null;
  const chargeId = idOf(d.charge);
  if (!customer && chargeId && s) customer = idOf((await s.charges.retrieve(chargeId)).customer);
  if (!customer) return { kind: "unknown" as const };
  const [p] = await db.select().from(profiles).where(eq(profiles.stripeCustomerId, customer)).limit(1);
  if (!p) return { kind: "unknown" as const };
  const flagged = await flagForChargeback(p.userId, d.id, "subscription", `Rückbuchung einer Abo-/Plattform-Zahlung (${reasonText(d)}, Stripe ${d.id})`);
  if (flagged) await notifyAdmins("🚩 Rückbuchung (Abo/Plattform)", `${p.displayName}: ${d.amount ? eur(d.amount) : ""} – ${reasonText(d)}. Konto markiert, Treuhand-Käufe gesperrt.`, "/?admin=1");
  return { kind: "platform" as const, userId: p.userId, flagged };
}

/** charge.dispute.created – Bestellung einfrieren (idempotent), Auszahlung sperren bzw. zurückholen, Käufer markieren. */
export async function handleDisputeCreated(d: DisputeLike) {
  let o = await orderForDispute(d);
  if (!o) return flagPlatformDispute(d);
  let first = false;
  for (let attempt = 0; attempt < 3 && !o.frozen && !o.disputeStatus; attempt++) {
    const [claimed] = await db.update(marketOrders).set({
      frozen: true, statusBeforeDispute: o.status, status: "chargeback", stripeDisputeId: d.id, disputeStatus: "open", updatedAt: new Date(),
    }).where(and(eq(marketOrders.id, o.id), eq(marketOrders.frozen, false), eq(marketOrders.status, o.status))).returning();
    if (claimed) { o = claimed; first = true; break; }
    const [fresh] = await db.select().from(marketOrders).where(eq(marketOrders.id, o.id)).limit(1);
    if (!fresh) return { kind: "order" as const, orderId: o.id, missing: true };
    o = fresh;
  }
  if (first) {
    await flagForChargeback(o.buyerId, d.id, "order", `Rückbuchung bei Bestellung #${o.id} (${reasonText(d)}, Stripe ${d.id})`);
    await notify(o.buyerId, "⚠️ Rückbuchung eingegangen",
      `Deine Bank hat die Zahlung für „${o.title}“ zurückgebucht (${reasonText(d)}). Die Bestellung ist eingefroren, bis die Bank entscheidet; Käufe mit Käuferschutz sind für dein Konto bis zur Klärung gesperrt. Bei Problemen nutze bitte künftig zuerst „Problem melden“ – das geht schneller.`, "/?orders=1");
    if (!o.transferId) {
      await notify(o.sellerId, "⚠️ Rückbuchung: Auszahlung gesperrt",
        `Der Käufer von „${o.title}“ hat die Zahlung bei seiner Bank zurückgebucht (${reasonText(d)}). Die Auszahlung ist gesperrt, bis die Bank entscheidet. Bitte halte Versandbeleg, Sendungsnummer und Fotos bereit – wir legen Widerspruch ein.`, "/?orders=1");
    }
    await notifyAdmins("🚩 Neue Rückbuchung (Chargeback)", `Bestellung #${o.id}: ${o.title} – ${reasonText(d)}. Beweise im Stripe-Dashboard einreichen.`);
  }
  if (o.transferId && !o.transferReversalId) o = await reverseForDispute(o);
  return { kind: "order" as const, orderId: o.id, frozen: o.frozen, first };
}

/** charge.dispute.closed – gewonnen: auftauen und (falls zurückgeholt) erneut auszahlen; verloren: eingefroren lassen. */
export async function handleDisputeClosed(d: DisputeLike) {
  const won = WON.includes(d.status), lost = d.status === "lost";
  if (!won && !lost) return handleDisputeCreated(d);
  let o = await orderForDispute(d);
  if (!o) {
    // Plattform-Zahlung: Markierung bleibt bestehen (Prüfung durch das Team), bei Verlust zusätzlich Hinweis
    if (lost) await notifyAdmins("🚩 Rückbuchung verloren (Abo/Plattform)", `Stripe ${d.id}: ${reasonText(d)}.`, "/?admin=1");
    return { kind: "platform" as const, status: d.status };
  }
  if (!o.stripeDisputeId) {
    await handleDisputeCreated(d); // „created“ wurde verpasst – erst einfrieren
    const [fresh] = await db.select().from(marketOrders).where(eq(marketOrders.id, o.id)).limit(1);
    if (!fresh) return { kind: "order" as const, orderId: o.id, missing: true };
    o = fresh;
  }
  if (o.disputeStatus === "won" || o.disputeStatus === "lost") return { kind: "order" as const, orderId: o.id, alreadyProcessed: true };
  const s = stripe();
  if (!s) throw new Error("Stripe fehlt");

  if (won) {
    let transferId = o.transferId;
    if (o.transferReversalId) {
      const [seller] = await db.select().from(profiles).where(eq(profiles.userId, o.sellerId)).limit(1);
      if (!seller?.stripeAccountId) throw new Error(`Verkäuferkonto fehlt für erneute Auszahlung (Bestellung #${o.id})`);
      const t = await s.transfers.create({
        amount: o.priceCents + o.shippingCents - o.feeCents, currency: "eur", destination: seller.stripeAccountId, transfer_group: `order_${o.id}`,
        description: `PokeSwipe Verkauf #${o.id} (Rückbuchung abgewiesen): ${o.title}`.slice(0, 200),
        metadata: { orderId: String(o.id), disputeId: d.id, kind: "dispute_won" },
      }, { idempotencyKey: `dispute-won-${d.id}` });
      transferId = t.id;
    }
    const before = o.statusBeforeDispute;
    const restore = o.transferId ? "released" : before === "releasing" ? "disputed" : before || "released";
    const [u] = await db.update(marketOrders).set({ frozen: false, disputeStatus: "won", status: restore, transferId, updatedAt: new Date() })
      .where(and(eq(marketOrders.id, o.id), eq(marketOrders.disputeStatus, "open"))).returning();
    if (!u) return { kind: "order" as const, orderId: o.id, alreadyProcessed: true };
    await notify(o.sellerId, "✅ Rückbuchung abgewiesen",
      `Die Bank hat bei „${o.title}“ zu deinen Gunsten entschieden.${o.transferReversalId ? ` ${eur(o.priceCents + o.shippingCents - o.feeCents)} werden dir erneut ausgezahlt.` : " Die Bestellung läuft normal weiter."}`, "/?orders=1");
    await notify(o.buyerId, "ℹ️ Rückbuchung abgewiesen", `Die Bank hat die Rückbuchung für „${o.title}“ abgelehnt. Die Zahlung bleibt bestehen.`, "/?orders=1");
    forgetTrust(o.sellerId); forgetTrust(o.buyerId);
    return { kind: "order" as const, orderId: o.id, status: restore };
  }

  // Verloren: Geld ist an den Käufer zurückgegangen – Bestellung bleibt eingefroren
  if (o.transferId && !o.transferReversalId) o = await reverseForDispute(o);
  const [u] = await db.update(marketOrders).set({ disputeStatus: "lost", status: "chargeback_lost", frozen: true, updatedAt: new Date() })
    .where(and(eq(marketOrders.id, o.id), eq(marketOrders.disputeStatus, "open"))).returning();
  if (!u) return { kind: "order" as const, orderId: o.id, alreadyProcessed: true };
  if (o.transferId) await recordDac7Refund(o).catch((e) => log.error("market", "DAC7-Zähler (Rückbuchung)", { orderId: o!.id, err: e }));
  // Nicht versendet → Karte ist noch beim Verkäufer, Inserat wieder freigeben
  if (o.listingId && o.statusBeforeDispute === "paid") {
    await db.update(listings).set({ status: "active" }).where(and(eq(listings.id, o.listingId), eq(listings.status, "sold")));
  }
  await notify(o.sellerId, "❌ Rückbuchung verloren",
    `Die Bank hat bei „${o.title}“ zugunsten des Käufers entschieden. ${o.transferId ? "Die zurückgeholte Auszahlung" : "Die Auszahlung"} entfällt. Falls du die Karte versendet hast, wende dich mit Sendungsnachweis an unser Team – wir prüfen den Fall und das Käuferkonto bleibt gesperrt.`, "/?orders=1");
  await notify(o.buyerId, "ℹ️ Rückbuchung abgeschlossen", `Deine Bank hat die Rückbuchung für „${o.title}“ zu deinen Gunsten entschieden. Dein Konto bleibt bis zur Prüfung durch unser Team für Käufe mit Käuferschutz gesperrt.`, "/?orders=1");
  forgetTrust(o.sellerId); forgetTrust(o.buyerId);
  return { kind: "order" as const, orderId: o.id, status: "chargeback_lost" };
}

/** charge.dispute.updated – Endstatus wie „closed“ behandeln, sonst sicherstellen, dass eingefroren ist. */
export async function handleDisputeUpdated(d: DisputeLike) {
  if (WON.includes(d.status) || d.status === "lost") return handleDisputeClosed(d);
  return handleDisputeCreated(d);
}

// ---------------------------------------------------------------------------
// Geplanter Job (netlify/functions/market-escrow.mts): Fristen überwachen
// ---------------------------------------------------------------------------
export async function runEscrowJobs() {
  const result = { released: 0, expired: 0, refunded: 0, errors: 0, dac7Reminders: 0 };
  // 1. Angebote ohne Antwort und unbezahlte Bestellungen verfallen
  const expired = await db.update(marketOrders).set({ status: "cancelled", updatedAt: new Date() }).where(sql`
    (${marketOrders.status} = 'offered' AND ${marketOrders.createdAt} < now() - make_interval(hours => ${OFFER_TTL_HOURS}::int))
    OR (${marketOrders.status} = 'awaiting_payment' AND ${marketOrders.payBy} < now())`).returning();
  for (const o of expired) {
    result.expired++;
    await notify(o.buyerId, "⌛ Bestellung verfallen", `„${o.title}“: ${o.payBy ? "Die Zahlungsfrist ist abgelaufen" : "Der Verkäufer hat nicht auf dein Angebot reagiert"} – es wurde nichts berechnet.`, "/?orders=1");
  }
  // 2. Nach Versand ohne Reklamation automatisch auszahlen
  const due = await db.select().from(marketOrders).where(and(eq(marketOrders.status, "shipped"), eq(marketOrders.frozen, false), sql`${marketOrders.releaseAfter} < now()`)).limit(25);
  for (const o of due) {
    // Zeitbudget des geplanten Laufs: keine neue Auszahlung mehr beginnen, Rest folgt im nächsten Lauf
    if (currentJob()?.near(6000)) { currentJob()?.markPartial("Zeitbudget: Auszahlungen offen"); break; }
    try { if (await releaseOrder(o, "system", "Automatisch nach Ablauf der Prüffrist.")) result.released++; } catch (e) { result.errors++; log.error("market", "Auto-Auszahlung fehlgeschlagen", { orderId: o.id, err: e }); }
  }
  // 3. Bezahlt, aber nicht versendet → automatisch erstatten
  const late = await db.select().from(marketOrders).where(and(eq(marketOrders.status, "paid"), eq(marketOrders.frozen, false), sql`${marketOrders.paidAt} < now() - make_interval(days => ${SHIP_WINDOW_DAYS}::int)`)).limit(25);
  for (const o of late) {
    if (currentJob()?.near(6000)) { currentJob()?.markPartial("Zeitbudget: Erstattungen offen"); break; }
    try { await refundOrder(o, "system", `Nicht innerhalb von ${SHIP_WINDOW_DAYS} Tagen versendet.`); result.refunded++; } catch (e) { result.errors++; log.error("market", "Auto-Erstattung fehlgeschlagen", { orderId: o.id, err: e }); }
  }
  // 4. Erinnerung an Verkäufer 2 Tage vor Ablauf der Versandfrist
  const remind = await db.select().from(marketOrders).where(and(eq(marketOrders.status, "paid"), eq(marketOrders.frozen, false),
    sql`${marketOrders.paidAt} BETWEEN now() - make_interval(days => ${SHIP_WINDOW_DAYS}::int) AND now() - make_interval(days => ${SHIP_WINDOW_DAYS - 2}::int)`,
    sql`${marketOrders.updatedAt} < now() - interval '1 day'`)).limit(50);
  for (const o of remind) {
    await notify(o.sellerId, "📦 Versand-Erinnerung", `Bitte versende „${o.title}“ und trage die Sendungsnummer ein – sonst wird der Kauf automatisch erstattet.`, "/?orders=1");
    await db.update(marketOrders).set({ updatedAt: new Date() }).where(eq(marketOrders.id, o.id));
  }
  // 5. DAC7: meldepflichtige Verkäufer ohne Steuerdaten erinnern (max. 2-mal, danach Sperre für neue Verkäufe)
  try { result.dac7Reminders = (await runDac7Reminders()).reminded; } catch (e) { result.errors++; log.error("market", "DAC7-Erinnerungen fehlgeschlagen", { err: e }); }
  return result;
}

// ---------------------------------------------------------------------------
// Ansicht einer Bestellung für Käufer/Verkäufer (Adresse nur für Verkäufer und erst nach Zahlung)
// ---------------------------------------------------------------------------
function orderView(o: any, userId: string, admin = false) {
  const role = o.buyer_id === userId ? "buyer" : o.seller_id === userId ? "seller" : "admin";
  const showAddress = (role === "seller" || admin) && ["paid", "shipped", "disputed"].includes(o.status);
  let address: any = null;
  if (showAddress && o.shipping_address) { try { address = JSON.parse(o.shipping_address); } catch {} }
  return {
    id: Number(o.id), listingId: o.listing_id, title: o.title, image: o.image, status: o.status, role,
    priceCents: o.price_cents, shippingCents: o.shipping_cents, totalCents: o.price_cents + o.shipping_cents,
    feeCents: role === "buyer" ? undefined : o.fee_cents, payoutCents: role === "buyer" ? undefined : o.price_cents + o.shipping_cents - o.fee_cents,
    message: o.message, carrier: o.carrier, carrierLabel: CARRIERS[o.carrier] || o.carrier, trackingNumber: o.tracking_number,
    trackingUrl: o.tracking_number ? trackingUrl(o.carrier, o.tracking_number) : "", disputeReason: o.dispute_reason,
    payBy: o.pay_by, paidAt: o.paid_at, shippedAt: o.shipped_at, releaseAfter: o.release_after, releasedAt: o.released_at, createdAt: o.created_at,
    buyer: { id: o.buyer_id, name: o.buyer_name }, seller: { id: o.seller_id, name: o.seller_name },
    address, reviewed: Boolean(o.reviewed), frozen: Boolean(o.frozen), disputeStatus: o.dispute_status || "",
    ...(admin ? {
      stripeDisputeId: o.stripe_dispute_id || null, statusBeforeDispute: o.status_before_dispute || "", transferId: o.transfer_id || null,
      transferReversalId: o.transfer_reversal_id || null, chargeId: o.charge_id || null, paymentIntentId: o.payment_intent_id || null,
    } : {}),
  };
}

const ORDER_SELECT = (userId: string) => sql`
  SELECT o.*, pb.display_name AS buyer_name, ps.display_name AS seller_name,
    EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id AND r.reviewer_id = ${userId}) AS reviewed
  FROM market_orders o JOIN profiles pb ON pb.user_id = o.buyer_id JOIN profiles ps ON ps.user_id = o.seller_id`;

async function loadOrderFor(id: number, user: AuthUser) {
  const admin = isAdmin(user);
  const [o] = rows(await db.execute(sql`${ORDER_SELECT(user.id)} WHERE o.id = ${id} ${admin ? sql`` : sql`AND (o.buyer_id = ${user.id} OR o.seller_id = ${user.id})`}`));
  return o || null;
}

async function checkoutForOrder(c: any, order: Order, buyer: Profile) {
  const s = stripe();
  if (!s) throw Object.assign(new Error("Zahlungen sind noch nicht eingerichtet."), { status: 503 });
  const o = origin(c);
  // Bewusst OHNE automatic_tax: Bei „separate charges and transfers“ verkauft der (meist private) Verkäufer, nicht die
  // Plattform. Stripe Tax würde Umsatzsteuer auf den Kartenpreis so berechnen, als wären wir Händler – falsch für
  // Privatverkäufe. Die Plattform-Provision ist Teil des Verkäufer-Transfers und wird dort abgerechnet.
  const session = await s.checkout.sessions.create({
    mode: "payment",
    client_reference_id: buyer.userId,
    ...(buyer.stripeCustomerId ? { customer: buyer.stripeCustomerId } : { customer_email: buyer.email }),
    locale: "de",
    line_items: [
      { quantity: 1, price_data: { currency: "eur", unit_amount: order.priceCents, product_data: { name: order.title.slice(0, 200), description: "Kauf mit PokeSwipe-Käuferschutz (Treuhand)" } } },
      ...(order.shippingCents ? [{ quantity: 1, price_data: { currency: "eur", unit_amount: order.shippingCents, product_data: { name: "Versand (versichert empfohlen)" } } }] : []),
    ],
    shipping_address_collection: { allowed_countries: [...SHIP_COUNTRIES] as any },
    payment_intent_data: {
      transfer_group: `order_${order.id}`,
      description: `PokeSwipe Bestellung #${order.id}`,
      metadata: { kind: "order", orderId: String(order.id), buyerId: order.buyerId, sellerId: order.sellerId },
    },
    metadata: { kind: "order", orderId: String(order.id), userId: buyer.userId, legal_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() },
    custom_text: { submit: { message: `Käuferschutz: Das Geld wird erst an den Verkäufer ausgezahlt, wenn du den Erhalt bestätigst (spätestens ${AUTO_RELEASE_DAYS} Tage nach Versand). Mit dem Klick schließt du einen zahlungspflichtigen Kaufvertrag mit dem Verkäufer ab.` } },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 Stunde
    success_url: `${o}/?order=paid&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${o}/?orders=1`,
  });
  await db.update(marketOrders).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(marketOrders.id, order.id));
  return session.url;
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerMarket(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;

  // ---------------- Verkäuferkonto ----------------
  app.get("/api/market/seller", auth, async (c: any) => {
    const p: Profile = c.get("profile"), plan: PlanId = c.get("plan");
    const fee = { bps: MARKET_FEE_BPS[plan], allBps: MARKET_FEE_BPS };
    if (!stripe()) return c.json({ enabled: false, connected: false, ready: false, fee });
    try {
      return c.json({ enabled: true, ...(await syncSellerAccount(p)), fee, termsAccepted: Boolean(p.sellerTermsAt) });
    } catch (e: any) {
      console.warn("Connect-Status", e?.message);
      return c.json({ enabled: true, connected: Boolean(p.stripeAccountId), ready: p.stripeAccountReady, fee, error: "Stripe Connect ist im Stripe-Konto noch nicht aktiviert oder nicht erreichbar." });
    }
  });

  app.post("/api/market/seller/onboard", auth, async (c: any) => {
    const s = stripe();
    if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
    const user: AuthUser = c.get("user"), p: Profile = c.get("profile");
    if (!user.confirmed) return c.json({ error: "Bitte bestätige zuerst deine E-Mail-Adresse." }, 403);
    const b = await body(c);
    if (b.acceptTerms !== true && !p.sellerTermsAt) return c.json({ error: "Bitte bestätige die Verkäufer-Bedingungen.", needsConsent: true }, 428);
    let accountId = p.stripeAccountId;
    try {
      if (!accountId) {
        const acct = await s.accounts.create({
          type: "express", country: "DE", email: p.email,
          capabilities: { transfers: { requested: true } },
          business_profile: { product_description: "Privatverkauf von Pokémon-Sammelkarten über PokeSwipe & Radar", mcc: "5945", url: process.env.URL || "https://pokeswipe-radar.de" },
          settings: { payouts: { schedule: { interval: "daily" } } },
          metadata: { userId: p.userId },
        }, { idempotencyKey: `connect-${p.userId}` });
        accountId = acct.id;
        await db.update(profiles).set({ stripeAccountId: accountId, sellerTermsAt: p.sellerTermsAt || new Date() }).where(eq(profiles.userId, p.userId));
      } else if (!p.sellerTermsAt) {
        await db.update(profiles).set({ sellerTermsAt: new Date() }).where(eq(profiles.userId, p.userId));
      }
      const o = origin(c);
      const link = await s.accountLinks.create({ account: accountId, type: "account_onboarding", refresh_url: `${o}/?seller=refresh`, return_url: `${o}/?seller=done` });
      return c.json({ url: link.url });
    } catch (e: any) {
      log.error("market", "Connect-Onboarding", { err: e });
      return c.json({ error: /connect/i.test(String(e?.message)) ? "Stripe Connect ist im Stripe-Konto der Plattform noch nicht aktiviert (Dashboard → Connect)." : "Verkäuferkonto konnte nicht angelegt werden." }, 502);
    }
  });

  app.post("/api/market/seller/dashboard", auth, async (c: any) => {
    const s = stripe(), p: Profile = c.get("profile");
    if (!s || !p.stripeAccountId) return c.json({ error: "Kein Verkäuferkonto." }, 404);
    const link = await s.accounts.createLoginLink(p.stripeAccountId);
    return c.json({ url: link.url });
  });

  app.get("/api/market/meta", (c: any) => c.json({ conditions: CONDITIONS, carriers: CARRIERS, feeBps: MARKET_FEE_BPS, autoReleaseDays: AUTO_RELEASE_DAYS, shipWindowDays: SHIP_WINDOW_DAYS, payWindowHours: PAY_WINDOW_HOURS, countries: SHIP_COUNTRIES, enabled: Boolean(stripe()) }));

  // ---------------- Bestellungen ----------------
  app.get("/api/orders", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const list = rows(await db.execute(sql`${ORDER_SELECT(user.id)} WHERE o.buyer_id = ${user.id} OR o.seller_id = ${user.id} ORDER BY o.updated_at DESC LIMIT 100`));
    return c.json({ orders: list.map((o: any) => orderView(o, user.id)) });
  });

  /** Kaufen (Sofort-Kauf zum Inseratspreis) oder verbindliches Preisangebot abgeben */
  app.post("/api/orders", auth, async (c: any) => {
    const user: AuthUser = c.get("user"), buyer: Profile = c.get("profile");
    if (!stripe()) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
    if (!user.confirmed) return c.json({ error: "Bitte bestätige zuerst deine E-Mail-Adresse." }, 403);
    if (!(await rateLimit(`order:${user.id}`, 10, 600_000))) return c.json({ error: "Zu viele Bestellungen in kurzer Zeit." }, 429);
    const b = await body(c);
    if (b.acceptTerms !== true) return c.json({ error: "Bitte bestätige die Kaufbedingungen.", needsConsent: true }, 428);
    const listingId = int(b.listingId, 1, 2 ** 31 - 1, 0);
    const [l] = rows(await db.execute(sql`
      SELECT l.*, p.stripe_account_ready, p.stripe_account_id, p.plan, p.plan_until, p.bonus_until, p.bonus_plan, p.banned, p.display_name, p.flagged_at
      FROM listings l JOIN profiles p ON p.user_id = l.user_id WHERE l.id = ${listingId} AND l.status = 'active'`));
    if (!l) return c.json({ error: "Inserat nicht mehr verfügbar." }, 404);
    if (l.user_id === user.id) return c.json({ error: "Das ist dein eigenes Inserat." }, 400);
    if (!l.buy_now || !l.stripe_account_ready || !l.stripe_account_id || l.banned) return c.json({ error: "Dieses Inserat ist nicht für den Kauf mit Käuferschutz freigeschaltet – nutze die Tauschanfrage." }, 409);
    if (await isBlockedBetween(user.id, l.user_id)) return c.json({ error: "Kauf nicht möglich." }, 403);
    const [open] = rows(await db.execute(sql`SELECT id, status FROM market_orders WHERE listing_id = ${listingId} AND buyer_id = ${user.id} AND status IN ('offered','awaiting_payment') LIMIT 1`));
    const listCents = Math.round(Number(l.price) * 100);
    if (listCents < MARKET_MIN_PRICE_CENTS || listCents > MARKET_MAX_PRICE_CENTS) return c.json({ error: "Preis außerhalb des erlaubten Rahmens (1 € bis 10.000 €)." }, 400);
    const offer = b.offerCents !== undefined && b.offerCents !== null && Number(b.offerCents) !== listCents ? Math.round(Number(b.offerCents)) : null;
    if (offer !== null && !validOffer(listCents, offer)) return c.json({ error: `Angebote müssen zwischen ${eur(Math.ceil(listCents * 0.5))} und ${eur(listCents)} liegen.` }, 400);
    const sellerPlan = effectivePlan({ plan: l.plan, planUntil: l.plan_until ? new Date(l.plan_until) : null, bonusUntil: l.bonus_until ? new Date(l.bonus_until) : null, bonusPlan: l.bonus_plan });
    const price = offer ?? listCents;
    // Phase 6: Wertgrenzen je Vertrauensstufe, Sperre nach Rückbuchung, DAC7-Sperre des Verkäufers
    const buyerGate = await escrowBuyGate(buyer, price + (Number(l.shipping_cents) || 0));
    if (buyerGate) return c.json({ error: buyerGate }, 403);
    const sellerGate = await escrowSellGate({ userId: String(l.user_id), flaggedAt: l.flagged_at }, listCents);
    if (sellerGate) return c.json({ error: "Dieses Inserat kann gerade nicht mit Käuferschutz gekauft werden – nutze die Tauschanfrage oder wende dich an den Verkäufer.", reason: "seller_limit" }, 403);
    const fee = feeFor(sellerPlan, price, Number(l.shipping_cents) || 0);
    const message = str(b.message, 400);

    let order: Order;
    if (open) {
      // Bestehende offene Bestellung desselben Käufers wiederverwenden (z. B. Zahlung abgebrochen)
      if (open.status === "offered" && offer === null) {
        const [u] = await db.update(marketOrders).set({ status: "awaiting_payment", priceCents: price, feeCents: fee.feeCents, feeBps: fee.bps, payBy: new Date(Date.now() + PAY_WINDOW_HOURS * 3600_000), updatedAt: new Date() }).where(eq(marketOrders.id, Number(open.id))).returning();
        order = u;
      } else if (open.status === "awaiting_payment") {
        [order] = await db.select().from(marketOrders).where(eq(marketOrders.id, Number(open.id)));
      } else return c.json({ error: "Du hast für dieses Inserat schon ein offenes Angebot." }, 409);
    } else {
      const [created] = await db.insert(marketOrders).values({
        listingId, buyerId: user.id, sellerId: l.user_id, title: String(l.card_name).slice(0, 160), image: l.image || "",
        status: offer !== null ? "offered" : "awaiting_payment", priceCents: price, shippingCents: Number(l.shipping_cents) || 0,
        feeCents: fee.feeCents, feeBps: fee.bps, message,
        payBy: offer !== null ? null : new Date(Date.now() + PAY_WINDOW_HOURS * 3600_000),
      }).returning();
      order = created;
    }
    if (order.status === "offered") {
      await notify(l.user_id, "💰 Verbindliches Preisangebot", `${buyer.displayName} bietet ${eur(price)} für „${l.card_name}“ (Inserat: ${eur(listCents)}).${message ? ` „${message.slice(0, 80)}“` : ""}`, "/?orders=1");
      return c.json({ orderId: order.id, offered: true }, 201);
    }
    try {
      const url = await checkoutForOrder(c, order, buyer);
      return c.json({ url, orderId: order.id }, 201);
    } catch (e: any) {
      return c.json({ error: e.message || "Bezahlung konnte nicht gestartet werden." }, e.status || 502);
    }
  });

  app.post("/api/orders/:id/pay", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    if ((await body(c)).acceptTerms !== true) return c.json({ error: "Bitte bestätige die Kaufbedingungen.", needsConsent: true }, 428);
    const [order] = await db.select().from(marketOrders).where(and(eq(marketOrders.id, id), eq(marketOrders.buyerId, user.id))).limit(1);
    if (!order || order.status !== "awaiting_payment") return c.json({ error: "Diese Bestellung kann nicht bezahlt werden." }, 409);
    if (order.payBy && new Date(order.payBy) < new Date()) return c.json({ error: "Die Zahlungsfrist ist abgelaufen." }, 409);
    const gate = await escrowBuyGate(c.get("profile"), order.priceCents + order.shippingCents);
    if (gate) return c.json({ error: gate }, 403);
    if (order.listingId) {
      const [l] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, order.listingId)).limit(1);
      if (!l || l.status !== "active") return c.json({ error: "Die Karte ist nicht mehr verfügbar." }, 409);
    }
    try { return c.json({ url: await checkoutForOrder(c, order, c.get("profile")) }); }
    catch (e: any) { return c.json({ error: e.message || "Bezahlung konnte nicht gestartet werden." }, e.status || 502); }
  });

  app.post("/api/orders/confirm-session", auth, async (c: any) => {
    const s = stripe();
    if (!s) return c.json({ error: "Zahlungen sind noch nicht eingerichtet." }, 503);
    const sid = str((await body(c)).sessionId, 200);
    if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return c.json({ error: "Ungültige Sitzung" }, 400);
    const session = await s.checkout.sessions.retrieve(sid);
    if (session.metadata?.kind !== "order") return c.json({ error: "Keine Marktplatz-Zahlung" }, 400);
    const r = await fulfillOrderSession(session, c.get("user").id);
    if (!r.ok) return c.json({ error: "Zahlung konnte nicht bestätigt werden.", reason: r.reason }, 402);
    return c.json(r);
  });

  /** Aktionen: accept | decline | cancel | ship | confirm | dispute | refund (Verkäufer storniert nach Zahlung) */
  app.post("/api/orders/:id/action", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const [order] = await db.select().from(marketOrders).where(and(eq(marketOrders.id, id), sql`(${marketOrders.buyerId} = ${user.id} OR ${marketOrders.sellerId} = ${user.id})`)).limit(1);
    if (!order) return c.json({ error: "Bestellung nicht gefunden" }, 404);
    const role: OrderRole = order.buyerId === user.id ? "buyer" : "seller";
    const action = str(b.action, 20) as OrderAction;
    if (order.frozen) return c.json({ error: "Diese Bestellung ist wegen einer Rückbuchung (Chargeback) eingefroren. Unser Team meldet sich, sobald die Bank entschieden hat." }, 409);
    const to = nextStatus(role, action, order.status as OrderStatus);
    if (!to) return c.json({ error: "Diese Aktion ist gerade nicht möglich." }, 409);
    const name = c.get("profile").displayName;
    const now = new Date();
    try {
      if (action === "confirm") {
        const done = await releaseOrder(order, "buyer");
        return done ? c.json({ ok: true, status: "released" }) : c.json({ error: "Status hat sich geändert – bitte neu laden." }, 409);
      }
      if (action === "refund") {
        const done = await refundOrder(order, "seller", `Vom Verkäufer storniert.${b.reason ? ` ${str(b.reason, 200)}` : ""}`);
        return done ? c.json({ ok: true, status: "refunded" }) : c.json({ error: "Status hat sich geändert – bitte neu laden." }, 409);
      }
      const updates: Partial<typeof marketOrders.$inferInsert> = { status: to, updatedAt: now };
      let msg: [string, string] | null = null;
      const other = role === "buyer" ? order.sellerId : order.buyerId;
      if (action === "accept") {
        const gate = await escrowSellGate(c.get("profile"), order.priceCents);
        if (gate) return c.json({ error: gate }, 403);
        updates.payBy = new Date(Date.now() + PAY_WINDOW_HOURS * 3600_000);
        msg = ["✅ Angebot angenommen", `${name} hat dein Angebot über ${eur(order.priceCents)} für „${order.title}“ angenommen. Bitte innerhalb von ${PAY_WINDOW_HOURS} Stunden bezahlen.`];
      } else if (action === "decline") msg = ["❌ Angebot abgelehnt", `${name} hat dein Angebot für „${order.title}“ abgelehnt.`];
      else if (action === "cancel") msg = ["🚫 Bestellung abgebrochen", `„${order.title}“ wurde von ${name} abgebrochen. Es wurde nichts berechnet.`];
      else if (action === "ship") {
        const carrier = CARRIERS[str(b.carrier, 20)] ? str(b.carrier, 20) : "other";
        const tracking = str(b.trackingNumber, 40).replace(/\s+/g, "");
        if (!validTracking(tracking)) return c.json({ error: "Bitte eine gültige Sendungsnummer eintragen (6–40 Zeichen)." }, 400);
        Object.assign(updates, { carrier, trackingNumber: tracking, shippedAt: now, releaseAfter: new Date(Date.now() + AUTO_RELEASE_DAYS * 86400_000) });
        msg = ["📦 Versendet", `„${order.title}“ ist mit ${CARRIERS[carrier]} unterwegs (${tracking}). Bitte bestätige den Erhalt, sobald die Karte da ist – sonst wird ${AUTO_RELEASE_DAYS} Tage nach Versand automatisch ausgezahlt.`];
      } else if (action === "dispute") {
        const reason = str(b.reason, 500);
        if (reason.length < 10) return c.json({ error: "Bitte beschreibe das Problem (mindestens 10 Zeichen)." }, 400);
        Object.assign(updates, { disputeReason: reason, releaseAfter: null });
        msg = ["⚠️ Reklamation", `Der Käufer hat ein Problem mit „${order.title}“ gemeldet: ${reason.slice(0, 160)}. Die Auszahlung ist pausiert, ein Admin prüft den Fall.`];
      }
      const [updated] = await db.update(marketOrders).set(updates).where(and(eq(marketOrders.id, id), eq(marketOrders.status, order.status))).returning();
      if (!updated) return c.json({ error: "Status hat sich geändert – bitte neu laden." }, 409);
      if (msg) await notify(other, msg[0], msg[1], "/?orders=1");
      if (action === "dispute") await notifyAdmins("🛡️ Neue Reklamation", `Bestellung #${id}: ${order.title}`);
      return c.json({ ok: true, status: updated.status });
    } catch (e: any) {
      if (e?.status === 409) return c.json({ error: e.message }, 409);
      log.error("market", "Bestell-Aktion", { action, orderId: id, err: e });
      return c.json({ error: "Stripe-Vorgang fehlgeschlagen. Bitte später erneut versuchen." }, 502);
    }
  });

  app.post("/api/orders/:id/review", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const [order] = await db.select().from(marketOrders).where(and(eq(marketOrders.id, id), sql`(${marketOrders.buyerId} = ${user.id} OR ${marketOrders.sellerId} = ${user.id})`)).limit(1);
    if (!order || order.status !== "released") return c.json({ error: "Bewerten geht erst nach abgeschlossenem Kauf." }, 409);
    const stars = int(b.stars, 1, 5, 0);
    if (!stars) return c.json({ error: "Bitte 1 bis 5 Sterne vergeben." }, 400);
    const reviewee = order.buyerId === user.id ? order.sellerId : order.buyerId;
    const [rev] = await db.insert(reviews).values({ orderId: id, reviewerId: user.id, revieweeId: reviewee, stars, comment: str(b.comment, 500) }).onConflictDoNothing().returning();
    if (!rev) return c.json({ error: "Du hast diesen Kauf schon bewertet." }, 409);
    forgetTrust(reviewee);
    await notify(reviewee, `⭐ Neue Bewertung: ${stars}/5`, str(b.comment, 120));
    return c.json(rev, 201);
  });

  // ---------------- Admin: Reklamationen & Übersicht ----------------
  app.get("/api/admin/orders", auth, adminOnly, async (c: any) => {
    const user: AuthUser = c.get("user");
    const status = str(c.req.query("status"), 20);
    const list = rows(await db.execute(sql`${ORDER_SELECT(user.id)}
      WHERE ${status ? sql`o.status = ${status}` : sql`(o.status IN ('disputed', 'paid', 'shipped', 'releasing', 'chargeback') OR (o.frozen AND o.dispute_status = 'open'))`}
      ORDER BY (o.status IN ('disputed', 'chargeback')) DESC, o.updated_at DESC LIMIT 100`));
    const [stats] = rows(await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'disputed')::int AS disputed,
        count(*) FILTER (WHERE status IN ('paid', 'shipped'))::int AS in_escrow,
        count(*) FILTER (WHERE frozen AND dispute_status = 'open')::int AS chargebacks_open,
        count(*) FILTER (WHERE dispute_status = 'lost' AND updated_at > date_trunc('year', now()))::int AS chargebacks_lost_year,
        coalesce(sum(price_cents + shipping_cents) FILTER (WHERE status IN ('paid', 'shipped', 'disputed')), 0)::int AS escrow_cents,
        coalesce(sum(fee_cents) FILTER (WHERE status = 'released' AND released_at > date_trunc('month', now())), 0)::int AS fees_month_cents,
        coalesce(sum(price_cents + shipping_cents) FILTER (WHERE status = 'released' AND released_at > date_trunc('month', now())), 0)::int AS gmv_month_cents
      FROM market_orders`));
    return c.json({ orders: list.map((o: any) => orderView(o, user.id, true)), stats });
  });

  app.post("/api/admin/orders/:id/resolve", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const [order] = await db.select().from(marketOrders).where(eq(marketOrders.id, id)).limit(1);
    if (!order) return c.json({ error: "Nicht gefunden" }, 404);
    if (order.frozen) return c.json({ error: "Bestellung ist wegen einer Rückbuchung eingefroren – die Entscheidung trifft die Bank (Stripe-Dashboard → Disputes)." }, 409);
    const action = b.action === "release" ? "release" : b.action === "refund" ? "refund" : null;
    if (!action || !nextStatus("admin", action, order.status as OrderStatus)) return c.json({ error: "Aktion nicht möglich." }, 409);
    const note = str(b.note, 300);
    try {
      const done = action === "release" ? await releaseOrder(order, "admin", note) : await refundOrder(order, "admin", note || "Entscheidung des PokeSwipe-Teams.");
      if (!done) return c.json({ error: "Status hat sich geändert – bitte neu laden." }, 409);
      await db.insert(moderationLog).values({ actorId: c.get("user").id, action: action === "release" ? "order_release" : "order_refund", targetType: "order", targetId: String(id), userId: order.sellerId, reason: note });
      return c.json({ ok: true, status: done.status });
    } catch (e: any) {
      log.error("market", "Admin-Entscheidung", { orderId: id, err: e });
      return c.json({ error: "Stripe-Vorgang fehlgeschlagen. Details im Stripe-Dashboard." }, 502);
    }
  });

  app.post("/api/admin/escrow/run", auth, adminOnly, async (c: any) => c.json(await runEscrowJobs()));

  // Phase 6: DAC7-Steuerdaten der Verkäufer und Admin-Export
  registerDac7(app, hlp);
}
