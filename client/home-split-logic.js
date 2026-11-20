// Reine Logik (ohne DOM) für das 2-Spalten-Layout der Startseite (client/home-split.js) – geprüft in tests/home-split.test.ts.
import { isDealer, isSealedListing } from "../server/sealed-market-logic.ts";

export const MARKET_POCKETS = 4; // 2×2 Taschen je Ordnerseite im „🔄 Marktplatz-Binder swipen“
export const MINE_POCKETS = 6;   // 3×2 Taschen je Seite im „📖 Mein Set-Binder“

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Anbieter-Filter: all | private | dealer. */
export function bySeller(list, seller = "all") {
  if (seller === "private") return list.filter((l) => !isDealer(l));
  if (seller === "dealer") return list.filter((l) => isDealer(l));
  return list;
}

export function matchesQuery(l, q) {
  const n = norm(q).trim();
  if (!n) return true;
  return norm(`${l.card_name || l.name || ""} ${l.seller || ""} ${l.city || ""} ${l.set_name || l.setName || ""}`).includes(n);
}

/**
 * Verkaufs- und Tausch-Ordner anderer Sammler & Händler: je Anbieter ein Ordner (meiste Angebote zuerst,
 * Händler bei Gleichstand vorn), jeder Ordner in Seiten zu `size` Taschen. Eigene Inserate fehlen.
 * @returns {{ seller: {id, name, dealer, city, verified, founder, rating, ratingCount, total}, items: any[], folder: number, page: number, pages: number }[]}
 */
export function sellerFolderPages(listings, { seller = "all", q = "", viewerId = "", size = MARKET_POCKETS } = {}) {
  const list = bySeller((Array.isArray(listings) ? listings : []).filter((l) => l && l.user_id && l.user_id !== viewerId && matchesQuery(l, q)), seller);
  const groups = new Map();
  for (const l of list) {
    if (!groups.has(l.user_id)) groups.set(l.user_id, []);
    groups.get(l.user_id).push(l);
  }
  const folders = [...groups.values()].sort((a, b) => b.length - a.length || Number(isDealer(b[0])) - Number(isDealer(a[0])) || String(a[0].seller || "").localeCompare(String(b[0].seller || ""), "de"));
  const out = [];
  folders.forEach((items, folder) => {
    const f = items[0];
    const info = { id: f.user_id, name: f.seller || "Sammler", dealer: isDealer(f), city: f.city || "", verified: Boolean(f.verified), founder: Boolean(f.seller_founder), rating: f.rating ?? null, ratingCount: Number(f.rating_count) || 0, total: items.length };
    const pages = Math.max(1, Math.ceil(items.length / size));
    for (let p = 0; p < pages; p++) out.push({ seller: info, items: items.slice(p * size, (p + 1) * size), folder, page: p, pages });
  });
  return out;
}

/** Cardmarket-Vergleich: Abweichung des Preises vom CM-Trend in Prozent (positiv = günstiger). */
export function cmDiff(l) {
  const p = Number(l?.price), m = Number(l?.market_price);
  if (!(p > 0) || !(m > 0)) return null;
  return Math.round((1 - p / m) * 100);
}

/** Feed rechts: Community-Beiträge + Artikel-Inserate gemischt, neueste zuerst; Filter all | items | pulls | sealed. */
export function mixFeed(posts, listings, filter = "all") {
  const p = (Array.isArray(posts) ? posts : []).map((x) => ({ kind: "post", at: new Date(x.createdAt).getTime() || 0, post: x }));
  const items = (Array.isArray(listings) ? listings : []).filter((l) => String(l.listing_type) === "item" || isSealedListing(l))
    .map((l) => ({ kind: "listing", at: new Date(l.created_at).getTime() || 0, listing: l }));
  let out;
  if (filter === "pulls") out = p.filter((x) => x.post.category === "pull");
  else if (filter === "items") out = [...items, ...p.filter((x) => x.post.category === "trade" && !x.post.card)];
  else if (filter === "sealed") out = items.filter((x) => isSealedListing(x.listing));
  else out = [...p, ...items];
  return out.sort((a, b) => b.at - a.at);
}

/** Schnell-Upload: welche Kategorie wird wie veröffentlicht? (Pull → Pull-Wall; Artikel mit Preis → Marktplatz-Inserat) */
export const QUICK_KINDS = [
  { id: "pull", label: "📸 Frischer Pull" },
  { id: "sealed", label: "📦 Sealed / OVP" },
  { id: "item", label: "🛍️ Artikel & Zubehör" },
  { id: "lot", label: "🗃️ Karten-Konvolut" },
];
export function quickTarget(kind, price) {
  const p = Number(String(price ?? "").replace(",", "."));
  if (kind === "pull") return { to: "post", category: "pull" };
  if (String(price ?? "").trim() !== "" && p >= 0 && Number.isFinite(p)) {
    const map = { sealed: ["booster", "sealed"], item: ["sonstiges", "like_new"], lot: ["lots", "used"] };
    const [itemCategory, itemCondition] = map[kind] || map.item;
    return { to: "listing", itemCategory, itemCondition, sealed: kind === "sealed" };
  }
  return { to: "post", category: "trade" };
}
