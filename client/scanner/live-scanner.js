// PokeSwipe & Radar – Live-Kamera-Scanner (Phase 3, Profi-Upgrade): Rückkamera in hoher Auflösung mit Dauer-Autofokus,
// Tap-to-Focus und Taschenlampe, animierter Karten-Sucher (63 × 88 mm) mit Live-Status, Auto-Capture bei ruhiger, scharfer
// Karte, großer Auslöser, Galerie-Import, Erkennung im Web Worker direkt auf dem Gerät, KI-Vision als Rückfall,
// Top-3-Alternativen, Zustands-/Varianten-Schnellwahl mit Preisanpassung und Serien-Scan für ganze Stapel.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, api, handleError, requireLogin, modal, closeModalEl } from "../core.js";
import { SCORE_STRONG, SCORE_ACCEPT, quadMotion } from "../../server/scan-logic.ts";
import { readCardText, warmupOcr, ocrKind, getOcr } from "./ocr.js";
import {
  SCAN_CONDS, SCAN_FINISHES, DEFAULT_CONDITION, RESULT_ACTIONS, conditionPrice, hasOwnFinishPrice,
  newHitView, mainPrice, conditionOptions, conditionChipLabel, toggleConditionMenu, selectCondition, selectFinish,
  createActionRunner, createCooldown, zoomPlan, glareCheck, hashDecision, TARGET_ZOOM, shouldAutoFile, createAutoFiler,
} from "./scan-ui-logic.js";
import { haptic, isNative } from "../native.js";
import { openQuickList, quickListApi } from "./quick-list.js";
import { priceTagHtml } from "../price-tag.js";

// Turbo-Upgrade (ohne KI): zusätzlich zur Bild-Erkennung liest der Scanner alle ~280 ms Kartenname und Sammlernummer
// (TextDetector bzw. Tesseract.js, beides auf dem Gerät) und sucht sie unscharf im Katalog (~20.000 Karten, Text-Index im
// Worker). Der Rahmen ist nur noch eine Orientierung: die Karte darf schief, kleiner oder neben der Mitte liegen.
// Die KI ist nur noch ein optionaler Knopf („KI-Tiefenscan“) – nie mehr der Standardweg.
//
// Hybrid-Scanner (Phase 9 + Profi-Upgrade):
//  Stufe 1 – Erkennung auf dem Gerät (Kanten, Entzerrung, Spiegelungs-Unterdrückung, Kontrast-Normalisierung,
//            pHash/dHash + Farb-Signatur, nachgeschärfte Nummern-OCR)
//  Stufe 2 – lernender Index: wer eine erkannte Karte übernimmt, schickt den Fingerabdruck an /api/scan/learn
//  Stufe 3 – KI-Vision (/api/scan/vision, Gemini mit Claude-Rückfall) auf dem zugeschnittenen Kartenbild, nur wenn die
//            lokale Erkennung unsicher ist – automatisch (abschaltbar) oder per Auslöser
/** Ohne sicheren Treffer so lange warten, bevor der KI-Knopf hervorgehoben wird */
const AI_OFFER_AFTER_MS = 3500;

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const LANG_LABEL = { de: "Deutsch", en: "Englisch", ja: "Japanisch" };
const LANGS_KEY = "ps_scan_langs";
const PREFS_KEY = "ps_scan_prefs";
const CARD_RATIO = 63 / 88;
/**
 * Breite des Ausschnitts für die Live-Erkennung. Früher 520 px: die Sammlernummer war dann nur ~10 px hoch und
 * für die Ziffern-Erkennung zu unscharf. 720 px verdoppelt fast die Pixel der Nummer bei weiterhin ~30–60 ms je Bild.
 */
const FRAME_W = 720;
/** Auslöser/Auto-Capture: Einzelbild in voller Schärfe (wird nie verworfen) */
const CAPTURE_W = 1100;
const MIN_INTERVAL_MS = 90;
/** Auto-Capture: so viele ruhige, scharfe Bilder in Folge, dann wird ausgelöst */
const STABLE_FRAMES = 3;
/** „Ruhig gehalten“ – großzügiger als früher (2,5 %): leichtes Zittern der Hand reicht nicht mehr zum Abbruch */
const STABLE_MOTION = 0.045;
/**
 * Text-Erkennung (Name + Nummer) im Live-Bild: Abstand zwischen zwei Lesungen. Seit die Lesestreifen entzerrt und eng
 * zugeschnitten sind, dauert eine Lesung nur noch einen Bruchteil – die nächste darf deshalb fast sofort starten.
 */
const OCR_INTERVAL_MS = 140;
/** Kamera-Zoom (wo das Gerät ihn kann): Karte wird etwas weiter weg gehalten – dort stellen Handykameras scharf */
const CAMERA_ZOOM = TARGET_ZOOM;
/** Ein Bild ist beim Worker in Arbeit – länger als das gilt es als verloren und das nächste wird geschickt */
const FRAME_STALE_MS = 1200;
/**
 * Zwei gleiche Text-Lesungen innerhalb dieser Zeit = sicherer Treffer („Lock-on“). Früher 1,2 s – auf Handys dauert eine
 * Lesung aber oft 0,8–1,5 s, die zweite Lesung kam dann zu spät und der Treffer rastete nie ein.
 */
const TEXT_LOCK_MS = 4000;
/** Lesungen dieser Zeitspanne werden zusammengelegt (Name aus der einen, Nummer aus der nächsten Lesung) */
const TEXT_MERGE_MS = 2500;
/** Solange die Texterkennung rechnet, kommen Bild-Abgleiche seltener – beide teilen sich die CPU des Handys */
const MIN_INTERVAL_OCR_MS = 160;
const CAPTURE_COOLDOWN_MS = 2200;
/** Ohne Karte so viele Bilder in Folge → Karte gilt als entfernt (Serien-Scan, Auto-KI wieder frei) */
const GONE_FRAMES = 5;
/** Knapper Hash-Treffer, der über mehrere Bilder gleich bleibt, wird mit Alternativen angezeigt */
const NEAR_FRAMES = 3;

/** Zustände (inkl. Poor) und Varianten des Ergebnisfelds – Logik in scan-ui-logic.js */
const CONDS = SCAN_CONDS;
const FINISHES = SCAN_FINISHES;

const sc = {
  stream: null, track: null, worker: null, ready: false, loadingIndex: false, indexCount: 0, perLang: {}, ocrMode: "none",
  running: false, torch: false, timer: 0, canvas: null, ctx: null, lastSent: 0, frames: 0, msSum: 0,
  geometry: null, streakKey: null, streak: 0, current: null, currentAt: 0, info: new Map(), series: [], status: null,
  langs: readLangs(), lastProbe: null, unsureSince: 0, glare: false, pending: new Map(), reqSeq: 0, learned: new Set(),
  // Profi-Upgrade: Stabilität, Auto-Capture, Serien-Scan, Zustand/Variante
  prevCorners: null, stable: 0, focusMax: 0, gone: 0, capturing: false, lastCaptureAt: 0, autoAiUsed: false,
  nearKey: null, nearCount: 0, suppress: null, caps: {}, focusTimer: 0, uiState: "",
  // Turbo-Upgrade: Texterkennung
  textCount: 0, ocrBusy: false, lastOcrAt: 0, ocrRuns: 0, ocrMsSum: 0, ocrAlt: 0, textLock: null, cornersAt: 0, lastText: "", lastStill: null,
  hitMs: [],
  /** Kein Doppel-Scan derselben Karte innerhalb von ~0,9 s (beim Durchblättern eines Stapels) */
  cooldown: createCooldown(),
  prefs: readPrefs(),
};

function readPrefs() {
  // KI-Auto ist jetzt standardmäßig aus – nur wer es nach dem Upgrade selbst einschaltet (aiOptIn), bekommt es
  // sound: optionaler dezenter Ton beim Treffer (standardmäßig aus – Vibration reicht meist)
  const def = { condition: "NM", series: false, autoAi: false, aiOptIn: false, sound: false };
  try {
    const p = { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}) };
    if (!p.aiOptIn) p.autoAi = false;
    return p;
  } catch { return def; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(sc.prefs)); } catch {}
}

function readLangs() {
  try {
    const own = JSON.parse(localStorage.getItem(LANGS_KEY) || "null");
    if (Array.isArray(own) && own.length) return own.filter((l) => FLAG[l]);
    const arena = JSON.parse(localStorage.getItem("ps_arena_filters") || "null");
    if (Array.isArray(arena?.langs) && arena.langs.length) return arena.langs.filter((l) => FLAG[l]);
  } catch {}
  return ["de", "en", "ja"];
}

// ---------------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------------
/** Animationen des Suchers (Laser, Ecken-Puls, Auslöse-Blitz, Fokus-Ring) – eigene Keyframes, unabhängig von Tailwind. */
const SCANNER_CSS = `
#ps-ls-guide{transition:border-color .2s,box-shadow .2s}
#ps-ls-guide .ps-ls-corner{position:absolute;width:26px;height:26px;border-color:#fff;border-style:solid;border-width:0;transition:border-color .2s}
#ps-ls-guide .ps-ls-corner.tl{top:-3px;left:-3px;border-top-width:5px;border-left-width:5px;border-top-left-radius:14px}
#ps-ls-guide .ps-ls-corner.tr{top:-3px;right:-3px;border-top-width:5px;border-right-width:5px;border-top-right-radius:14px}
#ps-ls-guide .ps-ls-corner.bl{bottom:-3px;left:-3px;border-bottom-width:5px;border-left-width:5px;border-bottom-left-radius:14px}
#ps-ls-guide .ps-ls-corner.br{bottom:-3px;right:-3px;border-bottom-width:5px;border-right-width:5px;border-bottom-right-radius:14px}
#ps-ls-guide[data-state="ready"] .ps-ls-corner{border-color:#fbbf24}
#ps-ls-guide[data-state="ready"]{box-shadow:0 0 22px 2px rgba(251,191,36,.45)}
#ps-ls-guide[data-state="hit"] .ps-ls-corner{border-color:#34d399}
#ps-ls-guide[data-state="hit"]{box-shadow:0 0 28px 4px rgba(52,211,153,.75)}
#ps-ls-guide[data-state="search"] .ps-ls-corner{animation:psLsBreath 1.6s ease-in-out infinite}
#ps-ls-laser{position:absolute;left:4%;right:4%;height:3px;border-radius:3px;background:#22d3ee;box-shadow:0 0 14px 4px rgba(34,211,238,.7);animation:psLsLaser 2.2s ease-in-out infinite}
#ps-ls-guide:not([data-state="search"]) #ps-ls-laser{display:none}
#ps-ls-progress{position:absolute;left:0;bottom:-10px;height:4px;border-radius:4px;background:#fbbf24;width:0;transition:width .12s linear}
#ps-ls-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
#ps-ls-flash.on{animation:psLsFlash .45s ease-out}
.ps-ls-focus{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:2px solid #fbbf24;border-radius:12px;pointer-events:none;animation:psLsFocus .9s ease-out forwards}
#ps-ls-shutter{width:76px;height:76px;border-radius:9999px;border:5px solid #fff;background:radial-gradient(circle,#22d3ee 0 52%,rgba(15,23,42,.9) 54%);box-shadow:0 8px 24px rgba(0,0,0,.45)}
#ps-ls-shutter:active{transform:scale(.94)}
#ps-ls-shutter[data-busy="1"]{animation:psLsBreath .8s ease-in-out infinite}
@keyframes psLsLaser{0%,100%{top:6%}50%{top:92%}}
@keyframes psLsBreath{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes psLsFlash{0%{opacity:.85}100%{opacity:0}}
@keyframes psLsFocus{0%{transform:scale(1.5);opacity:1}60%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:0}}
@media (prefers-reduced-motion:reduce){#ps-ls-laser,#ps-ls-guide .ps-ls-corner,#ps-ls-flash.on{animation:none!important}}
`;

const chip = (on) => `text-[11px] font-black px-2.5 py-1.5 rounded-lg ${on ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-300"}`;

export function liveScanPanelHtml() {
  return `<div id="ps-live-scan" class="poke-glass rounded-3xl p-3 sm:p-5 space-y-3 border-2 border-cyan-400/40">
    <style>${SCANNER_CSS}</style>
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <span class="text-[10px] font-black uppercase bg-cyan-400 text-slate-950 px-2.5 py-0.5 rounded-full">⚡ Turbo-Scanner · ohne KI, auf dem Gerät</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Karte vor die Kamera halten – fertig</h2>
        <p class="text-xs text-slate-300">Kein Ausrichten, kein Auslöser: Sobald es grün blinkt, steht der Preis da.</p>
      </div>
      <div class="flex flex-wrap gap-1" role="group" aria-label="Sprachen für die Erkennung">
        ${["de", "en", "ja"].map((l) => `<button type="button" data-scan-lang="${l}" onclick="PS.liveScanLang('${l}')" class="ps-chip text-xs font-black px-2.5 py-1 rounded-lg"></button>`).join("")}
      </div>
    </div>
    <p id="ps-ls-index" class="text-[11px] text-slate-400">Lade Scanner-Status …</p>
    <div id="ps-ls-stage" class="relative mx-auto w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 select-none touch-manipulation">
      <video id="ps-ls-video" class="absolute inset-0 w-full h-full object-cover hidden" playsinline muted autoplay></video>
      <img id="ps-ls-still" alt="Hochgeladenes Kartenfoto" class="absolute inset-0 w-full h-full object-contain bg-slate-950 hidden" />
      <div id="ps-ls-idle" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-4xl" aria-hidden="true">📷</p>
        <p class="text-xs text-slate-300">Die Rückkamera wird nur genutzt, solange der Scanner offen ist. Erkennung komplett auf deinem Gerät – kein Foto-Upload, keine KI. Nur wenn du „KI-Tiefenscan“ antippst, geht der Kartenausschnitt an die KI; nur wenn du inserierst, hängt das Scan-Foto am Inserat.</p>
        <button onclick="PS.liveScanStart()" class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm px-6 py-3 rounded-2xl shadow-lg">⚡ Live-Scanner starten</button>
        <div class="flex flex-wrap justify-center gap-2">
          <label class="cursor-pointer text-xs font-black bg-slate-800 text-white px-3 py-2 rounded-xl">📸 Foto aufnehmen<input data-ls-upload="1" type="file" accept="image/*" capture="environment" class="hidden" /></label>
          <label class="cursor-pointer text-xs font-black bg-slate-800 text-white px-3 py-2 rounded-xl">🖼️ Bild hochladen<input id="ps-ls-file-idle" data-ls-upload="1" type="file" accept="image/*" class="hidden" /></label>
        </div>
      </div>
      <div id="ps-ls-mask" class="absolute pointer-events-none hidden" style="box-shadow:0 0 0 9999px rgba(2,6,23,.55);border-radius:14px"></div>
      <div id="ps-ls-guide" data-state="search" class="absolute pointer-events-none hidden rounded-[14px] border-2 border-white/40">
        <span class="ps-ls-corner tl"></span><span class="ps-ls-corner tr"></span><span class="ps-ls-corner bl"></span><span class="ps-ls-corner br"></span>
        <div id="ps-ls-laser"></div><div id="ps-ls-progress"></div>
      </div>
      <svg id="ps-ls-quad" class="absolute inset-0 w-full h-full pointer-events-none hidden" aria-hidden="true"><polygon points="" fill="rgba(52,211,153,.12)" stroke="#34d399" stroke-width="3" stroke-linejoin="round"/></svg>
      <div id="ps-ls-flash"></div>
      <p id="ps-ls-hint" role="status" class="absolute top-2 left-1/2 -translate-x-1/2 max-w-[78%] text-center text-[12px] font-black text-white bg-slate-950/75 backdrop-blur px-3 py-1 rounded-full shadow hidden"></p>
      <div id="ps-ls-tools" class="absolute top-2 right-2 flex flex-col gap-1.5 hidden">
        <button id="ps-ls-torch" onclick="PS.liveScanTorch()" class="hidden w-10 h-10 rounded-full bg-slate-900/80 text-white text-lg" aria-label="Taschenlampe" aria-pressed="false">🔦</button>
        <button onclick="PS.liveScanStop()" class="w-10 h-10 rounded-full bg-slate-900/80 text-white text-lg" aria-label="Kamera beenden">✕</button>
      </div>
      <p id="ps-ls-toast" role="status" aria-live="polite" class="absolute top-11 left-1/2 -translate-x-1/2 max-w-[86%] truncate text-center text-[12px] font-black text-slate-950 bg-emerald-400/95 px-3 py-1.5 rounded-full shadow-lg pointer-events-none transition-opacity duration-200 hidden"></p>
      <p id="ps-ls-perf" class="ps-pro-only absolute top-10 left-2 text-[10px] font-mono text-emerald-300 bg-slate-950/70 rounded px-1.5 py-0.5 hidden"></p>
      <div id="ps-ls-hud" class="absolute inset-x-2 bottom-2 hidden max-h-[88%] overflow-y-auto" aria-live="polite"></div>
    </div>
    <div class="flex items-center justify-center gap-5">
      <label class="cursor-pointer w-12 h-12 rounded-full bg-slate-800 text-white text-xl flex items-center justify-center" title="Foto aufnehmen" aria-label="Foto aufnehmen">📸<input data-ls-upload="1" type="file" accept="image/*" capture="environment" class="hidden" /></label>
      <label class="cursor-pointer w-12 h-12 rounded-full bg-slate-800 text-white text-xl flex items-center justify-center" title="Bild hochladen" aria-label="Bild aus der Galerie hochladen">🖼️<input id="ps-ls-file" data-ls-upload="1" type="file" accept="image/*" class="hidden" /></label>
      <button id="ps-ls-shutter" onclick="PS.liveScanShutter()" aria-label="Auslösen – Karte jetzt scannen" title="Auslösen (zusätzlich zur Auto-Erkennung)"></button>
      <button id="ps-ls-torch2" onclick="PS.liveScanTorch()" class="w-12 h-12 rounded-full bg-slate-800 text-white text-xl" aria-label="Taschenlampe / Blitz" aria-pressed="false" title="Taschenlampe">🔦</button>
    </div>
    <div class="flex flex-wrap justify-center gap-1.5">
      <button id="ps-ls-series-mode" onclick="PS.liveScanSeriesMode()" class="${chip(false)}" aria-pressed="false" title="Stapel durchscannen: jede Karte landet in der Liste, der Scanner ist sofort für die nächste bereit">🔁 Serien-Scan</button>
      <button id="ps-ls-autoai" onclick="PS.liveScanAutoAi()" class="${chip(false)}" aria-pressed="false" title="Standardmäßig aus. Wenn an: ist die Erkennung auf dem Gerät unsicher, prüft die KI den Kartenausschnitt automatisch (zählt als KI-Scan)">🤖 KI-Auto</button>
      <button id="ps-ls-sound" onclick="PS.liveScanSound()" class="${chip(false)}" aria-pressed="false" title="Optional: dezenter Ton bei jedem Treffer (Vibration gibt es immer, wo das Gerät sie kann)">🔔 Ton</button>
      <button id="ps-ls-ai" onclick="PS.liveScanPhoto()" class="text-[11px] bg-slate-800 text-white font-bold px-2.5 py-1.5 rounded-lg" title="Optional – nur nötig, wenn die schnelle Erkennung auf dem Gerät eine Karte nicht findet (z. B. Promo, starke Spiegelung). Zählt als KI-Scan.">🧠 KI-Tiefenscan</button>
      <button onclick="PS.showSub('scan', 'camera')" class="text-[11px] bg-slate-800 text-white font-bold px-2.5 py-1.5 rounded-lg">🔎 Suche ohne Kamera</button>
    </div>
    <div id="ps-ls-series" class="space-y-2"></div>
    <p class="text-[10px] text-slate-500">Tipp: Name oben und Nummer unten müssen lesbar sein. Unscharf? Aufs Bild tippen. Glanz? Karte leicht kippen. Dunkel? 🔦</p>
    <div id="ps-ls-admin"></div>
  </div>`;
}

function renderToggles() {
  const set = (id, on) => { const b = $(id); if (b) { b.className = chip(on); b.setAttribute("aria-pressed", String(on)); } };
  set("ps-ls-series-mode", !!sc.prefs.series);
  set("ps-ls-autoai", !!sc.prefs.autoAi);
  set("ps-ls-sound", !!sc.prefs.sound);
}

function renderLangChips() {
  document.querySelectorAll("[data-scan-lang]").forEach((b) => {
    const l = b.dataset.scanLang, on = sc.langs.includes(l);
    b.textContent = `${FLAG[l]} ${l.toUpperCase()}`;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.className = `text-xs font-black px-2.5 py-1 rounded-lg ${on ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-400"}`;
  });
}

function renderIndexLine() {
  const el = $("ps-ls-index");
  if (!el) return;
  const st = sc.status;
  if (sc.loadingIndex) { el.textContent = "⏳ Lade Karten-Index für die Erkennung …"; return; }
  if (sc.ready) {
    const parts = Object.entries(sc.perLang).map(([l, n]) => `${FLAG[l]} ${Number(n).toLocaleString("de-DE")}`).join(" · ");
    const learned = Number(sc.learnedCount) || 0;
    el.textContent = sc.indexCount ? `✅ ${(sc.indexCount - learned).toLocaleString("de-DE")} Karten erkennbar (${parts})${learned ? ` • 🧠 ${learned.toLocaleString("de-DE")} gelernte Kamera-Abdrücke` : ""}${sc.textCount ? ` • 🔤 Name + Nummer für ${sc.textCount.toLocaleString("de-DE")} Karten (ohne KI)` : sc.ocrMode !== "none" ? " • Nummern-Erkennung aktiv" : ""}` : sc.textCount ? `🔤 ${sc.textCount.toLocaleString("de-DE")} Karten per Name + Nummer erkennbar (ohne KI)` : "⚠️ Für diese Sprachen sind noch keine Karten im Scanner-Index.";
    return;
  }
  if (!st) { el.textContent = ""; return; }
  const sel = (Array.isArray(st.langs) ? st.langs : []).filter((l) => sc.langs.includes(l.lang));
  const hashed = sel.reduce((s, l) => s + l.hashed, 0), total = sel.reduce((s, l) => s + l.total, 0);
  el.textContent = total && hashed < total
    ? `Scanner-Index: ${hashed.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} Karten bereit – wird automatisch vervollständigt (wertvolle Karten zuerst).`
    : `Scanner-Index: ${hashed.toLocaleString("de-DE")} Karten bereit.`;
}

function renderAdmin() {
  const box = $("ps-ls-admin");
  if (!box) return;
  if (!state.me?.isAdmin || !sc.status) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="bg-slate-950 border border-slate-700 rounded-2xl p-3 text-[11px] text-slate-300 space-y-1.5">
    <p class="font-black text-white">🛠️ Admin: Scanner-Index</p>
    ${sc.status.langs.map((l) => `<p>${FLAG[l.lang]} ${l.hashed.toLocaleString("de-DE")} / ${l.total.toLocaleString("de-DE")} Karten${l.failed ? ` • ${l.failed} ohne Bild/Fehler` : ""}</p>`).join("")}
    ${Array.isArray(sc.status.seed) ? `<p class="text-slate-500">Basis-Index: ${sc.status.seed.map((s) => `${FLAG[s.lang]} ${Number(s.count).toLocaleString("de-DE")}`).join(" · ")}</p>` : ""}
    ${sc.status.lastHashedAt ? `<p class="text-slate-500">Zuletzt erweitert: ${new Date(sc.status.lastHashedAt).toLocaleString("de-DE")}</p>` : ""}
    <button onclick="PS.liveScanAdminRun()" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-lg">▶️ Index jetzt erweitern</button>
  </div>`;
}

async function loadStatus() {
  try { sc.status = await api("/api/scan/status"); } catch { sc.status = null; }
  renderIndexLine(); renderAdmin();
}

// ---------------------------------------------------------------------------
// Worker & Kamera
// ---------------------------------------------------------------------------
function ensureWorker() {
  if (sc.worker) return sc.worker;
  sc.worker = new Worker("/assets/scan-worker.js");
  sc.worker.onmessage = (e) => onWorker(e.data || {});
  sc.worker.onerror = () => { toast("⚠️ Scanner-Fehler", "Die Erkennung konnte nicht starten. Bitte Seite neu laden oder den KI-Foto-Scan nutzen."); };
  return sc.worker;
}

function loadIndex() {
  sc.ready = false; sc.loadingIndex = true; renderIndexLine();
  ensureWorker().postMessage({ type: "init", langs: sc.langs });
}

/** Rückkamera mit hoher Auflösung; fällt bei zu strengen Vorgaben stufenweise auf einfachere Anfragen zurück. */
async function openCamera() {
  const tries = [
    { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: "environment" },
    true,
  ];
  let last = null;
  for (const video of tries) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video }); } catch (e) {
      last = e;
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") break;
    }
  }
  throw last;
}

/**
 * Dauer-Autofokus, -Belichtung und -Weißabgleich, soweit die Kamera sie kann. Früher wurde nur „focusMode“ blind
 * gesetzt – auf vielen Android-Geräten scheiterte damit die ganze Anfrage und die Kamera blieb im Fix-Fokus (unscharfe Nummern).
 */
async function tuneTrack(track) {
  const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() || {} : {};
  sc.caps = caps;
  const has = (k, v) => Array.isArray(caps[k]) && caps[k].includes(v);
  for (const c of [
    has("focusMode", "continuous") ? { focusMode: "continuous" } : null,
    has("exposureMode", "continuous") ? { exposureMode: "continuous" } : null,
    has("whiteBalanceMode", "continuous") ? { whiteBalanceMode: "continuous" } : null,
  ].filter(Boolean)) {
    try { await track.applyConstraints({ advanced: [c] }); } catch {}
  }
  // Ohne Fähigkeits-Abfrage (ältere Browser): trotzdem versuchen
  if (!caps.focusMode) { try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {} }
  // Leichter Zoom: Handykameras stellen unter ~10–15 cm nicht scharf – genau dort hielt man die Karte, um den Rahmen zu
  // füllen. Mit Zoom füllt die Karte den Rahmen schon aus größerem Abstand, Nummer und Name sind dann scharf.
  // Sauberer Fähigkeits-Check: iOS Safari (und ältere Browser) melden oft gar keinen oder einen zu kleinen Zoom-Bereich
  // – dann bleibt es ohne Versuch beim Standard-Zoom. Scheitert das Setzen trotzdem, wird auf 1× zurückgesetzt.
  const plan = zoomPlan(caps, CAMERA_ZOOM);
  sc.zoom = 1;
  if (plan.apply) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: plan.zoom }] });
      const got = Number(track.getSettings?.().zoom);
      sc.zoom = Number.isFinite(got) && got > 0 ? got : plan.zoom;
    } catch {
      try { await track.applyConstraints({ advanced: [{ zoom: Math.max(1, Number(caps.zoom?.min) || 1) }] }); } catch {}
      sc.zoom = 1;
    }
  }
  return caps;
}

/** Tap-to-Focus: Fokus-/Belichtungspunkt an die angetippte Stelle, danach zurück zum Dauer-Autofokus. */
async function tapFocus(ev) {
  if (!sc.running || !sc.track) return;
  if (ev.target.closest("button, a, input, label, #ps-ls-hud")) return;
  const stage = $("ps-ls-stage");
  const r = stage.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const ring = document.createElement("div");
  ring.className = "ps-ls-focus";
  ring.style.left = `${x}px`; ring.style.top = `${y}px`;
  stage.appendChild(ring);
  setTimeout(() => ring.remove(), 950);
  haptic("select");
  const caps = sc.caps || {};
  const has = (k, v) => Array.isArray(caps[k]) && caps[k].includes(v);
  const point = { x: Math.max(0, Math.min(1, x / r.width)), y: Math.max(0, Math.min(1, y / r.height)) };
  const adv = {};
  if (caps.pointsOfInterest !== undefined || "pointsOfInterest" in caps) adv.pointsOfInterest = [point];
  if (has("focusMode", "single-shot")) adv.focusMode = "single-shot";
  else if (has("focusMode", "manual") && caps.focusDistance) adv.focusMode = "continuous";
  try { if (Object.keys(adv).length) await sc.track.applyConstraints({ advanced: [adv] }); } catch {}
  clearTimeout(sc.focusTimer);
  sc.focusTimer = setTimeout(() => {
    if (sc.track && has("focusMode", "continuous")) sc.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  }, 2500);
  // Neuer Fokus → Stabilitäts-Zähler und Schärfe-Referenz neu aufbauen
  sc.stable = 0;
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("📷 Keine Kamera verfügbar", "Dein Browser erlaubt hier keinen Kamerazugriff. Wähle ein Foto aus der Galerie oder nutze die Suche.");
    return;
  }
  if (sc.running || sc.starting) return;
  sc.starting = true;
  try {
    sc.stream = await openCamera();
  } catch (e) {
    sc.starting = false;
    const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
    toast(denied ? "📷 Kamera nicht erlaubt" : "📷 Kamera nicht verfügbar", denied ? "Erlaube den Kamerazugriff in den Browser-Einstellungen – oder wähle ein Foto aus der Galerie (🖼️)." : "Keine passende Kamera gefunden. Wähle ein Foto aus der Galerie (🖼️).");
    return;
  }
  sc.starting = false;
  sc.track = sc.stream.getVideoTracks()[0];
  const caps = await tuneTrack(sc.track);
  const video = $("ps-ls-video");
  video.srcObject = sc.stream;
  try { await video.play(); } catch {}
  $("ps-ls-torch")?.classList.toggle("hidden", !caps.torch);
  const t2 = $("ps-ls-torch2");
  if (t2) { t2.disabled = !caps.torch; t2.classList.toggle("opacity-40", !caps.torch); t2.title = caps.torch ? "Taschenlampe" : "Diese Kamera/dieser Browser unterstützt keine Taschenlampe"; }
  sc.torch = false;
  $("ps-ls-still")?.classList.add("hidden");
  ["ps-ls-video", "ps-ls-mask", "ps-ls-guide", "ps-ls-quad", "ps-ls-hint", "ps-ls-tools", "ps-ls-perf"].forEach((id) => $(id)?.classList.remove("hidden"));
  $("ps-ls-idle")?.classList.add("hidden");
  sc.running = true; sc.frames = 0; sc.msSum = 0; sc.streak = 0; sc.streakKey = null;
  sc.stable = 0; sc.focusMax = 0; sc.gone = 0; sc.prevCorners = null; sc.autoAiUsed = false; sc.nearKey = null; sc.nearCount = 0;
  sc.textLock = null; sc.lastStill = null; sc.ocrBusy = false; sc.frameAt = 0; sc.tightMiss = 0; sc.lastOcrAt = 0; sc.searchSince = 0; sc.prevRead = null;
  if (!sc.ready && !sc.loadingIndex) loadIndex();
  warmupOcr();
  layout();
  setUi("search", sc.ready ? "📇 Karte in den Rahmen halten" : "⏳ Lade Karten-Index …");
  tick();
}

function stop() {
  sc.running = false;
  clearTimeout(sc.timer);
  clearTimeout(sc.focusTimer);
  try { sc.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  sc.stream = null; sc.track = null;
  const video = $("ps-ls-video");
  if (video) video.srcObject = null;
  ["ps-ls-video", "ps-ls-mask", "ps-ls-guide", "ps-ls-quad", "ps-ls-hint", "ps-ls-tools", "ps-ls-perf", "ps-ls-hud", "ps-ls-still"].forEach((id) => $(id)?.classList.add("hidden"));
  $("ps-ls-idle")?.classList.remove("hidden");
}

async function toggleTorch() {
  if (!sc.track) { toast("🔦 Kamera starten", "Die Taschenlampe lässt sich nutzen, sobald die Kamera läuft."); return; }
  try {
    await sc.track.applyConstraints({ advanced: [{ torch: !sc.torch }] });
    sc.torch = !sc.torch;
    for (const id of ["ps-ls-torch", "ps-ls-torch2"]) {
      const b = $(id);
      if (b) { b.setAttribute("aria-pressed", String(sc.torch)); b.classList.toggle("bg-yellow-400", sc.torch); b.classList.toggle(id === "ps-ls-torch" ? "bg-slate-900/80" : "bg-slate-800", !sc.torch); }
    }
    sc.focusMax = 0; // neue Beleuchtung → Schärfe-Referenz neu
  } catch { toast("🔦 Nicht möglich", "Diese Kamera unterstützt keine Taschenlampe. Tipp: Karte näher ans Licht halten."); }
}

/** Rahmen im Anzeigebereich und passender Ausschnitt im Videobild (object-fit: cover beachtet). */
function layout() {
  const stage = $("ps-ls-stage"), video = $("ps-ls-video");
  if (!stage || !video) return null;
  const ew = stage.clientWidth, eh = stage.clientHeight;
  const vw = video.videoWidth, vh = video.videoHeight;
  const gw = Math.min(ew * 0.72, eh * 0.78 * CARD_RATIO), gh = gw / CARD_RATIO;
  const gx0 = (ew - gw) / 2, gy0 = (eh - gh) / 2 - eh * 0.04;
  for (const id of ["ps-ls-guide", "ps-ls-mask"]) {
    const el = $(id);
    if (el) Object.assign(el.style, { left: `${gx0}px`, top: `${gy0}px`, width: `${gw}px`, height: `${gh}px` });
  }
  if (!vw || !vh) return (sc.geometry = null);
  const s = Math.max(ew / vw, eh / vh), offX = (ew - vw * s) / 2, offY = (eh - vh * s) / 2;
  const toV = (x, y) => [(x - offX) / s, (y - offY) / s];
  // Großzügiger Ausschnitt um den Rahmen: die Karte darf deutlich daneben, kleiner oder größer liegen
  const m = gw * 0.3;
  const [rx0, ry0] = toV(Math.max(0, gx0 - m), Math.max(0, gy0 - m));
  const [rx1, ry1] = toV(Math.min(ew, gx0 + gw + m), Math.min(eh, gy0 + gh + m));
  const sx0 = Math.max(0, rx0), sy0 = Math.max(0, ry0), sx1 = Math.min(vw, rx1), sy1 = Math.min(vh, ry1);
  const k = FRAME_W / (sx1 - sx0);
  const W = FRAME_W, H = Math.round((sy1 - sy0) * k);
  const [gvx0, gvy0] = toV(gx0, gy0), [gvx1, gvy1] = toV(gx0 + gw, gy0 + gh);
  sc.geometry = {
    sx0, sy0, sw: sx1 - sx0, sh: sy1 - sy0, W, H, k, s, offX, offY,
    guide: { x0: (gvx0 - sx0) * k, y0: (gvy0 - sy0) * k, x1: (gvx1 - sx0) * k, y1: (gvy1 - sy0) * k },
  };
  return sc.geometry;
}

function hint(text) {
  const el = $("ps-ls-hint");
  if (el) el.textContent = text || "";
}

/** Sucher-Zustand: search (weiß, Laser) → ready (gelb, „ruhig halten“) → hit (grün, „Erkannt!“) */
function setUi(stateName, text, progress = 0) {
  const g = $("ps-ls-guide");
  if (g && sc.uiState !== stateName) { g.dataset.state = stateName; sc.uiState = stateName; }
  const bar = $("ps-ls-progress");
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  if (text !== undefined) hint(text);
}

/** Erfolg: Scan-Blitz + kurzes Vibrieren (Handy) bzw. natives Haptik-Feedback in der App */
function successFeedback() {
  const f = $("ps-ls-flash");
  if (f) { f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }
  if (isNative()) haptic("success");
  else { try { if (typeof navigator.vibrate === "function") navigator.vibrate(40); } catch {} }
  if (sc.prefs.sound) beep();
}

/** Optionaler, dezenter Treffer-Ton (kurzer Sinus, leise) – nur wenn „🔔 Ton“ eingeschaltet ist. */
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    sc.audio ||= new AC();
    const ctx = sc.audio;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = "sine"; o.frequency.setValueAtTime(1320, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.13);
  } catch {}
}

/** Kurze, nicht blockierende Bestätigung direkt im Sucher (Kamera läuft weiter, kein Ton, nach ~1,6 s weg). */
function scanToast(text) {
  const el = $("ps-ls-toast");
  if (!el) { toast(text); return; }
  el.textContent = text;
  el.classList.remove("hidden", "opacity-0");
  clearTimeout(sc.toastTimer);
  sc.toastTimer = setTimeout(() => { el.classList.add("opacity-0"); setTimeout(() => el.classList.add("hidden"), 220); }, 1600);
}

/** Ein Dialog (Schnell-Inserieren, Details, Flip-Check …) liegt über dem Scanner → keine neuen Treffer dahinter. */
const overlayOpen = () => Boolean(document.querySelector("body > div.fixed.inset-0:not(.hidden)[id]"));

function tick() {
  if (!sc.running) return;
  const panel = $("ps-live-scan");
  // Kamera aus, sobald der Bereich verlassen oder die App in den Hintergrund geht
  if (!panel || panel.offsetParent === null || document.hidden) { stop(); return; }
  const video = $("ps-ls-video");
  const now = performance.now();
  const interval = sc.ocrBusy && ocrKind() === "tesseract" ? MIN_INTERVAL_OCR_MS : MIN_INTERVAL_MS;
  // Gegendruck: erst das nächste Bild schicken, wenn das vorige ausgewertet ist. Früher stauten sich auf langsamen
  // Handys Bilder in der Worker-Warteschlange – ausgewertet wurde dann ein veraltetes Bild, und die Text-Anfragen
  // standen hinten an.
  const inFlight = sc.frameAt && now - sc.frameAt < FRAME_STALE_MS;
  // Dialog über dem Scanner (z. B. Schnell-Inserieren nach „Verkaufen“): Kamera läuft weiter, erkannt wird erst danach
  const paused = overlayOpen();
  if (sc.ready && !sc.capturing && !paused && !inFlight && video.readyState >= 2 && now - sc.lastSent >= interval) {
    const g = sc.geometry && sc.geometry.vw === video.videoWidth ? sc.geometry : layout();
    if (g) {
      g.vw = video.videoWidth;
      if (!sc.canvas) { sc.canvas = document.createElement("canvas"); sc.ctx = sc.canvas.getContext("2d", { willReadFrequently: true }); }
      if (sc.canvas.width !== g.W || sc.canvas.height !== g.H) { sc.canvas.width = g.W; sc.canvas.height = g.H; }
      sc.ctx.drawImage(video, g.sx0, g.sy0, g.sw, g.sh, 0, 0, g.W, g.H);
      const img = sc.ctx.getImageData(0, 0, g.W, g.H);
      sc.lastSent = now; sc.frameAt = now;
      sc.worker.postMessage({ type: "frame", w: g.W, h: g.H, data: img.data.buffer, guide: g.guide, ocr: sc.ocrMode !== "none" }, [img.data.buffer]);
    }
  }
  if (sc.ready && sc.textCount && !sc.capturing && !paused && video.readyState >= 2) liveOcr(video);
  const next = () => tick();
  if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(next);
  else sc.timer = setTimeout(next, 60);
}

// ---------------------------------------------------------------------------
// Ergebnisse
// ---------------------------------------------------------------------------
function drawQuad(r) {
  const g = sc.geometry, poly = document.querySelector("#ps-ls-quad polygon");
  if (!g || !poly) return;
  if (r.found && r.corners) {
    const pts = r.corners.map(([x, y]) => `${(x / g.k + g.sx0) * g.s + g.offX},${(y / g.k + g.sy0) * g.s + g.offY}`).join(" ");
    poly.setAttribute("points", pts);
  } else poly.setAttribute("points", "");
}

/** Bevorzugte Sprachvariante: Reihenfolge der gewählten Sprachen. */
function orderGroup(group) {
  const rank = (l) => { const i = sc.langs.indexOf(l); return i < 0 ? 9 : i; };
  return [...group].sort((a, b) => rank(a.lang) - rank(b.lang));
}

/**
 * Stabilitäts-Erkennung für die Auto-Auslösung: Kartenecken bewegen sich kaum (< 2,5 % der Kartenbreite) und das Bild
 * ist scharf (Laplace-Schärfe nahe am besten zuletzt gesehenen Wert – unabhängig von Kamera und Licht).
 */
function trackStability(m) {
  if (!m.found) {
    sc.gone++; sc.prevCorners = null; sc.stable = 0; sc.autoArmed = true;
    if (sc.gone >= GONE_FRAMES) { sc.suppress = null; sc.autoAiUsed = false; sc.nearKey = null; sc.nearCount = 0; sc.prevRead = null; }
    return;
  }
  sc.gone = 0;
  const motion = quadMotion(sc.prevCorners, m.corners);
  sc.prevCorners = m.corners;
  sc.cornersAt = Date.now();
  const f = Number(m.focus) || 0;
  sc.focusMax = Math.max(sc.focusMax * 0.985, f);
  const sharp = f >= sc.focusMax * 0.72 && (m.sharpness ?? 99) >= 5;
  if (motion < STABLE_MOTION && sharp) sc.stable++;
  else {
    // Deutlich bewegt (Karte gewechselt/neu ausgerichtet) → Auto-Auslösung wieder scharf schalten
    if (motion > STABLE_MOTION * 3) sc.autoArmed = true;
    sc.stable = 0;
  }
}

function onWorker(m) {
  if ((m.type === "result" || m.type === "text-result") && m.reqId && sc.pending.has(m.reqId)) {
    const resolve = sc.pending.get(m.reqId);
    sc.pending.delete(m.reqId);
    resolve(m);
    return;
  }
  if (m.type === "progress") { if (m.state === "error") toast("⚠️ Index", `${LANG_LABEL[m.lang] || m.lang}: konnte nicht geladen werden.`); return; }
  if (m.type === "ready") {
    sc.ready = true; sc.loadingIndex = false; sc.indexCount = m.count || 0; sc.perLang = m.perLang || {}; sc.ocrMode = m.ocr || "none";
    sc.learnedCount = m.learned || 0;
    sc.textCount = m.textCount || 0;
    sc.readyWaiters?.splice(0).forEach((r) => r());
    renderIndexLine();
    if (sc.running) setUi("search", sc.indexCount ? "📇 Karte in den Rahmen halten" : "Noch keine Karten im Index – Auslöser nutzt die KI.");
    return;
  }
  if (m.type === "result" && !m.reqId) sc.frameAt = 0;
  if (m.type !== "result" || !sc.running) return;
  if (m.error || m.skipped) return;
  if (m.found && !sc.searchSince && !sc.current) sc.searchSince = Date.now() - (m.ms || 0);
  sc.frames++; sc.msSum += m.ms || 0;
  const perf = $("ps-ls-perf");
  if (perf) perf.textContent = `⚡ ${Math.round(m.ms || 0)} ms · Ø ${Math.round(sc.msSum / sc.frames)} ms${sc.ocrRuns ? ` · OCR Ø ${Math.round(sc.ocrMsSum / sc.ocrRuns)} ms` : ""}${sc.hitMs.length ? ` · Treffer Ø ${Math.round(sc.hitMs.reduce((a, b) => a + b, 0) / sc.hitMs.length)} ms` : ""}${m.found ? " · Kanten ✓" : ""}${m.ocr ? ` · Nr. ${m.ocr.text}` : ""}${m.score != null && Number.isFinite(m.score) ? ` · d=${Math.round(m.score)}` : ""}${m.focus ? ` · f=${m.focus}` : ""}`;
  drawQuad(m);
  if (m.empty) { setUi("search", "Noch keine Karten im Index – Auslöser nutzt die KI."); return; }
  sc.glare = Boolean(m.glareHigh);
  trackStability(m);
  const hitFresh = sc.current && !sc.current.loading && Date.now() - sc.currentAt < 1800;
  if (m.accepted) {
    sc.unsureSince = 0;
    offerAi(false);
    if (m.probe) sc.lastProbe = { ...m.probe, at: Date.now() };
    const group = orderGroup(m.group || []);
    const keys = group.map((g) => g.key);
    const same = sc.streakKey && keys.some((k) => sc.streakKey.includes(k));
    sc.streak = same ? sc.streak + 1 : 1;
    sc.streakKey = keys;
    // Bild-Fingerabdruck zuerst: klarer Treffer, passende Kartennummer oder eindeutiges Artwork sofort – auch wenn die
    // (fett-kursive) Sammlernummer nicht lesbar ist –, sonst nach zwei übereinstimmenden Bildern
    if (hashDecision(m, sc.streak) === "hit") {
      if (sc.suppress && keys.some((k) => sc.suppress.includes(k))) { setUi("ready", "🔁 Schon gescannt – nächste Karte in den Rahmen legen"); return; }
      if (sc.current && keys.includes(sc.current.key)) { sc.currentAt = Date.now(); setUi("hit", "✅ Erkannt!"); return; }
      if (sc.cooldown.blocked(keys)) return;
      if (!sc.capturing) showHit(group, m, capturePhoto(m.corners));
      return;
    }
    setUi("ready", "✋ Perfekt, ruhig halten …", Math.max(0.5, sc.stable / STABLE_FRAMES));
    return;
  }
  sc.streak = 0; sc.streakKey = null;
  if (m.found && !sc.unsureSince) sc.unsureSince = Date.now();
  offerAi(m.found && (sc.glare || Date.now() - sc.unsureSince > AI_OFFER_AFTER_MS));
  if (!sc.capturing && !hitFresh) {
    if (!m.found) setUi("search", sc.glare ? "✨ Spiegelung – Karte leicht kippen oder Sleeve abnehmen" : "📇 Karte in den Rahmen halten");
    else if (sc.glare) setUi("ready", "✨ Spiegelung erkannt – Karte leicht kippen", sc.stable / STABLE_FRAMES);
    else if ((m.sharpness ?? 99) < 5) setUi("ready", sc.caps?.torch && !sc.torch ? "💡 Zu dunkel – Taschenlampe 🔦 antippen" : "💡 Etwas mehr Licht oder ruhiger halten", 0);
    else setUi("ready", "✋ Perfekt, ruhig halten …", sc.stable / STABLE_FRAMES);
  }
  maybeAutoCapture(m);
}

/** Auto-Capture: Karte liegt ruhig und scharf im Rahmen, die schnelle Live-Erkennung ist aber noch unsicher → auslösen. */
function maybeAutoCapture(m) {
  if (sc.capturing || !sc.autoArmed || sc.stable < STABLE_FRAMES || !m.found || m.accepted) return;
  if (sc.current && Date.now() - sc.currentAt < 1500) return;
  if (Date.now() - sc.lastCaptureAt < CAPTURE_COOLDOWN_MS) return;
  capture({ auto: true });
}

// ---------------------------------------------------------------------------
// Turbo-Upgrade: Texterkennung (Name + Sammlernummer) ohne KI
// ---------------------------------------------------------------------------
const langOfKey = (k) => (/^print:(en|ja):/.exec(k)?.[1]) || "de";

/** Achsenparalleles Rechteck eines Vierecks (Quellbild-Koordinaten). */
function rectOfQuad(q) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Lese-Bereich im Videobild: erkannte Kartenkanten (wenn frisch), sonst abwechselnd der Rahmen (+8 %) und ein kleinerer
 * Rahmen (Karte weiter weg gehalten) – so wird die Karte auch ohne gefundene Kanten gelesen.
 */
function liveCardRect(g) {
  if (sc.prevCorners && Date.now() - sc.cornersAt < 700) {
    // Kanten frisch erkannt → entzerrte, enge Lese-Streifen genau über Name und Nummer (schneller und genauer).
    // Blieben zwei solche Lesungen ohne Treffer (z. B. Kanten der Schutzhülle statt der Karte erkannt), liest jede
    // dritte Lesung den großzügigen Bereich um die Karte.
    const quad = sc.prevCorners.map(([x, y]) => [g.sx0 + x / g.k, g.sy0 + y / g.k]);
    const r = rectOfQuad(quad);
    if (sc.tightMiss >= 2 && sc.tightMiss % 3 === 2) return { x: r.x - r.w * 0.04, y: r.y - r.h * 0.03, w: r.w * 1.08, h: r.h * 1.06 };
    return { ...r, quad };
  }
  const gd = g.guide;
  const x0 = g.sx0 + gd.x0 / g.k, y0 = g.sy0 + gd.y0 / g.k, w = (gd.x1 - gd.x0) / g.k, h = (gd.y1 - gd.y0) / g.k;
  const k = (sc.ocrAlt++ % 2) ? 0.8 : 1.08;
  return { x: x0 + (w * (1 - k)) / 2, y: y0 + (h * (1 - k)) / 2, w: w * k, h: h * k };
}

/** Blendungs-Anteil des Lese-Bereichs auf einem winzigen Vorschaubild (~1 ms). */
function glareOf(src, rect) {
  try {
    const w = 64, h = Math.max(16, Math.round((w * rect.h) / Math.max(1, rect.w)));
    sc.glareCv ||= document.createElement("canvas");
    const cv = sc.glareCv;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
    return glareCheck(ctx.getImageData(0, 0, w, h).data, w, h, { stride: 1 });
  } catch { return { ratio: 0, high: false, skip: false }; }
}

/** Text-Anfrage an den Worker (Text-Index + letzte Bild-Treffer). */
function workerText(text, useHash = true, timeoutMs = 3000) {
  const reqId = `t${++sc.reqSeq}`;
  return new Promise((resolve) => {
    sc.pending.set(reqId, resolve);
    ensureWorker().postMessage({ type: "text", reqId, text, useHash });
    setTimeout(() => { if (sc.pending.delete(reqId)) resolve(null); }, timeoutMs);
  });
}

/** OCR mit Zeitlimit (beim allerersten Mal lädt Tesseract noch – dann nicht ewig warten). */
async function readTextTimed(src, rect, ms) {
  let timer;
  try {
    return await Promise.race([readCardText(src, rect), new Promise((r) => { timer = setTimeout(() => r(null), ms); })]);
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Live-Schleife: alle ~280 ms Name + Nummer lesen (immer nur eine Lesung gleichzeitig). */
async function liveOcr(video) {
  const now = performance.now();
  if (sc.ocrBusy || now - sc.lastOcrAt < OCR_INTERVAL_MS) return;
  // Treffer wird gerade angezeigt und die Karte liegt noch da → Rechenzeit sparen
  if (sc.current && Date.now() - sc.currentAt < 2500) return;
  const g = sc.geometry;
  if (!g) return;
  sc.ocrBusy = true; sc.lastOcrAt = now;
  try {
    const rect = liveCardRect(g);
    // Blendungs-Check vor dem OCR-Schnitt: starker Holo-/Sleeve-Glanz → dezenter Hinweis; bei extremer Überbelichtung
    // diese Lesung auslassen (wäre ohnehin leer) – das Bild-Matching im Worker läuft unabhängig weiter
    const gl = glareOf(video, rect);
    if (gl.high) { sc.glare = true; if (!sc.current) hint("✨ Spiegelung – Karte leicht kippen"); }
    if (gl.skip) return;
    const r = await readCardText(video, rect);
    if (!r || !sc.running) return;
    sc.ocrRuns++; sc.ocrMsSum += r.ms; sc.lastText = r.text;
    if (!r.text.trim()) { if (rect.quad || sc.tightMiss) sc.tightMiss = (sc.tightMiss || 0) + 1; return; }
    if (!sc.searchSince) sc.searchSince = Date.now() - r.ms;
    let d = await workerText(r.text);
    // Nicht sicher: mit der vorigen Lesung zusammenlegen – oft ist der Name in der einen, die Nummer in der anderen scharf
    const prev = sc.prevRead;
    sc.prevRead = { text: r.text, at: Date.now() };
    if (sc.running && (!d || d.strength !== "strong") && prev && Date.now() - prev.at < TEXT_MERGE_MS && prev.text !== r.text) {
      const merged = await workerText(`${prev.text}\n${r.text}`);
      if (merged?.accepted && (merged.strength === "strong" || !d?.accepted)) d = merged;
    }
    if (rect.quad || sc.tightMiss) sc.tightMiss = d?.accepted ? 0 : (sc.tightMiss || 0) + 1;
    onText(d);
  } catch { /* nächste Lesung */ } finally { sc.ocrBusy = false; }
}

/** Text-Ergebnis: sicher → sofort; mittel (nur Nummer) → nach zweiter gleicher Lesung („Lock-on“). */
function onText(d) {
  if (!d || !sc.running || sc.capturing) return;
  if (!d.accepted || !d.keys?.length) return;
  const now = Date.now();
  const same = sc.textLock && sc.textLock.ident === d.ident && now - sc.textLock.at < TEXT_LOCK_MS;
  sc.textLock = { ident: d.ident, at: now, n: same ? sc.textLock.n + 1 : 1 };
  if (d.strength === "strong" || sc.textLock.n >= 2) { hitFromText(d); return; }
  if (!sc.current) setUi("ready", `🔤 ${d.label || (d.number ? `Nr. ${d.number}` : d.name || "Karte")} – kurz halten …`, 0.7);
}

function hitFromText(d, photo = null) {
  const group = orderGroup(d.keys.map((k) => ({ key: k, lang: langOfKey(k) })));
  const keys = group.map((x) => x.key);
  if (sc.suppress && keys.some((k) => sc.suppress.includes(k))) { setUi("ready", "🔁 Schon gescannt – nächste Karte vor die Kamera"); return; }
  if (sc.current && keys.includes(sc.current.key)) { sc.currentAt = Date.now(); return; }
  if (!photo && sc.cooldown.blocked(keys)) return;
  sc.textLock = null;
  showHit(group, { probe: sc.lastProbe, candidates: (d.candidates || []).map((k) => ({ key: k, score: 0 })), byNumber: Boolean(d.number), via: d.via, label: d.label }, photo || capturePhoto(sc.prevCorners));
}

/**
 * Foto auf dem Gerät erkennen: Bild-Fingerabdruck + Name/Nummer (OCR) → Karte. Ohne KI.
 * Ergebnis: { accepted, keys, cands, via, m, cv, corners, ms }
 */
async function recognizePhoto(dataUrl, { ocrWaitMs = 9000 } = {}) {
  const t0 = performance.now();
  const prep = await prepareImage(dataUrl);
  const until = performance.now() + ocrWaitMs;
  // Bild-Fingerabdruck und Texterkennung parallel: die Name-/Nummern-Lesung des ganzen Rahmens startet sofort, statt
  // erst nach dem Hash-Abgleich – reicht der Fingerabdruck allein (z. B. schwer lesbare fett-kursive Nummern der
  // deutschen Karmesin-&-Purpur-Sets), wird auf die Texterkennung gar nicht erst gewartet
  const wideP = readTextTimed(prep.cv, rectOfQuad(prep.guideQuad), ocrWaitMs);
  const { m, cv, corners } = await hashImage(prep);
  const strongHash = Boolean(m.accepted && (m.byNumber || m.score <= SCORE_STRONG) && !m.glareHigh);
  let d = null;
  if (!strongHash && sc.textCount) {
    // Kanten gefunden: zusätzlich die entzerrten, engen Streifen (genauer); bewertet wird eng vor großzügig
    const tight = m.found ? await readTextTimed(cv, { ...rectOfQuad(corners), quad: corners }, Math.max(800, until - performance.now())) : null;
    const wide = await wideP;
    for (const rt of [tight, wide]) {
      if (!rt?.text?.trim()) continue;
      sc.lastText = rt.text;
      const r = await workerText(rt.text, true);
      if (r?.accepted || !d) d = r;
      if (d?.strength === "strong") break;
    }
  }
  let accepted = false, keys = [], via = "";
  if (strongHash) { accepted = true; keys = orderGroup(m.group || []).map((g) => g.key); via = m.byNumber ? "hash+number" : "hash"; }
  else if (d?.strength === "strong" || (d?.accepted && !m.accepted)) { accepted = true; keys = d.keys; via = d.via; }
  else if (m.accepted) { accepted = true; keys = orderGroup(m.group || []).map((g) => g.key); via = "hash"; }
  const seen = new Set(keys);
  // Bei sicherem Treffer nur wirklich ähnliche Alternativen, sonst großzügiger (Vorschläge)
  const limit = accepted ? SCORE_ACCEPT : SCORE_ACCEPT + 18;
  const cands = [...(d?.candidates || []), ...(m.candidates || []).filter((c) => c.score <= limit).map((c) => c.key)]
    .filter((k) => !seen.has(k) && seen.add(k)).slice(0, 6);
  return { accepted, keys, cands, via, m, cv, corners, ms: performance.now() - t0 };
}

async function fetchInfo(keys) {
  const missing = keys.filter((k) => !sc.info.has(k));
  if (missing.length) {
    try {
      const { items } = await api(`/api/scan/lookup?keys=${encodeURIComponent(missing.slice(0, 8).join(","))}`);
      for (const it of items) sc.info.set(it.key, it);
    } catch {}
  }
  return keys.map((k) => sc.info.get(k)).filter(Boolean);
}

/** Einzelbild an den Worker (mit Antwort-ID – wird nie verworfen). */
function workerFrame(msg, timeoutMs = 8000) {
  const reqId = `f${++sc.reqSeq}`;
  return new Promise((resolve) => {
    sc.pending.set(reqId, resolve);
    ensureWorker().postMessage({ type: "frame", reqId, ...msg }, [msg.data]);
    setTimeout(() => { if (sc.pending.delete(reqId)) resolve({}); }, timeoutMs);
  });
}

/**
 * Exakter Zuschnitt auf den Kartenrahmen (erkannte Ecken + 3 % Rand) als JPEG in hoher Qualität. Früher bekam die KI
 * das ganze Kamerabild inkl. Hintergrund und Hand – die Karte war darin oft nur ein Drittel der Fläche.
 */
function cropToCard(src, corners, max = 900, quality = 0.9) {
  try {
    const W = src.width, H = src.height;
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (Array.isArray(corners) && corners.length === 4) {
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      x0 = Math.min(...xs); x1 = Math.max(...xs); y0 = Math.min(...ys); y1 = Math.max(...ys);
      const mx = (x1 - x0) * 0.03, my = (y1 - y0) * 0.03;
      x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my); x1 = Math.min(W, x1 + mx); y1 = Math.min(H, y1 + my);
    }
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 40 && h > 40)) return src.toDataURL("image/jpeg", quality);
    const s = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, x0, y0, w, h, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", quality);
  } catch { return null; }
}

/**
 * Echtes Foto der erkannten Karte aus dem Kamerabild (Kartenrahmen, ca. 50 KB JPEG) – mit erkannten Ecken exakt
 * auf die Karte, sonst der Führungsrahmen. Bleibt auf dem Gerät, bis der Nutzer die Karte inseriert und das Foto anhängt.
 */
function capturePhoto(corners = null) {
  try {
    const video = $("ps-ls-video"), g = sc.geometry;
    if (!video?.videoWidth || !g) return null;
    let vx0, vy0, vw, vh;
    if (Array.isArray(corners) && corners.length === 4) {
      const xs = corners.map((p) => g.sx0 + p[0] / g.k), ys = corners.map((p) => g.sy0 + p[1] / g.k);
      vx0 = Math.min(...xs); vy0 = Math.min(...ys); vw = Math.max(...xs) - vx0; vh = Math.max(...ys) - vy0;
    } else {
      const gd = g.guide;
      vx0 = g.sx0 + gd.x0 / g.k; vy0 = g.sy0 + gd.y0 / g.k; vw = (gd.x1 - gd.x0) / g.k; vh = (gd.y1 - gd.y0) / g.k;
    }
    // kleiner Rand, damit die Kartenkanten (Zustand!) mit drauf sind
    const mx = vw * 0.04, my = vh * 0.04;
    const x0 = Math.max(0, vx0 - mx), y0 = Math.max(0, vy0 - my);
    const w = Math.min(video.videoWidth - x0, vw + 2 * mx), h = Math.min(video.videoHeight - y0, vh + 2 * my);
    if (!(w > 40 && h > 40)) return null;
    const W = 440, H = Math.round(W * (h / w));
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.getContext("2d").drawImage(video, x0, y0, w, h, 0, 0, W, H);
    const url = cv.toDataURL("image/jpeg", 0.85);
    return url.length < 400_000 ? url : cv.toDataURL("image/jpeg", 0.6);
  } catch { return null; }
}

/**
 * Auslöser (manuell oder Auto-Capture): Einzelbild in höherer Auflösung, Nummer immer lesen (nachgeschärft).
 * Sicher → Treffer. Unsicher → KI-Vision auf dem exakt zugeschnittenen Kartenbild (manuell immer, automatisch einmal
 * je Karte, wenn „KI-Auto“ an ist) – sonst die nächstbesten Treffer zur Auswahl.
 */
async function capture({ auto = false } = {}) {
  if (sc.capturing) return;
  if (!sc.running) { if (!auto) start(); return; }
  const video = $("ps-ls-video");
  const g = sc.geometry || layout();
  if (!g || !video?.videoWidth) return;
  if (!sc.ready && !auto && !state.user) { toast("⏳ Einen Moment", "Der Karten-Index lädt noch …"); return; }
  sc.capturing = true; sc.autoArmed = false; sc.lastCaptureAt = Date.now();
  const sh = $("ps-ls-shutter");
  if (sh) sh.dataset.busy = "1";
  setUi("ready", auto ? "📸 Auto-Scan …" : "📸 Scanne …", 1);
  try {
    const W = Math.max(FRAME_W, Math.min(CAPTURE_W, Math.round(g.sw))), f = W / g.W, H = Math.round(g.H * f);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, g.sx0, g.sy0, g.sw, g.sh, 0, 0, W, H);
    const guide = { x0: g.guide.x0 * f, y0: g.guide.y0 * f, x1: g.guide.x1 * f, y1: g.guide.y1 * f };
    const guideQuad = [[guide.x0, guide.y0], [guide.x1, guide.y0], [guide.x1, guide.y1], [guide.x0, guide.y1]];
    // Parallel zum Fingerabdruck schon Name + Nummer lesen – auf den frisch erkannten Kanten des Live-Bilds, sonst im Rahmen
    const freshQuad = sc.prevCorners && Date.now() - sc.cornersAt < 700 ? sc.prevCorners.map(([x, y]) => [x * f, y * f]) : null;
    const earlyRect = freshQuad ? { ...rectOfQuad(freshQuad), quad: freshQuad } : rectOfQuad(guideQuad);
    const earlyP = sc.textCount ? readTextTimed(cv, earlyRect, auto ? 1500 : 4000) : Promise.resolve(null);
    const m = sc.ready ? await workerFrame({ w: W, h: H, data: ctx.getImageData(0, 0, W, H).data.buffer, guide, ocr: true, capture: true }) : {};
    const liveCorners = m.found ? m.corners.map(([x, y]) => [x / f, y / f]) : null;
    const photo = capturePhoto(liveCorners);
    if (m.probe) sc.lastProbe = { ...m.probe, at: Date.now() };
    if (m.accepted) {
      const group = orderGroup(m.group || []);
      const keys = group.map((x) => x.key);
      if (sc.suppress && keys.some((k) => sc.suppress.includes(k))) { setUi("ready", "🔁 Schon gescannt – nächste Karte in den Rahmen legen"); return; }
      if (sc.current && keys.includes(sc.current.key)) { sc.currentAt = Date.now(); setUi("hit", "✅ Erkannt!"); return; }
      await showHit(group, m, photo);
      return;
    }
    // Ohne KI: Name + Sammlernummer aus dem scharfen Einzelbild lesen
    if (sc.textCount) {
      // Kanten gefunden: entzerrte, enge Streifen (schnell und genau), sonst der großzügige Bereich um den Rahmen
      const rect = m.found ? { ...rectOfQuad(m.corners), quad: m.corners } : rectOfQuad(guideQuad);
      let rt = await earlyP;
      let d = rt?.text?.trim() ? await workerText(rt.text, true) : null;
      // Frühe Lesung ohne Treffer, Kanten erst jetzt sicher → einmal auf den exakten Kanten nachlesen
      if (!d?.accepted && m.found && !freshQuad) {
        rt = await readTextTimed(cv, rect, auto ? 1500 : 4000);
        const d1 = rt?.text?.trim() ? await workerText(rt.text, true) : null;
        if (d1?.accepted || !d) d = d1;
      }
      if (!d?.accepted && rect.quad && !auto) {
        rt = await readTextTimed(cv, rectOfQuad(m.corners), 3000);
        const d2 = rt?.text?.trim() ? await workerText(rt.text, true) : null;
        if (d2?.accepted || !d) d = d2;
      }
      if (d?.accepted && d.keys?.length) { hitFromText(d, photo); return; }
      if (d?.candidates?.length) m.textCands = d.candidates;
    }
    // KI nur noch, wenn ausdrücklich eingeschaltet („KI-Auto“) – sonst der Knopf „KI-Tiefenscan“
    const wantAi = Boolean(state.user) && sc.prefs.autoAi && (!auto || !sc.autoAiUsed);
    if (wantAi) {
      sc.autoAiUsed = true;
      await runVision(cropToCard(cv, m.found ? m.corners : guideQuad), { probe: m.probe || null, photo });
      return;
    }
    if (!(await showNear(m, photo, auto)) && !auto) offerAi(true);
  } catch (e) {
    if (!auto) handleError(e);
  } finally {
    sc.capturing = false;
    if (sh) delete sh.dataset.busy;
  }
}

/** Unsichere Hash-Treffer als Auswahl zeigen („Meinst du …?“) statt nichts. */
async function showNear(m, photo, auto) {
  const limit = auto ? SCORE_ACCEPT + 8 : SCORE_ACCEPT + 18;
  const seen = new Set();
  const keys = [...(m.textCands || []).map((key) => ({ key, score: 0 })), ...(m.candidates || [])]
    .filter((c) => c.score <= limit && !seen.has(c.key) && seen.add(c.key)).map((c) => c.key).slice(0, 4);
  if (!keys.length) {
    setUi("ready", sc.glare ? "✨ Spiegelung – Karte leicht kippen und erneut auslösen" : "🤔 Nicht sicher – Karte gerader halten oder näher ran", 0);
    return false;
  }
  const infos = await fetchInfo(keys);
  if (!infos.length) return false;
  presentHit({ info: infos[0], variants: [infos[0]], alts: infos.slice(1, 4), probe: m.probe || null, photo, unsure: true });
  return true;
}

/** Stufe 3: KI-Vision auf dem zugeschnittenen Kartenbild (Gemini, Rückfall Claude) → Top-Treffer + Alternativen + Variante. */
async function runVision(dataUrl, { probe = null, photo = null } = {}) {
  if (!dataUrl) return false;
  if (!requireLogin()) return false;
  const prev = sc.current;
  setUi("ready", "🤖 KI erkennt Karte & Variante …", 1);
  renderHud({ loading: true, text: "🤖 KI-Vision liest Name, Nummer, KP, Seltenheit und Variante …" });
  let r;
  try {
    r = await api("/api/scan/vision", { method: "POST", body: { image: dataUrl } });
  } catch (e) {
    renderHud(prev?.info ? prev : null);
    setUi("search", "📇 Karte in den Rahmen halten");
    handleError(e);
    return false;
  }
  window.PS?.refreshMe?.();
  if (!r?.found || !r.items?.length) {
    renderHud(prev?.info ? prev : null);
    const d = r?.detected;
    setUi("search", d?.name ? `🤔 „${d.name}${d.number ? ` ${d.number}` : ""}“ nicht im Katalog` : "🤔 Keine Karte erkannt – gerader halten oder näher ran");
    toast("🤖 KI-Scan", d?.name ? `Erkannt: ${d.name} ${d.number || ""} – aber noch nicht im Katalog. Probiere die Suche.` : "Keine Pokémon-Karte erkannt. Karte gerade, hell und formatfüllend halten.");
    return false;
  }
  for (const it of r.items) sc.info.set(it.key, it);
  const [main, ...rest] = r.items;
  const finish = ["reverse_holo", "holo"].includes(r.detected?.variant) ? r.detected.variant : "normal";
  presentHit({
    info: main, variants: [main], alts: rest.slice(0, 3), probe, photo, unsure: !r.clear, source: "ai", finish,
    aiNote: [r.detected?.rarityLabel, r.detected?.hp ? `${r.detected.hp} KP` : "", r.detected?.illustrator ? `Illus. ${r.detected.illustrator}` : ""].filter(Boolean).join(" · "),
  });
  return true;
}

/** Treffer anzeigen: Scan-Blitz + Vibration, Status „Erkannt!“, HUD mit Preis, Alternativen, Zustand und Aktionen. */
function presentHit(cur) {
  const info = cur.info;
  // Serien-Scan: die vorige, sicher erkannte Karte wird beim Weiter-Scannen automatisch einsortiert
  autoFileCurrent();
  sc.current = {
    key: info.key, keys: [...new Set([...(cur.variants || [info]).map((v) => v.key), ...(cur.alts || []).map((a) => a.key)])],
    info, variants: cur.variants || [info], alts: cur.alts || [], probe: cur.probe || null, photo: cur.photo || null,
    unsure: Boolean(cur.unsure), source: cur.source || "device", byNumber: Boolean(cur.byNumber), aiNote: cur.aiNote || "", via: cur.via || "",
    // Jeder neue Treffer startet mit „Near Mint“, Zustands-Dropdown zu
    ...newHitView({ finish: cur.finish }),
  };
  sc.currentAt = Date.now();
  sc.cooldown.mark(sc.current.keys);
  if (sc.searchSince && sc.running && (cur.source || "device") === "device") {
    sc.hitMs = [...sc.hitMs, Date.now() - sc.searchSince].slice(-20);
    sc.searchSince = 0;
  }
  // Blitz + Vibration kamen schon beim Erkennen (vor dem Preis-Laden) – nicht doppelt
  if (cur.unsure || Date.now() - (sc.feedbackAt || 0) > 3000) successFeedback();
  sc.feedbackAt = 0;
  setUi("hit", cur.unsure ? "🤔 Fast sicher – bitte bestätigen" : "✅ Erkannt!");
  window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
  if (!cur.unsure) addToSeries(info);
  // Serien-Scan: dieselbe Karte nicht erneut melden, bis sie aus dem Rahmen genommen wurde
  if (sc.prefs.series) sc.suppress = sc.current.keys;
  renderHud(sc.current);
}

async function showHit(group, m, photo = null) {
  const keys = group.map((g) => g.key).slice(0, 5);
  // Top-Alternativen: nächstbeste andere Karten aus der Hash-Suche (z. B. andere Drucke/Varianten desselben Motivs)
  const seen = new Set(keys);
  const altKeys = (m.candidates || []).filter((c) => c.score <= SCORE_ACCEPT + 22 && !seen.has(c.key) && seen.add(c.key)).map((c) => c.key).slice(0, 3);
  const token = Symbol("hit");
  autoFileCurrent();
  sc.current = { key: keys[0], keys, info: null, loading: token, probe: m.probe || null, photo: photo || capturePhoto(m.corners) };
  sc.currentAt = Date.now();
  sc.cooldown.mark(keys);
  successFeedback(); sc.feedbackAt = Date.now();
  setUi("hit", m.label ? `✅ ${m.label}` : "✅ Erkannt!");
  // Name sofort zeigen (aus dem Index auf dem Gerät), Preis lädt dahinter
  renderHud({ loading: true, text: m.label ? `✅ ${m.label} – lade Marktpreis …` : "" });
  const infos = await fetchInfo([...keys, ...altKeys]);
  if (!sc.current || sc.current.loading !== token) return;
  const variants = infos.filter((i) => keys.includes(i.key));
  if (!variants.length) { sc.current = null; renderHud(null); return; }
  presentHit({
    info: variants[0], variants, alts: infos.filter((i) => altKeys.includes(i.key)), probe: m.probe || null, photo: sc.current.photo,
    byNumber: m.byNumber, unsure: false, via: m.via || "",
  });
}

const priceTxt = (i) => (i.price ? eur(i.price) : "–");
/** Preis nach Variante und Zustand (gleiche Faktoren wie Portfolio und Marktplatz: EX 85 %, GD 70 %, LP 60 %, PL 45 %, PO 30 %). */
const condPrice = (i, finish, cond) => conditionPrice(i, finish, cond);

function ebayHtml(i) {
  if (Number(i.ebayLow) > 0 && Number(i.ebayHigh) > 0) {
    return `<div><p class="text-[9px] uppercase font-bold text-slate-500">eBay verkauft</p><p class="text-xs font-black text-sky-300 leading-none">${eur(i.ebayLow)}–${eur(i.ebayHigh)}</p>${i.ebaySales ? `<p class="text-[9px] text-slate-500">${Number(i.ebaySales)} Verkäufe</p>` : ""}</div>`;
  }
  const url = typeof window.buildEbayUrl === "function" ? window.buildEbayUrl(`Pokemon ${i.name} ${i.number || ""}`.trim(), "sold", "scanner") : "";
  return url ? `<div><p class="text-[9px] uppercase font-bold text-slate-500">eBay</p><a href="${esc(url)}" target="_blank" rel="noopener sponsored" class="text-xs font-black text-sky-300 underline leading-none">Spanne ansehen ↗</a></div>` : "";
}

function renderHud(cur) {
  const hud = $("ps-ls-hud");
  if (!hud) return;
  if (!cur) { hud.classList.add("hidden"); hud.innerHTML = ""; return; }
  hud.classList.remove("hidden");
  if (cur.loading) { hud.innerHTML = `<div class="bg-slate-950/90 backdrop-blur rounded-2xl p-3 text-xs font-bold text-emerald-300">${esc(cur.text || "✅ Erkannt – lade Marktpreis …")}</div>`; return; }
  const i = cur.info;
  const k = jsArg(i.key);
  const canWish = i.kind === "card" || !!i.baseCardId;
  const finish = cur.finish || "normal", cond = cur.condition || DEFAULT_CONDITION;
  const price = mainPrice(i, cur);
  const alts = cur.alts || [], variants = cur.variants || [i];
  const showAlts = alts.length && (cur.unsure || cur.more);
  const num = [i.setCode || i.setName, i.number].filter(Boolean).join(" · ");
  const act = (name, cls, extra = "") => `<button data-act="${name}" onclick="PS.liveScanAct('${name}', ${k})" ${extra} class="${cls} text-[11px] font-black py-2.5 rounded-xl truncate px-1 disabled:opacity-40">${RESULT_ACTIONS[name].label}</button>`;
  // Minimal: Bild, Name, Set + Nummer, Hauptpreis (Zustand/Variante), Haupt-Aktionen. Alles andere hinter „Zustand ▾“ bzw. „⋯“.
  hud.innerHTML = `<div data-hud="result" class="bg-slate-950/92 backdrop-blur rounded-2xl p-2.5 border ${cur.unsure ? "border-yellow-400/70" : "border-emerald-400/60"} shadow-2xl space-y-2">
    ${cur.unsure ? `<p class="text-[11px] font-black text-yellow-300">🤔 Meinst du diese Karte?${alts.length ? " Sonst Alternative antippen." : ""}</p>` : ""}
    <div class="flex gap-2.5 items-center">
      <img src="${esc(cur.photo || cdn(i.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="${cur.photo ? "Dein Scan-Foto" : ""}" class="w-11 h-[60px] ${cur.photo ? "object-cover" : "object-contain"} rounded bg-slate-900 shrink-0" />
      <div class="min-w-0 flex-1">
        <p data-hud-name class="text-sm font-black text-white leading-tight truncate">${FLAG[i.lang] || ""} ${esc(i.name)}</p>
        <p data-hud-set class="text-[11px] text-slate-400 truncate">${esc(num)}</p>
        ${(state.user || (IS_STAGE && sc.demo?.autoFile)) && !cur.unsure ? `<p data-hud-autofile class="text-[9px] font-bold text-emerald-300 truncate">📒 ${cur.filed ? "Im Set-Ordner einsortiert" : "Wird automatisch in den Set-Ordner einsortiert"}</p>` : ""}
      </div>
      <div class="text-right shrink-0">
        <p class="text-[9px] uppercase font-bold text-slate-500 leading-none">${esc(cond)}${finish !== "normal" ? ` · ${finish === "holo" ? "Holo" : "Rev."}` : ""}</p>
        <p data-hud-price class="text-xl font-black text-emerald-400 leading-tight">${price ? eur(price) : "–"}</p>
      </div>
      <button onclick="PS.liveScanNext()" class="self-start text-slate-400 hover:text-white text-base w-7 h-7 -mr-1 -mt-1" aria-label="Schließen und nächste Karte scannen">✕</button>
    </div>
    <div class="flex items-center gap-1.5">
      <div role="group" aria-label="Variante" class="flex bg-slate-800/80 rounded-lg p-0.5">${FINISHES.map(([f, l]) => `<button data-finish="${f}" onclick="PS.liveScanFinish('${f}')" aria-pressed="${f === finish}" title="${hasOwnFinishPrice(i, f) ? "" : "Kein eigener Preis – Basispreis"}" class="text-[10px] font-black px-2 py-1 rounded-md ${f === finish ? "bg-yellow-400 text-slate-950" : "text-slate-300"}">${l}</button>`).join("")}</div>
      <button data-hud-cond onclick="PS.liveScanCondMenu()" aria-haspopup="listbox" aria-expanded="${cur.condMenu ? "true" : "false"}" class="ml-auto text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-100">${esc(conditionChipLabel(cur))}</button>
    </div>
    ${cur.condMenu ? `<div data-hud-cond-menu role="listbox" aria-label="Zustand und Vergleichspreise" class="bg-slate-900 border border-slate-700 rounded-xl p-1 space-y-0.5">
      ${conditionOptions(i, cur).map((o) => `<button role="option" data-cond="${o.code}" aria-selected="${o.active}" onclick="PS.liveScanCondition('${o.code}')" class="w-full flex items-center justify-between text-[11px] font-bold px-2 py-1.5 rounded-lg ${o.active ? "bg-yellow-400 text-slate-950" : "text-slate-200 hover:bg-slate-800"}"><span>${o.active ? "✓ " : ""}${esc(o.label)}</span><span class="font-black">${o.price ? eur(o.price) : "–"}</span></button>`).join("")}
      <div class="flex gap-3 px-2 pt-1 pb-0.5 border-t border-slate-800">${ebayHtml(i)}<div><p class="text-[9px] uppercase font-bold text-slate-500">PSA 10</p><p class="text-xs font-black text-purple-300 leading-none">${i.psa10 ? `${i.psa10Source === "ask" ? "ab " : ""}${eur(i.psa10)}` : "–"}</p></div></div>
    </div>` : ""}
    ${showAlts ? `<div class="grid grid-cols-3 gap-1">${alts.map((a) => `<button onclick="PS.liveScanPick(${jsArg(a.key)})" class="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 text-left min-w-0">
        <img src="${esc(cdn(a.image || FALLBACK_IMG, 80))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" class="w-6 h-8 object-contain shrink-0" />
        <span class="min-w-0"><span class="block text-[9px] font-black text-white truncate">${FLAG[a.lang] || ""} ${esc(a.name)}</span><span class="block text-[9px] text-slate-400 truncate">${esc(a.number || "")} · ${priceTxt(a)}</span></span></button>`).join("")}</div>` : ""}
    <div class="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5">
      ${act("binder", "bg-emerald-500 text-slate-950")}
      ${act("sell", "bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 !whitespace-normal leading-tight !py-1.5")}
      ${act("instant", "bg-yellow-400 text-slate-950", 'title="1-Tap: fairer Preis, gemerkte Angaben, geht nach kurzem Countdown live"')}
      ${act("wish", "bg-rose-400 text-slate-950", canWish ? "" : 'disabled title="Wunschliste gibt es für deutsche und englische Karten"')}
      <button onclick="PS.liveScanMore()" aria-expanded="${cur.more ? "true" : "false"}" aria-label="Weitere Aktionen" class="bg-slate-800 text-white text-sm font-black px-2.5 rounded-xl">⋯</button>
    </div>
    ${cur.more ? `<div class="grid grid-cols-3 gap-1.5">
      ${act("swiper", "bg-slate-800 text-white")}${act("flip", "bg-slate-800 text-white")}${act("details", "bg-slate-800 text-white")}
    </div>
    ${variants.length > 1 ? `<div class="flex flex-wrap gap-1">${variants.map((v) => `<button onclick="PS.liveScanVariant(${jsArg(v.key)})" class="text-[10px] font-black px-2 py-0.5 rounded-full ${v.key === i.key ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${FLAG[v.lang] || ""} ${esc(v.setCode || v.setName || "")} ${esc(v.number || "")} · ${priceTxt(v)}</button>`).join("")}</div>` : ""}
    ${cur.source === "ai" ? `<p class="text-[9px] text-cyan-300 truncate">🤖 KI-Vision${cur.aiNote ? ` · ${esc(cur.aiNote)}` : ""}</p>` : /name/.test(cur.via || "") ? `<p class="text-[9px] text-emerald-300">🔤 per Name${/number/.test(cur.via) ? " + Sammlernummer" : ""} erkannt · ohne KI</p>` : cur.byNumber ? `<p class="text-[9px] text-emerald-300">🔢 per Sammlernummer bestätigt · ohne KI</p>` : `<p class="text-[9px] text-emerald-300">🖼️ per Bild-Fingerabdruck erkannt · ohne KI</p>`}` : ""}
  </div>`;
}

/** Zustand/Variante des aktuellen Treffers (für Sammlung, Inserat und Serie). */
function choiceFor(key) {
  if (sc.current?.key === key) return { condition: sc.current.condition || DEFAULT_CONDITION, variant: sc.current.finish || "normal" };
  const s = sc.series.find((x) => x.key === key);
  return { condition: s?.scanCondition || DEFAULT_CONDITION, variant: s?.scanVariant || "normal" };
}

function addToSeries(info) {
  const pick = { scanCondition: sc.current?.condition || DEFAULT_CONDITION, scanVariant: sc.current?.finish || "normal" };
  if (sc.series[0]?.key === info.key) { sc.series[0] = { ...sc.series[0], ...pick }; renderSeries(); return; }
  info = { ...info, probe: sc.current?.probe || null, photo: sc.current?.photo || null, ...pick };
  sc.series = [info, ...sc.series.filter((s) => s.key !== info.key)].slice(0, 60);
  renderSeries();
}

/** Zustand/Variante im ersten Serien-Eintrag nachziehen, wenn er zum aktuellen Treffer gehört. */
function syncSeriesHead() {
  if (sc.current && sc.series[0]?.key === sc.current.key) {
    sc.series[0] = { ...sc.series[0], scanCondition: sc.current.condition, scanVariant: sc.current.finish };
    renderSeries();
  }
}

function renderSeries() {
  const box = $("ps-ls-series");
  if (!box) return;
  if (!sc.series.length) { box.innerHTML = ""; return; }
  const total = sc.series.reduce((s, x) => s + (condPrice(x, x.scanVariant || "normal", x.scanCondition || "NM") || Number(x.price) || 0), 0);
  box.innerHTML = `<div class="flex items-center justify-between gap-2">
      <p class="text-xs font-black text-white">🗂️ In dieser Sitzung gescannt: ${sc.series.length} Karten • ${eur(total)}</p>
      <div class="flex flex-wrap justify-end gap-1.5"><button onclick="PS.liveScanSellAll()" class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 text-[11px] font-black px-2.5 py-1.5 rounded-lg">🏷️ Alle inserieren</button>
      <button onclick="PS.liveScanSellAll('instant')" class="bg-yellow-400 text-slate-950 text-[11px] font-black px-2.5 py-1.5 rounded-lg" title="Alle mit fairem Preis – nach kurzem Countdown live">⚡ Alle 1-Tap</button>
      <button onclick="PS.liveScanAddAll()" class="bg-emerald-500 text-slate-950 text-[11px] font-black px-2.5 py-1.5 rounded-lg">💼 Alle zur Sammlung</button>
      <button onclick="PS.liveScanClear()" class="bg-slate-800 text-slate-300 text-[11px] font-bold px-2.5 py-1.5 rounded-lg">Leeren</button></div>
    </div>
    <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5">${sc.series.map((s) => {
      const p = condPrice(s, s.scanVariant || "normal", s.scanCondition || "NM") || Number(s.price) || 0;
      return `
      <button onclick="PS.liveScanDetails(${jsArg(s.key)})" class="bg-slate-900 border border-slate-800 hover:border-cyan-400 rounded-xl p-1.5 text-[10px] text-white text-center">
        <span class="relative block">
          <img src="${esc(s.photo || cdn(s.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="h-20 mx-auto ${s.photo ? "object-cover rounded" : "object-contain"}" />
          ${s.photo ? `<span class="absolute top-0 right-0 text-[8px] font-black bg-cyan-400 text-slate-950 px-1 rounded" title="Echtes Scan-Foto">📷</span>` : ""}
          ${p ? `<span class="absolute -bottom-1 left-0 ps-price-tag-tilt">${priceTagHtml({ price: p }, "sm")}</span>` : ""}
        </span>
        <span class="block truncate font-bold mt-1">${FLAG[s.lang] || ""} ${esc(s.name)}</span>
        <span class="block text-[9px] text-slate-400">${esc(s.scanCondition || "NM")}${s.scanVariant && s.scanVariant !== "normal" ? ` · ${s.scanVariant === "reverse_holo" ? "Rev. Holo" : "Holo"}` : ""}</span>
      </button>`;
    }).join("")}</div>
    <p class="text-[10px] text-slate-500">Tipp: Mit 🔁 Serien-Scan einfach Karte für Karte in den Rahmen legen – jede erkannte Karte landet hier mit Zustand, Preis-Etikett und echtem Scan-Foto. Mit „Alle inserieren“ (oder ⚡ 1-Tap: faire Preise, geht nach kurzem Countdown von selbst live) erscheinen sie im Swipe-Radar, wo Käufer mit ❌, 🛒 Kaufen oder ❤️ reagieren.</p>`;
}

/** KI-Knopf hervorheben, wenn die Erkennung auf dem Gerät unsicher ist (Stufe 3 nur bei Bedarf). */
function offerAi(on) {
  const b = $("ps-ls-ai");
  if (!b) return;
  b.classList.toggle("bg-slate-800", !on);
  b.classList.toggle("bg-cyan-400", on);
  b.classList.toggle("text-slate-950", on);
  b.classList.toggle("animate-pulse", on);
}

// ---------------------------------------------------------------------------
// Stufe 2: lernender Index
// ---------------------------------------------------------------------------
/** Fingerabdruck einer übernommenen Karte an den Server melden (einmal je Karte und Sitzung, ohne Bild). */
function learn(key, probe, source = sc.current?.source === "ai" && sc.current?.keys?.includes(key) ? "ai" : "confirm") {
  if (!state.user || !probe?.artP || !key) return;
  const id = `${key}|${probe.artP}`;
  if (sc.learned.has(id)) return;
  sc.learned.add(id);
  api("/api/scan/learn", { method: "POST", body: { key, artP: probe.artP, artD: probe.artD, fullP: probe.fullP, color: probe.color || null, source } }).catch(() => {});
}
const probeFor = (key) => (sc.current?.keys?.includes(key) || sc.current?.key === key ? sc.current.probe : null) || sc.series.find((s) => s.key === key)?.probe || null;

// ---------------------------------------------------------------------------
// Foto-Erkennung auf dem Gerät (Stufe 1 auch für hochgeladene Fotos – erst danach KI)
// ---------------------------------------------------------------------------
function waitReady(timeoutMs = 12_000) {
  if (sc.ready) return Promise.resolve(true);
  if (!sc.loadingIndex) loadIndex();
  return new Promise((resolve) => {
    (sc.readyWaiters ??= []).push(() => resolve(true));
    setTimeout(() => resolve(sc.ready), timeoutMs);
  });
}

/** Foto auf Canvas bringen + Rahmen bestimmen (ohne Erkennung) – Grundlage für parallelen Hash und OCR. */
async function prepareImage(dataUrl) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  // 1100 px statt früher 900 px: mehr Pixel für die Sammlernummer
  const scale = Math.min(1, 1100 / Math.max(img.width, img.height));
  const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  // Rahmen: größtes Kartenformat, das ins Foto passt (Fotos sind meist formatfüllend)
  const gh = Math.min(H * 0.92, (W * 0.92) / (63 / 88)), gw = gh * (63 / 88);
  const guide = { x0: (W - gw) / 2, y0: (H - gh) / 2, x1: (W + gw) / 2, y1: (H + gh) / 2 };
  const guideQuad = [[guide.x0, guide.y0], [guide.x1, guide.y0], [guide.x1, guide.y1], [guide.x0, guide.y1]];
  return { cv, ctx, W, H, guide, guideQuad };
}

/** Bild-Fingerabdruck eines vorbereiteten Fotos im Worker. */
async function hashImage({ cv, ctx, W, H, guide, guideQuad }) {
  const ready = (await waitReady()) && sc.indexCount;
  const m = ready ? await workerFrame({ w: W, h: H, data: ctx.getImageData(0, 0, W, H).data.buffer, guide, ocr: true, capture: true }) : {};
  return { m, cv, corners: m.found ? m.corners : guideQuad };
}

/**
 * Erkennt eine Karte auf einem Foto (Data-URL) komplett auf dem Gerät.
 * Ergebnis: { accepted, strong, key, info, probe } – bei unsicherem Ergebnis entscheidet der Aufrufer über die KI.
 */
async function recognizeImage(dataUrl) {
  try {
    if (!(await waitReady()) || !(sc.indexCount || sc.textCount)) return { accepted: false, probe: null };
    const r = await recognizePhoto(dataUrl);
    const m = r.m;
    const strong = r.accepted && (r.via !== "hash" || (m.score <= SCORE_STRONG && !m.glareHigh));
    if (!strong) return { accepted: false, probe: m.probe || null, glare: Boolean(m.glareHigh) };
    const [info] = await fetchInfo(r.keys.slice(0, 4));
    return info ? { accepted: true, strong, key: info.key, info, probe: m.probe } : { accepted: false, probe: m.probe || null };
  } catch {
    return { accepted: false, probe: null };
  }
}

function fileToDataUrl(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar")); };
    img.src = url;
  });
}

/** Galerie-Import: Foto im Sucher zeigen → Erkennung auf dem Gerät → bei Unsicherheit KI-Vision auf dem Kartenausschnitt. */
async function scanUpload(file) {
  if (!file) return;
  if (sc.running) stop();
  let dataUrl;
  try { dataUrl = await fileToDataUrl(file); } catch { toast("🖼️ Foto nicht lesbar", "Bitte ein JPG- oder PNG-Foto wählen."); return; }
  const still = $("ps-ls-still");
  if (still) { still.src = dataUrl; still.classList.remove("hidden"); }
  $("ps-ls-idle")?.classList.add("hidden");
  $("ps-ls-hint")?.classList.remove("hidden");
  setUi("ready", "⚡ Erkenne Karte auf dem Foto (ohne KI) …", 1);
  try {
    const r = await recognizePhoto(dataUrl);
    const { m, cv, corners } = r;
    const photo = cropToCard(cv, corners, 440, 0.85);
    sc.lastStill = { cv, corners, probe: m.probe || null, photo };
    if (r.accepted) {
      await showHit(orderGroup(r.keys.map((k) => ({ key: k, lang: langOfKey(k) }))), { ...m, via: r.via, byNumber: m.byNumber || /number/.test(r.via), candidates: [...r.cands.map((key) => ({ key, score: 0 })), ...(m.candidates || [])] }, photo);
      return;
    }
    // Kein sicherer Treffer: Vorschläge zeigen, KI nur auf Knopfdruck („KI-Tiefenscan“)
    offerAi(true);
    if (await showNear({ ...m, textCands: r.cands }, photo, false)) return;
    setUi("ready", "🤔 Nicht erkannt – Foto mit Name und Nummer gut lesbar oder 🧠 KI-Tiefenscan", 0);
  } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
const infoOf = (key) => sc.info.get(key) || sc.series.find((s) => s.key === key) || null;

async function addOne(info, choice = null) {
  const body = info.kind === "print" ? { printId: info.id } : { cardId: info.id };
  // Zustand und Variante aus der Schnellwahl mitgeben (Binder zeigt dann den passenden Wert)
  const c = choice || { condition: info.scanCondition || "NM", variant: info.scanVariant || "normal" };
  if (CONDS.includes(c.condition)) body.condition = c.condition;
  if (FINISHES.some(([f]) => f === c.variant)) body.variant = c.variant;
  // Gleiche Karte schon im Set-Ordner → Anzahl hochzählen (2x, 3x …) statt zweiten Slot anlegen
  body.merge = true;
  return api("/api/portfolio", { method: "POST", body });
}

/** Serien-Eintrag als „schon im Set-Ordner“ markieren (verhindert doppeltes Hinzufügen über „Alle zur Sammlung“). */
function markSeriesFiled(key) {
  const s = sc.series.find((x) => x.key === key);
  if (s) s.filed = true;
}

/** Toast-Text nach dem automatischen Einsortieren. */
const filedText = (info, item) => `📒 Im Set-Ordner einsortiert · ${info.name}${item?.merged && Number(item.quantity) > 1 ? ` (jetzt ${Number(item.quantity)}x)` : ""}`;

/**
 * Automatisches Einsortieren: jeder bestätigte Treffer landet genau einmal im passenden Set-Ordner („Sammlung → Mein Binder“).
 * Gleiche Karte erneut gescannt → der Server zählt die Anzahl hoch.
 */
const saveOnce = createAutoFiler((x) => addOne(x.info, x.choice));
async function fileHit(x) {
  if (!x?.info || !state.user || IS_STAGE) return null;
  markSeriesFiled(x.key);
  try {
    const item = await saveOnce(x.hit, x);
    if (!item) return null;
    learn(x.key, x.probe, x.source);
    window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
    window.PS?.loadPortfolio?.();
    return item;
  } catch (e) {
    const s = sc.series.find((y) => y.key === x.key);
    if (s) s.filed = false;
    throw e;
  }
}

/** Aktuellen sicheren Treffer im Hintergrund einsortieren (beim Weiter-Scannen oder wenn die nächste Karte erkannt wird). */
function autoFileCurrent() {
  const cur = sc.current;
  if (!shouldAutoFile(cur, { loggedIn: Boolean(state.user), stage: IS_STAGE })) return;
  const snap = hitSnapshot(cur.key);
  if (!snap) return;
  fileHit(snap).then((item) => { if (item) scanToast(filedText(snap.info, item)); }).catch((e) => handleError(e));
}

async function addToCollection(key) {
  const i = infoOf(key);
  if (!i || !requireLogin()) return;
  try {
    const choice = choiceFor(key);
    if (sc.current?.key === key && sc.current.filed) { toast("📒 Schon einsortiert", `${i.name} liegt bereits in deinem Set-Ordner.`); return; }
    await addOne(i, choice);
    if (sc.current?.key === key) sc.current.filed = true;
    markSeriesFiled(key);
    learn(key, probeFor(key));
    confirmCurrent(key);
    haptic("success");
    window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
    toast("💼 In deiner Sammlung", `${i.name} ${i.number || ""} (${choice.condition}) – mit Live-Preis.${sc.prefs.series ? " Nächste Karte in den Rahmen!" : ""}`); window.PS?.loadPortfolio?.();
  } catch (e) { handleError(e); }
}

async function addAll() {
  if (!sc.series.length || !requireLogin()) return;
  let n = 0;
  // Automatisch einsortierte Karten nicht ein zweites Mal hinzufügen
  const open = [...sc.series].reverse().filter((i) => !i.filed);
  if (!open.length) { toast("📒 Alles einsortiert", "Alle gescannten Karten liegen schon in deinen Set-Ordnern."); return; }
  for (const i of open) {
    try { await addOne(i); i.filed = true; learn(i.key, i.probe); n++; } catch (e) { handleError(e); break; }
  }
  if (n) window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
  if (n) { toast("💼 Sammlung ergänzt", `${n} Karte${n > 1 ? "n" : ""} hinzugefügt.`); window.PS?.loadPortfolio?.(); }
}

async function addWish(key) {
  const i = infoOf(key);
  if (!i || !requireLogin()) return;
  const cardId = i.kind === "card" ? i.id : i.baseCardId;
  if (!cardId) { toast("❤️ Nicht möglich", "Die Wunschliste gibt es bisher für deutsche und englische Karten."); return; }
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId } });
    learn(key, probeFor(key));
    toast("❤️ Auf der Wunschliste", r.offers ? `${r.offers} Angebot${r.offers > 1 ? "e" : ""} gibt es schon – ab ${eur(r.minPrice)}.` : "Wir melden uns bei passenden Angeboten und Deals.");
  } catch (e) { handleError(e); }
}

/** Eine Karte direkt inserieren (Schnell-Inserieren mit fairem Preisvorschlag) */
function sellOne(key, mode = "") {
  const i = infoOf(key);
  if (!i || (!IS_STAGE && !requireLogin())) return;
  learn(key, probeFor(key));
  confirmCurrent(key);
  // Scan-Foto mitgeben (Serie bzw. aktueller Treffer), damit Käufer im Swipe-Radar die echte Karte sehen
  const photo = (sc.current?.key === key ? sc.current.photo : null) || sc.series.find((s) => s.key === key)?.photo || null;
  const choice = choiceFor(key);
  // Zustand + Variante aus der Schnellwahl → Preisvorschlag im Schnell-Inserieren passt sofort (bleibt editierbar)
  openQuickList([{ ...i, photo, source: "scan", condition: choice.condition.toLowerCase(), variant: choice.variant }], { instant: mode === "instant" });
}

/** Alle Karten der Scan-Serie auf einmal inserieren */
function sellAll(mode = "") {
  if (!sc.series.length) { toast("Noch nichts gescannt", "Halte Karten nacheinander vor die Kamera – jede erkannte Karte landet in der Liste."); return; }
  if (!requireLogin()) return;
  for (const s of sc.series) learn(s.key, s.probe);
  openQuickList([...sc.series].reverse().map((s) => ({ ...s, source: "scan", condition: String(s.scanCondition || "NM").toLowerCase(), variant: s.scanVariant || "normal" })), { instant: mode === "instant" });
}

function flipCheck(key) {
  const i = infoOf(key);
  if (i) window.PS?.openComps?.(i.kind, i.id);
}

function details(key) {
  const i = infoOf(key);
  if (!i) return;
  if (i.kind === "print") window.PS?.openPrint?.(i.id); else window.PS?.openCard?.(i.id);
}

/** Aktuelles Kamerabild an den bisherigen KI-Foto-Scan übergeben (z. B. bei Promos oder noch nicht indexierten Karten). */
function photoScan() {
  const video = $("ps-ls-video");
  // Zuletzt hochgeladenes Foto (Kamera aus) → KI-Tiefenscan auf genau diesem Foto
  if (!sc.running && sc.lastStill) {
    if (!requireLogin()) return;
    const st = sc.lastStill;
    runVision(cropToCard(st.cv, st.corners), { probe: st.probe, photo: st.photo });
    return;
  }
  if (!sc.running || !video?.videoWidth) { window.PS?.openPhotoScanner?.(); return; }
  // Neu: direkt KI-Vision auf dem exakt zugeschnittenen Kartenausschnitt (Ergebnis im Sucher, Top-Treffer + Alternativen)
  if (state.user && sc.geometry) { forceVision(); return; }
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  cv.width = Math.round(video.videoWidth * scale); cv.height = Math.round(video.videoHeight * scale);
  cv.getContext("2d").drawImage(video, 0, 0, cv.width, cv.height);
  // Letzter Fingerabdruck geht mit: erkennt die KI die Karte und der Nutzer übernimmt sie, lernt der Index (Stufe 2)
  window.__psScanProbe = sc.lastProbe && Date.now() - sc.lastProbe.at < 8000 ? sc.lastProbe : null;
  cv.toBlob((blob) => {
    if (!blob) return;
    stop();
    window.PS?.showSub?.("scan", "camera");
    window.PS?.scanFile?.(new File([blob], "scan.jpg", { type: "image/jpeg" }));
  }, "image/jpeg", 0.9);
}

/** KI-Vision auf dem aktuellen Kamerabild erzwingen (Knopf „Nicht erkannt?“). */
async function forceVision() {
  if (sc.capturing) return;
  const video = $("ps-ls-video"), g = sc.geometry;
  sc.capturing = true;
  try {
    const W = Math.max(FRAME_W, Math.min(CAPTURE_W, Math.round(g.sw))), f = W / g.W, H = Math.round(g.H * f);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.getContext("2d").drawImage(video, g.sx0, g.sy0, g.sw, g.sh, 0, 0, W, H);
    const corners = sc.prevCorners ? sc.prevCorners.map(([x, y]) => [x * f, y * f])
      : [[g.guide.x0 * f, g.guide.y0 * f], [g.guide.x1 * f, g.guide.y0 * f], [g.guide.x1 * f, g.guide.y1 * f], [g.guide.x0 * f, g.guide.y1 * f]];
    const probe = sc.lastProbe && Date.now() - sc.lastProbe.at < 8000 ? sc.lastProbe : null;
    await runVision(cropToCard(cv, corners), { probe, photo: capturePhoto(sc.prevCorners) });
  } finally { sc.capturing = false; }
}

/** Unsicheren Treffer bestätigen (Aktion ausgeführt) → in die Serie übernehmen. */
function confirmCurrent(key) {
  if (sc.current?.key === key && sc.current.unsure) { sc.current.unsure = false; addToSeries(sc.current.info); renderHud(sc.current); }
}

// ---------------------------------------------------------------------------
// Auto-Close: Aktion im Ergebnisfeld → Feld sofort zu, Kamera scannt direkt weiter, kurze Bestätigung im Sucher
// ---------------------------------------------------------------------------
/** Ergebnis schließen, aktuelle Karte bis zum Herausnehmen ignorieren, Sucher bereit für die nächste Karte. */
function nextCard() {
  if (sc.current?.unsure && sc.current.info) { sc.current.unsure = false; addToSeries(sc.current.info); }
  sc.suppress = sc.current?.keys || sc.suppress;
  if (sc.current?.keys) sc.cooldown.mark(sc.current.keys);
  sc.current = null; sc.currentAt = 0; sc.stable = 0; sc.autoArmed = true; sc.autoAiUsed = false; sc.searchSince = 0; sc.textLock = null; sc.prevRead = null;
  renderHud(null);
  if (!sc.running) {
    if (IS_STAGE) return;
    $("ps-ls-still")?.classList.add("hidden");
    start();
    return;
  }
  setUi("search", "🔁 Nächste Karte in den Rahmen halten");
}

const runHitAction = createActionRunner({
  close: () => nextCard(),
  notify: (text) => scanToast(text),
  onError: (e) => handleError(e),
});

/** Alles, was eine Aktion über den Treffer wissen muss – vor dem Schließen festgehalten. */
function hitSnapshot(key) {
  const cur = sc.current;
  const info = cur?.key === key ? cur.info : infoOf(key);
  if (!info) return null;
  return {
    key, info, choice: choiceFor(key), probe: probeFor(key),
    photo: (cur?.key === key ? cur.photo : null) || sc.series.find((s) => s.key === key)?.photo || null,
    source: cur?.source === "ai" && cur.keys?.includes(key) ? "ai" : "confirm",
    // Treffer-Objekt: merkt sich, ob die Karte schon automatisch einsortiert wurde
    hit: cur?.key === key ? cur : null,
  };
}

const HIT_ACTIONS = {
  async binder(x) {
    const item = await fileHit(x);
    const qty = item?.merged && Number(item.quantity) > 1 ? ` · jetzt ${Number(item.quantity)}x im Set-Ordner` : "";
    return `${RESULT_ACTIONS.binder.toast} · ${x.info.name} (${x.choice.condition})${qty}`;
  },
  sell(x, mode = "") {
    learn(x.key, x.probe, x.source);
    // Inserat UND Set-Ordner: die Karte bleibt zusätzlich in „Mein Binder“ gespeichert
    fileHit(x).catch((e) => handleError(e));
    openQuickList([{ ...x.info, photo: x.photo, source: "scan", condition: x.choice.condition.toLowerCase(), variant: x.choice.variant }], { instant: mode === "instant" });
  },
  instant(x) { return HIT_ACTIONS.sell(x, "instant"); },
  async wish(x) {
    const cardId = x.info.kind === "card" ? x.info.id : x.info.baseCardId;
    const r = await api("/api/wishlist", { method: "POST", body: { cardId } });
    learn(x.key, x.probe, x.source);
    return r?.offers ? `${RESULT_ACTIONS.wish.toast} · ${r.offers} Angebot${r.offers > 1 ? "e" : ""} ab ${eur(r.minPrice)}` : RESULT_ACTIONS.wish.toast;
  },
  // Diese öffnen eine eigene Ansicht – dort ist die Bestätigung sichtbar, kein zusätzlicher Toast
  flip(x) { flipCheck(x.key); return false; },
  details(x) { details(x.key); return false; },
  swiper(x) { learn(x.key, x.probe, x.source); window.PS?.arenaShowScanned?.(x.info); if (sc.running) stop(); return false; },
};

/** Aktionsklick im Ergebnisfeld (Binder, Verkaufen, Inserat, Wunsch, …): ausführen und das Feld sofort schließen. */
function actOnHit(name, key) {
  if (!HIT_ACTIONS[name]) return null;
  const snap = hitSnapshot(key);
  if (!snap) return null;
  // Reel-Aufnahme (Stage): „Binder“ legt die Karte nur in der Demo ab – kein Login, kein Schreibzugriff aufs Konto
  if (IS_STAGE && name === "binder") {
    sc.demoBinned = { ...snap.info, condition: snap.choice.condition };
    window.dispatchEvent(new CustomEvent("ps:reel-binned", { detail: sc.demoBinned }));
    return runHitAction(name, async () => `${RESULT_ACTIONS.binder.toast} · ${snap.info.name} (${snap.choice.condition})`);
  }
  // Master-Vorlage (Stage): „Als Inserat einstellen“ ohne Schreibzugriff – Karte bleibt im Demo-Ordner und gilt dort als inseriert
  if (IS_STAGE && sc.demo?.listDemo && (name === "sell" || name === "instant")) {
    const listPrice = mainPrice(snap.info, { condition: snap.choice.condition, finish: snap.choice.variant }) || Number(snap.info.price) || 0;
    sc.demoBinned = { ...snap.info, condition: snap.choice.condition, listed: true, listPrice };
    window.dispatchEvent(new CustomEvent("ps:reel-binned", { detail: sc.demoBinned }));
    return runHitAction(name, async () => RESULT_ACTIONS[name].toast);
  }
  const login = name === "binder" || name === "wish" || ((name === "sell" || name === "instant") && !IS_STAGE);
  // Login vor dem Schließen prüfen – sonst wäre der Treffer weg, während der Anmelde-Dialog aufgeht
  if (login && !requireLogin()) return null;
  if (name === "wish" && !(snap.info.kind === "card" || snap.info.baseCardId)) { toast("❤️ Nicht möglich", "Die Wunschliste gibt es bisher für deutsche und englische Karten."); return null; }
  haptic("select");
  // Unsicherer Treffer + Aktion = bestätigt → in die Serie (mit gewähltem Zustand/Variante)
  if (sc.current?.key === key && sc.current.unsure) { sc.current.unsure = false; addToSeries(sc.current.info); }
  return runHitAction(name, () => HIT_ACTIONS[name](snap));
}

function setLang(l) {
  if (!FLAG[l]) return;
  const next = sc.langs.includes(l) ? sc.langs.filter((x) => x !== l) : [...sc.langs, l];
  if (!next.length) { toast("Mindestens eine Sprache", "Der Scanner braucht mindestens eine Sprache."); return; }
  sc.langs = ["de", "en", "ja"].filter((x) => next.includes(x));
  localStorage.setItem(LANGS_KEY, JSON.stringify(sc.langs));
  renderLangChips(); renderIndexLine();
  if (sc.worker) loadIndex();
}

// ---------------------------------------------------------------------------
// Demo-Modus NUR für die Pro-Video-Aufnahme (Live-Stage-iframe mit ?reel=1): In der Aufnahme gibt es keine
// Kamera. Statt des Kamerabilds zeigt der Scanner eine echte Katalogkarte, der Scan-Rahmen fährt mit einem
// Laser darüber und danach erscheint der ECHTE Treffer (Name, Marktpreis, PSA 10) aus /api/scan/lookup.
// Außerhalb der Stage ist nichts davon erreichbar.
// ---------------------------------------------------------------------------
const IS_STAGE = (() => {
  try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; }
})();
const DEMO_KEYS = ["card:sv03.5-199", "card:sv03.5-006", "card:sv08-238", "card:sv03.5-025", "card:sv04.5-234", "card:sv02-269"];

async function demoInfo(keys = DEMO_KEYS) {
  const good = (list) => list.filter((i) => i?.image && Number(i.price) > 0).sort((a, b) => b.price - a.price);
  let infos = good(await fetchInfo(keys));
  if (!infos.length && keys !== DEMO_KEYS) infos = good(await fetchInfo(DEMO_KEYS));
  if (!infos.length) {
    try {
      const r = await api("/api/admin/reel-cover-cards?n=6");
      infos = good(await fetchInfo((r?.cards || []).map((c) => `card:${c.id}`).filter((k) => /^card:[a-zA-Z0-9.\-_]{2,40}$/.test(k)).slice(0, 8)));
    } catch {}
  }
  return infos[0] || null;
}

/** Scanner-Bühne mit Karte und Rahmen aufbauen (vor Frame 0 der Aufnahme). Liefert den Treffer oder null. */
async function demoPrepare(opts = {}) {
  if (!IS_STAGE) return null;
  const stage = $("ps-ls-stage");
  if (!stage) return null;
  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys.filter((k) => /^card:[\w.\-]{2,40}$/.test(k)).slice(0, 8) : DEMO_KEYS;
  const info = await demoInfo(keys.length ? keys : DEMO_KEYS);
  if (!info) return null;
  sc.demo = { info, zoom: Number(opts.zoom) > 1 ? Math.min(2, Number(opts.zoom)) : 0, sleeve: !!opts.sleeve, autoFile: !!opts.autoFile, listDemo: !!opts.listDemo };
  $("ps-ls-idle")?.classList.add("hidden");
  $("ps-ls-demo")?.remove();
  const layer = document.createElement("div");
  layer.id = "ps-ls-demo";
  layer.className = "absolute inset-0 overflow-hidden";
  layer.style.cssText = "background:radial-gradient(circle at 50% 38%,#4a3f63 0%,#1b1730 55%,#070a18 100%)";
  layer.innerHTML = `<img id="ps-ls-demo-card" src="${esc(cdn(info.image, 500))}" alt="" style="position:absolute;left:50%;top:45%;width:54%;transform:translate(-50%,-50%) rotate(-4deg);border-radius:12px;box-shadow:0 24px 50px rgba(0,0,0,.65)" />
    <div id="ps-ls-demo-frame" style="position:absolute;left:50%;top:45%;width:62%;aspect-ratio:63/88;transform:translate(-50%,-50%);border:3px solid rgba(255,255,255,.85);border-radius:16px;box-shadow:0 0 0 9999px rgba(2,6,23,.45)">
      <div id="ps-ls-demo-laser" style="position:absolute;left:-4%;right:-4%;top:0;height:4px;border-radius:4px;background:#22d3ee;box-shadow:0 0 18px 6px rgba(34,211,238,.75)"></div>
    </div>
    <p id="ps-ls-demo-hint" style="position:absolute;top:10px;left:0;right:0;text-align:center;font-size:12px;font-weight:900;color:#fff;text-shadow:0 1px 4px #000">📸 Karte in den Rahmen halten</p>`;
  if (sc.demo.sleeve) {
    // Karte steckt in einer glänzenden Schutzhülle (Penny-Sleeve): transparente Folie mit Kante und Lichtkante
    const sleeve = document.createElement("div");
    sleeve.id = "ps-ls-demo-sleeve";
    sleeve.style.cssText = "position:absolute;left:50%;top:45%;width:58%;aspect-ratio:66/93;transform:translate(-50%,-50%) rotate(-4deg);border-radius:14px;border:2px solid rgba(255,255,255,.35);background:linear-gradient(125deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,.04) 28%,rgba(255,255,255,0) 52%,rgba(255,255,255,.12) 78%,rgba(255,255,255,.02) 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);pointer-events:none";
    layer.querySelector("#ps-ls-demo-frame")?.before(sleeve);
  }
  if (sc.demo.zoom) {
    const chip = document.createElement("p");
    chip.id = "ps-ls-demo-zoom";
    chip.textContent = `🔍 ${sc.demo.zoom.toLocaleString("de-DE", { maximumFractionDigits: 1 })}× Zoom`;
    chip.style.cssText = "position:absolute;right:10px;top:34px;font-size:11px;font-weight:900;color:#0b1220;background:#22d3ee;border-radius:999px;padding:3px 9px;opacity:0;transition:opacity .25s";
    layer.append(chip);
  }
  stage.prepend(layer); // unter HUD und Hinweisen der echten Oberfläche
  await new Promise((r) => { const img = $("ps-ls-demo-card"); if (!img || img.complete) r(); else { img.onload = r; img.onerror = r; setTimeout(r, 4000); } });
  return info;
}

/** Laser-Scan (ms) → „Erkannt“ → echter Treffer im HUD inkl. Marktpreis und Verkaufen-Knöpfen. */
async function demoScan(ms = 1200) {
  if (!IS_STAGE || !sc.demo) return false;
  const laser = $("ps-ls-demo-laser"), frame = $("ps-ls-demo-frame"), hintEl = $("ps-ls-demo-hint");
  if (hintEl) hintEl.textContent = "⚡ Erkenne Karte …";
  // Kamera-Zoom (z. B. 1,4×): Karte + Hülle fahren weich heran, der Zoom-Chip blendet ein
  if (sc.demo.zoom) {
    const z = sc.demo.zoom;
    ["ps-ls-demo-card", "ps-ls-demo-sleeve"].forEach((id) => { const el = $(id); if (el) { el.style.transition = `transform ${Math.round(ms * 0.45)}ms cubic-bezier(.2,.8,.2,1)`; el.style.transform = `translate(-50%,-50%) rotate(-2deg) scale(${z * 0.82})`; } });
    const chip = $("ps-ls-demo-zoom"); if (chip) chip.style.opacity = "1";
  }
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const y = (Math.sin(k * Math.PI * 2.5 - Math.PI / 2) + 1) / 2; // 1¼ Durchläufe auf und ab
      if (laser) laser.style.top = `${(y * 100).toFixed(2)}%`;
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  if (laser) laser.style.display = "none";
  if (frame) { frame.style.borderColor = "#34d399"; frame.style.boxShadow = "0 0 0 9999px rgba(2,6,23,.45),0 0 28px 4px rgba(52,211,153,.8)"; }
  if (hintEl) hintEl.textContent = "✅ Erkannt";
  const info = sc.demo.info;
  sc.current = { key: info.key, keys: [info.key], info, variants: [info], alts: [], probe: null, photo: null, ...newHitView() };
  sc.currentAt = Date.now();
  addToSeries(info);
  renderHud(sc.current);
  return true;
}

/**
 * Automatisches Einsortieren in der Aufnahme (Master-Vorlage): Treffer gilt als „📒 Im Set-Ordner einsortiert“,
 * die Karte landet im Demo-Ordner (kein Schreibzugriff aufs Konto). Liefert die Status-Zeile im Ergebnisfeld.
 */
function demoFile() {
  if (!IS_STAGE || !sc.demo || !sc.current?.info) return null;
  sc.current.filed = true;
  renderHud(sc.current);
  sc.demoBinned = { ...sc.current.info, condition: sc.current.condition || DEFAULT_CONDITION };
  window.dispatchEvent(new CustomEvent("ps:reel-binned", { detail: sc.demoBinned }));
  return $("ps-ls-hud")?.querySelector("[data-hud-autofile]") || null;
}

// ---------------------------------------------------------------------------
// Foto aufnehmen / Bild hochladen direkt im Swiper und in der Sammlung (gleiche Erkennung ohne KI)
// ---------------------------------------------------------------------------
const PQ_ID = "ps-photo-scan";
let pq = null; // { target, dataUrl, photo, cv, corners, probe, keys, cands, ms }

/** Erkannte Karte im Swiper oben einreihen und den Swiper öffnen (Marktpreis, Deals, Angebote). */
function openInSwiper(key) {
  const i = infoOf(key);
  if (!i) return;
  learn(key, probeFor(key) || pq?.probe || null);
  closeModalEl(PQ_ID);
  if (sc.running) stop();
  window.PS?.arenaShowScanned?.(i);
}

function pqItemHtml(i, main) {
  const k = jsArg(i.key);
  const canWish = i.kind === "card" || !!i.baseCardId;
  return `<div class="flex gap-2.5 items-start ${main ? "" : "bg-slate-900 border border-slate-800 rounded-xl p-2"}">
    <img src="${esc(cdn(i.image || FALLBACK_IMG, main ? 200 : 100))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="${main ? "w-20 h-28" : "w-10 h-14"} object-contain rounded bg-slate-900 shrink-0" />
    <div class="min-w-0 flex-1 space-y-1">
      <p class="${main ? "text-sm" : "text-xs"} font-black text-white leading-tight">${esc(i.name)} <span class="text-slate-400 font-bold">${esc(i.number || "")}</span></p>
      <p class="text-[10px] text-slate-400 truncate">${FLAG[i.lang] || ""} ${esc(i.setName || "")}${i.rarity ? ` · ${esc(i.rarity)}` : ""}</p>
      <p class="text-xs"><span class="text-slate-500 font-bold">Marktpreis</span> <strong class="text-emerald-400">${priceTxt(i)}</strong>${i.psa10 ? ` <span class="text-slate-500 font-bold ml-1">PSA 10</span> <strong class="text-purple-300">${eur(i.psa10)}</strong>` : ""}</p>
      <div class="flex flex-wrap gap-1">
        <button onclick="PS.liveScanSwiper(${k})" class="text-[11px] font-black px-2.5 py-1.5 rounded-lg ${pq?.target === "swipe" ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-white"}">🃏 Im Swiper suchen</button>
        <button onclick="PS.liveScanAdd(${k})" class="text-[11px] font-black px-2.5 py-1.5 rounded-lg ${pq?.target === "portfolio" ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-white"}">💼 Karte hinzufügen</button>
        <button onclick="PS.liveScanWish(${k})" ${canWish ? "" : "disabled"} class="text-[11px] font-black px-2.5 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-40">❤️ Wunschliste</button>
      </div>
    </div>
  </div>`;
}

function renderPq({ loading = "", infos = [], unsure = false, note = "" } = {}) {
  const photo = pq?.photo ? `<img src="${esc(pq.photo)}" alt="Dein Foto" class="w-14 h-20 object-cover rounded border border-cyan-400/60 shrink-0" />` : "";
  const body = loading
    ? `<p class="text-xs font-bold text-cyan-200 py-4 text-center">${esc(loading)}</p>`
    : infos.length
      ? `${unsure ? `<p class="text-[11px] font-black text-yellow-300">🤔 Nicht ganz sicher – welche Karte ist es?</p>` : `<p class="text-[11px] font-black text-emerald-300">✅ Erkannt${pq?.ms ? ` in ${(pq.ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s` : ""} · ohne KI</p>`}
         ${pqItemHtml(infos[0], true)}
         ${infos.length > 1 ? `<p class="text-[9px] uppercase font-bold text-slate-500 pt-1">${unsure ? "Weitere Vorschläge" : "Andere Treffer"}</p><div class="space-y-1.5">${infos.slice(1, 4).map((i) => pqItemHtml(i, false)).join("")}</div>` : ""}`
      : `<p class="text-xs text-slate-300">🤔 Keine Karte sicher erkannt. Tipp: Foto gerade, hell und so, dass Name oben und Nummer unten lesbar sind.</p>`;
  modal(PQ_ID, `<div class="space-y-3">
    <div class="flex items-start gap-3">${photo}<div class="min-w-0"><p class="text-[10px] font-black uppercase text-cyan-300">📸 Foto-Scan · auf dem Gerät</p>
      <h3 class="text-base font-black text-white">${pq?.target === "swipe" ? "Karte im Swiper finden" : "Karte zur Sammlung hinzufügen"}</h3>${note ? `<p class="text-[10px] text-slate-400">${esc(note)}</p>` : ""}</div></div>
    ${body}
    ${loading ? "" : `<div class="flex flex-wrap gap-1.5 pt-1">
      <label class="cursor-pointer text-[11px] font-black bg-slate-800 text-white px-3 py-2 rounded-xl">📸 Neues Foto<input data-photo-scan="${esc(pq?.target || "swipe")}" type="file" accept="image/*" capture="environment" class="hidden" /></label>
      <label class="cursor-pointer text-[11px] font-black bg-slate-800 text-white px-3 py-2 rounded-xl">🖼️ Anderes Bild<input data-photo-scan="${esc(pq?.target || "swipe")}" type="file" accept="image/*" class="hidden" /></label>
      ${unsure || !infos.length ? `<button onclick="PS.liveScanDeepScan()" class="text-[11px] font-black bg-slate-800 text-cyan-200 px-3 py-2 rounded-xl" title="Optional, zählt als KI-Scan">🧠 KI-Tiefenscan</button>` : ""}
      <button onclick="PS.openLiveScanner()" class="text-[11px] font-black bg-slate-800 text-white px-3 py-2 rounded-xl">⚡ Live-Scanner</button>
    </div>`}
  </div>`);
}

/** „Foto aufnehmen / Bild hochladen“ im Swiper oder in der Sammlung: Erkennung ohne KI, dann 1-Tap-Aktion. */
async function photoQuick(file, target = "swipe") {
  if (!file) return;
  pq = { target: target === "portfolio" ? "portfolio" : "swipe" };
  renderPq({ loading: "⚡ Erkenne Karte (Name, Nummer, Motiv) …" });
  let dataUrl;
  try { dataUrl = await fileToDataUrl(file); } catch { renderPq({ note: "Foto nicht lesbar – bitte JPG oder PNG wählen." }); return; }
  try {
    if (!sc.ready && !sc.loadingIndex) loadIndex();
    getOcr().catch(() => null);
    const r = await recognizePhoto(dataUrl);
    const photo = cropToCard(r.cv, r.corners, 440, 0.85);
    pq = { ...pq, dataUrl, photo, cv: r.cv, corners: r.corners, probe: r.m.probe || null, ms: r.ms };
    const keys = r.accepted ? [...r.keys.slice(0, 1), ...r.cands] : r.cands;
    const infos = keys.length ? await fetchInfo([...new Set(keys)].slice(0, 6)) : [];
    if (r.accepted && infos.length) {
      sc.current = null;
      // Swiper: direkt hinspringen – Marktpreis und Deals sofort sichtbar
      if (pq.target === "swipe") { successFeedback(); openInSwiper(infos[0].key); toast("✅ Erkannt", `${infos[0].name} ${infos[0].number || ""} – oben im Swiper mit Marktpreis und Deals.`); return; }
      successFeedback();
    }
    renderPq({ infos, unsure: !r.accepted });
  } catch (e) { closeModalEl(PQ_ID); handleError(e); }
}

/** KI-Tiefenscan auf dem Foto aus dem Foto-Scan (optional, zählt als KI-Scan). */
async function deepScanPhoto() {
  if (!pq?.cv) { photoScan(); return; }
  if (!requireLogin()) return;
  renderPq({ loading: "🧠 KI-Tiefenscan läuft …" });
  try {
    const r = await api("/api/scan/vision", { method: "POST", body: { image: cropToCard(pq.cv, pq.corners) } });
    window.PS?.refreshMe?.();
    for (const it of r?.items || []) sc.info.set(it.key, it);
    renderPq({ infos: r?.items || [], unsure: !r?.clear, note: r?.items?.length ? "🤖 per KI-Tiefenscan erkannt" : "Auch die KI hat keine passende Karte im Katalog gefunden." });
  } catch (e) { renderPq({ infos: [], note: "KI-Tiefenscan fehlgeschlagen." }); handleError(e); }
}

export const liveScanApi = {
  ...(IS_STAGE ? { liveScanDemoPrepare: demoPrepare, liveScanDemoScan: demoScan, liveScanDemoFile: demoFile } : {}),
  liveScanStart: () => start(),
  liveScanStop: () => stop(),
  liveScanTorch: () => toggleTorch(),
  liveScanLang: setLang,
  liveScanAdd: addToCollection,
  /** Aktion im Ergebnisfeld mit Auto-Close (binder | sell | instant | wish | flip | details | swiper) */
  liveScanAct: (name, key) => actOnHit(name, key),
  /** Unter-Button „Zustand: Near Mint ▾“ – Dropdown mit allen Zuständen und Vergleichspreisen */
  liveScanCondMenu: () => {
    if (!sc.current?.info) return;
    Object.assign(sc.current, toggleConditionMenu(sc.current)); haptic("select"); renderHud(sc.current);
  },
  /** „⋯“: Swiper, Flip-Check, Details, Sprachvarianten und andere Treffer ein-/ausblenden */
  liveScanMore: () => {
    if (!sc.current?.info) return;
    sc.current.more = !sc.current.more; renderHud(sc.current);
  },
  /** Optionaler dezenter Treffer-Ton */
  liveScanSound: () => {
    sc.prefs.sound = !sc.prefs.sound; savePrefs(); renderToggles();
    if (sc.prefs.sound) beep();
  },
  liveScanAddAll: addAll,
  liveScanWish: addWish,
  liveScanFlip: flipCheck,
  liveScanSell: sellOne,
  liveScanSellAll: sellAll,
  /** Schnell-Inserieren für beliebige Treffer (z. B. Foto-Scan) */
  liveScanQuickList: (infos, opts) => openQuickList(infos, opts),
  ...quickListApi,
  liveScanDetails: details,
  liveScanPhoto: photoScan,
  /** Stufe 1 für Fotos: Erkennung auf dem Gerät, bevor die KI gefragt wird */
  liveScanRecognize: (dataUrl) => recognizeImage(dataUrl),
  /** Stufe 2 nach KI-Erkennung: Fingerabdruck mit der vom Nutzer bestätigten Karte verknüpfen */
  liveScanLearn: (key, probe, source = "ai") => learn(key, probe || window.__psScanProbe, source),
  liveScanDismiss: () => {
    sc.current = null; sc.currentAt = 0; renderHud(null);
    if (!sc.running) { $("ps-ls-still")?.classList.add("hidden"); $("ps-ls-hint")?.classList.add("hidden"); $("ps-ls-idle")?.classList.remove("hidden"); }
    setUi("search", "📇 Karte in den Rahmen halten");
  },
  /** Auslöser: Einzelbild in voller Schärfe (zusätzlich zur Auto-Erkennung); bei aus­geschalteter Kamera startet er sie */
  liveScanShutter: () => capture({ auto: false }),
  liveScanUpload: (file) => scanUpload(file),
  /** Foto aufnehmen / Bild hochladen im Swiper bzw. in der Sammlung */
  liveScanPhotoQuick: (file, target) => photoQuick(file, target),
  /** Erkannte Karte im Swiper anzeigen (Marktpreis, Deals) */
  liveScanSwiper: (key) => openInSwiper(key),
  /** Optionaler KI-Tiefenscan (Foto-Scan oder Live-Bild) */
  liveScanDeepScan: () => deepScanPhoto(),
  /** Alternative aus „Andere Treffer“ übernehmen – nie neu scannen müssen */
  liveScanPick: (key) => {
    const cur = sc.current;
    if (!cur?.alts) return;
    const pick = cur.alts.find((a) => a.key === key);
    if (!pick) return;
    haptic("select");
    const prev = cur.info;
    cur.alts = [prev, ...cur.alts.filter((a) => a.key !== key)].slice(0, 3);
    cur.info = pick; cur.key = pick.key; cur.variants = [pick]; cur.unsure = false;
    // Falscher Treffer stand schon in der Serie → durch die gewählte Karte ersetzen (Foto/Fingerabdruck bleiben)
    if (sc.series[0]?.key === prev.key) sc.series[0] = { ...pick, probe: sc.series[0].probe, photo: sc.series[0].photo, scanCondition: cur.condition, scanVariant: cur.finish };
    else addToSeries(pick);
    if (sc.prefs.series) sc.suppress = [...new Set([...(sc.suppress || []), pick.key])];
    renderHud(cur); renderSeries();
  },
  /** Zustand aus dem Dropdown übernehmen: Hauptpreis passt sich an, Dropdown schließt. Neue Scans starten wieder mit NM. */
  liveScanCondition: (c) => {
    if (!CONDS.includes(c) || !sc.current?.info) return;
    Object.assign(sc.current, selectCondition(sc.current, c)); haptic("select"); renderHud(sc.current); syncSeriesHead();
  },
  /** 1-Tap-Variante (Normal / Reverse / Holo) – zieht den eigenen Variantenpreis, wo vorhanden */
  liveScanFinish: (f) => {
    if (!FINISHES.some(([x]) => x === f) || !sc.current?.info) return;
    Object.assign(sc.current, selectFinish(sc.current, f)); haptic("select"); renderHud(sc.current); syncSeriesHead();
  },
  /** „Nächste Karte scannen“: Ergebnis schließen, aktuelle Karte bis zum Herausnehmen ignorieren, Kamera bereit */
  liveScanNext: () => { autoFileCurrent(); nextCard(); },
  liveScanSeriesMode: () => {
    sc.prefs.series = !sc.prefs.series; savePrefs(); renderToggles();
    toast(sc.prefs.series ? "🔁 Serien-Scan an" : "🔁 Serien-Scan aus", sc.prefs.series ? "Lege Karte für Karte in den Rahmen – jede erkannte Karte landet sofort in der Liste, doppelte werden übersprungen." : "Der Scanner zeigt wieder jede Karte einzeln.");
    if (sc.current) renderHud(sc.current);
  },
  liveScanAutoAi: () => {
    sc.prefs.autoAi = !sc.prefs.autoAi; sc.prefs.aiOptIn = sc.prefs.autoAi; savePrefs(); renderToggles();
    toast(sc.prefs.autoAi ? "🤖 KI-Auto an" : "🤖 KI-Auto aus", sc.prefs.autoAi ? "Ist die Erkennung auf dem Gerät unsicher, prüft die KI den Kartenausschnitt automatisch (zählt als KI-Scan)." : "Erkennung nur noch auf dem Gerät (Name, Nummer, Motiv). Die KI gibt es weiter per „🧠 KI-Tiefenscan“.");
  },
  liveScanVariant: (key) => {
    if (!sc.current?.variants) return;
    const v = sc.current.variants.find((x) => x.key === key);
    if (!v) return;
    sc.current.info = v; sc.current.key = v.key;
    haptic("select");
    // Scan-Foto und Fingerabdruck gehören zur fotografierten Karte, nicht zur Sprachvariante
    sc.series = sc.series.map((s, idx) => (idx === 0 && sc.current.variants.some((x) => x.key === s.key) ? { ...v, probe: s.probe, photo: s.photo, scanCondition: s.scanCondition, scanVariant: s.scanVariant } : s));
    renderHud(sc.current); renderSeries();
  },
  liveScanClear: () => { sc.series = []; renderSeries(); },
  liveScanAdminRun: async () => {
    toast("⏳ Läuft …", "Weitere Karten werden indexiert (bis zu 20 Sekunden).");
    try {
      // Ausdrücklich als JSON (Content-Type + Body) mit Login-Token – der CSRF-Schutz des Servers lehnt alles andere ab
      const r = await api("/api/admin/scan-index/run", { method: "POST", body: { langs: ["de", "en", "ja"] } });
      sc.status = r.status; renderIndexLine(); renderAdmin();
      const added = (Number(r.result.seeded) || 0) + (Number(r.result.hashed) || 0);
      toast("✅ Fertig", `${added.toLocaleString("de-DE")} Karten neu im Index${r.result.seeded ? ` (davon ${Number(r.result.seeded).toLocaleString("de-DE")} aus dem Basis-Index)` : ""}${r.result.failed ? `, ${r.result.failed} ohne Bild` : ""}.`);
    } catch (e) { handleError(e); }
  },
  /** Bereich öffnen und Kamera sofort starten (Schnellstart-Knöpfe, „Karte scannen“). */
  openLiveScanner: () => {
    window.PS?.showSub?.("scan", "live");
    setTimeout(() => start(), 120);
  },
};

/** Beim Öffnen des Unter-Reiters: Status laden; Admin-Bereich nach dem Login. */
export function onLiveScanShown() {
  renderLangChips();
  renderToggles();
  loadStatus();
  if (IS_STAGE) return;
  // Schon beim Öffnen vorladen (Karten-Index + Texterkennung) – nicht erst nach dem Kamera-Start: die erste Karte ist
  // dann sofort erkennbar statt nach mehreren Sekunden Laden
  if (!sc.ready && !sc.loadingIndex) loadIndex();
  warmupOcr();
  autoStart();
}

/** Kamera ohne Extra-Tipp starten, wenn der Zugriff schon erlaubt ist (sonst bleibt der Start-Knopf, kein Überfall-Dialog). */
async function autoStart() {
  if (sc.running || sc.starting || sc.lastStill || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const p = await navigator.permissions?.query?.({ name: "camera" });
    if (p?.state !== "granted") return;
  } catch { return; }
  const panel = $("ps-live-scan");
  if (panel && panel.offsetParent !== null && !sc.running) start();
}

export function initLiveScanner() {
  renderLangChips();
  renderToggles();
  // Galerie-Import (beide Datei-Felder) und Tap-to-Focus – per Delegation, weil das Panel nachgeladen wird
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el?.dataset?.lsUpload) { const f = el.files?.[0]; el.value = ""; scanUpload(f); }
  });
  document.addEventListener("click", (e) => { if (e.target?.closest?.("#ps-ls-stage")) tapFocus(e); });
  window.addEventListener("resize", () => { if (sc.running) layout(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && sc.running) stop(); });
}
