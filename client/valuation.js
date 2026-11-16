// PokeSwipe & Radar – Phase 9: Marktwert nach Zustand (NM … Damaged) und Graded-Stufen (PSA 8/9/10)
// aus der eigenen Preis-Pipeline. Die Werte kommen immer aus der PokeSwipe-Datenbank – fällt die externe
// Preisquelle aus, bleibt alles sichtbar, nur mit Zeitstempel „Zuletzt aktualisiert“.
import { $, esc, eur, api, jsArg } from "./core.js";

const SOURCE_LABEL = { cardmarket: "Cardmarket", ebay: "eBay-Verkäufe", pokeswipe: "PokeSwipe-Verkäufe", graded: "Graded-Comps", derived: "abgeleitet" };

const trendTxt = (v) => (v === null || v === undefined ? "" : `<span class="${v >= 0 ? "text-emerald-400" : "text-rose-400"} font-bold">${v > 0 ? "+" : ""}${String(v).replace(".", ",")} %</span>`);
const confDots = (c) => {
  const n = c >= 75 ? 3 : c >= 45 ? 2 : c > 0 ? 1 : 0;
  return `<span title="Datenlage ${Number(c) || 0}/100" class="tracking-tighter">${"●".repeat(n)}<span class="text-slate-700">${"●".repeat(3 - n)}</span></span>`;
};

function row(t) {
  const srcs = Object.entries(t.sources || {}).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${SOURCE_LABEL[k] || k} ${Math.round(w * 100)} %`).join(" · ");
  return `<tr class="border-t border-slate-800">
    <td class="py-1 pr-2 font-black text-white whitespace-nowrap" title="${esc(t.label)}">${esc(t.short)}</td>
    <td class="py-1 pr-2 font-black ${t.value ? "text-emerald-300" : "text-slate-500"}">${t.value ? eur(t.value) : "–"}</td>
    <td class="py-1 pr-2 text-slate-400 hidden sm:table-cell">${t.low && t.high && t.low !== t.high ? `${eur(t.low)} – ${eur(t.high)}` : ""}</td>
    <td class="py-1 pr-2">${trendTxt(t.trend30 ?? t.trend7)}</td>
    <td class="py-1 pr-2 text-yellow-300 text-[10px]">${confDots(t.confidence)}</td>
    <td class="py-1 text-[10px] text-slate-500 truncate max-w-[9rem]" title="${esc(srcs)}">${t.sampleSize ? `${Number(t.sampleSize)} Verk.` : t.value ? (t.tier.startsWith("psa") ? "Angebot" : "Referenz") : ""}</td>
  </tr>`;
}

export function valuationHtml(v) {
  if (!v) return "";
  const graded = v.graded.filter((t) => t.value);
  return `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="font-black text-white">📊 Marktwert nach Zustand${v.variant !== "normal" ? ` · ${esc(v.variantLabel)}` : ""}</p>
      <p class="text-[10px] ${v.stale || v.degraded ? "text-amber-300" : "text-slate-500"}">🕒 Zuletzt aktualisiert: ${esc(v.freshness)}${v.degraded ? " · Live-Quelle gerade nicht erreichbar – Werte aus der PokeSwipe-Datenbank" : ""}</p>
    </div>
    ${v.variants.length > 1 ? `<div class="flex gap-1">${v.variants.map((x) => `<button type="button" onclick="PS.loadValuation(${jsArg(v.cardId)}, ${jsArg(x)})" class="text-[10px] font-black px-2 py-0.5 rounded-full ${x === v.variant ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${x === "normal" ? "Normal" : "Reverse Holo"}</button>`).join("")}</div>` : ""}
    <table class="w-full text-left"><tbody>${v.raw.map(row).join("")}</tbody></table>
    <p class="font-black text-purple-300 pt-1">💎 Graded</p>
    ${graded.length ? `<table class="w-full text-left"><tbody>${v.graded.map(row).join("")}</tbody></table>`
      : `<p class="text-slate-500">Noch keine echten PSA-Verkäufe erfasst – wir schätzen Graded-Preise bewusst nicht.</p>`}
    <p class="text-[10px] text-slate-500">Kombiniert aus Cardmarket-Referenz, eBay-Verkäufen und verifizierten PokeSwipe-Transaktionen (Treuhand). ●●● = viele aktuelle Verkäufe.</p>
  </div>`;
}

/** Lädt die Bewertung in einen Platzhalter (Standard: Kartenansicht). Fehler bleiben still – der Rest der Ansicht funktioniert weiter. */
export async function loadValuation(cardId, variant = "", slotId = "ps-card-valuation") {
  const slot = $(slotId);
  if (!slot) return;
  try {
    const v = await api(`/api/cards/${encodeURIComponent(cardId)}/valuation${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`);
    if ($(slotId) === slot) slot.innerHTML = valuationHtml(v);
  } catch {
    slot.innerHTML = "";
  }
}

export const valuationApi = { loadValuation };
