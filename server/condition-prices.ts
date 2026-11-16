// Phase 8: Preise nach Zustand und Sold Comps aus dem eigenen Marktplatz (Datenbank-Teil, Logik in condition-logic.ts).
//
// • Wird eine Teilbestellung ausgezahlt (Status „released“), landen ihre Positionen als Verkauf in sold_comps
//   (source = "pokeswipe", mit Variante und Zustand). Damit fließen sie automatisch auch ins Flip-Radar ein.
// • Wird nach der Auszahlung erstattet (Widerruf) oder geht eine Rückbuchung verloren, wird der Verkauf wieder entfernt.
// • Ein Nachhol-Lauf im Treuhand-Job übernimmt ältere ausgezahlte Bestellungen, die noch fehlen.
import { sql } from "drizzle-orm";
import { db, soldComps } from "../db/index.ts";
import { getCard, CARD_ID_RE } from "./prices.ts";
import { variantPrice, normalizeVariant, VARIANT_LABELS, VARIANTS, availableVariants, type Variant } from "./variant-logic.ts";
import { compsFromOrder, conditionTable, observedDiscount, type SaleLine } from "./condition-logic.ts";
import { rows, str, rateLimit, clientIp } from "./util.ts";
import { publicCache } from "./cache.ts";
import { log } from "./log.ts";

const SITE = () => process.env.URL || "https://pokeswipe-radar.de";

/** Positionen einer Teilbestellung laden (Warenkorb: order_items; Einzelkauf: das Inserat selbst). */
async function saleLines(orderId: number): Promise<{ order: any; lines: SaleLine[] } | null> {
  const [o] = rows(await db.execute(sql`
    SELECT id, status, listing_id, checkout_id, price_cents, shipping_cents, title, released_at, created_at, frozen, refund_id
    FROM market_orders WHERE id = ${orderId}`));
  if (!o) return null;
  let lines: SaleLine[];
  if (o.checkout_id) {
    lines = rows(await db.execute(sql`
      SELECT oi.id, oi.card_id, oi.title, oi.variant, oi.condition, oi.lang, oi.quantity, oi.unit_cents, l.print_id, l.sealed_product_id
      FROM order_items oi LEFT JOIN listings l ON l.id = oi.listing_id WHERE oi.market_order_id = ${orderId}`)).map((r: any) => ({
      itemKey: String(r.id), cardId: r.card_id ? String(r.card_id) : null, printId: r.print_id ? String(r.print_id) : null,
      sealedProductId: r.sealed_product_id ? Number(r.sealed_product_id) : null, title: String(r.title), variant: String(r.variant || "normal"),
      condition: String(r.condition || ""), lang: String(r.lang || "de"), quantity: Number(r.quantity), unitCents: Number(r.unit_cents),
    }));
  } else {
    const [l] = o.listing_id ? rows(await db.execute(sql`
      SELECT card_id, print_id, sealed_product_id, card_name, variant, condition, lang FROM listings WHERE id = ${o.listing_id}`)) : [];
    if (!l) return { order: o, lines: [] };
    lines = [{
      itemKey: "listing", cardId: l.card_id ? String(l.card_id) : null, printId: l.print_id ? String(l.print_id) : null,
      sealedProductId: l.sealed_product_id ? Number(l.sealed_product_id) : null, title: String(o.title || l.card_name),
      variant: String(l.variant || "normal"), condition: String(l.condition || ""), lang: String(l.lang || "de"),
      quantity: 1, unitCents: Number(o.price_cents),
    }];
  }
  return { order: o, lines };
}

/** Ausgezahlte Teilbestellung als Verkauf erfassen (idempotent über external_id). */
export async function recordOrderSale(orderId: number) {
  try {
    const data = await saleLines(orderId);
    if (!data || data.order.status !== "released" || data.order.frozen || data.order.refund_id) return 0;
    const comps = compsFromOrder({
      id: Number(data.order.id), shippingCents: Number(data.order.shipping_cents) || 0,
      releasedAt: data.order.released_at, createdAt: data.order.created_at,
    }, data.lines, SITE());
    if (!comps.length) return 0;
    const inserted = await db.insert(soldComps).values(comps).onConflictDoNothing().returning({ id: soldComps.id });
    return inserted.length;
  } catch (e) {
    log.error("comps", "Verkauf nicht erfasst", { orderId, err: e });
    return 0;
  }
}

/** Verkauf wieder entfernen (Erstattung nach Auszahlung, verlorene Rückbuchung). */
export async function removeOrderSale(orderId: number) {
  try {
    await db.execute(sql`DELETE FROM sold_comps WHERE source = 'pokeswipe' AND market_order_id = ${orderId}`);
  } catch (e) {
    log.error("comps", "Verkauf nicht entfernt", { orderId, err: e });
  }
}

/** Nachhol-Lauf: ausgezahlte Bestellungen ohne erfassten Verkauf (max. limit je Lauf). */
export async function backfillMarketComps(limit = 100) {
  const due = rows(await db.execute(sql`
    SELECT o.id FROM market_orders o
    WHERE o.status = 'released' AND NOT o.frozen AND o.refund_id IS NULL AND o.released_at > now() - interval '365 days'
      AND NOT EXISTS (SELECT 1 FROM sold_comps s WHERE s.source = 'pokeswipe' AND s.market_order_id = o.id)
    ORDER BY o.released_at DESC LIMIT ${limit}`));
  let recorded = 0;
  for (const r of due) recorded += await recordOrderSale(Number(r.id));
  // Erstattete Bestellungen dürfen nicht mehr zählen (Sicherheitsnetz, falls ein Hook ausgefallen ist)
  await db.execute(sql`DELETE FROM sold_comps s USING market_orders o
    WHERE s.source = 'pokeswipe' AND s.market_order_id = o.id AND (o.status = 'refunded' OR o.refund_id IS NOT NULL OR o.dispute_status = 'lost')`);
  return { checked: due.length, recorded };
}

export type ConditionPrices = Awaited<ReturnType<typeof conditionPricesForCard>>;

/** Zustandspreise einer Karte für eine Variante (Standard: Normal bzw. erste vorhandene Variante). */
export async function conditionPricesForCard(cardId: string, variantInput?: unknown, cardRow?: any) {
  const card = cardRow ?? await getCard(cardId, 12 * 3600_000);
  if (!card) return null;
  const available = availableVariants(card.variants);
  const variant: Variant = variantInput ? normalizeVariant(variantInput) : (available.includes("normal") || !available.length ? "normal" : available[0]);
  const nm = variantPrice(card, variant);
  const sales = rows(await db.execute(sql`
    SELECT price::float AS price, sold_at, condition FROM sold_comps
    WHERE source = 'pokeswipe' AND target_kind = 'card' AND target_id = ${cardId} AND variant = ${variant} AND sold_at > now() - interval '90 days'
    ORDER BY sold_at DESC LIMIT 500`)).map((r: any) => ({ price: Number(r.price), soldAt: r.sold_at, condition: r.condition }));
  const asks = rows(await db.execute(sql`
    SELECT (l.price + l.shipping_cents / 100.0)::float AS price, l.condition FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.card_id = ${cardId} AND l.variant = ${variant} AND l.status = 'active' AND NOT p.banned AND l.quantity - l.reserved > 0
    LIMIT 500`)).map((r: any) => ({ price: Number(r.price), condition: r.condition }));
  const table = conditionTable(sales, asks, nm.price || null);
  return {
    cardId, variant, variantLabel: VARIANT_LABELS[variant], variants: available.length ? available : (["normal"] as Variant[]),
    nmReference: nm.price || null, nmReferenceExact: nm.exact,
    conditions: table, observedDiscount: observedDiscount(table),
    salesCount90: sales.length,
  };
}

/** Letzte Verkäufe auf PokeSwipe zu einer Karte (alle Varianten/Zustände). */
export async function recentMarketSales(cardId: string, limit = 10) {
  return rows(await db.execute(sql`
    SELECT price::float AS price, sold_at, condition, variant, lang FROM sold_comps
    WHERE source = 'pokeswipe' AND target_kind = 'card' AND target_id = ${cardId}
    ORDER BY sold_at DESC LIMIT ${limit}`)).map((r: any) => ({
    price: Number(r.price), soldAt: new Date(r.sold_at).toISOString(), condition: String(r.condition || ""),
    variant: normalizeVariant(r.variant), variantLabel: VARIANT_LABELS[normalizeVariant(r.variant)], lang: String(r.lang || "de"),
  }));
}

export function registerConditionPrices(app: any) {
  // Öffentlich (Kartenseite, In-App-Kartenansicht, Portfolio): Zustandspreise + letzte Verkäufe
  app.get("/api/cards/:id/conditions", async (c: any) => {
    const id = str(c.req.param("id"), 60);
    if (!CARD_ID_RE.test(id)) return c.json({ error: "Ungültige Karte." }, 400);
    if (!(await rateLimit(`cond:${clientIp(c)}`, 120, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const v = c.req.query("variant");
    if (v && !(VARIANTS as readonly string[]).includes(String(v))) return c.json({ error: "Unbekannte Variante." }, 400);
    const data = await conditionPricesForCard(id, v || undefined);
    if (!data) return c.json({ error: "Karte nicht gefunden." }, 404);
    publicCache(c, "data", { varyQuery: ["variant"], sMaxAge: 300, swr: 1800 });
    return c.json({ ...data, recentSales: await recentMarketSales(id, 10) });
  });
}
