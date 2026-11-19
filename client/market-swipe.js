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

function cardHtml(l, under = false) {
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
  return `<article class="${under ? "ps-msw-under" : "ps-msw-card"}" ${under ? `aria-hidden="true" inert` : `data-msw-card="${id}"`}>
    <div class="ps-msw-head">
      <span class="flex items-center gap-1 min-w-0"><span class="ps-msw-kind">${KIND_LABEL[kind]}</span>${l.boosted ? `<span class="ps-badge bg-yellow-400 text-slate-950">🚀 TOP</span>` : ""}</span>
      <span class="text-[10px] font-bold text-slate-400 shrink-0">${sw.list.length} live</span>
    </div>
    <div class="ps-msw-art"${under ? "" : " data-msw-drag"}>
      <img src="${esc(cdn(l.image || FALLBACK_IMG, 520))}" onerror="this.src='${FALLBACK_IMG}'" alt="${esc(l.card_name)}" draggable="false" class="${photo ? "object-cover" : "object-contain"}" />
      ${cond ? `<span class="ps-badge ps-badge-cond ps-msw-cond">${esc(cond)}</span>` : ""}
      <span class="ps-msw-holo" aria-hidden="true"></span>
      <span class="ps-msw-hint left" aria-hidden="true">✕ Weiter</span><span class="ps-msw-hint right" aria-hidden="true">🔎 Deal öffnen</span>
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
      <span class="hidden sm:inline text-[10px] text-slate-500">← weiter · → Deal öffnen · Enter = kaufen</span>
      <button type="button" onclick="PS.openListing(${id})" class="hover:text-white">Alle Details ›</button>
    </div>
  </article>`;
}

function renderSwipe(stage) {
  const l = sw.deck[sw.pos];
  if (!l) { stage.innerHTML = ""; return; }
  const nxt = sw.deck[sw.pos + 1];
  // Echter Stapel: die nächste Karte liegt schon darunter und hebt sich beim Wegziehen stufenlos nach oben
  stage.innerHTML = `<div class="ps-msw-stack">${nxt ? cardHtml(nxt, true) : ""}${cardHtml(l)}</div>`;
  const after = sw.deck[sw.pos + 2];
  if (after?.image) { try { const im = new Image(); im.src = cdn(after.image, 520); } catch {} }
  bindDrag(stage.querySelector(".ps-msw-card [data-msw-drag]"), stage.querySelector(".ps-msw-card"), Number(l.id), stage.querySelector(".ps-msw-under"));
}

const haptic = (ms) => { try { navigator.vibrate?.(ms); } catch {} };
const REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

/** Darunterliegende Karte passend zum Zug-Fortschritt p (0 … 1) anheben. */
function liftUnder(under, p, transition = "") {
  if (!under) return;
  under.style.transition = transition;
  const k = Math.max(0, Math.min(1, p));
  under.style.transform = `translate3d(0, ${(1 - k) * 16}px, 0) scale(${0.93 + 0.07 * k})`;
  under.style.opacity = String(0.55 + 0.45 * k);
}

/**
 * Karten-Physik wie echte Karten in der Hand:
 *   • die oberste Karte folgt dem Finger 1:1; Neigung je nach Griffpunkt (oben angefasst kippt sie mit, unten dagegen)
 *   • 3D-Holo-Schimmer + leichtes Kippen beim Ziehen; Richtungs-Hinweis blendet stufenlos ein (← Weiter · → Deal öffnen)
 *   • die nächste Karte darunter skaliert/hebt sich live mit
 *   • Loslassen: schneller Wisch (Velocity) oder weiter Zug → Karte gleitet mit Schwung hinaus (+ Haptik), sonst Feder-Zurückschnappen
 *   • kurzer Tipp = Details. touch-action: pan-y → senkrechtes Scrollen bleibt beim Browser, keine Android-Gesten-Konflikte.
 */
function bindDrag(el, card, id, under) {
  if (!el || !card) return;
  let sx = 0, sy = 0, dx = 0, dy = 0, active = false, dragging = false, pid = null, grabSign = 1, width = 320, samples = [];
  liftUnder(under, 0);
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const r = card.getBoundingClientRect();
    width = Math.max(200, r.width);
    // Oben angefasst → Karte dreht mit der Bewegung, unten angefasst → dagegen (wie ein echtes Kartenblatt)
    grabSign = e.clientY < r.top + r.height * 0.5 ? 1 : -1;
    sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; active = true; dragging = false; pid = e.pointerId; samples = [[e.timeStamp, e.clientX]];
  });
  el.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) { if (Math.abs(dy) > 12) active = false; return; }
      dragging = true;
      try { el.setPointerCapture(pid); } catch {}
      card.classList.add("ps-msw-dragging");
    }
    samples.push([e.timeStamp, e.clientX]);
    if (samples.length > 6) samples.shift();
    const p = Math.min(1, Math.abs(dx) / (width * 0.42));
    const rot = Math.max(-24, Math.min(24, (dx / 16) * grabSign));
    const ty = dy * 0.18; // leichtes Mitgehen nach oben/unten, ohne die Seite zu scrollen
    card.style.transition = "none";
    card.style.transform = `translate3d(${dx}px, ${ty}px, 0) rotate(${rot}deg)`;
    card.style.setProperty("--p", p.toFixed(3));
    card.style.setProperty("--tilt", `${Math.max(-14, Math.min(14, dx / 14)).toFixed(2)}deg`);
    card.style.setProperty("--holo-x", `${Math.max(0, Math.min(100, 50 + (dx / width) * 90)).toFixed(1)}%`);
    card.style.setProperty("--holo-o", Math.min(0.85, 0.2 + p).toFixed(3));
    card.dataset.drag = dx < 0 ? "left" : "right";
    card.classList.toggle("ps-msw-armed", p >= 1);
    liftUnder(under, p, "none");
  });
  const end = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    if (!dragging) { if (e.type === "pointerup") window.PS?.openListing?.(id); return; }
    dragging = false;
    const now = e.timeStamp || performance.now();
    const recent = samples.filter(([t]) => now - t < 110);
    const a = recent[0] || samples[0], z = samples[samples.length - 1];
    const vx = a && z && z[0] > a[0] ? (z[1] - a[1]) / (z[0] - a[0]) : 0; // px/ms
    const dir = Math.abs(vx) > 0.5 ? Math.sign(vx) : Math.sign(dx);
    const far = Math.abs(dx) > width * 0.42;
    const flick = Math.abs(vx) > 0.5 && Math.abs(dx) > 24 && Math.sign(vx) === Math.sign(dx);
    if (e.type !== "pointercancel" && dir && (far || flick)) { throwCard(card, dir, vx, { open: dir > 0, id, under, grabSign, dx, width }); return; }
    // Feder-Zurückschnappen (leichtes Überschwingen)
    const t = REDUCED ? "none" : "transform .42s cubic-bezier(.3,1.6,.5,1)";
    card.style.transition = t;
    card.style.transform = "";
    card.style.setProperty("--p", "0"); card.style.setProperty("--holo-o", "0"); card.style.setProperty("--tilt", "0deg");
    delete card.dataset.drag;
    card.classList.remove("ps-msw-armed", "ps-msw-dragging");
    liftUnder(under, 0, REDUCED ? "none" : "transform .42s cubic-bezier(.3,1.6,.5,1), opacity .3s ease");
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/** Karte mit Schwung hinausgleiten lassen (Dauer aus der Wisch-Geschwindigkeit); rechts = Deal öffnen, links = weiter. */
function throwCard(card, dir, vx = 0, { open = false, id = 0, under = null, grabSign = 1, dx = 0, width = 320 } = {}) {
  if (!card) { step(1); return; }
  haptic(12);
  const dist = Math.max(0, width * 1.5 - Math.abs(dx));
  const speed = Math.max(1.4, Math.abs(vx)); // px/ms
  const ms = REDUCED ? 0 : Math.round(Math.max(150, Math.min(340, dist / speed)));
  card.classList.add("ps-msw-dragging");
  card.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.7,.3,1), opacity ${ms}ms ease-in` : "none";
  card.style.transform = `translate3d(${dir * width * 1.5}px, -24px, 0) rotate(${dir * 26 * grabSign}deg)`;
  card.style.opacity = "0";
  liftUnder(under, 1, ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : "none");
  setTimeout(() => { step(1); if (open && id) window.PS?.openListing?.(id); }, ms);
}

function fly(card, dir) {
  throwCard(card, dir, 0, { under: $("ps-msw")?.querySelector(".ps-msw-under"), width: card?.getBoundingClientRect().width || 320 });
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
  mswNext: () => fly($("ps-msw")?.querySelector(".ps-msw-card"), -1),
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
