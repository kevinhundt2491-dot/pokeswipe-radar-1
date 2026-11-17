// PokeSwipe & Radar – Preis-Etikett für gescannte Karten, Inserate und den Swipe-Stapel.
// Ein Etikett zeigt auf einen Blick: Preis, Zustand und wie fair der Preis im Vergleich zum Marktwert ist.
import { esc, eur } from "./core.js";

/** Zustand: Kurzform fürs Etikett, Langform für Hinweise, Farbe als Ampel (Mint/NM grün … Poor rot). */
export const CONDITION_INFO = {
  mint: { short: "Mint", label: "Mint – wie neu, perfekt zentriert", cls: "bg-emerald-400 text-slate-950" },
  nm: { short: "NM", label: "Near Mint – praktisch neuwertig", cls: "bg-emerald-400 text-slate-950" },
  ex: { short: "EX", label: "Excellent – minimale Spuren", cls: "bg-lime-300 text-slate-950" },
  gd: { short: "GD", label: "Good – leichte Gebrauchsspuren", cls: "bg-yellow-300 text-slate-950" },
  lp: { short: "LP", label: "Light Played – sichtbare Spuren", cls: "bg-amber-400 text-slate-950" },
  pl: { short: "PL", label: "Played – deutliche Spuren", cls: "bg-orange-500 text-white" },
  po: { short: "PO", label: "Poor – stark bespielt", cls: "bg-rose-500 text-white" },
  graded: { short: "Slab", label: "Gegradet (Slab)", cls: "bg-purple-400 text-slate-950" },
  sealed: { short: "OVP", label: "Originalverpackt", cls: "bg-sky-300 text-slate-950" },
};

/**
 * Preis-Ampel im Vergleich zum Marktwert (Cardmarket-Trend bzw. fairer Wert).
 * Unter 0,5 € Marktwert ist der Abstand reines Rauschen – dann keine Bewertung.
 */
export function dealRating(price, market) {
  const p = Number(price), m = Number(market);
  if (!(p > 0) || !(m >= 0.5)) return null;
  const pct = Math.round(((m - p) / m) * 100);
  if (pct >= 15) return { tone: "deal", pct, label: `🔥 ${pct} % unter Markt`, cls: "bg-emerald-400 text-slate-950" };
  if (pct >= -8) return { tone: "fair", pct, label: "⚖️ Fairer Preis", cls: "bg-sky-300 text-slate-950" };
  if (pct >= -25) return { tone: "high", pct, label: `▲ ${-pct} % über Markt`, cls: "bg-amber-400 text-slate-950" };
  return { tone: "steep", pct, label: `▲ ${-pct} % über Markt`, cls: "bg-rose-500 text-white" };
}

/**
 * Preis-Etikett als HTML. size: "sm" (Vorschaubild), "md" (Scanner-HUD) oder "lg" (Swipe-Karte).
 * opts: { price, market, condition, shippingCents, label, dealPct, note }
 * dealPct: bereits verifizierter Rabatt (z. B. echtes Live-Angebot vs. Cardmarket-Trend) – ersetzt die Ampel aus market.
 * note: kurze Quellenangabe unter dem Preis (z. B. „Live bei eBay“).
 */
export function priceTagHtml({ price, market = null, condition = "", shippingCents = 0, label = "", dealPct = 0, note = "" } = {}, size = "md") {
  const p = Number(price);
  if (!(p > 0)) return "";
  const cond = CONDITION_INFO[condition];
  const verifiedPct = Math.round(Number(dealPct) || 0);
  const deal = verifiedPct > 0
    ? { tone: "deal", pct: verifiedPct, label: `🔥 ${verifiedPct} % unter Markt`, cls: "bg-emerald-400 text-slate-950" }
    : dealRating(p, market);
  const big = size === "lg", small = size === "sm";
  const priceCls = big ? "text-xl sm:text-2xl" : small ? "text-[11px]" : "text-sm";
  const ship = Number(shippingCents) > 0 ? `+ ${eur(Number(shippingCents) / 100)} Versand` : "";
  return `<div class="ps-price-tag inline-flex flex-col items-start ${small ? "gap-0" : "gap-0.5"}" role="note" aria-label="Preis-Etikett">
    <span class="ps-price-tag-body relative inline-flex items-center ${small ? "gap-1 pl-3 pr-1.5 py-0.5" : "gap-1.5 pl-4 pr-2.5 py-1"} bg-yellow-300 text-slate-950 font-black shadow-lg">
      <span class="ps-price-tag-hole" aria-hidden="true"></span>
      ${label && !small ? `<span class="text-[9px] uppercase tracking-wide opacity-70">${esc(label)}</span>` : ""}
      <span class="${priceCls} leading-none">${eur(p)}</span>
      ${cond ? `<span class="${cond.cls} ${small ? "text-[8px] px-1" : "text-[10px] px-1.5"} rounded font-black leading-tight" title="${esc(cond.label)}">${esc(cond.short)}</span>` : ""}
    </span>
    ${!small && (deal || ship || note) ? `<span class="flex flex-wrap gap-1">
      ${deal ? `<span class="${deal.cls} text-[10px] font-black px-1.5 py-0.5 rounded-md shadow">${esc(deal.label)}</span>` : ""}
      ${note ? `<span class="bg-slate-950/85 text-slate-200 text-[10px] font-bold px-1.5 py-0.5 rounded-md">${esc(note)}</span>` : ""}
      ${ship ? `<span class="bg-slate-950/85 text-slate-200 text-[10px] font-bold px-1.5 py-0.5 rounded-md">${esc(ship)}</span>` : ""}
    </span>` : ""}
  </div>`;
}
