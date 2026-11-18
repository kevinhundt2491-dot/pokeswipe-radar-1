// Reine Logik (ohne DOM) für den virtuellen Marktplatz-Binder und die Set-Binder-Vorschau auf der Startseite.
// Geprüft in tests/market-binder.test.ts.
import { setCodeOf } from "./market-filter-logic.js";

/** Karten pro Ordnerseite: 3×3 am Desktop/Tablet, 2×2 auf dem Smartphone. */
export const BINDER_DESKTOP = 9;
export const BINDER_MOBILE = 4;
export const pocketsPerPage = (wide) => (wide ? BINDER_DESKTOP : BINDER_MOBILE);

/** TCGdex-Karten-ID → Set-ID (wie server/binder-logic.ts, ohne Import der Server-Datei). */
export function setIdOf(cardId) {
  const m = /^([a-z0-9.]{2,12})-([a-z0-9]{1,8})$/i.exec(String(cardId || ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * Was fehlt im eigenen Set-Binder? Ein Set „sammelt“ man, sobald mindestens eine Karte daraus im Binder liegt –
 * eine angebotene Karte dieses Sets, die man selbst noch nicht hat, bekommt das Badge „⚡ Fehlt in deinem Binder!“.
 * @param {{cardId?: string, card_id?: string}[]} owned
 */
export function binderIndex(owned) {
  const ids = new Set(), sets = new Set();
  for (const i of Array.isArray(owned) ? owned : []) {
    const id = String(i?.cardId || i?.card_id || "").toLowerCase();
    if (!id) continue;
    ids.add(id);
    const s = setIdOf(id);
    if (s) sets.add(s);
  }
  return { ids, sets };
}

export function missingInBinder(listing, index) {
  const id = String(listing?.card_id || "").toLowerCase();
  if (!id || !index) return false;
  const s = setIdOf(id);
  return Boolean(s && index.sets.has(s) && !index.ids.has(id));
}

/** Set-Auswahl über dem Marktplatz-Binder: Sets der aktuellen Angebote, häufigste zuerst. */
export function setOptions(listings) {
  const counts = new Map();
  for (const l of Array.isArray(listings) ? listings : []) {
    const s = setIdOf(l?.card_id);
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, n]) => ({ id, n, label: id.toUpperCase() }));
}

export const filterBySet = (listings, setId) => (setId ? (listings || []).filter((l) => setIdOf(l?.card_id) === setId) : listings || []);

/** In Seiten aufteilen (leere Liste = eine leere Seite). */
export function pagesOf(list, size) {
  const s = Math.max(1, Math.floor(Number(size)) || BINDER_DESKTOP);
  const out = [];
  for (let i = 0; i < (list || []).length; i += s) out.push(list.slice(i, i + s));
  return out.length ? out : [[]];
}

export const clampIndex = (i, n) => Math.max(0, Math.min(Math.max(0, n - 1), Math.floor(Number(i)) || 0));

/** Seite, auf der eine Karte liegt (nach dem Einzelkarten-Swipe blättert der Ordner mit). */
export const pageOfIndex = (i, size) => Math.floor(Math.max(0, Number(i) || 0) / Math.max(1, size));

/** Preis-Zeile einer Tasche: Verkaufspreis oder „🔄 Tausch“. */
export function pocketPrice(l, eur) {
  const p = Number(l?.price) || 0;
  return p > 0 ? eur(p) : "🔄 Tausch";
}

/** Kurzinfo „SV3PT5 · 199“ für die Einzelkarten-Ansicht. */
export const pocketCode = (l) => setCodeOf(l);
