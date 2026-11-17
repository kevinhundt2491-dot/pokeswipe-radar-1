// PokeSwipe & Radar – App-Hülle: Kernbereiche, Progressive Disclosure (Einsteiger/Profi), 3-Schritte-Quickstart
// für neue Nutzer, Ziel-Einführung mit Demo-Modus ohne Registrierung und die gemeinsame Navigation „Community & Tausch“.
//
// Einsteiger-Ansicht (Standard für neue Nutzer): 4 Kernbereiche – Scanner · Sammlung · Deals/Flip-Radar · Community & Tausch.
// Profi-Ansicht: zusätzlich „Entdecken“ (Swipe-Arena) in der Navigation sowie Profi-Werkzeuge (Margen, PSA-Spreads,
// Grading-Tools, Tausch-Rechner, Sealed-Analyse, Serien-Scan, Händler-Werkzeuge). Umschalter im Header und in der Schnellstart-Leiste.
import { $, esc, toast, state, modal, closeModalEl } from "./core.js";
import { applyArenaPreset } from "./arena.js";

const MODE_KEY = "ps_ui_mode"; // simple | pro
const ONBOARD_KEY = "ps_onboarded"; // done | skipped
const GOAL_KEY = "ps_goal"; // collect | trade | snipe
const DEMO_KEY = "ps_demo";
const DEMO_HIDE_KEY = "ps_demo_hidden";
const QS_KEY = "ps_quickstart"; // { scan, value, alert, dismissed }

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

// Wer die App schon vor dem Quickstart genutzt hat, bekommt ihn nicht aufgedrängt (kann ihn über ❔ öffnen)
const RETURNING_QS = (() => { try { return RETURNING && !localStorage.getItem(QS_KEY); } catch { return RETURNING; } })();

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
  renderQuickstartCard();
  if (!silent) toast(mode === "pro" ? "📊 Profi-Ansicht" : "🌱 Einsteiger-Ansicht",
    mode === "pro" ? "Alle Bereiche und Profi-Werkzeuge: Margen, PSA-Spreads, Grading-Tools, Sealed-Analyse, Serien-Scan und alle Filter." : "4 Kernbereiche: Scanner, Sammlung, Deals und Community & Tausch – Profi-Werte kannst du jederzeit einzeln aufklappen.");
}

// Modus sofort setzen (kein Aufblitzen der Profi-Elemente)
applyMode(getMode());

// ---------------------------------------------------------------------------
// Schnellstart-Leiste (ersetzt für wiederkehrende Nutzer das große Hero-Banner)
// ---------------------------------------------------------------------------
function quickbarHtml() {
  const goal = GOALS[localStorage.getItem(GOAL_KEY)] ? localStorage.getItem(GOAL_KEY) : null;
  const actions = {
    collect: [["📷 Karte scannen", "PS.openScanner()"], ["💼 Meine Sammlung", "switchTab('portfolio')"], ["🃏 Karten swipen", "switchTab('swipe')"]],
    trade: [["🤝 Inserate ansehen", "PS.showSub('map', 'market')"], ["➕ Karte inserieren", "switchTab('map')"], ["🗺️ Sammler in der Nähe", "PS.showSub('map', 'radar')"]],
    snipe: [["🔥 Deals swipen", "PS.arenaQuickDeals()"], ["🚨 Restock-Radar", "PS.showSub('flip', 'drops')"], ["🔔 Preisalarme", "PS.showSub('flip', 'alerts')"]],
  }[goal || "collect"];
  return `<div id="ps-quickbar" class="poke-glass rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2">
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar">
      ${actions.map(([label, on]) => `<button type="button" onclick="${on}" class="shrink-0 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl">${label}</button>`).join("")}
    </div>
    <div class="flex items-center gap-1.5">
      <div class="flex bg-slate-950 border border-slate-700 rounded-xl p-0.5 text-[11px] font-black" role="group" aria-label="Ansicht">
        <button type="button" data-mode-btn="simple" onclick="PS.setUiMode('simple')" class="ps-chip px-2.5 py-1 rounded-lg text-slate-300">🌱 Einsteiger</button>
        <button type="button" data-mode-btn="pro" onclick="PS.setUiMode('pro')" class="ps-chip px-2.5 py-1 rounded-lg text-slate-300">📊 Profi</button>
      </div>
      <button type="button" onclick="PS.openQuickstart()" class="text-slate-400 hover:text-white text-xs font-bold px-1.5" title="Quickstart & Einführung" aria-label="Quickstart und Einführung öffnen">❔</button>
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
  renderQuickstartCard();
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
          <span class="block text-sm font-black text-white">🌱 Einsteiger</span><span class="block text-[11px] text-slate-300">4 Kernbereiche, aufgeräumt. Details aufklappbar.</span></button>
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
        <p>👀 Ansicht: <strong class="text-white">${ob.mode === "pro" ? "Profi" : "Einsteiger"}</strong> <span class="text-slate-500">(oben jederzeit umschaltbar)</span></p>
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
// 3-Schritte-Quickstart für neue Nutzer: 1. Karte scannen → 2. Sammlungswert sehen → 3. Alarm/Schnäppchen
// Fortschritt kommt über Ereignisse („ps:quickstart“) aus Scanner, Sammlung, Preisalarm und Restock-Radar.
// ---------------------------------------------------------------------------
const QS_STEPS = [
  { key: "scan", icon: "📷", title: "Erste Karte scannen", text: "Karte vor die Kamera halten – Name und Preis in unter 1 Sekunde.", cta: "Scanner öffnen", on: "PS.openScanner()" },
  { key: "value", icon: "💼", title: "Sammlungswert live sehen", text: "Deine Karten mit aktuellem Marktwert, Gewinn und Verlauf.", cta: "Sammlung öffnen", on: "switchTab('portfolio')" },
  { key: "alert", icon: "🔔", title: "Preisalarm oder Schnäppchen aktivieren", text: "Push bei Wunschpreis, Restock zur UVP oder Deals unter Marktwert.", cta: "Alarm einrichten", on: "PS.quickstartAlert()" },
];

export function quickstartState() {
  try { return { scan: false, value: false, alert: false, dismissed: false, ...JSON.parse(localStorage.getItem(QS_KEY) || "{}") }; }
  catch { return { scan: false, value: false, alert: false, dismissed: false }; }
}
function saveQuickstart(st) { try { localStorage.setItem(QS_KEY, JSON.stringify(st)); } catch {} }

/** Schritt erledigt (wird von Scanner, Sammlung, Alarmen per Ereignis gemeldet). */
export function markQuickstart(step) {
  const st = quickstartState();
  if (!QS_STEPS.some((x) => x.key === step) || st[step]) return;
  st[step] = true;
  saveQuickstart(st);
  const done = QS_STEPS.every((x) => st[x.key]);
  if (!st.dismissed) toast(done ? "🎉 Quickstart geschafft!" : "✅ Schritt erledigt", done ? "Du kennst jetzt das Wichtigste. Mehr Werkzeuge findest du in der Profi-Ansicht." : QS_STEPS.find((x) => !st[x.key])?.title || "");
  renderQuickstartCard();
}

function quickstartCardHtml(st) {
  const next = QS_STEPS.find((x) => !st[x.key]);
  const done = QS_STEPS.filter((x) => st[x.key]).length;
  return `<div id="ps-quickstart" class="poke-glass rounded-2xl p-3 border border-yellow-400/40 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-black text-white">🚀 Quickstart · ${done}/3 erledigt</p>
      <button type="button" onclick="PS.quickstartDismiss()" class="text-slate-400 hover:text-white text-xs font-bold px-1" aria-label="Quickstart ausblenden">✕</button>
    </div>
    <ol class="grid grid-cols-1 sm:grid-cols-3 gap-2">${QS_STEPS.map((x, i) => {
      const ok = st[x.key], current = next?.key === x.key;
      return `<li class="rounded-xl p-2.5 border ${ok ? "border-emerald-500/50 bg-emerald-500/10" : current ? "border-yellow-400 bg-slate-950" : "border-slate-800 bg-slate-950/60"} text-xs">
        <p class="font-black ${ok ? "text-emerald-300" : "text-white"}">${ok ? "✅" : `${i + 1}.`} ${x.icon} ${esc(x.title)}</p>
        <p class="text-[11px] text-slate-400 mt-0.5">${esc(x.text)}</p>
        ${!ok && current ? `<button type="button" onclick="${x.on}" class="mt-1.5 w-full bg-yellow-400 text-slate-950 font-black py-1.5 rounded-lg text-[11px]">${esc(x.cta)} →</button>` : ""}
      </li>`;
    }).join("")}</ol>
  </div>`;
}

/** Fortschritts-Karte unter der Schnellstart-Leiste – nur in der Einsteiger-Ansicht, bis alles erledigt oder ausgeblendet ist. */
function renderQuickstartCard() {
  const st = quickstartState();
  const show = getMode() === "simple" && !st.dismissed && !QS_STEPS.every((x) => st[x.key]) && !RETURNING_QS;
  const el = $("ps-quickstart");
  if (!show) { el?.remove(); return; }
  const bar = $("ps-quickbar");
  if (!bar) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = quickstartCardHtml(st);
  if (el) el.replaceWith(tmp.firstElementChild); else bar.after(tmp.firstElementChild);
}

/** Kompakter Quickstart beim allerersten Start (statt langer Einführung). */
export function openQuickstart() {
  const st = quickstartState();
  modal("ps-onboarding", `
    <h3 class="text-lg font-black text-white text-center">Willkommen bei PokeSwipe Radar 👋</h3>
    <p class="text-xs text-slate-300 text-center">In 3 Schritten startklar – kostenlos und ohne Vorwissen.</p>
    <ol class="space-y-2">${QS_STEPS.map((x, i) => `<li class="flex gap-3 items-start bg-slate-900 border border-slate-700 rounded-2xl p-3">
      <span class="w-7 h-7 shrink-0 rounded-full ${st[x.key] ? "bg-emerald-400" : "bg-yellow-400"} text-slate-950 font-black text-xs flex items-center justify-center">${st[x.key] ? "✓" : i + 1}</span>
      <span><span class="block text-sm font-black text-white">${x.icon} ${esc(x.title)}</span><span class="block text-[11px] text-slate-300">${esc(x.text)}</span></span></li>`).join("")}</ol>
    <button type="button" onclick="PS.quickstartGo()" class="w-full bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black py-3 rounded-xl text-sm">📷 Los geht's: erste Karte scannen</button>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" onclick="PS.quickstartLater()" class="bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">Erst umsehen</button>
      <button type="button" onclick="PS.openOnboarding()" class="bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">⚙️ Ziel & Sprachen wählen</button>
    </div>
    <p class="text-[10px] text-slate-500 text-center">Du startest in der 🌱 Einsteiger-Ansicht. Profi-Werkzeuge schaltest du oben mit einem Tipp frei.</p>`,
    { onClose: () => { if (!localStorage.getItem(ONBOARD_KEY)) { localStorage.setItem(ONBOARD_KEY, "skipped"); renderQuickbar(); } } });
}

function finishQuickstartIntro(action) {
  localStorage.setItem(ONBOARD_KEY, "done");
  if (!localStorage.getItem(MODE_KEY)) setMode("simple", { silent: true });
  closeModalEl("ps-onboarding");
  saveQuickstart(quickstartState());
  renderQuickbar();
  if (action === "scan") window.PS?.openScanner?.();
}

/** Schritt 3: Preisalarm (mit Sammlung) bzw. Restock-Radar/Deals (ohne Sammlung). */
function quickstartAlert() {
  window.PS?.showSub?.("flip", state.user && (state.me?.usage?.portfolio || 0) > 0 ? "alerts" : "drops");
}

// ---------------------------------------------------------------------------
// Ansicht-Umschalter im Header (Einsteiger / Profi) – jederzeit mit einem Tipp erreichbar
// ---------------------------------------------------------------------------
function injectHeaderModeSwitch() {
  if ($("ps-mode-header")) return;
  const auth = $("authBtnText")?.closest("button");
  if (!auth) return;
  const el = document.createElement("div");
  el.id = "ps-mode-header";
  // Auf dem Handy liegt der Umschalter im Bereich „Profil“ – der Kopf bleibt aufgeräumt
  el.className = "ps-mode-switch hidden lg:inline-flex items-center gap-0.5 bg-slate-900 border border-slate-600 rounded-xl p-0.5 text-[11px]";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Ansicht");
  el.innerHTML = `<button type="button" data-mode-btn="simple" onclick="PS.setUiMode('simple')" title="Einsteiger-Ansicht: 4 Kernbereiche" class="px-2 py-1 rounded-lg font-black text-slate-300">🌱<span class="hidden sm:inline"> Einsteiger</span></button>
    <button type="button" data-mode-btn="pro" onclick="PS.setUiMode('pro')" title="Profi-Ansicht: alle Bereiche und Werkzeuge" class="px-2 py-1 rounded-lg font-black text-slate-300">📊<span class="hidden sm:inline"> Profi</span></button>`;
  auth.before(el);
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
  openQuickstart,
  quickstartGo: () => finishQuickstartIntro("scan"),
  quickstartLater: () => finishQuickstartIntro(""),
  quickstartAlert,
  quickstartDismiss: () => { const st = quickstartState(); st.dismissed = true; saveQuickstart(st); renderQuickstartCard(); toast("Quickstart ausgeblendet", "Über ❔ in der Schnellstart-Leiste kannst du ihn jederzeit wieder öffnen."); },
};

/** Im Deals-Bereich: Einstieg in die Swipe-Arena mit echten Unter-Marktwert-Deals (in der Einsteiger-Ansicht kein eigener Reiter). */
function injectArenaEntry() {
  const section = $("view-flip");
  if (!section || $("ps-arena-entry")) return;
  const el = document.createElement("div");
  el.id = "ps-arena-entry";
  el.className = "ps-simple-only poke-glass rounded-2xl p-2.5 flex items-center justify-between gap-2 text-xs";
  el.innerHTML = `<p class="text-slate-200"><strong class="text-white">🃏 Deals swipen:</strong> echte Karten unter Marktwert und Tausch-Angebote – rechts merken, links weiter.</p>
    <button type="button" onclick="PS.arenaQuickDeals()" class="shrink-0 bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">Swipen →</button>`;
  section.prepend(el);
}

export function initShell() {
  // Markt/Community-Umschalter entfällt: Marktplatz hat eigene Tabs (client/app-nav.js), Community einen eigenen Seitenkopf
  injectArenaEntry();
  injectHeaderModeSwitch();
  renderQuickbar();
  renderDemoBanner();
  applyMode(getMode());
  window.addEventListener("ps:plan", () => renderDemoBanner());
  // Quickstart-Fortschritt aus allen Bereichen
  window.addEventListener("ps:quickstart", (e) => markQuickstart(String(e.detail || "")));
  window.addEventListener("ps:tab", (e) => { if (e.detail === "portfolio" && quickstartState().scan) markQuickstart("value"); });
}

/** Nach dem Start: Onboarding beim ersten Besuch (nicht bei Direktlinks in einen Bereich), ?mode=, ?onboarding=1. */
export function routeShell() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  if (mode === "simple" || mode === "pro") setMode(mode, { silent: true });
  if (params.get("onboarding") === "1") return openOnboarding();
  if (params.get("quickstart") === "1") return openQuickstart();
  const deepLink = ["tab", "sub", "shop", "scan", "sealed", "card", "set", "reel", "drop", "pro"].some((k) => params.has(k)) || /^\/shop\//.test(location.pathname);
  // Start ist immer „Entdecken“ (Swipe & Live-Deals) – auch in der Einsteiger-Ansicht ein fester Navigationspunkt
  if (!localStorage.getItem(ONBOARD_KEY) && !RETURNING && !deepLink && !state.recovery && !state.invite) {
    setTimeout(() => { if (!localStorage.getItem(ONBOARD_KEY) && !document.querySelector("#ps-account:not(.hidden)")) openQuickstart(); }, 900);
  }
}
