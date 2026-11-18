// PokeSwipe & Radar – Zero-Latency Sweep-Modus (Live-Scanner ohne Zielrahmen, ohne Wartezeit-Zähler, ohne Server-Wartezeit).
// Handy locker über Kartenstapel oder Ordnerseite ziehen: Jede Karte, die irgendwo im Bild auftaucht, wird im Web Worker
// gefunden, begradigt und per Bild-Fingerabdruck + Farb-Layout erkannt (2-Frame-Konsens, ≥ 86 %). Treffer → kurzer
// Vibrations-Impuls + „Pling“ und ab in die Scan-Liste; die Kamera läuft ohne Unterbrechung weiter.
//
// Diese Datei ist nur Oberfläche + Steuerung. Die Bildverarbeitung steckt in sweep-engine.js (Worker), die reine Logik
// (Konsens, Sperre, Session) in sweep-logic.js. Worker, Index und Kartendaten kommen über deps aus live-scanner.js.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, api, handleError } from "../core.js";
import { haptic, isNative } from "../native.js";
import { conditionPrice } from "./scan-ui-logic.js";
import {
  SWEEP, createSweepGate, orderByLang, langOfKey, setIdOfKey, sessionAdd, sessionQty, sessionFinish, sessionUndo, sessionTotals,
  sessionDuplicates, FINISH_KEYS, FINISH_LABEL,
} from "./sweep-logic.js";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const LANG_NAME = { de: "Deutsch", en: "Englisch", ja: "Japanisch" };
const FIN_SHORT = { normal: "Normal", holo: "Holo", reverse_holo: "Reverse" };
const PREFS_KEY = "ps_sweep_prefs";
const SESSION_KEY = "ps_sweep_session";
/** Bild-Kanal: so lange gilt ein Bild beim Worker als unterwegs, danach wird das nächste geschickt */
const FRAME_STALE_MS = 1000;
/** Mittlere Helligkeit (0…255) darunter gilt das Bild als zu dunkel (Taschenlampe anbieten/einschalten) */
const DARK_LEVEL = 42;
const DARK_FRAMES = 30;
const MAX_ITEMS = 400;

const PLING_CSS = `
#ps-sw .ps-sw-scroll{scrollbar-width:none}#ps-sw .ps-sw-scroll::-webkit-scrollbar{display:none}
#ps-sw-flash{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 0 rgba(52,211,153,0);transition:box-shadow .25s}
#ps-sw-flash.on{box-shadow:inset 0 0 0 4px rgba(52,211,153,.9),inset 0 0 60px rgba(52,211,153,.35);transition:none}
#ps-sw-dock .ps-sw-pop{animation:psSwPop .32s cubic-bezier(.2,.9,.3,1.3)}
@keyframes psSwPop{0%{transform:translateY(10px) scale(.96);opacity:.2}100%{transform:none;opacity:1}}
#ps-sw.ps-sw-full{position:fixed;inset:0;z-index:70;max-width:none;height:100dvh!important;border-radius:0;border:0}
@media (prefers-reduced-motion:reduce){#ps-sw-dock .ps-sw-pop{animation:none}}
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
    frameTimes: [], avgMs: 0, procMs: 0, dark: 0, gate: createSweepGate(), glows: [], lastDets: [], raf: 0,
    items: [], history: [], lastUid: null, uidSeq: Date.now(), info: new Map(), probes: new Map(),
    sets: [], setsLoaded: false, setName: "", setRows: -1, layoutsReady: 0, drawer: false, full: false, audio: null,
    prefs: readPrefs(), configSent: false, statusText: "",
  };
  restoreSession();

  function readPrefs() {
    const def = { muted: false, lang: "de", finish: "normal", setId: "" };
    try {
      const p = { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}) };
      if (!FLAG[p.lang]) p.lang = "de";
      if (!FINISH_KEYS.includes(p.finish)) p.finish = "normal";
      if (typeof p.setId !== "string" || !/^[\w.\-]{0,40}$/.test(p.setId)) p.setId = "";
      return p;
    } catch { return def; }
  }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(sw.prefs)); } catch {} };
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

  function html() {
    return `<div id="ps-sw" class="relative w-full mx-auto max-w-xl rounded-3xl overflow-hidden bg-black border border-cyan-400/40 select-none touch-manipulation" style="height:min(calc(100dvh - 200px),820px);min-height:470px">
      <style>${PLING_CSS}</style>
      <video id="ps-sw-video" class="absolute inset-0 w-full h-full object-cover hidden" playsinline muted autoplay></video>
      <canvas id="ps-sw-overlay" class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true"></canvas>
      <div id="ps-sw-flash"></div>
      <div class="absolute inset-x-0 top-0 p-2 space-y-1.5 bg-gradient-to-b from-slate-950/90 via-slate-950/55 to-transparent pb-5">
        <div class="flex items-center gap-1.5">
          <span id="ps-sw-count" class="shrink-0 text-xs font-black bg-slate-900/85 border border-white/10 text-white px-2.5 py-1.5 rounded-xl" title="Gescannte Karten in dieser Session">🃏 0</span>
          <span id="ps-sw-value" class="shrink-0 text-xs font-black bg-emerald-400 text-slate-950 px-2.5 py-1.5 rounded-xl" title="Gesamtwert (Cardmarket-Trend)">0,00 €</span>
          <span id="ps-sw-status" role="status" class="min-w-0 flex-1 text-[10px] font-bold text-cyan-200 truncate"></span>
          <label class="${iconBtn} cursor-pointer" title="Foto hochladen" aria-label="Foto aufnehmen oder hochladen">🖼️<input data-ls-upload="1" type="file" accept="image/*" class="hidden" /></label>
          <button id="ps-sw-torch" type="button" onclick="PS.sweep('torch')" class="${iconBtn}" aria-label="Taschenlampe" aria-pressed="false">🔦</button>
          <button id="ps-sw-mute" type="button" onclick="PS.sweep('mute')" class="${iconBtn}" aria-label="Ton aus" aria-pressed="false">🔊</button>
          <button id="ps-sw-full" type="button" onclick="PS.sweep('full')" class="${iconBtn}" aria-label="Vollbild" aria-pressed="false">⛶</button>
          <button id="ps-sw-stop" type="button" onclick="PS.sweep('stop')" class="${iconBtn} hidden" aria-label="Kamera beenden">✕</button>
        </div>
        <div id="ps-sw-sets" class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Set-Lock: Suche auf ein Set beschränken"></div>
        <div class="ps-sw-scroll flex items-center gap-1.5 overflow-x-auto">
          <div id="ps-sw-langs" role="group" aria-label="Sprache der gescannten Karten" class="flex gap-1 shrink-0"></div>
          <span class="w-px h-5 bg-white/20 shrink-0"></span>
          <div id="ps-sw-fins" role="group" aria-label="Standard-Variante" class="flex gap-1 shrink-0"></div>
        </div>
      </div>
      <div id="ps-sw-idle" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-950/85">
        <p class="text-4xl" aria-hidden="true">⚡</p>
        <p class="text-base font-black text-white">Sweep-Modus: einfach drüberziehen</p>
        <p class="text-xs text-slate-300 max-w-xs">Handy locker über einen Kartenstapel oder eine Ordnerseite ziehen. Jede Karte im Bild wird sofort erkannt – ohne Rahmen, ohne Warten. Pling, und sie liegt in deiner Scan-Liste.</p>
        <button type="button" onclick="PS.sweep('start')" class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm px-6 py-3 rounded-2xl shadow-lg">⚡ Kamera starten</button>
        <p class="text-[10px] text-slate-500 max-w-xs">Erkennung komplett auf deinem Gerät. Es werden keine Kamerabilder hochgeladen.</p>
      </div>
      <div id="ps-sw-dock" class="absolute inset-x-2 bottom-2" aria-live="polite"></div>
      <div id="ps-sw-drawer" class="absolute inset-x-0 bottom-0 hidden max-h-[80%] flex flex-col bg-slate-950/95 backdrop-blur border-t border-cyan-400/40 rounded-t-3xl"></div>
    </div>`;
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
    if (m) { m.textContent = sw.prefs.muted ? "🔇" : "🔊"; m.setAttribute("aria-pressed", String(sw.prefs.muted)); m.setAttribute("aria-label", sw.prefs.muted ? "Ton an" : "Ton aus"); }
    const t = $("ps-sw-torch");
    if (t) { t.setAttribute("aria-pressed", String(sw.torch)); t.classList.toggle("bg-yellow-400", sw.torch); t.classList.toggle("bg-slate-900/80", !sw.torch); }
    const fb = $("ps-sw-full");
    if (fb) fb.setAttribute("aria-pressed", String(sw.full));
  }

  const priceOf = (it) => {
    const i = it.info || sw.info.get(it.key);
    return i ? conditionPrice(i, it.finish || "normal", "NM") || Number(i.price) || 0 : 0;
  };

  function renderTop() {
    const t = sessionTotals(sw.items, priceOf);
    const c = $("ps-sw-count"), v = $("ps-sw-value");
    if (c) c.textContent = `🃏 ${t.count.toLocaleString("de-DE")}`;
    if (v) v.textContent = eur(t.value);
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

  function renderDock(pop = false) {
    const dock = $("ps-sw-dock");
    if (!dock) return;
    if (sw.drawer) { dock.innerHTML = ""; return; }
    const it = sw.items.find((i) => i.uid === sw.lastUid) || sw.items[0];
    const listBtn = `<button type="button" onclick="PS.sweep('drawer')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black px-2.5 py-2 rounded-xl" aria-label="Scan-Liste öffnen">☰ ${sw.items.length}</button>`;
    if (!it) {
      dock.innerHTML = `<div class="bg-slate-950/75 backdrop-blur rounded-2xl px-3 py-2.5 border border-white/10 flex items-center gap-2">
        <p class="flex-1 text-[11px] text-slate-300">${sw.running ? "Langsam über die Karten ziehen – jede erkannte Karte landet hier." : "Kamera starten und über deine Karten ziehen."}</p>${sw.items.length ? listBtn : ""}</div>`;
      return;
    }
    const i = it.info;
    const price = priceOf(it);
    dock.innerHTML = `<div data-sw-last="${esc(it.uid)}" class="${pop ? "ps-sw-pop " : ""}bg-slate-950/80 backdrop-blur rounded-2xl p-2 border border-emerald-400/50 shadow-2xl space-y-1.5">
      <div class="flex items-center gap-2">
        <img src="${esc(cdn(i?.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-10 h-14 object-contain rounded bg-slate-900 shrink-0" />
        <div class="min-w-0 flex-1">
          <p data-sw-name class="text-sm font-black text-white leading-tight truncate">${FLAG[it.lang] || ""} ${esc(itemName(it))}${it.qty > 1 ? ` <span class="text-emerald-300">×${it.qty}</span>` : ""}</p>
          <p class="text-[11px] text-slate-400 truncate">${esc(itemSet(it))}${it.finish !== "normal" ? ` · ${esc(FIN_SHORT[it.finish])}` : ""}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-[9px] uppercase font-bold text-slate-500 leading-none">Cardmarket</p>
          <p data-sw-price class="text-lg font-black text-emerald-400 leading-tight">${price ? eur(price) : i ? "–" : "…"}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick="PS.sweep('plus')" class="shrink-0 bg-emerald-500 text-slate-950 text-[11px] font-black px-3 py-2 rounded-xl" aria-label="Noch ein Exemplar">+1</button>
        <div role="group" aria-label="Variante" class="flex bg-slate-800/80 rounded-xl p-0.5 shrink-0">${FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('dockFinish', '${f}')" aria-pressed="${it.finish === f}" class="text-[10px] font-black px-2 py-1.5 rounded-lg ${it.finish === f ? "bg-yellow-400 text-slate-950" : "text-slate-300"}">${esc(FIN_SHORT[f])}</button>`).join("")}</div>
        <button type="button" onclick="PS.sweep('undo')" class="shrink-0 bg-slate-800 text-white text-[11px] font-black px-2.5 py-2 rounded-xl" aria-label="Letzten Scan rückgängig machen">↶ Rückgängig</button>
        <span class="flex-1"></span>${listBtn}
      </div>
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
              <p class="text-[10px] text-slate-400 truncate">${esc(itemSet(it))} · ${p ? eur(p) : "–"}${it.filed ? ` · <span class="text-emerald-300">📒 ${Math.min(it.filed, it.qty)}× im Binder</span>` : ""}</p>
              <div class="flex gap-1 mt-1">${FINISH_KEYS.map((f) => `<button type="button" onclick="PS.sweep('itemFinish', ${jsArg(it.uid)}, '${f}')" aria-pressed="${it.finish === f}" class="text-[9px] font-black px-1.5 py-0.5 rounded ${it.finish === f ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-300"}">${esc(FIN_SHORT[f])}</button>`).join("")}</div>
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
        <button type="button" onclick="PS.sweep('file')" ${open ? "" : "disabled"} class="col-span-2 bg-emerald-500 text-slate-950 text-xs font-black py-3 rounded-xl disabled:opacity-40">📒 In Set-Binder einsortieren${open ? ` (${open})` : " · alles erledigt"}</button>
        <button type="button" onclick="PS.sweep('sellDupes')" ${dupes ? "" : "disabled"} class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">🏷️ Doppelte auf Marktplatz${dupes ? ` (${dupes})` : ""}</button>
        <button type="button" onclick="PS.sweep('clear')" ${sw.items.length ? "" : "disabled"} class="bg-slate-800 text-slate-200 text-[11px] font-black py-2.5 rounded-xl disabled:opacity-40">🗑️ Session leeren</button>
      </div>`;
  }

  function renderAll(pop = false) { renderTop(); renderDock(pop); renderDrawer(); setStatus(statusLine()); }

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
    sw.running = true; sw.torch = false; sw.dark = 0; sw.frameTimes = []; sw.inFlight = 0; sw.glows = [];
    sw.gate.reset();
    deps.worker().postMessage({ type: "sweep-reset" });
    renderToggles(); renderAll();
    loop();
  }

  function stop() {
    sw.running = false;
    sw.camGen++;
    sw.starting = false;
    cancelAnimationFrame(sw.raf);
    try { sw.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    sw.stream = null; sw.track = null; sw.torch = false; sw.inFlight = 0;
    const video = $("ps-sw-video");
    if (video) { video.srcObject = null; video.classList.add("hidden"); }
    $("ps-sw-idle")?.classList.remove("hidden");
    $("ps-sw-stop")?.classList.add("hidden");
    if (sw.full) toggleFull(false);
    sw.glows = []; drawOverlay();
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
        .then((bmp) => { if (!sw.running || seq !== sw.seq) { bmp.close?.(); return; } w.postMessage({ type: "sweep-frame", seq, bitmap: bmp, w: g.W, h: g.H }, [bmp]); })
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
    if (m.seq !== sw.seq) return;
    sw.inFlight = 0;
    if (!sw.running || m.skipped || m.error) return;
    const now = performance.now();
    sw.frameTimes.push(now);
    if (sw.frameTimes.length > 20) sw.frameTimes.shift();
    sw.procMs = sw.procMs ? sw.procMs * 0.85 + (m.ms || 0) * 0.15 : m.ms || 0;
    const interval = sw.frameTimes.length > 1 ? (sw.frameTimes[sw.frameTimes.length - 1] - sw.frameTimes[0]) / (sw.frameTimes.length - 1) : 0;
    if (typeof m.setRows === "number" && m.setRows >= 0) sw.setRows = m.setRows;
    checkDark(m.light);
    const dets = Array.isArray(m.dets) ? m.dets : [];
    const { hits, locked } = sw.gate.push({ dets, found: m.found, motion: m.motion }, Date.now(), interval);
    const t = Date.now();
    sw.glows = sw.glows.filter((g) => g.hit && g.until > t);
    for (const d of dets) {
      if (d.match < SWEEP.TRACK_MATCH) continue;
      const isHit = hits.some((k) => k === d.keys), isLocked = locked.some((k) => k === d.keys);
      if (isHit) continue;
      sw.glows.push({ quad: d.quad, hit: false, locked: isLocked, label: isLocked ? "✓" : "", until: t + 160 });
    }
    for (const keys of hits) {
      const d = dets.find((x) => x.keys === keys);
      if (d) onHit(d);
    }
    drawOverlay();
    if (sw.frameTimes.length % 5 === 0) setStatus(statusLine());
  }

  function onHit(d) {
    const keys = orderByLang(d.keys, sw.prefs.lang);
    const key = keys[0];
    const r = sessionAdd(sw.items, { key, finish: sw.prefs.finish, lang: langOfKey(key), label: d.label, info: sw.info.get(key) || null }, ++sw.uidSeq);
    sw.items = r.items.slice(0, MAX_ITEMS);
    sw.history.push(r.uid);
    sw.lastUid = r.uid;
    if (d.probe) sw.probes.set(key, d.probe);
    sw.glows.push({ quad: d.quad, hit: true, label: d.label || "", until: Date.now() + 700 });
    feedback();
    renderAll(true);
    saveSession();
    animateGlows();
    // Name ist schon da (Index auf dem Gerät); Cardmarket-Preis & Bild laden im Hintergrund nach
    loadInfo([key, ...keys.slice(1, 3)]);
  }

  async function loadInfo(keys) {
    const missing = keys.filter((k) => !sw.info.get(k)?.kind);
    if (missing.length) {
      try { for (const i of await deps.fetchInfo(missing)) sw.info.set(i.key, i); } catch {}
    }
    let changed = false;
    sw.items = sw.items.map((it) => {
      const i = sw.info.get(it.key);
      if (i?.kind && it.info?.kind !== i.kind) { changed = true; return { ...it, info: i }; }
      return it;
    });
    if (changed) { renderAll(); saveSession(); }
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

  // ------------------------------------------------------------------ Leuchtrahmen (Canvas-Overlay)
  function drawOverlay() {
    const cv = $("ps-sw-overlay");
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const now = Date.now();
    for (const g of sw.glows) {
      const k = g.hit ? Math.max(0, (g.until - now) / 700) : 1;
      ctx.save();
      ctx.beginPath();
      g.quad.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.closePath();
      ctx.lineJoin = "round";
      if (g.hit) {
        ctx.shadowColor = `rgba(52,211,153,${0.9 * k})`; ctx.shadowBlur = 26 * dpr;
        ctx.strokeStyle = `rgba(52,211,153,${0.95 * k})`; ctx.lineWidth = 4 * dpr;
        ctx.fillStyle = `rgba(52,211,153,${0.16 * k})`; ctx.fill();
      } else {
        ctx.shadowColor = g.locked ? "rgba(52,211,153,.5)" : "rgba(34,211,238,.55)"; ctx.shadowBlur = 14 * dpr;
        ctx.strokeStyle = g.locked ? "rgba(52,211,153,.55)" : "rgba(34,211,238,.6)"; ctx.lineWidth = 2 * dpr;
      }
      ctx.stroke();
      ctx.restore();
      if (g.hit && g.label && k > 0.2) {
        const [x, y] = g.quad[0];
        ctx.save();
        ctx.font = `900 ${12 * dpr}px system-ui, sans-serif`;
        const text = `✓ ${g.label}`.slice(0, 34);
        const tw = ctx.measureText(text).width + 12 * dpr;
        const px = Math.max(4, Math.min(W - tw - 4, x * W)), py = Math.max(20 * dpr, y * H - 8 * dpr);
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.fillStyle = "rgba(16,185,129,.95)";
        ctx.fillRect(px, py - 16 * dpr, tw, 20 * dpr);
        ctx.fillStyle = "#02130d";
        ctx.fillText(text, px + 6 * dpr, py - 2 * dpr);
        ctx.restore();
      }
    }
  }

  function animateGlows() {
    cancelAnimationFrame(sw.glowRaf);
    const step = () => {
      drawOverlay();
      if (sw.glows.some((g) => g.hit && g.until > Date.now())) sw.glowRaf = requestAnimationFrame(step);
    };
    sw.glowRaf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ Feedback: Vibration + „Pling“
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      sw.audio ||= new AC();
      if (sw.audio.state === "suspended") sw.audio.resume().catch(() => {});
    } catch {}
  }

  /** Kurzer, heller „Pling“ (zwei Sinus-Teiltöne, schneller Anschlag, weiches Ausklingen) – ohne Audiodatei. */
  function pling() {
    if (sw.prefs.muted) return;
    try {
      unlockAudio();
      const ctx = sw.audio;
      if (!ctx) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      out.connect(ctx.destination);
      for (const [f, g] of [[1760, 1], [2637, 0.35]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(f, t);
        og.gain.setValueAtTime(g, t);
        o.connect(og).connect(out);
        o.start(t); o.stop(t + 0.27);
      }
    } catch {}
  }

  function feedback() {
    if (isNative()) haptic("success");
    else { try { if (navigator.vibrate) navigator.vibrate(35); } catch {} }
    pling();
    const f = $("ps-sw-flash");
    if (f) { f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 90); }
  }

  // ------------------------------------------------------------------ Set-Lock
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
    deps.worker().postMessage({ type: "sweep-config", setId: sw.prefs.setId || "" });
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
  }

  function undo() {
    const r = sessionUndo(sw.items, sw.history);
    if (!r.uid) { toast("↶ Nichts zum Rückgängigmachen", "In dieser Session wurde noch nichts gescannt."); return; }
    const it = sw.items.find((i) => i.uid === r.uid);
    sw.items = r.items; sw.history = r.history;
    // Dieselbe Karte darf sofort wieder erkannt werden
    if (it) sw.gate.unlock([it.key]);
    sw.lastUid = sw.items.some((i) => i.uid === sw.lastUid) ? sw.lastUid : sw.items[0]?.uid || null;
    haptic("select");
    renderAll(); saveSession();
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
    }
    haptic("select");
    renderAll(); saveSession();
  }

  function changeQty(uid, delta) {
    sw.items = sessionQty(sw.items, uid, Number(delta) > 0 ? 1 : -1);
    if (Number(delta) > 0) sw.history.push(uid);
    if (!sw.items.some((i) => i.uid === sw.lastUid)) sw.lastUid = sw.items[0]?.uid || null;
    renderAll(); saveSession();
  }

  function clearSession() {
    if (!sw.items.length) return;
    const open = sw.items.reduce((s, i) => s + Math.max(0, i.qty - (i.filed || 0)), 0);
    if (open && !window.confirm(`${open} Karte${open > 1 ? "n sind" : " ist"} noch nicht im Set-Binder. Session trotzdem leeren?`)) return;
    sw.items = []; sw.history = []; sw.lastUid = null;
    sw.gate.reset();
    renderAll(); saveSession();
  }

  /** Infos (Art + ID) für alle Einträge sicherstellen – nötig zum Einsortieren und Inserieren. */
  async function completeInfos(list) {
    const need = [...new Set(list.filter((it) => !sw.info.get(it.key)?.kind || sw.info.get(it.key)?.partial).map((it) => it.key))];
    for (let i = 0; i < need.length; i += 8) {
      try { for (const x of await deps.fetchInfo(need.slice(i, i + 8))) sw.info.set(x.key, x); } catch {}
    }
    sw.items = sw.items.map((it) => (sw.info.get(it.key)?.kind ? { ...it, info: sw.info.get(it.key) } : it));
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
    if (on) completeInfos(sw.items).then(() => { if (sw.drawer) renderAll(); });
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
    full: () => toggleFull(), set: selectSet, lang: setLang, finish: setFinish, plus: () => plusOne(), undo,
    dockFinish: (f) => { if (lastItem()) itemFinish(sw.lastUid, f); }, itemFinish, qty: changeQty, drawer: () => toggleDrawer(),
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
    act(name, ...args) { const f = actions[name]; return f ? f(...args) : null; },
    resize() { if (sw.running) drawOverlay(); },
  };
}
