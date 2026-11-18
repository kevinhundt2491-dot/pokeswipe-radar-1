// Marktplatz: Suche & Filter-Chips (Alle · Tausch · Verkauf · Near Mint · Preis aufsteigend) – reine Logik ohne DOM.
// Getestet in tests/session-profile.test.ts (Abschnitt Marktplatz). Genutzt von client/main.js (Raster) und client/home.js (Vorschau).

export const MARKET_CHIPS = [
  ["all", "Alle"],
  ["trade", "🤝 Tausch"],
  ["sale", "💶 Verkauf"],
  ["nm", "✨ Near Mint"],
  ["price_asc", "↑ Preis aufsteigend"],
];
export const MARKET_CHIP_KEYS = MARKET_CHIPS.map(([k]) => k);

const TRADE_RE = /tausch|trade|swap|suche|biete/i;
const SALE_ONLY_RE = /^\s*(nur\s+)?(verkauf|sale|festpreis|vb|gebot)\b/i;

/** Wird die Karte (auch) zum Tausch angeboten? */
export const isTrade = (l) => TRADE_RE.test(String(l?.want || "")) && !SALE_ONLY_RE.test(String(l?.want || ""));
/** Wird die Karte verkauft (Sofort-Kauf oder Preis genannt, nicht reiner Tausch)? */
export const isSale = (l) => Boolean(l?.buy_now) || (Number(l?.price) > 0 && !/^\s*(nur\s+)?tausch\b/i.test(String(l?.want || "")));
/** Near Mint (oder besser) */
export const isNearMint = (l) => ["nm", "mint"].includes(String(l?.condition || "").toLowerCase()) || /\bnear\s*mint\b|\bNM\b/.test(String(l?.want || ""));

/** Set-Kürzel aus der Karten-ID (z. B. „sv03.5-199“ → „SV03.5 · 199“), sonst "". */
export function setCodeOf(l) {
  const id = String(l?.card_id || "");
  const m = /^([a-z0-9.]{2,12})-([a-z0-9]{1,8})$/i.exec(id);
  return m ? `${m[1].toUpperCase()} · ${m[2].toUpperCase()}` : "";
}

const CONDITION_SHORT = { mint: "MT", nm: "NM", ex: "EX", gd: "GD", lp: "LP", pl: "PL", po: "PO", graded: "SLAB", sealed: "OVP" };
/** Kurzes Zustands-Badge („NM“) */
export const conditionShort = (c) => CONDITION_SHORT[String(c || "").toLowerCase()] || (c ? String(c).slice(0, 5).toUpperCase() : "");

/**
 * Inserate filtern & sortieren.
 * @param {any[]} list  Inserate von /api/listings
 * @param {{ q?: string, chip?: string, buyFirst?: boolean }} opts
 *   buyFirst: Sofort-Kauf-Angebote zuerst (Standard im Marktplatz), sonst Originalreihenfolge (Boost/Pro/Neu vom Server)
 */
export function filterListings(list, { q = "", chip = "all", buyFirst = true } = {}) {
  const items = Array.isArray(list) ? list.slice() : [];
  const f = String(q || "").toLowerCase().trim();
  let out = f
    ? items.filter((m) => [m.card_name, m.city, m.want, setCodeOf(m), m.seller].some((v) => String(v || "").toLowerCase().includes(f)))
    : items;
  if (chip === "trade") out = out.filter(isTrade);
  else if (chip === "sale") out = out.filter(isSale);
  else if (chip === "nm") out = out.filter(isNearMint);
  if (chip === "price_asc") {
    out = out.map((m, i) => [m, i]).sort((a, b) => (Number(a[0].price) || 0) - (Number(b[0].price) || 0) || a[1] - b[1]).map(([m]) => m);
  } else if (buyFirst) {
    out = [...out.filter((m) => m.buy_now), ...out.filter((m) => !m.buy_now)];
  }
  return out;
}

/** Highlights für die Startseite: Top-Deals (unter Marktwert) und geboostete zuerst, dann die neuesten. */
export function marketHighlights(list, n = 4) {
  const items = Array.isArray(list) ? list.filter((l) => l && l.card_name) : [];
  const score = (l) => (l.boosted ? 4 : 0) + (l.priceCheck === "deal" ? 3 : 0) + (l.buy_now ? 1 : 0) + (l.image ? 1 : 0);
  return items.map((l, i) => [l, i]).sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1]).slice(0, n).map(([l]) => l);
}
