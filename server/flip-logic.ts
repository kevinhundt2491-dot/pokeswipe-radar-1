// PokeSwipe & Radar – reine Logik des Live Flip-Radars (ohne Datenbank/Netzwerk, testbar und auch im Browser nutzbar):
// Angebotstitel erkennen (Grading, Sprache, Zustand, Fälschungen/Konvolute), Karten zuordnen, Deals berechnen,
// robuste Mediane für Verkaufspreise und Sealed-Preise, Grading-ROI-Rechner und eBay-Partner-Links.

export const EPN_CAMPAIGN_ID = "5339244109";
/** Ab diesem Abstand zum Referenz-Marktpreis gilt ein Angebot als Arbitrage-Deal. */
export const FLIP_DEAL_MIN_PCT = 20;
/** Sniper-Deals (Pro): mindestens so viel unter Marktwert. */
export const SNIPER_MIN_PCT = 25;
/** Unter diesem Marktwert sind Abstände nur Rauschen (Versand, Gebühren). */
export const FLIP_MIN_REF_EUR = 5;
/** Ab diesem Abstand ist ein Angebot verdächtig günstig (Fälschung, falsche Zuordnung, Beschädigung). */
export const SUSPICIOUS_PCT = 60;
/** Mindestzahl Verkäufe, damit ein Median als Referenz taugt. */
export const MIN_SOLD_FOR_REF = 3;
export const MIN_RAW_SOLD_FOR_REF = 5;
/** Auktionen gelten als „endet bald“, wenn sie innerhalb dieser Zeit enden. */
export const AUCTION_SOON_MS = 24 * 3600_000;

export type GradeKey = "raw" | "psa10" | "psa9" | "psa8" | "bgs" | "cgc" | "other";
export const GRADE_KEYS: GradeKey[] = ["raw", "psa8", "psa9", "psa10", "bgs", "cgc", "other"];
export const GRADE_LABEL: Record<GradeKey, string> = {
  raw: "Raw (NM/LP)", psa8: "PSA 8", psa9: "PSA 9", psa10: "PSA 10", bgs: "BGS", cgc: "CGC", other: "Andere Slabs",
};

export type TitleLang = "de" | "en" | "ja" | null;
export type TargetKind = "card" | "print" | "sealed";

// ---------------------------------------------------------------------------
// Titel-Erkennung
// ---------------------------------------------------------------------------
const GRADE_RE = /\b(PSA|BGS|BECKETT|CGC|TAG|SGC|ACE|PCA|GSG)\s*[-:#]?\s*(?:GEM\s*(?:MT|MINT)\s*|MINT\s*|PRISTINE\s*|BLACK\s*LABEL\s*)?(10|9[.,]5|9|8[.,]5|8|7[.,]5|7|6|5|4|3|2|1(?:[.,]5)?)\b/i;
/** „PSA ready“, „PSA 10 Kandidat“ usw. sind ungegradete Karten. */
const NOT_GRADED_RE = /\b(ready|candidate|kandidat|potential|potenzial|worthy|würdig|possible|möglich|grading\s*kandidat)\b/i;
const SLAB_HINT_RE = /\b(graded|gegradet|slab|psa|bgs|cgc|beckett)\b/i;

export function parseGrade(title: string): { key: GradeKey; label: string } {
  const t = String(title || "");
  const m = t.match(GRADE_RE);
  if (m) {
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 18);
    if (!NOT_GRADED_RE.test(after)) {
      const company = m[1].toUpperCase() === "BECKETT" ? "BGS" : m[1].toUpperCase();
      const grade = Number(m[2].replace(",", "."));
      const label = `${company} ${String(grade).replace(".", ",")}`;
      if (company === "PSA") {
        if (grade === 10) return { key: "psa10", label };
        if (grade === 9) return { key: "psa9", label };
        if (grade === 8) return { key: "psa8", label };
        return { key: "other", label };
      }
      if (company === "BGS") return { key: "bgs", label };
      if (company === "CGC") return { key: "cgc", label };
      return { key: "other", label };
    }
  }
  if (/\b(graded|gegradet|slab)\b/i.test(t) && !NOT_GRADED_RE.test(t)) return { key: "other", label: "Graded" };
  return { key: "raw", label: "Raw" };
}

export function rawCondition(title: string): "nm" | "lp" | "dmg" | "" {
  const t = String(title || "");
  // Kürzel wie EX/LP/PO nur in Großbuchstaben – „ex“ ist sonst Teil des Kartennamens (Glurak-ex), „HP“ sind Kraftpunkte
  if (/\b(damaged|beschädigt|beschaedigt|knick|knicke|crease[ds]?|wasserschaden|water\s*damage|heavily\s*played|poor|riss)\b/i.test(t) || /\b(DMG|PO)\b/.test(t)) return "dmg";
  if (/\b(light(?:ly)?\s*played|excellent|played|gebraucht)\b/i.test(t) || /\b(LP|EX|PL|GD)\b/.test(t)) return "lp";
  if (/\b(near\s*mint|mint|neuwertig|pack\s*fresh|packfresh|frisch\s*aus\s*(?:dem\s*)?booster)\b/i.test(t) || /\b(NM|M)\b/.test(t)) return "nm";
  return "";
}

export function titleLang(title: string): TitleLang {
  const t = String(title || "");
  if (/(japanisch|japanese|japan\b|\bjpn?\b|\(jp\)|jap\.|日本|ポケモン)/i.test(t)) return "ja";
  if (/(englisch|english|\benglish\b|\beng?\b|\(en\))/i.test(t)) return "en";
  if (/(deutsch|german|\bger\b|\bdeu?\b|\(de\))/i.test(t)) return "de";
  return null;
}

/** Fälschungen, Nachdrucke, Zubehör, Konvolute, Digitales – nie als Deal werten. */
const JUNK_RE = /(proxy|fake|f[äa]lschung|custom|orica|replica|replik|nachdruck|reprint|\bmetal\b|metall|gold\s*(?:foil\s*)?card|goldkarte|sticker|aufkleber|\blot\b|konvolut|sammlung|bundle\s*aus|\bset\s*aus|\bx\s?\d{2,}\b|\d{2,}\s*x\s|binder|ordner|sleeves?\b|h[üu]llen?\b|toploader|digital|code\s*card|online\s*code|ptcgo|tcg\s*live\s*code|art\s*print|poster|jumbo|oversize[d]?|xxl|leer(?:e|es)?\b|empty|nur\s*(?:die\s*)?(?:box|verpackung)|ohne\s*(?:inhalt|booster|karten)|attrappe|deko|dummy|mystery|überraschung|überraschungs|random)/i;
export const isJunkTitle = (title: string) => JUNK_RE.test(String(title || ""));

/** Sealed: geöffnete/leere Produkte, Einzel-Booster aus Displays usw. aussortieren. */
const SEALED_JUNK_RE = /(geöffnet|geoeffnet|opened|\bopen\b|leer|empty|ohne\s*booster|nur\s*(?:die\s*)?(?:box|karton)|karton\s*only|case\s*only|deko|replica|fake|proxy|chinesisch|chinese|korean|koreanisch|einzel(?:ner)?\s*booster\s*aus|\bsleeve|sticker|lot\b|konvolut)/i;
export const isSealedJunk = (title: string) => SEALED_JUNK_RE.test(String(title || ""));

const norm = (s: string) => String(s || "").toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/é/g, "e")
  .replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

const SUFFIX_WORDS = new Set(["ex", "gx", "v", "vmax", "vstar", "tag", "team", "break", "prime", "lv", "x", "mega", "m", "dark", "light", "radiant", "strahlendes", "strahlender", "strahlende", "shining", "the", "of", "von", "und", "and", "s", "full", "art"]);

/** Wichtigstes Namenswort (z. B. „glurak“ aus „Glurak-ex“, „rayquaza“ aus „Mega-Rayquaza-ex“). */
export function nameTokens(name: string): string[] {
  return norm(String(name || "").replace(/-/g, " ")).split(" ").filter((w) => w.length >= 3 && !SUFFIX_WORDS.has(w));
}

export type MatchTarget = { names: string[]; localId: string; total?: number | null; requireLang?: TitleLang; rejectLang?: TitleLang[] };

/** Passt der Angebotstitel zur Karte? Stark: Nummer „199/165“; sonst Name + Nummer. Sprache wird geprüft. */
export function titleMatchesCard(title: string, target: MatchTarget): boolean {
  const t = norm(title);
  const lang = titleLang(title);
  if (target.requireLang && lang !== target.requireLang) return false;
  if (target.rejectLang?.length && lang && target.rejectLang.includes(lang)) return false;
  const local = String(target.localId || "").trim();
  if (!local) return false;
  const names = target.names.flatMap(nameTokens);
  const nameHit = !names.length || names.some((n) => t.includes(n));
  if (/^\d+$/.test(local)) {
    const n = Number(local);
    const total = Number(target.total) || 0;
    if (total > 0) {
      const full = new RegExp(`(?:^|[^0-9])0*${n}\\s*/\\s*0*${total}(?:[^0-9]|$)`);
      if (full.test(t)) return true;
    }
    // ohne Gesamtzahl: Nummer als eigenes Token + Name
    const lone = new RegExp(`(?:^|[^0-9/])0*${n}(?:\\s*/\\s*\\d{2,3})?(?:[^0-9]|$)`);
    if (!lone.test(t)) return false;
    if (total > 0) {
      // „199/198“ einer anderen Karte ausschließen
      const other = new RegExp(`(?:^|[^0-9])0*${n}\\s*/\\s*0*(\\d{2,3})(?:[^0-9]|$)`);
      const om = t.match(other);
      if (om && Number(om[1]) !== total) return false;
    }
    return nameHit && names.length > 0;
  }
  // Promos/Trainer-Galerie: „SVP 085“, „TG05“, „SWSH 050“
  const l = norm(local).replace(/\s+/g, "");
  const compact = t.replace(/\s+/g, "");
  const m = l.match(/^([a-z]+)0*(\d+)$/);
  const hit = m ? new RegExp(`${m[1]}0*${Number(m[2])}(?:[^0-9]|$)`).test(compact) : compact.includes(l);
  return hit && nameHit && names.length > 0;
}

/** Sealed-Produkt: alle Kernwörter des Namens müssen vorkommen (Set + Produktart). */
export function titleMatchesSealed(title: string, productName: string, kind = ""): boolean {
  if (isSealedJunk(title)) return false;
  const t = norm(title);
  const STOP = new Set(["pokemon", "pokémon", "tcg", "karmesin", "purpur", "scarlet", "violet", "und", "and", "the", "deutsch", "german", "englisch", "english", "box", "sammelkartenspiel"]);
  const words = norm(productName).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return false;
  const hits = words.filter((w) => t.includes(w)).length;
  if (hits < Math.max(1, Math.ceil(words.length * 0.75))) return false;
  const KIND_WORDS: Record<string, RegExp> = {
    display: /(display|booster\s*box|36er|36\s*booster|18er|18\s*booster)/,
    etb: /(top\s*trainer|elite\s*trainer|\betb\b|ttb)/,
    ttb: /(top\s*trainer|elite\s*trainer|\betb\b|ttb)/,
    tin: /(\btin\b|dose)/,
    bundle: /(bundle|booster\s*bundle|6er|6\s*booster)/,
    booster: /(booster|blister)/,
    collection: /(kollektion|collection|premium|box)/,
  };
  const re = KIND_WORDS[kind];
  return re ? re.test(t) : true;
}

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function quantile(values: number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Ausreißer (Tippfehler, Konvolute, Fälschungen) per IQR-Regel entfernen. */
export function trimOutliers(values: number[]): number[] {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 4) return v;
  const q1 = quantile(v, 0.25)!, q3 = quantile(v, 0.75)!;
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return v.filter((x) => x >= lo && x <= hi);
}

export const robustMedian = (values: number[]) => median(trimOutliers(values));
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tages-Mediane (für 30/90-Tage-Charts). */
export function dailyMedians(points: { day: string; price: number }[]): { day: string; median: number; n: number }[] {
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    if (!(p.price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(p.day)) continue;
    byDay.set(p.day, [...(byDay.get(p.day) ?? []), p.price]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, median: round2(median(v)!), n: v.length }));
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------
export function discountPct(ref: number | null | undefined, total: number | null | undefined): number | null {
  const r = Number(ref), t = Number(total);
  if (!(r > 0) || !(t > 0)) return null;
  return Math.round(((r - t) / r) * 1000) / 10;
}

export type DealInput = {
  total: number; ref: number | null; buyingOption: string; endAt?: Date | null; junk?: boolean;
  rawCondition?: string; sellerFeedbackPct?: number | null; now?: number;
};

/**
 * Deal-Regel: Sofort-Kaufen ≥ 20 % unter Referenz (Referenz ≥ 5 €); Auktionen nur, wenn sie innerhalb von 24 h enden.
 * Beschädigte Karten und Fälschungs-/Konvolut-Titel sind nie Deals. Ab 60 % Abstand: als verdächtig markieren.
 */
export function evaluateDeal(d: DealInput): { pct: number | null; isDeal: boolean; suspicious: boolean } {
  const pct = discountPct(d.ref, d.total);
  if (pct === null || d.junk || d.rawCondition === "dmg" || Number(d.ref) < FLIP_MIN_REF_EUR) return { pct, isDeal: false, suspicious: false };
  const now = d.now ?? Date.now();
  const auctionOk = d.buyingOption !== "AUCTION" || (!!d.endAt && d.endAt.getTime() > now && d.endAt.getTime() - now <= AUCTION_SOON_MS);
  const isDeal = pct >= FLIP_DEAL_MIN_PCT && auctionOk;
  const lowFeedback = d.sellerFeedbackPct != null && Number(d.sellerFeedbackPct) > 0 && Number(d.sellerFeedbackPct) < 97;
  return { pct, isDeal, suspicious: isDeal && (pct >= SUSPICIOUS_PCT || lowFeedback) };
}

/**
 * Referenzpreis eines Angebots: Raw → Cardmarket/TCGplayer-Marktpreis, bei genug Verkäufen der kleinere Wert
 * (konservativ); Slabs → Median der Verkäufe derselben Note (sonst kein Deal).
 */
export function chooseRef(gradeKey: GradeKey, market: number | null, sold: { median: number | null; sample: number } | null, marketSource = "cardmarket") {
  if (gradeKey === "raw") {
    const soldOk = sold && sold.median && sold.sample >= MIN_RAW_SOLD_FOR_REF ? sold.median : null;
    if (market && market > 0 && soldOk) return soldOk < market ? { ref: soldOk, source: "sold" } : { ref: market, source: marketSource };
    if (market && market > 0) return { ref: market, source: marketSource };
    if (soldOk) return { ref: soldOk, source: "sold" };
    return { ref: null, source: null };
  }
  if (sold && sold.median && sold.sample >= MIN_SOLD_FOR_REF) return { ref: sold.median, source: "sold" };
  return { ref: null, source: null };
}

// ---------------------------------------------------------------------------
// Sealed: automatischer Referenzpreis
// ---------------------------------------------------------------------------
export type SealedSources = { sold: number[]; auctions: number[]; asks: number[]; community: number[] };

/**
 * Reihenfolge: echte eBay-Verkäufe (≥ 3) → beendete Auktionen mit Geboten (≥ 3) →
 * unteres Quartil der Sofort-Kaufen-Angebote (≥ 4, Angebote liegen über dem Marktpreis) → Community-Inserate (≥ 2).
 */
export function sealedAutoPrice(s: SealedSources): { price: number; source: string; sample: number } | null {
  const sold = trimOutliers(s.sold);
  if (sold.length >= 3) return { price: round2(median(sold)!), source: "ebay-sold", sample: sold.length };
  const auctions = trimOutliers(s.auctions);
  if (auctions.length >= 3) return { price: round2(median(auctions)!), source: "ebay-auction", sample: auctions.length };
  const asks = trimOutliers(s.asks);
  if (asks.length >= 4) return { price: round2(quantile(asks, 0.25)!), source: "ebay-ask", sample: asks.length };
  const community = trimOutliers(s.community);
  if (community.length >= 2) return { price: round2(median(community)!), source: "community", sample: community.length };
  return null;
}

export const SEALED_SOURCE_LABEL: Record<string, string> = {
  "ebay-sold": "eBay-Verkäufe", "ebay-auction": "beendete eBay-Auktionen", "ebay-ask": "eBay-Sofortkauf-Angebote (unteres Quartil)",
  community: "Community-Inserate", admin: "Admin-Preis", import: "Admin-Import (CSV)",
};

// ---------------------------------------------------------------------------
// Grading-ROI
// ---------------------------------------------------------------------------
export const GRADING_PRESETS = [
  { key: "psa-value", label: "PSA Value Bulk", fee: 25, days: 65 },
  { key: "psa-regular", label: "PSA Regular", fee: 75, days: 20 },
  { key: "cgc-standard", label: "CGC Standard", fee: 20, days: 30 },
  { key: "bgs-base", label: "BGS Base", fee: 25, days: 45 },
];

export type RoiInput = {
  raw: number; fee: number; shipping: number; psa10: number; psa9?: number | null; psa8?: number | null;
  p10: number; p9: number; sellFeePct?: number;
};

/**
 * Erwarteter Grading-Ertrag: Rohkarte + Gebühr + Versand/Versicherung gegen den erwarteten Verkaufswert
 * (Wahrscheinlichkeit PSA 10 / 9 / Rest ≈ PSA 8 bzw. Rohwert) abzüglich Verkaufsgebühr.
 */
export function gradingRoi(i: RoiInput) {
  const raw = Math.max(0, Number(i.raw) || 0), fee = Math.max(0, Number(i.fee) || 0), ship = Math.max(0, Number(i.shipping) || 0);
  const p10 = Math.min(1, Math.max(0, Number(i.p10) || 0)), p9 = Math.min(1 - p10, Math.max(0, Number(i.p9) || 0));
  const pRest = Math.max(0, 1 - p10 - p9);
  const v10 = Math.max(0, Number(i.psa10) || 0);
  const v9 = Math.max(0, Number(i.psa9) || 0) || v10 * 0.45;
  const v8 = Math.max(0, Number(i.psa8) || 0) || Math.max(raw * 0.9, v9 * 0.6);
  const sellFee = Math.min(0.5, Math.max(0, (Number(i.sellFeePct) || 0) / 100));
  const cost = raw + fee + ship;
  const expectedGross = p10 * v10 + p9 * v9 + pRest * v8;
  const expected = expectedGross * (1 - sellFee);
  const profit = expected - cost;
  const profit10 = v10 * (1 - sellFee) - cost;
  // Ab welcher PSA-10-Quote lohnt es sich? (übrige Quote wie eingestellt aufgeteilt)
  // Ab welcher PSA-10-Quote lohnt es sich? (PSA-9-Quote fest, Rest ≈ PSA 8)
  const breakEvenP10 = (() => {
    const denom = v10 - v8;
    if (denom <= 0 || sellFee >= 1) return null;
    const need = (cost / (1 - sellFee) - p9 * v9 - (1 - p9) * v8) / denom;
    return need <= 0 ? 0 : need > 1 - p9 ? null : Math.round(need * 1000) / 10;
  })();
  return {
    cost: round2(cost), expected: round2(expected), profit: round2(profit),
    roiPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null,
    profitIf10: round2(profit10), breakEvenP10, worth: profit > 0,
    values: { psa10: round2(v10), psa9: round2(v9), psa8: round2(v8) },
  };
}

// ---------------------------------------------------------------------------
// eBay-Partner-Links & Suchbegriffe
// ---------------------------------------------------------------------------
const EBAY_HOST_RE = /^(?:www\.)?ebay\.(?:de|com|at|ch|co\.uk|fr|it|es|nl|be|ie|pl)$/i;

/** Direkter Link aufs Einzelangebot mit ePN-Parametern (eBay liefert itemAffiliateWebUrl schon fertig, sonst anhängen). */
export function affiliateItemUrl(itemWebUrl: string, affiliateUrl?: string | null, customId = "pokeswipe-flip"): string {
  for (const cand of [affiliateUrl, itemWebUrl]) {
    try {
      const u = new URL(String(cand || ""));
      if (u.protocol !== "https:" || !EBAY_HOST_RE.test(u.hostname)) continue;
      if (!u.searchParams.has("campid")) {
        u.searchParams.set("mkcid", "1");
        u.searchParams.set("mkrid", "707-53477-19255-0");
        u.searchParams.set("siteid", "77");
        u.searchParams.set("campid", EPN_CAMPAIGN_ID);
        u.searchParams.set("customid", customId.slice(0, 40));
        u.searchParams.set("toolid", "10001");
        u.searchParams.set("mkevt", "1");
      }
      return u.toString();
    } catch {}
  }
  return "";
}

/** Suchlink (Fallback ohne eBay-API) – Sofort-Kaufen, günstigste zuerst. */
export const ebaySearchUrl = (q: string, customId = "pokeswipe-flip") =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_BIN=1&_sop=15&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=${EPN_CAMPAIGN_ID}&customid=${encodeURIComponent(customId)}&toolid=10001&mkevt=1`;

/** Suchbegriff für eBay: Name + Nummer (+ „japanese“ für JP, englischer Name statt japanischer Schrift). */
export function buildQuery(t: { kind: TargetKind; name: string; nameEn?: string | null; number?: string | null; localId?: string | null; lang?: string | null }): string {
  const name = String(t.kind === "print" && t.lang === "ja" ? (t.nameEn || t.name) : t.name).replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();
  if (t.kind === "sealed") return `Pokemon ${name}`.replace(/\bpok[eé]mon\s+pok[eé]mon\b/i, "Pokemon").slice(0, 90);
  const number = String(t.number || t.localId || "").trim();
  return `${name} ${number}${t.lang === "ja" ? " japanese" : ""}`.replace(/\s+/g, " ").trim().slice(0, 90);
}

export const targetKey = (kind: TargetKind, id: string) => `${kind}:${id}`;
export function parseTargetKey(key: string): { kind: TargetKind; id: string } | null {
  const m = String(key || "").match(/^(card|print|sealed):(.{1,60})$/);
  return m ? { kind: m[1] as TargetKind, id: m[2] } : null;
}
