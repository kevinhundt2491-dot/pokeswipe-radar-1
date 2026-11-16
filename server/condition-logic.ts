// Phase 8: Preise nach Zustand und Verkaufspreise (Sold Comps) aus dem eigenen Marktplatz – reine Logik ohne Datenbank.
//
// Quellen je Zustand (Mint … Poor), jeweils pro Karte und Variante:
//  1. Abgeschlossene Verkäufe auf PokeSwipe (Auszahlung an den Verkäufer erfolgt, nicht erstattet) – 90 Tage.
//  2. Aktuelle Angebote im Marktplatz (günstigstes Angebot und Anzahl).
//  3. Referenzwert: Cardmarket-Trend (Near Mint) × marktüblicher Zustandsfaktor.
// Der „Zustandswert“ nutzt echte Verkäufe, sobald genug vorliegen, und mischt bei wenigen Verkäufen mit der Referenz.
// Alle Verkaufs- und Angebotspreise verstehen sich inkl. (anteiligem) Versand – wie bei den eBay-Comps im Flip-Radar.
import { median, trimOutliers, round2 } from "./flip-logic.ts";
import { CONDITION_FACTORS, normalizeVariant, type Variant } from "./variant-logic.ts";

/** Zustände des Marktplatzes (Schlüssel wie listings.condition) in absteigender Qualität. */
export const MARKET_CONDITIONS = ["mint", "nm", "ex", "gd", "lp", "pl", "po"] as const;
export type MarketCondition = (typeof MARKET_CONDITIONS)[number];

export const CONDITION_SHORT: Record<MarketCondition, string> = { mint: "MT", nm: "NM", ex: "EX", gd: "GD", lp: "LP", pl: "PL", po: "PO" };

/** Faktor relativ zum Near-Mint-Trend (gleiche Werte wie im Portfolio, siehe variant-logic.ts). */
export const MARKET_CONDITION_FACTORS: Record<MarketCondition, number> = {
  mint: CONDITION_FACTORS.M, nm: CONDITION_FACTORS.NM, ex: CONDITION_FACTORS.EX, gd: CONDITION_FACTORS.GD,
  lp: CONDITION_FACTORS.LP, pl: CONDITION_FACTORS.PL, po: CONDITION_FACTORS.PO,
};

/** Ab so vielen Verkäufen gilt der Verkaufsmedian allein; darunter wird mit der Referenz gemischt. */
export const CONDITION_MIN_SALES = 3;

/** Normalisiert Zustandsangaben aus Inseraten, Portfolio (NM/EX …) und Altdaten; null = kein Rohkarten-Zustand. */
export function marketCondition(input: unknown): MarketCondition | null {
  const raw = String(input ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!raw) return null;
  const map: Record<string, MarketCondition> = {
    mint: "mint", m: "mint", mt: "mint", nm: "nm", nearmint: "nm", nmm: "nm", ex: "ex", excellent: "ex",
    gd: "gd", good: "gd", lp: "lp", lightplayed: "lp", pl: "pl", played: "pl", po: "po", poor: "po",
  };
  return map[raw] ?? null;
}

/** Rangfolge (0 = bester Zustand); unbekannt → ans Ende. */
export const conditionRank = (c: unknown) => {
  const k = marketCondition(c);
  return k ? MARKET_CONDITIONS.indexOf(k) : MARKET_CONDITIONS.length;
};

/** Ist Zustand a mindestens so gut wie b? (für den Warenkorb-Optimierer und Wunschlisten-Filter) */
export const atLeastCondition = (a: unknown, b: unknown) => conditionRank(a) <= conditionRank(b);

export type SalePoint = { price: number; soldAt: Date | string };
export type AskPoint = { price: number };

export type ConditionRow = {
  condition: MarketCondition;
  short: string;
  /** Bester Schätzwert für diesen Zustand */
  value: number | null;
  valueSource: "sales" | "blend" | "reference" | "asks" | "none";
  soldMedian90: number | null;
  soldCount90: number;
  soldLow90: number | null;
  soldHigh90: number | null;
  lastSoldPrice: number | null;
  lastSoldAt: string | null;
  askLow: number | null;
  askCount: number;
  reference: number | null;
  factor: number;
};

/**
 * Verdichtet Verkäufe und Angebote eines Zustands.
 * nmRef = Near-Mint-Marktpreis der Variante (Cardmarket-Trend), 0/null = unbekannt.
 */
export function summarizeCondition(condition: MarketCondition, sales: SalePoint[], asks: AskPoint[], nmRef: number | null, now = new Date()): ConditionRow {
  const since = now.getTime() - 90 * 86400_000;
  const recent = sales.filter((s) => new Date(s.soldAt).getTime() >= since && s.price > 0)
    .sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());
  const clean = trimOutliers(recent.map((s) => s.price));
  const soldMedian = clean.length ? round2(median(clean)!) : null;
  const askPrices = asks.map((a) => a.price).filter((p) => p > 0).sort((a, b) => a - b);
  const factor = MARKET_CONDITION_FACTORS[condition];
  const reference = nmRef && nmRef > 0 ? round2(nmRef * factor) : null;

  let value: number | null = null;
  let valueSource: ConditionRow["valueSource"] = "none";
  if (soldMedian !== null && clean.length >= CONDITION_MIN_SALES) {
    value = soldMedian; valueSource = "sales";
  } else if (soldMedian !== null && reference !== null) {
    // Wenige Verkäufe: jeder Verkauf zählt ein Drittel, der Rest kommt aus der Referenz
    const w = Math.min(1, clean.length / CONDITION_MIN_SALES);
    value = round2(soldMedian * w + reference * (1 - w)); valueSource = "blend";
  } else if (soldMedian !== null) {
    value = soldMedian; valueSource = "sales";
  } else if (reference !== null) {
    value = reference; valueSource = "reference";
  } else if (askPrices.length) {
    value = askPrices[0]; valueSource = "asks";
  }
  return {
    condition, short: CONDITION_SHORT[condition], value, valueSource,
    soldMedian90: soldMedian, soldCount90: recent.length,
    soldLow90: clean.length ? round2(clean[0]) : null, soldHigh90: clean.length ? round2(clean[clean.length - 1]) : null,
    lastSoldPrice: recent[0] ? round2(recent[0].price) : null,
    lastSoldAt: recent[0] ? new Date(recent[0].soldAt).toISOString() : null,
    askLow: askPrices.length ? round2(askPrices[0]) : null, askCount: askPrices.length,
    reference, factor,
  };
}

/** Tabelle über alle Zustände; Zeilen ohne jede Information werden weggelassen (außer NM). */
export function conditionTable(
  sales: Array<SalePoint & { condition: unknown }>,
  asks: Array<AskPoint & { condition: unknown }>,
  nmRef: number | null,
  now = new Date(),
): ConditionRow[] {
  return MARKET_CONDITIONS.map((cond) => summarizeCondition(
    cond,
    sales.filter((s) => marketCondition(s.condition) === cond),
    asks.filter((a) => marketCondition(a.condition) === cond),
    nmRef, now,
  )).filter((r) => r.condition === "nm" || r.soldCount90 > 0 || r.askCount > 0 || r.reference !== null);
}

/** Beobachteter Abschlag je Zustand gegenüber NM aus eigenen Verkäufen (nur mit genug Daten auf beiden Seiten). */
export function observedDiscount(rows: ConditionRow[]): Partial<Record<MarketCondition, number>> {
  const nm = rows.find((r) => r.condition === "nm");
  const out: Partial<Record<MarketCondition, number>> = {};
  if (!nm?.soldMedian90 || nm.soldCount90 < CONDITION_MIN_SALES) return out;
  for (const r of rows) {
    if (r.condition === "nm" || !r.soldMedian90 || r.soldCount90 < CONDITION_MIN_SALES) continue;
    out[r.condition] = Math.round((r.soldMedian90 / nm.soldMedian90) * 100) / 100;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verkaufsdaten aus abgeschlossenen Bestellungen
// ---------------------------------------------------------------------------
export type SaleLine = {
  itemKey: string; // eindeutig je Position (order_items.id bzw. "listing")
  cardId: string | null;
  printId?: string | null;
  sealedProductId?: number | null;
  title: string;
  variant: string;
  condition: string;
  lang: string;
  quantity: number;
  unitCents: number;
};

export type CompRow = {
  externalId: string; source: "pokeswipe"; targetKind: "card" | "print" | "sealed"; targetId: string;
  gradeKey: "raw"; grade: string; lang: string | null; title: string; price: string; soldAt: Date; url: string;
  variant: Variant; condition: string; marketOrderId: number;
};

/**
 * Baut die Comps einer abgeschlossenen Teilbestellung: ein Eintrag je Position mit dem Stückpreis inkl. anteiligem
 * Versand (Versand der Sendung gleichmäßig auf alle Stücke verteilt). Gegradete Karten (Slabs) werden übersprungen –
 * ihr Wert hängt an der Note, nicht am Rohkarten-Zustand.
 */
export function compsFromOrder(order: { id: number; shippingCents: number; releasedAt: Date | string | null; createdAt?: Date | string }, lines: SaleLine[], site = ""): CompRow[] {
  const units = lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  if (!units) return [];
  const shipPerUnit = Math.max(0, order.shippingCents) / units;
  const soldAt = new Date(order.releasedAt || order.createdAt || Date.now());
  const out: CompRow[] = [];
  for (const l of lines) {
    if (l.quantity <= 0 || l.unitCents <= 0) continue;
    const cond = String(l.condition || "").toLowerCase();
    if (cond === "graded") continue;
    let targetKind: CompRow["targetKind"], targetId: string;
    if (l.sealedProductId) { targetKind = "sealed"; targetId = String(l.sealedProductId); }
    else if (l.printId) { targetKind = "print"; targetId = l.printId; }
    else if (l.cardId) { targetKind = "card"; targetId = l.cardId; }
    else continue;
    const price = (l.unitCents + shipPerUnit) / 100;
    const condKey = cond === "sealed" ? "sealed" : marketCondition(cond) || "";
    out.push({
      externalId: `ps:${order.id}:${l.itemKey}`, source: "pokeswipe", targetKind, targetId, gradeKey: "raw",
      grade: condKey ? (condKey === "sealed" ? "Sealed" : CONDITION_SHORT[condKey as MarketCondition]) : "",
      lang: l.lang || null, title: String(l.title || "").slice(0, 200), price: price.toFixed(2), soldAt,
      url: targetKind === "card" && site ? `${site}/karte/${encodeURIComponent(targetId)}` : "",
      variant: normalizeVariant(l.variant), condition: condKey, marketOrderId: order.id,
    });
  }
  return out;
}
