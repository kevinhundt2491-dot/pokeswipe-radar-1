// PokeSwipe Radar – Live-Swipe im Reiter „Marktplatz“ (Standard-Ansicht beim Öffnen des Reiters).
//   • 🔀 Alle Ordner gemischt (Live-Swipe): alle Händler- & Sammler-Angebote in einem Stapel, gewichtet nach
//     Verkäufer-Rang (höherer Rang = häufigere Einblendung). Jede Karte zeigt Bild, Name, Set-Nummer, Zustand,
//     Verkäufer + Rang-Badge und Preis – unten „💳 Jetzt kaufen“ neben „Weiter swipen“ und „🔄 Tauschen“.
//   • 📁 Händler-Ordner: ein Ordner je Verkäufer (Händler zuerst) mit Stadt-Filter und direktem Wechsel zum
//     nächsten Ordner – die Karten liegen im bestehenden Marktplatz-Binder (client/market-binder.js).
//   • 🔍 Direktsuche (Name & Nummer): die bisherige Suche mit Binder-/Listenansicht, unverändert.
// Die Filter-Chips (Alle · Tausch · Verkauf · Near Mint · Preis) gelten in allen drei Ansichten.
import { $, esc, jsArg, eur, cdn, state, FALLBACK_IMG } from "./core.js";
import { conditionShort, setCodeOf } from "./market-filter-logic.js";
import {
  BROWSE_MODES, sellerRank, sellerKind, KIND_LABEL, nextDeck, cityOptions, sellerFolders, normCity,
} from "./market-swipe-logic.js";

// Reel-Aufnahme (Live-Stage) arbeitet weiter mit dem klassischen Raster
const IS_STAGE = (() => { try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; } })();

const sw = {
  mode: IS_STAGE ? "search" : "swipe",
  list: [],      // gefilterte Angebote (Chips)
  sig: "",
  deck: [],
  pos: 0,
  folders: [],
  folder: 0,     // Index des offenen Händler-Ordners
  folderUser: null,
  city: "",
};

export const browseMode = () => sw.mode;

const rankBadge = (r) => `<span class="ps-msw-rank ps-msw-rank-${r.key}" title="Verkäufer-Rang ${esc(r.label)}">${r.icon} ${esc(r.label)}</span>`;

// ---------------------------------------------------------------------------
// Gerüst: Switch-Leiste (direkt über der Swipe-Karte), Swipe-Bühne und Ordner-Kopf
// ---------------------------------------------------------------------------
function ensureDom() {
  const main = $("ps-market-main");
  const toolbar = main?.querySelector(".ps-market-toolbar");
  if (!main || !toolbar) return null;
  let bar = $("ps-msw-switch");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ps-msw-switch";
    bar.className = "ps-msw-switch";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Marktplatz-Ansicht");
    toolbar.insertAdjacentElement("afterend", bar);
  }
  let folder = $("ps-msw-folder");
  if (!folder) {
    folder = document.createElement("div");
    folder.id = "ps-msw-folder";
    bar.insertAdjacentElement("afterend", folder);
  }
  let stage = $("ps-msw");
  if (!stage) {
    stage = document.createElement("div");
    stage.id = "ps-msw";
    stage.className = "ps-msw";
    stage.setAttribute("aria-live", "polite");
    folder.insertAdjacentElement("afterend", stage);
  }
  return { main, bar, folder, stage };
}

function switchHtml() {
  const b = (k, icon, label, sub) => `<button type="button" role="tab" data-browse="${k}" aria-selected="${sw.mode === k}" onclick="PS.marketBrowse('${k}')">
    <span class="ps-msw-switch-l">${icon} ${label}</span><span class="ps-msw-switch-s">${sub}</span></button>`;
  return b("swipe", "🔀", "Alle gemischt", "Live-Swipe")
    + b("folder", "📁", "Händler-Ordner", "durchblättern")
    + b("search", "🔍", "Direktsuche", "Name & Nummer");
}

// ---------------------------------------------------------------------------
// 🔀 Live-Swipe
// ---------------------------------------------------------------------------
function rebuildDeck() {
  const cur = sw.deck[sw.pos];
  const still = cur && sw.list.find((l) => Number(l.id) === Number(cur.id));
  const rest = sw.list.filter((l) => !still || Number(l.id) !== Number(still.id));
  sw.deck = still ? [still, ...nextDeck(rest, still.id)] : nextDeck(sw.list, cur?.id);
  sw.pos = 0;
}

function cardHtml(l) {
  const id = Number(l.id);
  const own = l.user_id === state.user?.id;
  const cond = conditionShort(l.condition);
  const code = setCodeOf(l);
  const rank = sellerRank(l);
  const kind = sellerKind(l);
  const photo = String(l.image || "").startsWith("/api/images/");
  const price = Number(l.price) > 0 ? eur(l.price) : "🔄 Tausch";
  const buy = own
    ? `<button type="button" onclick="PS.openListing(${id})" class="ps-msw-buy bg-slate-700 text-white">✏️ Mein Inserat</button>`
    : l.buy_now
      ? `<button type="button" onclick="PS.mswBuy(${id})" class="ps-msw-buy" title="Kauf mit Käuferschutz – direkt zum Checkout">💳 Jetzt kaufen</button>`
      : `<button type="button" onclick="PS.mswBuy(${id})" class="ps-msw-buy" title="Kein Sofort-Kauf – Kaufanfrage an den Verkäufer">💳 Jetzt kaufen<span class="ps-msw-buy-sub">Anfrage an Verkäufer</span></button>`;
  return `<article class="ps-msw-card" data-msw-card="${id}">
    <div class="ps-msw-head">
      <span class="flex items-center gap-1 min-w-0">${rankBadge(rank)}<span class="ps-msw-kind">${KIND_LABEL[kind]}</span>${l.boosted ? `<span class="ps-badge bg-yellow-400 text-slate-950">🚀 TOP</span>` : ""}</span>
      <span class="text-[10px] font-bold text-slate-400 shrink-0">${sw.list.length} live</span>
    </div>
    <div class="ps-msw-art" data-msw-drag>
      <img src="${esc(cdn(l.image || FALLBACK_IMG, 520))}" onerror="this.src='${FALLBACK_IMG}'" alt="${esc(l.card_name)}" draggable="false" class="${photo ? "object-cover" : "object-contain"}" />
      ${cond ? `<span class="ps-badge ps-badge-cond ps-msw-cond">${esc(cond)}</span>` : ""}
      <span class="ps-msw-hint left" aria-hidden="true">➡️ Weiter</span><span class="ps-msw-hint right" aria-hidden="true">➡️ Weiter</span>
    </div>
    <div class="ps-msw-info">
      <h3 class="ps-msw-title" title="${esc(l.card_name)}">${esc(l.card_name)}</h3>
      <p class="text-[11px] text-slate-400">${code ? `<span class="font-black text-slate-200">${esc(code)}</span> · ` : ""}${cond ? `<span class="font-bold text-slate-200">${esc(cond)}</span> · ` : ""}📍 ${esc(l.city || "–")}</p>
      <p class="text-[11px] text-slate-300 flex items-center justify-center gap-1 flex-wrap">👤 <button type="button" onclick="PS.openUser(${jsArg(l.user_id)})" class="font-black text-white hover:text-yellow-300">${esc(l.seller || "Sammler")}</button>${rankBadge(rank)}${l.seller_founder ? `<span class="ps-founder-chip" title="Verifizierter Gründer-Sammler">🏅</span>` : ""}${l.rating_count ? `<span class="text-amber-300">⭐ ${Number(l.rating) || 0} (${Number(l.rating_count) || 0})</span>` : ""}</p>
      <p class="ps-msw-price"><strong class="${Number(l.price) > 0 ? "" : "trade"}">${esc(price)}</strong>${l.market_price ? `<span class="text-[10px] text-slate-400"> · CM-Trend ${eur(l.market_price)}</span>` : ""}${l.buy_now ? `<span class="block text-[10px] text-cyan-300 font-bold">🔒 Sofort-Kauf mit Käuferschutz${Number(l.shipping_cents) ? ` · + ${eur(Number(l.shipping_cents) / 100)} Versand` : ""}</span>` : ""}</p>
    </div>
    <div class="ps-msw-actions">
      <button type="button" onclick="PS.mswNext()" class="ps-msw-skip">➡️ Weiter swipen</button>
      ${buy}
      <button type="button" onclick="PS.mswTrade(${id})" class="ps-msw-trade" ${own ? "disabled" : ""}>🔄 Tauschen</button>
    </div>
    <div class="flex items-center justify-between text-[11px] font-bold text-slate-400 px-1">
      <button type="button" onclick="PS.mswPrev()" ${sw.pos <= 0 ? "disabled" : ""} class="hover:text-white disabled:opacity-30">‹ Zurück</button>
      <span class="hidden sm:inline text-[10px] text-slate-500">Wischen oder ← → · Enter = kaufen</span>
      <button type="button" onclick="PS.openListing(${id})" class="hover:text-white">Alle Details ›</button>
    </div>
  </article>`;
}

function renderSwipe(stage) {
  const l = sw.deck[sw.pos];
  if (!l) { stage.innerHTML = ""; return; }
  stage.innerHTML = cardHtml(l);
  const nxt = sw.deck[sw.pos + 1];
  if (nxt?.image) { try { const im = new Image(); im.src = cdn(nxt.image, 520); } catch {} }
  bindDrag(stage.querySelector("[data-msw-drag]"), stage.querySelector(".ps-msw-card"), Number(l.id));
}

/** Karte ziehen: links oder rechts wischen = weiter, kurz antippen = Details. */
function bindDrag(el, card, id) {
  if (!el || !card) return;
  let sx = 0, sy = 0, dx = 0, active = false, dragging = false, pid = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; dx = 0; active = true; dragging = false; pid = e.pointerId;
  });
  el.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; try { el.setPointerCapture(pid); } catch {} }
    if (dragging) {
      card.style.transition = "none";
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      card.dataset.drag = dx < 0 ? "left" : "right";
      card.classList.toggle("ps-msw-armed", Math.abs(dx) > 70);
    }
  });
  const end = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    if (!dragging) { if (e.type === "pointerup") window.PS?.openListing?.(id); return; }
    dragging = false;
    if (Math.abs(dx) > 70) { fly(card, dx < 0 ? -1 : 1); return; }
    card.style.transition = "transform .2s ease";
    card.style.transform = "";
    delete card.dataset.drag;
    card.classList.remove("ps-msw-armed");
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function fly(card, dir) {
  if (!card) { step(1); return; }
  card.style.transition = "transform .22s ease, opacity .22s ease";
  card.style.transform = `translateX(${dir * 120}%) rotate(${dir * 14}deg)`;
  card.style.opacity = "0";
  setTimeout(() => step(1), 190);
}

function step(delta) {
  if (!sw.deck.length) return;
  const next = sw.pos + delta;
  if (next < 0) return;
  if (next >= sw.deck.length) { sw.deck = nextDeck(sw.list, sw.deck[sw.pos]?.id); sw.pos = 0; }
  else sw.pos = next;
  const stage = $("ps-msw");
  if (stage) renderSwipe(stage);
}

// ---------------------------------------------------------------------------
// 📁 Händler-Ordner
// ---------------------------------------------------------------------------
function folderHtml() {
  const cities = cityOptions(sw.list);
  const f = sw.folders[sw.folder];
  const n = sw.folders.length;
  if (!f) return "";
  return `<div class="ps-card ps-msw-fhead p-3 space-y-2">
    <div class="flex items-center gap-2">
      <button type="button" onclick="PS.mswFolder(-1)" class="ps-hb-nav" ${sw.folder <= 0 ? "disabled" : ""} aria-label="Vorheriger Ordner">‹</button>
      <div class="flex-1 min-w-0 text-center">
        <p class="text-[10px] font-black uppercase tracking-wide text-slate-400">📁 Ordner ${sw.folder + 1} von ${n}</p>
        <p class="text-sm font-black text-white truncate">${esc(f.seller)}</p>
        <p class="text-[11px] text-slate-300 flex items-center justify-center gap-1 flex-wrap"><span class="ps-msw-kind">${KIND_LABEL[f.kind]}</span>${rankBadge(f.rank)}<span>📍 ${esc(f.city || "–")}</span><span>· ${f.listings.length} ${f.listings.length === 1 ? "Karte" : "Karten"}</span></p>
      </div>
      <button type="button" onclick="PS.mswFolder(1)" class="ps-hb-nav" ${sw.folder >= n - 1 ? "disabled" : ""} aria-label="Nächster Ordner">›</button>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-[11px]">
      <label class="flex items-center gap-1 text-slate-400 min-w-0"><span class="shrink-0">Ordner</span>
        <select onchange="PS.mswFolderPick(this.value)" class="ps-mb-select" aria-label="Händler-Ordner wählen">
          ${sw.folders.slice(0, 120).map((x, i) => `<option value="${i}" ${i === sw.folder ? "selected" : ""}>${x.kind === "dealer" ? "🏪" : "🃏"} ${esc(String(x.seller).slice(0, 28))} (${x.listings.length})</option>`).join("")}
        </select></label>
      <label class="flex items-center gap-1 text-slate-400 min-w-0"><span class="shrink-0">📍 Stadt</span>
        <select onchange="PS.mswCity(this.value)" class="ps-mb-select" aria-label="Nach Stadt filtern">
          <option value="">Alle Städte</option>${cities.slice(0, 80).map((c) => `<option value="${esc(c.id)}" ${c.id === sw.city ? "selected" : ""}>${esc(c.label)} (${Number(c.n)})</option>`).join("")}
        </select></label>
      <button type="button" onclick="PS.openUser(${jsArg(f.userId)})" class="ml-auto font-bold text-slate-300 hover:text-white">👤 Profil ›</button>
    </div>
  </div>`;
}

function computeFolders() {
  if (sw.city && !cityOptions(sw.list).some((c) => c.id === sw.city)) sw.city = "";
  sw.folders = sellerFolders(sw.list, sw.city);
  const keep = sw.folders.findIndex((f) => String(f.userId) === String(sw.folderUser));
  sw.folder = keep >= 0 ? keep : Math.max(0, Math.min(sw.folder, sw.folders.length - 1));
  sw.folderUser = sw.folders[sw.folder]?.userId ?? null;
}

/** Für den Marktplatz-Binder: im Ordner-Modus nur die Karten des offenen Ordners. */
export function scopeForBinder(list) {
  if (sw.mode !== "folder") return { list, scope: "" };
  const f = sw.folders[sw.folder];
  return f ? { list: f.listings, scope: `u:${f.userId}|${sw.city}` } : { list, scope: "" };
}

// ---------------------------------------------------------------------------
// Wird von renderMarket() mit der gefilterten Liste (Chips; Suche nur in der Direktsuche) aufgerufen.
// ---------------------------------------------------------------------------
export function renderMarketSwipe(list) {
  const d = ensureDom();
  if (!d) return;
  sw.list = Array.isArray(list) ? list : [];
  d.main.dataset.browse = sw.mode;
  if (sw.list.length) delete d.main.dataset.empty; else d.main.dataset.empty = "1";
  d.bar.innerHTML = switchHtml();
  const sig = sw.list.map((l) => l.id).sort((a, b) => a - b).join(",");
  if (sig !== sw.sig) { sw.sig = sig; rebuildDeck(); }
  if (sw.mode === "folder") { computeFolders(); d.folder.innerHTML = folderHtml(); } else d.folder.innerHTML = "";
  if (sw.mode === "swipe" && sw.list.length) renderSwipe(d.stage); else d.stage.innerHTML = "";
}

function setMode(mode, { focus = false } = {}) {
  if (!BROWSE_MODES.includes(mode)) return;
  sw.mode = mode;
  window.renderMarket?.();
  if (mode === "search" && focus) setTimeout(() => $("market-search")?.focus(), 30);
  if (mode !== "search") $("ps-msw-switch")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function onKey(e) {
  if (sw.mode !== "swipe" || $("view-map")?.classList.contains("hidden")) return;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(document.activeElement?.tagName || "") && e.key === "Enter") return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
  if (document.querySelector("body > div.fixed.inset-0:not(.hidden), .ps-binder-overlay:not(.hidden)")) return; // anderes Fenster offen
  if (!$("ps-msw")?.firstElementChild) return;
  if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (e.key === "Enter") { const l = sw.deck[sw.pos]; if (l) { e.preventDefault(); api.mswBuy(Number(l.id)); } }
}

export function initMarketSwipe() {
  document.addEventListener("keydown", onKey);
  // Reiter „Marktplatz“ öffnet immer direkt im Live-Swipe (gemischt aus allen Händler- & Sammler-Ordnern)
  window.addEventListener("ps:market-enter", () => { if (!IS_STAGE) sw.mode = "swipe"; });
}

const api = {
  marketBrowse: (m) => setMode(m, { focus: true }),
  mswNext: () => fly($("ps-msw")?.querySelector(".ps-msw-card"), 1),
  mswPrev: () => step(-1),
  mswBuy: (id) => {
    const l = sw.list.find((x) => Number(x.id) === Number(id)) || state.listings?.find((x) => Number(x.id) === Number(id));
    if (!l) return;
    if (l.user_id === state.user?.id) return window.PS?.openListing?.(id);
    if (l.buy_now) return window.PS?.openBuy?.(Number(l.id));
    return window.PS?.requestTrade?.(Number(l.id));
  },
  mswTrade: (id) => window.PS?.requestTrade?.(Number(id)),
  mswFolder: (delta) => {
    const i = Math.max(0, Math.min(sw.folders.length - 1, sw.folder + Number(delta || 0)));
    if (i === sw.folder) return;
    sw.folder = i; sw.folderUser = sw.folders[i]?.userId ?? null;
    window.renderMarket?.();
  },
  mswFolderPick: (v) => { const i = Number(v); if (!Number.isInteger(i) || !sw.folders[i]) return; sw.folder = i; sw.folderUser = sw.folders[i].userId; window.renderMarket?.(); },
  mswCity: (v) => { sw.city = normCity(v).slice(0, 60); sw.folder = 0; sw.folderUser = null; window.renderMarket?.(); },
};
export const marketSwipeApi = api;
