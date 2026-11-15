// PokeSwipe & Radar – Live-Kamera-Scanner (Phase 3): Rückkamera mit Rahmenführung und Taschenlampe, Erkennung im Web Worker
// direkt auf dem Gerät und Live-HUD mit Name, Sprache, Marktpreis, PSA-10-Wert und 1-Tap-Aktionen.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, api, handleError, requireLogin } from "../core.js";
import { SCORE_STRONG } from "../../server/scan-logic.ts";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const LANG_LABEL = { de: "Deutsch", en: "Englisch", ja: "Japanisch" };
const LANGS_KEY = "ps_scan_langs";
const CARD_RATIO = 63 / 88;
const FRAME_W = 520;
const MIN_INTERVAL_MS = 90;

const sc = {
  stream: null, track: null, worker: null, ready: false, loadingIndex: false, indexCount: 0, perLang: {}, ocrMode: "none",
  running: false, torch: false, timer: 0, canvas: null, ctx: null, lastSent: 0, frames: 0, msSum: 0,
  geometry: null, streakKey: null, streak: 0, current: null, currentAt: 0, info: new Map(), series: [], status: null,
  langs: readLangs(),
};

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
export function liveScanPanelHtml() {
  return `<div id="ps-live-scan" class="poke-glass rounded-3xl p-3 sm:p-5 space-y-3 border-2 border-cyan-400/40">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <span class="text-[10px] font-black uppercase bg-cyan-400 text-slate-950 px-2.5 py-0.5 rounded-full">⚡ Live-Scanner · auf dem Gerät</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Karte vor die Kamera halten – Preis in unter 1 Sekunde</h2>
        <p class="text-xs text-slate-300">Die Erkennung läuft direkt auf deinem Handy: kein Foto-Upload, keine Wartezeit, kein Scan-Limit.</p>
      </div>
      <div class="flex flex-wrap gap-1" role="group" aria-label="Sprachen für die Erkennung">
        ${["de", "en", "ja"].map((l) => `<button type="button" data-scan-lang="${l}" onclick="PS.liveScanLang('${l}')" class="ps-chip text-xs font-black px-2.5 py-1 rounded-lg"></button>`).join("")}
      </div>
    </div>
    <p id="ps-ls-index" class="text-[11px] text-slate-400">Lade Scanner-Status …</p>
    <div id="ps-ls-stage" class="relative mx-auto w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 select-none">
      <video id="ps-ls-video" class="absolute inset-0 w-full h-full object-cover hidden" playsinline muted autoplay></video>
      <div id="ps-ls-idle" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-4xl" aria-hidden="true">📷</p>
        <p class="text-xs text-slate-300">Die Rückkamera wird nur genutzt, solange der Scanner offen ist. Es werden keine Bilder gespeichert oder hochgeladen.</p>
        <button onclick="PS.liveScanStart()" class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm px-6 py-3 rounded-2xl shadow-lg">⚡ Kamera starten</button>
      </div>
      <div id="ps-ls-mask" class="absolute pointer-events-none hidden" style="box-shadow:0 0 0 9999px rgba(2,6,23,.55);border-radius:14px"></div>
      <div id="ps-ls-guide" class="absolute pointer-events-none hidden rounded-[14px] border-2 border-white/70 transition-colors"></div>
      <svg id="ps-ls-quad" class="absolute inset-0 w-full h-full pointer-events-none hidden" aria-hidden="true"><polygon points="" fill="rgba(52,211,153,.12)" stroke="#34d399" stroke-width="3" stroke-linejoin="round"/></svg>
      <p id="ps-ls-hint" class="absolute top-2 inset-x-2 text-center text-[11px] font-bold text-white drop-shadow hidden"></p>
      <div id="ps-ls-tools" class="absolute top-2 right-2 flex flex-col gap-1.5 hidden">
        <button id="ps-ls-torch" onclick="PS.liveScanTorch()" class="hidden w-10 h-10 rounded-full bg-slate-900/80 text-white text-lg" aria-label="Taschenlampe" aria-pressed="false">🔦</button>
        <button onclick="PS.liveScanStop()" class="w-10 h-10 rounded-full bg-slate-900/80 text-white text-lg" aria-label="Kamera beenden">✕</button>
      </div>
      <p id="ps-ls-perf" class="ps-pro-only absolute top-2 left-2 text-[10px] font-mono text-emerald-300 bg-slate-950/70 rounded px-1.5 py-0.5 hidden"></p>
      <div id="ps-ls-hud" class="absolute inset-x-2 bottom-2 hidden" aria-live="polite"></div>
    </div>
    <div class="flex flex-wrap justify-center gap-2 text-xs">
      <button onclick="PS.liveScanPhoto()" class="bg-slate-800 text-white font-bold px-3 py-2 rounded-xl">📸 Nicht erkannt? KI-Foto-Scan</button>
      <button onclick="PS.showSub('scan', 'camera')" class="bg-slate-800 text-white font-bold px-3 py-2 rounded-xl">🔎 Suche ohne Kamera</button>
    </div>
    <div id="ps-ls-series" class="space-y-2"></div>
    <p class="text-[10px] text-slate-500">Tipp: Karte flach halten, Rahmen ausfüllen, Spiegelungen vermeiden – bei wenig Licht die Taschenlampe nutzen. Gleiche Motive in mehreren Sprachen lassen sich im Ergebnis umschalten.</p>
    <div id="ps-ls-admin"></div>
  </div>`;
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
    el.textContent = sc.indexCount ? `✅ ${sc.indexCount.toLocaleString("de-DE")} Karten erkennbar (${parts})${sc.ocrMode !== "none" ? " • Nummern-Erkennung aktiv" : ""}` : "⚠️ Für diese Sprachen sind noch keine Karten im Scanner-Index.";
    return;
  }
  if (!st) { el.textContent = ""; return; }
  const sel = st.langs.filter((l) => sc.langs.includes(l.lang));
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

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("📷 Keine Kamera verfügbar", "Dein Browser erlaubt hier keinen Kamerazugriff. Nutze den KI-Foto-Scan oder die Suche.");
    return;
  }
  if (sc.running) return;
  try {
    sc.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
    toast(denied ? "📷 Kamera nicht erlaubt" : "📷 Kamera nicht verfügbar", denied ? "Erlaube den Kamerazugriff in den Browser-Einstellungen oder nutze den KI-Foto-Scan." : "Keine passende Kamera gefunden.");
    return;
  }
  sc.track = sc.stream.getVideoTracks()[0];
  try { await sc.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {}
  const video = $("ps-ls-video");
  video.srcObject = sc.stream;
  try { await video.play(); } catch {}
  const caps = typeof sc.track.getCapabilities === "function" ? sc.track.getCapabilities() : {};
  $("ps-ls-torch")?.classList.toggle("hidden", !caps.torch);
  sc.torch = false;
  ["ps-ls-video", "ps-ls-mask", "ps-ls-guide", "ps-ls-quad", "ps-ls-hint", "ps-ls-tools", "ps-ls-perf"].forEach((id) => $(id)?.classList.remove("hidden"));
  $("ps-ls-idle")?.classList.add("hidden");
  sc.running = true; sc.frames = 0; sc.msSum = 0; sc.streak = 0; sc.streakKey = null;
  if (!sc.ready && !sc.loadingIndex) loadIndex();
  layout();
  hint(sc.ready ? "Karte in den Rahmen halten" : "⏳ Lade Karten-Index …");
  tick();
}

function stop() {
  sc.running = false;
  clearTimeout(sc.timer);
  try { sc.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  sc.stream = null; sc.track = null;
  const video = $("ps-ls-video");
  if (video) video.srcObject = null;
  ["ps-ls-video", "ps-ls-mask", "ps-ls-guide", "ps-ls-quad", "ps-ls-hint", "ps-ls-tools", "ps-ls-perf", "ps-ls-hud"].forEach((id) => $(id)?.classList.add("hidden"));
  $("ps-ls-idle")?.classList.remove("hidden");
}

async function toggleTorch() {
  if (!sc.track) return;
  try {
    await sc.track.applyConstraints({ advanced: [{ torch: !sc.torch }] });
    sc.torch = !sc.torch;
    const b = $("ps-ls-torch");
    if (b) { b.setAttribute("aria-pressed", String(sc.torch)); b.classList.toggle("bg-yellow-400", sc.torch); b.classList.toggle("bg-slate-900/80", !sc.torch); }
  } catch { toast("🔦 Nicht möglich", "Diese Kamera unterstützt keine Taschenlampe."); }
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
  const m = gw * 0.16;
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

function tick() {
  if (!sc.running) return;
  const panel = $("ps-live-scan");
  // Kamera aus, sobald der Bereich verlassen oder die App in den Hintergrund geht
  if (!panel || panel.offsetParent === null || document.hidden) { stop(); return; }
  const video = $("ps-ls-video");
  const now = performance.now();
  if (sc.ready && video.readyState >= 2 && now - sc.lastSent >= MIN_INTERVAL_MS) {
    const g = sc.geometry && sc.geometry.vw === video.videoWidth ? sc.geometry : layout();
    if (g) {
      g.vw = video.videoWidth;
      if (!sc.canvas) { sc.canvas = document.createElement("canvas"); sc.ctx = sc.canvas.getContext("2d", { willReadFrequently: true }); }
      if (sc.canvas.width !== g.W || sc.canvas.height !== g.H) { sc.canvas.width = g.W; sc.canvas.height = g.H; }
      sc.ctx.drawImage(video, g.sx0, g.sy0, g.sw, g.sh, 0, 0, g.W, g.H);
      const img = sc.ctx.getImageData(0, 0, g.W, g.H);
      sc.lastSent = now;
      sc.worker.postMessage({ type: "frame", w: g.W, h: g.H, data: img.data.buffer, guide: g.guide, ocr: sc.ocrMode !== "none" }, [img.data.buffer]);
    }
  }
  const next = () => tick();
  if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(next);
  else sc.timer = setTimeout(next, 60);
}

// ---------------------------------------------------------------------------
// Ergebnisse
// ---------------------------------------------------------------------------
function drawQuad(r) {
  const g = sc.geometry, poly = document.querySelector("#ps-ls-quad polygon"), guide = $("ps-ls-guide");
  if (!g || !poly) return;
  if (r.found && r.corners) {
    const pts = r.corners.map(([x, y]) => `${(x / g.k + g.sx0) * g.s + g.offX},${(y / g.k + g.sy0) * g.s + g.offY}`).join(" ");
    poly.setAttribute("points", pts);
  } else poly.setAttribute("points", "");
  guide?.classList.toggle("border-emerald-400", !!r.accepted);
  guide?.classList.toggle("border-white/70", !r.accepted);
}

/** Bevorzugte Sprachvariante: Reihenfolge der gewählten Sprachen. */
function orderGroup(group) {
  const rank = (l) => { const i = sc.langs.indexOf(l); return i < 0 ? 9 : i; };
  return [...group].sort((a, b) => rank(a.lang) - rank(b.lang));
}

function onWorker(m) {
  if (m.type === "progress") { if (m.state === "error") toast("⚠️ Index", `${LANG_LABEL[m.lang] || m.lang}: konnte nicht geladen werden.`); return; }
  if (m.type === "ready") {
    sc.ready = true; sc.loadingIndex = false; sc.indexCount = m.count || 0; sc.perLang = m.perLang || {}; sc.ocrMode = m.ocr || "none";
    renderIndexLine();
    if (sc.running) hint(sc.indexCount ? "Karte in den Rahmen halten" : "Noch keine Karten im Index – nutze den KI-Foto-Scan.");
    return;
  }
  if (m.type !== "result" || !sc.running) return;
  if (m.error) return;
  sc.frames++; sc.msSum += m.ms || 0;
  const perf = $("ps-ls-perf");
  if (perf) perf.textContent = `⚡ ${Math.round(m.ms || 0)} ms · Ø ${Math.round(sc.msSum / sc.frames)} ms${m.found ? " · Kanten ✓" : ""}${m.ocr ? ` · Nr. ${m.ocr.text}` : ""}${m.score != null && Number.isFinite(m.score) ? ` · d=${Math.round(m.score)}` : ""}`;
  drawQuad(m);
  if (m.empty) { hint("Noch keine Karten im Index – nutze den KI-Foto-Scan."); return; }
  if (!m.accepted) {
    sc.streak = 0; sc.streakKey = null;
    if (Date.now() - sc.currentAt > 2500) hint(m.sharpness < 6 ? "Etwas mehr Licht oder ruhiger halten" : m.found ? "Erkenne Karte …" : "Karte in den Rahmen halten");
    return;
  }
  const group = orderGroup(m.group || []);
  const keys = group.map((g) => g.key);
  const same = sc.streakKey && keys.some((k) => sc.streakKey.includes(k));
  sc.streak = same ? sc.streak + 1 : 1;
  sc.streakKey = keys;
  // Klarer Treffer (oder passende Kartennummer) sofort, sonst nach zwei übereinstimmenden Bildern
  if (!(m.byNumber || m.score <= SCORE_STRONG || sc.streak >= 2)) return;
  if (sc.current && keys.includes(sc.current.key)) { sc.currentAt = Date.now(); return; }
  showHit(group, m);
}

async function fetchInfo(keys) {
  const missing = keys.filter((k) => !sc.info.has(k));
  if (missing.length) {
    try {
      const { items } = await api(`/api/scan/lookup?keys=${encodeURIComponent(missing.join(","))}`);
      for (const it of items) sc.info.set(it.key, it);
    } catch {}
  }
  return keys.map((k) => sc.info.get(k)).filter(Boolean);
}

async function showHit(group, m) {
  const keys = group.map((g) => g.key).slice(0, 6);
  sc.current = { key: keys[0], keys, info: null };
  sc.currentAt = Date.now();
  try { navigator.vibrate?.(35); } catch {}
  hint("✅ Erkannt");
  renderHud({ loading: true });
  const infos = await fetchInfo(keys);
  if (!sc.current || sc.current.keys !== keys) return;
  if (!infos.length) { sc.current = null; renderHud(null); return; }
  sc.current.variants = infos;
  sc.current.info = infos[0];
  sc.current.key = infos[0].key;
  sc.current.byNumber = m.byNumber;
  addToSeries(infos[0]);
  renderHud(sc.current);
}

const priceTxt = (i) => (i.price ? eur(i.price) : "–");

function renderHud(cur) {
  const hud = $("ps-ls-hud");
  if (!hud) return;
  if (!cur) { hud.classList.add("hidden"); hud.innerHTML = ""; return; }
  hud.classList.remove("hidden");
  if (cur.loading) { hud.innerHTML = `<div class="bg-slate-950/90 backdrop-blur rounded-2xl p-3 text-xs font-bold text-emerald-300">✅ Erkannt – lade Marktpreis …</div>`; return; }
  const i = cur.info;
  const k = jsArg(i.key);
  const canWish = i.kind === "card" || !!i.baseCardId;
  hud.innerHTML = `<div class="bg-slate-950/92 backdrop-blur rounded-2xl p-2.5 border border-emerald-400/60 shadow-2xl space-y-2">
    <div class="flex gap-2.5 items-start">
      <img src="${esc(cdn(i.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-12 h-16 object-contain rounded bg-slate-900 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-black text-white leading-tight truncate">${esc(i.name)} <span class="text-slate-400 font-bold">${esc(i.number || "")}</span></p>
        <p class="text-[10px] text-slate-400 truncate">${FLAG[i.lang] || ""} ${esc(LANG_LABEL[i.lang] || i.lang)}${i.altName ? ` · 🇩🇪 ${esc(i.altName)}` : ""} · ${esc(i.setName)}${i.rarity ? ` · ${esc(i.rarity)}` : ""}</p>
        <div class="flex items-end gap-3 mt-0.5">
          <div><p class="text-[9px] uppercase font-bold text-slate-500">Marktpreis</p><p class="text-lg font-black text-emerald-400 leading-none">${priceTxt(i)}</p></div>
          <div><p class="text-[9px] uppercase font-bold text-slate-500">PSA 10</p><p class="text-sm font-black text-purple-300 leading-none">${i.psa10 ? `${i.psa10Source === "ask" ? "ab " : ""}${eur(i.psa10)}` : "–"}</p></div>
        </div>
      </div>
      <button onclick="PS.liveScanDismiss()" class="text-slate-400 hover:text-white text-sm px-1" aria-label="Ergebnis schließen">✕</button>
    </div>
    ${cur.variants.length > 1 ? `<div class="flex flex-wrap gap-1">${cur.variants.map((v) => `<button onclick="PS.liveScanVariant(${jsArg(v.key)})" class="text-[10px] font-black px-2 py-0.5 rounded-full ${v.key === i.key ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${FLAG[v.lang] || ""} ${esc(v.setCode || v.setName || "")} ${esc(v.number || "")} · ${priceTxt(v)}</button>`).join("")}</div>` : ""}
    <div class="grid grid-cols-4 gap-1.5">
      <button onclick="PS.liveScanAdd(${k})" class="bg-emerald-500 text-slate-950 text-[11px] font-black py-2 rounded-xl">💼 Sammlung</button>
      <button onclick="PS.liveScanWish(${k})" ${canWish ? "" : 'disabled title="Wunschliste gibt es für deutsche und englische Karten"'} class="bg-rose-400 text-slate-950 text-[11px] font-black py-2 rounded-xl disabled:opacity-40">❤️ Wunsch</button>
      <button onclick="PS.liveScanFlip(${k})" class="bg-yellow-400 text-slate-950 text-[11px] font-black py-2 rounded-xl">📈 Flip-Check</button>
      <button onclick="PS.liveScanDetails(${k})" class="bg-slate-800 text-white text-[11px] font-black py-2 rounded-xl">ℹ️ Details</button>
    </div>
  </div>`;
}

function addToSeries(info) {
  if (sc.series[0]?.key === info.key) return;
  sc.series = [info, ...sc.series.filter((s) => s.key !== info.key)].slice(0, 60);
  renderSeries();
}

function renderSeries() {
  const box = $("ps-ls-series");
  if (!box) return;
  if (!sc.series.length) { box.innerHTML = ""; return; }
  const total = sc.series.reduce((s, x) => s + (Number(x.price) || 0), 0);
  box.innerHTML = `<div class="flex items-center justify-between gap-2">
      <p class="text-xs font-black text-white">🗂️ In dieser Sitzung gescannt: ${sc.series.length} Karten • ${eur(total)}</p>
      <div class="flex gap-1.5"><button onclick="PS.liveScanAddAll()" class="bg-emerald-500 text-slate-950 text-[11px] font-black px-2.5 py-1.5 rounded-lg">💼 Alle zur Sammlung</button>
      <button onclick="PS.liveScanClear()" class="bg-slate-800 text-slate-300 text-[11px] font-bold px-2.5 py-1.5 rounded-lg">Leeren</button></div>
    </div>
    <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5">${sc.series.map((s) => `
      <button onclick="PS.liveScanDetails(${jsArg(s.key)})" class="bg-slate-900 border border-slate-800 hover:border-cyan-400 rounded-xl p-1.5 text-[10px] text-white text-center">
        <img src="${esc(cdn(s.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="h-16 mx-auto object-contain" />
        <span class="block truncate font-bold">${FLAG[s.lang] || ""} ${esc(s.name)}</span><span class="block text-emerald-400 font-black">${priceTxt(s)}</span>
      </button>`).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
const infoOf = (key) => sc.info.get(key) || sc.series.find((s) => s.key === key) || null;

async function addOne(info) {
  const body = info.kind === "print" ? { printId: info.id } : { cardId: info.id };
  await api("/api/portfolio", { method: "POST", body });
}

async function addToCollection(key) {
  const i = infoOf(key);
  if (!i || !requireLogin()) return;
  try { await addOne(i); toast("💼 In deiner Sammlung", `${i.name} ${i.number || ""} – mit Live-Preis.`); window.PS?.loadPortfolio?.(); } catch (e) { handleError(e); }
}

async function addAll() {
  if (!sc.series.length || !requireLogin()) return;
  let n = 0;
  for (const i of [...sc.series].reverse()) {
    try { await addOne(i); n++; } catch (e) { handleError(e); break; }
  }
  if (n) { toast("💼 Sammlung ergänzt", `${n} Karte${n > 1 ? "n" : ""} hinzugefügt.`); window.PS?.loadPortfolio?.(); }
}

async function addWish(key) {
  const i = infoOf(key);
  if (!i || !requireLogin()) return;
  const cardId = i.kind === "card" ? i.id : i.baseCardId;
  if (!cardId) { toast("❤️ Nicht möglich", "Die Wunschliste gibt es bisher für deutsche und englische Karten."); return; }
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId } });
    toast("❤️ Auf der Wunschliste", r.offers ? `${r.offers} Angebot${r.offers > 1 ? "e" : ""} gibt es schon – ab ${eur(r.minPrice)}.` : "Wir melden uns bei passenden Angeboten und Deals.");
  } catch (e) { handleError(e); }
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
  if (!sc.running || !video?.videoWidth) { window.PS?.openPhotoScanner?.(); return; }
  const cv = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  cv.width = Math.round(video.videoWidth * scale); cv.height = Math.round(video.videoHeight * scale);
  cv.getContext("2d").drawImage(video, 0, 0, cv.width, cv.height);
  cv.toBlob((blob) => {
    if (!blob) return;
    stop();
    window.PS?.showSub?.("scan", "camera");
    window.PS?.scanFile?.(new File([blob], "scan.jpg", { type: "image/jpeg" }));
  }, "image/jpeg", 0.9);
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

export const liveScanApi = {
  liveScanStart: () => start(),
  liveScanStop: () => stop(),
  liveScanTorch: () => toggleTorch(),
  liveScanLang: setLang,
  liveScanAdd: addToCollection,
  liveScanAddAll: addAll,
  liveScanWish: addWish,
  liveScanFlip: flipCheck,
  liveScanDetails: details,
  liveScanPhoto: photoScan,
  liveScanDismiss: () => { sc.current = null; sc.currentAt = 0; renderHud(null); hint("Karte in den Rahmen halten"); },
  liveScanVariant: (key) => {
    if (!sc.current?.variants) return;
    const v = sc.current.variants.find((x) => x.key === key);
    if (!v) return;
    sc.current.info = v; sc.current.key = v.key;
    sc.series = sc.series.map((s, idx) => (idx === 0 && sc.current.variants.some((x) => x.key === s.key) ? v : s));
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
  loadStatus();
}

export function initLiveScanner() {
  renderLangChips();
  window.addEventListener("resize", () => { if (sc.running) layout(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && sc.running) stop(); });
}
