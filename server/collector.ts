// Sammler-Werkzeuge: genaue Stückzahlen im Master-Set-Tracker und Duplikat-Radar
// (Überschuss erkennen, Cardmarket-Daten für Verkaufs-Assistent und CSV-Bestands-Import).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, cards, portfolioItems } from "../db/index.ts";
import { PLANS, type PlanId } from "./plans.ts";
import { CARD_ID_RE, cardPrice, getCard } from "./prices.ts";
import { fetchSet, pool } from "./features.ts";
import { int, rateLimit } from "./util.ts";

type CardMeta = { enName: string; idProduct: number | null; rarity: string };
const metaCache = new Map<string, { data: CardMeta; expires: number }>();

/** Englischer Name + Cardmarket-Produkt-ID einer Karte (TCGdex, 24 h im Speicher). */
async function cardMeta(cardId: string): Promise<CardMeta | null> {
  const hit = metaCache.get(cardId);
  if (hit && hit.expires > Date.now()) return hit.data;
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d: any = await res.json();
    const id = Number(d?.pricing?.cardmarket?.idProduct);
    const data = { enName: String(d?.name || ""), idProduct: Number.isInteger(id) && id > 0 ? id : null, rarity: String(d?.rarity || "") };
    if (metaCache.size > 3000) metaCache.clear();
    metaCache.set(cardId, { data, expires: Date.now() + 24 * 3600_000 });
    return data;
  } catch {
    return null;
  }
}

const setIdOf = (cardId: string) => cardId.split("-").slice(0, -1).join("-");
const localIdOf = (cardId: string) => cardId.split("-").pop() || "";

export function registerCollector(app: any, h: { auth: any; body: (c: any) => Promise<Record<string, any>> }) {
  const { auth, body } = h;

  /** Setzt die Gesamt-Stückzahl einer Karte im Portfolio (0 = entfernen). */
  app.put("/api/portfolio/by-card/:cardId", auth, async (c: any) => {
    const cardId = c.req.param("cardId");
    if (!CARD_ID_RE.test(cardId)) return c.json({ error: "Ungültige Karten-ID" }, 400);
    const user = c.get("user"), plan: PlanId = c.get("plan");
    if (!rateLimit(`qty:${user.id}`, 240, 60_000)) return c.json({ error: "Zu viele Änderungen – bitte kurz warten." }, 429);
    const target = int((await body(c)).quantity, 0, 999, 0);
    const items = await db.select({ id: portfolioItems.id, quantity: portfolioItems.quantity }).from(portfolioItems)
      .where(and(eq(portfolioItems.userId, user.id), eq(portfolioItems.cardId, cardId))).orderBy(asc(portfolioItems.id));
    const current = items.reduce((s, i) => s + i.quantity, 0);

    if (target > current) {
      if (items.length) {
        await db.update(portfolioItems).set({ quantity: Math.min(999, items[0].quantity + target - current) }).where(eq(portfolioItems.id, items[0].id));
      } else {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems).where(eq(portfolioItems.userId, user.id));
        if (Number(r?.n ?? 0) + 1 > PLANS[plan].portfolio) {
          return c.json({ error: `Limit erreicht (${PLANS[plan].portfolio} Karten im Tarif ${PLANS[plan].label}).`, upgrade: true }, 402);
        }
        const card = await getCard(cardId);
        if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
        await db.insert(portfolioItems).values({ userId: user.id, cardId: card.id, name: card.name, image: card.image, quantity: target });
      }
    } else if (target < current) {
      // Von den neuesten Einträgen abziehen, damit Einkaufspreise älterer Einträge erhalten bleiben
      let remove = current - target;
      for (const it of [...items].reverse()) {
        if (remove <= 0) break;
        if (it.quantity <= remove) { await db.delete(portfolioItems).where(eq(portfolioItems.id, it.id)); remove -= it.quantity; }
        else { await db.update(portfolioItems).set({ quantity: it.quantity - remove }).where(eq(portfolioItems.id, it.id)); remove = 0; }
      }
    }
    return c.json({ ok: true, cardId, quantity: target });
  });

  /** Duplikat-Radar: alle Karten mit Anzahl >= 2 inkl. Cardmarket-Daten (für Verkauf & CSV-Export). */
  app.get("/api/collector/duplicates", auth, async (c: any) => {
    const userId = c.get("user").id;
    const grouped = await db.select({
      cardId: portfolioItems.cardId,
      qty: sql<number>`sum(${portfolioItems.quantity})::int`,
      name: sql<string>`max(${portfolioItems.name})`,
      image: sql<string>`max(${portfolioItems.image})`,
    }).from(portfolioItems)
      .where(and(eq(portfolioItems.userId, userId), sql`${portfolioItems.cardId} IS NOT NULL`))
      .groupBy(portfolioItems.cardId)
      .having(sql`sum(${portfolioItems.quantity}) >= 2`)
      .orderBy(desc(sql`sum(${portfolioItems.quantity})`))
      .limit(200);
    const ids = grouped.map((g) => g.cardId!).filter(Boolean);
    const known = ids.length ? await db.select().from(cards).where(inArray(cards.id, ids)) : [];
    const cardMap = new Map(known.map((k) => [k.id, k]));
    const metas = new Map<string, CardMeta>();
    const sets = new Map<string, { enName: string; abbr: string }>();
    const deadline = Date.now() + 10_000;
    await pool(ids, 6, async (id) => { const m = await cardMeta(id); if (m) metas.set(id, m); }, deadline);
    await pool([...new Set(ids.map(setIdOf))], 4, async (sid) => {
      const s = await fetchSet(sid, "en");
      sets.set(sid, { enName: String(s?.name || ""), abbr: String(s?.abbreviation?.official || "") });
    }, deadline);

    const list = grouped.map((g) => {
      const id = g.cardId!, k = cardMap.get(id), m = metas.get(id), s = sets.get(setIdOf(id));
      const unit = cardPrice(k);
      const qty = Number(g.qty);
      return {
        cardId: id, name: k?.name || g.name, image: k?.image || g.image || "", setName: k?.setName || "",
        localId: localIdOf(id), qty, surplus: qty - 1, unit, surplusValue: unit * (qty - 1),
        enName: m?.enName || "", idProduct: m?.idProduct ?? null, rarity: m?.rarity || "",
        enSetName: s?.enName || "", abbr: s?.abbr || "",
      };
    });
    return c.json({ duplicates: list, surplusValue: list.reduce((s, d) => s + d.surplusValue, 0) });
  });
}
