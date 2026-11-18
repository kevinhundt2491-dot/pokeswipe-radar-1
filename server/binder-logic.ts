// Reine Logik (ohne Datenbank) für das visuelle Set-Portfolio („Sammlung → Mein Binder“):
//   • eigene Karten nach Pokémon-Sets in Set-Ordner gruppieren (Fortschritt „38 / 165 Karten“, Gesamtwert in €)
//   • Binder-Seiten im 3×3-Raster bauen – jede Karte mit Bild, Sammlernummer, Name und Cardmarket-Preis
//   • eigene Karten (Zustand, eigenes Inserat „Im Verkauf: XX,XX €“) und fehlende Karten (abgedunkelt)
//   • Live-Abgleich fehlender Karten mit aktiven Marktplatz-Angeboten anderer Nutzer („Auf Marktplatz: 12,50 €“ / „Tausch möglich“)
// Wird vom Server (server/binder.ts) und vom Browser (client/binder.js) genutzt; geprüft in tests/founder-binder.test.ts.

/** Karten pro Binder-Seite (3×3-Raster). */
export const BINDER_PAGE_SIZE = 9;

/** TCGdex-Karten-ID → Set-ID („sv03.5-199“ → „sv03.5“, „swsh12.5-GG01“ → „swsh12.5“). */
export function setIdOfCard(cardId: string | null | undefined): string {
  const id = String(cardId ?? "").trim();
  const i = id.lastIndexOf("-");
  return i > 0 ? id.slice(0, i) : "";
}

/** TCGdex-Karten-ID → Nummer innerhalb des Sets („sv03.5-199“ → „199“). */
export function localIdOfCard(cardId: string | null | undefined): string {
  const id = String(cardId ?? "").trim();
  const i = id.lastIndexOf("-");
  return i > 0 ? id.slice(i + 1) : "";
}

/** Sortierung wie im echten Ordner: erst numerisch (1, 2, … 165, 166 …), dann Sonderreihen (GG01, TG01 …) alphabetisch. */
export function compareLocalId(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : NaN, nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  const pa = a.match(/^(\D*)(\d*)$/), pb = b.match(/^(\D*)(\d*)$/);
  if (pa && pb && pa[1] === pb[1] && pa[2] && pb[2]) return Number(pa[2]) - Number(pb[2]);
  return a.localeCompare(b, "de");
}

/** Sammlernummer zur Anzeige: „038/165“-Stil (bei Sonderreihen nur die Nummer). */
export function collectorNumber(localId: string, official: number): string {
  const id = String(localId ?? "").trim();
  if (!id) return "";
  if (/^\d+$/.test(id) && official > 0) return `${id.padStart(Math.max(3, String(official).length), "0")}/${String(official).padStart(3, "0")}`;
  return id;
}

const euroFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const euroLabel = (n: number) => euroFmt.format(Number(n) || 0);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---------------------------------------------------------------------------
// Set-Ordner
// ---------------------------------------------------------------------------
export type BinderItem = { cardId: string | null; quantity?: number; value?: number; image?: string; setName?: string; name?: string };
export type SetMeta = { id: string; name: string; logo?: string; symbol?: string; total?: number; official?: number; releaseDate?: string | null; serieName?: string };
export type SetFolder = {
  setId: string; name: string; logo: string; symbol: string; preview: string; serieName: string; releaseDate: string | null;
  owned: number; total: number; pct: number; value: number; quantity: number; progressLabel: string;
};

/**
 * Eigene Binder-Einträge nach Sets gruppieren. `owned` zählt unterschiedliche Karten (Duplikate zählen 1×),
 * `value` summiert den aktuellen Wert aller eigenen Exemplare des Sets.
 */
export function groupBinderBySet(items: BinderItem[], sets: Map<string, SetMeta> | Record<string, SetMeta>): SetFolder[] {
  const meta = sets instanceof Map ? sets : new Map(Object.entries(sets || {}));
  const bySet = new Map<string, { ids: Set<string>; value: number; qty: number; preview: string; fallbackName: string }>();
  for (const it of items || []) {
    const setId = setIdOfCard(it?.cardId);
    if (!setId) continue;
    const g = bySet.get(setId) ?? { ids: new Set<string>(), value: 0, qty: 0, preview: "", fallbackName: "" };
    g.ids.add(String(it.cardId));
    g.value += Number(it.value) || 0;
    g.qty += Math.max(1, Number(it.quantity) || 1);
    if (!g.preview && it.image) g.preview = String(it.image);
    if (!g.fallbackName && it.setName) g.fallbackName = String(it.setName);
    bySet.set(setId, g);
  }
  const folders: SetFolder[] = [];
  for (const [setId, g] of bySet) {
    const m = meta.get(setId);
    const owned = g.ids.size;
    const total = Math.max(owned, Number(m?.total) || 0);
    folders.push({
      setId, name: m?.name || g.fallbackName || setId, logo: m?.logo || "", symbol: m?.symbol || "", preview: g.preview,
      serieName: m?.serieName || "", releaseDate: m?.releaseDate ?? null,
      owned, total, pct: total ? Math.min(100, Math.round((owned / total) * 100)) : 0,
      value: Math.round(g.value * 100) / 100, quantity: g.qty,
      progressLabel: `${owned} / ${total || "?"} Karten`,
    });
  }
  // Neueste Sets zuerst, sonst nach Wert
  return folders.sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || b.value - a.value || a.name.localeCompare(b.name, "de"));
}

// ---------------------------------------------------------------------------
// Binder-Seiten mit eigenen & fehlenden Karten + Marktplatz-Abgleich
// ---------------------------------------------------------------------------
export type CatalogCard = { id: string; name: string; image?: string; localId?: string; price?: number | null };
export type OwnedEntry = { cardId: string; quantity?: number; condition?: string; portfolioItemId?: number; image?: string; name?: string; value?: number };
export type ListingRef = { id: number; cardId: string | null; price: number; userId: string; condition?: string; seller?: string; sellerSlug?: string; image?: string; want?: string; buyNow?: boolean };

export type MarketBadge = { listingId: number; price: number; trade: boolean; label: string; seller: string; sellerSlug: string; condition: string; offers: number };
export type BinderCard = {
  cardId: string; localId: string; number: string; name: string; image: string; price: number; priceLabel: string;
  owned: boolean; quantity: number; condition: string;
  /** Erster eigener Binder-Eintrag (für „Im Marktplatz anbieten“). */
  portfolioItemId: number | null;
  /** Wert der eigenen Exemplare (Zustand berücksichtigt, sonst Preis × Anzahl). */
  ownedValue: number;
  /** Eigenes aktives Inserat (Preis-Badge „Im Verkauf: …“ → direkt zum Inserat). */
  myListing: { id: number; price: number; label: string } | null;
  /** Fehlende Karte, die ein anderer Nutzer gerade anbietet. */
  market: MarketBadge | null;
};

/** Badge-Text für ein Marktplatz-Angebot einer fehlenden Karte. */
export function marketBadgeLabel(price: number, trade: boolean): string {
  return !trade && num(price) > 0 ? `Auf Marktplatz: ${euroLabel(price)}` : "Tausch möglich";
}

/**
 * Bestes Angebot je Karte: günstigster Verkaufspreis; reine Tausch-Angebote (Preis 0) nur, wenn es keinen Verkauf gibt.
 * Eigene Inserate des Betrachters werden ignoriert.
 */
export function bestOffersByCard(listings: ListingRef[], viewerId: string): Map<string, MarketBadge> {
  const out = new Map<string, MarketBadge>();
  const counts = new Map<string, number>();
  for (const l of listings || []) {
    if (!l?.cardId || l.userId === viewerId) continue;
    counts.set(l.cardId, (counts.get(l.cardId) || 0) + 1);
    const price = num(l.price), trade = price <= 0;
    const cur = out.get(l.cardId);
    const better = !cur || (cur.trade && !trade) || (!cur.trade && !trade && price < cur.price);
    if (better) {
      out.set(l.cardId, {
        listingId: Number(l.id), price, trade, label: marketBadgeLabel(price, trade),
        seller: String(l.seller || ""), sellerSlug: String(l.sellerSlug || ""), condition: String(l.condition || ""), offers: 0,
      });
    }
  }
  for (const [id, b] of out) b.offers = counts.get(id) || 1;
  return out;
}

/** Alle Karten eines Sets in Ordner-Reihenfolge, angereichert mit Besitz-, Inserats- und Marktplatz-Infos. */
export function buildBinderCards(input: {
  catalog: CatalogCard[]; owned: OwnedEntry[]; myListings: ListingRef[]; marketListings: ListingRef[]; viewerId: string; official?: number;
}): BinderCard[] {
  const ownedBy = new Map<string, { qty: number; condition: string; image: string; name: string; value: number; pid: number | null }>();
  for (const o of input.owned || []) {
    if (!o?.cardId) continue;
    const cur = ownedBy.get(o.cardId) ?? { qty: 0, condition: "", image: "", name: "", value: 0, pid: null };
    cur.qty += Math.max(1, Number(o.quantity) || 1);
    cur.value += Number(o.value) || 0;
    if (cur.pid === null && Number(o.portfolioItemId) > 0) cur.pid = Number(o.portfolioItemId);
    if (!cur.condition && o.condition) cur.condition = String(o.condition);
    if (!cur.image && o.image) cur.image = String(o.image);
    if (!cur.name && o.name) cur.name = String(o.name);
    ownedBy.set(o.cardId, cur);
  }
  const mine = new Map<string, { id: number; price: number }>();
  for (const l of input.myListings || []) {
    if (!l?.cardId || l.userId !== input.viewerId) continue;
    const cur = mine.get(l.cardId);
    if (!cur || num(l.price) < cur.price) mine.set(l.cardId, { id: Number(l.id), price: num(l.price) });
  }
  const offers = bestOffersByCard(input.marketListings || [], input.viewerId);
  const official = Number(input.official) || 0;

  // Katalog + eigene Karten, die (noch) nicht im Katalog stehen (z. B. neue Promos)
  const catalog = new Map<string, CatalogCard>();
  for (const c of input.catalog || []) if (c?.id) catalog.set(c.id, c);
  for (const [id, o] of ownedBy) if (!catalog.has(id)) catalog.set(id, { id, name: o.name || id, image: o.image, localId: localIdOfCard(id), price: null });

  return [...catalog.values()]
    .map((c) => ({ c, localId: String(c.localId || localIdOfCard(c.id)) }))
    .sort((a, b) => compareLocalId(a.localId, b.localId))
    .map(({ c, localId }) => {
      const o = ownedBy.get(c.id);
      const ml = mine.get(c.id);
      const price = num(c.price);
      return {
        cardId: c.id, localId, number: collectorNumber(localId, official), name: c.name || o?.name || c.id,
        image: c.image || o?.image || "", price, priceLabel: price ? euroLabel(price) : "–",
        owned: Boolean(o), quantity: o?.qty || 0, condition: o?.condition || "", portfolioItemId: o?.pid ?? null,
        ownedValue: o ? Math.round((o.value || price * o.qty) * 100) / 100 : 0,
        myListing: o && ml ? { id: ml.id, price: ml.price, label: ml.price ? `Im Verkauf: ${euroLabel(ml.price)}` : "Zum Tausch angeboten" } : null,
        market: o ? null : offers.get(c.id) ?? null,
      };
    });
}

/** Seiten à 9 Karten (3×3). Leere Sets ergeben eine leere Seite, damit der Ordner nie „kaputt“ aussieht. */
export function paginate<T>(list: T[], size = BINDER_PAGE_SIZE): T[][] {
  const s = Math.max(1, Math.floor(size) || BINDER_PAGE_SIZE);
  const pages: T[][] = [];
  for (let i = 0; i < (list || []).length; i += s) pages.push(list.slice(i, i + s));
  return pages.length ? pages : [[]];
}

/** Seitenwechsel begrenzen (kein Blättern über den Ordner-Rand hinaus). */
export const clampPage = (page: number, pages: number) => Math.max(0, Math.min(Math.max(0, pages - 1), Math.floor(Number(page) || 0)));

/**
 * Swipe-Geste auswerten: horizontaler Wisch über `threshold` px, der deutlich waagerechter als senkrecht ist.
 * +1 = nächste Seite (nach links gewischt), −1 = vorherige Seite, 0 = kein Seitenwechsel (z. B. Scrollen).
 */
export function swipeDirection(dx: number, dy: number, threshold = 40): -1 | 0 | 1 {
  const ax = Math.abs(Number(dx) || 0), ay = Math.abs(Number(dy) || 0);
  if (ax < threshold || ax < ay * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}

/** Zusammenfassung eines Set-Ordners aus den Binder-Karten (für die Kopfzeile der Binder-Ansicht). */
export function binderSummary(cardsList: BinderCard[], total?: number) {
  const owned = cardsList.filter((c) => c.owned).length;
  const all = Math.max(owned, Number(total) || cardsList.length);
  const onMarket = cardsList.filter((c) => !c.owned && c.market).length;
  const forSale = cardsList.filter((c) => c.myListing).length;
  const value = Math.round(cardsList.reduce((s, c) => s + (c.owned ? c.ownedValue : 0), 0) * 100) / 100;
  return { owned, total: all, value, missing: Math.max(0, all - owned), onMarket, forSale, pct: all ? Math.min(100, Math.round((owned / all) * 100)) : 0, progressLabel: `${owned} / ${all} Karten` };
}

/**
 * Showcase-Füllung NUR für die Reel-Aufnahme (Live-Stage): die ersten Ordnerseiten eines echten Set-Katalogs
 * werden als „gefüllter Live-Betrieb“ belegt – eigene Karten vollfarbig mit Zustand und Live-Wert, ein paar
 * Lücken bleiben abgedunkelt. Die Lücke `hero` (Standard: Mitte von Seite 2) bekommt später das Marktplatz-Badge.
 * Schreibt nichts, liefert nur Einträge im Format von OwnedEntry.
 */
export const SHOWCASE_GAPS = Object.freeze([2, 6, 10, 13, 16, 21, 24]);
export function showcaseBinderFill(catalog: CatalogCard[], { pages = 3, gaps = SHOWCASE_GAPS as readonly number[] } = {}): OwnedEntry[] {
  const sorted = [...(catalog || [])].filter((c) => c?.id)
    .map((c) => ({ c, localId: String(c.localId || localIdOfCard(c.id)) }))
    .sort((a, b) => compareLocalId(a.localId, b.localId))
    .map(({ c }) => c);
  const n = Math.min(sorted.length, Math.max(1, pages) * BINDER_PAGE_SIZE);
  const out: OwnedEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (gaps.includes(i)) continue;
    const c = sorted[i];
    out.push({ cardId: c.id, quantity: i % 7 === 4 ? 2 : 1, condition: i % 5 === 3 ? "EX" : "NM", image: c.image || "", name: c.name, value: num(c.price) * (i % 7 === 4 ? 2 : 1) });
  }
  return out;
}

/** Karte an Position `index` (Ordner-Reihenfolge) – z. B. die Lücke, auf der das Marktplatz-Badge aufleuchtet. */
export function binderCardAt(catalog: CatalogCard[], index: number): CatalogCard | null {
  const sorted = [...(catalog || [])].filter((c) => c?.id)
    .sort((a, b) => compareLocalId(String(a.localId || localIdOfCard(a.id)), String(b.localId || localIdOfCard(b.id))));
  return sorted[index] ?? null;
}
