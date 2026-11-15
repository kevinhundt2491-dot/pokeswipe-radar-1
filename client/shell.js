// PokeSwipe & Radar – App-Hülle: 5 Kernbereiche, Progressive Disclosure (Einfach/Profi), 3-Schritte-Onboarding
// mit Demo-Modus ohne Registrierung und die gemeinsame Navigation „Community & Markt“.
import { $, esc, toast, state, modal, closeModalEl } from "./core.js";
import { applyArenaPreset } from "./arena.js";

const MODE_KEY = "ps_ui_mode"; // simple | pro
const ONBOARD_KEY = "ps_onboarded"; // done | skipped
const GOAL_KEY = "ps_goal"; // collect | trade | snipe
const DEMO_KEY = "ps_demo";
const DEMO_HIDE_KEY = "ps_demo_hidden";

// Wiederkehrende Nutzer erkennen, BEVOR die App in diesem Besuch neue Einträge schreibt:
// Wer die App schon genutzt hat, behält die gewohnte volle Ansicht und sieht kein Pflicht-Onboarding.
const RETURNING = (() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k.startsWith("ps_sub_") || k === "gotrue.user" || k === "pokeswipe_matches_clean" || k === "pokeswipe_portfolio_clean" || k === "pokeswipe_user") return true;
    }
  } catch {}
  return false;
})();

const GOALS = {
  collect: {
    icon: "📚", title: "Sammeln", text: "Karten entdecken, Sammlung aufbauen und den Wert live verfolgen.",
    tab: "swipe", mode: "simple", preset: { deals: false, wish: false, rarity: "hits", listings: true },
    tip: "Tipp: Mit dem Live-Scanner landen deine Karten in Sekunden in „Meine Sammlung“.",
  },
  trade: {
    icon: "🤝", title: "Tauschen", text: "Doppelte Karten inserieren und sicher mit Sammlern in deiner Nähe tauschen.",
    tab: "map", sub: ["map", "market"], mode: "simple", preset: { deals: false, wish: false, rarity: "hits", listings: true },
    tip: "Tipp: In der Swipe-Arena tauchen jetzt auch Inserate anderer Sammler auf – nach rechts wischen = merken.",
  },
  snipe: {
    icon: "⚡", title: "Deals snipen", text: "Karten unter Marktwert finden, Restocks zur UVP und Preisalarme in Echtzeit.",
    tab: "flip", sub: ["flip", "deals"], mode: "pro", preset: { deals: true, wish: false, rarity: "hits", listings: true },
    tip: "Tipp: Die Swipe-Arena zeigt dir jetzt nur Karten unter Marktwert – Profi-Werte sind eingeblendet.",
  },
};

const LANG_OPTS = [["de", "🇩🇪", "Deutsch"], ["en", "🇬🇧", "Englisch"], ["ja", "🇯🇵", "Japanisch"]];

/** Kleine Flagge für Sammlungs-Einträge englischer/japanischer Drucke (deutsch ohne Flagge). */
export function langFlag(lang) {
  if (lang === "en") return `<span title="Englische Karte">🇬🇧 </span>`;
  if (lang === "ja") return `<span title="Japanische Karte">🇯🇵 </span>`;
  return "";
}

// ---------------------------------------------------------------------------
// Progressive Disclosure
// ---------------------------------------------------------------------------
export function getMode() {
  const m = localStorage.getItem(MODE_KEY);
  if (m === "simple" || m === "pro") return m;
  return RETURNING ? "pro" : "simple";
}

function applyMode(mode) {
  document.body.classList.toggle("ps-simple", mode === "simple");
  document.body.classList.toggle("ps-pro", mode === "pro");
  document.querySelectorAll("[data-mode-btn]").forEach((b) => {
    const on = b.dataset.modeBtn === mode;
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  // Ein ausgeblendeter Profi-Unter-Reiter darf nicht aktiv bleiben
  if (mode === "simple") {
    document.querySelectorAll("[data-subbtn][data-pro]").forEach((b) => {
      if (b.getAttribute("aria-selected") === "true") {
        const view = b.closest("section")?.id?.replace("view-", "");
        const first = b.parentElement?.querySelector("[data-subbtn]:not([data-pro])");
        if (view && first) window.PS?.showSub?.(view, first.dataset.subbtn, { silent: true });
      }
    });
  }
}

export function setMode(mode, { silent = false } = {}) {
  if (mode !== "simple" && mode !== "pro") return;
  localStorage.setItem(MODE_KEY, mode);
  applyMode(mode);
  if (!silent) toast(mode === "pro" ? "📊 Profi-Ansicht" : "✨ Einfache Ansicht",
    mode === "pro" ? "Arbitrage-Margen, PSA-Links, Grading-Tools und alle Filter sind sichtbar." : "Nur das Wichtigste – Profi-Werte kannst du jederzeit einzeln aufklappen.");
}

// Modus sofort setzen (kein Aufblitzen der Profi-Elemente)
applyMode(getMode());

// ---------------------------------------------------------------------------
// Schnellstart-Leiste (ersetzt für wiederkehrende Nutzer das große Hero-Banner)
// ---------------------------------------------------------------------------
function quickbarHtml() {
  const goal = GOALS[localStorage.getItem(GOAL_KEY)] ? localStorage.getItem(GOAL_KEY) : null;
  const actions = {
    collect: [["📷 Karte scannen", "PS.openScanner()"], ["🃏 Karten entdecken", "switchTab('swipe')"], ["💼 Meine Sammlung", "switchTab('portfolio')"]],
    trade: [["🤝 Inserate ansehen", "PS.showSub('map', 'market')"], ["➕ Karte inserieren", "switchTab('map')"], ["🗺️ Sammler in der Nähe", "PS.showSub('map', 'radar')"]],
    snipe: [["🔥 Deals swipen", "PS.arenaQuickDeals()"], ["🚨 Restock-Radar", "PS.showSub('flip', 'drops')"], ["🔔 Preisalarme", "PS.showSub('flip', 'alerts')"]],
  }[goal || "collect"];
  return `<div id="ps-quickbar" class="poke-glass rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2">
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar">
      ${actions.map(([label, on]) => `<button type="button" onclick="${on}" class="shrink-0 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl">${label}</button>`).join("")}
    </div>
    <div class="flex items-center gap-1.5">
      <div class="flex bg-slate-950 border border-slate-700 rounded-xl p-0.5 text-[11px] font-black" role="group" aria-label="Ansicht">
        <button type="button" data-mode-btn="simple" onclick="PS.setUiMode('simple')" class="ps-chip px-2.5 py-1 rounded-lg text-slate-300">✨ Einfach</button>
        <button type="button" data-mode-btn="pro" onclick="PS.setUiMode('pro')" class="ps-chip px-2.5 py-1 rounded-lg text-slate-300">📊 Profi</button>
      </div>
      <button type="button" onclick="PS.openOnboarding()" class="text-slate-400 hover:text-white text-xs font-bold px-1.5" title="Einführung erneut starten" aria-label="Einführung erneut starten">❔</button>
    </div>
  </div>`;
}

function renderQuickbar() {
  const hero = $("dex-hero");
  if (!hero) return;
  let bar = $("ps-quickbar");
  const tmp = document.createElement("div");
  tmp.innerHTML = quickbarHtml();
  if (bar) bar.replaceWith(tmp.firstElementChild);
  else hero.after(tmp.firstElementChild);
  // Großes Hero-Banner nur beim ersten Besuch – danach direkt zu den Inhalten
  hero.classList.toggle("hidden", !!localStorage.getItem(ONBOARD_KEY) || RETURNING);
  applyMode(getMode());
}

// ---------------------------------------------------------------------------
// Community & Markt: zwei Bereiche unter einem Navigationspunkt
// ---------------------------------------------------------------------------
function injectMarketSwitch() {
  for (const view of ["map", "community"]) {
    const section = $(`view-${view}`);
    if (!section || section.querySelector("[data-market-switch]")) continue;
    const bar = document.createElement("div");
    bar.dataset.marketSwitch = "1";
    bar.className = "flex bg-slate-950/90 border border-slate-700 rounded-2xl p-1 gap-1 text-xs font-black";
    bar.setAttribute("role", "tablist");
    bar.innerHTML = [["map", "🤝 Markt & Tausch"], ["community", "💬 Community & Pull-Wall"]].map(([k, label]) =>
      `<button type="button" role="tab" aria-selected="${k === view}" onclick="switchTab('${k}')" class="flex-1 py-2 rounded-xl ${k === view ? "bg-yellow-400 text-slate-950 shadow" : "text-slate-300 hover:text-white"}">${label}</button>`).join("");
    section.prepend(bar);
  }
}

// ---------------------------------------------------------------------------
// Onboarding (3 Schritte) + Demo-Modus
// ---------------------------------------------------------------------------
const ob = { step: 1, goal: null, langs: ["de"], mode: "simple" };

function obStepDots() {
  return `<div class="flex justify-center gap-1.5" aria-hidden="true">${[1, 2, 3].map((i) =>
    `<span class="h-1.5 rounded-full ${i === ob.step ? "w-6 bg-yellow-400" : i < ob.step ? "w-3 bg-yellow-400/60" : "w-3 bg-slate-700"}"></span>`).join("")}</div>
    <p class="text-[10px] text-center text-slate-500 font-bold uppercase tracking-wide">Schritt ${ob.step} von 3</p>`;
}

function renderOnboarding() {
  let body = "";
  if (ob.step === 1) {
    body = `
      <h3 class="text-lg font-black text-white text-center">Willkommen bei PokeSwipe Radar 👋</h3>
      <p class="text-xs text-slate-300 text-center">Was möchtest du hauptsächlich machen? Wir richten die App passend für dich ein.</p>
      <div class="grid grid-cols-1 gap-2">
        ${Object.entries(GOALS).map(([k, g]) => `
          <button type="button" onclick="PS.onboardGoal('${k}')" aria-pressed="${ob.goal === k}" class="ps-goal-card text-left bg-slate-900 border-2 border-slate-700 hover:border-yellow-400 rounded-2xl p-3.5 flex gap-3 items-center transition">
            <span class="text-3xl">${g.icon}</span>
            <span><span class="block text-sm font-black text-white">${g.title}</span><span class="block text-[11px] text-slate-300">${g.text}</span></span>
          </button>`).join("")}
      </div>
      <button type="button" onclick="PS.onboardSkip()" class="w-full text-[11px] text-slate-400 underline">Überspringen</button>`;
  } else if (ob.step === 2) {
    body = `
      <h3 class="text-lg font-black text-white text-center">Welche Karten interessieren dich?</h3>
      <p class="text-xs text-slate-300 text-center">Du kannst mehrere Sprachen wählen – jede hat eigene Sets, Nummern und Preise.</p>
      <div class="grid grid-cols-3 gap-2">
        ${LANG_OPTS.map(([l, flag, label]) => `
          <button type="button" onclick="PS.onboardLang('${l}')" aria-pressed="${ob.langs.includes(l)}" class="ps-goal-card bg-slate-900 border-2 border-slate-700 rounded-2xl py-3 text-center">
            <span class="block text-2xl">${flag}</span><span class="block text-xs font-black text-white mt-1">${label}</span>
          </button>`).join("")}
      </div>
      <p class="text-xs font-black text-white pt-1">Wie viel möchtest du sehen?</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" onclick="PS.onboardMode('simple')" aria-pressed="${ob.mode === "simple"}" class="ps-goal-card text-left bg-slate-900 border-2 border-slate-700 rounded-2xl p-3">
          <span class="block text-sm font-black text-white">✨ Einfach</span><span class="block text-[11px] text-slate-300">Aufgeräumt, nur das Wichtigste. Details aufklappbar.</span></button>
        <button type="button" onclick="PS.onboardMode('pro')" aria-pressed="${ob.mode === "pro"}" class="ps-goal-card text-left bg-slate-900 border-2 border-slate-700 rounded-2xl p-3">
          <span class="block text-sm font-black text-white">📊 Profi</span><span class="block text-[11px] text-slate-300">Margen, PSA-Spreads, Grading-Tools, alle Filter.</span></button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" onclick="PS.onboardStep(1)" class="bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">← Zurück</button>
        <button type="button" onclick="PS.onboardStep(3)" class="bg-yellow-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">Weiter →</button>
      </div>`;
  } else {
    const g = GOALS[ob.goal] || GOALS.collect;
    const langs = LANG_OPTS.filter(([l]) => ob.langs.includes(l)).map(([, f, label]) => `${f} ${label}`).join(", ");
    body = `
      <h3 class="text-lg font-black text-white text-center">Alles bereit ${g.icon}</h3>
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-300 space-y-1.5">
        <p>🎯 Ziel: <strong class="text-white">${g.title}</strong></p>
        <p>🌍 Karten: <strong class="text-white">${esc(langs)}</strong></p>
        <p>👀 Ansicht: <strong class="text-white">${ob.mode === "pro" ? "Profi" : "Einfach"}</strong> <span class="text-slate-500">(oben jederzeit umschaltbar)</span></p>
        <p class="text-cyan-200">${esc(g.tip)}</p>
      </div>
      ${state.user
        ? `<button type="button" onclick="PS.onboardFinish(false)" class="w-full bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black py-3 rounded-xl text-sm">Los geht's →</button>`
        : `<button type="button" onclick="PS.onboardFinish(true)" class="w-full bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black py-3 rounded-xl text-sm">▶ Demo starten – ohne Anmeldung</button>
           <button type="button" onclick="PS.onboardFinish(false, true)" class="w-full bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">✨ Kostenloses Konto erstellen</button>
           <p class="text-[10px] text-slate-500 text-center">Im Demo-Modus bleiben gemerkte Karten und deine Sammlung auf diesem Gerät. Mit Konto werden sie gesichert und Preisalarme kommen per Push.</p>`}
      <button type="button" onclick="PS.onboardStep(2)" class="w-full text-[11px] text-slate-400 underline">← Zurück</button>`;
  }
  modal("ps-onboarding", `${obStepDots()}${body}`, { onClose: () => { if (!localStorage.getItem(ONBOARD_KEY)) skipOnboarding(true); } });
}

export function openOnboarding() {
  ob.step = 1;
  ob.goal = localStorage.getItem(GOAL_KEY) || null;
  try {
    const f = JSON.parse(localStorage.getItem("ps_arena_filters") || "null");
    if (Array.isArray(f?.langs) && f.langs.length) ob.langs = f.langs.filter((l) => ["de", "en", "ja"].includes(l));
  } catch {}
  if (!ob.langs.length) ob.langs = ["de"];
  ob.mode = getMode();
  renderOnboarding();
}

function chooseGoal(goal) {
  if (!GOALS[goal]) return;
  ob.goal = goal;
  ob.mode = GOALS[goal].mode;
  ob.step = 2;
  renderOnboarding();
}

function toggleObLang(lang) {
  if (!["de", "en", "ja"].includes(lang)) return;
  if (ob.langs.includes(lang)) { if (ob.langs.length > 1) ob.langs = ob.langs.filter((l) => l !== lang); }
  else ob.langs = [...ob.langs, lang];
  renderOnboarding();
}

function finishOnboarding(demo, signup = false) {
  const goal = GOALS[ob.goal] ? ob.goal : "collect";
  const g = GOALS[goal];
  localStorage.setItem(ONBOARD_KEY, "done");
  localStorage.setItem(GOAL_KEY, goal);
  setMode(ob.mode, { silent: true });
  if (demo) { localStorage.setItem(DEMO_KEY, "1"); localStorage.removeItem(DEMO_HIDE_KEY); }
  closeModalEl("ps-onboarding");
  applyArenaPreset({ ...g.preset, langs: ob.langs.length ? ob.langs : ["de"], set: "" });
  renderQuickbar();
  renderDemoBanner();
  if (g.sub) window.PS?.showSub?.(g.sub[0], g.sub[1]);
  else window.switchTab?.(g.tab);
  if (signup) setTimeout(() => window.PS?.renderLogin?.("", "signup"), 120);
  else toast(`${g.icon} ${g.title}`, g.tip);
}

function skipOnboarding(fromClose = false) {
  localStorage.setItem(ONBOARD_KEY, "skipped");
  if (!fromClose) closeModalEl("ps-onboarding");
  setMode(getMode(), { silent: true });
  renderQuickbar();
}

// ---------------------------------------------------------------------------
// Demo-Hinweis für Nutzer ohne Konto
// ---------------------------------------------------------------------------
function renderDemoBanner() {
  const show = !state.user && localStorage.getItem(DEMO_KEY) === "1" && !sessionStorage.getItem(DEMO_HIDE_KEY);
  let el = $("ps-demo-banner");
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement("div");
  el.id = "ps-demo-banner";
  el.className = "relative z-30 max-w-7xl w-full mx-auto px-3 sm:px-6 mt-2";
  el.innerHTML = `<div class="bg-cyan-500/15 border border-cyan-400/40 rounded-2xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
    <p class="text-cyan-100"><strong>Demo-Modus:</strong> alles ausprobieren ohne Anmeldung – deine Daten bleiben nur auf diesem Gerät.</p>
    <div class="flex gap-1.5">
      <button type="button" onclick="PS.renderLogin('', 'signup')" class="bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-xl">Kostenlos sichern</button>
      <button type="button" onclick="PS.hideDemoBanner()" class="text-cyan-200 font-bold px-2" aria-label="Hinweis ausblenden">✕</button>
    </div></div>`;
  document.querySelector("header")?.after(el);
}

export const shellApi = {
  setUiMode: (m) => setMode(m),
  openOnboarding,
  onboardGoal: chooseGoal,
  onboardLang: toggleObLang,
  onboardMode: (m) => { if (m === "simple" || m === "pro") { ob.mode = m; renderOnboarding(); } },
  onboardStep: (n) => { if (n === 1 || n === 2 || (n === 3 && ob.goal)) { ob.step = n; renderOnboarding(); } else if (n === 3) { ob.goal = "collect"; ob.step = 3; renderOnboarding(); } },
  onboardFinish: finishOnboarding,
  onboardSkip: () => skipOnboarding(false),
  hideDemoBanner: () => { sessionStorage.setItem(DEMO_HIDE_KEY, "1"); renderDemoBanner(); },
  arenaQuickDeals: () => { applyArenaPreset({ deals: true }); window.switchTab?.("swipe"); },
};

export function initShell() {
  injectMarketSwitch();
  renderQuickbar();
  renderDemoBanner();
  window.addEventListener("ps:plan", () => renderDemoBanner());
}

/** Nach dem Start: Onboarding beim ersten Besuch (nicht bei Direktlinks in einen Bereich), ?mode=, ?onboarding=1. */
export function routeShell() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  if (mode === "simple" || mode === "pro") setMode(mode, { silent: true });
  if (params.get("onboarding") === "1") return openOnboarding();
  const deepLink = ["tab", "sub", "shop", "scan", "sealed", "card", "set"].some((k) => params.has(k)) || /^\/shop\//.test(location.pathname);
  if (!localStorage.getItem(ONBOARD_KEY) && !RETURNING && !deepLink && !state.recovery && !state.invite) {
    setTimeout(() => { if (!localStorage.getItem(ONBOARD_KEY) && !document.querySelector("#ps-account:not(.hidden)")) openOnboarding(); }, 900);
  }
}
