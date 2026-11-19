// PokeSwipe & Radar – 100 % rahmenloser High-Speed-Scanner (Live-Scanner ohne jeden Zielrahmen, ohne Wartezeit-Zähler,
// ohne Server-Wartezeit). Handy locker über Kartenstapel oder Ordnerseite ziehen: Jede Karte, die irgendwo im Bild
// auftaucht, wird im Web Worker gefunden, begradigt und per Bild-Fingerabdruck + Farb-Layout (+ Nummern-ROI) erkannt.
//
//  • Stapel-Turbo (Einzelkarten): 2-Frame-Konsens ≥ 86 % – Karte #2, #3, #4 … werden ohne jede Wartezeit erkannt,
//    nur DIESELBE Karte (ID + Position) hat einen 2,5-s-Duplikat-Schutz.
//  • Binder- & Tisch-Sweep: alle sichtbaren Karten gleichzeitig (strikt: 99–100 % Konfidenz + Nummern-Verifikation),
//    je Karte ihr eigenes Live-Preisschild, Gesamtwert aller Karten im Bild.
//  • Treffer → Scanner-Ping + Vibration, Preisschild-Etikett direkt auf der Karte im Kamerabild, sofort im Set-Binder
//    gespeichert (asynchron im Hintergrund – die Kamera-Schleife hält nie an), 2,5 s Aktionsleiste „Inserieren“ /
//    „Schnell-Inserieren“, danach automatisch weiter zur nächsten Karte.
//
// Diese Datei ist nur Oberfläche + Steuerung. Die Bildverarbeitung steckt in sweep-engine.js (Worker), die reine Logik
// (Konsens, Duplikat-Schutz, Konfidenz, Etikett-Texte, Session) in sweep-logic.js. Worker, Index und Kartendaten kommen
// über deps aus live-scanner.js.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, api, handleError } from "../core.js";
import { haptic, isNative } from "../native.js";
import { conditionPrice } from "./scan-ui-logic.js";
import {
  SWEEP, createSweepGate, orderByLang, langOfKey, setIdOfKey, sessionAdd, sessionQty, sessionFinish, sessionUndo, sessionTotals,
  sessionDuplicates, FINISH_KEYS, FINISH_LABEL, quadCenter, tagCode, tagLines, bumpDaily, dailyLabel, viewTotal, strictOk,
} from "./sweep-logic.js";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
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
/** Aktionsleiste nach einem Treffer: genau 2,5 s, dann automatisch weiter zur nächsten Karte */
export const AUTO_NEXT_MS = 2500;
/** Preisschild bleibt nach dem letzten Sichtkontakt so lange stehen, danach blendet es aus */
const TAG_HOLD_MS = 900, TAG_FADE_MS = 400;
/** Scan-Modi */
export const MODES = {
  turbo: { label: "⚡ Stapel-Turbo", sub: "Einzelkarten", hint: "Karte für Karte vor die Kamera – jede landet sofort im Binder." },
  sweep: { label: "🌊 Binder- & Tisch-Sweep", sub: "Über mehrere Karten fahren", hint: "Langsam über Ordnerseite oder Tisch fahren – jede Karte bekommt ihr eigenes Preisschild." },
};

const SWEEP_CSS = `
#ps-sw .ps-sw-scroll{scrollbar-width:none}#ps-sw .ps-sw-scroll::-webkit-scrollbar{display:none}
#ps-sw-flash{position:absolute;inset:0;pointer-events:none;background:rgba(255,255,255,0);transition:background .22s}
#ps-sw-flash.on{background:rgba(255,255,255,.16);transition:none}
#ps-sw-dock .ps-sw-pop{animation:psSwPop .32s cubic-bezier(.2,.9,.3,1.3)}
@keyframes psSwPop{0%{transform:translateY(10px) scale(.96);opacity:.2}100%{transform:none;opacity:1}}
#ps-sw.ps-sw-full{position:fixed;inset:0;z-index:70;max-width:none;height:100dvh!important;border-radius:0;border:0}
.ps-sw-auto{height:3px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.ps-sw-auto>span{display:block;height:100%;background:linear-gradient(90deg,#34d399,#fde047);transform-origin:left center;animation:psSwAuto linear forwards}
@keyframes psSwAuto{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.ps-sw-mode[aria-pressed="true"]{background:linear-gradient(90deg,#22d3ee,#34d399);color:#020617}
@media (prefers-reduced-motion:reduce){#ps-sw-dock .ps-sw-pop,.ps-sw-auto>span{animation:none}}
`;

/**
 * deps: {
 *   worker(): Worker · ensureIndex() · index(): { ready, loading, count, offscreen } · ensureLang(lang)
 *   fetchInfo(keys) → Promise<info[]> · fileItem(info, choice, qty) → Promise · learn(key, probe)
 *   openQuickList(infos, opts) · beforeStart() (Foto-Ansicht schließen) · isStage
 * }
 */
export function createSweep(deps) {
  const sw = {
    running: false, starting: false, camGen: 0, stream: null, track: null, caps: {}, torch: false, torchTouched: false, autoTorch: false,
    cv: null, ctx: null, inFlight: 0, sentAt: 0, seq: 0, bitmapOk: typeof createImageBitmap === "function",
    frameTimes: [], avgMs: 0, procMs: 0, dark: 0, gate: null, tags: [], raf: 0, tagRaf: 0, view: { count: 0, value: 0 },
    items: [], history: [], lastUid: null, uidSeq: Date.now(), info: new Map(), probes: new Map(),
    sets: [], setsLoaded: false, setName: "", setRows: -1, layoutsReady: 0, drawer: false, full: false, audio: null,
    prefs: readPrefs(), configSent: false, statusText: "", daily: readDaily(), bar: null, barTimer: 0, saving: new Set(), portfolioTimer: 0,
  };
  sw.gate = createSweepGate({ mode: sw.prefs.mode });
  restoreSession();

  function readPrefs() {
    const def = { muted: false, lang: "de", finish: "normal", setId: "", mode: "turbo" };
    try {
      const p = { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}) };
      if (!FLAG[p.lang]) p.lang = "de";
      if (!FINISH_KEYS.includes(p.finish)) p.finish = "normal";
      if (typeof p.setId !== "string" || !/^[\w.\-]{0,40}$/.test(p.setId)) p.setId = "";
      if (!MODES[p.mode]) p.mode = "turbo";
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
      localStorage.setItem(SESSION_KEY, JSON.stringify({ items: slim, history: sw.history.slice(-200), at: Date.now() }));
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
    } catch {}
  }
  const pickInfo = (i) => ({
    key: i.key, kind: i.kind, id: i.id, lang: i.lang, name: i.name, altName: i.altName || "", setName: i.setName || "", setCode: i.setCode || "",
    number: i.number || "", image: i.image || "", price: i.price ?? null, reversePrice: i.reversePrice ?? null, holoPrice: i.holoPrice ?? null,
    baseCardId: i.baseCardId ?? null, rarity: i.rarity || "",
  });

  // ------------------------------------------------------------------ Oberfläche
  const chip = (on, extra = "") => `shrink-0 text-[11px] font-black px-2.5 py-1 rounded-lg whitespace-nowrap ${on ? "bg-yellow-400 text-slate-950" : "bg-slate-900/80 text-slate-200 border border-white/10"} ${extra}`;
  const iconBtn = "w-9 h-9 shrink-0 rounded-full bg-slate-900/80 border border-white/10 text-white text-base flex items-center justify-center";
  const isSweep = () => sw.prefs.mode === "sweep";

  function html() {
    return `<div id="ps-sw" class="relative w-full mx-auto max-w-xl rounded-3xl overflow-hidden bg-black border border-cyan-400/40 select-none touch-manipulation" style="height:min(calc(100dvh - 200px),820px);min-height:470px" data-mode="${esc(sw.prefs.mode)}">
      <style>${SWEEP_CSS}</style>
      <video id="ps-sw-video" class="absolute inset-0 w-full h-full object-cover hidden" playsinline muted autoplay></video>
      <canvas id="ps-sw-overlay" class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true"></canvas>
      <div id="ps-sw-flash"></div>
      <div class="absolute inset-x-0 top-0 p-2 space-y-1.5 bg-gradient-to-b from-slate-950/90 via-slate-950/55 to-transparent pb-5">
        <div class="flex items-center gap-1.5">
          <span id="ps-sw-daily" class="min-w-0 flex-1 truncate text-[10px] sm:text-[11px] font-black bg-slate-900/85 border border-white/10 text-white px-2.5 py-1.5 rounded-xl" title="Tages-Scan-Zähler">${esc(dailyLabel(sw.daily))}</span>
          <label class="${iconBtn} cursor-pointer" title="Foto hochladen" aria-label="Foto aufnehmen oder hochladen">🖼️<input data-ls-upload="1" type="file" accept="image/*" class="hidden" /></label>
          <button id="ps-sw-torch" type="button" onclick="PS.sweep('torch')" class="${iconBtn}" aria-label="Taschenlampe" aria-pressed="false">🔦</button>
          <button id="ps-sw-mute" type="button" onclick="PS.sweep('mute')" class="${iconBtn}" aria-label="Ton aus" aria-pressed="false" title="Scanner-Ping & Vibration stummschalten">🔊</button>
          <button id="ps-sw-full" type="button" onclick="PS.sweep('full')" class="${iconBtn}" aria-label="Vollbild" aria-pressed="false">⛶</button>
          <button id="ps-sw-stop" type="button" onclick="PS.sweep('stop')" class="${iconBtn} hidden" aria-label="Kamera beenden">✕</button>
        </div>
        <div id="ps-sw-modes" class="grid grid-cols-2 gap-1 bg-slate-900/80 border border-white/10 rounded-xl p-0.5" role="group" aria-label="Scan-Modus"></div>
        <div class="flex items-center gap-1.5">
          <span id="ps-sw-count" class="shrink-0 text-[11px] font-black bg-slate-900/85 border border-white/10 text-white px-2 py-1 rounded-lg" title="Gescannte Karten in dieser Session">🃏 0</span>
          <span id="ps-sw-value" class="shrink-0 text-[11px] font-black bg-emerald-400 text-slate-950 px-2 py-1 rounded-lg" title="Gesamtwert der Session (Cardmarket-Trend)">0,00 €</span>
          <span id="ps-sw-view" class="shrink-0 hidden text-[11px] font-black bg-cyan-400 text-slate-950 px-2 py-1 rounded-lg" title="Gesamtwert aller Karten im Bild"></span>
          <span id="ps-sw-status" role="status" class="min-w-0 flex-1 text-[10px] font-bold text-cyan-200 truncate"></span>
        </div>
        <div id="ps-sw-sets" class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Set-Lock: Suche auf ein Set beschränken"></div>
        <div class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto">
          <div id="ps-sw-langs" role="group" aria-label="Sprache der gescannten Karten" class="flex gap-1 shrink-0"></div>
          <span class="w-px h-5 bg-white/20 shrink-0"></span>
          <div id="ps-sw-fins" role="group" aria-label="Standard-Variante" class="flex gap-1 shrink-0"></div>
        </div>
      </div>
      <div id="ps-sw-idle" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-950/85">
        <p class="text-4xl" aria-hidden="true">${isSweep() ? "🌊" : "⚡"}</p>
        <p class="text-base font-black text-white">${esc(MODES[sw.prefs.mode].label)} – 100 % rahmenlos</p>
        <p class="text-xs text-slate-300 max-w-xs">${esc(MODES[sw.prefs.mode].hint)} Kein Rahmen, kein Warten: Preisschild erscheint direkt auf der Karte, sie landet sofort in deinem Set-Binder.</p>
        <button type="button" onclick="PS.sweep('start')" class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm px-6 py-3 rounded-2xl shadow-lg">📷 Kamera starten</button>
        <p class="text-[10px] text-slate-500 max-w-xs">Erkennung komplett auf deinem Gerät. Es werden keine Kamerabilder hochgeladen.</p>
      </div>
      <div id="ps-sw-dock" class="absolute inset-x-2 bottom-2" aria-live="polite"></div>
      <div id="ps-sw-drawer" class="absolute inset-x-0 bottom-0 hidden max-h-[80%] flex flex-col bg-slate-950/95 backdrop-blur border-t border-cyan-400/40 rounded-t-3xl"></div>
    </div>`;
  }

  function renderModes() {
    const box = $("ps-sw-modes");
    if (!box) return;
    box.innerHTML = Object.entries(MODES).map(([k, m]) => `<button type="button" onclick="PS.sweep('mode', '${k}')" aria-pressed="${sw.prefs.mode === k}" class="ps-sw-mode text-left rounded-lg px-2 py-1 ${sw.prefs.mode === k ? "" : "text-slate-200"}" title="${esc(m.hint)}">
        <span class="block text-[11px] font-black leading-tight truncate">${esc(m.label)}</span><span class="block text-[9px] font-bold opacity-80 leading-tight truncate">${esc(m.sub)}</span></button>`).join("");
    $("ps-sw")?.setAttribute("data-mode", sw.prefs.mode);
    $("ps-sw-view")?.classList.toggle("hidden", !isSweep() || !sw.running);
  }

  function renderSets() {
    const box = $("ps-sw-sets");
    if (!box) return;
    const cur = sw.prefs.setId;
    const quick = sw.sets.slice(0, 14);
    const curSet = sw.sets.find((s) => s.id === cur);
    if (cur && !quick.some((s) => s.id === cur)) quick.unshift(curSet || { id: cur, name: sw.setName || cur });
    box.innerHTML = `<button type="button" onclick="PS.sweep('set', '')" aria-pressed="${!cur}" class="${chip(!cur)}">🌐 Alle Sets</button>
      ${quick.map((s) => `<button type="button" onclick="PS.sweep('set', ${jsArg(s.id)})" aria-pressed="${s.id === cur}" class="${chip(s.id === cur)}">${s.id === cur ? "🔒 " : ""}${esc(s.name)}</button>`).join("")}
      ${sw.sets.length > quick.length ? `<select onchange="PS.sweep('set', this.value)" aria-label="Weitere Sets" class="shrink-0 text-[11px] font-black bg-slate-900/80 border border-white/10 text-slate-200 rounded-lg px-1.5 py-1 max-w-[9rem]">
        <option value="">Weitere Sets …</option>${sw.sets.slice(quick.length).map((s) => `<option value="${esc(s.id)}"${s.id === cur ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : ""}
      ${!sw.setsLoaded ? `<span class="text-[10px] text-slate-400 shrink-0">Lade Sets …</span>` : ""}`;
  }

  function renderToggles() {
    const langs = $("ps-sw-langs"), fins = $("ps-sw-fins");
    if (langs) langs.innerHTML = ["de", "en", "ja"].map((l) => `<button type="button" onclick="PS.sweep('lang', '${l}')" aria-pressed="${sw.prefs.lang === l}" title="${LANG_NAME[l]}" class="${chip(sw.prefs.lang === l)}">${FLAG[l]} ${LANG_NAME[l]}</button>`).join("");
    if (fins) fins.innerHTML = FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('finish', '${f}')" aria-pressed="${sw.prefs.finish === f}" class="${chip(sw.prefs.finish === f)}">${esc(FINISH_LABEL[f])}</button>`).join("");
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

  function renderTop() {
    const t = sessionTotals(sw.items, priceOf);
    const c = $("ps-sw-count"), v = $("ps-sw-value"), d = $("ps-sw-daily");
    if (c) c.textContent = `🃏 ${t.count.toLocaleString("de-DE")}`;
    if (v) v.textContent = eur(t.value);
    if (d) d.textContent = dailyLabel(sw.daily);
  }

  function renderView() {
    const el = $("ps-sw-view");
    if (!el) return;
    el.classList.toggle("hidden", !isSweep() || !sw.running);
    el.textContent = sw.view.count ? `🌊 Im Bild: ${sw.view.count} ${sw.view.count === 1 ? "Karte" : "Karten"} · ${eur(sw.view.value)}` : "🌊 Im Bild: –";
  }

  function setStatus(text) {
    sw.statusText = text;
    const el = $("ps-sw-status");
    if (el) el.textContent = text;
  }

  function statusLine() {
    const ix = deps.index();
    if (!ix.ready) return ix.loading ? "⏳ Lade Karten-Index …" : "";
    const parts = [];
    if (sw.prefs.setId) parts.push(`🔒 ${sw.setName || sw.prefs.setId}${sw.setRows >= 0 ? ` · ${sw.setRows} Karten` : ""}`);
    else parts.push(`🌐 ${Number(ix.count || 0).toLocaleString("de-DE")} Karten`);
    if (sw.running && sw.frameTimes.length > 4) {
      const span = sw.frameTimes[sw.frameTimes.length - 1] - sw.frameTimes[0];
      const fps = span > 0 ? Math.round(((sw.frameTimes.length - 1) * 1000) / span) : 0;
      parts.push(`⚡ ${fps} FPS · ${Math.round(sw.procMs)} ms`);
    }
    if (isSweep()) parts.push("🎯 99–100 % Prüfung");
    return parts.join(" · ");
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

  // ------------------------------------------------------------------ Dock: 2,5-s-Aktionsleiste → kompakte Leiste
  function renderDock(pop = false) {
    const dock = $("ps-sw-dock");
    if (!dock) return;
    if (sw.drawer) { dock.innerHTML = ""; return; }
    const listBtn = `<button type="button" onclick="PS.sweep('drawer')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black px-2.5 py-2 rounded-xl" aria-label="Scan-Liste öffnen">☰ ${sw.items.length}</button>`;
    const bar = sw.bar && sw.bar.until > Date.now() ? sw.items.find((i) => i.uid === sw.bar.uid) : null;
    if (!bar) {
      const last = sw.items.find((i) => i.uid === sw.lastUid) || sw.items[0];
      dock.innerHTML = `<div class="bg-slate-950/75 backdrop-blur rounded-2xl px-3 py-2 border border-white/10 flex items-center gap-2">
        <p class="flex-1 min-w-0 text-[11px] text-slate-300 truncate">${sw.running
          ? (last ? `Zuletzt: <strong class="text-white">${esc(itemName(last))}</strong>${last.filed ? ` <span class="text-emerald-300">· ✅ im Binder</span>` : ""} – nächste Karte ins Bild` : esc(MODES[sw.prefs.mode].hint))
          : "Kamera starten und über deine Karten ziehen."}</p>
        ${last ? `<button type="button" onclick="PS.sweep('undo')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black px-2.5 py-2 rounded-xl" aria-label="Letzten Scan rückgängig machen">↶</button>` : ""}
        ${sw.items.length ? listBtn : ""}</div>`;
      return;
    }
    const it = bar, i = it.info;
    const price = priceOf(it);
    const lines = tagLines({ price, filed: Boolean(it.filed), saving: sw.saving.has(it.uid), ownedBefore: Boolean(it.ownedBefore), qty: it.qty });
    const left = Math.max(0, sw.bar.until - Date.now());
    dock.innerHTML = `<div data-sw-last="${esc(it.uid)}" data-sw-bar="1" class="${pop ? "ps-sw-pop " : ""}bg-slate-950/85 backdrop-blur rounded-2xl p-2 border border-emerald-400/50 shadow-2xl space-y-1.5">
      <div class="ps-sw-auto" aria-hidden="true"><span style="animation-duration:${left}ms"></span></div>
      <div class="flex items-center gap-2">
        <img src="${esc(cdn(i?.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-10 h-14 object-contain rounded bg-slate-900 shrink-0" />
        <div class="min-w-0 flex-1">
          <p data-sw-name class="text-sm font-black text-white leading-tight truncate">${FLAG[it.lang] || ""} ${esc(itemName(it))}${it.qty > 1 ? ` <span class="text-emerald-300">×${it.qty}</span>` : ""}</p>
          <p class="text-[11px] text-slate-400 truncate">${esc(itemSet(it))}${it.finish !== "normal" ? ` · ${esc(FIN_SHORT[it.finish])}` : ""}</p>
          <p data-sw-filed class="text-[10px] font-black ${it.filed ? "text-emerald-300" : "text-slate-300"} truncate">${esc(lines.status)}${lines.flag ? ` · ${esc(lines.flag)}` : ""}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-[9px] uppercase font-bold text-slate-500 leading-none">Cardmarket</p>
          <p data-sw-price class="text-lg font-black text-emerald-400 leading-tight">${price ? eur(price) : i ? "–" : "…"}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="PS.sweep('list', ${jsArg(it.uid)})" class="flex-1 bg-yellow-400 text-slate-950 text-[11px] font-black px-2 py-2 rounded-xl" title="Zum Cardmarket-Preis inserieren">🏷️ Inserieren</button>
        <button type="button" onclick="PS.sweep('quick', ${jsArg(it.uid)})" class="flex-1 bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 text-[11px] font-black px-2 py-2 rounded-xl" title="Deal-Preis unter Cardmarket – geht sofort live">⚡ Schnell-Inserieren</button>
        <div role="group" aria-label="Variante" class="hidden sm:flex bg-slate-800/80 rounded-xl p-0.5 shrink-0">${FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('dockFinish', '${f}')" aria-pressed="${it.finish === f}" class="text-[10px] font-black px-2 py-1.5 rounded-lg ${it.finish === f ? "bg-yellow-400 text-slate-950" : "text-slate-300"}">${esc(FIN_SHORT[f])}</button>`).join("")}</div>
        <button type="button" onclick="PS.sweep('undo')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black px-2.5 py-2 rounded-xl" aria-label="Letzten Scan rückgängig machen">↶</button>
        ${listBtn}
      </div>
    </div>`;
  }

  /** Aktionsleiste für genau AUTO_NEXT_MS zeigen – ohne Tipp verschwindet sie von selbst, der Scanner läuft derweil weiter. */
  function showBar(uid) {
    const until = Date.now() + AUTO_NEXT_MS;
    sw.bar = { uid, until };
    clearTimeout(sw.barTimer);
    sw.barTimer = setTimeout(() => { if (sw.bar?.uid === uid && sw.bar.until <= Date.now() + 20) { sw.bar = null; renderDock(); } }, AUTO_NEXT_MS + 10);
    renderDock(true);
  }
  function hideBar() { clearTimeout(sw.barTimer); sw.bar = null; renderDock(); }

  function renderDrawer() {
    const d = $("ps-sw-drawer");
    if (!d) return;
    d.classList.toggle("hidden", !sw.drawer);
    if (!sw.drawer) { d.innerHTML = ""; return; }
    const t = sessionTotals(sw.items, priceOf);
    const dupes = sessionDuplicates(sw.items, ownedBefore).reduce((s, x) => s + x.extra, 0);
    const open = sw.items.reduce((s, i) => s + Math.max(0, i.qty - (i.filed || 0)), 0);
    d.innerHTML = `<div class="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-white/10">
        <div class="min-w-0 flex-1"><p class="text-sm font-black text-white">🗂️ Scan-Session</p><p class="text-[11px] text-slate-400">${t.count} Karten · ${t.distinct} verschiedene · ${eur(t.value)}</p></div>
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
        <button type="button" onclick="PS.sweep('file')" ${open ? "" : "disabled"} class="col-span-2 bg-emerald-500 text-slate-950 text-xs font-black py-3 rounded-xl disabled:opacity-40">📒 ${open ? `${open} noch offene in den Set-Binder einsortieren` : "Alles im Set-Binder · erledigt"}</button>
        <button type="button" onclick="PS.sweep('sellDupes')" ${dupes ? "" : "disabled"} class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">🏷️ Doppelte auf Marktplatz${dupes ? ` (${dupes})` : ""}</button>
        <button type="button" onclick="PS.sweep('clear')" ${sw.items.length ? "" : "disabled"} class="bg-slate-800 text-slate-200 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">🗑️ Session leeren</button>
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
    ensureSets();
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
    sw.running = true; sw.torch = false; sw.dark = 0; sw.frameTimes = []; sw.inFlight = 0; sw.tags = []; sw.view = { count: 0, value: 0 };
    sw.gate.reset();
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
    sw.tags = []; drawOverlay();
    hideBar();
    renderToggles(); renderAll();
  }

  async function toggleTorch(on = !sw.torch, manual = true) {
    if (manual) sw.torchTouched = true;
    if (!sw.track) { toast("🔦 Kamera starten", "Die Taschenlampe lässt sich nutzen, sobald die Kamera läuft."); return; }
    try {
      await sw.track.applyConstraints({ advanced: [{ torch: on }] });
      sw.torch = on;
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
    const stage = $("ps-sw");
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
    // Bevorzugt: ImageBitmap an den Worker übergeben – Verkleinern und Pixel-Auslesen passieren dort, nicht im UI-Thread
    if (sw.bitmapOk && deps.index().offscreen) {
      createImageBitmap(video, g.sx, g.sy, g.sw, g.sh, { resizeWidth: g.W, resizeHeight: g.H, resizeQuality: "low" })
        .then((bmp) => { if (!sw.running || seq !== sw.seq) { bmp.close?.(); sw.inFlight = 0; return; } w.postMessage({ type: "sweep-frame", seq, bitmap: bmp, w: g.W, h: g.H }, [bmp]); })
        .catch(() => { sw.bitmapOk = false; sw.inFlight = 0; });
      return;
    }
    if (!sw.cv) { sw.cv = document.createElement("canvas"); sw.ctx = sw.cv.getContext("2d", { willReadFrequently: true }); }
    if (sw.cv.width !== g.W || sw.cv.height !== g.H) { sw.cv.width = g.W; sw.cv.height = g.H; }
    sw.ctx.drawImage(video, g.sx, g.sy, g.sw, g.sh, 0, 0, g.W, g.H);
    const img = sw.ctx.getImageData(0, 0, g.W, g.H);
    w.postMessage({ type: "sweep-frame", seq, data: img.data.buffer, w: g.W, h: g.H }, [img.data.buffer]);
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
      if (typeof m.setRows === "number" && m.setRows >= 0) sw.setRows = m.setRows;
      checkDark(m.light);
      const dets = Array.isArray(m.dets) ? m.dets : [];
      const { hits, view } = sw.gate.push({ dets, found: m.found, motion: m.motion }, Date.now(), interval);
      const t = Date.now();
      // Preisschilder der schon erkannten Karten an die aktuelle Lage anheften
      for (const d of dets) {
        if (!Array.isArray(d.keys) || d.match < SWEEP.TRACK_MATCH) continue;
        const tag = findTag(d.keys, d.quad);
        if (tag) { tag.quad = d.quad; tag.seen = t; tag.conf = d.conf ?? tag.conf; }
      }
      for (const keys of hits) {
        const d = dets.find((x) => x.keys === keys);
        if (d) onHit(d);
      }
      if (isSweep()) {
        sw.view = viewTotal(view.filter((d) => strictOk(d)), priceOfKey, SWEEP.STRICT_MATCH);
        renderView();
      }
      drawOverlay();
      if (sw.frameTimes.length % 5 === 0) setStatus(statusLine());
    } catch (e) {
      // Ein Fehler in der Anzeige darf die Kamera-Schleife nie anhalten
      try { console.warn("sweep onResult", e); } catch {}
    }
  }

  /** Preisschild derselben Karte (Sweep: an ähnlicher Position – zwei Exemplare auf einer Seite bekommen zwei Etiketten) */
  function findTag(keys, quad) {
    const c = quadCenter(quad);
    let best = null, bestD = Infinity;
    for (const tag of sw.tags) {
      if (!tag.keys.some((k) => keys.includes(k))) continue;
      if (!isSweep() || !c || !tag.center) return tag;
      const d = Math.hypot(c[0] - tag.center[0], c[1] - tag.center[1]);
      if (d < SWEEP.SAME_POS && d < bestD) { best = tag; bestD = d; }
    }
    return best;
  }

  function onHit(d) {
    const keys = orderByLang(d.keys, sw.prefs.lang);
    const key = keys[0];
    const wasOwned = ownedBefore(key);
    const r = sessionAdd(sw.items, { key, finish: sw.prefs.finish, lang: langOfKey(key), label: d.label, info: sw.info.get(key) || null }, ++sw.uidSeq);
    sw.items = r.items.slice(0, MAX_ITEMS).map((it) => (it.uid === r.uid && it.ownedBefore === undefined ? { ...it, ownedBefore: wasOwned } : it));
    sw.history.push(r.uid);
    sw.lastUid = r.uid;
    if (d.probe) sw.probes.set(key, d.probe);
    const now = Date.now();
    const existing = findTag(d.keys, d.quad);
    const tag = existing || { keys: [...d.keys], key, uid: r.uid, at: now };
    Object.assign(tag, { quad: d.quad, center: quadCenter(d.quad), seen: now, at: now, uid: r.uid, conf: d.conf ?? null });
    if (!existing) sw.tags.push(tag);
    if (sw.tags.length > SWEEP.MAX_CARDS + 3) sw.tags.splice(0, sw.tags.length - (SWEEP.MAX_CARDS + 3));
    // Tages-Zähler: Anzahl sofort, Wert sobald der Preis bekannt ist
    const p = priceOfKey(key);
    sw.daily = bumpDaily(sw.daily, { count: 1, value: p });
    if (!p) sw.items = sw.items.map((it) => (it.uid === r.uid ? { ...it, dailyPending: (it.dailyPending || 0) + 1 } : it));
    saveDaily();
    feedback();
    showBar(r.uid);
    renderTop(); renderDrawer(); renderView();
    saveSession();
    animateTags();
    // Sofort in den Set-Binder (asynchron, die Kamera-Schleife wartet nie darauf)
    autoFile(r.uid, key);
    // Name ist schon da (Index auf dem Gerät); Cardmarket-Preis & Bild laden im Hintergrund nach
    loadInfo([key, ...keys.slice(1, 3)]);
  }

  /** Automatisches Einsortieren eines Treffers – Konto: Set-Ordner, Gast: Test-Binder auf dem Gerät. Fehler → bleibt „offen“ (Liste). */
  function autoFile(uid, key) {
    if (deps.isStage) return;
    sw.saving.add(uid);
    (async () => {
      try {
        let info = sw.info.get(key);
        if (!info?.kind || info.partial) {
          try { for (const i of await deps.fetchInfo([key])) sw.info.set(i.key, i); } catch {}
          info = sw.info.get(key);
        }
        const it = sw.items.find((i) => i.uid === uid);
        if (!info?.kind || !it) return;
        const ok = await deps.fileItem(info, { condition: "NM", variant: it.finish || "normal" }, 1);
        if (!ok) return;
        sw.items = sw.items.map((x) => (x.uid === uid ? { ...x, filed: Math.min(x.qty, (x.filed || 0) + 1), info: x.info?.kind ? x.info : info } : x));
        const probe = sw.probes.get(key);
        if (probe) deps.learn(key, probe);
        saveSession();
        schedulePortfolioRefresh();
      } catch (e) {
        if (e?.status === 401 || e?.status === 403) return;
        try { console.warn("sweep autoFile", e); } catch {}
      } finally {
        sw.saving.delete(uid);
        if (sw.bar?.uid === uid) renderDock();
        if (sw.drawer) renderDrawer();
        drawOverlay();
      }
    })();
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
    const lines = tagLines({ price, filed: Boolean(it?.filed), saving: sw.saving.has(tag.uid), ownedBefore: Boolean(it?.ownedBefore), qty: it?.qty || 1 });
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
    if (isSweep() && tag.conf) {
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
    ctx.fillText(fitText(ctx, code || "Cardmarket-Trend", tw - 2 * padX), x + padX, ty);
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

  function drawOverlay() {
    const cv = $("ps-sw-overlay");
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const now = Date.now();
    sw.tags = sw.tags.filter((t) => now - t.seen <= TAG_HOLD_MS + TAG_FADE_MS);
    for (const tag of sw.tags) drawTag(ctx, tag, W, H, dpr, now);
  }

  function animateTags() {
    cancelAnimationFrame(sw.tagRaf);
    const step = () => {
      drawOverlay();
      if (sw.running && sw.tags.length) sw.tagRaf = requestAnimationFrame(step);
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
    if (!sw.prefs.muted) {
      if (isNative()) haptic("success");
      else { try { if (navigator.vibrate) navigator.vibrate(35); } catch {} }
    }
    pling();
    const f = $("ps-sw-flash");
    if (f) { f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 80); }
  }

  // ------------------------------------------------------------------ Set-Lock & Modus
  async function ensureSets() {
    if (sw.setsLoaded || sw.setsLoading) return;
    sw.setsLoading = true;
    renderSets();
    try {
      const r = await api("/api/catalog/sets");
      sw.sets = (r?.sets || []).filter((s) => s?.id && s?.name).map((s) => ({ id: String(s.id), name: String(s.name) }));
    } catch { sw.sets = []; }
    sw.setsLoaded = true; sw.setsLoading = false;
    const cur = sw.sets.find((s) => s.id === sw.prefs.setId);
    if (cur) sw.setName = cur.name;
    renderSets(); setStatus(statusLine());
  }

  function sendConfig() {
    deps.worker().postMessage({ type: "sweep-config", setId: sw.prefs.setId || "", mode: sw.prefs.mode });
    sw.configSent = true;
    if (sw.prefs.setId) primeSet(sw.prefs.setId);
  }

  /** Set-Lock aktiv: Katalog des Sets laden → Name/Preis sofort zur Hand, Farb-Layouts im Worker vorberechnen. */
  async function primeSet(setId) {
    try {
      const r = await api(`/api/binder/set/${encodeURIComponent(setId)}`);
      if (sw.prefs.setId !== setId) return;
      sw.setName = r?.set?.name || sw.setName || setId;
      const total = Number(r?.set?.official) || Number(r?.set?.total) || 0;
      const items = [];
      for (const c of r?.catalog || []) {
        if (!c?.id) continue;
        const key = `card:${c.id}`;
        if (!sw.info.get(key)?.kind) {
          sw.info.set(key, {
            key, kind: "card", id: String(c.id), lang: "de", name: String(c.name || ""), setName: sw.setName, setCode: "",
            number: /^\d+$/.test(String(c.localId || "")) && total ? `${c.localId}/${total}` : String(c.localId || ""),
            image: String(c.image || ""), price: c.price ?? null, baseCardId: String(c.id), partial: true,
          });
        }
        if (c.image) items.push({ key, url: cdn(c.image, 120) });
      }
      setStatus(statusLine());
      if (items.length) deps.worker().postMessage({ type: "sweep-layouts", setId, items });
    } catch { /* Set-Lock funktioniert auch ohne Katalog (nur Bild-Fingerabdruck) */ }
  }

  function selectSet(id) {
    const setId = typeof id === "string" && /^[\w.\-]{0,40}$/.test(id) ? id : "";
    sw.prefs.setId = setId; savePrefs();
    sw.setName = sw.sets.find((s) => s.id === setId)?.name || "";
    sw.setRows = -1;
    sw.gate.reset();
    haptic("select");
    renderSets(); setStatus(statusLine());
    sendConfig();
  }

  function setMode(m) {
    if (!MODES[m] || sw.prefs.mode === m) return;
    sw.prefs.mode = m; savePrefs();
    sw.gate.setMode(m);
    sw.gate.reset();
    sw.view = { count: 0, value: 0 };
    haptic("select");
    renderToggles(); renderAll();
    const idle = $("ps-sw-idle");
    if (idle && !sw.running) {
      const ps = idle.querySelectorAll("p");
      if (ps[0]) ps[0].textContent = m === "sweep" ? "🌊" : "⚡";
      if (ps[1]) ps[1].textContent = `${MODES[m].label} – 100 % rahmenlos`;
      if (ps[2]) ps[2].textContent = `${MODES[m].hint} Kein Rahmen, kein Warten: Preisschild erscheint direkt auf der Karte, sie landet sofort in deinem Set-Binder.`;
    }
    sendConfig();
    if (sw.running) toast(MODES[m].label, m === "sweep" ? "Langsam über Ordnerseite oder Tisch fahren – alle Karten gleichzeitig, nur Treffer mit 99–100 % Konfidenz zählen." : "Karte für Karte: jede neue Karte wird sofort erkannt, dieselbe Karte 2,5 s lang nicht doppelt gezählt.");
  }

  function setLang(l) {
    if (!FLAG[l]) return;
    sw.prefs.lang = l; savePrefs();
    deps.ensureLang(l);
    haptic("select"); renderToggles();
  }

  function setFinish(f) {
    if (!FINISH_KEYS.includes(f)) return;
    sw.prefs.finish = f; savePrefs();
    haptic("select"); renderToggles();
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
    sw.items = r.items.map((x) => (x.uid === r.uid && x.filed > x.qty ? { ...x, filed: x.qty } : x));
    sw.history = r.history;
    // Dieselbe Karte darf sofort wieder erkannt werden
    if (it) sw.gate.unlock([it.key]);
    sw.tags = sw.tags.filter((t) => t.uid !== r.uid || sw.items.some((i) => i.uid === r.uid));
    sw.lastUid = sw.items.some((i) => i.uid === sw.lastUid) ? sw.lastUid : sw.items[0]?.uid || null;
    sw.daily = bumpDaily(sw.daily, { count: -1, value: -(it ? priceOf(it) : 0) }); saveDaily();
    if (it?.filed && it.filed >= it.qty) toast("↶ Scan zurückgenommen", "Die Karte liegt weiter im Set-Binder – dort kannst du sie bei Bedarf entfernen.");
    haptic("select");
    hideBar();
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
      if (sw.lastUid === uid) sw.lastUid = twin?.uid || null;
      if (sw.bar?.uid === uid) sw.bar.uid = twin?.uid || uid;
    }
    haptic("select");
    renderAll(); saveSession();
  }

  function changeQty(uid, delta) {
    const it = sw.items.find((i) => i.uid === uid);
    sw.items = sessionQty(sw.items, uid, Number(delta) > 0 ? 1 : -1);
    if (Number(delta) > 0) { sw.history.push(uid); if (it) autoFile(uid, it.key); }
    if (!sw.items.some((i) => i.uid === sw.lastUid)) sw.lastUid = sw.items[0]?.uid || null;
    renderAll(); saveSession();
  }

  function clearSession() {
    if (!sw.items.length) return;
    const open = sw.items.reduce((s, i) => s + Math.max(0, i.qty - (i.filed || 0)), 0);
    if (open && !window.confirm(`${open} Karte${open > 1 ? "n sind" : " ist"} noch nicht im Set-Binder. Session trotzdem leeren?`)) return;
    sw.items = []; sw.history = []; sw.lastUid = null; sw.tags = [];
    sw.gate.reset();
    hideBar();
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
    hideBar();
    haptic("select");
    await completeInfos([it]);
    const info = sw.info.get(it.key);
    if (!info?.kind) { toast("⏳ Kartendaten laden noch", "Einen Moment – dann kannst du die Karte inserieren."); return; }
    const probe = sw.probes.get(it.key);
    if (probe) deps.learn(it.key, probe);
    deps.openQuickList([{ ...info, source: "scan", condition: "nm", variant: it.finish || "normal" }], quick ? { instant: true, strategy: "quick" } : { strategy: "fair" });
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
        const ok = await deps.fileItem(info, { condition: "NM", variant: it.finish || "normal" }, qty);
        if (!ok) break;
        n += qty; sets.add(setIdOfKey(it.key));
        sw.items = sw.items.map((x) => (x.uid === it.uid ? { ...x, filed: x.qty } : x));
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
      for (let n = 0; n < d.extra && rows.length < 40; n++) rows.push({ ...info, source: "scan", condition: "nm", variant: d.finish || "normal" });
    }
    if (!rows.length) return;
    for (const d of dupes) { const p = sw.probes.get(d.key); if (p) deps.learn(d.key, p); }
    deps.openQuickList(rows, {});
  }

  function toggleDrawer(on = !sw.drawer) {
    sw.drawer = on;
    if (on) { hideBar(); completeInfos(sw.items).then(() => { if (sw.drawer) renderAll(); }); }
    renderAll();
  }

  // ------------------------------------------------------------------ Worker-Nachrichten
  function onWorker(m) {
    if (m.type === "sweep-result") { onResult(m); return; }
    if (m.type === "sweep-config-done") { if (m.setId === (sw.prefs.setId || "")) { sw.setRows = m.setId ? m.rows : -1; setStatus(statusLine()); } return; }
    if (m.type === "sweep-layouts-done") { sw.layoutsReady = m.total || 0; return; }
    if (m.type === "sweep-need-layout") {
      const keys = (m.keys || []).filter((k) => typeof k === "string").slice(0, 4);
      if (!keys.length) return;
      deps.fetchInfo(keys).then((infos) => {
        for (const i of infos) if (!sw.info.get(i.key)?.kind) sw.info.set(i.key, i);
        const items = infos.filter((i) => i.image).map((i) => ({ key: i.key, url: cdn(i.image, 120) }));
        if (items.length) deps.worker().postMessage({ type: "sweep-layouts", items });
      }).catch(() => {});
    }
  }

  const actions = {
    start, stop: () => stop(), torch: () => toggleTorch(), mute: () => { sw.prefs.muted = !sw.prefs.muted; savePrefs(); renderToggles(); if (!sw.prefs.muted) pling(); },
    full: () => toggleFull(), set: selectSet, lang: setLang, finish: setFinish, mode: setMode, plus: () => plusOne(), undo,
    dockFinish: (f) => { const uid = sw.bar?.uid || sw.lastUid; if (uid) itemFinish(uid, f); }, itemFinish, qty: changeQty, drawer: () => toggleDrawer(),
    list: (uid) => listItem(uid, false), quick: (uid) => listItem(uid, true),
    file: fileAll, sellDupes, clear: clearSession,
  };

  return {
    html,
    /** Nach dem Einsetzen des HTML: Leisten zeichnen */
    mount() { renderSets(); renderToggles(); renderAll(); },
    /** Beim Öffnen des Scanner-Reiters */
    shown() { renderSets(); renderToggles(); renderAll(); ensureSets(); if (!sw.configSent) sendConfig(); },
    start, stop, onWorker,
    onIndex() { setStatus(statusLine()); },
    get running() { return sw.running || sw.starting; },
    get mode() { return sw.prefs.mode; },
    act(name, ...args) { const f = actions[name]; return f ? f(...args) : null; },
    resize() { if (sw.running) drawOverlay(); },
  };
}
