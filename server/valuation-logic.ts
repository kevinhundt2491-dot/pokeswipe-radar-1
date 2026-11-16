// Phase 9: Eigene, ausfallsichere Preis-Pipeline – reine Logik ohne Datenbank (gut testbar).
//
// Ziel: Ein Marktwert je Karte, Variante und Stufe, der NICHT von einer Live-Abfrage abhängt.
// Stufen (Rohkarten):  NM · LP · MP · HP · Damaged
// Stufen (Graded):     PSA 8 · PSA 9 · PSA 10
//
// Quellen (alle bereits in der eigenen Datenbank gespeichert):
//  • cardmarket – Cardmarket-Referenz (Trend/Durchschnitt, über TCGdex importiert und in `cards` gespeichert)
//  • ebay       – echte eBay-Verkäufe (sold_comps, „Raw“ = NM/LP, PSA 8/9/10)
//  • pokeswipe  – verifizierte Verkäufe im eigenen Treuhand-Marktplatz (ausgezahlt, nicht erstattet), mit Zustand
//  • graded     – verdichtete Graded-Werte (grade_values: Median 90 Tage / günstigstes Angebot)
//
// Regeln:
//  • Verkäufe schlagen Referenzwerte, sobald genug davon da sind; wenige Verkäufe werden mit der Referenz gemischt.
//  • PokeSwipe-Verkäufe zählen stärker als eBay (bestätigte Zahlung + Zustand bekannt).
//  • Ausreißer (Median weicht mehr als Faktor 3 von der Referenz ab) zählen kaum.
//  • Graded-Preise werden NIE aus Rohpreisen geschätzt – nur echte Verkäufe oder Angebote.
import { median, trimOutliers, round2 } from "./flip-logic.ts";
import { MARKET_CONDITION_FACTORS, marketCondition, type MarketCondition } from "./condition-logic.ts";

export const RAW_TIERS = ["nm", "lp", "mp", "hp", "dmg"] as const;
export const GRADED_TIERS = ["psa8", "psa9", "psa10"] as const;
export const TIERS = [...RAW_TIERS, ...GRADED_TIERS] as const;
export type RawTier = (typeof RAW_TIERS)[number];
export type GradedTier = (typeof GRADED_TIERS)[number];
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  nm: "Near Mint", lp: "Lightly Played", mp: "Moderately Played", hp: "Heavily Played", dmg: "Damaged",
  psa8: "PSA 8", psa9: "PSA 9", psa10: "PSA 10",
};
export const TIER_SHORT: Record<Tier, string> = { nm: "NM", lp: "LP", mp: "MP", hp: "HP", dmg: "DMG", psa8: "PSA 8", psa9: "PSA 9", psa10: "PSA 10" };

/**
 * Cardmarket-Zustände → internationale Stufen (übliche Umrechnung):
 * Mint/Near Mint → NM, Excellent → LP, Good → MP, Light Played/Played → HP, Poor → Damaged.
 */
export const TIER_OF_CONDITION: Record<MarketCondition, RawTier> = { mint: "nm", nm: "nm", ex: "lp", gd: "mp", lp: "hp", pl: "hp", po: "dmg" };

/** Abschlag je Stufe relativ zu Near Mint (gleiche Werte wie Portfolio & Marktplatz). */
export const TIER_FACTORS: Record<RawTier, number> = {
  nm: 1, lp: MARKET_CONDITION_FACTORS.ex, mp: MARKET_CONDITION_FACTORS.gd, hp: MARKET_CONDITION_FACTORS.pl, dmg: MARKET_CONDITION_FACTORS.po,
};

export function tierOfCondition(input: unknown): RawTier | null {
  const c = marketCondition(input);
  return c ? TIER_OF_CONDITION[c] : null;
}

/** derived = aus dem NM-Verkaufswert abgeleitet (wenn keine Cardmarket-Referenz vorliegt) */
export type SourceKey = "cardmarket" | "ebay" | "pokeswipe" | "graded" | "derived";
export type Sale = { price: number; soldAt: Date | string };

export type ValuationInput = {
  /** Cardmarket-Referenz (NM) der Variante – aus der eigenen DB, nicht live */
  reference: number | null;
  referenceAt?: Date | string | null;
  /** eBay-Verkäufe „Raw“ (gelten als NM/LP-Mischung → NM-Stufe mit leichtem Abschlag) */
  ebayRaw: Sale[];
  /** eBay-Verkäufe je Graded-Stufe */
  ebayGraded: Partial<Record<GradedTier, Sale[]>>;
  /** Verifizierte PokeSwipe-Verkäufe mit Zustand */
  pokeswipe: Array<Sale & { condition: unknown }>;
  /** Verdichtete Graded-Werte (Median 90 Tage, günstigstes Angebot) */
  gradeValues: Partial<Record<GradedTier, { median90: number | null; sample90: number; askLow: number | null; updatedAt?: Date | string | null }>>;
};

export type TierValuation = {
  tier: Tier;
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: number;
  sampleSize: number;
  sources: Partial<Record<SourceKey, number>>;
  /** reference = nur Referenz × Abschlag; sales = überwiegend Verkäufe; blend = gemischt; ask = nur Angebot; none */
  basis: "sales" | "blend" | "reference" | "ask" | "none";
  dataAt: string | null;
};

const DAY = 86400_000;
/** eBay-„Raw“ enthält gemischte Zustände – leichter Abschlag gegenüber reinem NM */
export const EBAY_RAW_NM_FACTOR = 0.95;
/** Gewicht eines einzelnen Verkaufs je Quelle (Referenz zählt 1) */
const SALE_WEIGHT: Record<"ebay" | "pokeswipe", number> = { ebay: 0.25, pokeswipe: 0.4 };
const MAX_SALE_WEIGHT: Record<"ebay" | "pokeswipe", number> = { ebay: 2.5, pokeswipe: 3 };

const toTime = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);
const latest = (...dates: Array<Date | string | null | undefined>) => {
  const t = dates.map(toTime).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
};

/** Verkäufe der letzten `days` Tage, bereinigt um Ausreißer. */
export function recentPrices(sales: Sale[], now = Date.now(), days = 90): { prices: number[]; newest: string | null } {
  const since = now - days * DAY;
  const recent = sales.filter((s) => s.price > 0 && toTime(s.soldAt) >= since);
  return { prices: trimOutliers(recent.map((s) => s.price)), newest: latest(...recent.map((s) => s.soldAt)) };
}

/** Plausibilität gegen die Referenz: weicht ein Median mehr als Faktor 3 ab, zählt er kaum (Fehlzuordnung, Lot, Fake). */
export function plausibility(value: number, reference: number | null) {
  if (!reference || reference <= 0) return 1;
  const ratio = value / reference;
  return ratio > 3 || ratio < 1 / 3 ? 0.1 : 1;
}

type Part = { src: SourceKey; value: number; weight: number; n: number };

function blend(parts: Part[]): { value: number | null; sources: Partial<Record<SourceKey, number>> } {
  const used = parts.filter((p) => p.weight > 0 && p.value > 0);
  const total = used.reduce((s, p) => s + p.weight, 0);
  if (!total) return { value: null, sources: {} };
  const value = round2(used.reduce((s, p) => s + p.value * p.weight, 0) / total);
  const sources: Partial<Record<SourceKey, number>> = {};
  for (const p of used) sources[p.src] = Math.round(((sources[p.src] || 0) + p.weight / total) * 100) / 100;
  return { value, sources };
}

/**
 * Konfidenz 0–100: Anzahl Verkäufe, Aktualität der Daten und Übereinstimmung von Verkäufen und Referenz.
 * Nur Referenz → höchstens 55; mit ≥ 10 passenden Verkäufen bis 95.
 */
export function confidenceScore(opts: { hasReference: boolean; sales: number; ageDays: number | null; agreement: number | null }) {
  let c = opts.hasReference ? 45 : 0;
  c += Math.min(45, opts.sales * 4.5);
  if (opts.agreement !== null) c -= Math.min(25, Math.abs(1 - opts.agreement) * 50);
  if (opts.ageDays !== null) c -= Math.min(30, Math.max(0, opts.ageDays - 2) * 1.5);
  if (opts.hasReference && !opts.sales) c = Math.min(c, 55);
  return Math.max(0, Math.min(95, Math.round(c)));
}

const ageDays = (iso: string | null, now: number) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / DAY) : null);

/** Bewertung aller Stufen einer Karte/Variante. */
export function computeValuation(input: ValuationInput, now = Date.now()): TierValuation[] {
  const ref = input.reference && input.reference > 0 ? input.reference : null;
  const refAt = input.referenceAt ? new Date(input.referenceAt).toISOString() : null;
  const out: TierValuation[] = [];

  // --- NM zuerst: Grundlage für die Abschläge der übrigen Rohstufen, falls die Referenz fehlt
  const ebay = recentPrices(input.ebayRaw, now);
  const ebayMed = ebay.prices.length ? median(ebay.prices)! * EBAY_RAW_NM_FACTOR : null;
  const psByTier = new Map<RawTier, Sale[]>();
  for (const s of input.pokeswipe) {
    const t = tierOfCondition(s.condition);
    if (t) psByTier.set(t, [...(psByTier.get(t) || []), s]);
  }

  let nmValue: number | null = null;
  for (const tier of RAW_TIERS) {
    const ps = recentPrices(psByTier.get(tier) || [], now);
    const psMed = ps.prices.length ? median(ps.prices)! : null;
    const factor = TIER_FACTORS[tier];
    const tierRef = ref ? ref * factor : nmValue && tier !== "nm" ? nmValue * factor : null;
    const parts: Part[] = [];
    if (tierRef) parts.push({ src: ref ? "cardmarket" : "derived", value: tierRef, weight: ref ? 1 : 0.6, n: 0 });
    if (tier === "nm" && ebayMed) {
      parts.push({ src: "ebay", value: ebayMed, weight: Math.min(MAX_SALE_WEIGHT.ebay, ebay.prices.length * SALE_WEIGHT.ebay) * plausibility(ebayMed, ref), n: ebay.prices.length });
    }
    if (psMed) {
      parts.push({ src: "pokeswipe", value: psMed, weight: Math.min(MAX_SALE_WEIGHT.pokeswipe, ps.prices.length * SALE_WEIGHT.pokeswipe) * plausibility(psMed, tierRef), n: ps.prices.length });
    }
    const { value, sources } = blend(parts);
    const salePrices = [...(tier === "nm" ? ebay.prices.map((p) => p * EBAY_RAW_NM_FACTOR) : []), ...ps.prices].sort((a, b) => a - b);
    const sales = parts.filter((p) => p.src === "ebay" || p.src === "pokeswipe").reduce((s, p) => s + p.n, 0);
    const saleMed = salePrices.length ? median(salePrices) : null;
    const dataAt = latest(refAt, tier === "nm" ? ebay.newest : null, ps.newest);
    if (tier === "nm") nmValue = value;
    out.push({
      tier, value,
      low: salePrices.length >= 2 ? round2(salePrices[0]) : value !== null ? round2(value * 0.85) : null,
      high: salePrices.length >= 2 ? round2(salePrices[salePrices.length - 1]) : value !== null ? round2(value * 1.15) : null,
      confidence: value === null ? 0 : confidenceScore({
        hasReference: Boolean(tierRef), sales, ageDays: ageDays(dataAt, now),
        agreement: saleMed && tierRef ? saleMed / tierRef : null,
      }) - (tier === "nm" || sales ? 0 : 10),
      sampleSize: sales, sources,
      basis: value === null ? "none" : !sales ? "reference" : ((sources.cardmarket || 0) + (sources.derived || 0)) > 0.25 ? "blend" : "sales",
      dataAt,
    });
  }

  // --- Graded: nur echte Verkäufe bzw. Angebote, keine Schätzung aus dem Rohpreis
  for (const tier of GRADED_TIERS) {
    const sold = recentPrices(input.ebayGraded[tier] || [], now);
    const gv = input.gradeValues[tier];
    const parts: Part[] = [];
    if (sold.prices.length) parts.push({ src: "ebay", value: median(sold.prices)!, weight: Math.min(3, sold.prices.length * 0.5), n: sold.prices.length });
    if (gv?.median90 && gv.median90 > 0 && gv.sample90 > 0) parts.push({ src: "graded", value: gv.median90, weight: Math.min(2, gv.sample90 * 0.3), n: gv.sample90 });
    let { value, sources } = blend(parts);
    let basis: TierValuation["basis"] = value !== null ? "sales" : "none";
    if (value === null && gv?.askLow && gv.askLow > 0) { value = round2(gv.askLow); sources = { graded: 1 }; basis = "ask"; }
    const n = parts.reduce((s, p) => s + p.n, 0);
    const dataAt = latest(sold.newest, gv?.updatedAt ?? null);
    out.push({
      tier, value,
      low: sold.prices.length >= 2 ? round2(sold.prices[0]) : null,
      high: sold.prices.length >= 2 ? round2(sold.prices[sold.prices.length - 1]) : null,
      confidence: value === null ? 0 : basis === "ask" ? 20 : confidenceScore({ hasReference: false, sales: n, ageDays: ageDays(dataAt, now), agreement: null }),
      sampleSize: n, sources, basis, dataAt,
    });
  }
  return out.map((v) => ({ ...v, confidence: Math.max(0, v.confidence) }));
}

/** Veränderung in Prozent (gerundet auf 0,1) – null, wenn eine Seite fehlt. */
export function pctChange(now: number | null | undefined, before: number | null | undefined): number | null {
  const a = Number(now), b = Number(before);
  if (!(a > 0) || !(b > 0)) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

/**
 * Trend einer Stufe: bevorzugt der eigene Verlauf (market_valuation_history), sonst die Cardmarket-Mittelwerte
 * (7/30 Tage) der Referenz – so gibt es auch ohne TCGdex-Verbindung eine Trendangabe.
 */
export function trendFor(current: number | null, history: { day: string; value: number }[], fallback: { avg7?: number | null; avg30?: number | null } = {}, now = Date.now()) {
  const at = (days: number) => {
    const target = now - days * DAY;
    // jüngster Eintrag, der mindestens `days` Tage alt ist (Toleranz 2 Tage)
    const old = history.filter((h) => new Date(h.day).getTime() <= target + DAY).sort((a, b) => b.day.localeCompare(a.day))[0];
    return old && new Date(old.day).getTime() >= target - 2 * DAY ? old.value : null;
  };
  return {
    trend7: pctChange(current, at(7)) ?? pctChange(current, fallback.avg7),
    trend30: pctChange(current, at(30)) ?? pctChange(current, fallback.avg30),
  };
}

/** „Zuletzt aktualisiert“ in Worten (für Oberfläche und Seiten). */
export function freshnessLabel(iso: string | Date | null | undefined, now = Date.now()) {
  if (!iso) return "unbekannt";
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 2) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  if (m < 48 * 60) return `vor ${Math.round(m / 60)} Std.`;
  return `vor ${Math.round(m / 1440)} Tagen`;
}

/** Ab wann gilt ein gespeicherter Preis als veraltet (Anzeige-Hinweis, kein Fehler)? */
export const STALE_AFTER_MS = 36 * 3600_000;
export const isStale = (iso: string | Date | null | undefined, now = Date.now()) => !iso || now - new Date(iso).getTime() > STALE_AFTER_MS;
