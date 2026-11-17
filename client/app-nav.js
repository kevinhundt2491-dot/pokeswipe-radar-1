// PokeSwipe & Radar – Mobile-First App-Navigation
//
// 5 Hauptbereiche mit eigener Seite, klarer Überschrift und Zurück-Navigation:
//   1. Entdecken      (view-swipe)     – Swipe, Top-Deals, Schnellzugriff auf Scanner & Restock-Radar
//   2. Scanner        (view-scan + view-portfolio) – Scanner mit Direkt-Inserieren | Meine Sammlung
//   3. Marktplatz     (view-map)       – Marktplatz (Direktkauf) | P2P-Tausch-Hub | Meine Verkäufe & Bestellungen
//   4. Radar          (view-flip)      – Restock-Radar | Netto-Flip-Radar | Preisalarme
//   5. Profil         (view-profile)   – Konto, Pro-Pass, Verkäuferkonto (Stripe & DAC7), Admin, Rechtliches
// Die Community (view-community) wird aus „Entdecken“ und dem Profil geöffnet.
// Browser-/Android-Zurück wechselt zwischen den Bereichen (History-State), statt die App zu verlassen.
import { $, esc, state, api, btn } from "./core.js";
import { langSwitchHtml } from "./i18n.js";

const PAGES = {
  swipe: { title: "Entdecken", sub: "Karten swipen, Live-Deals und Flip-Highlights", icon: "🃏", nav: "swipe" },
  scan: { title: "Scanner", sub: "Karte scannen, Preis sehen und direkt inserieren", icon: "📷", nav: "scan" },
  portfolio: { title: "Meine Sammlung", sub: "Gesamtwert, Wertverlauf, Binder & Sets", icon: "💼", nav: "scan" },
  map: { title: "Marktplatz & Tausch", sub: "Kaufen mit Käuferschutz, tauschen, verkaufen", icon: "🛒", nav: "map" },
  flip: { title: "Radar", sub: "Restock-Alarme und Netto-Flip-Deals in Echtzeit", icon: "📡", nav: "flip" },
  profile: { title: "Profil", sub: "Konto, Pro-Pass, Verkaufen & Rechtliches", icon: "👤", nav: "profile" },
  community: { title: "Community", sub: "Pull-Wall, Live-Chat & Events", icon: "💬", nav: "swipe" },
};
const MARKET_MODE_KEY = "ps_market_mode";
let current = "swipe";
let fromPop = false;

// ---------------------------------------------------------------------------
// Seitenkopf mit Überschrift und Zurück-Knopf
// ---------------------------------------------------------------------------
function pageHeadHtml(tab) {
  const p = PAGES[tab];
  const back = tab !== "swipe";
  return `<div class="ps-page-head flex items-center gap-2.5" data-page-head="${tab}">
    ${back ? `<button type="button" onclick="PS.navBack()" class="ps-back shrink-0 w-10 h-10 rounded-2xl bg-slate-900 border border-slate-700 text-white font-black text-base flex items-center justify-center" aria-label="Zurück">←</button>` : ""}
    <div class="min-w-0">
      <h2 class="text-lg sm:text-xl font-black text-white leading-tight">${p.icon} ${esc(p.title)}</h2>
      <p class="text-[11px] text-slate-400 truncate">${esc(p.sub)}</p>
    </div>
  </div>`;
}

/** Segment-Umschalter (z. B. Scanner | Sammlung) – große Tippflächen, eine Zeile. */
function segmentHtml(id, items, active) {
  return `<div class="ps-segment flex bg-slate-950/90 border border-slate-700 rounded-2xl p-1 gap-1 text-xs font-black" role="tablist" data-segment="${id}">
    ${items.map(([key, label, on]) => `<button type="button" role="tab" data-seg="${key}" aria-selected="${key === active}" onclick="${on}"
      class="flex-1 min-h-[40px] px-2 rounded-xl ${key === active ? "bg-yellow-400 text-slate-950 shadow" : "text-slate-300 hover:text-white"}">${label}</button>`).join("")}
  </div>`;
}

function injectHeads() {
  for (const tab of Object.keys(PAGES)) {
    const section = $(`view-${tab}`);
    if (!section || section.querySelector(":scope > [data-page-head]")) continue;
    const wrap = document.createElement("div");
    wrap.className = "space-y-3";
    wrap.dataset.pageTop = tab;
    let seg = "";
    if (tab === "scan" || tab === "portfolio") {
      seg = segmentHtml("scan", [["scan", "📷 Scanner", "switchTab('scan')"], ["portfolio", "💼 Meine Sammlung", "switchTab('portfolio')"]], tab);
    } else if (tab === "map") {
      seg = segmentHtml("market", [["buy", "🛒 Marktplatz", "PS.marketMode('buy')"], ["trade", "🤝 Tausch-Hub", "PS.marketMode('trade')"], ["mine", "📦 Meine Verkäufe", "PS.marketMode('mine')"]], marketMode());
    } else if (tab === "swipe") {
      seg = `<div class="flex gap-1.5 overflow-x-auto no-scrollbar text-xs font-black">
        <button type="button" onclick="PS.arenaQuickDeals()" class="shrink-0 bg-yellow-400 text-slate-950 px-3 py-2 rounded-xl">🔥 Nur Deals swipen</button>
        <button type="button" onclick="PS.showSub('flip', 'deals')" class="shrink-0 bg-slate-900 border border-slate-700 text-emerald-200 px-3 py-2 rounded-xl">📡 Top-Flip-Deals</button>
        <button type="button" onclick="PS.showSub('swipe', 'search')" class="shrink-0 bg-slate-900 border border-slate-700 text-white px-3 py-2 rounded-xl">🔎 Kartensuche</button>
        <button type="button" onclick="switchTab('community')" class="shrink-0 bg-slate-900 border border-slate-700 text-white px-3 py-2 rounded-xl">💬 Community</button>
      </div>`;
    }
    wrap.innerHTML = `${pageHeadHtml(tab)}${seg}`;
    section.prepend(wrap);
  }
}

// ---------------------------------------------------------------------------
// Marktplatz: Marktplatz (Direktkauf) | Tausch-Hub | Meine Verkäufe & Bestellungen
// ---------------------------------------------------------------------------
export function marketMode() {
  const m = state.marketMode || localStorage.getItem(MARKET_MODE_KEY);
  return m === "buy" || m === "trade" || m === "mine" ? m : "buy";
}

function mySalesHtml() {
  if (!state.user) {
    return `<div class="poke-glass rounded-3xl p-5 text-center space-y-3">
      <p class="text-sm font-black text-white">📦 Meine Verkäufe & Bestellungen</p>
      <p class="text-xs text-slate-300">Melde dich an, um Käufe, Verkäufe, Tausche und deine Inserate an einem Ort zu verwalten.</p>
      ${btn("Anmelden", "PS.openAccount()", "w-full bg-yellow-400 text-slate-950")}
    </div>`;
  }
  const m = state.me || {};
  const mine = (state.listings || []).filter((l) => l.user_id === state.user?.id);
  const tile = (icon, label, sub, on, cls = "text-white") => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl p-3 min-h-[64px]">
    <span class="block text-sm font-black ${cls}">${icon} ${label}</span><span class="block text-[11px] text-slate-400">${sub}</span></button>`;
  return `<div class="space-y-3">
    <div class="grid grid-cols-2 gap-2">
      ${tile("🛒", "Käufe & Verkäufe", "Bestellungen, Versand, DHL-Etikett", "PS.openOrders()")}
      ${tile("🤝", "Meine Tausche", `${Number(m.usage?.open_trades || 0)} offen`, "PS.openTrades()")}
      ${tile("🔒", m.sellerReady ? "Verkäuferkonto ✓" : "Verkäuferkonto", m.sellerReady ? "Stripe Connect aktiv" : "Käuferschutz freischalten", "PS.openSeller()", "text-cyan-200")}
      ${tile("🛍️", "Warenkorb", "Mehrere Karten, eine Zahlung", "PS.openCart()")}
      ${tile("🏪", "Händler-Bereich", "Bestands-Import, DHL-Zugang", "PS.openSellerHub()", "text-amber-200")}
      ${tile("📷", "Karte verkaufen", "Scannen & in 1 Tap inserieren", "PS.openScanner()", "text-emerald-200")}
    </div>
    <div class="flex items-center justify-between px-1"><h3 class="text-sm font-black text-white">Meine Inserate (${mine.length})</h3></div>
    <div class="space-y-2">${mine.length ? mine.map((l) => window.PS?.listingCard?.(l) || "").join("")
      : `<div class="poke-glass rounded-2xl p-5 text-center text-xs text-slate-400">Noch keine Inserate. Scanne eine Karte und tippe auf „🏷️ Verkaufen“.</div>`}</div>
  </div>`;
}

function applyMarketMode() {
  const section = $("view-map");
  if (!section) return;
  const mode = marketMode();
  section.dataset.marketMode = mode;
  section.querySelectorAll('[data-segment="market"] [data-seg]').forEach((b) => {
    const on = b.dataset.seg === mode;
    b.setAttribute("aria-selected", String(on));
    b.className = `flex-1 min-h-[40px] px-2 rounded-xl ${on ? "bg-yellow-400 text-slate-950 shadow" : "text-slate-300 hover:text-white"}`;
  });
  let panel = $("ps-my-sales");
  if (mode === "mine") {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ps-my-sales";
      section.querySelector("[data-page-top]")?.after(panel);
    }
    panel.innerHTML = mySalesHtml();
  } else panel?.remove();
  // Hinweis über der Inserate-Liste
  const hint = $("ps-market-mode-hint");
  const list = $("market-list");
  if (list && mode !== "mine") {
    const text = mode === "buy"
      ? "🛒 <strong class=\"text-white\">Marktplatz:</strong> Sofort-Kauf mit Käuferschutz (Treuhand) und DHL-Versand – das Geld geht erst nach Zustellung an den Verkäufer."
      : "🤝 <strong class=\"text-white\">Tausch-Hub:</strong> alle Inserate – Tauschanfragen, Preisvorschläge und Treffen in deiner Nähe.";
    if (hint) hint.innerHTML = text;
    else list.insertAdjacentHTML("beforebegin", `<p id="ps-market-mode-hint" class="text-[11px] text-slate-300 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">${text}</p>`);
  }
  window.PS?.renderMarketList?.();
}

function setMarketMode(mode) {
  if (!["buy", "trade", "mine"].includes(mode)) return;
  state.marketMode = mode;
  try { localStorage.setItem(MARKET_MODE_KEY, mode); } catch {}
  if ($("view-map")?.classList.contains("hidden")) window.switchTab?.("map");
  applyMarketMode();
  if (mode !== "mine") window.PS?.showSub?.("map", "market", { silent: true });
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
  const head = user
    ? `<div class="poke-glass rounded-3xl p-4 flex items-center gap-3">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 text-slate-950 font-black text-xl flex items-center justify-center shrink-0" aria-hidden="true">${esc((m?.displayName || user.email || "?").slice(0, 1).toUpperCase())}</div>
        <div class="min-w-0 flex-1"><p class="text-sm font-black text-white truncate">${esc(m?.displayName || "Sammler")}</p>
          <p class="text-[11px] text-slate-400 truncate">${esc(user.email || "")}</p></div>
        <span class="shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-full ${m && m.plan !== "free" ? "bg-purple-500 text-white" : "bg-slate-800 text-slate-300"}">${esc(plan)}</span>
      </div>`
    : `<div class="poke-glass rounded-3xl p-5 text-center space-y-3">
        <p class="text-base font-black text-white">Willkommen bei PokeSwipe Radar 👋</p>
        <p class="text-xs text-slate-300">Mit kostenlosem Konto werden Sammlung, Preisalarme und Tausche sicher gespeichert – auf all deinen Geräten.</p>
        <div class="grid grid-cols-2 gap-2">${btn("Anmelden", "PS.renderLogin('', 'login')", "bg-yellow-400 text-slate-950")}${btn("Registrieren", "PS.renderLogin('', 'signup')", "bg-emerald-500 text-slate-950")}</div>
      </div>`;
  const dac7 = user ? dac7Line(await loadDac7Status()) : "";
  const sections = [];
  if (user) {
    sections.push(card("👤 Konto", [
      row("⚙️", "Konto & Einstellungen", "PS.openAccount()", "Sammlername, Stadt, Empfehlungen, Datenschutz"),
      row("🔔", "Mitteilungen", "PS.openNotifications()", state.unread ? `${Number(state.unread)} ungelesen` : "Alles gelesen"),
      row("🔥", "Meine Matches", "PS.openMatches()"),
      row("⭐", "Gefolgt & Follower", "PS.openFollowing()"),
      row("🚫", "Blockierte Nutzer", "PS.openBlocks()", "", "text-slate-300"),
    ].join(""), { open: true }));
  }
  sections.push(card("👑 PokeSwipe Pro-Pass", `
    <p class="text-slate-300">${m && m.plan !== "free" ? `Dein Tarif: <strong class="text-yellow-300">${esc(plan)}</strong>` : "Sniper-Deals ab 25 %, sofortige Restock-Alarme, niedrigere Marktplatz-Provision (3 %), Händler-Shop und Pro-Videos."}</p>
    ${row("👑", m && m.plan !== "free" ? "Tarif & Vorteile ansehen" : "Premium oder Pro freischalten", "PS.openPro()", "", "text-yellow-300")}
    ${m?.hasBilling ? row("🧾", "Abo & Rechnungen verwalten", "PS.openBillingPortal()") : ""}
    ${link("🛑 Verträge hier kündigen", "/kuendigen")}`, { open: !user || m?.plan === "free" }));
  if (user) {
    sections.push(card("🔒 Verkaufen mit Käuferschutz", `
      ${row("💳", m?.sellerReady ? "Verkäuferkonto ✓ (Stripe Connect)" : "Verkäuferkonto einrichten", "PS.openSeller()", m?.sellerReady ? "Auszahlungen aktiv" : "Identitätsprüfung über Stripe – danach Sofort-Kauf mit Treuhand", "text-cyan-200")}
      ${row("🧾", "Steuerdaten (DAC7 / PStTG)", "PS.openTaxInfo()", esc(dac7))}
      ${row("📦", "Käufe & Verkäufe", "PS.openOrders()", "Versand, DHL-Etikett, Zustellstatus")}
      ${row("🏪", m?.shop?.enabled ? "Mein Händler-Shop" : "Händler-Shop (Pro)", "PS.openShopSettings()")}
      ${row("📥", "Händler-Bereich & Bestands-Import", "PS.openSellerHub()", "CSV-Import, DHL-Geschäftskundenzugang")}`));
  }
  sections.push(card("⚙️ App & Einstellungen", `
    <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5"><span class="font-black text-white">🌐 Sprache / Language</span>${langSwitchHtml()}</div>
    <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5"><span class="font-black text-white">👀 Ansicht</span>
      <div class="ps-mode-switch inline-flex bg-slate-900 border border-slate-700 rounded-xl p-0.5 text-[11px] font-black" role="group" aria-label="Ansicht">
        <button type="button" data-mode-btn="simple" onclick="PS.setUiMode('simple')" class="px-2.5 py-1.5 rounded-lg text-slate-300">🌱 Einsteiger</button>
        <button type="button" data-mode-btn="pro" onclick="PS.setUiMode('pro')" class="px-2.5 py-1.5 rounded-lg text-slate-300">📊 Profi</button>
      </div></div>
    ${row("🔔", "Push-Radar & Alarme", "PS.enablePush()", "Preisalarme, Restocks, Tausch-Nachrichten")}
    ${row("📲", "Als App installieren", "PS.installApp()")}
    ${row("💬", "Community & Pull-Wall", "switchTab('community')")}
    ${row("❔", "Quickstart & Einführung", "PS.openQuickstart()", "", "text-slate-300")}`));
  if (m?.isAdmin) {
    sections.push(card("🛡️ Admin-Zentrale", `
      ${row("🛡️", "Admin-Zentrale öffnen", "PS.openAdmin()", "Moderation, Integrationen, Rechtliches, Betrieb", "text-purple-200")}
      ${row("🧾", "DAC7-Auswertung & BZSt-Export", "PS.openDac7Admin()", "Steuerdaten maskiert · Klartext nur im protokollierten BZSt-Export")}
      ${row("⚖️", "Marktplatz-Fälle", "PS.openMarketAdmin()", "Reklamationen, Prüfung ohne Versandnachweis")}
      ${row("🩺", "Betriebs-Wächter", "PS.openOps()", "Jobs, Fehler, Gesundheit")}
      ${row("🎬", "Auto-Reels & Pro-Videos", "PS.closeAll(); PS.openGenerator()", "", "text-yellow-300")}`));
  }
  sections.push(card("⚖️ Rechtliches", `
    ${link("Impressum", "/rechtliches#impressum")}
    ${link("Datenschutzerklärung", "/datenschutz")}
    ${link("AGB", "/rechtliches#agb")}
    ${link("Widerrufsbelehrung", "/rechtliches#widerruf")}
    ${link("Verträge hier kündigen", "/kuendigen")}`));
  box.innerHTML = `${head}${sections.join("")}${user ? btn("Abmelden", "PS.logout()", "w-full bg-rose-500/20 text-rose-300 border border-rose-500/40") : ""}`;
  // Ansicht-Umschalter spiegeln (aria-pressed setzt shell.js über applyMode)
  const mode = localStorage.getItem("ps_ui_mode") || (document.body.classList.contains("ps-simple") ? "simple" : "pro");
  box.querySelectorAll("[data-mode-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeBtn === mode)));
}

// ---------------------------------------------------------------------------
// Tab-Wechsel: aktiver Bereich, Seitenkopf, History (Zurück-Taste)
// ---------------------------------------------------------------------------
function onTab(tab) {
  if (!PAGES[tab]) return;
  const prev = current;
  current = tab;
  document.body.dataset.tab = tab;
  const nav = PAGES[tab].nav;
  document.querySelectorAll("#ps-bottom-nav .mob-nav, .dex-nav .tab-btn").forEach((b) => {
    const on = b.id === `mob-${nav}` || b.id === `tab-${nav}`;
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (tab === "profile") renderProfileHub();
  if (tab === "map") applyMarketMode();
  if (!fromPop && prev !== tab) {
    try { history.pushState({ psTab: tab }, "", location.href); } catch {}
  }
  fromPop = false;
}

function navBack() {
  if (history.state?.psTab && history.length > 1) history.back();
  else window.switchTab?.(current === "portfolio" ? "scan" : "swipe");
}

export function initAppNav() {
  injectHeads();
  const orig = window.switchTab;
  if (typeof orig === "function" && !orig.__psNav) {
    const wrapped = (tab) => { orig(tab); onTab(tab); };
    wrapped.__psNav = true;
    window.switchTab = wrapped;
  }
  try { history.replaceState({ ...(history.state || {}), psTab: "swipe" }, "", location.href); } catch {}
  window.addEventListener("popstate", (e) => {
    const tab = e.state?.psTab;
    if (!tab || !PAGES[tab]) return;
    // Offene Dialoge zuerst schließen, statt den Bereich zu wechseln
    fromPop = true;
    try { window.switchTab?.(tab); } catch { fromPop = false; }
  });
  document.body.dataset.tab = "swipe";
  window.addEventListener("ps:plan", () => { if (current === "profile") renderProfileHub(); });
}

export const appNavApi = {
  navBack,
  marketMode: setMarketMode,
  renderProfileHub,
};
