// PokeSwipe Radar – Marktplatz-Ansichten „📖 16er Binder“ (4×4) und „👆 Swipe (Hochschieben)“.
//   • Umschalter oben im Marktplatz: 📖 16er Binder | 👆 Swipe (Hochschieben) | 🔀 Standard (bisherige Ansichten, unverändert)
//   • Typ-Umschaltung „Alle | 🃏 Einzelkarten | 📦 Pokémon-Artikel“ (+ Unterkategorien) – gilt in allen Ansichten
//   • 16er Binder: 16 gemischte Inserate auf einer dunklen Ordnerseite, Preisetikett (Deals unter Cardmarket grün),
//     Folien-Look; Schnellfilter Alle · Nur Deals · In meiner Nähe · Karten · Artikel. Antippen → Detail-Sheet mit
//     „⚡ Spontan mitnehmen / Kaufen“ und „💬 Verkäufer fragen“ – Schließen führt exakt auf dieselbe Ordnerseite zurück.
//     Horizontal ziehen = echtes 3D-Umblättern am Finger (Falz-Schatten, Lichtreflex, Federn unter 30 %, Schwung, Haptik).
//   • Swipe: die aktuelle Karte folgt beim Hochschieben 1:1 dem Finger (Perspektive, Schatten, Holo-Schimmer), die nächste
//     wächst darunter heran; Velocity-Tracking mit Momentum, halbes Ziehen federt zurück. Pointer-Events +
//     touch-action: none + overscroll-behavior: contain → kein Pull-to-Refresh auf Android.
// Die bisherigen Marktplatz-Ansichten (Live-Swipe, Händler-Ordner, Direktsuche, 3×3-Binder, Raster) bleiben unverändert.
import { $, esc, jsArg, eur, cdn, state, api, toast, handleError, requireLogin, FALLBACK_IMG } from "./core.js";
import { conditionShort, filterListings } from "./market-filter-logic.js";
import {
  M16_MODES, M16_PAGE, quickFilter, mixListings, pages16, clampPage, turnDecision, swipeDecision, velocityOf, springStep, rubber, isDeal,
} from "./market16-logic.js";
import { ITEM_CATEGORIES, listingTypeOf, itemCategoryLabel, itemCategoryIcon, itemConditionLabel, filterByType } from "../server/item-listing-logic.ts";

const MODE_KEY = "ps_m16_mode";
const IS_STAGE = (() => { try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; } })();
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const haptic = () => { try { navigator.vibrate?.(10); } catch {} };
const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16));

const m = {
  mode: IS_STAGE ? "std" : (["binder", "swipe"].includes(lsGet(MODE_KEY)) ? lsGet(MODE_KEY) : "std"),
  type: "all", category: "", quick: "all",
  base: [], q: "", list: [], page: 0, pos: 0, posId: null,
  seed: Math.floor(Math.random() * 1e6) + 1,
  sig: "", busy: false, pending: false, justDragged: false, sheetId: null,
};

const isPhoto = (src) => String(src || "").startsWith("/api/images/");
const imgOf = (l, w) => esc(cdn(l?.image || FALLBACK_IMG, w));
const priceLabel = (l) => (Number(l?.price) > 0 ? eur(l.price) : "Tausch");
const dealPct = (l) => (Number(l?.market_price) > 0 && Number(l?.price) > 0 ? Math.round((1 - Number(l.price) / Number(l.market_price)) * 100) : 0);
const condText = (l) => (listingTypeOf(l) === "item" ? itemConditionLabel(l.item_condition) || conditionShort(l.condition) : conditionShort(l.condition));

/** Typ-Filter (🃏/📦) auch für die bisherigen Ansichten – „Alle“ lässt die Liste unverändert. */
export function m16TypeFilter(list) {
  return m.type === "all" ? list : filterByType(Array.isArray(list) ? list : [], m.type, m.category);
}

// ---------------------------------------------------------------------------
// Gerüst
// ---------------------------------------------------------------------------
function ensureDom() {
  const main = $("ps-market-main");
  const toolbar = main?.querySelector(".ps-market-toolbar");
  if (!main || !toolbar) return null;
  let root = $("ps-m16");
  if (!root) {
    root = document.createElement("div");
    root.id = "ps-m16";
    root.className = "ps-m16 space-y-2";
    root.innerHTML = `<div data-m16-bar class="space-y-2"></div><div data-m16-stage></div>`;
    toolbar.insertAdjacentElement("beforebegin", root);
  }
  return { main, root, bar: root.querySelector("[data-m16-bar]"), stage: root.querySelector("[data-m16-stage]") };
}

function barHtml() {
  const tab = (k, label, sub) => `<button type="button" role="tab" data-m16-mode="${k}" aria-selected="${m.mode === k}" onclick="PS.m16Mode('${k}')">
    <span class="ps-m16-tab-l">${label}</span><span class="ps-m16-tab-s">${sub}</span></button>`;
  const seg = (k, label) => `<button type="button" data-m16-type="${k}" aria-pressed="${m.type === k}" onclick="PS.m16Type('${k}')">${label}</button>`;
  const cats = m.type === "item" ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="toolbar" aria-label="Artikel-Unterkategorie">
      <button type="button" class="ps-chip" aria-pressed="${!m.category}" onclick="PS.m16Category('')">Alle Artikel</button>
      ${ITEM_CATEGORIES.map((c) => `<button type="button" class="ps-chip" aria-pressed="${m.category === c.id}" onclick="PS.m16Category('${c.id}')">${c.icon} ${esc(c.label)}</button>`).join("")}</div>` : "";
  return `<div class="ps-m16-switch" role="tablist" aria-label="Marktplatz-Ansicht">${tab("binder", "📖 16er Binder", "4×4 Ordnerseite")}${tab("swipe", "👆 Swipe", "Hochschieben")}${tab("std", "🔀 Standard", "bisherige Ansicht")}</div>
    <div class="ps-m16-types" role="group" aria-label="Kategorie">${seg("all", "Alle")}${seg("card", "🃏 Einzelkarten")}${seg("item", "📦 Pokémon-Artikel")}</div>${cats}`;
}

function quickHtml() {
  const c = (on, label, call) => `<button type="button" class="ps-chip" aria-pressed="${on}" onclick="${call}">${label}</button>`;
  return `<div class="ps-m16-quick flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="toolbar" aria-label="Schnellfilter">
    ${c(m.quick === "all" && m.type === "all", "Alle", "PS.m16Quick('all')")}
    ${c(m.quick === "deals", "🔥 Nur Deals", "PS.m16Quick('deals')")}
    ${c(m.quick === "near", "📍 In meiner Nähe", "PS.m16Quick('near')")}
    ${c(m.type === "card", "🃏 Karten", "PS.m16TypeToggle('card')")}
    ${c(m.type === "item", "📦 Artikel", "PS.m16TypeToggle('item')")}
  </div>`;
}

function emptyHtml() {
  const near = m.quick === "near" && !state.me?.city;
  return `<div class="ps-card p-6 text-center text-xs text-slate-300 space-y-2">
    <p class="text-2xl" aria-hidden="true">${m.type === "item" ? "📦" : "🃏"}</p>
    <p>${near ? "Trage deine Stadt im Profil ein, damit „In meiner Nähe“ passende Angebote findet." : m.type === "item" ? "Noch keine Pokémon-Artikel in dieser Auswahl." : "Keine Angebote für diesen Filter."}</p>
    <div class="flex flex-wrap justify-center gap-1.5">
      <button type="button" onclick="PS.m16Reset()" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">Alle Angebote zeigen</button>
      <button type="button" onclick="PS.marketTab('sell')" class="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl">🏷️ Selbst inserieren</button>
    </div></div>`;
}

// ---------------------------------------------------------------------------
// Einstieg: wird von renderMarket() mit der gefilterten Liste aufgerufen
// ---------------------------------------------------------------------------
export function renderMarket16(list, q = "") {
  const d = ensureDom();
  if (!d) return;
  m.base = Array.isArray(list) ? list : [];
  m.q = String(q || "");
  d.bar.innerHTML = barHtml();
  const on = m.mode !== "std";
  d.main.classList.toggle("ps-m16-on", on);
  d.main.dataset.m16 = m.mode;
  if (!on) { d.stage.innerHTML = ""; m.sig = ""; return; }
  if (m.busy) { m.pending = true; return; }
  draw(d.stage);
}

function computeList() {
  const searched = m.q ? filterListings(m.base, { q: m.q, chip: "all", buyFirst: false }) : m.base;
  const filtered = quickFilter(searched, { quick: m.quick, type: m.type, category: m.category, myCity: state.me?.city || "" });
  return mixListings(filtered, m.seed);
}

function draw(stage) {
  m.list = computeList();
  const ids = m.list.map((l) => l.id).join(",");
  if (m.mode === "binder") {
    const pages = pages16(m.list);
    m.page = clampPage(m.page, pages.length);
    const sig = `b|${ids}|${m.page}|${m.quick}|${m.type}|${m.category}`;
    if (sig === m.sig && stage.querySelector("[data-m16-book]")) return;
    m.sig = sig;
    stage.innerHTML = quickHtml() + (m.list.length ? binderHtml(pages) : emptyHtml());
    if (m.list.length) bindBinder(stage.querySelector("[data-m16-book]"));
  } else {
    if (m.posId != null) { const i = m.list.findIndex((l) => Number(l.id) === Number(m.posId)); if (i >= 0) m.pos = i; }
    m.pos = Math.max(0, Math.min(m.list.length - 1, m.pos));
    m.posId = m.list[m.pos]?.id ?? null;
    const sig = `s|${ids}|${m.pos}|${m.quick}|${m.type}|${m.category}`;
    if (sig === m.sig && stage.querySelector("[data-vs]")) return;
    m.sig = sig;
    stage.innerHTML = quickHtml() + (m.list.length ? swipeHtml() : emptyHtml());
    if (m.list.length) bindSwipe(stage.querySelector("[data-vs]"));
  }
}

function redraw() {
  const d = ensureDom();
  if (!d || m.mode === "std") return;
  m.sig = "";
  draw(d.stage);
}

// ---------------------------------------------------------------------------
// 📖 16er Binder (4×4)
// ---------------------------------------------------------------------------
function pocketHtml(l) {
  if (!l) return `<div class="ps-m16-pocket ps-m16-pocket-empty" aria-hidden="true"></div>`;
  const deal = isDeal(l);
  const pct = dealPct(l);
  const item = listingTypeOf(l) === "item";
  return `<button type="button" class="ps-m16-pocket ${deal ? "is-deal" : ""}" data-m16-id="${Number(l.id)}" aria-label="${esc(l.card_name)} – ${esc(priceLabel(l))}">
    <img src="${imgOf(l, 240)}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" draggable="false" class="${isPhoto(l.image) ? "object-cover" : "object-contain"}" />
    ${item ? `<span class="ps-m16-kind" title="${esc(itemCategoryLabel(l.item_category))}">${itemCategoryIcon(l.item_category)}</span>` : ""}
    <span class="ps-m16-tag ${deal ? "deal" : ""}">${esc(priceLabel(l))}${deal && pct >= 5 ? `<small>−${pct} %</small>` : ""}</span>
  </button>`;
}
const gridHtml = (page) => `<div class="ps-m16-grid">${(page || []).map(pocketHtml).join("")}</div>`;

function binderHtml(pages) {
  const n = pages.length;
  return `<div class="ps-m16-binder" data-m16-binder>
    <div class="ps-m16-book" data-m16-book tabindex="0" aria-roledescription="Ordnerseite" aria-label="Ordnerseite ${m.page + 1} von ${n} – horizontal wischen zum Blättern, Fach antippen für Details">
      <div class="ps-m16-rings" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="ps-m16-page ps-m16-under" data-under>${gridHtml(pages[m.page])}</div>
      <div class="ps-m16-fold" data-fold aria-hidden="true"></div>
      <div class="ps-m16-leaf" data-leaf aria-hidden="true" hidden>
        <div class="ps-m16-face ps-m16-page ps-m16-front" data-front></div>
        <div class="ps-m16-face ps-m16-back"></div>
        <div class="ps-m16-glare" data-glare></div>
      </div>
    </div>
    <div class="ps-m16-foot">
      <button type="button" class="ps-m16-nav" onclick="PS.m16Turn(-1)" ${m.page > 0 ? "" : "disabled"} aria-label="Vorherige Ordnerseite">‹</button>
      <span class="text-[11px] font-black text-slate-200">Seite ${m.page + 1} / ${n} · ${m.list.length} Angebote</span>
      <button type="button" class="ps-m16-nav" onclick="PS.m16Turn(1)" ${m.page < n - 1 ? "" : "disabled"} aria-label="Nächste Ordnerseite">›</button>
    </div>
    <p class="text-[10px] text-slate-500 text-center">Seite mit dem Finger umblättern · Fach antippen = spontan mitnehmen</p>
  </div>`;
}

/** Zustand der umschlagenden Seite für Fortschritt p (0…1) in Richtung dir (+1 vor, −1 zurück). */
function paintTurn(book, dir, p) {
  const leaf = book.querySelector("[data-leaf]");
  const fold = book.querySelector("[data-fold]");
  const glare = book.querySelector("[data-glare]");
  const front = book.querySelector("[data-front]");
  const t = Math.max(0, Math.min(1, p));
  const prog = dir > 0 ? t : 1 - t; // 0 = flach rechts, 1 = ganz umgeschlagen
  const angle = -180 * prog;
  const lift = Math.sin(prog * Math.PI);
  leaf.style.transform = `translateZ(${(lift * 18).toFixed(1)}px) rotateY(${angle.toFixed(2)}deg) skewY(${(lift * -1.4).toFixed(2)}deg)`;
  leaf.style.boxShadow = `${(-lift * 26).toFixed(0)}px 10px ${(20 + lift * 40).toFixed(0)}px rgba(0,0,0,${(0.25 + lift * 0.4).toFixed(2)})`;
  front.style.setProperty("--shade", (lift * 0.55).toFixed(3));
  fold.style.opacity = (lift * 0.85).toFixed(3);
  fold.style.width = `${(12 + lift * 30).toFixed(1)}%`;
  glare.style.opacity = (0.15 + lift * 0.75).toFixed(3);
  glare.style.backgroundPosition = `${(120 - prog * 140).toFixed(1)}% 0`;
}

function bindBinder(book) {
  if (!book) return;
  const under = book.querySelector("[data-under]");
  const leaf = book.querySelector("[data-leaf]");
  const front = book.querySelector("[data-front]");
  const pages = () => pages16(m.list);
  let drag = null;

  const setup = (dir) => {
    const ps = pages();
    if (dir > 0) { under.innerHTML = gridHtml(ps[m.page + 1]); front.innerHTML = gridHtml(ps[m.page]); }
    else { under.innerHTML = gridHtml(ps[m.page]); front.innerHTML = gridHtml(ps[m.page - 1]); }
    leaf.hidden = false;
    book.classList.add("is-turning");
  };
  const reset = () => {
    leaf.hidden = true;
    leaf.style.transform = ""; leaf.style.boxShadow = "";
    book.querySelector("[data-fold]").style.opacity = "0";
    book.style.transform = "";
    book.classList.remove("is-turning");
    under.innerHTML = gridHtml(pages()[m.page]);
  };
  const finish = (committed, dir) => {
    m.busy = false;
    if (committed) { m.page = clampPage(m.page + dir, pages().length); haptic(); }
    if (committed || m.pending) { m.pending = false; redraw(); } else reset();
    if (committed) $("ps-m16")?.querySelector("[data-m16-book]")?.focus?.({ preventScroll: true });
  };
  /** Federnde Animation des Fortschritts (Gewicht & Schwung beim Umschlagen, Zurückschnappen unter 30 %). */
  const animate = (dir, from, target, v0) => {
    m.busy = true;
    if (reduceMotion()) { paintTurn(book, dir, target); return finish(target === 1, dir); }
    let x = from, v = v0, last = 0;
    const opts = target === 1 ? { stiffness: 210, damping: 24 } : { stiffness: 300, damping: 24 };
    const tick = (now) => {
      const dt = last ? now - last : 16; last = now;
      ({ x, v } = springStep(x, v, target, dt, opts));
      if (target === 1 && x >= 1) x = 1;
      if (target === 0 && x <= 0) x = 0;
      paintTurn(book, dir, x);
      if ((target === 1 && x >= 1) || (target === 0 && x <= 0) || (Math.abs(x - target) < 0.002 && Math.abs(v) < 0.02)) return finish(target === 1, dir);
      raf(tick);
    };
    raf(tick);
  };
  book._m16turn = (dir) => {
    if (m.busy) return;
    const n = pages().length;
    if ((dir > 0 && m.page >= n - 1) || (dir < 0 && m.page <= 0)) return;
    setup(dir); paintTurn(book, dir, 0); animate(dir, 0, 1, 2.2);
  };

  book.addEventListener("pointerdown", (e) => {
    if (m.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: 0, active: false, edge: false, samples: [{ t: e.timeStamp, x: e.clientX }] };
  });
  book.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    drag.samples.push({ t: e.timeStamp, x: e.clientX });
    if (drag.samples.length > 8) drag.samples.shift();
    if (!drag.active) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) { if (Math.abs(dy) > 12) drag = null; return; }
      drag.active = true;
      drag.dir = dx < 0 ? 1 : -1;
      const n = pages().length;
      drag.edge = (drag.dir > 0 && m.page >= n - 1) || (drag.dir < 0 && m.page <= 0);
      try { book.setPointerCapture(e.pointerId); } catch {}
      if (!drag.edge) setup(drag.dir);
    }
    e.preventDefault();
    const w = book.clientWidth || 1;
    if (drag.edge) { book.style.transform = `translateX(${rubber(dx, w * 0.25).toFixed(1)}px) rotateY(${(rubber(dx, w * 0.25) / w * 18).toFixed(2)}deg)`; return; }
    const p = Math.max(0, Math.min(1, (-dx * drag.dir) / (w * 0.9)));
    drag.p = p;
    paintTurn(book, drag.dir, p);
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.active) return;
    m.justDragged = true; setTimeout(() => { m.justDragged = false; }, 60);
    if (d.edge) { book.style.transition = "transform .35s cubic-bezier(.2,1.4,.4,1)"; book.style.transform = ""; setTimeout(() => { book.style.transition = ""; }, 380); return; }
    const w = book.clientWidth || 1;
    const vx = velocityOf(d.samples, "x"); // px/ms
    const vAlong = -vx * d.dir;
    const decision = e.type === "pointercancel" ? "back" : turnDecision(d.p || 0, vAlong);
    animate(d.dir, d.p || 0, decision === "commit" ? 1 : 0, (vAlong * 1000) / (w * 0.9));
  };
  book.addEventListener("pointerup", up);
  book.addEventListener("pointercancel", up);
  book.addEventListener("click", (e) => {
    if (m.justDragged || m.busy) { e.preventDefault(); return; }
    const pocket = e.target.closest?.("[data-m16-id]");
    if (pocket) openSheet(Number(pocket.dataset.m16Id));
  });
  book.addEventListener("dragstart", (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// 👆 Swipe (Hochschieben)
// ---------------------------------------------------------------------------
function vcardHtml(l, role) {
  if (!l) return `<div class="ps-m16-vcard ps-m16-vend" data-vs-${role}><div class="text-center space-y-2 p-6"><p class="text-3xl" aria-hidden="true">🎉</p><p class="text-sm font-black text-white">Alle ${m.list.length} Angebote gesehen</p><p class="text-[11px] text-slate-400">Zieh runter für die vorherigen oder fang von vorn an.</p></div></div>`;
  const deal = isDeal(l), pct = dealPct(l), item = listingTypeOf(l) === "item";
  const cond = condText(l);
  return `<article class="ps-m16-vcard ${deal ? "is-deal" : ""}" data-vs-${role} data-id="${Number(l.id)}">
    <div class="ps-m16-vimg"><img src="${imgOf(l, 520)}" onerror="this.src='${FALLBACK_IMG}'" alt="" draggable="false" class="${isPhoto(l.image) ? "object-cover" : "object-contain"}" /><span class="ps-m16-holo" aria-hidden="true"></span>
      <span class="ps-m16-vbadges">${item ? `<span class="ps-badge bg-violet-500 text-white">${itemCategoryIcon(l.item_category)} ${esc(itemCategoryLabel(l.item_category))}</span>` : `<span class="ps-badge bg-slate-800 text-slate-100">🃏 Karte</span>`}${cond ? `<span class="ps-badge ps-badge-cond">${esc(cond)}</span>` : ""}${l.buy_now ? `<span class="ps-badge bg-cyan-400 text-slate-950">🔒 Käuferschutz</span>` : ""}</span>
    </div>
    <div class="ps-m16-vbody">
      <h4 class="text-sm font-black text-white truncate" title="${esc(l.card_name)}">${esc(l.card_name)}</h4>
      <div class="flex items-baseline justify-between gap-2">
        <span class="ps-m16-vprice ${deal ? "deal" : ""}">${esc(priceLabel(l))}${deal && pct >= 5 ? ` <small>−${pct} % unter CM</small>` : ""}</span>
        ${l.market_price ? `<span class="text-[10px] text-slate-400">CM ${eur(l.market_price)}</span>` : ""}
      </div>
      <p class="text-[11px] text-slate-400 truncate">📍 ${esc(l.city || "–")}${l.seller ? ` · 👤 ${esc(l.seller)}` : ""}</p>
    </div>
  </article>`;
}

function swipeHtml() {
  const cur = m.list[m.pos], next = m.list[m.pos + 1] || null, prev = m.list[m.pos - 1] || null;
  const own = cur && cur.user_id === state.user?.id;
  return `<div class="ps-m16-vs" data-vs aria-roledescription="Kartenstapel" aria-label="Angebot ${m.pos + 1} von ${m.list.length} – hochschieben für das nächste, antippen für Details" tabindex="0">
      ${m.pos < m.list.length - 1 || m.list.length > 1 ? vcardHtml(next, "next") : ""}
      ${vcardHtml(cur, "cur")}
      ${prev ? vcardHtml(prev, "prev") : ""}
    </div>
    <div class="ps-m16-vactions">
      <button type="button" onclick="PS.m16Buy(${Number(cur?.id)})" class="ps-m16-cta">${own ? "✏️ Verwalten" : "⚡ Spontan mitnehmen"}</button>
      ${own ? "" : `<button type="button" onclick="PS.m16Like(${Number(cur?.id)})" class="ps-m16-round" aria-label="Merken">❤️</button>
      <button type="button" onclick="PS.m16Ask(${Number(cur?.id)})" class="ps-m16-round" aria-label="Verkäufer fragen">💬</button>`}
    </div>
    <p class="text-[10px] text-slate-500 text-center">👆 Hochschieben = nächstes Angebot · runterziehen = zurück · antippen = Details · ${m.pos + 1}/${m.list.length}${m.pos >= m.list.length - 1 && m.list.length > 1 ? ` · <button type="button" onclick="PS.m16Restart()" class="underline text-slate-300 font-bold">↺ Von vorn</button>` : ""}</p>`;
}

function paintStack(vs, dy) {
  const h = vs.clientHeight || 1;
  const cur = vs.querySelector("[data-vs-cur]");
  const next = vs.querySelector("[data-vs-next]");
  const prev = vs.querySelector("[data-vs-prev]");
  const up = Math.max(0, -dy / h), down = Math.max(0, dy / h);
  if (cur) {
    const tilt = Math.min(14, up * 22);
    cur.style.transform = `translate3d(0, ${dy < 0 ? dy : prev ? dy * 0.18 : dy}px, 0) rotateX(${tilt.toFixed(2)}deg) scale(${(1 - up * 0.05 - down * 0.04).toFixed(4)})`;
    cur.style.boxShadow = `0 ${(18 + up * 40).toFixed(0)}px ${(40 + up * 50).toFixed(0)}px rgba(0,0,0,${(0.45 + up * 0.25).toFixed(2)})`;
    cur.style.setProperty("--holo", `${(50 + (dy / h) * 120).toFixed(1)}%`);
    cur.style.setProperty("--holo-o", (0.35 + Math.min(0.5, up * 1.2)).toFixed(3));
  }
  if (next) {
    const g = Math.min(1, up / 0.9);
    next.style.transform = `translate3d(0, ${((1 - g) * 26).toFixed(1)}px, 0) scale(${(0.9 + g * 0.1).toFixed(4)})`;
    next.style.opacity = (0.55 + g * 0.45).toFixed(3);
    next.style.filter = `brightness(${(0.7 + g * 0.3).toFixed(3)})`;
  }
  if (prev) prev.style.transform = `translate3d(0, ${(-h * 1.08 + Math.max(0, dy)).toFixed(1)}px, 0) rotateX(${(-Math.max(0, 1 - down) * 8).toFixed(2)}deg)`;
}

function bindSwipe(vs) {
  if (!vs) return;
  paintStack(vs, 0);
  let drag = null;
  // Ältere Android-Browser: Pull-to-Refresh zusätzlich per nicht-passivem touchmove verhindern
  vs.addEventListener("touchmove", (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });

  const finish = (result) => {
    m.busy = false;
    document.documentElement.style.overscrollBehaviorY = "";
    if (result === "next") { m.pos = Math.min(m.list.length - 1, m.pos + 1); haptic(); }
    if (result === "prev") { m.pos = Math.max(0, m.pos - 1); haptic(); }
    m.posId = m.list[m.pos]?.id ?? null;
    if (result !== "back" || m.pending) { m.pending = false; redraw(); $("ps-m16")?.querySelector("[data-vs]")?.focus?.({ preventScroll: true }); }
    else paintStack(vs, 0);
  };
  /** Momentum: Karte gleitet mit der Wisch-Geschwindigkeit weiter (oder federt elastisch zurück). */
  const animate = (from, target, v0, result) => {
    m.busy = true;
    if (reduceMotion()) { paintStack(vs, target); return finish(result); }
    let y = from, v = v0, last = 0;
    const opts = result === "back" ? { stiffness: 320, damping: 22 } : { stiffness: 140, damping: 18 };
    const tick = (now) => {
      const dt = last ? now - last : 16; last = now;
      ({ x: y, v } = springStep(y, v, target, dt, opts));
      paintStack(vs, y);
      const done = result === "next" ? y <= target + 6 : result === "prev" ? y >= target - 6 : Math.abs(y - target) < 0.6 && Math.abs(v) < 8;
      if (done) return finish(result);
      raf(tick);
    };
    raf(tick);
  };
  vs._m16step = (dir) => {
    if (m.busy) return;
    const h = vs.clientHeight || 1;
    if (dir > 0 && m.pos < m.list.length - 1) animate(0, -h * 1.15, -2600, "next");
    else if (dir < 0 && m.pos > 0) animate(0, h * 1.08, 2600, "prev");
  };

  vs.addEventListener("pointerdown", (e) => {
    if (m.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest?.("button, a")) return;
    drag = { id: e.pointerId, y0: e.clientY, x0: e.clientX, dy: 0, active: false, target: e.target, samples: [{ t: e.timeStamp, y: e.clientY }] };
    try { vs.setPointerCapture(e.pointerId); } catch {}
  });
  vs.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    if (drag.samples.length > 8) drag.samples.shift();
    if (!drag.active && Math.abs(dy) < 6 && Math.abs(e.clientX - drag.x0) < 6) return;
    if (!drag.active) { drag.active = true; document.documentElement.style.overscrollBehaviorY = "none"; vs.classList.add("is-dragging"); }
    e.preventDefault();
    const h = vs.clientHeight || 1;
    const hasNext = m.pos < m.list.length - 1, hasPrev = m.pos > 0;
    drag.dy = (dy < 0 && !hasNext) || (dy > 0 && !hasPrev) ? rubber(dy, h * 0.4) : dy;
    paintStack(vs, drag.dy);
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    vs.classList.remove("is-dragging");
    if (!d.active) {
      document.documentElement.style.overscrollBehaviorY = "";
      if (e.type === "pointerup" && d.target?.closest?.("[data-vs-cur]")) { const id = Number(vs.querySelector("[data-vs-cur]")?.dataset.id); if (id) openSheet(id); }
      return;
    }
    const h = vs.clientHeight || 1;
    const vy = velocityOf(d.samples, "y");
    const r = e.type === "pointercancel" ? "back" : swipeDecision(d.dy, vy, h, { hasNext: m.pos < m.list.length - 1, hasPrev: m.pos > 0 });
    const target = r === "next" ? -h * 1.15 : r === "prev" ? h * 1.08 : 0;
    animate(d.dy, target, vy * 1000, r);
  };
  vs.addEventListener("pointerup", up);
  vs.addEventListener("pointercancel", up);
  vs.addEventListener("dragstart", (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Detail-Sheet (über dem Ordner / Stapel)
// ---------------------------------------------------------------------------
const findListing = (id) => m.list.find((x) => Number(x.id) === Number(id)) || state.listings?.find((x) => Number(x.id) === Number(id));

function sheetHtml(l) {
  const item = listingTypeOf(l) === "item";
  const deal = isDeal(l), pct = dealPct(l), own = l.user_id === state.user?.id;
  const imgs = [l.image, ...(Array.isArray(l.extra_images) ? l.extra_images : [])].filter(Boolean);
  const cond = condText(l);
  return `<div class="ps-m16-sheet-backdrop" data-m16-close></div>
  <div class="ps-m16-sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(l.card_name)}">
    <div class="ps-m16-sheet-handle" data-m16-handle aria-hidden="true"></div>
    <button type="button" class="ps-m16-sheet-x" data-m16-close aria-label="Schließen">✕</button>
    <div class="ps-m16-sheet-img"><img data-m16-main src="${esc(cdn(imgs[0] || FALLBACK_IMG, 640))}" onerror="this.src='${FALLBACK_IMG}'" alt="${esc(l.card_name)}" class="${isPhoto(imgs[0]) ? "object-cover" : "object-contain"}" /><span class="ps-m16-holo" aria-hidden="true"></span></div>
    ${imgs.length > 1 ? `<div class="flex gap-1.5 justify-center">${imgs.map((src, i) => `<button type="button" onclick="PS.m16Photo(${jsArg(src)})" class="w-12 h-12 rounded-lg overflow-hidden border border-slate-700" aria-label="Foto ${i + 1}"><img src="${esc(cdn(src, 120))}" alt="" class="w-full h-full object-cover" /></button>`).join("")}</div>` : ""}
    <div class="space-y-1.5">
      <div class="flex flex-wrap gap-1">${item ? `<span class="ps-badge bg-violet-500 text-white">${itemCategoryIcon(l.item_category)} ${esc(itemCategoryLabel(l.item_category) || "Pokémon-Artikel")}</span>` : `<span class="ps-badge bg-slate-800 text-slate-100">🃏 Einzelkarte</span>`}${cond ? `<span class="ps-badge ps-badge-cond">${esc(cond)}</span>` : ""}${deal ? `<span class="ps-badge bg-emerald-500 text-slate-950">🔥 Deal${pct >= 5 ? ` −${pct} %` : ""}</span>` : ""}${l.buy_now ? `<span class="ps-badge bg-cyan-400 text-slate-950">🔒 Käuferschutz</span>` : ""}</div>
      <h3 class="text-base font-black text-white">${esc(l.card_name)}</h3>
      <div class="flex items-baseline gap-2"><span class="ps-m16-vprice ${deal ? "deal" : ""}">${esc(priceLabel(l))}</span>${l.market_price ? `<span class="text-[11px] text-slate-400">Cardmarket ${eur(l.market_price)}</span>` : ""}${Number(l.shipping_cents) > 0 ? `<span class="text-[11px] text-slate-400">+ ${eur(Number(l.shipping_cents) / 100)} Versand</span>` : ""}</div>
      <p class="text-xs text-slate-300">📍 ${esc(l.city || "–")}${l.seller ? ` · 👤 <button type="button" onclick="PS.m16Close(); PS.openUser(${jsArg(l.user_id)})" class="underline font-bold">${esc(l.seller)}</button>` : ""}${l.verified ? ' <span class="text-cyan-300">✔ Verifiziert</span>' : ""}${l.rating_count ? ` <span class="text-amber-300">⭐ ${Number(l.rating) || 0} (${Number(l.rating_count) || 0})</span>` : ""}</p>
      ${l.want ? `<p class="text-[11px] text-amber-200">${esc(l.want)}</p>` : ""}
      ${item && l.description ? `<p class="text-xs text-slate-200 whitespace-pre-line bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">${esc(l.description)}</p>` : ""}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button type="button" onclick="PS.m16Buy(${Number(l.id)})" class="ps-m16-cta">${own ? "✏️ Inserat verwalten" : "⚡ Spontan mitnehmen / Kaufen"}</button>
      ${own ? "" : `<button type="button" onclick="PS.m16Ask(${Number(l.id)})" class="ps-m16-cta ps-m16-cta-2">💬 Verkäufer fragen</button>`}
    </div>
    <div class="flex flex-wrap justify-center gap-3 text-[11px]">
      ${own ? "" : `<button type="button" onclick="PS.m16Like(${Number(l.id)})" class="text-rose-200 font-bold">❤️ Merken</button>`}
      <button type="button" onclick="PS.m16Close(); PS.openListing(${Number(l.id)})" class="text-slate-300 font-bold underline">Alle Details & Aktionen</button>
    </div>
  </div>`;
}

function onSheetKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeSheet(); } }

function openSheet(id) {
  const l = findListing(id);
  if (!l) return;
  let el = $("ps-m16-sheet");
  if (!el) { el = document.createElement("div"); el.id = "ps-m16-sheet"; el.className = "ps-m16-sheet"; document.body.appendChild(el); }
  m.sheetId = Number(id);
  el.innerHTML = sheetHtml(l);
  el.hidden = false;
  raf(() => el.classList.add("open"));
  el.querySelectorAll("[data-m16-close]").forEach((b) => b.addEventListener("click", closeSheet));
  // Sheet nach unten wegziehen
  const panel = el.querySelector(".ps-m16-sheet-panel");
  let d = null;
  panel.addEventListener("pointerdown", (e) => { if (panel.scrollTop <= 0 && !e.target.closest("button, a")) d = { y0: e.clientY, id: e.pointerId }; });
  panel.addEventListener("pointermove", (e) => { if (!d || e.pointerId !== d.id) return; const dy = Math.max(0, e.clientY - d.y0); panel.style.transform = `translateY(${dy}px)`; });
  const end = (e) => { if (!d || e.pointerId !== d.id) return; const dy = e.clientY - d.y0; d = null; panel.style.transform = ""; if (dy > 90) closeSheet(); };
  panel.addEventListener("pointerup", end); panel.addEventListener("pointercancel", end);
  document.addEventListener("keydown", onSheetKey, true);
  setTimeout(() => el.querySelector(".ps-m16-cta")?.focus?.({ preventScroll: true }), 50);
}

function closeSheet() {
  const el = $("ps-m16-sheet");
  document.removeEventListener("keydown", onSheetKey, true);
  if (!el || el.hidden) return;
  el.classList.remove("open");
  const id = m.sheetId; m.sheetId = null;
  setTimeout(() => { el.hidden = true; el.innerHTML = ""; }, 220);
  // Zurück exakt auf dieselbe Ordnerseite / Karte (Seite bleibt erhalten, Fokus aufs angetippte Fach)
  const target = $("ps-m16")?.querySelector(`[data-m16-id="${Number(id)}"]`) || $("ps-m16")?.querySelector("[data-m16-book], [data-vs]");
  target?.focus?.({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Tastatur (nur wenn der Marktplatz sichtbar und kein Fenster offen ist)
// ---------------------------------------------------------------------------
function onKey(e) {
  if (m.mode === "std" || m.sheetId != null || $("view-map")?.classList.contains("hidden")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
  if (document.querySelector("body > div.fixed.inset-0:not(.hidden), .ps-binder-overlay:not(.hidden)")) return;
  const root = $("ps-m16");
  if (m.mode === "binder" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    const book = root?.querySelector("[data-m16-book]");
    if (!book) return;
    e.preventDefault(); e.stopPropagation();
    book._m16turn?.(e.key === "ArrowRight" ? 1 : -1);
  } else if (m.mode === "swipe" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    const vs = root?.querySelector("[data-vs]");
    if (!vs) return;
    e.preventDefault(); e.stopPropagation();
    vs._m16step?.(e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1);
  } else if (m.mode === "swipe" && e.key === "Enter" && document.activeElement?.matches?.("[data-vs]")) {
    const id = Number(root?.querySelector("[data-vs-cur]")?.dataset.id);
    if (id) { e.preventDefault(); openSheet(id); }
  }
}

export function initMarket16() {
  // Capture-Phase: Pfeiltasten gehören in den neuen Ansichten dem 16er Binder bzw. Stapel (nicht dem verdeckten Live-Swipe)
  window.addEventListener("keydown", onKey, true);
}

const rerender = () => { m.sig = ""; window.renderMarket?.(); };

export const market16Api = {
  m16Mode: (mode) => {
    if (!M16_MODES.includes(mode)) return;
    m.mode = mode; lsSet(MODE_KEY, mode); m.sig = "";
    window.renderMarket?.();
    $("ps-m16")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  },
  /** Typ setzen (Umschalter „Alle | 🃏 Einzelkarten | 📦 Pokémon-Artikel“). */
  m16Type: (t) => { m.type = t === "card" || t === "item" ? t : "all"; if (m.type !== "item") m.category = ""; m.page = 0; m.pos = 0; m.posId = null; rerender(); },
  /** Schnellfilter-Chip „🃏 Karten“ / „📦 Artikel“: erneutes Antippen hebt den Filter auf. */
  m16TypeToggle: (t) => market16Api.m16Type(m.type === t ? "all" : t),
  m16Category: (c) => { m.category = ITEM_CATEGORIES.some((x) => x.id === c) ? c : ""; m.page = 0; m.pos = 0; m.posId = null; rerender(); },
  m16Quick: (q) => {
    if (q === "all") { m.quick = "all"; m.type = "all"; m.category = ""; }
    else m.quick = m.quick === q ? "all" : q;
    if (m.quick === "near" && !state.me?.city) toast("📍 In meiner Nähe", "Trage deine Stadt im Profil ein, dann zeigen wir Angebote in deiner Nähe.");
    m.page = 0; m.pos = 0; m.posId = null; rerender();
  },
  m16Reset: () => { m.quick = "all"; m.type = "all"; m.category = ""; m.page = 0; m.pos = 0; m.posId = null; rerender(); },
  m16Turn: (dir) => $("ps-m16")?.querySelector("[data-m16-book]")?._m16turn?.(Number(dir) > 0 ? 1 : -1),
  m16Restart: () => { m.pos = 0; m.posId = m.list[0]?.id ?? null; m.sig = ""; redraw(); },
  m16Close: () => closeSheet(),
  m16Photo: (src) => { const img = $("ps-m16-sheet")?.querySelector("[data-m16-main]"); if (img) img.src = cdn(src, 640); },
  m16Open: (id) => openSheet(Number(id)),
  /** ⚡ Spontan mitnehmen: Sofort-Kauf mit Käuferschutz, sonst Anfrage – eigenes Inserat → verwalten. */
  m16Buy: (id) => {
    const l = findListing(id);
    if (!l) return;
    closeSheet();
    if (l.user_id === state.user?.id) return window.PS?.openListing?.(Number(l.id));
    if (l.buy_now) return window.PS?.openBuy?.(Number(l.id));
    return window.PS?.requestTrade?.(Number(l.id));
  },
  m16Ask: (id) => {
    const l = findListing(id);
    if (!l || !requireLogin()) return;
    closeSheet();
    window.PS?.openDm?.(l.user_id);
  },
  m16Like: async (id) => {
    const l = findListing(id);
    if (!l || !requireLogin()) return;
    try {
      const r = await api("/api/swipe/like", { method: "POST", body: { listingId: Number(l.id) } });
      haptic();
      toast(r?.match ? "💞 Tausch-Match!" : "❤️ Gemerkt", r?.match ? "Ihr habt gegenseitig Interesse – schau in deine Matches." : `${l.card_name} ist gemerkt – der Verkäufer sieht dein Interesse.`);
    } catch (e) { handleError(e); }
  },
};
export { M16_PAGE };
