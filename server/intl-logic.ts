// PokeSwipe & Radar – reine Logik für den mehrsprachigen Katalog (de / en / ja) und die Swipe-Arena.
// Ohne Datenbank- oder Netzwerkzugriff, damit alles mit `npm test` geprüft werden kann.

export const CATALOG_LANGS = ["de", "en", "ja"] as const;
export type CatalogLang = (typeof CATALOG_LANGS)[number];
/** Sprachen, die zusätzlich zum deutschen Katalog als eigene Drucke importiert werden. */
export const PRINT_LANGS = ["en", "ja"] as const;
export type PrintLang = (typeof PRINT_LANGS)[number];

export const LANG_LABEL: Record<CatalogLang, string> = { de: "Deutsch", en: "Englisch", ja: "Japanisch" };
export const LANG_FLAG: Record<CatalogLang, string> = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };

export const PRINT_ID_RE = /^(en|ja):[A-Za-z0-9.\-_]{2,40}$/;
export const TCGDEX_ID_RE = /^[A-Za-z0-9.\-_]{2,40}$/;
export const SET_ID_RE = /^[A-Za-z0-9.\-_]{1,40}$/;

/** Normalisiert Sprachkürzel; „jp“ wird als Alias für das ISO-Kürzel „ja“ akzeptiert. */
export function normLang(v: unknown): CatalogLang | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "jp" || s === "jpn" || s === "japanisch") return "ja";
  if (s === "eng" || s === "englisch") return "en";
  if (s === "ger" || s === "deutsch") return "de";
  return (CATALOG_LANGS as readonly string[]).includes(s) ? (s as CatalogLang) : null;
}

/** Liste von Sprachen aus einem Query-Parameter wie "de,en,jp" (leer/ungültig → alle). */
export function parseLangs(v: unknown): CatalogLang[] {
  const list = String(v ?? "").split(",").map(normLang).filter((x): x is CatalogLang => !!x);
  const unique = [...new Set(list)];
  return unique.length ? unique : [...CATALOG_LANGS];
}

export const printId = (lang: PrintLang, tcgdexId: string) => `${lang}:${tcgdexId}`;

// ---------------------------------------------------------------------------
// Import-Reihenfolge: neue Sets zuerst. Die TCGdex-Set-Liste enthält kein Erscheinungsdatum (bei Japanisch
// auch keine chronologische Reihenfolge) – bis die Set-Details geladen sind, wird das Jahr aus der Serie geschätzt.
// Priorität = JJJJMMTT (echtes Datum) bzw. Schätzjahr·10000 + Position in der Serie.
// ---------------------------------------------------------------------------
/** Digitale Serien ohne gedruckte Karten (TCG Pocket) – werden nicht importiert. */
export const DIGITAL_SERIES = new Set(["tcgp"]);
const SERIE_YEAR: Record<string, number> = {
  // englische TCGdex-Serien
  misc: 2000, base: 1999, gym: 2000, neo: 2001, lc: 2002, ecard: 2002, ex: 2003, pop: 2004, tk: 2006, dp: 2007, pl: 2009,
  hgss: 2010, col: 2011, bw: 2011, mc: 2011, xy: 2014, sm: 2017, swsh: 2020, sv: 2023, me: 2025,
  // japanische TCGdex-Serien (Kleinschreibung)
  pmcg: 1996, vs: 2001, web: 2001, e: 2001, adv: 2003, pcg: 2004, l: 2009, xyb: 2016, s: 2019, m: 2025,
};

export function serieYear(serieId: unknown) {
  return SERIE_YEAR[String(serieId ?? "").toLowerCase()] ?? 2000;
}

/** Priorität vor dem Detail-Import (Schätzung aus Serie + Position). */
export function estimatedPriority(serieId: unknown, position: number) {
  return serieYear(serieId) * 10000 + Math.max(0, Math.min(9999, Math.floor(position)));
}

/** Priorität nach dem Detail-Import (echtes Erscheinungsdatum). */
export function releasePriority(releaseDate: string | null, fallback: number) {
  return releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? Number(releaseDate.replace(/-/g, "")) : fallback;
}

export function splitPrintId(id: string): { lang: PrintLang; tcgdexId: string } | null {
  if (!PRINT_ID_RE.test(id)) return null;
  const i = id.indexOf(":");
  return { lang: id.slice(0, i) as PrintLang, tcgdexId: id.slice(i + 1) };
}

/** Kartennummer wie auf der Karte: „199/165“ (bei Promos oder unbekannter Setgröße nur „199“). */
export function displayNumber(localId: unknown, official: unknown) {
  const id = String(localId ?? "").trim().slice(0, 20);
  const n = Number(official);
  if (!id) return "";
  // Japanische Karten drucken die Setgröße mit führenden Nullen („001/066“), deutsche/englische wie „006/165“
  return Number.isInteger(n) && n > 0 && /^\d+$/.test(id) ? `${id}/${String(n).padStart(id.length, "0")}` : id;
}

// ---------------------------------------------------------------------------
// Seltenheiten – TCGdex liefert sie je Sprache unterschiedlich (de: „Selten, besondere Illustration“,
// en/ja: „Special illustration rare“). Für Filter werden sie zu wenigen Gruppen zusammengefasst.
// ---------------------------------------------------------------------------
export const RARITY_BUCKETS = ["hits", "sir", "ir", "hyper", "ultra", "rare", "common"] as const;
export type RarityBucket = (typeof RARITY_BUCKETS)[number];

export const RARITY_LABEL: Record<RarityBucket, string> = {
  hits: "Alle Hits (ab Selten)",
  sir: "Special Illustration Rare",
  ir: "Illustration Rare",
  hyper: "Hyper / Gold / Secret",
  ultra: "Ultra / Doppelselten / ex",
  rare: "Selten & Holo",
  common: "Häufig & Nicht so häufig",
};

/** Postgres-Regex (case-insensitive, ~*) je Gruppe; `null` = keine Einschränkung. */
export const RARITY_SQL: Record<RarityBucket, { include: string | null; exclude: string | null }> = {
  hits: { include: null, exclude: "häufig|common|ungewöhnlich|uncommon|^none$" },
  sir: { include: "besondere illustration|special illustration|sar", exclude: null },
  ir: { include: "illustration", exclude: "besondere|special|sar" },
  hyper: { include: "hyper|gold|secret|geheim|crown|krone|ur$", exclude: null },
  ultra: { include: "ultra|doppel|double|rr$|ex$|vmax|vstar|amazing|radiant|strahlend", exclude: null },
  rare: { include: "selten|rare|holo", exclude: "illustration|hyper|ultra|doppel|double|secret|geheim|gold|häufig|uncommon" },
  common: { include: "häufig|common|ungewöhnlich|uncommon", exclude: null },
};

export function rarityBucket(rarity: unknown): RarityBucket | null {
  const r = String(rarity ?? "").trim().toLowerCase();
  if (!r) return null;
  const order: RarityBucket[] = ["sir", "ir", "hyper", "ultra", "common", "rare"];
  for (const b of order) {
    const { include, exclude } = RARITY_SQL[b];
    if (include && !new RegExp(include, "i").test(r)) continue;
    if (exclude && new RegExp(exclude, "i").test(r)) continue;
    return b;
  }
  return null;
}

export const normRarity = (v: unknown): RarityBucket | null =>
  (RARITY_BUCKETS as readonly string[]).includes(String(v ?? "")) ? (v as RarityBucket) : null;

// ---------------------------------------------------------------------------
// Preise
// ---------------------------------------------------------------------------
const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

/** Cardmarket-Werte aus TCGdex (normale Variante, sonst Holo). Einheit EUR. */
export function pickCardmarket(cm: any) {
  if (!cm || typeof cm !== "object") return { trend: null, low: null, avg7: null, avg30: null, updated: null as Date | null };
  const v = (k: string) => pos(cm[k]) ?? pos(cm[`${k}-holo`]);
  const updated = cm.updated ? new Date(cm.updated) : null;
  return { trend: v("trend") ?? v("avg"), low: v("low"), avg7: v("avg7"), avg30: v("avg30"), updated: updated && !Number.isNaN(updated.getTime()) ? updated : null };
}

/**
 * TCGplayer-Werte aus TCGdex (USD). Eine Karte hat mehrere Varianten (normal, holofoil, reverse-holofoil …);
 * maßgeblich ist die Variante mit dem höchsten Marktpreis – das ist bei Hits die gesuchte Ausführung.
 */
export function pickTcgplayer(tp: any) {
  const empty = { market: null as number | null, low: null as number | null, variant: null as string | null, updated: null as Date | null };
  if (!tp || typeof tp !== "object") return empty;
  let best = empty;
  for (const [variant, v] of Object.entries(tp)) {
    if (!v || typeof v !== "object" || ["unit", "updated"].includes(variant)) continue;
    const market = pos((v as any).marketPrice) ?? pos((v as any).midPrice);
    if (!market) continue;
    if (!best.market || market > best.market) best = { market, low: pos((v as any).lowPrice), variant: variant.slice(0, 30), updated: null };
  }
  const updated = tp.updated ? new Date(tp.updated) : null;
  return { ...best, updated: best.market && updated && !Number.isNaN(updated.getTime()) ? updated : null };
}

export type Fx = { USD: number | null; JPY: number | null; day: string | null; estimated: boolean };
/** Notfallkurse, falls noch nie ein EZB-Kurs geladen wurde (werden als „geschätzt“ markiert). */
export const FX_FALLBACK = { USD: 1.1, JPY: 175 };

/** Ab diesem Verhältnis gelten Cardmarket- und TCGplayer-Preis als widersprüchlich. */
export const FEED_CONFLICT_FACTOR = 4;

/** Betrag in einer Fremdwährung → EUR (perEur = Einheiten je 1 EUR, wie bei der EZB). */
export function toEur(amount: number | null | undefined, perEur: number | null | undefined) {
  if (!amount || !perEur || !(amount > 0) || !(perEur > 0)) return null;
  return Math.round((amount / perEur) * 100) / 100;
}

/**
 * Referenzpreis eines Drucks (gilt für alle Sprachen gleich):
 * - Cardmarket (EUR) zuerst – dort wird in der EU gehandelt. Japanische Drucke sind bei Cardmarket eigene Produkte
 *   mit eigenem Preis; englische teilen sich das Produkt mit der deutschen Ausgabe.
 * - Sonst TCGplayer (USD, über den EZB-Kurs in EUR umgerechnet) – ebenso bei stark widersprüchlichen Feeds.
 */
export function choosePrice(cm: ReturnType<typeof pickCardmarket>, tcg: ReturnType<typeof pickTcgplayer>, usdPerEur: number | null) {
  const tcgEur = toEur(tcg.market, usdPerEur);
  const tcgLowEur = toEur(tcg.low, usdPerEur);
  // Widersprechen sich beide Feeds um mehr als Faktor 4, ist meist die Cardmarket-Zuordnung bei TCGdex falsch
  // (z. B. neues Set, Hyper Rare auf das Basis-Produkt gemappt) → TCGplayer-Wert verwenden
  if (cm.trend && tcgEur && (tcgEur > cm.trend * FEED_CONFLICT_FACTOR || cm.trend > tcgEur * FEED_CONFLICT_FACTOR)) {
    return { priceEur: tcgEur, lowEur: tcgLowEur, source: "tcgplayer" as const };
  }
  if (cm.trend) return { priceEur: cm.trend, lowEur: cm.low, source: "cardmarket" as const };
  if (tcgEur) return { priceEur: tcgEur, lowEur: tcgLowEur, source: "tcgplayer" as const };
  return { priceEur: null, lowEur: null, source: null };
}

/** EZB-Tageskurse (eurofxref-daily.xml) lesen. */
export function parseEcbXml(xml: string): { USD: number | null; JPY: number | null; day: string | null } {
  const s = String(xml || "");
  const day = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(s)?.[1] ?? null;
  const rate = (cur: string) => {
    const m = new RegExp(`currency=['"]${cur}['"]\\s+rate=['"]([0-9.]+)['"]`).exec(s);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { USD: rate("USD"), JPY: rate("JPY"), day };
}

/** Ab diesem Abstand gilt ein Angebot in der Arena als „Unter Marktwert“-Deal. */
export const DEAL_MIN_PCT = 15;
/** Deals erst ab diesem Marktwert (EUR). */
export const DEAL_MIN_PRICE = 3;
/** Karten ohne Seltenheitsangabe (häufig bei japanischen Drucken) zählen ab diesem Wert als „Hit“. */
export const HIT_MIN_PRICE_WITHOUT_RARITY = 3;

/** Abstand des günstigsten Angebots zum Marktpreis in Prozent (positiv = unter Marktwert). */
export function dealPct(market: number | null | undefined, offer: number | null | undefined) {
  const m = Number(market), o = Number(offer);
  // Bei Cent-Karten ist der Abstand Tiefstpreis ↔ Trend reines Rauschen (Zustand, Versand) – kein Deal
  if (!(m >= DEAL_MIN_PRICE) || !(o > 0) || o >= m) return 0;
  return Math.round(((m - o) / m) * 100);
}


/** Parameter der Swipe-Arena aus der URL lesen und begrenzen. */
export function parseDeckQuery(q: Record<string, string | undefined>) {
  const num = (v: unknown, max: number) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
  };
  const langs = parseLangs(q.lang);
  let set: { lang: CatalogLang; id: string } | null = null;
  const rawSet = String(q.set ?? "");
  const m = /^(de|en|ja|jp):([A-Za-z0-9.\-_]{1,40})$/.exec(rawSet);
  if (m) set = { lang: normLang(m[1])!, id: m[2] };
  let min = num(q.min, 100_000), max = num(q.max, 100_000);
  if (min !== null && max !== null && max > 0 && min > max) [min, max] = [max, min];
  const exclude = String(q.exclude ?? "").split(",").map((s) => s.trim())
    .filter((s) => /^((en|ja):)?[A-Za-z0-9.\-_]{2,40}$|^l\d{1,10}$/.test(s)).slice(0, 120);
  const limit = Math.max(5, Math.min(60, Number.parseInt(String(q.limit ?? "30"), 10) || 30));
  return {
    langs: set ? [set.lang] : langs,
    set,
    rarity: normRarity(q.rarity) ?? (q.rarity === "any" ? null : "hits" as RarityBucket),
    anyRarity: q.rarity === "any",
    min, max: max && max > 0 ? max : null,
    wishlist: q.wish === "1",
    deals: q.deals === "1",
    listings: q.listings !== "0" || q.market === "1",
    // Marktplatz-Modus: nur Inserate (z. B. frisch gescannte Karten) mit Foto, Preis, Zustand und Kauf-Knopf
    market: q.market === "1",
    exclude,
    limit,
  };
}
