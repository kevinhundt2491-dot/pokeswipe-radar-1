// Marktplatz füllen: Nachfrage aus Wunschlisten sichtbar machen und daraus Inserate machen.
//  • GET /api/market/demand  – Karten aus der eigenen Sammlung, die andere suchen (mit Preisvorschlag)
//  • GET /api/market/wanted  – öffentlich: meistgesuchte Karten, die noch niemand anbietet (Leer-Zustand des Marktplatzes)
//  • notifyOwnersOfWish      – neue Wunschkarte → Besitzer erfahren, dass ihre Karte gesucht wird (max. 1× pro Tag)
//  • runDemandDigest         – wöchentliche Sammel-Benachrichtigung „X Karten aus deiner Sammlung werden gesucht“
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { rows } from "./util.ts";
import { notify } from "./prices.ts";
import { publicCache } from "./cache.ts";
import { rankDemand, demandDigestText, type DemandRow } from "./demand-logic.ts";

export const DEMAND_LINK = "/?tab=map&sell=wanted";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Sammlungs-Karten des Nutzers, die mindestens ein anderer (nicht gesperrter) Sammler auf der Wunschliste hat. */
export async function demandForUser(userId: string, limit = 30) {
  const list = rows(await db.execute(sql`
    SELECT i.id AS portfolio_item_id, i.card_id, i.name, COALESCE(NULLIF(i.image, ''), c.image) AS image, c.set_name,
      i.condition, i.variant, i.lang, i.print_id, i.quantity,
      count(DISTINCT w.user_id)::int AS wishers,
      (CASE WHEN bool_or(w.max_price IS NULL) THEN NULL ELSE max(w.max_price) END)::float AS max_price,
      (CASE WHEN i.variant = 'reverse_holo' THEN COALESCE(c.reverse_trend, c.reverse_avg, c.trend, c.avg) ELSE COALESCE(c.trend, c.avg) END)::float AS market,
      (SELECT min(l.price) FROM listings l WHERE l.card_id = i.card_id AND l.status = 'active' AND l.user_id <> ${userId})::float AS active_low,
      EXISTS (SELECT 1 FROM listings l WHERE l.user_id = ${userId} AND l.status = 'active'
        AND (l.portfolio_item_id = i.id OR (l.card_id = i.card_id AND l.variant = i.variant))) AS listed
    FROM portfolio_items i
    JOIN cards c ON c.id = i.card_id
    JOIN wishlist_items w ON w.card_id = i.card_id AND w.user_id <> ${userId} AND (w.variant = '' OR w.variant = i.variant)
    JOIN profiles wp ON wp.user_id = w.user_id AND NOT wp.banned
    WHERE i.user_id = ${userId} AND i.card_id IS NOT NULL
    GROUP BY i.id, c.id
    LIMIT 500
  `));
  const mapped: DemandRow[] = list.map((r: any) => ({
    portfolioItemId: Number(r.portfolio_item_id), cardId: r.card_id, name: r.name, image: r.image || "", setName: r.set_name || "",
    condition: r.condition || "", variant: r.variant || "normal", lang: r.lang || "de", printId: r.print_id || null,
    quantity: Number(r.quantity) || 1, wishers: Number(r.wishers) || 0, maxPrice: num(r.max_price), market: num(r.market),
    activeLow: num(r.active_low), listed: Boolean(r.listed),
  }));
  return { items: rankDemand(mapped, limit), alreadyListed: mapped.filter((r) => r.listed).length };
}

/** Meistgesuchte Karten ohne aktives Angebot – zeigt Verkäufern, womit sie den Marktplatz sofort füllen können. */
export async function topWanted(limit = 12) {
  return rows(await db.execute(sql`
    SELECT c.id AS card_id, c.name, c.image, c.set_name, count(DISTINCT w.user_id)::int AS wishers,
      COALESCE(c.trend, c.avg)::float AS market
    FROM wishlist_items w
    JOIN cards c ON c.id = w.card_id
    JOIN profiles p ON p.user_id = w.user_id AND NOT p.banned
    WHERE NOT EXISTS (SELECT 1 FROM listings l WHERE l.card_id = w.card_id AND l.status = 'active')
    GROUP BY c.id
    ORDER BY count(DISTINCT w.user_id) DESC, COALESCE(c.trend, c.avg) DESC NULLS LAST
    LIMIT ${limit}
  `)).map((r: any) => ({ cardId: r.card_id, name: r.name, image: r.image || "", setName: r.set_name || "", wishers: Number(r.wishers) || 0, market: num(r.market) }));
}

/**
 * Neue Wunschkarte: Sammler, die die Karte besitzen und noch nicht anbieten, bekommen einen Hinweis.
 * Höchstens eine solche Nachricht pro Besitzer und Tag (über das Benachrichtigungs-Protokoll), max. 50 Besitzer.
 */
export async function notifyOwnersOfWish(wisherId: string, cardId: string, cardName: string, variant = "") {
  const owners = rows(await db.execute(sql`
    SELECT DISTINCT i.user_id FROM portfolio_items i
    JOIN profiles p ON p.user_id = i.user_id AND NOT p.banned
    WHERE i.card_id = ${cardId} AND i.user_id <> ${wisherId} AND (${variant} = '' OR i.variant = ${variant})
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.user_id = i.user_id AND l.card_id = ${cardId} AND l.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = i.user_id AND n.link = ${DEMAND_LINK} AND n.created_at > now() - interval '24 hours')
    LIMIT 50
  `));
  for (const o of owners) {
    await notify(o.user_id, `🔥 Deine Karte ${cardName} wird gesucht`,
      "Ein Sammler hat sie gerade auf die Wunschliste gesetzt. Mit einem Tipp inserieren – der faire Preis ist schon eingetragen.", DEMAND_LINK);
  }
  return owners.length;
}

/**
 * Wöchentliche Sammel-Benachrichtigung (in Etappen, max. 40 Nutzer pro Lauf): an Sammler mit gesuchten,
 * noch nicht inserierten Karten, die in den letzten 7 Tagen keinen solchen Hinweis bekommen haben.
 */
export async function runDemandDigest({ deadline = Date.now() + 8000, batch = 40 } = {}) {
  const candidates = rows(await db.execute(sql`
    SELECT DISTINCT i.user_id FROM portfolio_items i
    JOIN profiles p ON p.user_id = i.user_id AND NOT p.banned
    JOIN wishlist_items w ON w.card_id = i.card_id AND w.user_id <> i.user_id AND (w.variant = '' OR w.variant = i.variant)
    WHERE i.card_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.user_id = i.user_id AND l.card_id = i.card_id AND l.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = i.user_id AND n.link = ${DEMAND_LINK} AND n.created_at > now() - interval '7 days')
    LIMIT ${batch}
  `));
  let sent = 0;
  for (const c of candidates) {
    if (Date.now() > deadline) break;
    const { items } = await demandForUser(c.user_id, 10);
    if (!items.length) continue;
    const t = demandDigestText(items.length, items);
    await notify(c.user_id, t.title, t.body, DEMAND_LINK);
    sent++;
  }
  return { demandDigest: sent };
}

export function registerDemand(app: any, { auth }: { auth: any }) {
  app.get("/api/market/demand", auth, async (c: any) => {
    c.header("Cache-Control", "no-store");
    return c.json(await demandForUser(c.get("user").id));
  });
  app.get("/api/market/wanted", async (c: any) => {
    publicCache(c, "data", { sMaxAge: 300, swr: 1800 });
    return c.json({ items: await topWanted(12) });
  });
}
