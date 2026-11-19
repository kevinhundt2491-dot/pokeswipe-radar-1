// Startseite: interaktive Set-Binder-Vorschau direkt unter der Gründer-Box.
//   • eigene Sets (Auswahl), Fortschrittsbalken und eine echte Ordnerseite (3×3) – schon hier vor/zurück blättern oder wischen
//   • neue Besucher ohne Karten sehen ein Beispiel-Set (so sieht ein halb gefüllter Ordner aus, nichts wird gespeichert)
//   • „📒 Kompletten Set-Binder öffnen“ springt in die große Binder-Ansicht (client/binder.js)
import { $, esc, cdn, state, api, FALLBACK_IMG } from "./core.js";
import { buildBinderCards, binderSummary, paginate, clampPage, swipeDirection, setIdOfCard, showcaseBinderFill, BINDER_PAGE_SIZE, pocketLabel } from "../server/binder-logic.ts";
import { homeFolders } from "./binder.js";

/** Beispiel-Set für neue Besucher (Karmesin & Purpur 151). */
export const EXAMPLE_SET = "sv03.5";

const hb = { setId: "", example: false, data: null, cards: [], pages: [[]], page: 0, folders: [], loading: "" };

function guestOwned(setId) {
  try {
    const v = JSON.parse(localStorage.getItem("pokeswipe_portfolio_clean") || "[]");
    return (Array.isArray(v) ? v : []).map((i) => ({
      cardId: i.cardId || i.card_id || (/^[\w.]+-[\w]+$/.test(String(i.id || "")) ? String(i.id) : null),
      quantity: Number(i.quantity) || 1, value: Number(i.value) || 0, image: i.image || i.img || "", name: i.name || "", condition: i.condition || "",
    })).filter((i) => i.cardId && setIdOfCard(i.cardId) === setId);
  } catch { return []; }
}

function slotHtml(c) {
  // Leere Tasche: Set-Nummer eingeprägt + Marktplatz-Preisschild-Etikett (🛒 Ab … / ⚡ Deal … / 🔔 Radar aktiv) – keine grauen Platzhalter, kein Lücken-Text
  const tag = pocketLabel(c);
  const label = tag ? `<span class="ps-pocket-tag ps-pocket-tag-${tag.kind}">${esc(tag.text)}</span>` : "";
  return `<button type="button" class="ps-bslot ${c.owned ? "owned" : c.market ? "missing market" : "missing"}" onclick="PS.homeBinderTap(${esc(JSON.stringify(c.cardId))})"
      aria-label="${esc(`${c.number || c.localId} ${c.name}${c.owned ? " – im Binder" : ` – noch gesucht${tag ? `, ${tag.text}` : ""}`}`)}">
    <span class="ps-bslot-art"><img src="${esc(cdn(c.image || FALLBACK_IMG, 200))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" draggable="false" />
      ${!c.owned ? `<span class="ps-bslot-emboss" aria-hidden="true">${esc(c.number || c.localId)}</span>` : ""}${label}</span>
    <span class="ps-bslot-info"><span class="ps-bslot-num">${esc(c.number || c.localId)}</span><span class="ps-bslot-price">${esc(c.priceLabel)}</span></span>
  </button>`;
}

function shellHtml() {
  const s = hb.data?.set || {};
  const sum = binderSummary(hb.cards, s.total, true);
  const sel = hb.folders.length > 1
    ? `<select onchange="PS.homeBinderSet(this.value)" class="ps-hb-select" aria-label="Set wählen">${hb.folders.slice(0, 40).map((f) => `<option value="${esc(f.setId)}" ${f.setId === hb.setId ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>` : "";
  const n = hb.pages.length;
  return `<div class="ps-hb">
    <div class="space-y-2 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-black text-white truncate min-w-0">${hb.example ? `<span class="text-[9px] font-black uppercase bg-cyan-500/20 text-cyan-200 px-1.5 py-0.5 rounded mr-1">Beispiel</span>` : ""}${esc(s.name || hb.setId)}</p>${sel}
      </div>
      <div class="flex items-center gap-2"><div class="ps-folder-bar flex-1" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(sum.pct) || 0}" aria-label="Set-Fortschritt"><span style="width:${Number(sum.pct) || 0}%"></span></div>
        <strong class="text-[11px] text-emerald-300 shrink-0">${esc(sum.progressLabel)} · ${Number(sum.pct) || 0} %</strong></div>
      <div class="ps-hb-viewport" data-hb-viewport><div class="ps-hb-track" data-hb-track>
        ${hb.pages.map((p) => `<div class="ps-bpage">${p.map(slotHtml).join("")}${Array.from({ length: Math.max(0, BINDER_PAGE_SIZE - p.length) }, () => `<span class="ps-bslot ps-bslot-empty" aria-hidden="true"></span>`).join("")}</div>`).join("")}
      </div></div>
      <div class="flex items-center justify-between gap-2">
        <button type="button" class="ps-hb-nav" data-hb-prev onclick="PS.homeBinderPage(-1)" aria-label="Vorherige Seite">‹</button>
        <span class="text-[11px] font-black text-slate-300" data-hb-page>Seite ${hb.page + 1} / ${n}</span>
        <button type="button" class="ps-hb-nav" data-hb-next onclick="PS.homeBinderPage(1)" aria-label="Nächste Seite">›</button>
      </div>
    </div>
    <div class="space-y-2 text-xs text-slate-300">
      <p>${hb.example
        ? "So sieht dein digitaler Sammelordner aus: Jede gescannte Karte landet automatisch an ihrer exakten Position. Noch gesuchte Karten stecken als dunkle Folientaschen mit Preisschild im Ordner – es leuchtet grün, sobald jemand sie auf dem Marktplatz anbietet."
        : `Deine Karten stecken an ihrer exakten Position im Ordner. ${sum.missing ? `<strong class="text-white">${Number(sum.missing)} noch gesucht</strong>${sum.onMarket ? ` – <strong class="text-emerald-300">${Number(sum.onMarket)} davon gibt es gerade auf dem Marktplatz</strong>` : ""}.` : "<strong class=\"text-emerald-300\">Set komplett! 🏆</strong>"}`}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick="PS.homeBinderOpen()" class="ps-btn-primary">📒 Kompletten Set-Binder öffnen</button>
        ${hb.example ? `<button type="button" onclick="PS.openScanner()" class="ps-btn-ghost">📷 Erste Karte scannen</button>` : `<button type="button" onclick="PS.collectionTab('binder')" class="ps-btn-ghost">Alle Ordner ›</button>`}
      </div>
      <p class="text-[10px] text-slate-500">Wischen oder ‹ › zum Blättern · Karte antippen für Preis &amp; Angebote</p>
    </div>
  </div>`;
}

function updatePage(animate = true) {
  const root = $("home-binder-preview");
  const track = root?.querySelector("[data-hb-track]");
  if (!track) return;
  track.style.transition = animate ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
  track.style.transform = `translateX(${-hb.page * 100}%)`;
  const n = hb.pages.length;
  const label = root.querySelector("[data-hb-page]");
  if (label) label.textContent = `Seite ${hb.page + 1} / ${n}`;
  root.querySelector("[data-hb-prev]").disabled = hb.page <= 0;
  root.querySelector("[data-hb-next]").disabled = hb.page >= n - 1;
}

function go(delta) {
  const next = clampPage(hb.page + delta, hb.pages.length);
  if (next !== hb.page) hb.page = next;
  updatePage(true);
}

function bindSwipe(root) {
  const vp = root.querySelector("[data-hb-viewport]");
  const track = root.querySelector("[data-hb-track]");
  if (!vp || vp._bound) return;
  vp._bound = true;
  let sx = 0, sy = 0, active = false, dragging = false, pid = null;
  vp.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button !== 0) return; sx = e.clientX; sy = e.clientY; active = true; dragging = false; pid = e.pointerId; });
  vp.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; try { vp.setPointerCapture(pid); } catch {} }
    if (dragging) { track.style.transition = "none"; track.style.transform = `translateX(calc(${-hb.page * 100}% + ${dx}px))`; }
  });
  const end = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    const dir = e.type === "pointercancel" && !dragging ? 0 : swipeDirection(e.clientX - sx, e.clientY - sy, Math.min(50, vp.clientWidth * 0.12 || 40));
    if (dragging) {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      vp.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => vp.removeEventListener("click", stop, { capture: true }), 50);
    }
    dragging = false;
    if (dir) go(dir); else updatePage(true);
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
}

function paint() {
  const root = $("home-binder-preview");
  if (!root || !hb.data) return;
  root.innerHTML = shellHtml();
  bindSwipe(root);
  updatePage(false);
}

async function loadSet(setId, example) {
  hb.loading = setId;
  const data = await api(`/api/binder/set/${encodeURIComponent(setId)}`);
  if (hb.loading !== setId) return;
  const owned = example ? showcaseBinderFill(data.catalog || [], { pages: 2 }) : state.user ? data.owned || [] : guestOwned(setId);
  hb.setId = setId; hb.example = example; hb.data = data;
  hb.cards = buildBinderCards({ catalog: data.catalog || [], owned, myListings: data.myListings || [], marketListings: data.marketListings || [], viewerId: state.user?.id || "", official: Number(data.set?.official) || 0 });
  hb.pages = paginate(hb.cards, BINDER_PAGE_SIZE);
  hb.page = clampPage(hb.page, hb.pages.length);
  paint();
}

/** Vorschau (neu) laden – eigene Sets, sonst Beispiel-Set. */
export async function renderHomeBinder(force = false) {
  const root = $("home-binder-preview");
  if (!root) return;
  let folders = [];
  try { folders = await homeFolders(force); } catch {}
  hb.folders = folders || [];
  const keep = hb.folders.some((f) => f.setId === hb.setId) ? hb.setId : "";
  const target = keep || hb.folders[0]?.setId || EXAMPLE_SET;
  const example = !hb.folders.length;
  if (!force && hb.data && target === hb.setId && example === hb.example) { paint(); return; }
  if (target !== hb.setId) hb.page = 0;
  if (!hb.data) root.innerHTML = `<div class="ps-skeleton rounded-2xl !min-h-[180px]"></div>`;
  try { await loadSet(target, example); }
  catch { if (!hb.data) root.innerHTML = `<p class="text-[11px] text-slate-400 py-2">Die Ordner-Vorschau lädt gerade nicht – tippe auf „Alle Ordner“, um deinen Set-Binder zu öffnen.</p>`; }
}

export function initHomeBinder() {
  renderHomeBinder().catch(() => {});
  const homeVisible = () => !$("view-home")?.classList.contains("hidden");
  window.addEventListener("ps:portfolio", () => { if (homeVisible()) renderHomeBinder(true).catch(() => {}); });
  window.addEventListener("ps:plan", () => { hb.data = null; renderHomeBinder(true).catch(() => {}); });
  window.addEventListener("ps:tab", (e) => { if (e.detail === "home") renderHomeBinder().catch(() => {}); });
}

export const homeBinderApi = {
  homeBinderPage: (d) => go(Number(d) < 0 ? -1 : 1),
  homeBinderSet: (id) => { if (/^[\w.\-]{1,40}$/.test(String(id || ""))) { hb.page = 0; loadSet(String(id), false).catch(() => {}); } },
  homeBinderOpen: () => window.PS?.openSetBinder?.(hb.setId || EXAMPLE_SET),
  homeBinderTap: async (cardId) => {
    await window.PS?.openSetBinder?.(hb.setId || EXAMPLE_SET);
    window.PS?.binderCardTap?.(cardId);
  },
};
