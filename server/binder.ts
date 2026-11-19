// Visuelles Set-Portfolio („Sammlung → Mein Binder“): Set-Ordner mit Logo, Fortschritt und Wert sowie die
// durchblätterbare Binder-Ansicht je Set (3×3-Raster) inkl. Live-Abgleich fehlender Karten mit dem Marktplatz.
// Reine Logik (Gruppierung, Seiten, Badges): binder-logic.ts – wird identisch im Browser genutzt.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, cards, cardSets, portfolioItems, cardPrints } from "../db/index.ts";
import { verifyIdentityToken } from "./auth.ts";
import { cardPrice } from "./prices.ts";
import { fetchSet } from "./features.ts";
import { itemUnitValue, type VariantPrices } from "./variant-logic.ts";
import { profileSlug } from "./community-logic.ts";
import { rows, rateLimit, clientIp } from "./util.ts";
import { setIdOfCard, localIdOfCard, groupBinderBySet, type SetMeta, type CatalogCard, type ListingRef, type EbayRef } from "./binder-logic.ts";
import { EPN_CAMPAIGN_ID } from "./flip-logic.ts";

/** eBay-Partner-ID für die Binder-Etiketten (Env-Variable hat Vorrang, sonst die feste ePN-Campaign-ID). */
const ebayCampaign = () => String(process.env.EBAY_CAMPAIGN_ID || process.env.EPN_CAMPAIGN_ID || EPN_CAMPAIGN_ID).replace(/\D/g, "").slice(0, 20);

const SET_ID_RE = /^[a-zA-Z0-9.\-_]{1,40}$/;
const tcgdexImage = (u: unknown) => (u ? `${String(u).slice(0, 280)}/high.webp` : "");
const tcgdexLogo = (u: unknown) => (u ? `${String(u).slice(0, 280)}.webp` : "");
/** Logos aus TCGdex (ohne Endung gespeichert) als ladbare Bild-URL. */
const logoUrl = (u: string) => (!u ? "" : /\.(png|webp|jpg|svg)$/i.test(u) ? u : `${u}.webp`);

/** Set-Stammdaten (Name, Logo, Kartenzahl) aus dem Katalog, fehlende Sets live von TCGdex. */
async function setMetas(ids: string[]): Promise<Map<string, SetMeta>> {
  const out = new Map<string, SetMeta>();
  const clean = [...new Set(ids.filter((i) => SET_ID_RE.test(i)))].slice(0, 120);
  if (!clean.length) return out;
  const known = await db.select().from(cardSets).where(inArray(cardSets.id, clean));
  for (const s of known) {
    out.set(s.id, {
      id: s.id, name: s.name, logo: logoUrl(s.logo), symbol: logoUrl(s.symbol), serieName: s.serieName,
      total: s.cardCountTotal || s.cardCountOfficial, official: s.cardCountOfficial, releaseDate: s.releaseDate ? String(s.releaseDate) : null,
    });
  }
  const missing = clean.filter((id) => !out.has(id)).slice(0, 6);
  await Promise.all(missing.map(async (id) => {
    const d: any = await fetchSet(id, "de");
    if (!d?.name) return;
    out.set(id, {
      id, name: String(d.name), logo: tcgdexLogo(d.logo), symbol: tcgdexLogo(d.symbol), serieName: String(d.serie?.name || ""),
      total: Number(d.cardCount?.total) || Number(d.cardCount?.official) || 0, official: Number(d.cardCount?.official) || 0,
      releaseDate: d.releaseDate ? String(d.releaseDate) : null,
    });
  }));
  return out;
}

/** Alle Karten eines Sets (Katalog in der eigenen Datenbank, sonst TCGdex) mit aktuellem Cardmarket-Preis. */
async function setCatalog(setId: string): Promise<CatalogCard[]> {
  const list = await db.select({
    id: cards.id, name: cards.name, image: cards.image, localId: cards.localId, trend: cards.trend, avg: cards.avg, low: cards.low,
  }).from(cards).where(eq(cards.setId, setId)).limit(600);
  if (list.length) return list.map((c) => ({ id: c.id, name: c.name, image: c.image, localId: c.localId || localIdOfCard(c.id), price: cardPrice(c) || null }));
  const d: any = await fetchSet(setId, "de");
  const tc: any[] = Array.isArray(d?.cards) ? d.cards : [];
  const ids = tc.map((c) => String(c?.id || "")).filter(Boolean).slice(0, 600);
  const prices = ids.length ? await db.select({ id: cards.id, trend: cards.trend, avg: cards.avg, low: cards.low }).from(cards).where(inArray(cards.id, ids)) : [];
  const priceOf = new Map(prices.map((p) => [p.id, cardPrice(p)]));
  return tc.filter((c) => c?.id && c?.name).slice(0, 600).map((c) => ({
    id: String(c.id), name: String(c.name), image: tcgdexImage(c.image), localId: String(c.localId ?? localIdOfCard(String(c.id))), price: priceOf.get(String(c.id)) || null,
  }));
}

/** Aktive Karten-Inserate für die Karten eines Sets (eigene und fremde) – Grundlage des Live-Abgleichs. */
async function setListings(setId: string): Promise<ListingRef[]> {
  const like = `${setId.replace(/[%_\\]/g, (m) => `\\${m}`)}-%`;
  const list = rows(await db.execute(sql`
    SELECT l.id, l.card_id, l.price::float AS price, l.user_id, l.condition, l.image, l.want, (l.buy_now AND p.stripe_account_ready) AS buy_now, p.display_name
    FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.status = 'active' AND NOT p.banned AND l.card_id LIKE ${like} AND (l.quantity - l.reserved) > 0
    ORDER BY l.price ASC LIMIT 500
  `));
  return list.map((l: any) => ({
    id: Number(l.id), cardId: String(l.card_id), price: Number(l.price) || 0, userId: String(l.user_id), condition: String(l.condition || ""),
    seller: String(l.display_name || ""), sellerSlug: profileSlug(l.display_name), image: String(l.image || ""), want: String(l.want || ""), buyNow: Boolean(l.buy_now),
  }));
}

/**
 * Günstigstes aktives eBay-Sofort-Kaufen-Angebot (ungegradet, nicht beschädigt, nicht verdächtig) je Karte des Sets –
 * aus den gespeicherten Flip-Radar-Daten (market_offers). Ohne eBay-Anbindung einfach leer.
 */
async function setEbayOffers(setId: string): Promise<EbayRef[]> {
  const like = `${setId.replace(/[%_\\]/g, (m) => `\\${m}`)}-%`;
  try {
    const list = rows(await db.execute(sql`
      SELECT target_id, min(total)::float AS price FROM market_offers
      WHERE target_kind = 'card' AND target_id LIKE ${like} AND status = 'active' AND buying_option = 'FIXED_PRICE'
        AND grade_key = 'raw' AND raw_condition <> 'dmg' AND NOT suspicious
      GROUP BY target_id LIMIT 600
    `));
    return list.map((r: any) => ({ cardId: String(r.target_id), price: Number(r.price) || 0 })).filter((r) => r.price > 0);
  } catch { return []; }
}

/** Eigene Binder-Einträge (mit Wert wie in /api/portfolio) – nur Karten mit Katalog-ID. */
async function ownedItems(userId: string, setId?: string) {
  const items = await db.select({
    id: portfolioItems.id, cardId: portfolioItems.cardId, name: portfolioItems.name, image: portfolioItems.image, quantity: portfolioItems.quantity,
    condition: portfolioItems.condition, variant: portfolioItems.variant, manualValue: portfolioItems.manualValue,
    trend: cards.trend, avg: cards.avg, low: cards.low, reverseTrend: cards.reverseTrend, reverseAvg: cards.reverseAvg, reverseLow: cards.reverseLow,
    setName: cards.setName, printVariantPrices: cardPrints.variantPrices,
  }).from(portfolioItems).leftJoin(cards, eq(cards.id, portfolioItems.cardId)).leftJoin(cardPrints, eq(cardPrints.id, portfolioItems.printId))
    .where(and(eq(portfolioItems.userId, userId), setId ? sql`${portfolioItems.cardId} LIKE ${`${setId.replace(/[%_\\]/g, (m) => `\\${m}`)}-%`}` : sql`${portfolioItems.cardId} IS NOT NULL`))
    .limit(5000);
  return items.map(({ printVariantPrices, ...i }) => {
    const unit = itemUnitValue(i as any, i, printVariantPrices as VariantPrices).unit;
    return { portfolioItemId: i.id, cardId: i.cardId!, name: i.name, image: i.image, quantity: i.quantity, condition: i.condition, setName: i.setName || "", value: unit * i.quantity };
  });
}

export function registerBinder(app: any, h: { auth: any }) {
  /** Set-Ordner des eingeloggten Nutzers (Logo, Name, „38 / 165 Karten“, Wert in €). */
  app.get("/api/binder/folders", h.auth, async (c: any) => {
    const items = await ownedItems(c.get("user").id);
    const metas = await setMetas(items.map((i) => setIdOfCard(i.cardId)));
    c.header("Cache-Control", "no-store");
    return c.json({ folders: groupBinderBySet(items, metas) });
  });

  /** Öffentliche Set-Stammdaten für Gäste (lokaler Binder): ?ids=sv03.5,sv08 */
  app.get("/api/binder/sets", async (c: any) => {
    if (!(await rateLimit(`binders:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const ids = String(c.req.query("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const metas = await setMetas(ids);
    c.header("Cache-Control", "public, max-age=600");
    return c.json({ sets: Object.fromEntries(metas) });
  });

  /**
   * Binder-Ansicht eines Sets: alle Karten (Bild, Nummer, Name, Cardmarket-Preis), eigene Einträge & Inserate
   * und aktive Marktplatz-Angebote anderer Nutzer. Ohne Login (Gast-Binder) nur Katalog + Angebote.
   * ?market=1 liefert nur die Angebote (für die Live-Aktualisierung alle paar Sekunden).
   */
  app.get("/api/binder/set/:setId", async (c: any) => {
    const setId = String(c.req.param("setId") || "");
    if (!SET_ID_RE.test(setId)) return c.json({ error: "Ungültiges Set" }, 400);
    if (!(await rateLimit(`binder:${clientIp(c)}`, 120, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const user = await verifyIdentityToken(c).catch(() => null);
    const viewerId = user?.id || "";
    const listingsInSet = await setListings(setId);
    const marketListings = listingsInSet.filter((l) => l.userId !== viewerId);
    const myListings = listingsInSet.filter((l) => viewerId && l.userId === viewerId);
    c.header("Cache-Control", "no-store");
    if (c.req.query("market") === "1") return c.json({ setId, viewerId, marketListings, myListings, at: new Date().toISOString() });
    const [metas, catalog, owned, ebayOffers] = await Promise.all([
      setMetas([setId]), setCatalog(setId), viewerId ? ownedItems(viewerId, setId) : Promise.resolve([]), setEbayOffers(setId),
    ]);
    const meta = metas.get(setId) ?? { id: setId, name: setId, total: catalog.length, official: 0 };
    return c.json({
      set: { ...meta, total: Math.max(Number(meta.total) || 0, catalog.length) },
      catalog, owned, myListings, marketListings, ebayOffers, ebayCampaign: ebayCampaign(), viewerId, at: new Date().toISOString(),
    });
  });
}
