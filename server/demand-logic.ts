// Marktplatz füllen – reine Logik ohne Datenbank (gut testbar).
//
// „Gesucht aus deiner Sammlung“: Karten aus dem eigenen Portfolio, die andere Sammler auf ihrer Wunschliste haben
// und die noch niemand (auch man selbst nicht) aktiv anbietet. Das sind die Inserate mit der höchsten Chance auf
// einen schnellen Verkauf – und genau die fehlen einem leeren Marktplatz.
import { roundPrice } from "./quick-list-logic.ts";

export type DemandRow = {
  portfolioItemId: number;
  cardId: string;
  name: string;
  image: string;
  setName: string;
  condition: string;
  variant: string;
  lang: string;
  printId: string | null;
  quantity: number;
  wishers: number;
  /** höchster Wunschpreis der Suchenden (null = mindestens einer hat keine Grenze gesetzt bzw. keiner hat eine gesetzt) */
  maxPrice: number | null;
  /** Marktwert der Karte (Cardmarket-Trend/-Durchschnitt) */
  market: number | null;
  /** günstigstes aktives fremdes Inserat */
  activeLow: number | null;
  /** eigenes aktives Inserat zur Karte vorhanden */
  listed: boolean;
};

/** Passt die gesuchte Variante zum Sammlungs-Eintrag? ("" = jede Variante) */
export function variantMatches(wanted: unknown, owned: unknown): boolean {
  const w = String(wanted ?? "");
  return !w || w === String(owned || "normal");
}

/**
 * Preisvorschlag, mit dem die Karte schnell an einen der Suchenden geht:
 * Marktwert als Basis, knapp unter dem günstigsten fremden Inserat, aber nie über dem höchsten Wunschpreis,
 * solange dieser mindestens 70 % des Marktwerts beträgt (sonst wäre der Verkauf ein Verlustgeschäft).
 */
export function demandPrice(r: Pick<DemandRow, "market" | "maxPrice" | "activeLow">): number | null {
  const market = r.market && r.market > 0 ? r.market : null;
  const max = r.maxPrice && r.maxPrice > 0 ? r.maxPrice : null;
  let p = market ?? max;
  if (!p) return null;
  if (r.activeLow && r.activeLow > 0 && r.activeLow < p) p = r.activeLow * 0.98;
  if (max && p > max && (!market || max >= market * 0.7)) p = max;
  const v = roundPrice(p);
  return v > 0 ? v : null;
}

/** Reihenfolge: viele Suchende vor wenigen, dann höherer Wert (lohnt sich am meisten). Bereits Inseriertes fällt raus. */
export function rankDemand<T extends DemandRow>(list: T[], limit = 30): (T & { suggestedPrice: number | null })[] {
  return list
    .filter((r) => !r.listed && r.wishers > 0)
    .map((r) => ({ ...r, suggestedPrice: demandPrice(r) }))
    .sort((a, b) => b.wishers - a.wishers || (b.suggestedPrice ?? 0) - (a.suggestedPrice ?? 0) || a.portfolioItemId - b.portfolioItemId)
    .slice(0, limit);
}

/** Text der Benachrichtigung für Sammler mit gesuchten Karten. */
export function demandDigestText(n: number, top: { name: string; wishers: number }[]): { title: string; body: string } {
  const first = top[0];
  const title = n === 1 ? `🔥 Deine Karte ${first?.name || ""} wird gesucht` : `🔥 ${n} Karten aus deiner Sammlung werden gesucht`;
  const names = top.slice(0, 3).map((t) => `${t.name} (${t.wishers}× gesucht)`).join(", ");
  return { title: title.trim(), body: `${names}. Mit einem Tipp inserieren – der faire Preis ist schon eingetragen.` };
}
