// Startseite direkt unter der Set-Binder-Ordnerleiste: 2-Spalten-Layout (Desktop nebeneinander, Smartphone mit Umschalter).
//   LINKS  – Interaktiver Binder: Reiter „📖 Mein Set-Binder“ | „🔄 Marktplatz-Binder swipen“, Filter-Pills
//            (Alle | 👤 Privatanbieter | 🏪 Händler) und Suche. Im Marktplatz-Modus blättert man per Pfeil/Wischen durch die
//            Verkaufs- & Tausch-Ordner anderer Sammler und Händler (Anbieter-Info, Zustand, Preis, Cardmarket-Vergleich,
//            „💬 Tausch/Kauf anfragen“ / „🛒 Kaufen“).
//   RECHTS – Schwarzes Brett, Pull-Wall & Artikel-Marktplatz: Schnell-Upload „➕ Foto / Artikel oder Pull posten“ und
//            scrollbarer Live-Feed (Alle · 📦 Artikel & Konvolute · 📸 Pull-Wall · 📦 Sealed & OVP) mit Like, Kommentar, Chat/Anfrage.
// Nutzt nur bestehende APIs (/api/listings, /api/community/*) und bestehende Abläufe (Kauf, Tausch-Anfrage, 1:1-Chat).
import { $, esc, jsArg, eur, cdn, cm, state, api, toast, handleError, requireLogin, FALLBACK_IMG } from "./core.js";
import { conditionShort } from "./market-filter-logic.js";
import { compress } from "./item-listing.js";
import { swipeDirection, setIdOfCard } from "../server/binder-logic.ts";
import { itemCategoryLabel, itemCategoryIcon, itemConditionLabel } from "../server/item-listing-logic.ts";
import { isSealedListing, sealedKindOf, sealedKindIcon, sealedKindLabel } from "../server/sealed-market-logic.ts";
import { sellerFolderPages, matchesQuery, cmDiff, mixFeed, quickTarget, QUICK_KINDS, MINE_POCKETS } from "./home-split-logic.js";

const MODE_KEY = "ps_home_split_mode";
const COL_KEY = "ps_home_split_col";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const hs = {
  mode: lsGet(MODE_KEY) === "market" ? "market" : "mine",
  col: lsGet(COL_KEY) === "board" ? "board" : "binder",
  seller: "all", q: "", page: 0, sel: 0, anim: "",
  feed: "all", posts: [], postsAt: 0, loadingPosts: false, openCmt: new Set(),
  qkind: "pull", qphoto: "", busy: false, timer: 0,
};

const ago = (d) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(d).toLocaleDateString("de-DE");
};
const homeVisible = () => !$("view-home")?.classList.contains("hidden") && !document.hidden;
const isPhoto = (src) => String(src || "").startsWith("/api/images/");

// ---------------------------------------------------------------------------
// LINKS: Binder
// ---------------------------------------------------------------------------
function mineItems() {
  let items = [];
  if (state.user && Array.isArray(state.portfolio?.items)) items = state.portfolio.items;
  else { try { const v = JSON.parse(lsGet("pokeswipe_portfolio_clean") || "[]"); items = Array.isArray(v) ? v : []; } catch {} }
  return items.filter((i) => matchesQuery({ card_name: i.name, set_name: i.setName || i.set }, hs.q));
}

function marketPages() {
  return sellerFolderPages(state.listings || [], { seller: hs.seller, q: hs.q, viewerId: state.user?.id || "" });
}

function leftHeadHtml() {
  const tab = (k, label) => `<button type="button" role="tab" aria-selected="${hs.mode === k}" onclick="PS.homeSplitMode('${k}')" class="ps-hs-tab">${label}</button>`;
  const pill = (k, label) => `<button type="button" class="ps-chip" aria-pressed="${hs.seller === k}" onclick="PS.homeSplitSeller('${k}')">${label}</button>`;
  return `<div class="flex items-center justify-between gap-2">
      <div class="ps-hs-tabs" role="tablist" aria-label="Binder-Ansicht">${tab("mine", "📖 Mein Set-Binder")}${tab("market", "🔄 Marktplatz-Binder swipen")}</div>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      ${hs.mode === "market" ? `<div class="flex gap-1.5" role="group" aria-label="Anbieter">${pill("all", "Alle")}${pill("private", "👤 Privatanbieter")}${pill("dealer", "🏪 Händler")}</div>` : ""}
      <input id="ps-hs-q" type="search" value="${esc(hs.q)}" oninput="PS.homeSplitSearch(this.value)" placeholder="${hs.mode === "market" ? "Karte, Anbieter, Stadt suchen …" : "In meinem Binder suchen …"}" aria-label="Suchen"
        class="flex-1 min-w-[9rem] bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:border-yellow-400 outline-none" />
    </div>`;
}

function minePocket(i) {
  const cardId = i.cardId || i.card_id || "";
  const setId = cardId ? setIdOfCard(cardId) : "";
  const qty = Number(i.quantity) || 1;
  const on = setId ? `PS.homeSplitOpenCard(${jsArg(setId)}, ${jsArg(cardId)})` : "PS.collectionTab('binder')";
  return `<button type="button" class="ps-mpocket" onclick="${on}" aria-label="${esc(`${i.name || "Karte"} – im Binder`)}">
    <span class="ps-mpocket-art"><img src="${esc(cdn(i.image || i.img || FALLBACK_IMG, 240))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" draggable="false" class="object-contain" />
      ${qty > 1 ? `<span class="ps-badge absolute top-1 right-1 bg-yellow-400 text-slate-950">${qty}×</span>` : ""}</span>
    <span class="ps-mpocket-foot"><span class="ps-mpocket-name">${esc(i.name || "Karte")}</span>${Number(i.value) > 0 ? `<strong class="ps-mpocket-price">${eur(i.value)}</strong>` : ""}</span>
  </button>`;
}

function mineHtml() {
  const items = mineItems();
  const pages = Math.max(1, Math.ceil(items.length / MINE_POCKETS));
  hs.page = Math.min(Math.max(0, hs.page), pages - 1);
  if (!items.length) {
    return `<div class="ps-empty text-xs text-slate-300 text-center py-6 space-y-2">
      <p>${hs.q ? "Keine Karte in deinem Binder passt zur Suche." : "Dein Set-Binder ist noch leer – scanne deine erste Karte, sie sortiert sich automatisch ein."}</p>
      <div class="flex flex-wrap justify-center gap-1.5"><button type="button" onclick="PS.openScanner()" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">📷 Karte scannen</button>
      <button type="button" onclick="PS.homeSplitMode('market')" class="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl">🔄 Marktplatz-Binder swipen</button></div></div>`;
  }
  const slice = items.slice(hs.page * MINE_POCKETS, (hs.page + 1) * MINE_POCKETS);
  return `${stageHtml(`<div class="ps-hs-page ${hs.anim}" style="--mb-cols:3">${slice.map(minePocket).join("")}${Array.from({ length: MINE_POCKETS - slice.length }, () => `<span class="ps-mpocket ps-mpocket-empty" aria-hidden="true"></span>`).join("")}</div>`, hs.page, pages)}
    <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
      <span class="text-slate-400">${items.length} ${items.length === 1 ? "Karte" : "Karten"} · Karte antippen öffnet ihren Set-Ordner</span>
      <button type="button" onclick="PS.collectionTab('binder')" class="font-bold text-slate-300 hover:text-white">Ganzes Album ›</button>
    </div>`;
}

function stageHtml(inner, page, pages) {
  return `<div class="ps-mbinder-stage">
      <button type="button" class="ps-binder-arrow left" onclick="PS.homeSplitPage(-1)" ${page <= 0 ? "disabled" : ""} aria-label="Vorherige Seite">‹</button>
      <div class="ps-mbinder-viewport ps-hs-viewport" data-hs-viewport>${inner}</div>
      <button type="button" class="ps-binder-arrow right" onclick="PS.homeSplitPage(1)" ${page >= pages - 1 ? "disabled" : ""} aria-label="Nächste Seite">›</button>
    </div>
    <p class="text-center text-[11px] font-black text-slate-300">Seite ${page + 1} / ${pages} <span class="text-[10px] text-slate-500 font-bold">· wischen oder ‹ › zum Blättern</span></p>`;
}

function marketPocket(l, k) {
  const cond = l.listing_type === "item" ? (isSealedListing(l) ? "OVP" : itemConditionLabel(l.item_condition)) : conditionShort(l.condition);
  return `<button type="button" class="ps-mpocket ${k === hs.sel ? "ps-hs-sel" : ""}" onclick="PS.homeSplitSelect(${k})" aria-pressed="${k === hs.sel}" aria-label="${esc(`${l.card_name}, ${Number(l.price) > 0 ? eur(l.price) : "Tausch"}`)}">
    <span class="ps-mpocket-art"><img src="${esc(cdn(l.image || FALLBACK_IMG, 260))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" draggable="false" class="${isPhoto(l.image) ? "object-cover" : "object-contain"}" />
      ${cond ? `<span class="ps-badge ps-badge-cond ps-bslot-cond">${esc(cond)}</span>` : ""}</span>
    <span class="ps-mpocket-foot"><span class="ps-mpocket-name">${esc(l.card_name)}</span><strong class="ps-mpocket-price ${Number(l.price) > 0 ? "" : "trade"}">${Number(l.price) > 0 ? eur(l.price) : "🔄 Tausch"}</strong></span>
  </button>`;
}

function detailHtml(l) {
  const id = Number(l.id);
  const item = l.listing_type === "item";
  const cond = item ? (isSealedListing(l) ? "Sealed / OVP" : itemConditionLabel(l.item_condition)) : conditionShort(l.condition);
  const diff = cmDiff(l);
  const buy = l.buy_now
    ? `<button type="button" onclick="PS.openBuy(${id})" class="bg-cyan-400 text-slate-950 font-black py-2 rounded-xl text-[11px]">🛒 Kaufen</button>`
    : `<button type="button" onclick="PS.openListing(${id})" class="bg-cyan-400/90 text-slate-950 font-black py-2 rounded-xl text-[11px]" title="Kein Sofort-Kauf – Details & Kaufanfrage">🛒 Kaufen</button>`;
  return `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 space-y-1.5 text-xs" data-hs-detail="${id}">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0"><p class="font-black text-white truncate">${item ? `${isSealedListing(l) ? sealedKindIcon(sealedKindOf(l)) : itemCategoryIcon(l.item_category)} ` : ""}${esc(l.card_name)}</p>
        <p class="text-[10px] text-slate-400">${cond ? `Zustand: <strong class="text-slate-200">${esc(cond)}</strong> · ` : ""}${item ? esc(isSealedListing(l) ? sealedKindLabel(sealedKindOf(l)) : itemCategoryLabel(l.item_category)) : esc(l.variant_label || "Einzelkarte")}</p></div>
      <strong class="text-emerald-300 text-base shrink-0">${Number(l.price) > 0 ? eur(l.price) : "🔄 Tausch"}</strong>
    </div>
    <p class="text-[10px] text-slate-400">${l.market_price ? `📊 Cardmarket-Trend <strong class="text-slate-200">${eur(l.market_price)}</strong>${diff !== null ? ` · <span class="${diff >= 0 ? "text-emerald-300" : "text-rose-300"} font-bold">${diff >= 0 ? `${diff} % günstiger` : `${-diff} % teurer`}</span>` : ""} · ` : ""}<a href="${esc(cm(l.card_name))}" target="_blank" rel="noopener" class="underline font-bold text-indigo-300">Cardmarket prüfen ↗</a></p>
    <div class="grid grid-cols-2 gap-1.5">
      <button type="button" onclick="PS.requestTrade(${id})" class="bg-emerald-500 text-slate-950 font-black py-2 rounded-xl text-[11px]">💬 Tausch/Kauf anfragen</button>
      ${buy}
    </div>
  </div>`;
}

function marketHtml() {
  const pages = marketPages();
  if (!pages.length) {
    return `<div class="ps-empty text-xs text-slate-300 text-center py-6 space-y-2">
      <p>${(state.listings || []).length ? "Keine Ordner für diesen Filter." : "Angebote werden geladen …"}</p>
      ${hs.seller !== "all" || hs.q ? `<button type="button" onclick="PS.homeSplitReset()" class="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl">Filter zurücksetzen</button>` : ""}</div>`;
  }
  hs.page = Math.min(Math.max(0, hs.page), pages.length - 1);
  const pg = pages[hs.page];
  hs.sel = Math.min(Math.max(0, hs.sel), pg.items.length - 1);
  const s = pg.seller;
  const head = `<div class="flex items-center justify-between gap-2 text-[11px]">
      <button type="button" onclick="PS.openUser(${jsArg(s.id)})" class="min-w-0 text-left truncate"><span class="font-black text-white">${s.dealer ? "🏪" : "👤"} ${esc(s.name)}</span>${s.verified ? ` <span class="text-cyan-300">✔</span>` : ""}${s.founder ? ` <span class="ps-founder-chip">🏅</span>` : ""}
        <span class="text-slate-400"> · ${s.dealer ? "Händler" : "Privat"}${s.city ? ` · 📍 ${esc(s.city)}` : ""}${s.rating ? ` · ⭐ ${esc(String(s.rating))} (${Number(s.ratingCount)})` : ""}</span></button>
      <span class="text-slate-400 shrink-0">Ordner ${pg.folder + 1} · ${s.total} Angebote${pg.pages > 1 ? ` · S. ${pg.page + 1}/${pg.pages}` : ""}</span>
    </div>`;
  const inner = `<div class="ps-hs-page ${hs.anim}" style="--mb-cols:2">${pg.items.map(marketPocket).join("")}${Array.from({ length: Math.max(0, 4 - pg.items.length) }, () => `<span class="ps-mpocket ps-mpocket-empty" aria-hidden="true"></span>`).join("")}</div>`;
  return `${head}${stageHtml(inner, hs.page, pages.length)}${detailHtml(pg.items[hs.sel])}`;
}

function renderLeft() {
  const head = $("ps-hs-left-head"), body = $("ps-hs-left-body");
  if (!head || !body) return;
  if (!head.contains(document.activeElement)) head.innerHTML = leftHeadHtml();
  else head.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.getAttribute("onclick")?.includes(`'${hs.mode}'`))));
  body.innerHTML = hs.mode === "market" ? marketHtml() : mineHtml();
  hs.anim = "";
  bindSwipe(body.querySelector("[data-hs-viewport]"));
}

function bindSwipe(vp) {
  if (!vp || vp._bound) return;
  vp._bound = true;
  let sx = 0, sy = 0, active = false, dragging = false, pid = null;
  const page = () => vp.querySelector(".ps-hs-page");
  vp.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button !== 0) return; sx = e.clientX; sy = e.clientY; active = true; dragging = false; pid = e.pointerId; });
  vp.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; try { vp.setPointerCapture(pid); } catch {} }
    if (dragging && page()) { page().style.transition = "none"; page().style.transform = `translateX(${dx}px)`; }
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
    if (dir) go(dir);
    else if (page()) { page().style.transition = "transform .2s ease"; page().style.transform = ""; }
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
}

function go(delta) {
  const n = hs.mode === "market" ? marketPages().length : Math.max(1, Math.ceil(mineItems().length / MINE_POCKETS));
  const next = Math.min(Math.max(0, hs.page + delta), Math.max(0, n - 1));
  if (next === hs.page) { renderLeft(); return; }
  hs.page = next; hs.sel = 0;
  hs.anim = delta > 0 ? "ps-hs-in-r" : "ps-hs-in-l";
  try { navigator.vibrate?.(8); } catch {}
  renderLeft();
}

// ---------------------------------------------------------------------------
// RECHTS: Schnell-Upload + Live-Feed
// ---------------------------------------------------------------------------
function quickHtml() {
  return `<details class="ps-hs-quick bg-slate-950 border border-yellow-400/40 rounded-2xl" ${lsGet("ps_hs_quick_closed") ? "" : "open"} ontoggle="PS.homeSplitQuickToggle(this.open)">
    <summary class="px-3 py-2 text-xs font-black text-yellow-300 cursor-pointer">➕ Foto / Artikel oder Pull posten</summary>
    <div class="px-3 pb-3 space-y-2 text-xs">
      <div class="flex gap-2 items-stretch">
        <label class="w-16 h-16 shrink-0 rounded-xl border-2 border-dashed ${hs.qphoto ? "border-yellow-400" : "border-slate-600"} overflow-hidden flex items-center justify-center cursor-pointer text-center text-[9px] font-bold text-slate-300" title="Foto wählen oder aufnehmen">
          ${hs.qphoto ? `<img src="${esc(hs.qphoto)}" alt="Vorschau" class="w-full h-full object-cover" />` : `<span>📷<br>Foto</span>`}
          <input type="file" accept="image/*" class="hidden" onchange="PS.homeSplitPhoto(event)" /></label>
        <div class="flex-1 min-w-0 space-y-1.5">
          <input id="ps-hs-title" maxlength="120" placeholder="Titel, z. B. „Glurak ex Pull!“ oder „151 ETB OVP“" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
          <div class="flex gap-1.5">
            <select id="ps-hs-kind" onchange="PS.homeSplitKind(this.value)" class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" aria-label="Kategorie">
              ${QUICK_KINDS.map((k) => `<option value="${k.id}" ${hs.qkind === k.id ? "selected" : ""}>${k.label}</option>`).join("")}</select>
            <input id="ps-hs-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Preis € (optional)" ${hs.qkind === "pull" ? "disabled" : ""} class="w-28 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white disabled:opacity-40" aria-label="Preis in Euro (optional)" />
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2">
        <p class="text-[10px] text-slate-400 min-w-0">${hs.qkind === "pull" ? "Erscheint sofort auf der Pull-Wall." : "Mit Preis: sofort als Inserat im Marktplatz · ohne Preis: als Tausch-Beitrag am Schwarzen Brett."}</p>
        <button type="button" id="ps-hs-post" onclick="PS.homeSplitPost()" class="bg-gradient-to-r from-yellow-400 to-orange-400 text-slate-950 font-black px-3.5 py-2 rounded-xl shrink-0">🚀 Sofort veröffentlichen</button>
      </div>
    </div>
  </details>`;
}

function feedTabsHtml() {
  const t = (k, label, on = `PS.homeSplitFeed('${k}')`) => `<button type="button" class="ps-chip" aria-pressed="${hs.feed === k}" onclick="${on}">${label}</button>`;
  return `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="toolbar" aria-label="Live-Feed filtern">
    ${t("all", "Alle")}${t("items", "📦 Artikel &amp; Konvolute")}${t("pulls", "📸 Pull-Wall")}${t("sealed", "📦 Sealed &amp; OVP")}</div>`;
}

function postHtml(p) {
  const a = p.author || {};
  const open = hs.openCmt.has(p.id);
  const cat = p.category === "trade" ? "🔄 Tausch" : p.category === "talk" ? "💬 Talk" : "📸 Pull";
  return `<article class="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 space-y-1.5 text-xs" data-hs-post="${Number(p.id)}">
    <div class="flex items-center justify-between gap-2 text-[11px]"><span class="min-w-0 truncate"><button type="button" onclick="PS.openCollector(${jsArg(a.id)})" class="font-black text-yellow-300">${esc(a.name || "Sammler")}</button>${a.founder ? ` <span class="ps-founder-chip">🏅</span>` : ""}
      <span class="text-slate-500"> · ${esc(ago(p.createdAt))}</span></span><span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-200 shrink-0">${cat}</span></div>
    ${p.image ? `<img src="${esc(cdn(p.image, 520))}" onerror="this.remove()" loading="lazy" alt="" class="w-full max-h-64 object-cover rounded-xl bg-slate-900" />` : ""}
    ${p.caption ? `<p class="text-slate-200 whitespace-pre-line break-words" data-i18n-skip>${esc(p.caption)}</p>` : ""}
    <div class="flex gap-1.5">
      <button type="button" onclick="PS.homeSplitLike(${Number(p.id)})" aria-pressed="${Boolean(p.liked)}" class="flex-1 rounded-xl py-1.5 font-bold ${p.liked ? "bg-rose-500/20 text-rose-200" : "bg-slate-900 text-slate-300"}">${p.liked ? "❤️" : "🤍"} ${Number(p.likes) || 0}</button>
      <button type="button" onclick="PS.homeSplitComments(${Number(p.id)})" aria-expanded="${open}" class="flex-1 rounded-xl py-1.5 font-bold bg-slate-900 text-slate-300">💬 ${Number(p.commentCount) || 0}</button>
      ${p.mine ? "" : `<button type="button" onclick="PS.openDm(${jsArg(a.id)})" class="flex-1 rounded-xl py-1.5 font-bold bg-emerald-500/15 text-emerald-200">✉️ Chat / Anfrage</button>`}
    </div>
    ${open ? `<div class="space-y-1">${(p.comments || []).slice(-3).map((c) => `<p class="text-[11px]"><strong class="text-yellow-300">${esc(c.author?.name || "Sammler")}</strong> <span class="text-slate-300" data-i18n-skip>${esc(c.body)}</span></p>`).join("")}
      <form class="flex gap-1.5" onsubmit="event.preventDefault(); PS.homeSplitComment(${Number(p.id)})"><input id="ps-hs-cmt-${Number(p.id)}" maxlength="300" placeholder="${state.user ? "Kommentieren …" : "Zum Kommentieren anmelden"}" class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-[11px] text-white" />
        <button type="submit" class="bg-yellow-400 text-slate-950 font-black px-2.5 rounded-xl text-[11px]">Senden</button></form></div>` : ""}
  </article>`;
}

function listingFeedHtml(l) {
  const id = Number(l.id);
  const sealed = isSealedListing(l);
  const own = state.user?.id && l.user_id === state.user.id;
  const label = sealed ? `${sealedKindIcon(sealedKindOf(l))} ${sealedKindLabel(sealedKindOf(l))}` : `${itemCategoryIcon(l.item_category)} ${itemCategoryLabel(l.item_category) || "Pokémon-Artikel"}`;
  return `<article class="bg-slate-950 border border-violet-500/30 rounded-2xl p-2.5 flex gap-2.5 text-xs" data-hs-listing="${id}">
    <button type="button" onclick="PS.openListing(${id})" class="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-slate-900" aria-label="${esc(l.card_name)} ansehen">
      <img src="${esc(cdn(l.image || FALLBACK_IMG, 200))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="w-full h-full ${isPhoto(l.image) ? "object-cover" : "object-contain"}" /></button>
    <div class="min-w-0 flex-1 space-y-1">
      <p class="text-[10px] font-black text-violet-300 truncate">${esc(label)} · <span class="text-slate-500 font-bold">${esc(ago(l.created_at))}</span></p>
      <p class="font-black text-white truncate">${esc(l.card_name)}</p>
      <p class="text-[10px] text-slate-400 truncate"><strong class="text-emerald-300 text-sm">${Number(l.price) > 0 ? eur(l.price) : "Tausch"}</strong> · ${l.seller_dealer || l.seller_shop ? "🏪" : "👤"} ${esc(l.seller || "Sammler")} · 📍 ${esc(l.city || "–")}</p>
      ${own ? `<button type="button" onclick="PS.openListing(${id})" class="w-full bg-slate-800 text-white font-bold py-1.5 rounded-xl text-[11px]">✏️ Verwalten</button>`
      : `<div class="flex gap-1.5">
        <button type="button" onclick="PS.requestTrade(${id})" class="flex-1 bg-emerald-500 text-slate-950 font-black py-1.5 rounded-xl text-[11px]">💬 Anfragen</button>
        ${l.buy_now ? `<button type="button" onclick="PS.openBuy(${id})" class="flex-1 bg-cyan-400 text-slate-950 font-black py-1.5 rounded-xl text-[11px]">🛒 Kaufen</button>` : ""}
        <button type="button" onclick="PS.openDm(${jsArg(l.user_id)})" class="bg-slate-800 text-white font-bold py-1.5 px-2.5 rounded-xl text-[11px]" aria-label="Chat mit ${esc(l.seller || "Anbieter")}">✉️</button></div>`}
    </div>
  </article>`;
}

function renderFeed() {
  const box = $("ps-hs-feed");
  if (!box) return;
  const tabs = $("ps-hs-feed-tabs");
  if (tabs) tabs.innerHTML = feedTabsHtml();
  const entries = mixFeed(hs.posts, state.listings || [], hs.feed).slice(0, 30);
  const sealedLink = hs.feed === "sealed" ? `<button type="button" onclick="PS.openSealedMarket()" class="w-full text-[11px] font-black text-purple-200 bg-purple-500/15 border border-purple-500/40 rounded-xl py-2">📦 Zum Sealed-Marktplatz mit allen Filtern ›</button>` : "";
  if (!entries.length) {
    box.innerHTML = `${sealedLink}<p class="text-xs text-slate-400 text-center py-6">${hs.loadingPosts ? "Feed wird geladen …" : hs.feed === "pulls" ? "Noch keine Pulls – poste deinen ersten oben! 📸" : "Noch nichts hier – sei der Erste! ➕"}</p>`;
    return;
  }
  const top = box.scrollTop;
  box.innerHTML = sealedLink + entries.map((e) => (e.kind === "post" ? postHtml(e.post) : listingFeedHtml(e.listing))).join("");
  box.scrollTop = top;
}

async function loadPosts(force = false) {
  if (hs.loadingPosts || (!force && Date.now() - hs.postsAt < 20_000)) return;
  hs.loadingPosts = true;
  try { hs.posts = (await api("/api/community/feed")).posts || []; hs.postsAt = Date.now(); } catch {}
  hs.loadingPosts = false;
  renderFeed();
}

async function quickPost() {
  if (!requireLogin() || hs.busy) return;
  const title = ($("ps-hs-title")?.value || "").trim();
  const price = hs.qkind === "pull" ? "" : String($("ps-hs-price")?.value || "").trim();
  if (!title && !hs.qphoto) return toast("Fast fertig", "Bitte ein Foto oder einen Titel angeben.");
  const target = quickTarget(hs.qkind, price);
  if (target.to === "listing" && title.length < 3) return toast("Titel fehlt", "Für ein Inserat bitte einen Titel eintragen.");
  hs.busy = true;
  const b = $("ps-hs-post");
  if (b) { b.disabled = true; b.textContent = "⏳ Wird veröffentlicht …"; }
  try {
    if (target.to === "listing") {
      await api("/api/listings", { method: "POST", body: { items: [{
        listingType: "item", title, card: title, price: price.replace(",", "."), itemCategory: target.itemCategory, itemCondition: target.itemCondition,
        imgs: hs.qphoto ? [hs.qphoto] : [], city: state.me?.city || "", want: "Verkauf · Versand oder Abholung",
        ...(target.sealed ? { itemMeta: { sealed: true, factorySealed: true } } : {}),
      }] } });
      toast("🚀 Inserat live", `${title} steht jetzt im Marktplatz und im Feed.`);
      await window.PS?.loadListings?.();
    } else {
      const kindLabel = QUICK_KINDS.find((k) => k.id === hs.qkind)?.label.split(" ")[0] || "";
      const caption = target.category === "trade" && title ? `${kindLabel} ${title}` : title;
      const r = await api("/api/community/posts", { method: "POST", body: { caption, category: target.category, ...(hs.qphoto ? { image: hs.qphoto } : {}) } });
      toast(r.pending ? "⏳ Wird kurz geprüft" : "🚀 Veröffentlicht", r.notice || (target.category === "pull" ? "Dein Pull ist auf der Pull-Wall." : "Dein Beitrag steht am Schwarzen Brett."));
      await loadPosts(true);
    }
    hs.qphoto = "";
    const q = $("ps-hs-quick");
    if (q) q.innerHTML = quickHtml();
  } catch (e) { handleError(e); }
  finally {
    hs.busy = false;
    const b2 = $("ps-hs-post");
    if (b2) { b2.disabled = false; b2.textContent = "🚀 Sofort veröffentlichen"; }
  }
}

// ---------------------------------------------------------------------------
// Gerüst
// ---------------------------------------------------------------------------
function applyCol() {
  const root = $("home-split");
  if (!root) return;
  root.dataset.show = hs.col;
  root.querySelectorAll("[data-hs-col-btn]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.hsColBtn === hs.col)));
}

export function renderHomeSplit() {
  const root = $("home-split");
  if (!root) return;
  if (!root.dataset.ready) {
    root.dataset.ready = "1";
    root.innerHTML = `<div class="ps-hs-switch lg:hidden" role="tablist" aria-label="Bereich wählen">
        <button type="button" role="tab" data-hs-col-btn="binder" onclick="PS.homeSplitCol('binder')">📖 Binder</button>
        <button type="button" role="tab" data-hs-col-btn="board" onclick="PS.homeSplitCol('board')">📌 Brett &amp; Pull-Wall</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <div class="ps-card p-3 sm:p-4 space-y-2" data-hs-col="binder" aria-label="Interaktiver Binder">
          <div id="ps-hs-left-head" class="space-y-2"></div>
          <div id="ps-hs-left-body" class="space-y-2"></div>
        </div>
        <div class="ps-card p-3 sm:p-4 space-y-2" data-hs-col="board" aria-label="Schwarzes Brett, Pull-Wall & Artikel-Marktplatz">
          <div class="flex items-center justify-between gap-2"><p class="ps-kicker text-orange-300">📌 Schwarzes Brett · Pull-Wall · Artikel</p>
            <button type="button" onclick="PS.communityTab('wall')" class="text-xs font-bold text-slate-300 hover:text-white shrink-0">Alles ›</button></div>
          <div id="ps-hs-quick">${quickHtml()}</div>
          <div id="ps-hs-feed-tabs"></div>
          <div id="ps-hs-feed" class="ps-hs-feed space-y-2" aria-live="polite"></div>
        </div>
      </div>`;
  }
  applyCol();
  renderLeft();
  renderFeed();
}

export function initHomeSplit() {
  renderHomeSplit();
  loadPosts(true);
  window.addEventListener("ps:listings", () => { renderLeft(); renderFeed(); });
  window.addEventListener("ps:portfolio", () => { if (hs.mode === "mine") renderLeft(); });
  window.addEventListener("ps:tab", (e) => { if (e.detail === "home") { renderLeft(); loadPosts(); } });
  clearInterval(hs.timer);
  hs.timer = setInterval(() => { if (homeVisible()) loadPosts(true); }, 60_000);
}

let qTimer = 0;
export const homeSplitApi = {
  homeSplitCol: (c) => { hs.col = c === "board" ? "board" : "binder"; lsSet(COL_KEY, hs.col); applyCol(); },
  homeSplitMode: (m) => { hs.mode = m === "market" ? "market" : "mine"; lsSet(MODE_KEY, hs.mode); hs.page = 0; hs.sel = 0; const h = $("ps-hs-left-head"); if (h) h.innerHTML = leftHeadHtml(); renderLeft(); },
  homeSplitSeller: (s) => { hs.seller = ["private", "dealer"].includes(s) ? s : "all"; hs.page = 0; hs.sel = 0; const h = $("ps-hs-left-head"); if (h) h.innerHTML = leftHeadHtml(); renderLeft(); },
  homeSplitSearch: (q) => { hs.q = String(q || "").slice(0, 60); clearTimeout(qTimer); qTimer = setTimeout(() => { hs.page = 0; hs.sel = 0; renderLeft(); }, 160); },
  homeSplitReset: () => { hs.seller = "all"; hs.q = ""; hs.page = 0; const h = $("ps-hs-left-head"); if (h) h.innerHTML = leftHeadHtml(); renderLeft(); },
  homeSplitPage: (d) => go(Number(d) < 0 ? -1 : 1),
  homeSplitSelect: (k) => { hs.sel = Number(k) || 0; renderLeft(); },
  homeSplitOpenCard: async (setId, cardId) => { await window.PS?.openSetBinder?.(setId); window.PS?.binderCardTap?.(cardId); },
  homeSplitFeed: (f) => { hs.feed = ["items", "pulls", "sealed"].includes(f) ? f : "all"; renderFeed(); const b = $("ps-hs-feed"); if (b) b.scrollTop = 0; },
  homeSplitKind: (k) => { hs.qkind = QUICK_KINDS.some((x) => x.id === k) ? k : "pull"; const t = $("ps-hs-title")?.value || "", p = $("ps-hs-price")?.value || ""; const q = $("ps-hs-quick"); if (q) q.innerHTML = quickHtml(); if ($("ps-hs-title")) $("ps-hs-title").value = t; if ($("ps-hs-price") && hs.qkind !== "pull") $("ps-hs-price").value = p; },
  homeSplitQuickToggle: (open) => lsSet("ps_hs_quick_closed", open ? "" : "1"),
  homeSplitPhoto: async (e) => {
    const f = e?.target?.files?.[0];
    if (e?.target) e.target.value = "";
    if (!f) return;
    try { hs.qphoto = await compress(f); } catch (err) { return toast("Foto", err.message || "Bild konnte nicht gelesen werden."); }
    const t = $("ps-hs-title")?.value || "", p = $("ps-hs-price")?.value || "";
    const q = $("ps-hs-quick"); if (q) q.innerHTML = quickHtml();
    if ($("ps-hs-title")) $("ps-hs-title").value = t; if ($("ps-hs-price")) $("ps-hs-price").value = p;
  },
  homeSplitPost: () => quickPost(),
  homeSplitLike: async (id) => {
    if (!requireLogin()) return;
    const p = hs.posts.find((x) => x.id === Number(id));
    try { const r = await api(`/api/community/posts/${Number(id)}/like`, { method: "POST", body: {} }); if (p) { p.liked = r.liked; p.likes = r.likes; } renderFeed(); }
    catch (e) { handleError(e); }
  },
  homeSplitComments: (id) => { const n = Number(id); if (hs.openCmt.has(n)) hs.openCmt.delete(n); else hs.openCmt.add(n); renderFeed(); if (hs.openCmt.has(n)) setTimeout(() => $(`ps-hs-cmt-${n}`)?.focus(), 30); },
  homeSplitComment: async (id) => {
    if (!requireLogin()) return;
    const inp = $(`ps-hs-cmt-${Number(id)}`);
    const text = (inp?.value || "").trim();
    if (!text) return;
    try {
      const r = await api(`/api/community/posts/${Number(id)}/comments`, { method: "POST", body: { body: text } });
      if (r?.notice) toast("⏳ Wird geprüft", r.notice);
      await loadPosts(true);
    } catch (e) { handleError(e); }
  },
};
