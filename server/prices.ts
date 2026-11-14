import { and, eq, isNull, lt, or, sql, lte, gte } from "drizzle-orm";
import { db, cards, priceHistory, priceAlerts, notifications, sealedProducts, sealedAlerts } from "../db/index.ts";
import { sendPush } from "./push.ts";

const TCGDEX = "https://api.tcgdex.net/v2/de";
export const CARD_ID_RE = /^[a-zA-Z0-9.\-_]{2,40}$/;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v.toFixed(2) : null);
const today = () => new Date().toISOString().slice(0, 10);

export async function notify(userId: string, title: string, body = "", link = "") {
  const row = { userId, title: title.slice(0, 120), body: body.slice(0, 400), link: link.slice(0, 300) };
  await db.insert(notifications).values(row);
  // Echte Web-Push-Nachricht – kommt auch an, wenn die App geschlossen ist
  try {
    await sendPush(userId, { title: row.title, body: row.body, url: row.link || "/" });
  } catch (e) {
    console.warn("Push nicht gesendet", e);
  }
}

/** Holt eine Karte inkl. Cardmarket-Preis von TCGdex und speichert sie. */
export async function refreshCard(cardId: string) {
  if (!CARD_ID_RE.test(cardId)) throw new Error("Ungültige Karten-ID");
  const res = await fetch(`${TCGDEX}/cards/${encodeURIComponent(cardId)}`, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  const data: any = await res.json();
  const cm = data?.pricing?.cardmarket || {};
  const row = {
    id: String(data.id),
    name: String(data.name || cardId).slice(0, 120),
    setName: String(data.set?.name || "").slice(0, 120),
    image: data.image ? `${data.image}/high.webp` : "",
    trend: num(cm.trend) ?? num(cm["trend-holo"]),
    avg: num(cm.avg) ?? num(cm["avg-holo"]),
    low: num(cm.low) ?? num(cm["low-holo"]),
    avg7: num(cm.avg7) ?? num(cm["avg7-holo"]),
    avg30: num(cm.avg30) ?? num(cm["avg30-holo"]),
    priceUpdatedAt: cm.updated ? new Date(cm.updated) : null,
    checkedAt: new Date(),
  };
  const { id: _id, ...updates } = row;
  const [saved] = await db
    .insert(cards)
    .values(row)
    .onConflictDoUpdate({ target: cards.id, set: updates })
    .returning();

  if (row.trend || row.avg || row.low) {
    await db
      .insert(priceHistory)
      .values({ cardId: row.id, day: today(), trend: row.trend, avg: row.avg, low: row.low })
      .onConflictDoUpdate({
        target: [priceHistory.cardId, priceHistory.day],
        set: { trend: row.trend, avg: row.avg, low: row.low },
      });
  }
  return saved;
}

/** Liefert eine Karte aus der DB; lädt sie nach, wenn sie fehlt oder älter als maxAgeMs ist. */
export async function getCard(cardId: string, maxAgeMs = 6 * 3600_000) {
  const [existing] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (existing && existing.checkedAt && Date.now() - existing.checkedAt.getTime() < maxAgeMs) return existing;
  try {
    return (await refreshCard(cardId)) ?? existing ?? null;
  } catch {
    return existing ?? null;
  }
}

export const cardPrice = (c: { trend: string | null; avg: string | null; low: string | null } | null | undefined) =>
  c ? Number(c.trend ?? c.avg ?? c.low ?? 0) : 0;

/** Prüft alle aktiven Alarme einer Karte und benachrichtigt bei Treffer (max. 1x pro 24 h). */
export async function evaluateAlerts(cardId: string) {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  const price = cardPrice(card);
  if (!card || !price) return 0;
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const hits = await db
    .select()
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.cardId, cardId),
      eq(priceAlerts.active, true),
      or(isNull(priceAlerts.lastTriggeredAt), lt(priceAlerts.lastTriggeredAt, dayAgo)),
      or(
        and(eq(priceAlerts.direction, "below"), gte(priceAlerts.targetPrice, String(price))),
        and(eq(priceAlerts.direction, "above"), lte(priceAlerts.targetPrice, String(price))),
      ),
    ));
  for (const a of hits) {
    const dir = a.direction === "below" ? "unter" : "über";
    await notify(
      a.userId,
      `🎯 Preisalarm: ${card.name}`,
      `Cardmarket-Trend liegt bei ${price.toFixed(2).replace(".", ",")} € – ${dir} deinem Ziel von ${Number(a.targetPrice).toFixed(2).replace(".", ",")} €.`,
      `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}&utm_source=pokeswipe_radar&utm_medium=push`,
    );
    await db.update(priceAlerts).set({ lastTriggeredAt: new Date() }).where(eq(priceAlerts.id, a.id));
  }
  return hits.length;
}

/** Stündlicher Tracker-Lauf: veraltete beobachtete Karten aktualisieren, Alarme prüfen, Portfolio-Snapshots schreiben. */
export async function runTracker({ maxCards = 150 } = {}) {
  const staleBefore = new Date(Date.now() - 55 * 60_000);
  const watched = await db.execute(sql`
    SELECT DISTINCT c.id FROM cards c
    WHERE (c.checked_at IS NULL OR c.checked_at < ${staleBefore})
      AND (EXISTS (SELECT 1 FROM price_alerts a WHERE a.card_id = c.id AND a.active)
        OR EXISTS (SELECT 1 FROM portfolio_items p WHERE p.card_id = c.id)
        OR EXISTS (SELECT 1 FROM listings l WHERE l.card_id = c.id AND l.status = 'active'))
    ORDER BY c.id
    LIMIT ${maxCards}
  `);
  const ids: string[] = ((watched as any).rows ?? watched).map((r: any) => r.id);

  let refreshed = 0, alerts = 0;
  for (const id of ids) {
    try {
      await refreshCard(id);
      refreshed++;
      alerts += await evaluateAlerts(id);
    } catch (e) {
      console.warn("Tracker: Karte konnte nicht aktualisiert werden", id, e);
    }
  }

  // Tageswert aller Portfolios festhalten (für Wertverlauf)
  await db.execute(sql`
    INSERT INTO portfolio_snapshots (user_id, day, value)
    SELECT p.user_id, CURRENT_DATE,
      COALESCE(SUM(p.quantity * COALESCE(c.trend, c.avg, c.low, p.manual_value, 0)), 0)
    FROM portfolio_items p LEFT JOIN cards c ON c.id = p.card_id
    GROUP BY p.user_id
    ON CONFLICT (user_id, day) DO UPDATE SET value = EXCLUDED.value
  `);

  alerts += await snapshotSealed();
  return { refreshed, alerts };
}

/** Effektiver Sealed-Preis: Admin-Referenzpreis, sonst Durchschnitt der Community-Inserate. */
export async function sealedPrices() {
  const list = await db.execute(sql`
    SELECT s.id, s.ref_price::float AS ref_price,
      (SELECT avg(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_avg,
      (SELECT count(*)::int FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS listing_count
    FROM sealed_products s WHERE s.active
  `);
  return ((list as any).rows ?? list) as { id: number; ref_price: number | null; community_avg: number | null; listing_count: number }[];
}

export async function evaluateSealedAlerts(productId: number, price: number) {
  if (!price) return 0;
  const [product] = await db.select().from(sealedProducts).where(eq(sealedProducts.id, productId)).limit(1);
  if (!product) return 0;
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const hits = await db.select().from(sealedAlerts).where(and(
    eq(sealedAlerts.productId, productId), eq(sealedAlerts.active, true),
    or(isNull(sealedAlerts.lastTriggeredAt), lt(sealedAlerts.lastTriggeredAt, dayAgo)),
    or(
      and(eq(sealedAlerts.direction, "below"), gte(sealedAlerts.targetPrice, String(price))),
      and(eq(sealedAlerts.direction, "above"), lte(sealedAlerts.targetPrice, String(price))),
    ),
  ));
  for (const a of hits) {
    const dir = a.direction === "below" ? "unter" : "über";
    await notify(a.userId, `📦 Sealed-Alarm: ${product.name}`,
      `Aktueller Preis ${price.toFixed(2).replace(".", ",")} € – ${dir} deinem Ziel von ${Number(a.targetPrice).toFixed(2).replace(".", ",")} €.`,
      "/?tab=flip&sub=sealed");
    await db.update(sealedAlerts).set({ lastTriggeredAt: new Date() }).where(eq(sealedAlerts.id, a.id));
  }
  return hits.length;
}

/** Tageswerte der Sealed-Produkte festhalten und Alarme prüfen. */
export async function snapshotSealed() {
  let triggered = 0;
  for (const p of await sealedPrices()) {
    await db.execute(sql`
      INSERT INTO sealed_price_history (product_id, day, ref_price, community_avg, listing_count)
      VALUES (${p.id}, CURRENT_DATE, ${p.ref_price}, ${p.community_avg}, ${p.listing_count})
      ON CONFLICT (product_id, day) DO UPDATE SET ref_price = EXCLUDED.ref_price,
        community_avg = EXCLUDED.community_avg, listing_count = EXCLUDED.listing_count
    `);
    triggered += await evaluateSealedAlerts(p.id, Number(p.ref_price ?? p.community_avg ?? 0));
  }
  return triggered;
}

