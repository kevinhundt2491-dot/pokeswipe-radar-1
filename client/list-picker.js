// PokeSwipe Radar – „Marktplatz → Meine Inserate“: schnell aus der eigenen Sammlung inserieren.
//   • 1-Klick „Alle Doppelten inserieren“: je Karte bleibt 1 Exemplar im Set-Ordner, alle überzähligen Exemplare gehen
//     nach kurzer Bestätigung mit Bild, gespeichertem Zustand (Standard: Near Mint) und Cardmarket-Preis online.
//     Bereits inserierte Doppelte werden erkannt und nicht erneut eingestellt.
//   • Kartenauswahl ohne Blättern: Suchleiste (Name, Sammlernummer, Set) + Chips „Alle“ | „Nur Doppelte“ | „Nach Set“.
// Reine Logik: server/duplicates-logic.ts (geprüft in tests/duplicates.test.ts).
import { $, esc, eur, cdn, state, api, toast, handleError, requireLogin, FALLBACK_IMG } from "./core.js";
import { loadMyListings } from "./sell.js";
import {
  ownedCards, duplicatePlan, dupeConfirmText, dupeListingPayloads, chunk, filterPickList, groupPickBySet, quantityBadge, PICK_FILTERS,
} from "../server/duplicates-logic.ts";

const pick = { query: "", filter: "all", busy: false, requested: false };
const MAX_TILES = 60;

const items = () => state.portfolio?.items || [];

function tileHtml(c) {
  const listedAll = c.spare > 0 && c.toList === 0;
  return `<button type="button" data-pick-card="${esc(c.key)}" onclick="PS.pickSell(${Number(c.portfolioItemId)})"
      class="relative text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-xl p-1.5 min-w-0"
      aria-label="${esc(`${c.name} ${c.number} inserieren`)}">
    <span class="relative block">
      <img src="${esc(cdn(c.image || FALLBACK_IMG, 160))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" class="w-full aspect-[63/88] object-contain rounded-md bg-slate-900" />
      ${c.quantity > 1 ? `<span class="ps-bslot-qty" data-pick-qty>${quantityBadge(c.quantity)}</span>` : ""}
      ${c.listed ? `<span class="absolute bottom-1 left-1 right-1 text-center text-[9px] font-black rounded bg-emerald-500 text-slate-950" data-pick-listed>${listedAll ? "✓ Doppelte inseriert" : `✓ ${c.listed} inseriert`}</span>` : ""}
    </span>
    <span class="block text-[10px] font-black text-white truncate mt-1">${esc(c.name)}</span>
    <span class="flex justify-between gap-1 text-[9px]"><span class="text-slate-400 truncate">${esc(c.number ? `#${c.number}` : "")}</span><span class="text-emerald-300 font-black">${c.unitValue ? eur(c.unitValue) : "–"}</span></span>
  </button>`;
}

function listHtml(list) {
  if (!list.length) {
    return `<p class="text-xs text-slate-400 text-center py-4" data-pick-empty>${items().length
      ? (pick.filter === "dupes" && !pick.query ? "Keine doppelten Karten in deiner Sammlung." : "Keine Karte passt zur Suche.")
      : "Noch keine Karten in deiner Sammlung – scanne eine Karte, sie landet automatisch im Set-Ordner."}</p>`;
  }
  const shown = list.slice(0, MAX_TILES);
  const grid = (cards) => `<div class="grid grid-cols-3 sm:grid-cols-5 gap-1.5">${cards.map(tileHtml).join("")}</div>`;
  const body = pick.filter === "set"
    ? groupPickBySet(shown).map((g) => `<p class="text-[10px] font-black uppercase text-slate-400 pt-1" data-pick-set="${esc(g.setId)}">${esc(g.setName)} · ${g.cards.length}</p>${grid(g.cards)}`).join("")
    : grid(shown);
  return body + (list.length > shown.length ? `<p class="text-[10px] text-slate-500 text-center pt-1">${list.length - shown.length} weitere – Suche verfeinern</p>` : "");
}

/** Gerüst: Massen-Button, Suche, Chips, Liste (Suche bleibt beim Tippen fokussiert – nur die Liste wird neu gezeichnet). */
export function listPickerHtml() {
  return `<section id="ps-list-picker" class="ps-card p-3 space-y-2" aria-label="Karte zum Inserieren auswählen">
    <button type="button" data-list-dupes onclick="PS.listAllDupes()" class="w-full bg-gradient-to-r from-amber-300 to-yellow-400 text-slate-950 font-black text-xs py-2.5 rounded-xl disabled:opacity-50">🏷️ Alle Doppelten inserieren</button>
    <p data-dupes-note class="text-[10px] text-slate-400 text-center"></p>
    <input id="ps-pick-search" type="search" value="${esc(pick.query)}" oninput="PS.pickSearch(this.value)" placeholder="🔍 Karte suchen: Name, Nummer oder Set" aria-label="Eigene Karten durchsuchen"
      class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" autocomplete="off" />
    <div class="flex gap-1.5" role="group" aria-label="Karten filtern">${PICK_FILTERS.map(([k, l]) => `<button type="button" class="ps-chip" data-pick-filter="${k}" aria-pressed="${pick.filter === k}" onclick="PS.pickFilter('${k}')">${l}</button>`).join("")}</div>
    <div data-pick-list class="max-h-96 overflow-y-auto overscroll-contain space-y-1.5 pr-0.5"></div>
  </section>`;
}

/** Liste + Massen-Button aktualisieren (nach Laden der Sammlung, Inseraten, Suche oder Filter). */
export function renderListPicker() {
  const root = $("ps-list-picker");
  if (!root) return;
  // Sammlung einmalig nachladen (kein Endlos-Nachladen, falls die Anfrage scheitert)
  if (state.user && !state.portfolio && !pick.requested) { pick.requested = true; window.PS?.loadPortfolio?.(); }
  const cards = ownedCards(items(), state.myListings || []);
  const list = root.querySelector("[data-pick-list]");
  if (list) list.innerHTML = listHtml(filterPickList(cards, pick.query, pick.filter));
  root.querySelectorAll("[data-pick-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pickFilter === pick.filter)));
  const plan = duplicatePlan(items(), state.myListings || []);
  const btn = root.querySelector("[data-list-dupes]");
  if (btn) {
    btn.textContent = plan.copies ? `🏷️ Alle Doppelten inserieren (${plan.copies})` : "🏷️ Alle Doppelten inserieren";
    btn.disabled = pick.busy;
  }
  const note = root.querySelector("[data-dupes-note]");
  if (note) {
    note.textContent = plan.copies
      ? `${plan.copies} überzählige Exemplare · ca. ${eur(plan.value)} – je 1 Exemplar bleibt in deinem Set-Ordner.`
      : plan.alreadyListed ? `✓ Alle ${plan.alreadyListed} Doppelten sind schon inseriert.` : "Keine doppelten Karten – je Karte bleibt 1 Exemplar im Set-Ordner.";
  }
}

/** 1-Klick: alle überzähligen Exemplare inserieren (immer 1 Exemplar im Set-Ordner behalten). */
async function listAllDupes() {
  if (!requireLogin() || pick.busy) return;
  pick.busy = true;
  renderListPicker();
  try {
    if (!state.portfolio) await window.PS?.loadPortfolio?.();
    // Frischer Stand der eigenen Inserate → schon inserierte Doppelte werden nicht erneut eingestellt
    await loadMyListings();
    const plan = duplicatePlan(items(), state.myListings || []);
    if (!plan.copies) {
      toast("🏷️ Nichts zu inserieren", plan.alreadyListed ? "Alle doppelten Karten sind bereits inseriert." : "Du hast gerade keine doppelten Karten mit Cardmarket-Preis.");
      return;
    }
    if (!window.confirm(dupeConfirmText(plan))) return;
    let created = 0, error = null;
    for (const part of chunk(dupeListingPayloads(plan))) {
      try {
        const r = await api("/api/listings", { method: "POST", body: { items: part } });
        created += Number(r?.created) || 0;
      } catch (e) { error = e; break; }
    }
    if (created) toast("🏷️ Doppelte inseriert", `${created} Karte${created === 1 ? "" : "n"} zum Cardmarket-Preis online – je 1 Exemplar bleibt in deinem Set-Ordner.`);
    if (error) handleError(error);
    await loadMyListings();
    window.PS?.loadListings?.();
  } catch (e) { handleError(e); }
  finally {
    pick.busy = false;
    renderListPicker();
  }
}

function pickSell(portfolioItemId) {
  if (!Number(portfolioItemId)) return;
  window.PS?.sellPortfolioItem?.(Number(portfolioItemId));
}

export function initListPicker() {
  window.addEventListener("ps:portfolio", renderListPicker);
  window.addEventListener("ps:my-listings", renderListPicker);
}

export const listPickerApi = {
  listAllDupes, pickSell, renderListPicker,
  pickSearch: (q) => { pick.query = String(q ?? "").slice(0, 80); renderListPicker(); },
  pickFilter: (k) => { pick.filter = PICK_FILTERS.some(([f]) => f === k) ? k : "all"; renderListPicker(); },
};
