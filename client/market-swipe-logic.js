// Reine Logik (ohne DOM) für den Live-Swipe im Reiter „Marktplatz“ (client/market-swipe.js):
//   • Verkäufer-Rang aus den Daten, die /api/listings ohnehin liefert (Pro-Verifizierung, Käuferschutz-Konto,
//     Händler-Shop, Gründer-Badge, Empfehlungs-Badge, Bewertungen, Boost)
//   • gewichtetes Mischen aller Händler- & Sammler-Ordner (höherer Rang = häufigere Einblendung)
//   • Händler-/Sammler-Ordner (ein Ordner je Verkäufer) inkl. Stadt-Filter
// Geprüft in tests/market-swipe.test.ts.

export const BROWSE_MODES = ["swipe", "folder", "search"];

export const RANKS = [
  { key: "diamond", min: 60, icon: "💎", label: "Diamant", weight: 6 },
  { key: "gold", min: 40, icon: "🥇", label: "Gold", weight: 4 },
  { key: "silver", min: 20, icon: "🥈", label: "Silber", weight: 2 },
  { key: "starter", min: 0, icon: "🌱", label: "Starter", weight: 1 },
];

/** Rang-Punkte eines Verkäufers (0–100) aus einem Inserat. */
export function sellerScore(l) {
  if (!l) return 0;
  let s = 0;
  if (l.verified) s += 25; // Pro-Pass / Pro Trader
  if (l.buy_now) s += 15; // verifiziertes Käuferschutz-Konto (Stripe)
  if (l.seller_shop) s += 15; // eigener Händler-Shop
  if (l.seller_founder) s += 10;
  if (l.seller_badge === "ref-vip") s += 10;
  else if (l.seller_badge === "ref-community") s += 5;
  const n = Number(l.rating_count) || 0, avg = Number(l.rating) || 0;
  if (n >= 3) s += avg >= 4.7 ? 25 : avg >= 4.2 ? 15 : avg >= 3.5 ? 5 : -10;
  else if (n > 0 && avg >= 4.5) s += 5;
  return Math.max(0, Math.min(100, s));
}

export function sellerRank(l) {
  const s = sellerScore(l);
  return RANKS.find((r) => s >= r.min) || RANKS[RANKS.length - 1];
}

/** Händler (eigener Shop oder Pro-Verkäufer mit Käuferschutz) oder Sammler? */
export const sellerKind = (l) => (l?.seller_shop || (l?.verified && l?.buy_now) ? "dealer" : "collector");
export const KIND_LABEL = { dealer: "🏪 Händler", collector: "🃏 Sammler" };

/** Einblend-Gewicht eines Inserats: Verkäufer-Rang, Boost zählt zusätzlich. */
export const swipeWeight = (l) => sellerRank(l).weight * (l?.boosted ? 1.5 : 1);

/**
 * Gewichtetes Mischen ohne Zurücklegen (Efraimidis–Spirakis): Inserate höherer Ränge landen häufiger weit vorne,
 * jedes Inserat kommt aber genau einmal pro Durchgang vor.
 * @param {any[]} list
 * @param {() => number} rnd  Zufallsquelle (Tests: deterministisch)
 */
export function weightedShuffle(list, rnd = Math.random) {
  return (Array.isArray(list) ? list : [])
    .map((l) => [l, Math.pow(Math.max(1e-9, Number(rnd()) || 1e-9), 1 / Math.max(0.01, swipeWeight(l)))])
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

/** Neuer Stapel – vermeidet, dass dieselbe Karte direkt zweimal hintereinander kommt. */
export function nextDeck(list, lastId, rnd = Math.random) {
  const d = weightedShuffle(list, rnd);
  if (d.length > 1 && lastId != null && Number(d[0].id) === Number(lastId)) d.push(d.shift());
  return d;
}

export const normCity = (c) => String(c || "").trim().replace(/\s+/g, " ").toLowerCase();

/** Städte der aktuellen Angebote (häufigste zuerst) für den Stadt-Filter. */
export function cityOptions(listings) {
  const m = new Map();
  for (const l of Array.isArray(listings) ? listings : []) {
    const k = normCity(l?.city);
    if (!k || k === "–" || k === "-") continue;
    const e = m.get(k) || { id: k, label: String(l.city).trim().slice(0, 40), n: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "de"));
}

/**
 * Ein Ordner je Verkäufer, Händler & höhere Ränge zuerst.
 * @param {any[]} listings  bereits gefilterte Angebote
 * @param {string} city     normalisierte Stadt ("" = alle)
 */
export function sellerFolders(listings, city = "") {
  const by = new Map();
  for (const l of Array.isArray(listings) ? listings : []) {
    if (!l || l.user_id == null) continue;
    if (city && normCity(l.city) !== city) continue;
    const k = String(l.user_id);
    let f = by.get(k);
    if (!f) { f = { userId: l.user_id, seller: l.seller || "Sammler", kind: "collector", rank: RANKS[RANKS.length - 1], city: "", listings: [] }; by.set(k, f); }
    f.listings.push(l);
    const r = sellerRank(l);
    if (r.weight > f.rank.weight) f.rank = r;
    if (sellerKind(l) === "dealer") f.kind = "dealer";
  }
  const out = [...by.values()];
  for (const f of out) f.city = cityOptions(f.listings)[0]?.label || "";
  return out.sort((a, b) => (b.kind === "dealer") - (a.kind === "dealer") || b.rank.weight - a.rank.weight || b.listings.length - a.listings.length || String(a.seller).localeCompare(String(b.seller), "de"));
}
