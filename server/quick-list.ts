// Schnell-Inserieren aus dem Scanner: faire Preisvorschläge für viele Karten in einem Aufruf.
//
// POST /api/listings/suggest  { items: [{ key: "card:sv03.5-199" | "print:ja:SV2a-201", condition, variant }] }  (max. 60)
//  → { items: [{ key, fair, quick, low, high, basis, confidence, sampleSize, sources, activeLow, activeCount }] }
//
// Quellen: eigene Preis-Pipeline (getValuation – Cardmarket-Referenz, eBay- und PokeSwipe-Verkäufe je Zustand),
// für japanische Drucke ohne deutsche Partnerkarte der Cardmarket-Preis des Drucks; dazu das günstigste aktive
// Inserat anderer Verkäufer, damit „schnell verkaufen“ wirklich unter der Konkurrenz liegt.
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { rows, str, rateLimit } from "./util.ts";
import { log } from "./log.ts";
import { CARD_ID_RE } from "./prices.ts";
import { PRINT_ID_RE } from "./intl-logic.ts";
import { getValuation } from "./valuation.ts";
import { normalizeVariant, VARIANTS } from "./variant-logic.ts";
import { suggestPrice, tierFor, conditionFactor } from "./quick-list-logic.ts";

const MAX_ITEMS = 60;

async function pool<T, R>(list: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

export function registerQuickList(app: any, { auth, body }: { auth: any; body: (c: any) => Promise<any> }) {
  app.post("/api/listings/suggest", auth, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`qlsuggest:${user.id}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen – bitte kurz warten." }, 429);
    const b = await body(c);
    const input: any[] = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : [];
    if (!input.length) return c.json({ items: [] });

    const valuations = new Map<string, Promise<any>>();
    const valuationOf = (cardId: string, variant: string) => {
      const k = `${cardId}|${variant}`;
      if (!valuations.has(k)) valuations.set(k, getValuation(cardId, variant).catch((e) => { log.error("quicklist", "Bewertung fehlgeschlagen", { cardId, err: e }); return null; }));
      return valuations.get(k)!;
    };

    const items = await pool(input, 6, async (it) => {
      const key = str(it?.key, 80);
      const condition = str(it?.condition, 10).toLowerCase();
      const variant = (VARIANTS as readonly string[]).includes(String(it?.variant)) ? normalizeVariant(it.variant) : "normal";
      let cardId: string | null = null, printId: string | null = null, lang = "de", reference: number | null = null;
      if (key.startsWith("card:") && CARD_ID_RE.test(key.slice(5))) cardId = key.slice(5);
      else if (key.startsWith("print:") && PRINT_ID_RE.test(key.slice(6))) {
        printId = key.slice(6);
        const [p] = rows(await db.execute(sql`SELECT lang, base_card_id, price_eur::float AS price FROM card_prints WHERE id = ${printId} LIMIT 1`));
        if (!p) return { key, fair: null, quick: null, low: null, high: null, basis: "none" };
        lang = String(p.lang);
        // Englische Drucke teilen sich das Cardmarket-Produkt mit der deutschen Karte
        if (p.base_card_id && CARD_ID_RE.test(String(p.base_card_id))) cardId = String(p.base_card_id);
        reference = p.price ? Number(p.price) : null;
      } else return { key, fair: null, quick: null, low: null, high: null, basis: "none" };

      let tier: any = null, confidence = 0, sampleSize = 0, sources: any = {};
      if (cardId) {
        const v = await valuationOf(cardId, variant);
        const wanted = tierFor(condition);
        tier = v?.raw?.find((t: any) => t.tier === wanted) || null;
        const nm = v?.raw?.find((t: any) => t.tier === "nm");
        if (!reference && nm?.value) reference = Number(nm.value);
        if (tier) { confidence = tier.confidence; sampleSize = tier.sampleSize; sources = tier.sources; }
      }
      // Fremde aktive Inserate derselben Karte/Sprache/Variante (Konkurrenz)
      const [comp] = rows(await db.execute(sql`
        SELECT min(price)::float AS low, count(*)::int AS n FROM listings
        WHERE status = 'active' AND user_id <> ${user.id} AND variant = ${variant} AND lang = ${lang}
          AND ${printId && (lang === "ja" || !cardId) ? sql`print_id = ${printId}` : sql`card_id = ${cardId}`}`));
      const activeLow = comp?.low ? Number(comp.low) : null;
      const s = suggestPrice({
        tierValue: tier?.value ?? null, tierLow: tier?.low ?? null, tierHigh: tier?.high ?? null,
        reference, condition, activeLow,
      });
      return {
        key, ...s, confidence, sampleSize, sources, activeLow, activeCount: Number(comp?.n) || 0,
        factor: conditionFactor(condition),
      };
    });
    c.header("Cache-Control", "no-store");
    return c.json({ items });
  });
}
