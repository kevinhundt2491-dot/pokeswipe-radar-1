// PokeSwipe Radar – visuelles Set-Portfolio („Sammlung → Mein Binder“).
//   • Set-Ordner: Logo/Vorschaubild, Set-Name, Fortschrittsbalken („38 / 165 Karten“) und Gesamtwert der eigenen Karten
//   • Binder-Ansicht: durchblätterbare Ordnerseiten im 3×3-Raster (Swipe-Geste auf dem Handy, Pfeile/Tastatur am Desktop)
//   • jede Karte mit echtem Bild, Sammlernummer, Name und Cardmarket-Preis; eigene Karten vollfarbig (Zustand, „Im Verkauf“-Badge),
//     noch gesuchte Karten als tiefdunkle Sammler-Folientaschen (Obsidian-Glas-Look, Set-Nummer eingeprägt, Blueprint-Vorschau)
//     mit Marktplatz-Preisschild-Etikett („🛒 Ab 6,50 €“ / „⚡ Deal 5,50 €“ / „🔔 Radar aktiv“) – keine grauen Platzhalter, kein Lücken-Text
//   • Lücke ohne Angebot → 1 Tipp: Schnellsuche / Preisalarm; alle Lücken eines Sets im eigenen Bereich „🎯 Lücken-Radar“ (client/gap-radar.js)
// Reine Logik (Gruppierung, Seiten, Swipe, Badges) teilt sich der Browser mit dem Server: server/binder-logic.ts
import { $, esc, eur, cdn, state, api, toast, handleError, requireLogin, modal, closeModalEl, FALLBACK_IMG } from "./core.js";
import {
  groupBinderBySet, buildBinderCards, paginate, clampPage, swipeDirection, binderSummary, setIdOfCard, BINDER_PAGE_SIZE,
  showcaseBinderFill, binderCardAt, SHOWCASE_GAPS, autobinderBinderFill, AUTOBINDER_DEMO, pocketLabel,
} from "../server/binder-logic.ts";
import { folderValue, binderTotal, readCountDupes, quantityBadge, COUNT_DUPES_KEY } from "../server/duplicates-logic.ts";

// Reel-Aufnahme (Live-Stage-iframe mit ?reel=1): gefüllter Demo-Ordner aus dem ECHTEN Set-Katalog, ohne Schreibzugriff.
const IS_STAGE = (() => {
  try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; }
})();
const DEMO_LISTING_ID = -1;
let demo = null; // { setId, data, hero, price, binned, mode, listedPrice, bulk, revealed }

const LIVE_MS = 20_000;
/** Bild über das Image CDN; schlägt es fehl, erst die Original-URL, dann der Platzhalter (CSP-sicherer Inline-Handler). */
const imgTag = (src, w, attrs = "") => {
  const url = cdn(src || FALLBACK_IMG, w);
  const orig = src && url !== src ? src : "";
  return `<img src="${esc(url)}" data-orig="${esc(orig)}" ${attrs} onerror="if (this.dataset.orig) this.src = this.dataset.orig; if (!this.dataset.orig) this.src = '${FALLBACK_IMG}'; this.dataset.orig = ''" />`;
};
const view = { setId: "", data: null, cards: [], pages: [[]], page: 0, filter: "all", timer: 0, busy: false, demo: false };
let foldersCache = { at: 0, key: "", folders: null };

/** Umschalter „Doppelte im Gesamtwert mitzählen“ (Standard: An), wird im Gerät gemerkt. */
const countDupes = () => { try { return readCountDupes(localStorage.getItem(COUNT_DUPES_KEY)); } catch { return true; } };
function setCountDupes(on) {
  try { localStorage.setItem(COUNT_DUPES_KEY, on ? "1" : "0"); } catch {}
  syncDupesToggle();
  // Werte live neu berechnen – ohne neue Serveranfrage
  const box = $("ps-binder-folders");
  if (box && foldersCache.folders) {
    box.querySelectorAll("[data-set-folder]").forEach((el) => {
      const f = foldersCache.folders.find((x) => x.setId === el.dataset.setFolder);
      const v = el.querySelector("[data-folder-value]");
      if (f && v) v.textContent = eur(folderValue(f, on));
    });
    renderTotal(foldersCache.folders);
  }
  if (view.setId && view.data) {
    const from = binderSummary(view.cards, view.data.set?.total, !on).value;
    render();
    tweenValue(from);
  }
}
/** Gesamtwert in der Kopfzeile weich von `from` auf den neuen Wert zählen (≈ 0,45 s). */
function tweenValue(from) {
  const el = $("ps-binder-view")?.querySelector("[data-binder-value]");
  const to = binderSummary(view.cards, view.data?.set?.total, countDupes()).value;
  if (!el || !Number.isFinite(from) || Math.abs(from - to) < 0.005 || typeof requestAnimationFrame !== "function") return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
    if (!el.isConnected) return;
    el.textContent = eur(k >= 1 ? to : from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = eur(from);
  requestAnimationFrame(step);
}
function syncDupesToggle() {
  const on = countDupes();
  document.querySelectorAll("[data-count-dupes]").forEach((b) => { b.setAttribute("aria-checked", String(on)); b.classList.toggle("on", on); });
}
function renderTotal(folders) {
  const el = $("ps-binder-folders")?.querySelector("[data-binder-total]");
  if (el) el.textContent = eur(binderTotal(folders || [], countDupes()));
}
/** Kompakter An/Aus-Schalter (oben im Binder und in der Set-Ansicht). */
const dupesToggleHtml = () => `<button type="button" role="switch" data-count-dupes aria-checked="${countDupes()}" onclick="PS.binderCountDupes()" class="ps-switch ${countDupes() ? "on" : ""}">
    <span class="ps-switch-track" aria-hidden="true"><span class="ps-switch-knob"></span></span><span>Doppelte im Gesamtwert mitzählen</span></button>`;

const guestItems = () => {
  try {
    const v = JSON.parse(localStorage.getItem("pokeswipe_portfolio_clean") || "[]");
    return (Array.isArray(v) ? v : []).map((i) => ({
      cardId: i.cardId || i.card_id || (/^[\w.]+-[\w]+$/.test(String(i.id || "")) ? String(i.id) : null),
      quantity: Number(i.quantity) || 1, value: Number(i.value) || 0, image: i.image || i.img || "", name: i.name || "", condition: i.condition || "",
    })).filter((i) => i.cardId);
  } catch { return []; }
};

// ---------------------------------------------------------------------------
// Set-Ordner
// ---------------------------------------------------------------------------
async function loadFolders(force = false) {
  const key = state.user ? `u:${state.user.id}:${state.portfolio?.items?.length ?? ""}` : `g:${guestItems().length}`;
  if (!force && foldersCache.folders && foldersCache.key === key && Date.now() - foldersCache.at < 60_000) return foldersCache.folders;
  let folders = [];
  if (state.user) {
    folders = (await api("/api/binder/folders")).folders || [];
  } else {
    const items = guestItems();
    const ids = [...new Set(items.map((i) => setIdOfCard(i.cardId)).filter(Boolean))];
    const sets = ids.length ? (await api(`/api/binder/sets?ids=${encodeURIComponent(ids.join(","))}`)).sets || {} : {};
    folders = groupBinderBySet(items, sets);
  }
  foldersCache = { at: Date.now(), key, folders };
  return folders;
}

function folderHtml(f) {
  const img = f.logo || f.symbol || f.preview;
  return `<button type="button" class="ps-folder" data-set-folder="${esc(f.setId)}" onclick="PS.openSetBinder(${esc(JSON.stringify(f.setId))})" aria-label="Set-Ordner ${esc(f.name)} öffnen">
    <span class="ps-folder-spine" aria-hidden="true"></span>
    <span class="ps-folder-logo">${img ? imgTag(img, 240, `alt="" loading="lazy"`) : "<span>📒</span>"}</span>
    <span class="ps-folder-name">${esc(f.name)}</span>
    ${f.serieName ? `<span class="ps-folder-serie">${esc(f.serieName)}</span>` : ""}
    <span class="ps-folder-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${Number(f.total) || 0}" aria-valuenow="${Number(f.owned) || 0}" aria-label="Sammlungsfortschritt"><span style="width:${Number(f.pct) || 0}%"></span></span>
    <span class="ps-folder-foot"><span data-folder-progress>${esc(f.progressLabel)}</span><strong class="text-emerald-300" data-folder-value>${eur(folderValue(f, countDupes()))}</strong></span>
  </button>`;
}

export async function renderFolders(force = false) {
  const box = $("ps-binder-folders");
  if (!box) return;
  const grid = box.querySelector("[data-folders]");
  if (!grid) return;
  if (!grid.children.length) grid.innerHTML = `<div class="ps-skeleton rounded-2xl col-span-full !min-h-[120px]"></div>`;
  let folders = [];
  try { folders = await loadFolders(force); } catch (e) {
    if (e?.status === 401) folders = [];
    else { grid.innerHTML = `<p class="col-span-full text-xs text-slate-400 py-3">Set-Ordner konnten gerade nicht geladen werden.</p>`; return; }
  }
  const count = box.querySelector("[data-folder-count]");
  if (count) count.textContent = folders.length ? `${folders.length} Set${folders.length === 1 ? "" : "s"}` : "";
  const tools = box.querySelector("[data-folder-tools]");
  if (tools) tools.classList.toggle("hidden", !folders.length);
  syncDupesToggle();
  renderTotal(folders);
  syncVisibilityToggle(box, grid);
  grid.innerHTML = folders.length
    ? folders.map(folderHtml).join("")
    : `<div class="col-span-full ps-empty text-xs text-slate-300 text-center py-5 space-y-2">
        <p>📒 Deine Set-Ordner entstehen automatisch: Scanne eine Karte – sie wird sofort in den passenden Set-Ordner einsortiert.</p>
        <button type="button" onclick="PS.openScanner()" class="bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-xl">📷 Erste Karte scannen</button></div>`;
}

/** Set-Ordner für die Set-Binder-Vorschau der Startseite (client/home-binder.js) – gleicher Zwischenspeicher. */
export const homeFolders = (force = false) => loadFolders(force);

/** Startseite: Schnellzugriff auf die Set-Ordner (Logo, Fortschritt in %, 1 Tipp öffnet den Binder zum Durchblättern). */
export async function renderHomeFolders(force = false) {
  const box = $("home-set-binder")?.querySelector("[data-home-folders]");
  if (!box) return;
  let folders = [];
  try { folders = await loadFolders(force); } catch { folders = foldersCache.folders || []; }
  box.innerHTML = folders.length
    ? folders.slice(0, 8).map((f) => {
      const img = f.logo || f.symbol || f.preview;
      return `<button type="button" class="ps-home-folder" data-home-folder="${esc(f.setId)}" onclick="PS.openSetBinder(${esc(JSON.stringify(f.setId))})" aria-label="Set-Ordner ${esc(f.name)} öffnen">
        <span class="ps-home-folder-logo">${img ? imgTag(img, 160, `alt="" loading="lazy"`) : "📒"}</span>
        <span class="block text-[11px] font-black text-white truncate">${esc(f.name)}</span>
        <span class="ps-folder-bar" aria-hidden="true"><span style="width:${Number(f.pct) || 0}%"></span></span>
        <span class="flex justify-between text-[10px] text-slate-300"><span>${esc(f.progressLabel)}</span><strong class="text-emerald-300">${Number(f.pct) || 0} %</strong></span>
      </button>`;
    }).join("")
    : `<p class="text-[11px] text-slate-400 py-2">Scanne deine erste Karte – sie wird automatisch in den passenden Set-Ordner an ihre exakte Position einsortiert. Noch gesuchte Karten erkennst du an den dunklen Folientaschen mit Preisschild.</p>
       <button type="button" onclick="PS.openScanner()" class="shrink-0 self-center bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs">📷 Scannen</button>`;
}

/** Live-Online-Radar: Privatsphäre-Schalter direkt im Set-Binder (Standard: sichtbar, jederzeit abschaltbar). */
function syncVisibilityToggle(box, grid) {
  let el = box.querySelector("[data-binder-visibility]");
  if (!state.user || IS_STAGE) { el?.remove(); box.querySelector("[data-binder-alerts]")?.remove(); return; }
  if (!el) {
    el = document.createElement("label");
    el.setAttribute("data-binder-visibility", "");
    el.className = "flex items-center gap-2 text-[11px] text-slate-300 bg-slate-900/70 border border-slate-800 rounded-xl px-2.5 py-1.5 mb-2 cursor-pointer";
    grid.insertAdjacentElement("beforebegin", el);
  }
  const on = state.me?.binderVisible !== false;
  el.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} onchange="PS.setBinderVisible(this.checked)" class="accent-yellow-400" />
    <span><strong class="text-white">Meine Sammlung / Tausch-Karten für andere Sammler sichtbar machen</strong> <span class="text-slate-500">· für Binder-Vorschau & 1-Klick-Tausch im Live-Chat</span></span>`;
  let al = box.querySelector("[data-binder-alerts]");
  if (!al) {
    al = document.createElement("label");
    al.setAttribute("data-binder-alerts", "");
    al.className = el.className;
    el.insertAdjacentElement("afterend", al);
  }
  al.innerHTML = `<input type="checkbox" ${binderAlertsOn() ? "checked" : ""} onchange="PS.setBinderAlerts(this.checked)" class="accent-yellow-400" />
    <span><strong class="text-white">🔔 Benachrichtigen, wenn eine fehlende Karte meiner Set-Ordner auf dem Marktplatz auftaucht</strong> <span class="text-slate-500">· In-App & Push, mit Direktlink zum Angebot</span></span>`;
}

// ---------------------------------------------------------------------------
// Binder-Ansicht
// ---------------------------------------------------------------------------
function filtered(cards) {
  if (view.filter === "missing") return cards.filter((c) => !c.owned);
  if (view.filter === "market") return cards.filter((c) => !c.owned && c.market);
  if (view.filter === "owned") return cards.filter((c) => c.owned);
  return cards;
}

function rebuild() {
  const d = view.data;
  if (!d) return;
  const owned = view.demo || state.user ? d.owned || [] : guestItems().filter((i) => setIdOfCard(i.cardId) === view.setId);
  view.cards = buildBinderCards({
    catalog: d.catalog || [], owned, myListings: d.myListings || [], marketListings: d.marketListings || [],
    viewerId: state.user?.id || "", official: Number(d.set?.official) || 0,
  });
  view.pages = paginate(filtered(view.cards), BINDER_PAGE_SIZE);
  view.page = clampPage(view.page, view.pages.length);
}

function slotHtml(c, idx) {
  const badge = c.owned && c.myListing ? `<span class="ps-bslot-badge ps-bslot-sale" data-my-listing="${Number(c.myListing.id)}">${esc(c.myListing.label)}</span>` : "";
  // Leere Tasche: Marktplatz-Preisschild-Etikett – 1 Tipp öffnet direkt das Angebot bzw. Schnellsuche/Preisalarm
  const tag = c.owned ? null : pocketLabel(c);
  const id = esc(JSON.stringify(c.cardId));
  const tagHtml = tag ? `<span role="button" tabindex="0" class="ps-pocket-tag ps-pocket-tag-${tag.kind}" data-pocket-tag="${tag.kind}"${tag.listingId ? ` data-market-listing="${Number(tag.listingId)}"` : ""}
        onclick="event.stopPropagation(); PS.binderPocketTap(${id})" onkeydown="if(event.key==='Enter'){event.stopPropagation(); event.preventDefault(); PS.binderPocketTap(${id})}"
        aria-label="${esc(`${c.name}: ${tag.text}`)}">${esc(tag.text)}</span>` : "";
  const state_ = c.owned ? "owned" : c.market ? "missing market" : "missing";
  return `<button type="button" class="ps-bslot ${state_}" data-binder-card="${esc(c.cardId)}" data-idx="${idx}" onclick="PS.binderCardTap(${id})"
      aria-label="${esc(`${c.number || c.localId} ${c.name}${c.owned ? " – in deiner Sammlung" : " – noch gesucht"}${tag ? ` – ${tag.text}` : ""}`)}">
    <span class="ps-bslot-art">${imgTag(c.image, 260, `alt="" loading="lazy" draggable="false"`)}
      ${c.owned && c.condition ? `<span class="ps-badge ps-badge-cond ps-bslot-cond">${esc(c.condition)}</span>` : ""}
      ${c.owned && c.quantity > 1 ? `<span class="ps-bslot-qty" data-qty="${Number(c.quantity)}" aria-label="${Number(c.quantity)} Exemplare">${quantityBadge(c.quantity)}</span>` : ""}
      ${!c.owned ? `<span class="ps-bslot-emboss" aria-hidden="true">${esc(c.number || c.localId)}</span>` : ""}
      ${tagHtml}
      ${badge}
      ${c.owned && !c.myListing && c.portfolioItemId && state.user && !view.demo ? `<span role="button" tabindex="0" class="ps-bslot-sell" data-binder-sell="${Number(c.portfolioItemId)}" onclick="event.stopPropagation(); PS.binderSell(${Number(c.portfolioItemId)})" onkeydown="if(event.key==='Enter'){event.stopPropagation(); event.preventDefault(); PS.binderSell(${Number(c.portfolioItemId)})}" aria-label="${esc(`${c.name} inserieren`)}">🏷️ Inserieren</span>` : ""}</span>
    <span class="ps-bslot-info"><span class="ps-bslot-num">${esc(c.number || c.localId)}</span><span class="ps-bslot-price">${esc(c.priceLabel)}</span></span>
    <span class="ps-bslot-name">${esc(c.name)}</span>
  </button>`;
}

function pageHtml(page, p) {
  const empties = Math.max(0, BINDER_PAGE_SIZE - page.length);
  return `<div class="ps-bpage" data-page="${p}" aria-hidden="${p === view.page ? "false" : "true"}">
    ${page.map((c, i) => slotHtml(c, p * BINDER_PAGE_SIZE + i)).join("")}${Array.from({ length: empties }, () => `<span class="ps-bslot ps-bslot-empty" aria-hidden="true"></span>`).join("")}
  </div>`;
}

function headerHtml() {
  const s = view.data?.set || {};
  const sum = binderSummary(view.cards, s.total, countDupes());
  const chip = (k, label) => `<button type="button" class="ps-chip" aria-pressed="${view.filter === k}" onclick="PS.binderFilter('${k}')">${label}</button>`;
  return `<div class="ps-binder-head">
      <div class="flex items-center gap-3 min-w-0">
        ${s.logo ? `<img src="${esc(cdn(s.logo, 200))}" alt="" class="h-9 max-w-[90px] object-contain shrink-0" onerror="this.remove()" />` : `<span class="text-2xl" aria-hidden="true">📒</span>`}
        <div class="min-w-0"><h2 id="ps-binder-title" class="text-sm sm:text-base font-black text-white truncate">${esc(s.name || view.setId)}</h2>
          <p class="text-[11px] text-slate-300"><span data-binder-progress>${esc(sum.progressLabel)}</span> · Wert <strong class="text-emerald-300" data-binder-value>${eur(sum.value)}</strong>${sum.onMarket ? ` · <span class="text-amber-300" data-binder-onmarket>${sum.onMarket} gesuchte auf dem Marktplatz</span>` : ""}</p></div>
      </div>
      <button type="button" onclick="PS.closeSetBinder()" class="ps-binder-close" aria-label="Binder schließen">✕</button>
    </div>
    <div class="flex items-center gap-2 mx-1"><div class="ps-folder-bar flex-1" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(sum.pct) || 0}" aria-label="Set-Fortschritt"><span style="width:${sum.pct}%"></span></div>
      <strong class="text-[11px] font-black text-emerald-300 shrink-0" data-binder-pct>${Number(sum.pct) || 0} %</strong></div>
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar py-1" role="group" aria-label="Karten filtern">
      ${chip("all", "Alle")}${chip("market", `🛒 Auf Marktplatz (${sum.onMarket})`)}${chip("owned", `Meine (${sum.owned})`)}
      <button type="button" class="ps-chip" data-binder-gaps onclick="PS.openGapRadar(${esc(JSON.stringify(view.setId))})" title="Alle noch gesuchten Karten dieses Sets im eigenen Bereich">🎯 Lücken-Radar (${sum.missing})</button>
    </div>
    ${sum.duplicates ? `<div class="flex items-center justify-between gap-2 px-1">${dupesToggleHtml()}
      ${state.user ? `<button type="button" onclick="PS.listAllDupes()" data-binder-list-dupes class="text-[10px] font-black px-2.5 py-1 rounded-lg bg-slate-800 text-amber-200 shrink-0">🏷️ Alle Doppelten inserieren</button>` : ""}</div>` : ""}`;
}

function render() {
  const root = $("ps-binder-view");
  if (!root) return;
  const pages = view.pages;
  root.querySelector("[data-binder-head]").innerHTML = headerHtml();
  const track = root.querySelector("[data-binder-track]");
  const noHits = pages.length === 1 && !pages[0].length;
  track.innerHTML = noHits
    ? `<div class="ps-bpage ps-bpage-empty"><p class="text-xs text-slate-300 text-center col-span-3 self-center">${view.filter === "market" ? "Gerade bietet niemand eine deiner gesuchten Karten an – setze sie auf die Wunschliste, dann melden wir uns." : "Keine Karten in dieser Ansicht."}</p></div>`
    : pages.map(pageHtml).join("");
  updatePage(false);
}

function updatePage(animate = true) {
  const root = $("ps-binder-view");
  if (!root) return;
  const track = root.querySelector("[data-binder-track]");
  track.style.transition = animate ? "transform .32s cubic-bezier(.2,.8,.2,1)" : "none";
  track.style.transform = `translateX(${-view.page * 100}%)`;
  track.querySelectorAll(".ps-bpage").forEach((p, i) => p.setAttribute("aria-hidden", i === view.page ? "false" : "true"));
  const n = view.pages.length;
  const label = root.querySelector("[data-binder-page]");
  if (label) label.textContent = `Seite ${view.page + 1} / ${n}`;
  root.querySelector("[data-binder-prev]").disabled = view.page <= 0;
  root.querySelector("[data-binder-next]").disabled = view.page >= n - 1;
  const dots = root.querySelector("[data-binder-dots]");
  if (dots) {
    const max = 12, start = Math.max(0, Math.min(view.page - Math.floor(max / 2), n - max));
    dots.innerHTML = Array.from({ length: Math.min(n, max) }, (_, k) => start + k)
      .map((i) => `<button type="button" class="ps-bdot ${i === view.page ? "on" : ""}" onclick="PS.binderGoto(${i})" aria-label="Seite ${i + 1}"></button>`).join("");
  }
}

function go(delta) {
  const next = clampPage(view.page + delta, view.pages.length);
  if (next === view.page) {
    // Kurzes „Gummiband“ am Ordnerrand
    const t = $("ps-binder-view")?.querySelector("[data-binder-track]");
    if (t) { t.style.transition = "transform .12s"; t.style.transform = `translateX(calc(${-view.page * 100}% + ${delta > 0 ? -18 : 18}px))`; setTimeout(() => updatePage(true), 120); }
    return;
  }
  view.page = next;
  updatePage(true);
}

function bindGestures(root) {
  const vp = root.querySelector("[data-binder-viewport]");
  let sx = 0, sy = 0, active = false, dragging = false, pid = null;
  const track = root.querySelector("[data-binder-track]");
  vp.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; active = true; dragging = false; pid = e.pointerId;
  });
  vp.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; try { vp.setPointerCapture(pid); } catch {} }
    if (dragging) { track.style.transition = "none"; track.style.transform = `translateX(calc(${-view.page * 100}% + ${dx}px))`; }
  });
  const end = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    // Abgebrochene Geste (senkrechtes Scrollen übernimmt der Browser) blättert nie um
    const dir = e.type === "pointercancel" && !dragging ? 0 : swipeDirection(e.clientX - sx, e.clientY - sy, Math.min(60, vp.clientWidth * 0.12 || 40));
    if (dragging) {
      // Nach einem Wisch keinen Karten-Tipp auslösen
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

function onKey(e) {
  if (!view.setId || $("ps-binder-view")?.classList.contains("hidden")) return;
  if (document.querySelector("#ps-binder-card:not(.hidden)")) return;
  if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  else if (e.key === "Escape") closeSetBinder();
}

function ensureRoot() {
  let root = $("ps-binder-view");
  if (root) return root;
  root = document.createElement("div");
  root.id = "ps-binder-view";
  root.className = "ps-binder-overlay hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "ps-binder-title");
  root.innerHTML = `<div class="ps-binder">
    <div data-binder-head></div>
    <div class="ps-binder-stage">
      <button type="button" class="ps-binder-arrow left" data-binder-prev onclick="PS.binderPrev()" aria-label="Vorherige Seite">‹</button>
      <div class="ps-binder-viewport" data-binder-viewport><div class="ps-binder-track" data-binder-track></div></div>
      <button type="button" class="ps-binder-arrow right" data-binder-next onclick="PS.binderNext()" aria-label="Nächste Seite">›</button>
    </div>
    <div class="ps-binder-foot"><span data-binder-page class="text-[11px] font-black text-slate-300"></span><span data-binder-dots class="flex gap-1"></span>
      <span class="text-[10px] text-slate-500 hidden sm:inline">← → oder wischen zum Blättern</span><span class="text-[10px] text-slate-500 sm:hidden">Wischen zum Blättern</span></div>
  </div>`;
  document.body.appendChild(root);
  root.addEventListener("click", (e) => { if (e.target === root) closeSetBinder(); });
  bindGestures(root);
  document.addEventListener("keydown", onKey);
  return root;
}

async function openSetBinder(setId) {
  if (!/^[\w.\-]{1,40}$/.test(String(setId || ""))) return;
  const root = ensureRoot();
  view.setId = setId; view.page = 0; view.filter = "all"; view.data = null; view.demo = false;
  root.classList.remove("hidden");
  document.body.classList.add("ps-binder-open");
  root.querySelector("[data-binder-head]").innerHTML = `<div class="ps-binder-head"><p class="text-sm font-black text-white" id="ps-binder-title">📒 Ordner wird geöffnet …</p><button type="button" onclick="PS.closeSetBinder()" class="ps-binder-close" aria-label="Binder schließen">✕</button></div>`;
  root.querySelector("[data-binder-track]").innerHTML = `<div class="ps-bpage">${Array.from({ length: 9 }, () => `<span class="ps-bslot ps-skeleton !min-h-0"></span>`).join("")}</div>`;
  try {
    view.data = await api(`/api/binder/set/${encodeURIComponent(setId)}`);
  } catch (e) { handleError(e); closeSetBinder(); return; }
  if (view.setId !== setId) return;
  rebuild();
  render();
  clearInterval(view.timer);
  view.timer = setInterval(refreshMarket, LIVE_MS);
}

/** Live-Abgleich: nur die Marktplatz-Angebote neu laden, Seite & Filter bleiben. */
async function refreshMarket() {
  if (!view.setId || !view.data || document.hidden || view.busy) return;
  view.busy = true;
  try {
    const r = await api(`/api/binder/set/${encodeURIComponent(view.setId)}?market=1`);
    if (r.setId !== view.setId) return;
    const before = JSON.stringify(view.cards.map((c) => [c.market?.listingId, c.market?.price, c.myListing?.id]));
    view.data.marketListings = r.marketListings || [];
    view.data.myListings = r.myListings || [];
    const page = view.page;
    rebuild();
    view.page = clampPage(page, view.pages.length);
    if (JSON.stringify(view.cards.map((c) => [c.market?.listingId, c.market?.price, c.myListing?.id])) !== before) render();
  } catch {} finally { view.busy = false; }
}

function closeSetBinder() {
  clearInterval(view.timer);
  view.setId = "";
  $("ps-binder-view")?.classList.add("hidden");
  document.body.classList.remove("ps-binder-open");
  closeModalEl("ps-binder-card");
}

// ---------------------------------------------------------------------------
// Tipp auf eine Karte
// ---------------------------------------------------------------------------
function cardSheet(c, html) {
  modal("ps-binder-card", `<div class="flex gap-3">
      ${imgTag(c.image, 360, `alt="${esc(c.name)}" class="w-28 rounded-xl object-contain shrink-0 ${c.owned ? "" : "ps-binder-sheet-missing"}"`)}
      <div class="min-w-0 space-y-1 text-xs">
        <p class="text-[10px] font-black text-slate-400">${esc(view.data?.set?.name || "")} · Nr. ${esc(c.number || c.localId)}</p>
        <h3 class="text-base font-black text-white leading-tight">${esc(c.name)}</h3>
        <p>Cardmarket: <strong class="text-emerald-300">${esc(c.priceLabel)}</strong></p>
        ${c.owned ? `<p class="text-slate-300">✅ In deinem Binder${c.quantity > 1 ? ` (×${Number(c.quantity)})` : ""}${c.condition ? ` · Zustand <b>${esc(c.condition)}</b>` : ""}</p>` : `<p class="text-cyan-200">🎯 Noch gesucht – diese Tasche ist in deinem Ordner noch leer.</p>`}
      </div>
    </div>${html}`);
}

async function binderCardTap(cardId) {
  const c = view.cards.find((x) => x.cardId === cardId);
  if (!c) return;
  // Demo-Angebot der Reel-Aufnahme: direkt zum Marktplatz springen (Angebots-Raster)
  if (view.demo && !c.owned && c.market?.listingId === DEMO_LISTING_ID) { closeSetBinder(); window.PS?.marketTab?.("all"); return; }
  if (view.demo && Number(c.myListing?.id) < 0) return; // Demo-Inserat der Aufnahme – kein echtes Inserat dahinter
  if (c.owned && c.myListing) { window.PS?.openListing?.(c.myListing.id); return; }
  if (!c.owned && c.market) {
    // Fehlende Karte mit Angebot: Preis & Verkäufer sofort zeigen, 1 Tipp führt direkt zum Inserat
    const m = c.market;
    cardSheet(c, `<div class="space-y-2" data-binder-offer="${Number(m.listingId)}">
      <div class="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-2.5 text-xs">
        <p class="font-black text-emerald-300">🛒 Jetzt auf dem Marktplatz verfügbar</p>
        <p class="text-white"><strong class="text-base">${m.trade ? "Tausch möglich" : eur(m.price)}</strong>${m.condition ? ` · ${esc(m.condition)}` : ""}${m.seller ? ` · von ${esc(m.seller)}` : ""}</p>
        ${m.offers > 1 ? `<p class="text-[11px] text-slate-300">${Number(m.offers)} Angebote – das günstigste wird angezeigt.</p>` : ""}
      </div>
      <button type="button" onclick="PS.binderOpenOffer(${Number(m.listingId)})" data-binder-buy class="w-full bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">🛒 Zum Angebot im Marktplatz</button>
      <button type="button" onclick="PS.binderWish(${esc(JSON.stringify(c.cardId))})" data-binder-wish class="w-full bg-slate-800 text-yellow-200 font-bold py-2 rounded-xl text-xs">⭐ Auf Wunschliste – bei günstigeren Angeboten melden</button>
    </div>`);
    return;
  }
  if (c.owned) {
    cardSheet(c, `<div class="grid grid-cols-1 gap-2">
      ${state.user && c.portfolioItemId ? `<button type="button" onclick="PS.binderSell(${Number(c.portfolioItemId)})" class="bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">💶 Im Marktplatz verkaufen / tauschen</button>` : ""}
      <button type="button" onclick="PS.openCard && PS.openCard(${esc(JSON.stringify(c.cardId))})" class="bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs">📈 Preisverlauf & Details</button>
    </div>`);
    return;
  }
  cardSheet(c, `<div class="space-y-2">
    <p class="text-[11px] text-slate-300 bg-slate-900 rounded-xl p-2.5">Gerade bietet niemand diese Karte auf dem Marktplatz an. Aktiviere den Suchauftrag – wir benachrichtigen dich automatisch (In-App & Push), sobald jemand sie einstellt.</p>
    <button type="button" onclick="PS.binderWish(${esc(JSON.stringify(c.cardId))})" data-binder-wish class="w-full bg-yellow-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">🔔 Suchauftrag aktivieren (Wunschliste)</button>
    <button type="button" onclick="PS.binderMarketSearch(${esc(JSON.stringify(c.name))})" data-binder-market class="w-full bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs">🛒 Zum Marktplatz gehen</button>
  </div>`);
}

/** 1 Tipp auf das Marktplatz-Etikett einer leeren Tasche: Angebot direkt öffnen, sonst Schnellsuche / Preisalarm. */
function binderPocketTap(cardId) {
  const c = view.cards.find((x) => x.cardId === cardId);
  if (!c || c.owned) return;
  if (view.demo && c.market?.listingId === DEMO_LISTING_ID) { closeSetBinder(); window.PS?.marketTab?.("all"); return; }
  if (c.market?.listingId) { window.PS?.openListing?.(c.market.listingId); return; }
  binderCardTap(cardId);
}

/** Aus dem Ordner in den eigenen Bereich „🎯 Lücken-Radar“ (Album → Unterreiter) für dieses Set. */
function openGapRadar(setId) {
  const id = /^[\w.\-]{1,40}$/.test(String(setId || "")) ? String(setId) : view.setId;
  closeSetBinder();
  window.PS?.openGapRadar?.(id);
}

async function binderWish(cardId) {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId } });
    closeModalEl("ps-binder-card");
    toast("⭐ Preis-Radar aktiv", r?.offers ? `Es gibt schon ${Number(r.offers)} Angebot(e) ab ${eur(r.minPrice)}.` : "Wir benachrichtigen dich, sobald jemand diese Karte einstellt.");
  } catch (e) { handleError(e); }
}

/** Angebot einer fehlenden Karte direkt öffnen (Inserat mit Kaufen/Anfragen über dem Binder – danach geht's weiter im Ordner). */
function binderOpenOffer(listingId) {
  closeModalEl("ps-binder-card");
  window.PS?.openListing?.(listingId);
}

/** Zum Marktplatz mit vorausgefüllter Suche nach der fehlenden Karte. */
function binderMarketSearch(name) {
  closeModalEl("ps-binder-card");
  closeSetBinder();
  window.PS?.goMarket?.();
  const inp = $("market-search");
  if (inp) { inp.value = String(name || "").slice(0, 80); try { if (window.PS?.marketBrowse) window.PS.marketBrowse("search"); else window.renderMarket?.(); } catch {} }
}

/** Hinweis „fehlende Binder-Karte jetzt auf dem Marktplatz“ an/aus (geräteübergreifend in den Profil-Einstellungen). */
const binderAlertsOn = () => state.me?.prefs?.binderAlerts !== false;
async function setBinderAlerts(on) {
  if (!requireLogin()) return;
  try {
    await api("/api/me", { method: "PUT", body: { prefs: { binderAlerts: Boolean(on) } } });
    if (state.me) state.me.prefs = { ...(state.me.prefs || {}), binderAlerts: Boolean(on) };
    toast(on ? "🔔 Binder-Alarm an" : "🔕 Binder-Alarm aus", on ? "Wir melden uns, sobald eine fehlende Karte deiner Set-Ordner auf dem Marktplatz auftaucht." : "Keine automatischen Hinweise mehr zu fehlenden Binder-Karten.");
  } catch (e) { handleError(e); }
}

function binderSell(portfolioItemId) {
  closeModalEl("ps-binder-card");
  closeSetBinder();
  window.PS?.sellPortfolioItem?.(portfolioItemId);
}

// ---------------------------------------------------------------------------
// Showcase-Demo NUR für die Reel-Aufnahme (Stage): echter Katalog + echte Angebote, Ordner gefüllt, nichts gespeichert
// ---------------------------------------------------------------------------
/**
 * Set-Daten vorab laden (vor Frame 0), damit der Ordner in der Aufnahme ohne Ladezeit aufgeht.
 * mode "autobinder" = Demo-Ordner der Master-Vorlage (Doppelte, eigenes Inserat, Lücke mit Angebot – siehe AUTOBINDER_DEMO).
 */
async function binderDemoPrepare(setId, { price = 29.9, hero = SHOWCASE_GAPS[3], mode = "", listedPrice = 12.9 } = {}) {
  if (!IS_STAGE || !/^[\w.\-]{1,40}$/.test(String(setId || ""))) return null;
  const data = await api(`/api/binder/set/${encodeURIComponent(setId)}`);
  if (!data?.catalog?.length) return null;
  const ab = mode === "autobinder";
  demo = { setId, data, hero: ab ? AUTOBINDER_DEMO.gap : hero, price: Number(price) || 29.9, binned: null, mode: ab ? "autobinder" : "", listedPrice: Number(listedPrice) || 12.9, bulk: [], revealed: false };
  const at = (i) => binderCardAt(data.catalog, i)?.name || "";
  return {
    setId, name: data.set?.name || setId, cards: data.catalog.length, hero: at(demo.hero),
    ...(ab ? { scanned: at(AUTOBINDER_DEMO.scanned), listed: at(AUTOBINDER_DEMO.listed) } : {}),
  };
}

const viewerId = () => state.user?.id || "";

/** Eigene Karten des Demo-Ordners (Füllung + im Scanner abgelegte Karte). */
function demoOwned() {
  const d = demo.data, b = demo.binned;
  if (demo.mode !== "autobinder") {
    const owned = [...showcaseBinderFill(d.catalog), ...(d.owned || [])];
    if (b?.id && setIdOfCard(b.id) === demo.setId) owned.push({ cardId: b.id, quantity: 1, condition: b.condition || "NM", image: b.image || "", name: b.name, value: Number(b.price) || 0 });
    return owned;
  }
  const owned = autobinderBinderFill(d.catalog);
  // 2. Exemplar der gescannten Karte (Rückfall ohne Scan: die Demo-Karte Nr. 006) → „2x“ im Ordner
  const fallback = binderCardAt(d.catalog, AUTOBINDER_DEMO.scanned);
  const s = b?.id && setIdOfCard(b.id) === demo.setId ? b : fallback ? { id: fallback.id, name: fallback.name, image: fallback.image, price: fallback.price, condition: "NM", listed: true } : null;
  if (s) owned.push({ cardId: s.id, quantity: 1, condition: s.condition || "NM", image: s.image || "", name: s.name, value: Number(s.price) || 0 });
  return owned;
}

/** Eigene (Demo-)Inserate: im Scanner eingestellte Karte, 1-Klick-Doppelte und – nach dem Live-Abgleich – Nr. 009. */
function demoMyListings() {
  if (demo.mode !== "autobinder") return [];
  const d = demo.data, uid = viewerId(), out = [];
  const b = demo.binned?.id ? demo.binned : null;
  const scanned = b && setIdOfCard(b.id) === demo.setId ? b : binderCardAt(d.catalog, AUTOBINDER_DEMO.scanned);
  if (scanned && (!b || b.listed)) out.push({ id: -11, cardId: scanned.id, price: Number(b?.listPrice || scanned.price) || 0, userId: uid });
  demo.bulk.forEach((l, i) => out.push({ id: -100 - i, cardId: l.cardId, price: Number(l.price) || 0, userId: uid }));
  const listed = binderCardAt(d.catalog, AUTOBINDER_DEMO.listed);
  if (demo.revealed && listed) out.push({ id: -12, cardId: listed.id, price: demo.listedPrice, userId: uid });
  return out;
}

/** Gefüllten Demo-Ordner öffnen (eigene Karten vollfarbig mit Zustand + Live-Wert, Lücken abgedunkelt). */
function binderDemoOpen() {
  if (!IS_STAGE || !demo) return false;
  const root = ensureRoot();
  const d = demo.data, heroCard = binderCardAt(d.catalog, demo.hero);
  view.setId = demo.setId; view.page = 0; view.filter = "all"; view.demo = true;
  // Die Lücke mit dem späteren Badge darf in der Demo kein echtes, abweichendes Angebot zeigen
  const market = (d.marketListings || []).filter((l) => l.cardId !== heroCard?.id);
  if (demo.revealed && heroCard) market.push(demoOffer(heroCard));
  view.data = { ...d, owned: demoOwned(), marketListings: market, myListings: demoMyListings() };
  clearInterval(view.timer);
  root.classList.remove("hidden");
  document.body.classList.add("ps-binder-open");
  rebuild();
  render();
  return true;
}

const demoOffer = (card) => ({ id: DEMO_LISTING_ID, cardId: card.id, price: demo.price, userId: "reel-demo-seller", condition: "NM", seller: "Sammler" });

/**
 * Live-Abgleich in der Demo: auf der Lücke leuchtet „Auf Marktplatz: …“ auf (Master-Vorlage zusätzlich das eigene
 * Inserat „Im Verkauf: 12,90 €“ auf Nr. 009). Liefert das Slot-Element der Lücke.
 */
function binderDemoReveal() {
  if (!IS_STAGE || !demo || !view.demo) return null;
  const heroCard = binderCardAt(demo.data.catalog, demo.hero);
  if (!heroCard) return null;
  demo.revealed = true;
  view.data.marketListings = [...(view.data.marketListings || []).filter((l) => l.id !== DEMO_LISTING_ID), demoOffer(heroCard)];
  if (demo.mode === "autobinder") view.data.myListings = demoMyListings();
  const page = view.page;
  rebuild(); view.page = clampPage(page, view.pages.length); render();
  return binderDemoSlot("hero");
}

/** Slot-Element im Demo-Ordner: "hero" (Lücke), "listed" (eigenes Inserat Nr. 009), "scanned" (gescannte Karte, „2x“). */
function binderDemoSlot(which = "hero") {
  if (!IS_STAGE || !demo) return null;
  const idx = which === "listed" ? AUTOBINDER_DEMO.listed : which === "scanned" ? AUTOBINDER_DEMO.scanned : demo.hero;
  const id = which === "scanned" && demo.binned?.id && setIdOfCard(demo.binned.id) === demo.setId ? demo.binned.id : binderCardAt(demo.data.catalog, idx)?.id;
  return id ? $("ps-binder-view")?.querySelector(`[data-binder-card="${CSS.escape(id)}"]`) || null : null;
}

/** Sammlung + eigene Inserate des Demo-Ordners im Format der Inserat-Auswahl („Meine Inserate“). */
function binderDemoInventory() {
  if (!IS_STAGE || !demo) return null;
  const setName = demo.data.set?.name || demo.setId;
  const items = demoOwned().map((o, i) => {
    const qty = Math.max(1, Number(o.quantity) || 1);
    return { id: 900001 + i, cardId: o.cardId, lang: "de", name: o.name || o.cardId, image: o.image || "", setName, quantity: qty, unitValue: (Number(o.value) || 0) / qty, value: Number(o.value) || 0, condition: o.condition || "NM", variant: "normal" };
  });
  const listings = demoMyListings().map((l) => ({ id: l.id, card_id: l.cardId, status: "active", price: l.price }));
  return { items, listings };
}

export function initBinder() {
  if (IS_STAGE) {
    window.addEventListener("ps:reel-binned", (e) => { if (demo) demo.binned = e.detail || null; });
    // 1-Klick-Doppelte aus „Meine Inserate“ (Demo) → erscheinen im Ordner als eigene Inserate
    window.addEventListener("ps:reel-listed", (e) => { if (demo) demo.bulk = Array.isArray(e.detail) ? e.detail : []; });
  }
  renderFolders().then(() => renderHomeFolders()).catch(() => {});
  const homeVisible = () => !$("view-home")?.classList.contains("hidden");
  window.addEventListener("ps:portfolio", () => {
    foldersCache.at = 0;
    if (!$("view-portfolio")?.classList.contains("hidden")) renderFolders(true).then(() => { if (homeVisible()) renderHomeFolders(); });
    else if (homeVisible()) renderHomeFolders(true);
  });
  window.addEventListener("ps:plan", () => { foldersCache.at = 0; renderFolders().then(() => renderHomeFolders()).catch(() => {}); });
  window.addEventListener("ps:tab", (e) => { if (e.detail === "portfolio") renderFolders(); if (e.detail === "home") renderHomeFolders(); });
  window.addEventListener("ps:sub", (e) => { if (e.detail?.view === "portfolio" && e.detail?.key === "overview") renderFolders(); });
  window.addEventListener("ps:listings", () => { if (view.setId) refreshMarket(); });
  window.addEventListener("ps:my-listings", () => { if (view.setId) refreshMarket(); });
}

export const binderApi = {
  ...(IS_STAGE ? { binderDemoPrepare, binderDemoOpen, binderDemoReveal, binderDemoSlot, binderDemoInventory } : {}),
  openSetBinder, closeSetBinder, binderCardTap, binderWish, binderSell, renderFolders, binderOpenOffer, binderMarketSearch, setBinderAlerts, renderHomeFolders,
  binderPocketTap, binderGapRadar: openGapRadar,
  binderNext: () => go(1), binderPrev: () => go(-1),
  binderCountDupes: (on) => setCountDupes(typeof on === "boolean" ? on : !countDupes()),
  binderGoto: (i) => { view.page = clampPage(i, view.pages.length); updatePage(true); },
  binderFilter: (k) => { view.filter = ["all", "missing", "market", "owned"].includes(k) ? k : "all"; view.page = 0; rebuild(); render(); },
};
