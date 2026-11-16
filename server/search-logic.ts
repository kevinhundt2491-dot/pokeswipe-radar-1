// Serverseitige Kartensuche (Phase 6) – reine Logik: Suchtext zerlegen und Filter prüfen.
// Erkennt Kartennummern („4/102“, „#199“, „199“ am Ende), TCGdex-IDs („sv03.5-199“), Set-Kürzel („OBF 125“, „PAF“)
// und Sprach-Hinweise („jp“, „englisch“). Der Rest ist der Namensteil für die tippfehlertolerante Trigram-Suche.
import { VARIANTS, type Variant } from "./variant-logic.ts";
import { RARITY_BUCKETS, type RarityBucket } from "./intl-logic.ts";

export const SEARCH_LANGS = ["de", "en", "ja"] as const;
export type SearchLang = (typeof SEARCH_LANGS)[number];
export const SEARCH_MAX_LIMIT = 50;

export type ParsedQuery = {
  text: string; // normalisierter Namensteil (klein, ohne Nummer/Kürzel)
  number: string | null; // lokale Nummer ohne führende Nullen
  total: number | null; // offizielle Setgröße hinter dem Schrägstrich
  cardId: string | null; // exakte TCGdex-ID
  setCode: string | null; // Set-Kürzel in Großbuchstaben
  langHint: SearchLang | null;
};

const LANG_WORDS: Record<string, SearchLang> = {
  de: "de", deutsch: "de", german: "de", en: "en", eng: "en", englisch: "en", english: "en",
  jp: "ja", ja: "ja", jap: "ja", japanisch: "ja", japanese: "ja",
};

export function parseSearchQuery(raw: unknown): ParsedQuery {
  let q = String(raw ?? "").normalize("NFKC").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
  const out: ParsedQuery = { text: "", number: null, total: null, cardId: null, setCode: null, langHint: null };
  if (!q) return out;
  // Exakte TCGdex-ID (z. B. sv03.5-199, swsh12pt5-160, base1-4)
  const idMatch = /^([a-z0-9]+(?:\.[0-9]+)?(?:pt[0-9]+)?)-([a-z0-9]+)$/i.exec(q);
  if (idMatch && /\d/.test(idMatch[1])) {
    out.cardId = q;
    return out;
  }
  // Nummer mit Setgröße: 4/102, 004/102, 199 / 165
  const slash = /(?:^|\s)#?0*(\d{1,4}[a-z]?)\s*\/\s*0*(\d{1,4})(?=\s|$)/i.exec(q);
  if (slash) {
    out.number = slash[1].toLowerCase();
    out.total = Number(slash[2]);
    q = (q.slice(0, slash.index) + " " + q.slice(slash.index + slash[0].length)).trim();
  } else {
    const hash = /(?:^|\s)#0*(\d{1,4}[a-z]?)(?=\s|$)/i.exec(q) ?? /\s0*(\d{1,4})$/.exec(q);
    if (hash) {
      out.number = hash[1].toLowerCase();
      q = (q.slice(0, hash.index) + " " + q.slice(hash.index + hash[0].length)).trim();
    }
  }
  const words = q.split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (LANG_WORDS[lw] && words.length > 1) { out.langHint = LANG_WORDS[lw]; continue; }
    // Set-Kürzel: 2–5 Großbuchstaben (+ Ziffern), z. B. OBF, PAF, SV2a, MEW – nur wenn zusätzlich ein Name/eine Nummer da ist
    if (!out.setCode && /^[A-Z]{2,4}[0-9]?[a-z]?$/.test(w) && (words.length > 1 || out.number)) { out.setCode = w.toUpperCase(); continue; }
    rest.push(w);
  }
  out.text = rest.join(" ").toLowerCase().replace(/[%_\\]/g, "").replace(/\s+/g, " ").trim();
  return out;
}

export type SearchFilters = {
  langs: SearchLang[];
  set: string | null; // Set-ID (de: card_sets.id, en/ja: print_sets.id)
  variant: Variant | null;
  rarity: RarityBucket | null;
  min: number | null;
  max: number | null;
  limit: number;
  offset: number;
};

export function parseSearchFilters(qs: Record<string, string | undefined>): SearchFilters | { error: string } {
  const langs = String(qs.lang ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const l of langs) if (!(SEARCH_LANGS as readonly string[]).includes(l)) return { error: "Unbekannte Sprache." };
  const set = qs.set ? String(qs.set) : null;
  if (set && !/^[A-Za-z0-9.\-_]{1,40}$/.test(set)) return { error: "Ungültiges Set." };
  const variant = qs.variant ? String(qs.variant) : null;
  if (variant && !(VARIANTS as readonly string[]).includes(variant)) return { error: "Unbekannte Variante." };
  const rarity = qs.rarity ? String(qs.rarity) : null;
  if (rarity && !(RARITY_BUCKETS as readonly string[]).includes(rarity)) return { error: "Unbekannte Seltenheit." };
  const price = (v: string | undefined) => {
    if (v === undefined || v === "") return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : NaN;
  };
  const min = price(qs.min), max = price(qs.max);
  if (Number.isNaN(min) || Number.isNaN(max)) return { error: "Ungültige Preisspanne." };
  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Number.parseInt(String(qs.limit ?? "24"), 10) || 24));
  const offset = Math.min(1000, Math.max(0, Number.parseInt(String(qs.offset ?? "0"), 10) || 0));
  return {
    langs: (langs.length ? langs : ["de", "en", "ja"]) as SearchLang[],
    set, variant: variant as Variant | null, rarity: rarity as RarityBucket | null, min, max, limit, offset,
  };
}

/** Cache-Schlüssel (normalisiert), damit gleiche Suchen aus dem CDN-/Speicher-Cache kommen. */
export function searchCacheKey(q: ParsedQuery, f: SearchFilters) {
  return JSON.stringify([q.text, q.number, q.total, q.cardId, q.setCode, q.langHint, f.langs, f.set, f.variant, f.rarity, f.min, f.max, f.limit, f.offset]);
}
