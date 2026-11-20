// PokeSwipe & Radar – App-Navigation (Mobile-First, aufgeräumt)
//
// 5 Hauptreiter – unten als Tab-Bar auf dem Handy, oben als schlanke Header-Navigation am Desktop:
//   1. Start        (view-home)      – Dashboard: Live-Scanner, Marktplatz-Highlights, Live-Chat, Binder
//   2. Scanner      (view-scan)      – Live-Scan | Foto-Scan & Suche | Fake-Check
//   3. Marktplatz   (view-map, view-swipe)        – [PokeSwipe-Radar] | [🔄 Tauschen] | [Alle Karten & Suche] | [Inserieren / Doppelte] | [Käufe & Verkäufe]
//   4. Album        (view-portfolio, view-flip)   – [Set-Album] | [Wunschliste] | [Preis-Radar]
//   5. Community    (view-community) – [Live-Chat] | [Schwarzes Brett] + Schnellzugriff Tausch-Chat, Online-Radar, Freunde & Tauschen, Reel-Generator (Admin)
// Profil & Einstellungen (view-profile) öffnen sich über den Avatar oben rechts – nicht als eigener Reiter.
// Jede Funktion hat genau einen festen Platz; Browser-/Android-Zurück wechselt zwischen den Bereichen (History-State).
import { $, esc, state, api, btn, syncUrl } from "./core.js";
import { tabFromUrl } from "./session-logic.js";
import { founderInviteHtml } from "./invite.js";
import { langSwitchHtml } from "./i18n.js";
import { inviteProgressHtml, proStatusText } from "./referral.js";
import { demandTileHtml } from "./demand.js";
import { listPickerHtml, renderListPicker, pickerDemoOn } from "./list-picker.js";

export const MAIN_TABS = ["home", "scan", "map", "portfolio", "community"];
const PAGES = {
  home: { title: "Start", nav: "home" },
  scan: { title: "Scanner", sub: "Karte scannen, Preis sehen und direkt inserieren", icon: "📷", nav: "scan" },
  map: { title: "Marktplatz", sub: "Kaufen mit Käuferschutz, tauschen, verkaufen", icon: "🛒", nav: "map", group: "market" },
  swipe: { title: "Marktplatz", sub: "Swipe-Tausch: rechts merken, links weiter", icon: "🛒", nav: "map", group: "market" },
  portfolio: { title: "Album / Binder", sub: "Set-Album zum Durchblättern, Wunschliste und Preis-Radar", icon: "📒", nav: "portfolio", group: "collection" },
  flip: { title: "Album / Binder", sub: "Preis-Radar: Restocks, Flip-Deals und Preisalarme", icon: "📒", nav: "portfolio", group: "collection" },
  community: { title: "Community", sub: "Live-Chat, Schwarzes Brett, Freunde, Tausch & Online-Radar der Sammler", icon: "💬", nav: "community", group: "community" },
  profile: { title: "Profil & Einstellungen", sub: "Konto, Pro-Pass, Verkäuferkonto & Rechtliches", icon: "⚙️", nav: "profile", back: true },
};
const MARKET_MODE_KEY = "ps_market_mode";
const COMMUNITY_KEY = "ps_community_panel";
let current = "home";
let fromPop = false;

// ---------------------------------------------------------------------------
// Seitenkopf + Unterreiter (Segmented Control)
// ---------------------------------------------------------------------------
function pageHeadHtml(tab) {
  const p = PAGES[tab];
  return `<div class="ps-page-head flex items-center gap-2.5" data-page-head="${tab}">
    ${p.back ? `<button type="button" onclick="PS.navBack()" class="ps-back shrink-0 w-10 h-10 rounded-2xl bg-slate-900 border border-slate-700 text-white font-black text-base flex items-center justify-center" aria-label="Zurück">←</button>` : ""}
    <div class="min-w-0">
      <h2 class="ps-page-title">${p.icon} ${esc(p.title)}</h2>
      <p class="text-[11px] text-slate-400 truncate">${esc(p.sub)}</p>
    </div>
  </div>`;
}

/** Segment-Umschalter – große Tippflächen, eine Zeile. */
function segmentHtml(id, items, active) {
  return `<div class="ps-segment" role="tablist" data-segment="${id}">
    ${items.map(([key, label, on]) => `<button type="button" role="tab" data-seg="${key}" aria-selected="${key === active}" onclick="${on}">${label}</button>`).join("")}
  </div>`;
}

const SEGMENTS = {
  market: [["swipe", "💚 PokeSwipe-Radar", "PS.marketTab('swipe')"], ["trade", "🔄 Tauschen", "PS.marketTab('trade')"], ["all", "🃏 Alle Karten & Suche", "PS.marketTab('all')"], ["sealed", "📦 Sealed & OVP", "PS.marketTab('sealed')"], ["sell", "🏷️ Inserieren", "PS.marketTab('sell')"], ["mine", "📦 Käufe & Verkäufe", "PS.marketTab('mine')"]],
  collection: [["binder", "📒 Set-Album", "PS.collectionTab('binder')"], ["gaps", "🎯 Lücken-Radar", "PS.collectionTab('gaps')"], ["wishlist", "⭐ Wunschliste", "PS.collectionTab('wishlist')"], ["radar", "📡 Preis-Radar", "PS.collectionTab('radar')"]],
  community: [["chat", "💬 Live-Chat", "PS.communityTab('chat')"], ["wall", "📌 Schwarzes Brett", "PS.communityTab('wall')"]],
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const communityPanel = () => (lsGet(COMMUNITY_KEY) === "wall" ? "wall" : "chat");

function activeSegment(tab) {
  if (tab === "swipe") return "swipe";
  if (tab === "map") { const m = marketMode(); return m === "mine" || m === "sell" || m === "trade" || m === "sealed" ? m : "all"; }
  if (tab === "flip") return "radar";
  if (tab === "portfolio") { const sub = lsGet("ps_sub_portfolio"); return sub === "wishlist" ? "wishlist" : sub === "gaps" ? "gaps" : "binder"; }
  if (tab === "community") return communityPanel();
  return "";
}

function renderSegments() {
  for (const tab of Object.keys(PAGES)) {
    const section = $(`view-${tab}`);
    const group = PAGES[tab].group;
    if (!section || !group) continue;
    const active = activeSegment(tab);
    section.dataset.seg = active;
    section.querySelectorAll(`[data-segment="${group}"] [data-seg]`).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.seg === active)));
  }
}

function injectHeads() {
  for (const tab of Object.keys(PAGES)) {
    if (tab === "home") continue;
    const section = $(`view-${tab}`);
    if (!section || section.querySelector(":scope > [data-page-top]")) continue;
    const wrap = document.createElement("div");
    wrap.className = "space-y-3";
    wrap.dataset.pageTop = tab;
    const group = PAGES[tab].group;
    wrap.innerHTML = `${pageHeadHtml(tab)}${group ? segmentHtml(group, SEGMENTS[group], activeSegment(tab)) : ""}${tab === "community" ? `<div id="ps-community-quick"></div>` : ""}`;
    section.prepend(wrap);
  }
  renderSegments();
  renderCommunityQuick();
}

/** Community-Schnellzugriff: Tausch-Chat (1:1 mit Käufern/Verkäufern), Live-Online-Radar und – für Admins – Reel-Generator. */
export function renderCommunityQuick() {
  const box = $("ps-community-quick");
  if (!box) return;
  const open = Number(state.me?.usage?.open_trades || 0);
  const admin = Boolean(state.me?.isAdmin);
  const tile = (icon, label, sub, on, extra = "") => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl px-3 py-2.5 min-h-[56px] ${extra}">
    <span class="block text-xs font-black text-white">${icon} ${label}</span><span class="block text-[10px] text-slate-400 truncate">${sub}</span></button>`;
  box.innerHTML = `<div class="grid grid-cols-2 ${admin ? "sm:grid-cols-3" : ""} gap-2">
    ${tile("🤝", "Tausch-Chat", state.user ? (open ? `${open} offene Tausche & Nachrichten` : "1:1-Chat mit Käufern & Verkäufern") : "Anmelden & privat schreiben", state.user ? "PS.openTrades()" : "PS.openAccount()")}
    ${tile("🟢", "Live-Online-Radar", "Wer gerade online ist", "PS.openOnlineList()")}
    ${admin ? tile("🎬", "Reel-Generator", "Auto-Reels & Pro-Videos", "PS.openGenerator()", "col-span-2 sm:col-span-1") : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// Marktplatz: Marktplatz (Direktkauf) | Tausch-Hub | Meine Verkäufe & Bestellungen
// ---------------------------------------------------------------------------
export function marketMode() {
  const m = state.marketMode || localStorage.getItem(MARKET_MODE_KEY);
  return m === "buy" || m === "trade" || m === "mine" || m === "sell" || m === "sealed" ? m : "buy";
}

/** Unterreiter „Inserieren“: Karte scannen & inserieren, Doppelte aus dem Album (einzeln oder alle), Stapel-Inserat. */
function sellHtml() {
  if (!state.user && !pickerDemoOn()) {
    return `<div class="poke-glass rounded-3xl p-5 text-center space-y-3">
      <p class="text-sm font-black text-white">🏷️ Karte inserieren / Doppelte verkaufen</p>
      <p class="text-xs text-slate-300">Melde dich an, um Karten aus deinem Album – einzeln oder alle Doppelten auf einmal – zum Cardmarket-Preis zu inserieren.</p>
      ${btn("Anmelden", "PS.openAccount()", "w-full bg-yellow-400 text-slate-950")}
      ${btn("📷 Karte scannen", "PS.openScanner()", "w-full bg-slate-800 text-white")}
    </div>`;
  }
  const m = state.me || {};
  // „🃏 Einzelkarten | 📦 Pokémon-Artikel“ – der Einzelkarten-Flow darunter bleibt 1:1 erhalten
  if (state.sellType === "item") return `<div class="space-y-3">${sellTypeHtml()}${window.PS?.itemListingFormHtml?.() || ""}<div hidden><div id="ps-batch-slot"></div></div></div>`;
  const tile = (icon, label, sub, on, cls = "text-white") => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl p-3 min-h-[64px]">
    <span class="block text-sm font-black ${cls}">${icon} ${label}</span><span class="block text-[11px] text-slate-400">${sub}</span></button>`;
  return `<div class="space-y-3">
    ${sellTypeHtml()}
    <div class="grid grid-cols-2 gap-2">
      ${tile("📷", "Scannen & inserieren", "Karte erkennen, Preis sehen, 1 Tap", "PS.openScanner()", "text-emerald-200")}
      ${tile("📒", "Aus dem Album", "Set-Ordner öffnen & „Inserieren“", "PS.collectionTab('binder')")}
    </div>
    ${m.sellerReady ? "" : `<button type="button" onclick="PS.openSeller()" class="w-full text-left bg-cyan-500/10 border border-cyan-400/40 rounded-2xl px-3 py-2.5 text-xs text-cyan-100"><strong class="text-white">🔒 Sofort-Kauf mit Käuferschutz freischalten</strong> – Verkäuferkonto in 2 Minuten einrichten (Stripe) ›</button>`}
    ${demandTileHtml()}
    ${listPickerHtml()}
    <div id="ps-batch-slot"></div>
  </div>`;
}

/** Umschalter im Unterreiter „Inserieren“: 🃏 Einzelkarten (bisheriger Flow) | 📦 Pokémon-Artikel (neu). */
function sellTypeHtml() {
  const t = state.sellType === "item" ? "item" : "card";
  const b = (k, label, sub) => `<button type="button" onclick="PS.sellType('${k}')" aria-pressed="${t === k}" class="flex-1 text-left rounded-xl px-3 py-2 min-h-[48px] ${t === k ? "bg-yellow-400 text-slate-950" : "text-slate-200"}">
    <span class="block text-sm font-black">${label}</span><span class="block text-[10px] ${t === k ? "text-slate-800" : "text-slate-400"}">${sub}</span></button>`;
  return `<div class="flex gap-1 bg-slate-900 border border-slate-800 p-1 rounded-2xl" role="group" aria-label="Was möchtest du verkaufen?">
    ${b("card", "🃏 Einzelkarten", "Scannen, Album, Doppelte")}${b("item", "📦 Pokémon-Artikel", "Displays, ETBs, Ordner, Plüsch …")}</div>`;
}

function setSellType(t) {
  state.sellType = t === "item" ? "item" : "card";
  applyMarketMode();
}

function mySalesHtml() {
  if (!state.user && !pickerDemoOn()) {
    return `<div class="poke-glass rounded-3xl p-5 text-center space-y-3">
      <p class="text-sm font-black text-white">📦 Meine Käufe & Verkäufe</p>
      <p class="text-xs text-slate-300">Melde dich an, um Käufe, Verkäufe, Tausche und deine Inserate an einem Ort zu verwalten.</p>
      ${btn("Anmelden", "PS.openAccount()", "w-full bg-yellow-400 text-slate-950")}
    </div>`;
  }
  const m = state.me || {};
  // Reel-Aufnahme (Demo-Bestand): keine echten Inserate des angemeldeten Kontos zeigen
  const mine = pickerDemoOn() ? [] : (state.listings || []).filter((l) => l.user_id === state.user?.id);
  const tile = (icon, label, sub, on, cls = "text-white") => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl p-3 min-h-[64px]">
    <span class="block text-sm font-black ${cls}">${icon} ${label}</span><span class="block text-[11px] text-slate-400">${sub}</span></button>`;
  return `<div class="space-y-3">
    <div class="grid grid-cols-2 gap-2">
      ${tile("🛒", "Käufe & Verkäufe", "Bestellungen, Versand, DHL-Etikett", "PS.openOrders()")}
      ${tile("🤝", "Meine Tausche", `${Number(m.usage?.open_trades || 0)} offen`, "PS.openTrades()")}
      ${tile("🛍️", "Warenkorb", "Mehrere Karten, eine Zahlung", "PS.openCart()")}
      ${tile("🏪", "Händler-Bereich", "Bestands-Import, DHL-Zugang", "PS.openSellerHub()", "text-amber-200")}
      ${tile("🏷️", "Karte verkaufen", "Inserieren & Doppelte verkaufen", "PS.marketTab('sell')", "text-emerald-200")}
    </div>
    <div class="flex items-center justify-between px-1"><h3 class="text-sm font-black text-white">Meine Inserate (${mine.length})</h3></div>
    <div class="space-y-2">${mine.length ? mine.map((l) => window.PS?.listingCard?.(l) || "").join("")
      : `<div class="poke-glass rounded-2xl p-5 text-center text-xs text-slate-400">Noch keine Inserate. Tippe auf „🏷️ Inserieren“, um Doppelte aus deinem Album zu verkaufen, oder scanne eine Karte und tippe auf „🏷️ Verkaufen“.</div>`}</div>
  </div>`;
}

/** Stapel-Inserat („Mehrere Karten auf einmal inserieren“) gehört zum Unterreiter „Inserieren“ – Knoten wird dorthin verschoben. */
function placeBatchBox(mode) {
  const box = $("ps-batch-details");
  if (!box) return;
  const slot = $("ps-batch-slot");
  const home = $("ps-batch-home");
  if (mode === "sell" && slot && box.parentElement !== slot) slot.appendChild(box);
  else if (mode !== "sell" && home && box.previousElementSibling !== home) home.after(box);
}

function applyMarketMode() {
  const section = $("view-map");
  if (!section) return;
  const mode = marketMode();
  section.dataset.marketMode = mode;
  let panel = $("ps-my-sales");
  if (mode === "mine" || mode === "sell" || mode === "sealed") {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ps-my-sales";
      section.querySelector("[data-page-top]")?.after(panel);
    }
    // 📦 Sealed & OVP: eigener Bereich (client/sealed-market.js) – Gerüst bleibt beim erneuten Rendern erhalten (Eingaben)
    if (mode === "sealed") {
      if (panel.dataset.panel !== "sealed" || !panel.querySelector("#ps-sealed-market")) panel.innerHTML = window.PS?.sealedMarketHtml?.() || "";
      panel.dataset.panel = mode;
      window.PS?.renderSealedMarket?.();
    } else {
      panel.dataset.panel = mode;
      panel.innerHTML = mode === "sell" ? sellHtml() : mySalesHtml();
    }
    if (mode === "sell") renderListPicker();
  } else panel?.remove();
  // „🔄 Tauschen“: Tausch-Zentrale über dem Karten-Raster (Filter „Tausch“ ist automatisch aktiv)
  let strip = $("ps-trade-strip");
  if (mode === "trade") {
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "ps-trade-strip";
      section.querySelector("[data-page-top]")?.after(strip);
    }
    strip.innerHTML = tradeStripHtml();
  } else strip?.remove();
  placeBatchBox(mode);
  renderSegments();
  window.PS?.renderMarketList?.();
}

function setMarketMode(mode) {
  if (!["buy", "trade", "mine", "sell", "sealed"].includes(mode)) return;
  if ($("view-map")?.classList.contains("hidden")) window.switchTab?.("map");
  state.marketMode = mode;
  // „Inserieren“ / „Käufe & Verkäufe“ werden nicht dauerhaft gemerkt: Der Marktplatz öffnet immer mit dem Karten-Raster
  const panelMode = mode === "mine" || mode === "sell" || mode === "sealed";
  if (!panelMode) { try { localStorage.setItem(MARKET_MODE_KEY, mode); } catch {} }
  applyMarketMode();
  if (!panelMode) window.PS?.showSub?.("map", "market", { silent: true });
}

/** Unterreiter im Marktplatz: PokeSwipe-Radar | Tauschen | Alle Karten & Suche | Inserieren | Käufe & Verkäufe */
function marketTab(key) {
  if (key === "swipe") { window.switchTab?.("swipe"); renderSegments(); return; }
  setMarketMode(key === "mine" || key === "sell" || key === "trade" || key === "sealed" ? key : "buy");
}

/** Tausch-Zentrale im Marktplatz: alle Wege zum Kartentausch auf einen Blick. */
function tradeStripHtml() {
  const open = Number(state.me?.usage?.open_trades || 0);
  const tile = (icon, label, sub, on, cls = "text-white") => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl px-3 py-2.5 min-h-[56px]">
    <span class="block text-xs font-black ${cls}">${icon} ${label}</span><span class="block text-[10px] text-slate-400 truncate">${sub}</span></button>`;
  return `<div class="ps-card p-3 space-y-2 border border-emerald-400/40">
    <p class="text-sm font-black text-emerald-200">🔄 Tauschen – Karte gegen Karte, fair nach Cardmarket-Wert</p>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      ${tile("📌", "Tausch-Gesuche", "Schwarzes Brett der Sammler", "PS.boardCategory('trade')", "text-emerald-200")}
      ${tile("🤝", "Meine Tausche", state.user ? `${open} offen · Tausch-Chat` : "Anmelden & tauschen", state.user ? "PS.openTrades()" : "PS.openAccount()")}
      ${tile("👥", "Freunde & 1:1-Tausch", "Chat, Tausch & Treffen", "PS.openFriends()")}
      ${tile("💚", "Swipe-Tausch", "Rechts wischen = Interesse", "PS.marketTab('swipe')")}
    </div>
    <p class="text-[10px] text-slate-400">Unten: alle Inserate mit Tausch-Angebot. Bei jedem Inserat „🤝 Anfragen“ tippen oder eine eigene Karte ans Brett heften.</p>
  </div>`;
}

/** Unterreiter im Album: Set-Album | 🎯 Lücken-Radar | Wunschliste | Preis-Radar */
function collectionTab(key) {
  if (key === "radar") { window.switchTab?.("flip"); renderSegments(); return; }
  if ($("view-portfolio")?.classList.contains("hidden")) window.switchTab?.("portfolio");
  window.PS?.showSub?.("portfolio", key === "wishlist" ? "wishlist" : key === "gaps" ? "gaps" : "overview", { silent: true });
  renderSegments();
}

/** Unterreiter in der Community: Live-Chat | Feed (Pull-Wall) */
function communityTab(key) {
  const k = key === "wall" ? "wall" : "chat";
  try { localStorage.setItem(COMMUNITY_KEY, k); } catch {}
  if ($("view-community")?.classList.contains("hidden")) window.switchTab?.("community");
  // Live-Chat und Beiträge liegen im Unterbereich „feed“ – Kalender & Bestenliste sind Teil der Pull-Wall
  if (k === "chat") window.PS?.showSub?.("community", "feed", { silent: true });
  renderSegments();
  window.PS?.savePref?.("communityPanel", k);
  if (k === "chat") setTimeout(() => { const box = $("chat-messages"); if (box) box.scrollTop = box.scrollHeight; }, 0);
}

// ---------------------------------------------------------------------------
// Profil-Bereich
// ---------------------------------------------------------------------------
function card(title, body, { open = false, id = "" } = {}) {
  return `<details class="ps-acc poke-glass rounded-3xl overflow-hidden" ${open ? "open" : ""} ${id ? `id="${id}"` : ""}>
    <summary class="flex items-center justify-between gap-2 px-4 py-3.5 cursor-pointer select-none text-sm font-black text-white min-h-[52px]">${title}<span class="ps-acc-chevron text-slate-400" aria-hidden="true">▾</span></summary>
    <div class="px-4 pb-4 space-y-2 text-xs">${body}</div>
  </details>`;
}
const row = (icon, label, on, sub = "", cls = "text-white") => `<button type="button" onclick="${on}" class="w-full flex items-center gap-3 text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl px-3 py-2.5 min-h-[48px]">
  <span class="text-lg" aria-hidden="true">${icon}</span><span class="flex-1 min-w-0"><span class="block font-black ${cls}">${label}</span>${sub ? `<span class="block text-[11px] text-slate-400 truncate">${sub}</span>` : ""}</span><span class="text-slate-500" aria-hidden="true">›</span></button>`;
const link = (label, href) => `<a href="${href}" class="block w-full bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl px-3 py-2.5 font-bold text-white min-h-[44px]">${label}</a>`;

let dac7Cache = { at: 0, data: null };
async function loadDac7Status() {
  if (!state.user || Date.now() - dac7Cache.at < 60_000) return dac7Cache.data;
  try { dac7Cache = { at: Date.now(), data: await api("/api/market/tax-info") }; } catch { dac7Cache = { at: Date.now(), data: null }; }
  return dac7Cache.data;
}

function dac7Line(d) {
  if (!d) return "Steuerdaten (DAC7) – nur nötig ab 30 Verkäufen oder mehr als 2.000 € im Jahr";
  if (d.complete) return "✅ Steuerdaten vollständig · verschlüsselt gespeichert";
  if (d.blocked) return "⛔ Steuerdaten fehlen – Verkäufe mit Käuferschutz gesperrt";
  if (d.required) return "⚠️ Meldeschwelle erreicht – bitte Steuerdaten ergänzen";
  return `Dieses Jahr: ${Number(d.year?.transactions || 0)} Verkäufe · Pflicht erst ab ${Number(d.thresholds?.transactions || 30)} Verkäufen oder mehr als 2.000 €`;
}

export async function renderProfileHub() {
  const box = $("ps-profile-hub");
  if (!box) return;
  const m = state.me;
  const user = state.user;
  const plan = m?.planInfo?.label || "Free";
  const pv = window.PS?.profileView?.() || { name: m?.displayName || "Sammler", initial: "?", avatarUrl: "", emoji: "" };
  const head = user
    ? `<button type="button" onclick="PS.openAccount()" class="ps-card w-full text-left p-4 flex items-center gap-3">
        <span class="ps-avatar relative overflow-hidden w-12 h-12 text-xl shrink-0" aria-hidden="true">${esc(pv.emoji || pv.initial)}${pv.avatarUrl ? `<img src="${esc(pv.avatarUrl)}" alt="" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-cover rounded-full" onerror="this.remove()" />` : ""}</span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-black text-white truncate">${esc(pv.name)}</span>
          <span class="block text-[11px] text-slate-400 truncate">${esc(user.email || "")} · Profil bearbeiten ›</span></span>
        <span class="shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-full ${m && m.plan !== "free" ? "bg-purple-500 text-white" : "bg-slate-800 text-slate-300"}">${esc(plan)}</span>
      </button>`
    : `<div class="ps-card p-5 text-center space-y-3">
        <p class="text-base font-black text-white">Willkommen bei PokeSwipe Radar 👋</p>
        <p class="text-xs text-slate-300">Du kannst alles als Gast ausprobieren. Mit kostenlosem Konto (Google, Facebook oder E-Mail) bleiben Sammlung, Preisalarme und Tausche auf all deinen Geräten gespeichert.</p>
        <div class="grid grid-cols-2 gap-2">${btn("Anmelden", "PS.renderLogin('', 'login')", "bg-yellow-400 text-slate-950")}${btn("Registrieren", "PS.renderLogin('', 'signup')", "bg-emerald-500 text-slate-950")}</div>
      </div>`;
  const dac7 = user ? dac7Line(await loadDac7Status()) : "";
  const pst = await (window.PS?.pushState?.() || Promise.resolve("")).catch(() => "");
  const pushLine = { on: "✅ Aktiv auf diesem Gerät – tippen zum Testen", off: "🔕 Aus – Restocks, Tausch, Freunde, Chats & Likes per Push", blocked: "⛔ Im Browser blockiert", "ios-install": "📲 iPhone: erst zum Home-Bildschirm hinzufügen", unsupported: "Browser ohne Push – Glocke bleibt aktiv" }[pst] || "Restocks, Tausch-Nachrichten, Freunde, Likes & Filter";
  const sections = [];
  if (user) {
    sections.push(card("👤 Konto", [
      row("⚙️", "Konto & Einstellungen", "PS.openAccount()", "Sammlername, Avatar, Stadt, Tarif, Datenschutz"),
      row("🔔", "Mitteilungen", "PS.openNotifications()", state.unread ? `${Number(state.unread)} ungelesen` : "Alles gelesen"),
      row("🌐", m?.publicProfile ? "Mein öffentliches Profil" : "Profil öffentlich machen", m?.publicProfile ? `PS.openProfile(${esc(JSON.stringify(String(m?.profileSlug || "")))})` : "PS.openProfileSettings()", "", "text-yellow-300"),
      row("👥", "Freunde & Nachrichten", "PS.openFriends()", "Freundschaftsanfragen, 1:1-Chat, Tausch & Treffen"),
      row("🔄", "Tauschen", "PS.openTradeHub()", "Tausch-Gesuche, Matches, Swipe-Tausch & Meine Tausche", "text-emerald-200"),
      row("🔥", "Meine Matches", "PS.openMatches()"),
      row("⭐", "Gefolgt & Follower", "PS.openFollowing()"),
      row("🟢", "Gerade online & Sammlung teilen", "PS.openOnlineList()", m?.binderVisible === false ? "Deine Sammlung ist privat" : "Deine Tausch-Karten sind für Sammler sichtbar"),
      row("🚫", "Blockierte Nutzer", "PS.openBlocks()", "", "text-slate-300"),
    ].join(""), { open: true }));
  }
  // Gründer-Sammler: 5 Karten hochladen ODER 1 Sammler einladen → Badge, Gratis-Boosts, mehr Preis-Alarme (client/invite.js)
  sections.push(card("🚀 Teilen &amp; Freunde einladen", founderInviteHtml({ variant: "profile" }), { open: true, id: "ps-founder-card" }));
  // Freunde einladen: Fortschritt, Pro-Ablauf, nächstes Bonus-Badge, Link kopieren & WhatsApp
  sections.push(card("🎁 Freunde einladen &amp; Pro-Tage sichern", inviteProgressHtml(), { open: true, id: "ps-invite-card" }));
  sections.push(card("👑 PokeSwipe Pro-Pass", `
    <p class="text-slate-300">${m && m.plan !== "free" ? `Dein Tarif: <strong class="text-yellow-300">${esc(plan)}</strong>${m.proSource === "bonus" ? ` · geschenkt, ${esc(proStatusText(m))} – danach automatisch Free, außer du hast ein Abo` : ""}` : "Sniper-Deals ab 25 %, sofortige Restock-Alarme, niedrigere Marktplatz-Provision (3 %), Händler-Shop und Pro-Videos."}</p>
    ${row("👑", m && m.plan !== "free" ? "Tarif & Vorteile ansehen" : "Premium oder Pro freischalten", "PS.openPro()", "", "text-yellow-300")}
    ${m?.hasBilling ? row("🧾", "Abo & Rechnungen verwalten", "PS.openBillingPortal()") : ""}`, { open: !user || m?.plan === "free" }));
  if (user) {
    sections.push(card("🔒 Verkaufen mit Käuferschutz", `
      ${row("💳", m?.sellerReady ? "Verkäuferkonto ✓ (Stripe Connect)" : "Verkäuferkonto einrichten", "PS.openSeller()", m?.sellerReady ? "Auszahlungen aktiv" : "Identitätsprüfung über Stripe – danach Sofort-Kauf mit Treuhand", "text-cyan-200")}
      ${row("🧾", "Steuerdaten (DAC7 / PStTG)", "PS.openTaxInfo()", esc(dac7))}
      ${row("🏪", m?.shop?.enabled ? "Mein Händler-Shop" : "Händler-Shop (Pro)", "PS.openShopSettings()")}
      ${row("📦", "Käufe, Verkäufe & Inserate", "PS.marketTab('mine')", "Liegt im Marktplatz unter „Käufe & Verkäufe“")}`));
  }
  sections.push(card("⚙️ App & Einstellungen", `
    <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5"><span class="font-black text-white">🌐 Sprache / Language</span>${langSwitchHtml()}</div>
    <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5"><span class="font-black text-white">👀 Ansicht</span>
      <div class="ps-mode-switch inline-flex bg-slate-900 border border-slate-700 rounded-xl p-0.5 text-[11px] font-black" role="group" aria-label="Ansicht">
        <button type="button" data-mode-btn="simple" onclick="PS.setUiMode('simple')" class="px-2.5 py-1.5 rounded-lg text-slate-300">🌱 Einsteiger</button>
        <button type="button" data-mode-btn="pro" onclick="PS.setUiMode('pro')" class="px-2.5 py-1.5 rounded-lg text-slate-300">📊 Profi</button>
      </div></div>
    ${row("🔔", "Push-Benachrichtigungen aktivieren / testen", "openModal('push-modal')", esc(pushLine))}
    ${row("🚨", "Restock-Radar & Restock-Alarme", "PS.showSub('flip', 'drops')", "Displays, ETBs, Booster-Bundles & Shop-Restocks beobachten")}
    ${row("📲", "Als App installieren", "PS.installApp()")}
    ${row("❔", "Quickstart & Einführung", "PS.openQuickstart()", "", "text-slate-300")}`));
  if (m?.isAdmin) {
    sections.push(card("🛡️ Admin-Zentrale", `
      ${row("🛡️", "Admin-Zentrale öffnen", "PS.openAdmin()", "Moderation, Integrationen, Rechtliches, Betrieb", "text-purple-200")}
      ${row("🧾", "DAC7-Auswertung & BZSt-Export", "PS.openDac7Admin()", "Steuerdaten maskiert · Klartext nur im protokollierten BZSt-Export")}
      ${row("⚖️", "Marktplatz-Fälle", "PS.openMarketAdmin()", "Reklamationen, Prüfung ohne Versandnachweis")}
      ${row("🩺", "Betriebs-Wächter", "PS.openOps()", "Jobs, Fehler, Gesundheit")}
      ${row("🎬", "Auto-Reels & Pro-Videos", "PS.closeAll(); PS.openGenerator()", "", "text-yellow-300")}
      ${row("🎯", "Creator-Finder & Outreach", "PS.openCreatorAdmin()", "Starter-Liste, Kontakt-Extraktor, Promo-Codes, Resend-Warteschlange", "text-fuchsia-200")}`));
  }
  sections.push(card("🎬 Für Creator", `
    <p class="text-slate-300">YouTube, TikTok, Twitch oder Discord? Hol dir den kostenlosen VIP-Creator-Pass (dauerhaft Pro) und deinen eigenen Community-Code.</p>
    ${link("🎬 Creator-Zugang & eigenen Code sichern", "/creator")}`));
  sections.push(card("⚖️ Rechtliches", `
    ${link("Impressum", "/rechtliches#impressum")}
    ${link("Datenschutzerklärung", "/datenschutz")}
    ${link("AGB", "/rechtliches#agb")}
    ${link("Widerrufsbelehrung", "/rechtliches#widerruf")}
    ${link("Verträge hier kündigen", "/kuendigen")}`));
  // Hintergrund-Aktualisierung (/api/me, Tarif, Mitteilungen) darf aufgeklappte Bereiche – z. B. die Admin-Zentrale – nicht zuklappen
  const accKey = (d) => d.id || d.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim() || "";
  const openState = new Map([...box.querySelectorAll("details.ps-acc")].map((d) => [accKey(d), d.open]));
  box.innerHTML = `${head}${sections.join("")}${user ? btn("Abmelden", "PS.logout()", "w-full bg-rose-500/20 text-rose-300 border border-rose-500/40") : ""}`;
  if (openState.size) box.querySelectorAll("details.ps-acc").forEach((d) => { const k = accKey(d); if (openState.has(k)) d.open = openState.get(k); });
  // Ansicht-Umschalter spiegeln (aria-pressed setzt shell.js über applyMode)
  const mode = localStorage.getItem("ps_ui_mode") || (document.body.classList.contains("ps-simple") ? "simple" : "pro");
  box.querySelectorAll("[data-mode-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeBtn === mode)));
}

// ---------------------------------------------------------------------------
// Tab-Wechsel: aktiver Hauptreiter, Unterreiter, History (Zurück-Taste)
// ---------------------------------------------------------------------------
function onTab(tab) {
  if (!PAGES[tab]) return;
  const prev = current;
  current = tab;
  document.body.dataset.tab = tab;
  const nav = PAGES[tab].nav;
  document.querySelectorAll("#ps-bottom-nav .mob-nav, #ps-top-nav .tab-btn").forEach((b) => {
    const on = b.id === `mob-${nav}` || b.id === `tab-${nav}`;
    b.classList.toggle("is-active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const avatar = $("ps-profile-btn");
  if (avatar) { if (tab === "profile") avatar.setAttribute("aria-current", "page"); else avatar.removeAttribute("aria-current"); }
  if (tab === "profile") renderProfileHub();
  if (tab === "community") renderCommunityQuick();
  // Marktplatz öffnet aus anderen Bereichen immer mit dem Karten-Raster („Alle Karten“)
  if (tab === "map" && prev !== "map" && prev !== "swipe" && (state.marketMode === "mine" || state.marketMode === "sell")) state.marketMode = "buy";
  // Reiter „Marktplatz“ landet beim Öffnen direkt im Live-Swipe (client/market-swipe.js)
  if (tab === "map" && prev !== "map") { try { window.dispatchEvent(new CustomEvent("ps:market-enter")); } catch {} }
  if (tab === "map") applyMarketMode();
  renderSegments();
  // Aktiven Reiter in der Adresse halten (?tab=…) – beim Neuladen oder App-Wechsel bleibt er exakt stehen.
  // Unterbereich (?sub=…) nur behalten, wenn der neue Reiter Unterbereiche hat; ?section= gehört zum Admin-Fenster.
  if (state.urlSync && prev !== tab) {
    const hasSubs = Boolean($(`view-${tab}`)?.querySelector("[data-sub]"));
    const params = { tab, section: null, ...(hasSubs ? {} : { sub: null }) };
    if (!fromPop) syncUrl(params, { push: true, state: { psTab: tab } });
    else syncUrl(params, { state: { psTab: tab } });
  }
  fromPop = false;
}
// Erst nach dem Start (boot) schreibt die Navigation in die Adresse – sonst ginge ?tab=… vor dem Auswerten verloren
export function enableTabUrlSync() { state.urlSync = true; }

function navBack() {
  if (history.state?.psTab && history.length > 1) history.back();
  else window.switchTab?.("home");
}

export function initAppNav() {
  injectHeads();
  const orig = window.switchTab;
  if (typeof orig === "function" && !orig.__psNav) {
    const wrapped = (tab) => { orig(tab); onTab(PAGES[tab] ? tab : "home"); };
    wrapped.__psNav = true;
    window.switchTab = wrapped;
  }
  const startTab = tabFromUrl(location.href);
  try { history.replaceState({ ...(history.state || {}), psTab: PAGES[startTab] ? startTab : startTab === "admin" ? "profile" : "home" }, "", location.href); } catch {}
  window.addEventListener("popstate", (e) => {
    const tab = e.state?.psTab;
    if (!tab || !PAGES[tab]) return;
    fromPop = true;
    try { window.switchTab?.(tab); } catch { fromPop = false; }
  });
  // Unterbereiche, die über Links/Deep-Links (PS.showSub) geöffnet werden, spiegeln sich im Segment-Umschalter
  window.addEventListener("ps:sub", () => renderSegments());
  document.body.dataset.tab = "home";
  onTab("home");
  window.addEventListener("ps:plan", () => { if (current === "profile") renderProfileHub(); renderCommunityQuick(); });
}

export const appNavApi = {
  navBack,
  sellType: setSellType,
  marketMode: setMarketMode,
  marketTab,
  collectionTab,
  communityTab,
  renderProfileHub,
  renderCommunityQuick,
};
