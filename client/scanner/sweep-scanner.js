// PokeSwipe & Radar – High-End-Live-Scanner („Ruckzuck-Sweep“ & „9er-Ordner-Scan“): ohne Zielrahmen, ohne Wartezeit-Zähler,
// ohne Server-Wartezeit. Alles läuft lokal im Web Worker – es verlässt kein Kamerabild das Gerät.
//
//  • Zero-Setup: keine Set-Auswahl, kein Set-Lock, kein Zielrahmen – jede Karte wird gegen den kompletten Katalog
//    abgeglichen und automatisch in ihren Set-Ordner im Set-Binder einsortiert („✅ Einsortiert in: [Set-Name]“).
//  • Stapel / Einzelkarte (Ruckzuck-Serienscan, Standard bei jedem Start) – 4-Stufen-Pipeline ohne Geister-Scans:
//      1) Präsenz-Gate im Worker: nur wenn GENAU EINE Karte (Rechteck 1 : 1,25 … 1 : 1,55, 20 … 88 % des Bilds) scharf im
//         Bild ist, wird überhaupt abgeglichen – sonst ruhig „Bereit – einzelne Karte ins Bild halten“ (Tisch, Sofa, 4 Karten,
//         abgelegtes Handy = 0 Scans)
//      2) unsichtbare Perspektiv-Begradigung (300 × 420 px, 3 % Rand ab – Sleeve/Ordner/Tisch weg, Reflexe maskiert)
//      3) Nummer + Artwork → sofort; reines Artwork nur ≥ 82 % mit ≥ 10 % Vorsprung in 2 Bildern in Folge (keine
//         58-%-Schwelle mehr); klare Karte im Bereich 65–81 %: Name + Nummer per Texterkennung im Text-Index (41.962
//         Datensätze), sonst einmalig der Vision-Rückfall (/api über deps.vision) mit dem begradigten Ausschnitt < 25 KB
//      4) physische Karten-Sperre: nach einem Treffer friert der Auslöser ein, bis die Karte weg/ausgetauscht ist
//    → Vibration + Pling. Weitere gleiche Exemplare: „+1“ im Dock.
//  • 100 % freies Kamerafenster: im Kamerabild liegen keine Buttons, Pillen, Rahmen oder Etiketten mehr – Status- & Tool-
//    Leiste, Karten- & Aktionsbereich und Session-Drawer sitzen unter der Kamera.
//  • Jeder Treffer landet ohne Klick automatisch (+1) im passenden Set-Ordner („✅ Automatisch im Ordner: [Set-Name] (1×)“);
//    „Rückgängig“ nimmt den Scan UND den Ordner-Eintrag wieder zurück. Direkt darunter: „🏷️ 1-Klick Inserieren (CM-Preis)“
//    und „⚡ Schnell-Inserieren (Deal unter CM)“ – ohne Formular sofort live auf dem Marktplatz.
//  • Ordner-Seite (9er-Binder-Scan): dezentes 3 × 3- bzw. 2 × 2-Raster passt sich der aufgeschlagenen Seite an, jedes Fach
//    wird hochauflösend aus dem nativen HD-Bild geschnitten. Jedes Fach hat seine eigene Positions-Sperre: grüner Haken +
//    Name + Cardmarket-Preis direkt auf dem Fach, nichts wird doppelt gezählt. Umblättern (> 65 % Bildänderung) oder der
//    Knopf „Nächste Seite“ leert alle Sperren.
//  • Die Ordner-Seite ist nur noch ein manueller Umschalter – es gibt keine Modus-Automatik mehr.
//  • Treffer landen im Session-Dock (Miniatur, Name, Set, Cardmarket-Trend, +1, Normal/Holo/Reverse, DE/EN/JP, Rückgängig) und
//    – asynchron im Hintergrund, die Kamera-Schleife hält nie an – im Set-Binder. Im Session-Drawer: „In Set-Binder
//    einsortieren“ und „Direkt auf Marktplatz inserieren“.
//
// Diese Datei ist nur Oberfläche + Steuerung. Die Bildverarbeitung steckt in sweep-engine.js (Worker), die reine Logik
// in sweep-logic.js (Stapel-Sperre, Session) und hd-scan-logic.js (Raster, Slot-Sperre, Anti-Glare, Fingerabdruck).
// Worker, Index und Kartendaten kommen über deps aus live-scanner.js.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, handleError } from "../core.js";
import { haptic, isNative } from "../native.js";
import { conditionPrice } from "./scan-ui-logic.js";
import {
  SWEEP, createSweepGate, orderByLang, langOfKey, setIdOfKey, sessionAdd, sessionQty, sessionFinish, sessionUndo, sessionTotals,
  sessionDuplicates, FINISH_KEYS, FINISH_LABEL, quadCenter, tagCode, tagLines, bumpDaily, dailyLabel, filedLabel, oneTapPrice,
} from "./sweep-logic.js";
import { HD, GRID_LAYOUTS, createSlotGate } from "./hd-scan-logic.js";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const LANG_SHORT = { de: "DE", en: "EN", ja: "JP" };
const LANG_NAME = { de: "Deutsch", en: "Englisch", ja: "Japanisch" };
const FIN_SHORT = { normal: "Normal", holo: "Holo", reverse_holo: "Reverse" };
const PREFS_KEY = "ps_sweep_prefs";
const SESSION_KEY = "ps_sweep_session";
const DAILY_KEY = "ps_sweep_daily";
/** Bild-Kanal: so lange gilt ein Bild beim Worker als unterwegs, danach wird das nächste geschickt */
const FRAME_STALE_MS = 1000;
/** Mittlere Helligkeit (0…255) darunter gilt das Bild als zu dunkel (Taschenlampe anbieten/einschalten) */
const DARK_LEVEL = 42;
const DARK_FRAMES = 30;
const MAX_ITEMS = 400;
/** Höchstens so viele Karten gehen auf einmal in den Bulk-Listing-Dialog */
const MAX_LIST = 40;
/** Preisschild bleibt nach dem letzten Sichtkontakt so lange stehen, danach blendet es aus */
const TAG_HOLD_MS = 900, TAG_FADE_MS = 400;
/** Taschenlampe an + so viele Bilder mit starkem Reflex auf der Folie → Warnung */
const GLARE_WARN = 0.05, GLARE_WARN_FRAMES = 8;
/** Ruhige Standby-Anzeige: kein (oder kein eindeutiges) Karten-Rechteck im Bild → kein Abgleich, kein Scan */
const STANDBY_TEXT = "⚡ Bereit – einzelne Karte ins Bild halten";
/** Vision-Rückfall: begradigter Karten-Ausschnitt als JPEG höchstens so groß */
const VISION_MAX_BYTES = 25_000;
/** „✅ Automatisch im Ordner: [Set-Name] (1×)“ bleibt so lange in der Status-Pille stehen */
const FILED_MSG_MS = 2200;
/** Scan-Modi (Sofort-Umschalter oben im Kamerabild) */
export const MODES = {
  stack: { label: "⚡ Stapel / Einzelkarte", sub: "Ruckzuck-Sweep", icon: "⚡", hint: "Karte für Karte ins Bild schieben – jede zählt sofort, auch Doppelte direkt nacheinander." },
  binder: { label: "📒 Ordner-Seite", sub: "9er-Binder-Scan", icon: "📒", hint: "Handy über die aufgeschlagene Ordnerseite halten – jedes Fach zählt genau einmal, umblättern und weiter." },
};
/** Frühere Modus-Namen (gespeicherte Einstellungen); die frühere Automatik startet jetzt im Stapel-Modus */
const MODE_ALIAS = { turbo: "stack", sweep: "binder", auto: "stack" };

const SWEEP_CSS = `
#ps-sw .ps-sw-scroll{scrollbar-width:none}#ps-sw .ps-sw-scroll::-webkit-scrollbar{display:none}
#ps-sw .ps-sw-cam{height:min(calc(100dvh - 420px),560px);min-height:280px}
#ps-sw-dock .ps-sw-pop{animation:psSwPop .32s cubic-bezier(.2,.9,.3,1.3)}
@keyframes psSwPop{0%{transform:translateY(10px) scale(.96);opacity:.2}100%{transform:none;opacity:1}}
#ps-sw.ps-sw-full{position:fixed;inset:0;z-index:70;max-width:none;height:100dvh;padding:.5rem;gap:.5rem;background:#020617;overflow-y:auto}
#ps-sw.ps-sw-full .ps-sw-cam{flex:1 1 auto;height:auto;min-height:40dvh;border-radius:1.25rem}
.ps-sw-mode[aria-pressed="true"]{background:linear-gradient(90deg,#22d3ee,#34d399);color:#020617}
.ps-sw-plus{min-width:3.5rem;min-height:3rem;touch-action:manipulation}
.ps-sw-plus:active{transform:scale(.94)}
@media (prefers-reduced-motion:reduce){#ps-sw-dock .ps-sw-pop{animation:none}}
`;

/**
 * deps: {
 *   worker(): Worker · ensureIndex() · index(): { ready, loading, count, offscreen } · ensureLang(lang)
 *   fetchInfo(keys) → Promise<info[]> · fileItem(info, choice, qty) → Promise<{ id?, quantity?, guest? } | false> · learn(key, probe)
 *   unfileItem(record, info, choice) → Promise<{ quantity } | false> (ein Exemplar wieder aus dem Set-Ordner nehmen)
 *   listNow(info, price) → Promise<{ id } | null> (1-Klick-Inserat ohne Formular)
 *   openQuickList(infos, opts) · beforeStart() (Foto-Ansicht schließen) · isStage
 *   readText(canvas, rect, ms) → Promise<{ text } | null> (Name + Nummer lesen, optional)
 *   decideText(text, hash) → Promise<{ accepted, strength, keys, label } | null> (Text-Index im Worker, optional)
 *   vision(jpegDataUrl) → Promise<{ clear, items } | null> (Vision-Rückfall, optional – nur angemeldet)
 * }
 */
export function createSweep(deps) {
  const sw = {
    running: false, starting: false, camGen: 0, stream: null, track: null, caps: {}, torch: false, torchTouched: false, autoTorch: false,
    cv: null, ctx: null, inFlight: 0, sentAt: 0, seq: 0, bitmapOk: typeof createImageBitmap === "function",
    frameTimes: [], avgMs: 0, procMs: 0, dark: 0, gate: null, tags: [], raf: 0, tagRaf: 0, view: { count: 0, value: 0 },
    items: [], history: [], lastUid: null, uidSeq: Date.now(), info: new Map(), probes: new Map(),
    layoutsReady: 0, top: 0, filedMsg: null, drawer: false, full: false, audio: null,
    prefs: readPrefs(), configSent: false, statusText: "", daily: readDaily(), saving: new Map(), portfolioTimer: 0,
    // Set-Ordner-Einträge je Session-Eintrag (für „Rückgängig“) und eine Warteschlange je Eintrag (Speichern → Zurücknehmen)
    fileLog: new Map(), chains: new Map(), gateInfo: null,
    // Ordner-Seite: Slot-Sperren, Raster/Fächer aus dem letzten Bild, Etikett je Fach, zuletzt gesehene Erkennung je Fach
    slotGate: createSlotGate(), grid: null, cells: [], slotTags: new Map(), slotSeen: new Map(), flipAt: 0,
    // Tatsächlich laufender Modus („turbo“ = Stapel, „binder“ = Ordner-Seite – nur per Knopf)
    eff: "turbo", glareFrames: 0, glareWarned: false, fp: null, pingAt: 0,
    // Präsenz-Gate (Stufe 1), physische Karte (Epoche der Sperre) und Name+Nummer-/Vision-Rückfall (Stufe 3 C)
    standby: "", epoch: 0, verify: null, wantCrop: false,
  };
  sw.gate = createSweepGate();
  sw.eff = "turbo";
  restoreSession();

  function readPrefs() {
    const def = { muted: false, lang: "de", finish: "normal", mode: "stack", grid: "3x3", autoFile: true, dock: true };
    try {
      const p = { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}) };
      if (!FLAG[p.lang]) p.lang = "de";
      if (!FINISH_KEYS.includes(p.finish)) p.finish = "normal";
      // Kein Set-Lock mehr (frühere Einstellung wird verworfen); jeder Start beginnt im schnellen Stapel-Modus
      delete p.setId;
      p.mode = "stack";
      if (!GRID_LAYOUTS[p.grid]) p.grid = "3x3";
      p.autoFile = p.autoFile !== false; p.dock = p.dock !== false;
      return p;
    } catch { return def; }
  }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(sw.prefs)); } catch {} };
  function readDaily() {
    try { const d = JSON.parse(localStorage.getItem(DAILY_KEY) || "null"); return d && typeof d.day === "string" ? d : null; } catch { return null; }
  }
  const saveDaily = () => { try { localStorage.setItem(DAILY_KEY, JSON.stringify(sw.daily)); } catch {} };
  function saveSession() {
    try {
      const slim = sw.items.slice(0, MAX_ITEMS).map((i) => ({ ...i, info: i.info ? pickInfo(i.info) : null }));
      const log = [...sw.fileLog].filter(([uid, l]) => l.length && sw.items.some((i) => i.uid === uid)).slice(0, MAX_ITEMS);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ items: slim, history: sw.history.slice(-200), fileLog: log, at: Date.now() }));
    } catch {}
  }
  function restoreSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      // Eine Session hält bis zu 3 Tage (danach startet die nächste frisch)
      if (!s || !Array.isArray(s.items) || Date.now() - Number(s.at || 0) > 3 * 86_400_000) return;
      sw.items = s.items.filter((i) => i?.uid && i?.key && Number(i.qty) > 0).slice(0, MAX_ITEMS);
      sw.history = Array.isArray(s.history) ? s.history.filter((u) => typeof u === "string") : [];
      sw.lastUid = sw.items[0]?.uid || null;
      for (const i of sw.items) if (i.info) sw.info.set(i.key, i.info);
      if (Array.isArray(s.fileLog)) for (const [uid, l] of s.fileLog) if (typeof uid === "string" && Array.isArray(l)) sw.fileLog.set(uid, l.filter((r) => r && typeof r === "object").slice(0, 999));
    } catch {}
  }
  const pickInfo = (i) => ({
    key: i.key, kind: i.kind, id: i.id, lang: i.lang, partial: i.partial || undefined, name: i.name, altName: i.altName || "", setName: i.setName || "", setCode: i.setCode || "",
    number: i.number || "", image: i.image || "", price: i.price ?? null, reversePrice: i.reversePrice ?? null, holoPrice: i.holoPrice ?? null,
    baseCardId: i.baseCardId ?? null, rarity: i.rarity || "",
  });

  // ------------------------------------------------------------------ Oberfläche
  const chip = (on, extra = "") => `shrink-0 text-[11px] font-black px-2.5 py-1 rounded-lg whitespace-nowrap ${on ? "bg-yellow-400 text-slate-950" : "bg-slate-900/80 text-slate-200 border border-white/10"} ${extra}`;
  const iconBtn = "w-9 h-9 shrink-0 rounded-full bg-slate-900/80 border border-white/10 text-white text-base flex items-center justify-center";
  /** Läuft gerade der Ordner-Modus? (fest gewählt oder von der Automatik erkannt) */
  const isBinder = () => sw.eff === "binder";
  const layout = () => GRID_LAYOUTS[sw.prefs.grid] || GRID_LAYOUTS["3x3"];
  const modeIntro = () => `${MODES[sw.prefs.mode].hint} Kein Rahmen, kein Warten – alles läuft auf deinem Gerät.`;

  /**
   * Aufbau: oben das 100 % freie Kamerafenster (nur das pure Live-Bild – keine Buttons, Pillen, Rahmen, Etiketten oder
   * Popups darüber). Alle Anzeigen und Bedienelemente liegen UNTER der Kamera: Status- & Tool-Leiste, Modus-Umschalter,
   * Karten- & Aktionsbereich (Dock) und die Session-Liste (Drawer).
   */
  function html() {
    return `<div id="ps-sw" class="relative w-full mx-auto max-w-xl flex flex-col gap-2 select-none touch-manipulation" data-mode="${esc(sw.prefs.mode)}">
      <style>${SWEEP_CSS}</style>
      <div id="ps-sw-cam" class="ps-sw-cam relative w-full rounded-3xl overflow-hidden bg-black border border-cyan-400/40">
        <video id="ps-sw-video" class="absolute inset-0 w-full h-full object-cover hidden" playsinline muted autoplay></video>
        <div id="ps-sw-idle" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-950/85">
          <p class="text-4xl" aria-hidden="true">${MODES[sw.prefs.mode].icon}</p>
          <p class="text-base font-black text-white">${esc(MODES[sw.prefs.mode].label)}</p>
          <p class="text-xs text-slate-300 max-w-xs">${esc(modeIntro())}</p>
          <button type="button" onclick="PS.sweep('start')" class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm px-6 py-3 rounded-2xl shadow-lg">📷 Kamera starten</button>
          <p class="text-[10px] text-slate-500 max-w-xs">Erkennung auf deinem Gerät. Nur bei einer unsicheren Karte geht – wenn du angemeldet bist – einmalig ein kleiner Karten-Ausschnitt (kein Kamerabild) zur KI-Prüfung.</p>
        </div>
      </div>
      <div id="ps-sw-bar" class="ps-sw-below shrink-0 bg-slate-950 border border-white/10 rounded-2xl p-1.5 space-y-1.5">
        <div class="flex items-center gap-1.5">
          <div class="min-w-0 flex-1">
            <p id="ps-sw-sum" class="truncate text-[11px] sm:text-xs font-black text-white leading-tight" title="Live-Summe dieser Scan-Session (Cardmarket-Trend)">0 gescannt • Gesamtwert: 0,00 €</p>
            <p id="ps-sw-status" role="status" class="truncate text-[10px] font-black text-cyan-200 leading-tight" title="Live-Diagnose des Scanners"></p>
          </div>
          <label class="${iconBtn} cursor-pointer" title="Foto hochladen" aria-label="Foto aufnehmen oder hochladen">🖼️<input data-ls-upload="1" type="file" accept="image/*" class="hidden" /></label>
          <button id="ps-sw-list" type="button" onclick="PS.sweep('drawer')" class="shrink-0 h-9 bg-slate-800 text-white text-[11px] font-black px-2.5 rounded-full" aria-label="Scan-Session öffnen" aria-expanded="false">☰ 0</button>
        </div>
        <div class="flex items-center gap-1.5">
          <div id="ps-sw-modes" class="min-w-0 flex-1 grid grid-cols-2 gap-1 bg-slate-900 border border-white/10 rounded-xl p-0.5" role="group" aria-label="Scan-Modus"></div>
          <button id="ps-sw-torch" type="button" onclick="PS.sweep('torch')" class="${iconBtn}" aria-label="Taschenlampe" aria-pressed="false">🔦</button>
          <button id="ps-sw-mute" type="button" onclick="PS.sweep('mute')" class="${iconBtn}" aria-label="Ton aus" aria-pressed="false" title="Scanner-Ping & Vibration stummschalten">🔊</button>
          <button id="ps-sw-full" type="button" onclick="PS.sweep('full')" class="${iconBtn}" aria-label="Vollbild" aria-pressed="false">⛶</button>
          <button id="ps-sw-stop" type="button" onclick="PS.sweep('stop')" class="${iconBtn} hidden" aria-label="Kamera beenden">✕</button>
        </div>
        <div id="ps-sw-binderbar" class="flex items-center gap-1.5 empty:hidden">
          <span id="ps-sw-view" class="shrink-0 hidden text-[11px] font-black bg-emerald-400 text-slate-950 px-2 py-1 rounded-lg" title="Erkannte Fächer dieser Ordnerseite"></span>
          <button id="ps-sw-grid" type="button" onclick="PS.sweep('grid')" class="shrink-0 hidden text-[11px] font-black bg-slate-900 border border-white/10 text-white px-2 py-1 rounded-lg" aria-label="Ordner-Raster umschalten (3 × 3 oder 2 × 2)">3×3</button>
          <button id="ps-sw-next" type="button" onclick="PS.sweep('nextPage')" class="shrink-0 hidden text-[11px] font-black bg-cyan-400 text-slate-950 px-2.5 py-1 rounded-lg" title="Alle Fach-Sperren leeren und die nächste Seite scannen">📖 Nächste Seite</button>
        </div>
      </div>
      <div id="ps-sw-dock" class="ps-sw-below shrink-0" aria-live="polite"></div>
      <div id="ps-sw-drawer" class="ps-sw-below hidden max-h-[60dvh] flex flex-col bg-slate-950 border border-cyan-400/40 rounded-3xl overflow-hidden"></div>
    </div>`;
  }

  function renderModes() {
    const box = $("ps-sw-modes");
    if (!box) return;
    box.innerHTML = Object.entries(MODES).map(([k, m]) => `<button type="button" onclick="PS.sweep('mode', '${k}')" aria-pressed="${sw.prefs.mode === k}" class="ps-sw-mode text-left rounded-lg px-2 py-1 ${sw.prefs.mode === k ? "" : "text-slate-200"}" title="${esc(m.hint)}">
        <span class="block text-[11px] font-black leading-tight truncate">${esc(m.label)}</span><span class="block text-[9px] font-bold opacity-80 leading-tight truncate">${esc(m.sub)}</span></button>`).join("");
    $("ps-sw")?.setAttribute("data-mode", sw.prefs.mode);
    renderView();
  }

  function renderToggles() {
    const m = $("ps-sw-mute");
    if (m) { m.textContent = sw.prefs.muted ? "🔇" : "🔊"; m.setAttribute("aria-pressed", String(sw.prefs.muted)); m.setAttribute("aria-label", sw.prefs.muted ? "Ton & Vibration an" : "Ton & Vibration aus"); }
    const t = $("ps-sw-torch");
    if (t) { t.setAttribute("aria-pressed", String(sw.torch)); t.classList.toggle("bg-yellow-400", sw.torch); t.classList.toggle("bg-slate-900/80", !sw.torch); }
    const fb = $("ps-sw-full");
    if (fb) fb.setAttribute("aria-pressed", String(sw.full));
    renderModes();
  }

  const priceOf = (it) => {
    const i = it.info || sw.info.get(it.key);
    return i ? conditionPrice(i, it.finish || "normal", "NM") || Number(i.price) || 0 : 0;
  };
  /** Preis einer Karte nur über ihren Index-Schlüssel (Preisschild, Gesamtwert im Bild) */
  const priceOfKey = (key) => { const i = sw.info.get(key); return i ? conditionPrice(i, sw.prefs.finish, "NM") || Number(i.price) || 0 : 0; };

  /** Live-Summenzähler in der Leiste unter der Kamera: „X gescannt • Gesamtwert: XX,XX €“ + Session-Drawer-Knopf */
  function renderTop() {
    const t = sessionTotals(sw.items, priceOf);
    const el = $("ps-sw-sum");
    if (el) el.textContent = `${t.count.toLocaleString("de-DE")} gescannt • Gesamtwert: ${eur(t.value)}`;
    const lb = $("ps-sw-list");
    if (lb) { lb.textContent = `☰ ${sw.items.length}`; lb.setAttribute("aria-expanded", String(sw.drawer)); }
  }

  /** Ordner-Leiste: erkannte Fächer, Raster-Umschalter, „Nächste Seite“ */
  function renderView() {
    const on = isBinder() && sw.running;
    const el = $("ps-sw-view"), g = $("ps-sw-grid"), n = $("ps-sw-next");
    const lay = layout();
    if (el) { el.classList.toggle("hidden", !on); el.textContent = `✓ ${sw.slotTags.size}/${lay.cols * lay.rows}`; }
    if (g) { g.classList.toggle("hidden", !(on || sw.prefs.mode === "binder")); g.textContent = sw.prefs.grid === "2x2" ? "2×2" : "3×3"; }
    if (n) n.classList.toggle("hidden", !on);
  }

  function setStatus(text) {
    sw.statusText = text;
    const el = $("ps-sw-status");
    if (el) el.textContent = text;
  }

  /**
   * Kompakte Live-Anzeige UNTER der Kamera: „Bereit • Match: 64 % • 12 FPS“ – zeigt bei jedem Bild, wie die Kamera
   * reagiert (keine Farb-Meldungen mehr: die Farbe sperrt keine Treffer).
   */
  function statusLine() {
    const ix = deps.index();
    if (!ix.ready) return ix.loading ? "⏳ Lade Karten-Index (einmalig, danach offline auf dem Gerät) …" : "";
    if (sw.filedMsg && Date.now() - sw.filedMsg.at < FILED_MSG_MS) return sw.filedMsg.text;
    if (!sw.running) return `⚡ Bereit (${Number(ix.count || 0).toLocaleString("de-DE")} Karten)`;
    // Stapel: ohne eindeutiges Karten-Rechteck ruhiger Standby (keine Match-Werte, kein Auslösen)
    if (!isBinder() && sw.standby) return STANDBY_TEXT;
    if (!isBinder() && sw.gateInfo?.frozen) return "🔒 Karte erfasst – Karte wegziehen oder nächste Karte ins Bild";
    const parts = [isBinder() ? "⚡ Bereit" : "🔍 Karte erkannt", `Match: ${Math.round((sw.top || 0) * 100)} %`];
    if (!isBinder() && sw.verify && (sw.verify.state === "crop" || sw.verify.state === "busy")) parts.push("Prüfe Name + Nummer …");
    if (sw.frameTimes.length > 4) {
      const span = sw.frameTimes[sw.frameTimes.length - 1] - sw.frameTimes[0];
      const fps = span > 0 ? Math.round(((sw.frameTimes.length - 1) * 1000) / span) : 0;
      parts.push(`${fps} FPS`);
    }
    if (!isBinder() && sw.gateInfo?.blurry) parts.push("〰️ ruhig halten");
    if (sw.running && isBinder() && Date.now() - sw.flipAt < 1200) parts.push("📖 Neue Seite");
    if (sw.running && isBinder() && sw.grid && !sw.grid.fitted) parts.push("Raster über die Ordnerseite halten");
    return parts.join(" • ");
  }

  function itemName(it) {
    const i = it.info;
    if (i) return `${i.lang === "ja" && i.altName ? i.altName : i.name}`;
    return it.label || "Karte";
  }
  const itemSet = (it) => {
    const i = it.info;
    if (!i) return setIdOfKey(it.key).toUpperCase();
    return [i.setCode || i.setName, i.number].filter(Boolean).join(" · ");
  };

  // ------------------------------------------------------------------ Session-Dock (Karten- & Aktionsbereich unter der Kamera)
  const segBtn = (on) => `text-[10px] font-black px-2 py-1.5 rounded-lg ${on ? "bg-yellow-400 text-slate-950" : "text-slate-300"}`;
  /** Schnell-Umschalter Variante + Sprache: gelten für die zuletzt gescannte Karte UND als Vorgabe für die nächsten Scans */
  function dockToggles(it) {
    const fin = it?.finish || sw.prefs.finish, lang = it?.lang || sw.prefs.lang;
    return `<div role="group" aria-label="Variante" class="flex bg-slate-800/80 rounded-xl p-0.5 shrink-0">${FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('dockFinish', '${f}')" aria-pressed="${fin === f}" title="${esc(FINISH_LABEL[f])}" class="${segBtn(fin === f)}">${esc(FIN_SHORT[f])}</button>`).join("")}</div>
      <div role="group" aria-label="Sprache" class="flex bg-slate-800/80 rounded-xl p-0.5 shrink-0">${["de", "en", "ja"].map((l) => `<button type="button" onclick="PS.sweep('dockLang', '${l}')" aria-pressed="${lang === l}" title="${LANG_NAME[l]}" class="${segBtn(lang === l)}">${LANG_SHORT[l]}</button>`).join("")}</div>`;
  }

  function renderDock(pop = false) {
    const dock = $("ps-sw-dock");
    if (!dock) return;
    if (sw.drawer) { dock.innerHTML = ""; return; }
    const it = sw.items.find((i) => i.uid === sw.lastUid) || sw.items[0] || null;
    if (!it) {
      dock.innerHTML = `<div class="bg-slate-950 rounded-2xl p-2 border border-white/10 space-y-1.5">
        <p class="text-[11px] text-slate-300 truncate px-1">${sw.running ? esc(MODES[sw.prefs.mode].hint) : "Kamera starten und über deine Karten ziehen."}</p>
        <div class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto">${dockToggles(null)}</div></div>`;
      return;
    }
    const i = it.info;
    const price = priceOf(it);
    const lines = tagLines({ price, filed: Boolean(it.filed), saving: sw.saving.has(it.uid), ownedBefore: Boolean(it.ownedBefore), qty: it.qty, setName: it.setName || i?.setName || "", ownedQty: it.binderQty || 0 });
    const open = sw.prefs.dock;
    const filedCls = it.filed ? "bg-emerald-500 text-slate-950" : sw.saving.has(it.uid) ? "bg-emerald-500/25 text-emerald-100 animate-pulse" : "bg-slate-800 text-slate-200";
    dock.innerHTML = `<div data-sw-last="${esc(it.uid)}" class="${pop ? "ps-sw-pop " : ""}bg-slate-950 rounded-2xl p-2 border border-emerald-400/50 shadow-2xl space-y-1.5">
      <div class="flex items-center gap-2">
        <img src="${esc(cdn(i?.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="${open ? "w-10 h-14" : "w-7 h-10"} object-contain rounded bg-slate-900 shrink-0" />
        <div class="min-w-0 flex-1">
          <p data-sw-name class="text-sm font-black text-white leading-tight truncate">${FLAG[it.lang] || ""} ${esc(itemName(it))}${it.qty > 1 ? ` <span class="text-emerald-300">×${it.qty}</span>` : ""}</p>
          <p class="text-[11px] text-slate-400 truncate">${esc(itemSet(it))}${it.finish !== "normal" ? ` · ${esc(FIN_SHORT[it.finish])}` : ""} · <span data-sw-price class="font-black text-emerald-400" title="Cardmarket-Trend">${price ? eur(price) : i ? "–" : "…"}</span>${lines.flag ? ` · ${esc(lines.flag)}` : ""}</p>
        </div>
        <button type="button" onclick="PS.sweep('plus')" class="ps-sw-plus shrink-0 bg-gradient-to-br from-emerald-400 to-cyan-400 text-slate-950 text-xl font-black px-3 rounded-2xl shadow-lg" aria-label="Noch ein weiteres Exemplar dieser Karte hinzufügen (+1)" title="Weiteres gleiches Exemplar hinzufügen">+1</button>
        <button type="button" onclick="PS.sweep('undo')" class="shrink-0 bg-slate-800 text-white text-[10px] font-black w-12 h-12 rounded-xl leading-tight" aria-label="Rückgängig: letzten Scan und den automatischen Ordner-Eintrag zurücknehmen" title="Rückgängig (entfernt auch den Ordner-Eintrag)">↶<br>Rückg.</button>
        <button type="button" onclick="PS.sweep('dock')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black w-8 h-12 rounded-xl" aria-expanded="${open}" aria-label="${open ? "Dock einklappen" : "Dock ausklappen"}">${open ? "⌄" : "⌃"}</button>
      </div>
      <p data-sw-filed class="text-[12px] font-black ${filedCls} rounded-xl px-2.5 py-1.5 truncate" role="status">${esc(lines.status)}</p>
      ${sellButtons(it)}
      ${open ? `<div class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto">${dockToggles(it)}</div>` : ""}
    </div>`;
  }

  /**
   * Zwei große 1-Klick-Verkaufsbuttons direkt am Scan-Ergebnis. Nach dem Antippen: „✅ Live auf dem Marktplatz!“ –
   * die Kamera scannt währenddessen weiter.
   */
  function sellButtons(it) {
    const l = it.listed || null;
    const btn = (mode, label, cls) => {
      const mine = l && l.mode === mode;
      const text = mine && l.state === "busy" ? "⏳ Stelle ein …" : mine && l.state === "live" ? "✅ Live auf dem Marktplatz!" : label;
      const dis = l && (l.state === "busy" || l.state === "live");
      return `<button type="button" data-sw-sell="${mode}" onclick="PS.sweep('${mode === "deal" ? "oneTapDeal" : "oneTap"}', ${jsArg(it.uid)})" ${dis ? "disabled" : ""}
        class="min-h-[3rem] rounded-xl px-2 py-2 text-[12px] leading-tight font-black shadow-lg touch-manipulation ${mine && l.state === "live" ? "bg-emerald-500 text-slate-950" : cls} ${dis && !mine ? "opacity-40" : ""}"
        ${mine && l.state === "live" && l.price ? `title="Live für ${esc(eur(l.price))}"` : ""}>${esc(text)}${mine && l.state === "live" && l.price ? `<span class="block text-[10px] font-bold opacity-80">${esc(eur(l.price))}</span>` : ""}</button>`;
    };
    return `<div class="grid grid-cols-2 gap-1.5">
      ${btn("cm", "🏷️ 1-Klick Inserieren (CM-Preis)", "bg-yellow-400 text-slate-950")}
      ${btn("deal", "⚡ Schnell-Inserieren (Deal unter CM)", "bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950")}
    </div>`;
  }

  function renderDrawer() {
    const d = $("ps-sw-drawer");
    if (!d) return;
    d.classList.toggle("hidden", !sw.drawer);
    if (!sw.drawer) { d.innerHTML = ""; return; }
    const t = sessionTotals(sw.items, priceOf);
    const dupes = sessionDuplicates(sw.items, ownedBefore).reduce((s, x) => s + x.extra, 0);
    const open = sw.items.reduce((s, i) => s + Math.max(0, i.qty - (i.filed || 0)), 0);
    d.innerHTML = `<div class="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-white/10">
        <div class="min-w-0 flex-1"><p class="text-sm font-black text-white">🗂️ Scan-Session</p><p class="text-[11px] text-slate-400 truncate">${t.count} Karten · ${t.distinct} verschiedene · ${eur(t.value)}</p><p class="text-[10px] text-slate-500 truncate">${esc(dailyLabel(sw.daily))}</p></div>
        <button type="button" onclick="PS.sweep('drawer')" class="w-9 h-9 rounded-full bg-slate-800 text-white" aria-label="Liste schließen">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        ${sw.items.length ? sw.items.map((it) => {
          const p = priceOf(it);
          return `<div class="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1.5">
            <img src="${esc(cdn(it.info?.image || FALLBACK_IMG, 80))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" class="w-8 h-11 object-contain shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-[12px] font-black text-white truncate">${FLAG[it.lang] || ""} ${esc(itemName(it))}</p>
              <p class="text-[10px] text-slate-400 truncate">${esc(itemSet(it))} · ${p ? eur(p) : "–"}${it.filed ? ` · <span class="text-emerald-300">✅ ${Math.min(it.filed, it.qty)}× im Binder</span>` : ""}</p>
              <div class="flex gap-1 mt-1">${FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('itemFinish', ${jsArg(it.uid)}, '${f}')" aria-pressed="${it.finish === f}" class="text-[9px] font-black px-1.5 py-0.5 rounded ${it.finish === f ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-300"}">${esc(FIN_SHORT[f])}</button>`).join("")}
                <button type="button" onclick="PS.sweep('list', ${jsArg(it.uid)})" class="ml-auto text-[9px] font-black px-1.5 py-0.5 rounded bg-yellow-400/90 text-slate-950">🏷️ Inserieren</button></div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="PS.sweep('qty', ${jsArg(it.uid)}, -1)" class="w-7 h-7 rounded-lg bg-slate-800 text-white font-black" aria-label="Eins weniger">−</button>
              <span class="w-6 text-center text-xs font-black text-white">${it.qty}</span>
              <button type="button" onclick="PS.sweep('qty', ${jsArg(it.uid)}, 1)" class="w-7 h-7 rounded-lg bg-slate-800 text-white font-black" aria-label="Eins mehr">+</button>
            </div>
          </div>`;
        }).join("") : `<p class="text-xs text-slate-400 text-center py-6">Noch nichts gescannt.</p>`}
      </div>
      <div class="p-2 grid grid-cols-2 gap-1.5 border-t border-white/10">
        <button type="button" onclick="PS.sweep('file')" ${open ? "" : "disabled"} class="col-span-2 bg-emerald-500 text-slate-950 text-xs font-black py-3 rounded-xl disabled:opacity-40">📒 In Set-Binder einsortieren${open ? ` (${open})` : sw.items.length ? " · alles einsortiert ✓" : ""}</button>
        <button type="button" onclick="PS.sweep('sellAll')" ${t.count ? "" : "disabled"} class="col-span-2 bg-gradient-to-r from-yellow-300 to-amber-400 text-slate-950 text-xs font-black py-3 rounded-xl disabled:opacity-40">🏷️ Direkt auf Marktplatz inserieren${t.count ? ` (${Math.min(t.count, MAX_LIST)})` : ""}</button>
        <button type="button" onclick="PS.sweep('sellDupes')" ${dupes ? "" : "disabled"} class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">Nur Doppelte inserieren${dupes ? ` (${dupes})` : ""}</button>
        <button type="button" onclick="PS.sweep('clear')" ${sw.items.length ? "" : "disabled"} class="bg-slate-800 text-slate-200 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">🗑️ Session leeren</button>
        <button type="button" onclick="PS.sweep('autoFile')" aria-pressed="${sw.prefs.autoFile}" class="col-span-2 text-[10px] font-bold text-slate-400 py-1" title="Jeden Treffer sofort im Hintergrund in den Set-Binder legen">${sw.prefs.autoFile ? "✅ Treffer werden sofort automatisch einsortiert – antippen zum Abschalten" : "⏸️ Automatisches Einsortieren ist aus – antippen zum Einschalten"}</button>
      </div>`;
  }

  function renderAll(pop = false) { renderTop(); renderDock(pop); renderDrawer(); renderView(); setStatus(statusLine()); }

  // ------------------------------------------------------------------ Kamera
  async function openCamera() {
    const tries = [
      { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
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

  /** Dauer-Autofokus (scharf auch in Bewegung), Dauer-Belichtung und -Weißabgleich – soweit die Kamera sie kann. */
  async function tuneTrack(track) {
    const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() || {} : {};
    sw.caps = caps;
    const has = (k, v) => Array.isArray(caps[k]) && caps[k].includes(v);
    for (const c of [
      has("focusMode", "continuous") || !caps.focusMode ? { focusMode: "continuous" } : null,
      has("exposureMode", "continuous") ? { exposureMode: "continuous" } : null,
      has("whiteBalanceMode", "continuous") ? { whiteBalanceMode: "continuous" } : null,
    ].filter(Boolean)) {
      try { await track.applyConstraints({ advanced: [c] }); } catch {}
    }
  }

  const panelVisible = () => { const p = $("ps-sw"); return Boolean(p && p.offsetParent !== null); };

  async function start() {
    if (deps.isStage) return;
    unlockAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("📷 Keine Kamera verfügbar", "Dein Browser erlaubt hier keinen Kamerazugriff. Nutze den Foto-Upload (🖼️).");
      return;
    }
    if (sw.running || sw.starting) return;
    deps.beforeStart?.();
    sw.starting = true;
    const gen = ++sw.camGen;
    deps.ensureIndex();
    sendConfig();
    let stream;
    try { stream = await openCamera(); } catch (e) {
      sw.starting = false;
      if (gen !== sw.camGen) return;
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      toast(denied ? "📷 Kamera nicht erlaubt" : "📷 Kamera nicht verfügbar", denied ? "Erlaube den Kamerazugriff in den Browser-Einstellungen – oder lade ein Foto hoch (🖼️)." : "Keine passende Kamera gefunden. Lade ein Foto hoch (🖼️).");
      return;
    }
    sw.starting = false;
    if (gen !== sw.camGen || document.hidden || !panelVisible()) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} return; }
    sw.stream = stream;
    sw.track = stream.getVideoTracks()[0];
    await tuneTrack(sw.track);
    const video = $("ps-sw-video");
    video.srcObject = stream;
    try { await video.play(); } catch {}
    video.classList.remove("hidden");
    $("ps-sw-idle")?.classList.add("hidden");
    $("ps-sw-stop")?.classList.remove("hidden");
    sw.running = true; sw.torch = false; sw.dark = 0; sw.frameTimes = []; sw.inFlight = 0; sw.tags = [];
    sw.gate.reset(); resetBinder(); sw.verify = null; sw.wantCrop = false; sw.standby = "";
    sw.eff = sw.prefs.mode === "binder" ? "binder" : "turbo"; sw.top = 0; sw.glareFrames = 0; sw.glareWarned = false;
    deps.worker().postMessage({ type: "sweep-reset" });
    renderToggles(); renderAll();
    loop();
  }

  function stop() {
    sw.running = false;
    sw.camGen++;
    sw.starting = false;
    cancelAnimationFrame(sw.raf); cancelAnimationFrame(sw.tagRaf);
    try { sw.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    sw.stream = null; sw.track = null; sw.torch = false; sw.inFlight = 0;
    const video = $("ps-sw-video");
    if (video) { video.srcObject = null; video.classList.add("hidden"); }
    $("ps-sw-idle")?.classList.remove("hidden");
    $("ps-sw-stop")?.classList.add("hidden");
    if (sw.full) toggleFull(false);
    sw.tags = []; resetBinder(); drawOverlay();
    renderToggles(); renderAll();
  }

  /** Ordner-Zustand leeren (Slot-Sperren, grüne Haken, Raster) */
  function resetBinder() {
    sw.slotGate.reset(); sw.slotTags.clear(); sw.slotSeen.clear(); sw.grid = null; sw.cells = [];
  }

  async function toggleTorch(on = !sw.torch, manual = true) {
    if (manual) sw.torchTouched = true;
    if (!sw.track) { toast("🔦 Kamera starten", "Die Taschenlampe lässt sich nutzen, sobald die Kamera läuft."); return; }
    try {
      await sw.track.applyConstraints({ advanced: [{ torch: on }] });
      sw.torch = on; sw.glareFrames = 0; sw.glareWarned = false;
      $("ps-sw-torch")?.classList.remove("animate-pulse");
    } catch {
      if (manual) toast("🔦 Nicht möglich", "Diese Kamera bzw. dieser Browser unterstützt keine Taschenlampe (z. B. Safari auf dem iPhone). Tipp: Karten näher ans Licht halten.");
    }
    renderToggles();
  }

  function toggleFull(on = !sw.full) {
    sw.full = on;
    $("ps-sw")?.classList.toggle("ps-sw-full", on);
    document.documentElement.style.overflow = on ? "hidden" : "";
    renderToggles();
    requestAnimationFrame(drawOverlay);
  }

  /** Sichtbarer Videoausschnitt (object-fit: cover) → genau dieser Bereich wird analysiert. */
  function geometry(video) {
    const stage = $("ps-sw-cam");
    const ew = stage?.clientWidth || 1, eh = stage?.clientHeight || 1, vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const s = Math.max(ew / vw, eh / vh);
    const cw = Math.min(vw, ew / s), ch = Math.min(vh, eh / s);
    const W = Math.round(Math.min(SWEEP.FRAME_W, cw)), H = Math.round((ch * W) / cw);
    return { sx: (vw - cw) / 2, sy: (vh - ch) / 2, sw: cw, sh: ch, W, H };
  }

  function send(video) {
    const g = geometry(video);
    if (!g || g.W < 40 || g.H < 40) return;
    const now = performance.now();
    const seq = ++sw.seq;
    sw.inFlight = now; sw.sentAt = now;
    const w = deps.worker();
    const useBitmap = sw.bitmapOk && deps.index().offscreen;
    const lost = () => { sw.bitmapOk = false; sw.inFlight = 0; };
    if (isBinder()) {
      // Ordner-Seite: natives HD-Bild an den Worker – er schneidet jedes Fach hochauflösend aus (kein Herunterskalieren auf 320 px).
      // Schon gesperrte Fächer (skip) wertet er nicht mehr aus.
      // Reihum bleibt EIN gesperrtes Fach in der Auswertung (je zwei Bilder lang): zeigt es eine andere Karte, wurde umgeblättert.
      const lockedSlots = [...sw.slotGate.locked.keys()].sort((a, b) => a - b);
      const verify = lockedSlots.length ? lockedSlots[Math.floor(sw.seq / 2) % lockedSlots.length] : -1;
      const extra = { mode: "binder", grid: sw.prefs.grid, skip: lockedSlots.filter((x) => x !== verify) };
      const sx = Math.round(g.sx), sy = Math.round(g.sy), cw = Math.max(2, Math.floor(g.sw)), ch = Math.max(2, Math.floor(g.sh));
      if (useBitmap) {
        const W = Math.min(HD.BINDER_FRAME_W, cw), H = Math.round((ch * W) / cw);
        (W < cw ? createImageBitmap(video, sx, sy, cw, ch, { resizeWidth: W, resizeHeight: H, resizeQuality: "medium" }) : createImageBitmap(video, sx, sy, cw, ch))
          .then((bmp) => { if (!sw.running || seq !== sw.seq) { bmp.close?.(); sw.inFlight = 0; return; } w.postMessage({ type: "sweep-frame", seq, bitmap: bmp, w: bmp.width, h: bmp.height, ...extra }, [bmp]); })
          .catch(lost);
        return;
      }
      const W = Math.min(HD.BINDER_FALLBACK_W, cw), H = Math.round((ch * W) / cw);
      if (!sw.cv) { sw.cv = document.createElement("canvas"); sw.ctx = sw.cv.getContext("2d", { willReadFrequently: true }); }
      if (sw.cv.width !== W || sw.cv.height !== H) { sw.cv.width = W; sw.cv.height = H; }
      sw.ctx.drawImage(video, sx, sy, cw, ch, 0, 0, W, H);
      const img = sw.ctx.getImageData(0, 0, W, H);
      w.postMessage({ type: "sweep-frame", seq, data: img.data.buffer, w: W, h: H, ...extra }, [img.data.buffer]);
      return;
    }
    // Stapel / Einzelkarte (Standard): offenes Kamerabild, Präsenz-Gate + Begradigung im Worker. crop = begradigtes
    // Standardbild (300 × 420) für den Name+Nummer-/Vision-Rückfall mitschicken lassen
    const extra = { mode: "turbo", crop: sw.wantCrop };
    sw.wantCrop = false;
    // Bevorzugt: ImageBitmap an den Worker übergeben – Verkleinern und Pixel-Auslesen passieren dort, nicht im UI-Thread
    if (useBitmap) {
      createImageBitmap(video, g.sx, g.sy, g.sw, g.sh, { resizeWidth: g.W, resizeHeight: g.H, resizeQuality: "low" })
        .then((bmp) => { if (!sw.running || seq !== sw.seq) { bmp.close?.(); sw.inFlight = 0; return; } w.postMessage({ type: "sweep-frame", seq, bitmap: bmp, w: g.W, h: g.H, ...extra }, [bmp]); })
        .catch(lost);
      return;
    }
    if (!sw.cv) { sw.cv = document.createElement("canvas"); sw.ctx = sw.cv.getContext("2d", { willReadFrequently: true }); }
    if (sw.cv.width !== g.W || sw.cv.height !== g.H) { sw.cv.width = g.W; sw.cv.height = g.H; }
    sw.ctx.drawImage(video, g.sx, g.sy, g.sw, g.sh, 0, 0, g.W, g.H);
    const img = sw.ctx.getImageData(0, 0, g.W, g.H);
    w.postMessage({ type: "sweep-frame", seq, data: img.data.buffer, w: g.W, h: g.H, ...extra }, [img.data.buffer]);
  }

  /** Ein Dialog liegt über dem Scanner (Schnell-Inserieren, Login …) → keine Treffer dahinter */
  const overlayOpen = () => Boolean(document.querySelector("body > div.fixed.inset-0:not(.hidden)[id]"));

  /**
   * Kamera-Schleife: läuft per requestVideoFrameCallback/requestAnimationFrame IMMER weiter – Speichern, Preisladen und
   * Oberfläche passieren asynchron daneben. Das „Bild unterwegs“-Flag (inFlight) wird in onResult für JEDE Antwort
   * (Treffer, verworfen, Fehler, veraltet) zurückgesetzt und läuft spätestens nach FRAME_STALE_MS von selbst ab.
   */
  function loop() {
    if (!sw.running) return;
    if (document.hidden || !panelVisible()) { stop(); return; }
    const video = $("ps-sw-video");
    const now = performance.now();
    if (sw.inFlight && now - sw.inFlight > FRAME_STALE_MS) sw.inFlight = 0;
    if (deps.index().ready && !sw.inFlight && !sw.drawer && !overlayOpen() && video.readyState >= 2 && now - sw.sentAt >= SWEEP.MIN_FRAME_MS) send(video);
    if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => loop());
    else sw.raf = requestAnimationFrame(() => loop());
  }

  // ------------------------------------------------------------------ Ergebnisse
  function onResult(m) {
    // Nur die Antwort auf das zuletzt gesendete Bild zählt – der Kanal wird für JEDE Antwort darauf freigegeben
    // (Treffer, verworfen, Fehler); eine veraltete Antwort darf den Kanal eines neueren Bilds nicht anfassen
    if (m.seq !== sw.seq) return;
    sw.inFlight = 0;
    if (!sw.running || m.skipped || m.error) return;
    try {
      const now = performance.now();
      sw.frameTimes.push(now);
      if (sw.frameTimes.length > 20) sw.frameTimes.shift();
      sw.procMs = sw.procMs ? sw.procMs * 0.85 + (m.ms || 0) * 0.15 : m.ms || 0;
      const interval = sw.frameTimes.length > 1 ? (sw.frameTimes[sw.frameTimes.length - 1] - sw.frameTimes[0]) / (sw.frameTimes.length - 1) : 0;
      checkDark(m.light);
      checkGlare(m.glare);
      if (m.mode === "binder") onBinderResult(m);
      else onStackResult(m, interval);
      drawOverlay();
      setStatus(statusLine());
    } catch (e) {
      // Ein Fehler in der Anzeige darf die Kamera-Schleife nie anhalten
      try { console.warn("sweep onResult", e); } catch {}
    }
  }

  /**
   * Stapel / Einzelkarte: Präsenz-Gate (Standby), Treffer-Entscheidung und physische Karten-Sperre im Gate. Nach einem
   * Treffer ist der Auslöser eingefroren, bis die Karte weg bzw. ausgetauscht ist – kein zweiter Name über derselben Karte.
   */
  function onStackResult(m, interval) {
    const dets = Array.isArray(m.dets) ? m.dets : [];
    sw.standby = m.card === false ? m.standby || "none" : "";
    sw.top = sw.standby ? 0 : Number(m.top) || dets.reduce((x, d) => Math.max(x, Number(d.match) || 0), 0);
    const g = sw.gate.push({ dets, card: m.card !== false, found: m.found, motion: m.motion, center: m.center, changed: m.changed, thumb: m.thumb }, Date.now(), interval);
    const { hits } = g;
    sw.gateInfo = { paused: g.paused, blurry: g.blurry && dets.length > 0, frozen: Boolean(g.frozen) };
    // Neue physische Karte → Rückfall (OCR/Vision) darf für sie erneut laufen
    if (g.epoch !== sw.epoch) { sw.epoch = g.epoch; sw.verify = null; sw.wantCrop = false; }
    const t = Date.now();
    // Preisschilder der schon erkannten Karten an die aktuelle Lage anheften
    for (const d of dets) {
      if (!Array.isArray(d.keys) || d.match < SWEEP.TRACK_MATCH) continue;
      const tag = findTag(d.keys, d.quad);
      if (tag) { tag.quad = d.quad; tag.center = quadCenter(d.quad); tag.seen = t; tag.conf = d.conf ?? tag.conf; }
    }
    for (const keys of hits) {
      const d = dets.find((x) => x.keys === keys);
      if (d) onHit(d);
    }
    if (!hits.length && !g.frozen) maybeVerify(dets[0] || null, m, g);
  }

  /**
   * Stufe 3 C – klare, scharfe Karte, lokal aber unsicher (65–81 % bzw. zu knapper Vorsprung): nach FALLBACK_HOLD_MS ruhiger
   * Sicht einmal je physischer Karte das begradigte 300 × 420-Bild holen → Name + Nummer lesen (Text-Index) → sonst Vision.
   * Lieber 0,3 s länger fokussieren als eine falsche Karte einsortieren: ohne sicheres Ergebnis wird nichts gespeichert.
   */
  function maybeVerify(d, m, g) {
    const now = Date.now();
    const unsure = Boolean(d && m.card !== false && !d.verified && Number(d.match) >= SWEEP.FALLBACK_MIN && d.numOk !== false && !g.blurry);
    const v = sw.verify;
    if (!unsure) { if (v && v.state === "watch") sw.verify = null; return; }
    if (!v) { sw.verify = { epoch: sw.epoch, since: now, state: "watch", det: d }; return; }
    v.det = d;
    if (v.state === "watch" && now - v.since >= SWEEP.FALLBACK_HOLD_MS && (deps.readText || deps.vision)) { v.state = "crop"; sw.wantCrop = true; return; }
    if (v.state === "crop" && m.crop?.data) { v.state = "busy"; runVerify(v, m.crop, d); }
  }

  /** Begradigten Ausschnitt als JPEG unter maxBytes (Qualität schrittweise senken). */
  function jpegUnder(cv, maxBytes) {
    let url = "";
    for (const q of [0.72, 0.6, 0.5, 0.4, 0.3, 0.22]) {
      url = cv.toDataURL("image/jpeg", q);
      if (Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4) <= maxBytes) return url;
    }
    return url;
  }

  async function runVerify(v, crop, d) {
    let keys = null, label = "", via = "";
    try {
      const cv = document.createElement("canvas");
      cv.width = crop.w; cv.height = crop.h;
      cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(crop.data), crop.w, crop.h), 0, 0);
      const full = [[0, 0], [crop.w, 0], [crop.w, crop.h], [0, crop.h]];
      // A) Name (Titelzeile oben) + Sammlernummer (unten) auf der begradigten Karte lesen → Text-Index (41.962 Datensätze),
      //    bestätigt durch die Bild-Kandidaten dieses Bilds
      if (deps.readText && deps.decideText) {
        const r = await deps.readText(cv, { x: 0, y: 0, w: crop.w, h: crop.h, quad: full }, 1500);
        if (r?.text?.trim() && stillSame(v)) {
          const t = await deps.decideText(r.text, Array.isArray(d.cands) ? d.cands : []);
          if (t?.accepted && t.strength === "strong" && t.keys?.length) { keys = t.keys; label = t.label || ""; via = "text"; }
        }
      }
      // C) Vision-Rückfall (einmal je physischer Karte, nur der begradigte Ausschnitt < 25 KB)
      if (!keys && deps.vision && stillSame(v)) {
        const r = await deps.vision(jpegUnder(cv, VISION_MAX_BYTES));
        const top = r?.clear ? r.items?.[0] : null;
        if (top?.key) { keys = [top.key]; label = top.name ? `${top.name}${top.number ? ` ${top.number}` : ""}` : ""; via = "vision"; }
      }
    } catch (e) {
      try { console.warn("sweep verify", e); } catch {}
    }
    if (!stillSame(v)) return;
    v.state = "done";
    if (keys && sw.gate.external(keys, Date.now())) onHit({ ...d, keys, label: label || d.label, via, conf: 100 });
    setStatus(statusLine());
  }
  /** Liegt noch dieselbe physische Karte im Bild (keine neue Epoche, Scanner läuft, Stapel-Modus)? */
  const stillSame = (v) => sw.running && !isBinder() && sw.verify === v && v.epoch === sw.epoch;

  /** Ordner-Seite: jedes Fach hat seine eigene Positions-Sperre – einmal erkannt, bis zum Umblättern nie wieder gezählt */
  function onBinderResult(m) {
    sw.grid = m.grid || null;
    sw.cells = Array.isArray(m.cells) ? m.cells : [];
    const slots = Array.isArray(m.slots) ? m.slots : [];
    sw.top = slots.reduce((x, d) => Math.max(x, Number(d.match) || 0), 0);
    for (const d of slots) sw.slotSeen.set(d.slot, d);
    const r = sw.slotGate.push({ slots, changed: m.changed }, Date.now());
    if (r.flipped) {
      // Umgeblättert (> 65 % der Bildfläche neu): alle Fach-Sperren und Haken sind weg, die nächste Seite zählt sofort
      sw.slotTags.clear(); sw.slotSeen.clear(); sw.flipAt = Date.now();
      setStatus(statusLine());
    }
    for (const h of r.hits) {
      const d = slots.find((x) => x.slot === h.slot) || sw.slotSeen.get(h.slot) || { slot: h.slot, keys: h.keys, label: "" };
      onHit({ ...d, keys: h.keys }, h.slot);
    }
    // Still wieder gesperrte Fächer (dieselbe Seite nach kurzem Wegschwenken): Haken zeigen, ohne neu zu zählen
    for (const [slot, keys] of sw.slotGate.locked) {
      if (sw.slotTags.has(slot)) continue;
      const key = orderByLang(keys, sw.prefs.lang)[0];
      const it = sw.items.find((i) => keys.includes(i.key));
      sw.slotTags.set(slot, { keys, key: it?.key || key, uid: it?.uid || null, at: Date.now() });
    }
    if (r.hits.length || r.flipped) renderView();
  }

  /** Preisschild desselben Exemplars (an ähnlicher Position – zwei Exemplare im Bild bekommen zwei Etiketten) */
  function findTag(keys, quad) {
    const c = quadCenter(quad);
    let best = null, bestD = Infinity;
    for (const tag of sw.tags) {
      if (!tag.keys.some((k) => keys.includes(k))) continue;
      if (!c || !tag.center) return tag;
      const d = Math.hypot(c[0] - tag.center[0], c[1] - tag.center[1]);
      if (d < SWEEP.SAME_POS && d < bestD) { best = tag; bestD = d; }
    }
    return best;
  }

  /** Treffer verbuchen. slot = Fach der Ordnerseite (sonst Stapel/Einzelkarte). */
  function onHit(d, slot = null) {
    const keys = orderByLang(d.keys, sw.prefs.lang);
    const key = keys[0];
    const wasOwned = ownedBefore(key);
    const r = sessionAdd(sw.items, { key, finish: sw.prefs.finish, lang: langOfKey(key), label: d.label, info: sw.info.get(key) || null }, ++sw.uidSeq);
    sw.items = r.items.slice(0, MAX_ITEMS).map((it) => (it.uid === r.uid ? { ...it, ownedBefore: it.ownedBefore === undefined ? wasOwned : it.ownedBefore, alts: keys } : it));
    sw.history.push(r.uid);
    sw.lastUid = r.uid;
    if (d.probe) sw.probes.set(key, d.probe);
    const now = Date.now();
    if (slot !== null) sw.slotTags.set(slot, { keys: [...d.keys], key, uid: r.uid, at: now });
    else {
      const existing = findTag(d.keys, d.quad);
      const tag = existing || { keys: [...d.keys], key, uid: r.uid, at: now };
      Object.assign(tag, { quad: d.quad, center: quadCenter(d.quad), seen: now, at: now, uid: r.uid, key, conf: d.conf ?? null });
      if (!existing) sw.tags.push(tag);
      if (sw.tags.length > SWEEP.MAX_CARDS + 3) sw.tags.splice(0, sw.tags.length - (SWEEP.MAX_CARDS + 3));
    }
    // Tages-Zähler: Anzahl sofort, Wert sobald der Preis bekannt ist
    const p = priceOfKey(key);
    sw.daily = bumpDaily(sw.daily, { count: 1, value: p });
    if (!p) sw.items = sw.items.map((it) => (it.uid === r.uid ? { ...it, dailyPending: (it.dailyPending || 0) + 1 } : it));
    saveDaily();
    feedback();
    renderTop(); renderDock(true); renderDrawer(); renderView();
    saveSession();
    animateTags();
    // Sofort in den Set-Binder (asynchron, die Kamera-Schleife wartet nie darauf) – abschaltbar im Session-Drawer
    if (sw.prefs.autoFile) autoFile(r.uid, key);
    // Name ist schon da (Index auf dem Gerät); Cardmarket-Preis & Bild laden im Hintergrund nach
    loadInfo([key, ...keys.slice(1, 3)]);
  }

  /** Speichern/Zurücknehmen je Session-Eintrag strikt nacheinander (ein „Rückgängig“ wartet auf ein laufendes Speichern). */
  function queue(uid, job) {
    const prev = sw.chains.get(uid) || Promise.resolve();
    const next = prev.then(job, job).catch(() => {}).finally(() => { if (sw.chains.get(uid) === next) sw.chains.delete(uid); });
    sw.chains.set(uid, next);
    return next;
  }
  const savingAdd = (uid) => sw.saving.set(uid, (sw.saving.get(uid) || 0) + 1);
  const savingDone = (uid) => { const n = (sw.saving.get(uid) || 1) - 1; if (n > 0) sw.saving.set(uid, n); else sw.saving.delete(uid); };

  /** Kartendaten (Art + ID) für einen Schlüssel sicherstellen */
  async function fullInfo(key) {
    let info = sw.info.get(key);
    if (!info?.kind || info.partial) {
      try { for (const i of await deps.fetchInfo([key])) sw.info.set(i.key, i); } catch {}
      info = sw.info.get(key);
    }
    return info?.kind ? info : null;
  }

  /** Ordner-Eintrag merken (für „Rückgängig“): Server-ID bzw. Gast-Binder */
  function logFiled(uid, res, n = 1) {
    const rec = { id: Number(res?.id) > 0 ? Number(res.id) : null, guest: Boolean(res?.guest) };
    const log = sw.fileLog.get(uid) || [];
    for (let k = 0; k < n; k++) log.push(rec);
    sw.fileLog.set(uid, log.slice(-999));
  }

  /**
   * Automatisches Einsortieren eines Treffers (+1, ohne Klick auf „+“) – Konto: Set-Ordner, Gast: Test-Binder auf dem Gerät.
   * Danach steht unübersehbar auf Preisschild, Dock und Status-Pille „✅ Automatisch im Ordner: [Set-Name] (1×)“ bzw.
   * „✅ Im Ordner gespeichert · Jetzt 2× vorhanden“. Fehler → bleibt „offen“ (Liste → „In Set-Binder einsortieren“).
   */
  function autoFile(uid, key) {
    if (deps.isStage) return;
    savingAdd(uid);
    queue(uid, async () => {
      try {
        const info = await fullInfo(key);
        const it = sw.items.find((i) => i.uid === uid);
        if (!info || !it) return;
        const res = await deps.fileItem(info, { condition: "NM", variant: it.finish || "normal" }, 1);
        if (!res) return;
        logFiled(uid, res);
        const setName = info.setName || info.setCode || setIdOfKey(key).toUpperCase();
        const cur = sw.items.find((i) => i.uid === uid);
        // Anzahl dieser Karte im Ordner nach dem Speichern (Server zählt bei gleicher Karte hoch)
        const ownedQty = Number(res?.quantity) > 0 ? Number(res.quantity) : (cur?.binderQty || 0) + 1;
        sw.items = sw.items.map((x) => (x.uid === uid ? { ...x, filed: Math.min(x.qty, (x.filed || 0) + 1), binderQty: ownedQty, setName, info: x.info?.kind ? x.info : info } : x));
        sw.filedMsg = { text: filedLabel({ setName, ownedQty }), at: Date.now() };
        setStatus(statusLine());
        const probe = sw.probes.get(key);
        if (probe) deps.learn(key, probe);
        saveSession();
        schedulePortfolioRefresh();
      } catch (e) {
        if (e?.status === 401 || e?.status === 403) return;
        try { console.warn("sweep autoFile", e); } catch {}
      } finally {
        savingDone(uid);
        if (sw.lastUid === uid) renderDock();
        if (sw.drawer) renderDrawer();
        drawOverlay();
      }
    });
  }

  /**
   * Ordner an die Session angleichen: liegen von einem Eintrag mehr Exemplare im Set-Ordner als er noch zählt (nach
   * „Rückgängig“ oder „−“), werden die überzähligen automatischen Ordner-Einträge wieder entfernt.
   */
  function unfileExtra(uid, key, finish, quiet = false) {
    if (deps.isStage) return;
    queue(uid, async () => {
      const log = sw.fileLog.get(uid) || [];
      const want = sw.items.find((i) => i.uid === uid)?.qty || 0;
      let removed = 0, left = null;
      const info = sw.info.get(key) || null;
      while (log.length > want) {
        const rec = log[log.length - 1];
        let res = null;
        try { res = await deps.unfileItem(rec, info, { condition: "NM", variant: finish || "normal" }); } catch (e) { if (e?.status !== 404) { handleError(e); break; } res = { quantity: 0 }; }
        if (!res) break;
        log.pop(); removed++;
        left = Number(res.quantity) || 0;
      }
      if (log.length) sw.fileLog.set(uid, log); else sw.fileLog.delete(uid);
      if (!removed) return;
      sw.items = sw.items.map((x) => (x.uid === uid ? { ...x, filed: Math.min(x.qty, log.length), binderQty: left ?? x.binderQty } : x));
      if (!quiet) {
        const setName = info?.setName || setIdOfKey(key).toUpperCase();
        toast("↶ Rückgängig", `Automatischer Eintrag aus dem Ordner${setName ? ` „${setName}“` : ""} entfernt${left ? ` – noch ${left}× vorhanden` : ""}.`);
      }
      saveSession(); schedulePortfolioRefresh();
      renderAll(); drawOverlay();
    });
  }

  function schedulePortfolioRefresh() {
    if (sw.portfolioTimer) return;
    sw.portfolioTimer = setTimeout(() => {
      sw.portfolioTimer = 0;
      try { window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" })); } catch {}
      window.PS?.loadPortfolio?.();
    }, 3000);
  }

  async function loadInfo(keys) {
    const missing = keys.filter((k) => !sw.info.get(k)?.kind);
    if (missing.length) {
      try { for (const i of await deps.fetchInfo(missing)) sw.info.set(i.key, i); } catch {}
    }
    let changed = false, dailyAdd = 0;
    sw.items = sw.items.map((it) => {
      const i = sw.info.get(it.key);
      let next = it;
      if (i?.kind && it.info?.kind !== i.kind) { changed = true; next = { ...it, info: i }; }
      if (next.dailyPending && i?.kind) {
        const p = priceOf(next);
        if (p) { dailyAdd += p * next.dailyPending; next = { ...next, dailyPending: 0 }; changed = true; }
      }
      return next;
    });
    if (dailyAdd) { sw.daily = bumpDaily(sw.daily, { count: 0, value: dailyAdd }); saveDaily(); }
    if (changed) { renderAll(); saveSession(); drawOverlay(); }
  }

  function checkDark(light) {
    if (!Number.isFinite(light)) return;
    sw.dark = light < DARK_LEVEL ? sw.dark + 1 : 0;
    if (sw.dark === DARK_FRAMES && !sw.torch) {
      // Automatisch: einmal je Session einschalten, wenn die Kamera eine Taschenlampe hat und niemand sie angefasst hat
      if (sw.caps?.torch && !sw.torchTouched && !sw.autoTorch) { sw.autoTorch = true; toggleTorch(true, false); toast("🔦 Taschenlampe an", "Es ist recht dunkel – das Licht hilft der Erkennung. Antippen schaltet es wieder aus."); }
      else if (!sw.caps?.torch) setStatus("💡 Recht dunkel – mehr Licht hilft der Erkennung");
      else $("ps-sw-torch")?.classList.add("animate-pulse");
    }
    if (light >= DARK_LEVEL + 15) $("ps-sw-torch")?.classList.remove("animate-pulse");
  }

  /** Taschenlampe an und die LED spiegelt stark auf der Klarsichtfolie → einmal warnen (Lampe aus oder Handy kippen) */
  function checkGlare(glare) {
    if (!sw.torch || !Number.isFinite(glare)) { sw.glareFrames = 0; return; }
    sw.glareFrames = glare >= GLARE_WARN ? sw.glareFrames + 1 : Math.max(0, sw.glareFrames - 1);
    if (sw.glareFrames >= GLARE_WARN_FRAMES && !sw.glareWarned) {
      sw.glareWarned = true;
      $("ps-sw-torch")?.classList.add("animate-pulse");
      toast("🔦 LED blendet auf der Folie", isBinder() ? "Die Taschenlampe spiegelt stark in der Ordner-Folie. Lampe ausschalten (🔦) oder das Handy leicht kippen – dann werden die Fächer sicherer erkannt." : "Die Taschenlampe spiegelt stark auf der Karte/Hülle. Lampe ausschalten (🔦) oder das Handy leicht kippen.");
    }
  }

  // ------------------------------------------------------------------ Live-Preisschild-Etiketten (Canvas-Overlay, kein Rahmen)
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function fitText(ctx, text, max) {
    let t = String(text || "");
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  }

  /** Ein Etikett wie ein echtes Händler-Preisschild: Preis groß, Name, Set-Kürzel + Nummer, Status-Badge. */
  function drawTag(ctx, tag, W, H, dpr, now) {
    const age = now - tag.seen;
    const alpha = age <= TAG_HOLD_MS ? 1 : Math.max(0, 1 - (age - TAG_HOLD_MS) / TAG_FADE_MS);
    if (alpha <= 0) return false;
    const pts = tag.quad.map(([x, y]) => [x * W, y * H]);
    const c = quadCenter(pts) || [W / 2, H / 2];
    const cardW = (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) + Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1])) / 2;
    const cardH = (Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]) + Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])) / 2;
    const it = sw.items.find((i) => i.uid === tag.uid);
    const info = sw.info.get(tag.key) || it?.info || null;
    const price = it ? priceOf(it) : priceOfKey(tag.key);
    const name = info ? (info.lang === "ja" && info.altName ? info.altName : info.name) : (it?.label || "Karte").replace(/\s\d+\/\d+$/, "");
    const code = tagCode(info, tag.key);
    const lines = tagLines({ price, filed: Boolean(it?.filed), saving: sw.saving.has(tag.uid), ownedBefore: Boolean(it?.ownedBefore), qty: it?.qty || 1, setName: it?.setName || info?.setName || "", ownedQty: it?.binderQty || 0 });
    const s = Math.max(0.78, Math.min(1.3, cardW / (230 * dpr))) * dpr;
    const pop = Math.min(1, (now - tag.at) / 180);
    const scale = 0.86 + 0.14 * (1 - Math.pow(1 - pop, 3));
    const tw = Math.max(126 * s, Math.min(cardW * 0.94, 236 * s));
    const padX = 10 * s, lineGap = 3 * s;
    const fPrice = 23 * s, fName = 11.5 * s, fCode = 10 * s, fBadge = 9.5 * s;
    const th = 8 * s + fPrice + lineGap + fName + lineGap + fCode + 6 * s + fBadge + 8 * s + 8 * s + (lines.flag ? fBadge + 6 * s : 0);
    const x = Math.max(4 * dpr, Math.min(W - tw - 4 * dpr, c[0] - tw / 2));
    const y = Math.max(4 * dpr, Math.min(H - th - 4 * dpr, c[1] + cardH * 0.04 - th / 2));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + tw / 2, y + th / 2); ctx.scale(scale, scale); ctx.translate(-(x + tw / 2), -(y + th / 2));
    // Feiner Faden vom Etikett zur Kartenoberkante
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath(); ctx.moveTo(x + 14 * s, y); ctx.lineTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2); ctx.stroke();
    // Etikett-Körper
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 18 * dpr; ctx.shadowOffsetY = 6 * dpr;
    const grad = ctx.createLinearGradient(x, y, x, y + th);
    grad.addColorStop(0, "#fffbeb"); grad.addColorStop(1, "#fde68a");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, tw, th, 9 * s); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = "rgba(120,53,15,.45)"; ctx.stroke();
    // Öse
    ctx.beginPath(); ctx.arc(x + 14 * s, y + 10 * s, 3.2 * s, 0, Math.PI * 2); ctx.fillStyle = "#1c1917"; ctx.fill();
    ctx.beginPath(); ctx.arc(x + 14 * s, y + 10 * s, 1.6 * s, 0, Math.PI * 2); ctx.fillStyle = "#fffbeb"; ctx.fill();
    // Preis
    let ty = y + 8 * s + fPrice;
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillStyle = price ? "#052e16" : "#57534e";
    ctx.font = `900 ${fPrice}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(price ? eur(price) : info ? "– €" : "… €", x + padX + 14 * s, ty);
    // Konfidenz (Sweep-Modus) rechts oben klein
    if (tag.conf && tag.conf >= 99) {
      ctx.font = `800 ${8.5 * s}px system-ui, sans-serif`; ctx.textAlign = "right"; ctx.fillStyle = "#166534";
      ctx.fillText(`✓ ${tag.conf} %`, x + tw - padX, y + 9 * s + 8.5 * s * 0.4); ctx.textAlign = "left";
    }
    // Name
    ty += lineGap + fName;
    ctx.font = `800 ${fName}px system-ui, sans-serif`; ctx.fillStyle = "#1c1917";
    ctx.fillText(fitText(ctx, name, tw - 2 * padX), x + padX, ty);
    // Set-Kürzel + Nummer
    ty += lineGap + fCode;
    ctx.font = `700 ${fCode}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.fillStyle = "#44403c";
    ctx.fillText(fitText(ctx, [info?.setName, code].filter(Boolean).join(" · ") || "Cardmarket-Trend", tw - 2 * padX), x + padX, ty);
    // Status-Badge
    ty += 6 * s;
    const badge = (text, bg, fg) => {
      ctx.font = `900 ${fBadge}px system-ui, sans-serif`;
      const bw = Math.min(tw - 2 * padX, ctx.measureText(text).width + 12 * s), bh = fBadge + 8 * s;
      ctx.fillStyle = bg; roundRect(ctx, x + padX, ty, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = fg; ctx.fillText(fitText(ctx, text, bw - 10 * s), x + padX + 6 * s, ty + bh - 6 * s);
      ty += bh + 4 * s;
    };
    badge(lines.status, it?.filed ? "#059669" : "#1e293b", it?.filed ? "#ecfdf5" : "#e2e8f0");
    if (lines.flag) badge(lines.flag, lines.hot ? "#ea580c" : "#0ea5e9", "#fff7ed");
    ctx.restore();
    return true;
  }

  /** Dezentes Binder-Raster (passt sich der Ordnerseite an) + je erkanntem Fach: grüner Haken, Kartenname, Cardmarket-Preis */
  function drawBinder(ctx, W, H, dpr, now) {
    const g = sw.grid;
    if (!g) return;
    const x0 = g.x0 * W, y0 = g.y0 * H, gw = (g.x1 - g.x0) * W, gh = (g.y1 - g.y0) * H;
    ctx.save();
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = g.fitted ? "rgba(255,255,255,.42)" : "rgba(255,255,255,.22)";
    ctx.setLineDash(g.fitted ? [] : [6 * dpr, 6 * dpr]);
    roundRect(ctx, x0, y0, gw, gh, 10 * dpr); ctx.stroke();
    ctx.beginPath();
    for (let c = 1; c < g.cols; c++) { ctx.moveTo(x0 + (gw * c) / g.cols, y0); ctx.lineTo(x0 + (gw * c) / g.cols, y0 + gh); }
    for (let r = 1; r < g.rows; r++) { ctx.moveTo(x0, y0 + (gh * r) / g.rows); ctx.lineTo(x0 + gw, y0 + (gh * r) / g.rows); }
    ctx.stroke();
    ctx.restore();
    for (const cell of sw.cells) {
      const tag = sw.slotTags.get(cell.slot);
      if (!tag) continue;
      const q = cell.quad.map(([x, y]) => [x * W, y * H]);
      const cx0 = q[0][0], cy0 = q[0][1], cw = q[1][0] - q[0][0], ch = q[3][1] - q[0][1];
      const it = sw.items.find((i) => i.uid === tag.uid) || sw.items.find((i) => tag.keys.includes(i.key));
      const info = sw.info.get(tag.key) || it?.info || null;
      const price = it ? priceOf(it) : priceOfKey(tag.key);
      const name = info ? (info.lang === "ja" && info.altName ? info.altName : info.name) : (it?.label || "Karte").replace(/\s\d+\/\d+$/, "");
      const pop = Math.min(1, (now - tag.at) / 200);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * pop;
      // Grüner Schleier + Rand: dieses Fach ist gezählt und gesperrt
      ctx.fillStyle = "rgba(16,185,129,.16)"; ctx.strokeStyle = "rgba(52,211,153,.95)"; ctx.lineWidth = 2 * dpr;
      roundRect(ctx, cx0, cy0, cw, ch, 6 * dpr); ctx.fill(); ctx.stroke();
      // Grüner Haken oben links
      const rr = Math.max(9 * dpr, Math.min(cw * 0.13, 16 * dpr)) * (0.7 + 0.3 * pop);
      ctx.beginPath(); ctx.arc(cx0 + rr + 3 * dpr, cy0 + rr + 3 * dpr, rr, 0, Math.PI * 2); ctx.fillStyle = "#10b981"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, rr * 0.24); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(cx0 + 3 * dpr + rr * 0.55, cy0 + 3 * dpr + rr * 1.05); ctx.lineTo(cx0 + 3 * dpr + rr * 0.9, cy0 + 3 * dpr + rr * 1.4); ctx.lineTo(cx0 + 3 * dpr + rr * 1.5, cy0 + 3 * dpr + rr * 0.7); ctx.stroke();
      // Name + Cardmarket-Preis-Badge unten im Fach
      const fs = Math.max(9 * dpr, Math.min(cw * 0.115, 13 * dpr)), pad = 4 * dpr;
      const bh = fs * 2.5 + pad * 2;
      ctx.fillStyle = "rgba(2,6,23,.82)";
      roundRect(ctx, cx0 + 2 * dpr, cy0 + ch - bh - 2 * dpr, cw - 4 * dpr, bh, 5 * dpr); ctx.fill();
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      ctx.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`; ctx.fillStyle = "#fff";
      ctx.fillText(fitText(ctx, name, cw - 4 * dpr - 2 * pad), cx0 + 2 * dpr + pad, cy0 + ch - bh - 2 * dpr + pad + fs);
      ctx.font = `900 ${fs * 1.08}px system-ui, -apple-system, "Segoe UI", sans-serif`; ctx.fillStyle = "#34d399";
      ctx.fillText(price ? eur(price) : info ? "– €" : "… €", cx0 + 2 * dpr + pad, cy0 + ch - 2 * dpr - pad - fs * 0.12);
      if (it && it.qty > 1) { ctx.textAlign = "right"; ctx.fillStyle = "#fde047"; ctx.fillText(`×${it.qty}`, cx0 + cw - 2 * dpr - pad, cy0 + ch - 2 * dpr - pad - fs * 0.12); }
      ctx.restore();
    }
  }

  function drawOverlay() {
    const cv = $("ps-sw-overlay");
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const now = Date.now();
    if (!sw.running) return;
    if (isBinder()) { drawBinder(ctx, W, H, dpr, now); return; }
    sw.tags = sw.tags.filter((t) => now - t.seen <= TAG_HOLD_MS + TAG_FADE_MS);
    for (const tag of sw.tags) drawTag(ctx, tag, W, H, dpr, now);
  }

  function animateTags() {
    cancelAnimationFrame(sw.tagRaf);
    const step = () => {
      drawOverlay();
      if (sw.running && !isBinder() && sw.tags.length) sw.tagRaf = requestAnimationFrame(step);
    };
    sw.tagRaf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ Feedback: Vibration + Scanner-Ping
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      sw.audio ||= new AC();
      if (sw.audio.state === "suspended") sw.audio.resume().catch(() => {});
    } catch {}
  }

  /** Kurzer, knackiger Kassen-/Scanner-Ping (zwei schnelle Töne, heller Oberton) – ohne Audiodatei. */
  function pling() {
    if (sw.prefs.muted) return;
    try {
      unlockAudio();
      const ctx = sw.audio;
      if (!ctx) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      out.connect(ctx.destination);
      for (const [f, g, start, dur] of [[1900, 1, 0, 0.07], [2550, 0.8, 0.07, 0.13], [3800, 0.25, 0.07, 0.1]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = f > 3000 ? "sine" : "square"; o.frequency.setValueAtTime(f, t + start);
        og.gain.setValueAtTime(g * (o.type === "square" ? 0.35 : 1), t + start);
        o.connect(og).connect(out);
        o.start(t + start); o.stop(t + start + dur);
      }
    } catch {}
  }

  function feedback() {
    const t = performance.now();
    if (t - sw.pingAt < 70) return;
    sw.pingAt = t;
    if (!sw.prefs.muted) {
      if (isNative()) haptic("success");
      else { try { if (navigator.vibrate) navigator.vibrate(35); } catch {} }
    }
    pling();
    const f = $("ps-sw-flash");
    if (f) { f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 80); }
  }

  // ------------------------------------------------------------------ Modus (kein Set-Lock: immer der komplette Katalog)
  function sendConfig() {
    deps.worker().postMessage({ type: "sweep-config", mode: sw.prefs.mode });
    sw.configSent = true;
  }

  function setMode(m) {
    m = MODE_ALIAS[m] || m;
    if (!MODES[m] || sw.prefs.mode === m) return;
    sw.prefs.mode = m; savePrefs();
    sw.eff = m === "binder" ? "binder" : "turbo"; sw.top = 0;
    sw.gate.reset(); resetBinder(); sw.tags = []; sw.verify = null; sw.wantCrop = false; sw.standby = "";
    haptic("select");
    renderToggles(); renderAll(); drawOverlay();
    const idle = $("ps-sw-idle");
    if (idle && !sw.running) {
      const ps = idle.querySelectorAll("p");
      if (ps[0]) ps[0].textContent = MODES[m].icon;
      if (ps[1]) ps[1].textContent = MODES[m].label;
      if (ps[2]) ps[2].textContent = modeIntro();
    }
    sendConfig();
    deps.worker().postMessage({ type: "sweep-reset" });
    if (sw.running) toast(MODES[m].label, MODES[m].hint);
  }

  /** Raster 3 × 3 ↔ 2 × 2 */
  function toggleGrid() {
    sw.prefs.grid = sw.prefs.grid === "3x3" ? "2x2" : "3x3"; savePrefs();
    resetBinder();
    haptic("select");
    renderView(); drawOverlay();
  }

  /** Knopf „Nächste Seite“: alle Fach-Sperren leeren – die Seite im Bild zählt komplett neu */
  function nextPage() {
    sw.slotGate.nextPage(); sw.slotTags.clear(); sw.slotSeen.clear(); sw.flipAt = Date.now();
    haptic("select");
    renderView(); setStatus(statusLine()); drawOverlay();
  }

  function setLang(l) {
    if (!FLAG[l]) return;
    sw.prefs.lang = l; savePrefs();
    deps.ensureLang(l);
    haptic("select"); renderToggles(); renderDock();
  }

  function setFinish(f) {
    if (!FINISH_KEYS.includes(f)) return;
    sw.prefs.finish = f; savePrefs();
    haptic("select"); renderToggles(); renderDock();
  }

  /** Dock: Variante der zuletzt gescannten Karte ändern – gilt zugleich als Vorgabe für die nächsten Scans */
  function dockFinish(f) {
    if (!FINISH_KEYS.includes(f)) return;
    sw.prefs.finish = f; savePrefs();
    if (sw.lastUid && sw.items.some((i) => i.uid === sw.lastUid)) itemFinish(sw.lastUid, f);
    else { haptic("select"); renderDock(); }
  }

  /**
   * Dock: Sprache DE / EN / JP. Gilt als Vorgabe für die nächsten Scans; die zuletzt gescannte Karte wechselt auf den
   * Druck dieser Sprache, wenn der Scanner ihn erkannt hat und sie noch nicht im Binder liegt.
   */
  function dockLang(l) {
    if (!FLAG[l]) return;
    sw.prefs.lang = l; savePrefs();
    deps.ensureLang(l);
    haptic("select");
    const it = lastItem();
    if (it && it.lang !== l) {
      const alt = (it.alts || []).find((k) => langOfKey(k) === l);
      if (!alt) toast(`${FLAG[l]} ${LANG_NAME[l]}`, "Für diese Karte kennt der Scanner keinen Druck in dieser Sprache – die Auswahl gilt ab dem nächsten Scan.");
      else if (it.filed) toast(`${FLAG[l]} ${LANG_NAME[l]}`, "Diese Karte liegt schon im Set-Binder – die Sprache gilt ab dem nächsten Scan.");
      else {
        const twin = sw.items.find((i) => i.uid !== it.uid && i.key === alt && i.finish === it.finish);
        if (twin) {
          sw.items = sw.items.filter((i) => i.uid !== it.uid).map((i) => (i.uid === twin.uid ? { ...i, qty: i.qty + it.qty } : i));
          sw.history = sw.history.map((h) => (h === it.uid ? twin.uid : h));
          sw.lastUid = twin.uid;
        } else sw.items = sw.items.map((i) => (i.uid === it.uid ? { ...i, key: alt, lang: l, info: sw.info.get(alt) || null } : i));
        for (const tag of [...sw.tags, ...sw.slotTags.values()]) if (tag.uid === it.uid) { tag.key = alt; tag.uid = sw.lastUid; }
        loadInfo([alt]);
        saveSession();
      }
    }
    renderAll(); drawOverlay();
  }

  // ------------------------------------------------------------------ Session-Aktionen
  const lastItem = () => sw.items.find((i) => i.uid === sw.lastUid) || null;

  function plusOne(uid = sw.lastUid) {
    const it = sw.items.find((i) => i.uid === uid);
    if (!it) return;
    sw.items = sessionQty(sw.items, uid, 1);
    sw.history.push(uid);
    haptic("select"); pling();
    renderAll(true); saveSession();
    autoFile(uid, it.key);
  }

  function undo() {
    const r = sessionUndo(sw.items, sw.history);
    if (!r.uid) { toast("↶ Nichts zum Rückgängigmachen", "In dieser Session wurde noch nichts gescannt."); return; }
    const it = sw.items.find((i) => i.uid === r.uid);
    sw.items = r.items;
    sw.history = r.history;
    // Die Sperre bleibt, solange genau dieses Exemplar im Bild liegt bzw. das Fach offen aufgeschlagen ist – sonst würde
    // die zurückgenommene Karte sofort wieder gezählt. Nur das Etikett/der Haken verschwindet.
    const gone = !sw.items.some((i) => i.uid === r.uid);
    sw.tags = sw.tags.filter((t) => t.uid !== r.uid || !gone);
    if (gone || isBinder()) { const last = [...sw.slotTags].reverse().find(([, t]) => t.uid === r.uid); if (last) sw.slotTags.delete(last[0]); }
    sw.lastUid = sw.items.some((i) => i.uid === sw.lastUid) ? sw.lastUid : sw.items[0]?.uid || null;
    sw.daily = bumpDaily(sw.daily, { count: -1, value: -(it ? priceOf(it) : 0) }); saveDaily();
    // Der automatische Ordner-Eintrag dieses Scans wird mit zurückgenommen (wartet ggf. auf ein laufendes Speichern)
    if (it) unfileExtra(r.uid, it.key, it.finish);
    haptic("select");
    renderAll(); saveSession(); drawOverlay();
  }

  function itemFinish(uid, f) {
    const it = sw.items.find((i) => i.uid === uid);
    if (!it || !FINISH_KEYS.includes(f)) return;
    sw.items = sessionFinish(sw.items, uid, f);
    // Zusammengelegt? Dann zeigt das Dock den Eintrag mit der neuen Variante
    if (!sw.items.some((i) => i.uid === uid)) {
      const twin = sw.items.find((i) => i.key === it.key && i.finish === f);
      sw.history = sw.history.map((h) => (h === uid ? twin?.uid || h : h));
      // Ordner-Einträge wandern mit (Rückgängig bleibt korrekt)
      if (twin && sw.fileLog.has(uid)) { sw.fileLog.set(twin.uid, [...(sw.fileLog.get(twin.uid) || []), ...sw.fileLog.get(uid)]); sw.fileLog.delete(uid); }
      if (sw.lastUid === uid) sw.lastUid = twin?.uid || null;
      for (const tag of [...sw.tags, ...sw.slotTags.values()]) if (tag.uid === uid) tag.uid = twin?.uid || null;
    }
    haptic("select");
    renderAll(); saveSession();
  }

  function changeQty(uid, delta) {
    const it = sw.items.find((i) => i.uid === uid);
    sw.items = sessionQty(sw.items, uid, Number(delta) > 0 ? 1 : -1);
    if (Number(delta) > 0) { sw.history.push(uid); if (it) autoFile(uid, it.key); }
    else if (it) unfileExtra(uid, it.key, it.finish);
    if (!sw.items.some((i) => i.uid === sw.lastUid)) sw.lastUid = sw.items[0]?.uid || null;
    renderAll(); saveSession();
  }

  function clearSession() {
    if (!sw.items.length) return;
    const open = sw.items.reduce((s, i) => s + Math.max(0, i.qty - (i.filed || 0)), 0);
    if (open && !window.confirm(`${open} Karte${open > 1 ? "n sind" : " ist"} noch nicht im Set-Binder. Session trotzdem leeren?`)) return;
    sw.items = []; sw.history = []; sw.lastUid = null; sw.tags = [];
    sw.gate.reset(); sw.slotGate.nextPage(); sw.slotTags.clear();
    renderAll(); saveSession(); drawOverlay();
  }

  /** Infos (Art + ID) für alle Einträge sicherstellen – nötig zum Einsortieren und Inserieren. */
  async function completeInfos(list) {
    const need = [...new Set(list.filter((it) => !sw.info.get(it.key)?.kind || sw.info.get(it.key)?.partial).map((it) => it.key))];
    for (let i = 0; i < need.length; i += 8) {
      try { for (const x of await deps.fetchInfo(need.slice(i, i + 8))) sw.info.set(x.key, x); } catch {}
    }
    sw.items = sw.items.map((it) => (sw.info.get(it.key)?.kind ? { ...it, info: sw.info.get(it.key) } : it));
  }

  /** „Inserieren“ (Cardmarket-Preis) bzw. „Schnell-Inserieren“ (Deal-Preis unter Cardmarket, 1 Tipp → live). */
  async function listItem(uid, quick = false) {
    const it = sw.items.find((i) => i.uid === uid) || lastItem();
    if (!it) return;
    haptic("select");
    await completeInfos([it]);
    const info = sw.info.get(it.key);
    if (!info?.kind) { toast("⏳ Kartendaten laden noch", "Einen Moment – dann kannst du die Karte inserieren."); return; }
    const probe = sw.probes.get(it.key);
    if (probe) deps.learn(it.key, probe);
    deps.openQuickList([{ ...info, source: "scan", condition: "nm", variant: it.finish || "normal" }], quick ? { instant: true, strategy: "quick" } : { strategy: "fair" });
  }

  /**
   * 1-Klick-Inserieren direkt am Scan-Ergebnis – ohne Formular:
   *   mode „cm“   → „🏷️ 1-Klick Inserieren (CM-Preis)“: sofort zum aktuellen Cardmarket-Wert auf den Marktplatz
   *   mode „deal“ → „⚡ Schnell-Inserieren (Deal unter CM)“: 0,50 € bis 5,00 € unter Cardmarket – neue Inserate unter dem
   *                 Zielpreis lösen beim Server den Radar-/Deal-Alarm der Beobachter aus
   * Der Button wechselt sofort auf „✅ Live auf dem Marktplatz!“; die Kamera scannt währenddessen weiter.
   */
  async function oneTapList(uid, mode = "cm") {
    const it = sw.items.find((i) => i.uid === uid) || lastItem();
    if (!it || (it.listed && (it.listed.state === "busy" || it.listed.state === "live"))) return;
    const setListed = (v) => { sw.items = sw.items.map((x) => (x.uid === it.uid ? { ...x, listed: v } : x)); renderDock(); if (sw.drawer) renderDrawer(); };
    haptic("select");
    setListed({ mode, state: "busy" });
    try {
      await completeInfos([it]);
      const cur = sw.items.find((x) => x.uid === it.uid) || it;
      const info = sw.info.get(it.key);
      const cm = priceOf(cur);
      const price = oneTapPrice(cm, mode === "deal" ? "deal" : "cm");
      if (!info?.kind || !price) {
        setListed(null);
        // Ohne Cardmarket-Wert: Inserieren-Dialog mit Preisvorschlag als Rückfall
        if (info?.kind) deps.openQuickList([{ ...info, source: "scan", condition: "nm", variant: cur.finish || "normal" }], mode === "deal" ? { strategy: "quick" } : { strategy: "fair" });
        else toast("⏳ Kartendaten laden noch", "Einen Moment – dann geht das Inserat mit einem Tipp live.");
        return;
      }
      const probe = sw.probes.get(it.key);
      if (probe) deps.learn(it.key, probe);
      const r = await deps.listNow({ ...info, source: "scan", condition: "nm", variant: cur.finish || "normal" }, price);
      if (!r) { setListed(null); return; }
      setListed({ mode, state: "live", price, id: r.id || null });
      if (!sw.prefs.muted) haptic("success");
      toast("✅ Live auf dem Marktplatz!", mode === "deal"
        ? `${itemName(cur)} für ${eur(price)} – ${eur(Math.round((cm - price) * 100) / 100)} unter Cardmarket. 📡 Radar-Alarm für Sammler mit passendem Zielpreis ausgelöst.`
        : `${itemName(cur)} für ${eur(price)} (Cardmarket-Preis) – scanne einfach weiter.`);
    } catch (e) {
      setListed(null);
      handleError(e);
    }
  }

  async function fileAll() {
    const open = sw.items.filter((i) => i.qty > (i.filed || 0));
    if (!open.length) { toast("📒 Alles einsortiert", "Alle Karten dieser Session liegen schon in deinen Set-Ordnern."); return; }
    if (sw.filing) return;
    sw.filing = true;
    setStatus("📒 Sortiere in deine Set-Ordner …");
    let n = 0, sets = new Set();
    try {
      await completeInfos(open);
      for (const it of [...open].reverse()) {
        const info = sw.items.find((x) => x.uid === it.uid)?.info;
        if (!info?.kind) continue;
        const qty = it.qty - (it.filed || 0);
        // Mengen-Addierung: liegt die Karte schon im Set-Ordner, wird dort die Anzahl erhöht (kein zweiter Slot)
        const ok = await deps.fileItem(info, { condition: "NM", variant: it.finish || "normal" }, qty);
        if (!ok) break;
        logFiled(it.uid, ok, qty);
        n += qty; sets.add(setIdOfKey(it.key));
        sw.items = sw.items.map((x) => (x.uid === it.uid ? { ...x, filed: x.qty, ...(Number(ok?.quantity) > 0 ? { binderQty: Number(ok.quantity) } : {}), setName: info.setName || x.setName } : x));
        const probe = sw.probes.get(it.key);
        if (probe) deps.learn(it.key, probe);
      }
    } catch (e) { handleError(e); }
    sw.filing = false;
    if (n) {
      haptic("success");
      toast("📒 Im Set-Binder einsortiert", `${n} Karte${n > 1 ? "n" : ""} in ${sets.size} Set-Ordner${sets.size > 1 ? "n" : ""} – dort jetzt als vorhanden markiert.`);
      window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
      window.PS?.loadPortfolio?.();
    }
    renderAll(); saveSession();
  }

  /** Lag die Karte schon vor dieser Session im Binder? (dann ist auch das erste Exemplar doppelt) */
  function ownedBefore(key) {
    const it = sw.items.find((i) => i.key === key);
    const info = it?.info || sw.info.get(key);
    const items = state.portfolio?.items;
    if (!info || !Array.isArray(items)) return false;
    const owned = items.filter((p) => (info.kind === "print" ? p.printId === info.id : p.cardId === info.id && !p.printId))
      .reduce((s, p) => s + (Number(p.quantity) || 1), 0);
    return owned - Math.min(it?.filed || 0, it?.qty || 0) > 0;
  }

  async function sellDupes() {
    await completeInfos(sw.items);
    const dupes = sessionDuplicates(sw.items, ownedBefore);
    if (!dupes.length) { toast("Keine Doppelten", "Scanne eine Karte mehrfach (oder eine, die schon in deinem Binder liegt) – dann kannst du die Extras hier anbieten."); return; }
    const rows = [];
    for (const d of dupes) {
      const info = d.info || sw.info.get(d.key);
      if (!info?.kind) continue;
      for (let n = 0; n < d.extra && rows.length < MAX_LIST; n++) rows.push({ ...info, source: "scan", condition: "nm", variant: d.finish || "normal" });
    }
    if (!rows.length) return;
    for (const d of dupes) { const p = sw.probes.get(d.key); if (p) deps.learn(d.key, p); }
    deps.openQuickList(rows, {});
  }

  /** „Direkt auf Marktplatz inserieren“: alle Karten der Session in den Bulk-Listing-Dialog (Cardmarket-Preise vorausgefüllt). */
  async function sellAll() {
    if (!sw.items.length) return;
    await completeInfos(sw.items);
    const rows = [];
    let total = 0;
    for (const it of sw.items) {
      const info = sw.items.find((x) => x.uid === it.uid)?.info || sw.info.get(it.key);
      total += it.qty;
      if (!info?.kind) continue;
      for (let n = 0; n < it.qty && rows.length < MAX_LIST; n++) rows.push({ ...info, source: "scan", condition: "nm", variant: it.finish || "normal" });
    }
    if (!rows.length) { toast("⏳ Kartendaten laden noch", "Einen Moment – dann kannst du die Karten inserieren."); return; }
    for (const it of sw.items) { const p = sw.probes.get(it.key); if (p) deps.learn(it.key, p); }
    if (total > rows.length) toast("🏷️ Die ersten 40 Karten", `Der Inserier-Dialog nimmt ${MAX_LIST} Karten auf einmal – danach einfach die nächsten inserieren.`);
    deps.openQuickList(rows, { strategy: "fair" });
  }

  function toggleDrawer(on = !sw.drawer) {
    sw.drawer = on;
    if (on) { completeInfos(sw.items).then(() => { if (sw.drawer) renderAll(); }); }
    renderAll();
  }

  // ------------------------------------------------------------------ Worker-Nachrichten
  function onWorker(m) {
    if (m.type === "sweep-result") { onResult(m); return; }
    if (m.type === "sweep-config-done") { setStatus(statusLine()); return; }
    if (m.type === "sweep-layouts-done") { sw.layoutsReady = m.total || 0; return; }
    if (m.type === "sweep-fp-progress") { sw.fp = m.final ? null : { done: m.done || 0, total: m.total || 0 }; setStatus(statusLine()); return; }
    if (m.type === "sweep-need-layout") {
      const keys = (m.keys || []).filter((k) => typeof k === "string").slice(0, 4);
      if (!keys.length) return;
      deps.fetchInfo(keys).then((infos) => {
        for (const i of infos) if (!sw.info.get(i.key)?.kind) sw.info.set(i.key, i);
        const items = infos.filter((i) => i.image).map((i) => ({ key: i.key, url: cdn(i.image, 160) }));
        // Ohne Katalogbild keine Farb-Referenz → der Worker nutzt den strengeren Rückfall statt zu warten
        const missing = keys.filter((k) => !items.some((x) => x.key === k));
        if (items.length || missing.length) deps.worker().postMessage({ type: "sweep-layouts", items, missing });
      }).catch(() => {});
    }
  }

  const actions = {
    start, stop: () => stop(), torch: () => toggleTorch(), mute: () => { sw.prefs.muted = !sw.prefs.muted; savePrefs(); renderToggles(); if (!sw.prefs.muted) pling(); },
    full: () => toggleFull(), lang: setLang, finish: setFinish, mode: setMode, plus: () => plusOne(), undo,
    dockFinish, dockLang, itemFinish, qty: changeQty, drawer: () => toggleDrawer(),
    dock: () => { sw.prefs.dock = !sw.prefs.dock; savePrefs(); renderDock(); },
    grid: toggleGrid, nextPage, sellAll,
    autoFile: () => { sw.prefs.autoFile = !sw.prefs.autoFile; savePrefs(); renderDrawer(); },
    list: (uid) => listItem(uid, false), quick: (uid) => listItem(uid, true),
    oneTap: (uid) => oneTapList(uid, "cm"), oneTapDeal: (uid) => oneTapList(uid, "deal"),
    file: fileAll, sellDupes, clear: clearSession,
  };

  return {
    html,
    /** Nach dem Einsetzen des HTML: Leisten zeichnen */
    mount() { renderToggles(); renderAll(); },
    /** Beim Öffnen des Scanner-Reiters */
    shown() { renderToggles(); renderAll(); if (!sw.configSent) sendConfig(); },
    start, stop, onWorker,
    onIndex() { setStatus(statusLine()); },
    get running() { return sw.running || sw.starting; },
    get mode() { return sw.prefs.mode; },
    act(name, ...args) { const f = actions[name]; return f ? f(...args) : null; },
    resize() { if (sw.running) drawOverlay(); },
  };
}
