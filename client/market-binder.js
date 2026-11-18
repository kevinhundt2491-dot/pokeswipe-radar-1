// PokeSwipe Radar – virtueller Marktplatz-Binder (Reiter „Marktplatz“).
//   • Die aktuellen Angebote liegen wie in einem echten Tauschordner in Folien-Taschen:
//     3×3 = 9 Karten pro Seite am Desktop, 2×2 = 4 Karten auf dem Smartphone; blättern per Pfeil, Tastatur oder Wischgeste.
//   • Jede Tasche zeigt nur das Wichtigste: Kartenbild, Zustand, Preis (oder „🔄 Tausch“) und – falls die Karte im
//     eigenen Set-Binder noch fehlt – das Badge „⚡ Fehlt in deinem Binder!“.
//   • Antippen öffnet die Einzelkarten-Ansicht (Links/Rechts-Swipe zur nächsten Karte) mit Kaufen, 1:1-Tausch,
//     Verkäufer schreiben und Cardmarket-Preis.
// Filter-Chips, Suche und die klassische Rasteransicht (#market-list) bleiben unverändert – ein Umschalter wechselt.
import { $, esc, jsArg, eur, cdn, cm, state, FALLBACK_IMG, modal, closeModalEl } from "./core.js";
import { conditionShort } from "./market-filter-logic.js";
import {
  pocketsPerPage, binderIndex, missingInBinder, setOptions, filterBySet, pagesOf, clampIndex, pageOfIndex, pocketPrice, pocketCode, setIdOf,
} from "./market-binder-logic.js";
import { swipeDirection } from "../server/binder-logic.ts";

const VIEW_KEY = "ps_market_view";
// Reel-Aufnahme (Live-Stage) arbeitet mit dem klassischen Raster
const IS_STAGE = (() => { try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; } })();
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const mb = {
  view: IS_STAGE ? "list" : lsGet(VIEW_KEY) === "list" ? "list" : "binder",
  set: "",
  list: [],      // gefilterte Angebote in Anzeige-Reihenfolge
  page: 0,
  focus: -1,     // Index der Einzelkarten-Ansicht
  index: null,   // eigener Set-Binder (Karten-IDs & gesammelte Sets)
  scope: "",     // Händler-Ordner (Live-Swipe-Modul) – Wechsel setzt auf Seite 1
};
const wide = () => (typeof matchMedia === "function" ? matchMedia("(min-width: 640px)").matches : true);
const size = () => pocketsPerPage(wide());

function ownedItems() {
  if (state.user && Array.isArray(state.portfolio?.items)) return state.portfolio.items;
  try { const v = JSON.parse(lsGet("pokeswipe_portfolio_clean") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ---------------------------------------------------------------------------
// Gerüst: Umschalter + Set-Filter (unter den Chips) und Binder-Container (vor dem klassischen Raster)
// ---------------------------------------------------------------------------
function ensureDom() {
  const grid = $("market-list");
  if (!grid) return null;
  let bar = $("ps-mb-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ps-mb-bar";
    bar.className = "flex items-center justify-between gap-2";
    $("ps-market-chips")?.insertAdjacentElement("afterend", bar);
  }
  let root = $("ps-market-binder");
  if (!root) {
    root = document.createElement("div");
    root.id = "ps-market-binder";
    root.className = "ps-mbinder";
    root.setAttribute("aria-label", "Marktplatz-Binder");
    root.innerHTML = `<div class="ps-mbinder-stage">
        <button type="button" class="ps-binder-arrow left" data-mb-prev onclick="PS.mbPrev()" aria-label="Vorherige Ordnerseite">‹</button>
        <div class="ps-mbinder-viewport" data-mb-viewport><div class="ps-mbinder-track" data-mb-track></div></div>
        <button type="button" class="ps-binder-arrow right" data-mb-next onclick="PS.mbNext()" aria-label="Nächste Ordnerseite">›</button>
      </div>
      <div class="ps-binder-foot"><span data-mb-page class="text-[11px] font-black text-slate-300"></span><span data-mb-dots class="flex gap-1"></span>
        <span class="text-[10px] text-slate-500">Wischen oder ← → zum Blättern · Karte antippen</span></div>`;
    grid.insertAdjacentElement("beforebegin", root);
    bindSwipe(root.querySelector("[data-mb-viewport]"), (dir) => go(dir), () => updatePage(true), root.querySelector("[data-mb-track]"));
  }
  return { bar, root, grid };
}

function barHtml(all, force = false) {
  const sets = setOptions(all);
  if (mb.set && !sets.some((s) => s.id === mb.set)) mb.set = "";
  const seg = (k, label) => `<button type="button" class="ps-chip" aria-pressed="${mb.view === k}" onclick="PS.marketView('${k}')">${label}</button>`;
  return `${force ? `<span class="text-[11px] font-black text-slate-300">📒 Ordnerseiten</span>` : `<span class="flex gap-1.5" role="group" aria-label="Ansicht">${seg("binder", "📒 Binder")}${seg("list", "☰ Liste")}</span>`}
    ${sets.length > 1 ? `<label class="flex items-center gap-1 text-[11px] text-slate-400 min-w-0"><span class="shrink-0">Set</span>
      <select onchange="PS.marketSet(this.value)" class="ps-mb-select" aria-label="Nach Set filtern">
        <option value="">Alle Sets</option>${sets.slice(0, 60).map((s) => `<option value="${esc(s.id)}" ${s.id === mb.set ? "selected" : ""}>${esc(s.label)} (${Number(s.n)})</option>`).join("")}
      </select></label>` : ""}`;
}

// ---------------------------------------------------------------------------
// Ordnerseiten
// ---------------------------------------------------------------------------
function pocketHtml(l, i) {
  const cond = conditionShort(l.condition);
  const photo = String(l.image || "").startsWith("/api/images/");
  const missing = missingInBinder(l, mb.index);
  return `<button type="button" class="ps-mpocket ${missing ? "ps-mpocket-missing" : ""}" data-mb-card="${Number(l.id)}" onclick="PS.mbOpen(${i})" aria-label="${esc(`${l.card_name}${cond ? `, ${cond}` : ""}, ${pocketPrice(l, eur)}${missing ? ", fehlt in deinem Binder" : ""}`)}">
    <span class="ps-mpocket-art"><img src="${esc(cdn(l.image || FALLBACK_IMG, 300))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" draggable="false" class="${photo ? "object-cover" : "object-contain"}" />
      ${cond ? `<span class="ps-badge ps-badge-cond ps-bslot-cond">${esc(cond)}</span>` : ""}
      ${missing ? `<span class="ps-mpocket-flag">⚡ Fehlt in deinem Binder!</span>` : ""}</span>
    <span class="ps-mpocket-foot"><span class="ps-mpocket-name">${esc(l.card_name)}</span><strong class="ps-mpocket-price ${Number(l.price) > 0 ? "" : "trade"}">${esc(pocketPrice(l, eur))}</strong></span>
  </button>`;
}

function renderPages() {
  const d = ensureDom();
  if (!d) return;
  const s = size();
  const pages = pagesOf(mb.list, s);
  mb.page = clampIndex(mb.page, pages.length);
  const track = d.root.querySelector("[data-mb-track]");
  track.style.setProperty("--mb-cols", String(s === 4 ? 2 : 3));
  if (!mb.list.length) {
    track.innerHTML = `<div class="ps-mpage ps-mpage-empty"><p class="text-xs text-slate-300 text-center self-center col-span-full">Keine Angebote aus diesem Set für den gewählten Filter. <button type="button" onclick="PS.marketSet('')" class="underline font-bold text-yellow-300">Alle Sets zeigen</button></p></div>`;
    updatePage(false);
    return;
  }
  track.innerHTML = pages.map((p, pi) => `<div class="ps-mpage" data-mb-pageidx="${pi}">
    ${p.map((l, k) => pocketHtml(l, pi * s + k)).join("")}${Array.from({ length: Math.max(0, s - p.length) }, () => `<span class="ps-mpocket ps-mpocket-empty" aria-hidden="true"></span>`).join("")}
  </div>`).join("");
  updatePage(false);
}

function updatePage(animate = true) {
  const root = $("ps-market-binder");
  if (!root) return;
  const n = pagesOf(mb.list, size()).length;
  const track = root.querySelector("[data-mb-track]");
  track.style.transition = animate ? "transform .32s cubic-bezier(.2,.8,.2,1)" : "none";
  track.style.transform = `translateX(${-mb.page * 100}%)`;
  track.querySelectorAll(".ps-mpage").forEach((p, i) => p.setAttribute("aria-hidden", i === mb.page ? "false" : "true"));
  root.querySelector("[data-mb-page]").textContent = `Seite ${mb.page + 1} / ${n}`;
  root.querySelector("[data-mb-prev]").disabled = mb.page <= 0;
  root.querySelector("[data-mb-next]").disabled = mb.page >= n - 1;
  const max = 10, start = Math.max(0, Math.min(mb.page - Math.floor(max / 2), n - max));
  root.querySelector("[data-mb-dots]").innerHTML = n > 1 ? Array.from({ length: Math.min(n, max) }, (_, k) => start + k)
    .map((i) => `<button type="button" class="ps-bdot ${i === mb.page ? "on" : ""}" onclick="PS.mbGoto(${i})" aria-label="Seite ${i + 1}"></button>`).join("") : "";
}

function go(delta) {
  const n = pagesOf(mb.list, size()).length;
  const next = clampIndex(mb.page + delta, n);
  if (next === mb.page) { updatePage(true); return; }
  mb.page = next;
  updatePage(true);
}

/** Wischgeste (Pointer Events) – blättert, ohne den Karten-Tipp nach einem Wisch auszulösen. */
function bindSwipe(vp, onDir, onCancel, track) {
  if (!vp) return;
  let sx = 0, sy = 0, active = false, dragging = false, pid = null;
  vp.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; active = true; dragging = false; pid = e.pointerId;
  });
  vp.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; try { vp.setPointerCapture(pid); } catch {} }
    if (dragging && track) { track.style.transition = "none"; track.style.transform = `translateX(calc(${-mb.page * 100}% + ${dx}px))`; }
  });
  const end = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    const dir = e.type === "pointercancel" && !dragging ? 0 : swipeDirection(e.clientX - sx, e.clientY - sy, Math.min(60, vp.clientWidth * 0.12 || 40));
    if (dragging) {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      vp.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => vp.removeEventListener("click", stop, { capture: true }), 50);
    }
    dragging = false;
    if (dir) onDir(dir); else onCancel?.();
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
}

/**
 * Wird von renderMarket() mit der bereits gefilterten Liste (Suche + Chips) aufgerufen.
 * @param {any[]} list   gefilterte Angebote
 * @param {any[]} all    alle geladenen Angebote (für die Set-Auswahl)
 */
export function renderMarketBinder(list, all, opts = {}) {
  const d = ensureDom();
  if (!d) return;
  // Händler-Ordner (client/market-swipe.js): immer als Binder, neuer Ordner beginnt auf Seite 1
  const force = Boolean(opts.forceBinder);
  const scope = String(opts.scope || "");
  if (scope !== mb.scope) { mb.scope = scope; mb.page = 0; }
  d.bar.innerHTML = barHtml(all || list, force);
  const filtered = filterBySet(list, mb.set);
  const before = mb.list.map((l) => l.id).join(",");
  mb.list = filtered;
  mb.index = binderIndex(ownedItems());
  if (mb.list.map((l) => l.id).join(",") !== before) mb.page = clampIndex(mb.page, pagesOf(mb.list, size()).length);
  const showBinder = (force || mb.view === "binder") && list.length > 0;
  d.root.classList.toggle("hidden", !showBinder);
  // Klassische Rasteransicht bleibt im DOM (Leer-/Filter-Hinweise, bestehende Abläufe) – im Binder-Modus nur ausgeblendet
  d.grid.classList.toggle("hidden", showBinder);
  if (mb.set && !showBinder) {
    // Set-Filter auch in der Liste anwenden
    d.grid.querySelectorAll("[data-listing]").forEach((el) => {
      const l = (all || list).find((x) => Number(x.id) === Number(el.dataset.listing));
      el.classList.toggle("hidden", Boolean(l) && setIdOf(l.card_id) !== mb.set);
    });
  }
  if (showBinder) renderPages();
  if (mb.focus >= 0 && $("ps-mb-card") && !$("ps-mb-card").classList.contains("hidden")) renderFocus();
}

// ---------------------------------------------------------------------------
// Einzelkarten-Ansicht (Swipe links/rechts = nächste/vorherige Karte)
// ---------------------------------------------------------------------------
function focusHtml(l) {
  const own = l.user_id === state.user?.id;
  const cond = conditionShort(l.condition);
  const code = pocketCode(l);
  const missing = missingInBinder(l, mb.index);
  const photo = String(l.image || "").startsWith("/api/images/");
  const n = mb.list.length;
  const id = Number(l.id);
  const buy = l.buy_now
    ? `<button type="button" onclick="PS.openBuy(${id})" class="bg-cyan-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">💳 Jetzt kaufen</button>`
    : `<button type="button" onclick="PS.mbAsk(${id})" class="bg-cyan-400/90 text-slate-950 font-black py-2.5 rounded-xl text-xs" title="Kein Sofort-Kauf – Anfrage an den Verkäufer">💳 Jetzt kaufen (Anfrage)</button>`;
  return `<div class="space-y-3" data-mb-focus="${id}">
    <div class="flex items-center justify-between gap-2 pr-6">
      <p class="text-[10px] font-black text-slate-400">Karte ${mb.focus + 1} von ${n}${code ? ` · ${esc(code)}` : ""}</p>
      ${missing ? `<span class="ps-mpocket-flag ps-mpocket-flag-inline">⚡ Fehlt in deinem Binder!</span>` : ""}
    </div>
    <div class="ps-mfocus" data-mb-focus-stage>
      <button type="button" class="ps-mfocus-nav left" onclick="PS.mbStep(-1)" ${mb.focus <= 0 ? "disabled" : ""} aria-label="Vorherige Karte">‹</button>
      <img src="${esc(cdn(l.image || FALLBACK_IMG, 520))}" onerror="this.src='${FALLBACK_IMG}'" alt="${esc(l.card_name)}" draggable="false" class="ps-mfocus-img ${photo ? "object-cover" : "object-contain"}" />
      <button type="button" class="ps-mfocus-nav right" onclick="PS.mbStep(1)" ${mb.focus >= n - 1 ? "disabled" : ""} aria-label="Nächste Karte">›</button>
    </div>
    <div class="text-center space-y-0.5">
      <h3 class="text-base font-black text-white leading-tight">${esc(l.card_name)}</h3>
      <p class="text-xs"><strong class="text-emerald-300 text-lg">${esc(pocketPrice(l, eur))}</strong>${cond ? ` · <span class="ps-badge ps-badge-cond">${esc(cond)}</span>` : ""}${l.market_price ? ` <span class="text-slate-400">· CM-Trend ${eur(l.market_price)}</span>` : ""}</p>
      <p class="text-[11px] text-slate-400">${l.seller ? `👤 <button type="button" onclick="PS.openUser(${jsArg(l.user_id)})" class="font-bold text-slate-200 hover:text-white">${esc(l.seller)}</button>${l.seller_founder ? ` <span class="ps-founder-chip">🏅</span>` : ""} · ` : ""}📍 ${esc(l.city || "–")}${l.want ? ` · Sucht: ${esc(String(l.want).slice(0, 60))}` : ""}</p>
    </div>
    ${own ? `<div class="grid grid-cols-1 gap-2"><button type="button" onclick="PS.mbDetails(${id})" class="bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">✏️ Mein Inserat verwalten</button></div>`
    : `<div class="grid grid-cols-2 gap-2">
      ${buy}
      <button type="button" onclick="PS.mbTrade(${id})" class="bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">🔄 1:1 Tausch vorschlagen</button>
      <button type="button" onclick="PS.mbMessage(${jsArg(l.user_id)})" class="bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs">💬 Verkäufer schreiben</button>
      <a href="${esc(cm(l.card_name))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold py-2.5 rounded-xl text-xs text-center">📊 Cardmarket-Preis prüfen</a>
    </div>`}
    <button type="button" onclick="PS.mbDetails(${id})" class="w-full text-[11px] font-bold text-slate-400 hover:text-white">Alle Details &amp; Aktionen ›</button>
    <p class="text-[10px] text-slate-500 text-center sm:hidden">← Wischen für die nächste Karte →</p>
  </div>`;
}

function renderFocus() {
  const l = mb.list[mb.focus];
  if (!l) { closeModalEl("ps-mb-card"); return; }
  const el = modal("ps-mb-card", focusHtml(l), { onClose: () => { mb.focus = -1; } });
  const stage = el.querySelector("[data-mb-focus-stage]");
  if (stage && !stage._bound) { stage._bound = true; bindSwipe(stage, (dir) => step(dir), null, null); }
}

function openFocus(i) {
  if (!mb.list.length) return;
  mb.focus = clampIndex(i, mb.list.length);
  renderFocus();
}

function step(delta) {
  if (mb.focus < 0) return;
  const next = clampIndex(mb.focus + delta, mb.list.length);
  if (next === mb.focus) return;
  mb.focus = next;
  // Ordner im Hintergrund blättert mit
  const p = pageOfIndex(next, size());
  if (p !== mb.page) { mb.page = p; updatePage(false); }
  renderFocus();
}

const closeFocus = () => closeModalEl("ps-mb-card");

function onKey(e) {
  if (mb.view !== "binder" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
  const focusOpen = $("ps-mb-card") && !$("ps-mb-card").classList.contains("hidden");
  if (focusOpen) {
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "Escape") closeFocus();
    return;
  }
  if ($("view-map")?.classList.contains("hidden") || $("ps-market-binder")?.classList.contains("hidden")) return;
  if (document.querySelector("body > div.fixed.inset-0:not(.hidden), .ps-binder-overlay:not(.hidden)")) return; // anderes Fenster offen
  if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
}

export function initMarketBinder() {
  document.addEventListener("keydown", onKey);
  if (typeof matchMedia === "function") {
    const mq = matchMedia("(min-width: 640px)");
    const re = () => { const first = mb.page * (mq.matches ? 4 : 9); mb.page = pageOfIndex(first, size()); if (mb.view === "binder" && mb.list.length) renderPages(); };
    mq.addEventListener?.("change", re);
  }
  window.addEventListener("ps:portfolio", () => { if (mb.view === "binder" && mb.list.length) { mb.index = binderIndex(ownedItems()); renderPages(); } });
}

export const marketBinderApi = {
  marketView: (v) => { mb.view = v === "list" ? "list" : "binder"; lsSet(VIEW_KEY, mb.view); window.renderMarket?.(); },
  marketSet: (s) => { mb.set = /^[a-z0-9.]{0,12}$/i.test(String(s || "")) ? String(s || "").toLowerCase() : ""; mb.page = 0; window.renderMarket?.(); },
  mbNext: () => go(1), mbPrev: () => go(-1),
  mbGoto: (i) => { mb.page = clampIndex(i, pagesOf(mb.list, size()).length); updatePage(true); },
  mbOpen: openFocus, mbStep: step,
  mbTrade: (id) => { closeFocus(); window.PS?.requestTrade?.(id); },
  mbAsk: (id) => { closeFocus(); window.PS?.requestTrade?.(id); },
  mbMessage: (userId) => { closeFocus(); window.PS?.openDm?.(userId); },
  mbDetails: (id) => { closeFocus(); window.PS?.openListing?.(id); },
};
