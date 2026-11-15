// Phase 6: gemeinsame Auswahlfelder für Kartenvariante und Zustand (Portfolio, Inserat, Import)
import { esc } from "./core.js";

export const VARIANT_LABEL = { normal: "Normal", reverse_holo: "Reverse Holo", holo: "Holo", first_edition: "1st Edition", shadowless: "Shadowless", promo: "Promo" };
export const VARIANT_KEYS = Object.keys(VARIANT_LABEL);
/** Portfolio-Zustände (Cardmarket-Skala) */
export const CONDITION_LABEL = { M: "Mint", NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Light Played", PL: "Played", PO: "Poor" };

/** TCGdex-Variantenfeld („normal,reverse,holo,firstEdition“) → Variantenschlüssel; leer = alle anbieten. */
export function variantsOf(field) {
  const map = { normal: "normal", reverse: "reverse_holo", holo: "holo", firstEdition: "first_edition", wPromo: "promo" };
  const list = String(field || "").split(",").map((s) => map[s.trim()]).filter(Boolean);
  return list.length ? VARIANT_KEYS.filter((k) => list.includes(k)) : VARIANT_KEYS;
}

const selCls = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white";
export function variantSelect(id, keys = VARIANT_KEYS, selected = "normal") {
  const opts = keys.length ? keys : VARIANT_KEYS;
  const sel = opts.includes(selected) ? selected : opts[0];
  return `<select id="${esc(id)}" class="${selCls}" aria-label="Variante">${opts.map((k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(VARIANT_LABEL[k])}</option>`).join("")}</select>`;
}
export function conditionSelect(id, selected = "NM") {
  return `<select id="${esc(id)}" class="${selCls}" aria-label="Zustand">${Object.entries(CONDITION_LABEL).map(([k, l]) => `<option value="${k}" ${k === selected ? "selected" : ""}>${esc(l)} (${k})</option>`).join("")}</select>`;
}
export const variantBadge = (v) => (v && v !== "normal" ? `<span class="text-[9px] font-black bg-purple-500/30 text-purple-100 px-1.5 rounded">${esc(VARIANT_LABEL[v] || v)}</span>` : "");
