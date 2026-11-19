// Reine Logik (ohne DOM) für den 16er-Marktplatz-Binder (4×4) und das Hochschieben (Vertical Card-Swipe).
// Getestet in tests/market16.test.ts. Genutzt von client/market16.js.
import { listingTypeOf } from "../server/item-listing-logic.ts";

export const M16_MODES = ["std", "binder", "swipe"];
export const M16_PAGE = 16;
export const M16_QUICK = ["all", "deals", "near"];
export const M16_TYPES = ["all", "card", "item"];

/** Umblättern: unter 30 % Zug federt die Seite zurück – außer bei schnellem Schwung in Blätter-Richtung. */
export const TURN_COMMIT = 0.3;
export const TURN_FLICK = 0.45; // px/ms
/** Hochschieben: ab 35 % Höhe oder schnellem Wisch (Velocity) gleitet die Karte mit Schwung weg. */
export const SWIPE_COMMIT = 0.35;
export const SWIPE_FLICK = 0.5; // px/ms

/** Deterministisch „bunt gemischt“: gleiche Reihenfolge innerhalb einer Sitzung (kein Springen bei jedem Neuzeichnen). */
export function mixListings(list, seed = 1) {
  const h = (id) => {
    let x = (Number(id) || 0) ^ (seed * 2654435761);
    x = Math.imul(x ^ (x >>> 16), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909);
    return (x ^ (x >>> 16)) >>> 0;
  };
  return (Array.isArray(list) ? list.slice() : []).map((l) => [l, h(l?.id)]).sort((a, b) => a[1] - b[1]).map(([l]) => l);
}

const normCity = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
const plzOf = (s) => (String(s || "").match(/\b(\d{5})\b/) || [])[1] || "";
const cityWords = (s) => normCity(s).replace(/\b\d{4,5}\b/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);

/** „In meiner Nähe“: gleiche Stadt (Wort-Treffer) oder gleiches PLZ-Gebiet (erste 2 Ziffern). */
export function isNear(listingCity, myCity) {
  const a = String(listingCity || ""), b = String(myCity || "");
  if (!a.trim() || !b.trim()) return false;
  const pa = plzOf(a), pb = plzOf(b);
  if (pa && pb && pa.slice(0, 2) === pb.slice(0, 2)) return true;
  const wa = cityWords(a), wb = new Set(cityWords(b));
  return wa.some((w) => wb.has(w));
}

/** Echter Deal: Preis deutlich unter Cardmarket (Server-Preis-Check „deal“). */
export const isDeal = (l) => l?.priceCheck === "deal" || (Number(l?.market_price) > 0 && Number(l?.price) > 0 && Number(l.price) / Number(l.market_price) < 0.85);

/** Schnellfilter des 16er-Binders / Swipe-Modus. */
export function quickFilter(list, { quick = "all", type = "all", category = "", myCity = "" } = {}) {
  let out = Array.isArray(list) ? list.filter(Boolean) : [];
  if (type === "card" || type === "item") out = out.filter((l) => listingTypeOf(l) === type && (type !== "item" || !category || String(l.item_category) === category));
  if (quick === "deals") out = out.filter(isDeal);
  else if (quick === "near") out = out.filter((l) => isNear(l.city, myCity));
  return out;
}

/** Ordnerseiten zu je 16 Fächern (letzte Seite wird mit leeren Fächern aufgefüllt). */
export function pages16(list) {
  const items = Array.isArray(list) ? list : [];
  const n = Math.max(1, Math.ceil(items.length / M16_PAGE));
  return Array.from({ length: n }, (_, p) => {
    const page = items.slice(p * M16_PAGE, p * M16_PAGE + M16_PAGE);
    while (page.length < M16_PAGE) page.push(null);
    return page;
  });
}

export const clampPage = (p, count) => Math.max(0, Math.min(Math.max(0, count - 1), Math.round(Number(p) || 0)));

/**
 * Entscheidung beim Loslassen der Seite.
 * @param progress 0…1 Anteil der Seitenbreite in Blätter-Richtung
 * @param velocity px/ms in Blätter-Richtung (positiv = mit der Bewegung)
 */
export function turnDecision(progress, velocity) {
  const p = Number(progress) || 0, v = Number(velocity) || 0;
  if (p >= TURN_COMMIT) return v < -TURN_FLICK ? "back" : "commit";
  if (v > TURN_FLICK && p > 0.04) return "commit";
  return "back";
}

/** Widerstand am Anfang/Ende des Ordners (Gummiband statt Umblättern). */
export const rubber = (x, limit) => {
  const l = Math.max(1, Number(limit) || 1);
  const v = Number(x) || 0;
  return (Math.sign(v) * l * (1 - Math.exp(-Math.abs(v) / l))) * 0.35;
};

/**
 * Hochschieben: dy < 0 = nach oben. height = Höhe der Karte.
 * Liefert „next“ (Karte gleitet nach oben weg), „prev“ (vorherige Karte kommt zurück) oder „back“ (federt zurück).
 */
export function swipeDecision(dy, vy, height, { hasNext = true, hasPrev = true } = {}) {
  const h = Math.max(1, Number(height) || 1);
  const p = (Number(dy) || 0) / h, v = Number(vy) || 0;
  if (p < 0 && hasNext && (-p >= SWIPE_COMMIT || (v < -SWIPE_FLICK && -p > 0.04))) return "next";
  if (p > 0 && hasPrev && (p >= SWIPE_COMMIT || (v > SWIPE_FLICK && p > 0.04))) return "prev";
  return "back";
}

/** Geschwindigkeit aus den letzten Zeigerpunkten ([{t, x|y}], px/ms) – robust gegen einzelne Ausreißer. */
export function velocityOf(samples, key = "x", windowMs = 90) {
  const s = Array.isArray(samples) ? samples : [];
  if (s.length < 2) return 0;
  const last = s[s.length - 1];
  let first = s[0];
  for (let i = s.length - 2; i >= 0; i--) { first = s[i]; if (last.t - s[i].t >= windowMs) break; }
  const dt = last.t - first.t;
  return dt > 0 ? (last[key] - first[key]) / dt : 0;
}

/** Ein Schritt einer gedämpften Feder (für natürliches Zurückschnappen / Umschlagen mit Gewicht). */
export function springStep(x, v, target, dtMs, { stiffness = 260, damping = 26 } = {}) {
  const dt = Math.min(0.032, Math.max(0, Number(dtMs) || 0) / 1000);
  const a = -stiffness * (x - target) - damping * v;
  const nv = v + a * dt;
  return { x: x + nv * dt, v: nv };
}
