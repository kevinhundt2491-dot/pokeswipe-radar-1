// Schnell-Inserieren aus dem Scanner – reine Logik ohne Datenbank (gut testbar).
//
// Preisvorschlag je Karte:
//  • fair  = Marktwert im gewählten Zustand (eigene Preis-Pipeline: Cardmarket-Referenz + eBay- und PokeSwipe-Verkäufe)
//  • quick = etwas unter fair und – wenn sinnvoll – knapp unter dem günstigsten fremden Inserat, damit die Karte schnell weggeht
// Preise werden auf „glatte“ Beträge gerundet (kleine Karten auf 5 ct, teure auf ganze Euro).
import { TIER_FACTORS, tierOfCondition, type RawTier } from "./valuation-logic.ts";

/** Schritte für glatte Preise */
export function roundPrice(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const step = v < 2 ? 0.05 : v < 20 ? 0.1 : v < 100 ? 0.5 : 1;
  const r = Math.round(v / step) * step;
  return Math.max(0.05, Math.round(r * 100) / 100);
}

/** Stufe zum Listing-Zustand (unbekannt, Slab oder Sealed → NM-Wert als Basis) */
export function tierFor(condition: unknown): RawTier {
  return tierOfCondition(condition) ?? "nm";
}

/** Abschlag relativ zu NM für den gewählten Zustand */
export function conditionFactor(condition: unknown): number {
  return TIER_FACTORS[tierFor(condition)] ?? 1;
}

export type SuggestInput = {
  /** Wert im gewählten Zustand (aus der Bewertung), falls vorhanden */
  tierValue: number | null;
  tierLow?: number | null;
  tierHigh?: number | null;
  /** NM-/Referenzpreis als Rückfall (wird mit dem Zustandsfaktor verrechnet) */
  reference: number | null;
  condition?: unknown;
  /** günstigstes aktives Inserat anderer Verkäufer (gleiche Karte) */
  activeLow?: number | null;
};

export type Suggestion = { fair: number | null; quick: number | null; low: number | null; high: number | null; basis: "valuation" | "reference" | "none" };

export function suggestPrice(i: SuggestInput): Suggestion {
  const factor = conditionFactor(i.condition);
  let fair: number | null = null, basis: Suggestion["basis"] = "none";
  if (i.tierValue && i.tierValue > 0) { fair = i.tierValue; basis = "valuation"; }
  else if (i.reference && i.reference > 0) { fair = i.reference * factor; basis = "reference"; }
  if (fair === null) return { fair: null, quick: null, low: null, high: null, basis };
  const fairR = roundPrice(fair);
  // Schnell verkaufen: 8 % unter fair – liegt ein fremdes Inserat dazwischen, knapp darunter (aber nie unter 85 % von fair)
  let quick = fair * 0.92;
  const al = Number(i.activeLow);
  if (al > 0 && al < fair && al > fair * 0.85) quick = Math.min(quick, al * 0.98);
  quick = Math.max(quick, fair * 0.85);
  const quickR = Math.min(roundPrice(quick), fairR);
  const low = i.tierLow && i.tierLow > 0 ? roundPrice(i.tierLow) : basis === "reference" ? roundPrice(fair * 0.85) : null;
  const high = i.tierHigh && i.tierHigh > 0 ? roundPrice(i.tierHigh) : basis === "reference" ? roundPrice(fair * 1.15) : null;
  return { fair: fairR, quick: quickR, low, high, basis };
}
