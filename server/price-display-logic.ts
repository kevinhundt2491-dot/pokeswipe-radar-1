// PokeSwipe & Radar – eine Preisquelle für Swipe-Karte, Preis-Etikett, Mittelzeile und Kauf-Knopf.
//
// Regeln (gleich im Browser und auf dem Server):
//   • Marktwert = Cardmarket-Trend (bzw. TCGplayer-Marktpreis in €, wenn Cardmarket fehlt).
//   • „Kaufen ab …“ und „X % unter Markt“ NUR mit einem verifizierten Live-Angebot für genau diese Karte:
//       – aktives eBay-Sofortkauf-Angebot aus dem Flip-Radar (Rohkarte, nicht verdächtig, in den letzten 36 h gesehen) oder
//       – Sofort-Kauf-Inserat eines PokeSwipe-Verkäufers (inkl. Versand).
//     Der Cardmarket-„ab“-Preis ist KEIN verifiziertes Angebot: Er ist der billigste Artikel über alle Zustände/Sprachen
//     hinweg, wird nur alle paar Tage aktualisiert und existiert oft nicht mehr (→ früher „ab 0,99 €“ bei 2,54 € Trend).
//   • Rabatt = ((Marktwert − Angebot) / Marktwert) × 100, gerundet. Nur > 0, wenn das Angebot wirklich günstiger ist.
//   • Kein günstigeres verifiziertes Angebot → Marktwert anzeigen, Knopf „Auf eBay / Cardmarket suchen (Marktwert)“.

export type OfferSource = "ebay" | "pokeswipe";
export type PriceDisplayInput = { market?: number | null; offer?: number | null; offerSource?: string | null };
export type PriceDisplay = {
  mode: "offer" | "market" | "none";
  market: number | null;
  offer: number | null;
  offerSource: OfferSource | null;
  /** Rabatt des verifizierten Angebots gegenüber dem Marktwert (0, wenn nicht günstiger). */
  dealPct: number;
  /** Preis auf dem Etikett (Kartenbild) – identisch mit dem Kauf-Knopf. */
  tagPrice: number | null;
  tagLabel: "ab" | "Markt" | "";
  buttonLabel: string;
};

const pos = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

export const fmtEur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Rabatt in Prozent: ((Trend − Angebot) / Trend) × 100, nur wenn das Angebot echt günstiger ist. */
export function discountVsMarket(market: unknown, offer: unknown): number {
  const m = pos(market), o = pos(offer);
  if (m == null || o == null || o >= m) return 0;
  return Math.max(0, Math.round(((m - o) / m) * 100));
}

export function priceDisplay({ market, offer, offerSource }: PriceDisplayInput): PriceDisplay {
  const m = pos(market);
  const o = pos(offer);
  const src: OfferSource | null = o == null ? null : offerSource === "pokeswipe" ? "pokeswipe" : "ebay";
  const dealPct = discountVsMarket(m, o);
  // Verifiziertes Angebot günstiger als der Markt – oder es gibt keinen Marktwert, aber ein echtes Angebot
  if (o != null && (dealPct > 0 || m == null)) {
    return { mode: "offer", market: m, offer: o, offerSource: src, dealPct, tagPrice: o, tagLabel: "ab", buttonLabel: `🛒 Kaufen ab ${fmtEur(o)}` };
  }
  if (m != null) {
    return {
      mode: "market", market: m, offer: o, offerSource: src, dealPct: 0, tagPrice: m, tagLabel: "Markt",
      buttonLabel: `🔎 Auf eBay / Cardmarket suchen (${fmtEur(m)})`,
    };
  }
  return { mode: "none", market: null, offer: null, offerSource: null, dealPct: 0, tagPrice: null, tagLabel: "", buttonLabel: "🔎 Auf eBay / Cardmarket suchen" };
}
