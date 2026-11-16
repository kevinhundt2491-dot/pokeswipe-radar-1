// PokeSwipe & Radar – zentrale Kartensuche im Browser (Phase 6)
// Alle Suchfelder (Kartensuche, Preisalarm, Wunschliste, Graded-Portfolio) nutzen diese eine Funktion gegen /api/search
// (eigener Katalog, tippfehlertolerant, Nummern wie „4/102“). Ergebnisse werden 5 Minuten im Speicher gehalten,
// laufende Anfragen für dasselbe Feld werden abgebrochen, sobald eine neue Suche startet.
import { cdn, FALLBACK_IMG } from "./core.js";

const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 150;
const cache = new Map();
const inflight = new Map(); // Kanal → AbortController

export const LANG_FLAGS = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };

/** Fehler der Suche mit HTTP-Status (z. B. 429 bei zu vielen Anfragen). */
export class SearchError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function cacheKey(q, opts) {
  return JSON.stringify([q.trim().toLowerCase(), opts.lang || "", opts.set || "", opts.variant || "", opts.rarity || "", opts.min ?? "", opts.max ?? "", opts.limit || 24, opts.offset || 0]);
}

/**
 * Sucht im Katalog. opts: { lang: "de" | "de,en" | …, set, variant, rarity, min, max, limit, offset, channel }
 * channel: Name des Suchfelds – eine neue Suche im selben Feld bricht die vorige ab.
 * @returns {Promise<{ items: any[], total: number }>}
 */
export async function searchCatalog(q, opts = {}) {
  const query = String(q || "").trim();
  if (query.length < 2 && !opts.set) return { items: [], total: 0 };
  const key = cacheKey(query, opts);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const channel = opts.channel || "default";
  inflight.get(channel)?.abort();
  const ctrl = new AbortController();
  inflight.set(channel, ctrl);
  const params = new URLSearchParams({ q: query });
  for (const k of ["lang", "set", "variant", "rarity", "min", "max", "limit", "offset"]) {
    if (opts[k] !== undefined && opts[k] !== null && opts[k] !== "") params.set(k, String(opts[k]));
  }
  try {
    const res = await fetch(`/api/search?${params}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SearchError(data.error || "Suche gerade nicht möglich.", res.status);
    const out = { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total) || 0 };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), data: out });
    return out;
  } finally {
    if (inflight.get(channel) === ctrl) inflight.delete(channel);
  }
}

/** true, wenn die Suche durch eine neuere Suche im selben Feld abgebrochen wurde (kein Fehler anzeigen). */
export const isAbort = (e) => e?.name === "AbortError";

/** Vorschaubild eines Treffers (TCGdex-Basis-URL oder fertige Bild-URL) über das Image CDN. */
export function searchThumb(item, width = 200) {
  const img = String(item?.image || "");
  if (!img) return FALLBACK_IMG;
  const url = /\.(webp|png|jpe?g)$/i.test(img) ? img.replace(/\/high\.webp$/, "/low.webp") : `${img}/low.webp`;
  return cdn(url, width);
}

/** Kurzbeschreibung: Set · Nummer · Sprache */
export function searchMeta(item) {
  return [item.setCode || item.setName, item.number ? `#${item.number}` : "", item.lang !== "de" ? (LANG_FLAGS[item.lang] || item.lang.toUpperCase()) : ""]
    .filter(Boolean).join(" · ");
}

/** Hängt eine Eingabe mit Verzögerung (Tippen) an eine Suchfunktion; Enter sucht sofort. */
export function bindSearchInput(input, run, delay = 300) {
  if (!input || input.dataset.psSearchBound) return;
  input.dataset.psSearchBound = "1";
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const v = input.value.trim();
    if (v.length >= 3) timer = setTimeout(() => run(v), delay);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(timer); run(input.value.trim()); }
  });
}
