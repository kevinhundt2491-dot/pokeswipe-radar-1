// Reel-Aufnahme (Live-Stage, ?reel=1): Demo-Pokémon-Artikel für die Kurz-Reels (16er Marktplatz-Binder, Hochschieben,
// Pokémon-Artikel-Verkaufsseite). Im Katalog gibt es keine Produktfotos – deshalb neutrale Produkt-Abbildungen
// (SVG, ohne Fremd-Artwork) im Farbschema der App. Echte Artikel-Inserate mit Fotos haben in der Aufnahme Vorrang.
// Reines Daten-Modul ohne DOM-Zugriff (testbar); wird nur in der Stage verwendet, nichts wird gespeichert.

/** Demo-Artikel (Titel, Unterkategorie, Zustand, Preis, Referenzpreis für das Deal-Etikett, Ort, Abbildung). */
export const DEMO_ITEMS = Object.freeze([
  { title: "Stürmische Funken Display OVP", category: "booster", condition: "sealed", price: 239, market: 275.19, city: "Köln", art: "display", color: "#f59e0b", sub: "36 Booster" },
  { title: "151 Top-Trainer-Box", category: "etb", condition: "sealed", price: 379, market: 424.95, city: "Hamburg", art: "box", color: "#ef4444", sub: "Top-Trainer-Box" },
  { title: "9er Sammelordner (360 Karten)", category: "zubehoer", condition: "like_new", price: 24.9, market: 0, city: "München", art: "binder", color: "#3b82f6", sub: "9-Pocket · 20 Seiten" },
  { title: "Prismatische Entwicklungen Booster-Bundle", category: "booster", condition: "sealed", price: 84.9, market: 95.94, city: "Berlin", art: "bundle", color: "#a855f7", sub: "6 Booster" },
  { title: "Sleeves & Toploader Set (100 + 25)", category: "zubehoer", condition: "sealed", price: 9.5, market: 0, city: "Leipzig", art: "sleeves", color: "#22d3ee", sub: "Schutzhüllen" },
  { title: "Sammlung 500 Karten (Lot)", category: "lots", condition: "used", price: 45, market: 0, city: "Dortmund", art: "lot", color: "#22c55e", sub: "Bulk + Holos" },
]);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Kleiner Pokéball als Motiv (eigene Grafik, kein Fremd-Artwork). */
const ball = (cx, cy, r) => `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f8fafc"/><path d="M${cx - r} ${cy}a${r} ${r} 0 0 1 ${2 * r} 0z" fill="#ef4444"/>
  <rect x="${cx - r}" y="${cy - r * 0.09}" width="${2 * r}" height="${r * 0.18}" fill="#0f172a"/><circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="#0f172a"/><circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#f8fafc"/></g>`;

function artSvg(a) {
  const c = a.color;
  switch (a.art) {
    case "display": // Display-Karton mit 6 sichtbaren Booster-Packs
      return `<path d="M90 190 L300 130 L510 190 L300 250Z" fill="${c}" opacity=".85"/><path d="M90 190 L300 250 L300 520 L90 450Z" fill="${c}"/><path d="M300 250 L510 190 L510 450 L300 520Z" fill="${c}" opacity=".7"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${118 + i * 30}" y="${150 + (i % 2) * 6}" width="26" height="66" rx="4" transform="rotate(${-16} ${130 + i * 30} 180)" fill="${["#f97316", "#38bdf8", "#facc15", "#a78bfa", "#f472b6", "#34d399"][i]}"/>`).join("")}
        ${ball(195, 350, 52)}<text x="405" y="372" font-family="Figtree,system-ui,sans-serif" font-size="34" font-weight="900" fill="#0f172a" text-anchor="middle">DISPLAY</text>`;
    case "box":
    case "bundle": // Top-Trainer-Box / Booster-Bundle mit Deckel
      return `<path d="M110 210 L300 160 L490 210 L300 260Z" fill="#f8fafc" opacity=".9"/><path d="M110 210 L300 260 L300 500 L110 440Z" fill="${c}"/><path d="M300 260 L490 210 L490 440 L300 500Z" fill="${c}" opacity=".72"/>
        <path d="M110 210 L300 260 L300 300 L110 250Z" fill="#0f172a" opacity=".28"/>${ball(205, 370, 58)}
        <text x="395" y="372" font-family="Figtree,system-ui,sans-serif" font-size="26" font-weight="900" fill="#f8fafc" text-anchor="middle">${a.art === "box" ? "TOP-TRAINER" : "BUNDLE"}</text>`;
    case "binder": // Sammelordner mit 3×3-Taschen
      return `<rect x="150" y="120" width="320" height="400" rx="26" fill="${c}"/><rect x="150" y="120" width="44" height="400" rx="14" fill="#1e3a8a"/>
        ${[0, 1, 2].map((r) => [0, 1, 2].map((k) => `<rect x="${222 + k * 78}" y="${160 + r * 110}" width="64" height="92" rx="8" fill="#e2e8f0" opacity=".85"/>`).join("")).join("")}
        <rect x="380" y="300" width="70" height="40" rx="12" fill="#0f172a" opacity=".55"/>`;
    case "sleeves":
      return `${[0, 1, 2].map((i) => `<rect x="${170 + i * 36}" y="${150 + i * 26}" width="230" height="320" rx="18" fill="${c}" opacity="${0.45 + i * 0.25}" stroke="#f8fafc" stroke-opacity=".5" stroke-width="4"/>`).join("")}
        <rect x="265" y="250" width="150" height="210" rx="10" fill="#f8fafc" opacity=".35"/>${ball(340, 355, 44)}`;
    default: // Lot: Kartenstapel
      return `${[0, 1, 2, 3, 4].map((i) => `<rect x="${150 + i * 34}" y="${140 + (i % 2) * 22}" width="200" height="280" rx="16" fill="${["#1e293b", "#334155", c, "#0ea5e9", "#facc15"][i]}" stroke="#f8fafc" stroke-opacity=".5" stroke-width="4" transform="rotate(${-14 + i * 7} ${250 + i * 34} 300)"/>`).join("")}${ball(360, 300, 50)}`;
  }
}

/** Neutrale Produkt-Abbildung (600×600, „Foto“ auf dunklem Tisch) als data:-URL. */
export function demoItemImage(a) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#334155"/><stop offset=".6" stop-color="#111827"/><stop offset="1" stop-color="#05070f"/></radialGradient>
  <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#0b0f1a"/></linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/><rect y="470" width="600" height="130" fill="url(#t)"/><ellipse cx="300" cy="520" rx="230" ry="26" fill="#000" opacity=".45"/>
  ${artSvg(a)}
  <rect x="24" y="24" width="${Math.min(552, 40 + String(a.sub || "").length * 17)}" height="46" rx="23" fill="#0f172a" opacity=".82"/><text x="46" y="55" font-family="Figtree,system-ui,sans-serif" font-size="24" font-weight="800" fill="#f8fafc">${esc(a.sub)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Abbildung als PNG-data:-URL (nur im Browser): Die App lässt als Bildquelle nur Raster-Bilder (JPEG/PNG/WebP) zu.
 * Rückfall ohne Canvas: leerer String (die App zeigt dann ihr Platzhalter-Bild).
 */
export async function demoItemPng(a, size = 600) {
  if (typeof document === "undefined" || typeof Image === "undefined") return "";
  try {
    const img = new Image();
    img.src = demoItemImage(a);
    await (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; }));
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    c.getContext("2d").drawImage(img, 0, 0, size, size);
    return c.toDataURL("image/png");
  } catch { return ""; }
}

/** Demo-Artikel im Inserat-Format des Marktplatzes (negative IDs → kein echtes Inserat dahinter). images[i] = Bild-URL. */
export function demoItemListings(images = [], sellerId = "reel-demo-seller", startId = -500) {
  return DEMO_ITEMS.map((a, i) => ({
    id: startId - i, user_id: sellerId, card_id: "", card_name: a.title, image: images[i] || "", price: a.price, market_price: a.market || null,
    city: a.city, seller: "Sammler", status: "active", buy_now: i % 2 === 0, shipping_cents: 499, condition: "", listing_type: "item",
    item_category: a.category, item_condition: a.condition, description: "", extra_images: [], verified: i % 3 === 0, rating: 4.9, rating_count: 12 + i * 7,
  }));
}

/**
 * Demo-Karten-Inserate aus dem ECHTEN Set-Katalog (echte Bilder, echte Cardmarket-Preise): jede zweite Karte als Deal
 * unter Cardmarket, sonst fair bepreist. catalog = [{ id, name, image, price }].
 */
export function demoCardListings(catalog, { n = 22, sellerId = "reel-demo-seller", startId = -1000, cities = ["Köln", "Berlin", "Hamburg", "München", "Frankfurt", "Stuttgart", "Leipzig", "Bremen"] } = {}) {
  const cards = (Array.isArray(catalog) ? catalog : []).filter((c) => c?.id && c.image && Number(c.price) >= 1)
    .sort((a, b) => Number(b.price) - Number(a.price)).slice(0, n);
  return cards.map((c, i) => {
    const mp = Number(c.price);
    const k = i % 2 === 0 ? 0.78 : 0.96;
    const price = Math.max(0.5, Math.round(mp * k * 2) / 2 - 0.1);
    return {
      id: startId - i, user_id: sellerId, card_id: c.id, card_name: c.name, image: c.image, price: +price.toFixed(2), market_price: mp,
      city: cities[i % cities.length], seller: "Sammler", status: "active", buy_now: i % 3 !== 1, shipping_cents: 160, condition: "NM", listing_type: "card",
      verified: i % 4 === 0, rating: 4.8, rating_count: 9 + i * 3,
    };
  });
}
