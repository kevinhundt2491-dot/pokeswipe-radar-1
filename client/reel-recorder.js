// Aufnahme-Kern für Reel Studio und Auto-Reels (10x): nimmt ausschließlich die echte, live laufende Website
// in der 9:16-Stage auf – entweder per Live-DOM-to-Canvas (Standard, ohne Browser-Dialog) oder per nativer
// Tab-Aufnahme (getDisplayMedia mit preferCurrentTab, 60 FPS).
//
// Ablauf jeder Aufnahme (Audio-First):
//  1. ElevenLabs-Sprecherin vollständig erzeugen, MP3 komplett als AudioBuffer dekodieren, exakte Dauer ermitteln
//  2. Live-Website in der Stage laden, alle API-Werte abwarten, alle sichtbaren <img> per Promise.all + decode()
//  3. Frame 0 (vollständiger Live-Screenshot) auf den Canvas zeichnen – ERST DANN MediaRecorder.start()
//  4. Live-Klicks, Swipes und Scrolls laufen auf der Audio-Uhr, getaktet nach den Satz-Zeitstempeln der Stimme
//  5. MediaRecorder stoppt beim onended-Event der Sprecherin + 0,5 s Ausklang (kein fester Timer)

import { api } from "./core.js";
import { pickAvMime, unlockAudio, startSoundtrack } from "./reel-audio.js";
import { DomCapture } from "./dom-capture.js";
import { VIEW_W, VIEW_H, OUT_W, OUT_H } from "./live-stage.js";
import { CHOREO, runChoreo } from "./reel-scenarios.js";
import { scriptFor, countWords } from "./reel-scripts.js";

export { OUT_W, OUT_H };
/** Sprecherin setzt nach VO_LEAD s ein; nach ihrem letzten Wort folgen TAIL s Ausklang. */
export const VO_LEAD = 0.35, TAIL = 0.5;
const DOM_FPS = 30, TAB_FPS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------------------
// Formate
// ---------------------------------------------------------------------------
const VIDEO_MIME = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1.4D4028",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
/** Bestes reines Videoformat (MP4 bevorzugt) – null, wenn MediaRecorder fehlt. */
export function pickVideoMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return VIDEO_MIME.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
}
/** Bestes Format inkl. Ton: { mime, audio }. */
export const pickMime = () => pickAvMime(pickVideoMime);
export const extOf = (mime) => (String(mime || "").startsWith("video/mp4") ? "mp4" : "webm");

// ---------------------------------------------------------------------------
// Sprecherin (ElevenLabs "Matilda") – Audio-First
// ---------------------------------------------------------------------------
const voiceCache = new Map();
const b64ToBuf = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

/**
 * Komplettes Skript in EINEM Take sprechen lassen, MP3 vollständig laden und als AudioBuffer dekodieren.
 * @returns {Promise<{ buffer: AudioBuffer, marks: {start:number,end:number}[], duration: number, words: number, mp3: Blob }>}
 */
export async function loadNarration(lines, ac, { tone = "calm", speed = 1 } = {}) {
  const key = `${tone}|${speed}|${lines.join("\n")}`;
  if (voiceCache.has(key)) return voiceCache.get(key);
  const res = await api("/api/admin/voiceover/narration", { method: "POST", body: { lines, speed, tone } });
  // Lange Takes werden gestreamt (Status 200 sofort) – ein Fehler steht dann im Feld "error"
  if (res?.error) throw new Error(res.error);
  if (!res?.audio || !Array.isArray(res.marks) || res.marks.length !== lines.length) throw new Error("Sprachausgabe unvollständig");
  const bytes = b64ToBuf(res.audio);
  const mp3 = new Blob([bytes.slice(0)], { type: "audio/mpeg" });
  const buffer = await ac.decodeAudioData(bytes);
  if (!buffer?.duration) throw new Error("Sprachdatei konnte nicht dekodiert werden");
  const wordMarks = Array.isArray(res.words) && res.words.length === lines.length ? res.words : null; // Wort-Zeitstempel (neuere Takes)
  const take = { buffer, marks: res.marks, wordMarks, duration: buffer.duration, words: countWords(lines), mp3 };
  voiceCache.set(key, take);
  return take;
}

/** Geschätzte Satzzeiten (nach Wortanzahl) – für Vorschau und Aufnahmen ohne Sprecherin. */
export function estimateMarks(lines, D) {
  const w = lines.map((l) => Math.max(1, countWords(l))), total = w.reduce((a, b) => a + b, 0);
  const span = Math.max(1, D - VO_LEAD - TAIL);
  let acc = 0;
  return w.map((n) => { const start = VO_LEAD + (acc / total) * span; acc += n; return { start, end: VO_LEAD + (acc / total) * span }; });
}

function cuesFor(key, marks, D) {
  const at = (i) => clamp(marks[i]?.start ?? 0, 0.05, D);
  const action = { arena: "swipe", tour: "swipe", flip: "alert", restock: "alert", graded: "coin", portfolio: "coin", scanner: "scan", pricecheck: "coin", market: "match", community: "pop" }[key] || "pop";
  return [[0.02, "impact"], [at(1), action], [at(2), "pop"], [at(3), "cut"]];
}

// ---------------------------------------------------------------------------
// Bildquellen
// ---------------------------------------------------------------------------
/** Live-DOM-to-Canvas: echte DOM-Snapshots der Stage mit bis zu 30 FPS. */
export async function domSource(stage, onStatus, { outW = OUT_W, outH = OUT_H } = {}) {
  const cap = new DomCapture(stage.win, { width: VIEW_W, height: VIEW_H, outW, outH });
  onStatus?.("Bereite Live-DOM-Aufnahme vor (Stylesheets, Schriften, Kartenbilder) …");
  await cap.prepare();
  await stage.decodeImages();
  await cap.primeImages();
  let latest = await cap.snapshot(); // Frame 0 der echten Website
  let running = false, frames = 0, t0 = 0;
  const bg = (() => {
    const c = stage.win.getComputedStyle(stage.doc.body).backgroundColor;
    return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : "#0c1022";
  })();
  const loop = async () => {
    while (running) {
      const t = performance.now();
      try { latest = await cap.snapshot(); frames++; }
      catch { await sleep(20); }
      await sleep(1000 / DOM_FPS - (performance.now() - t));
    }
  };
  return {
    fps: DOM_FPS,
    draw(ctx) { ctx.fillStyle = bg; ctx.fillRect(0, 0, outW, outH); ctx.drawImage(latest, 0, 0, outW, outH); },
    start() { if (running) return; running = true; t0 = performance.now(); loop(); },
    stop() { running = false; },
    rate() { return t0 ? frames / Math.max(0.001, (performance.now() - t0) / 1000) : 0; },
  };
}

/** Native Tab-Aufnahme – MUSS direkt im Klick-Handler aufgerufen werden (Browser-Freigabe). */
export async function requestTabCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Dieser Browser unterstützt keine Tab-Aufnahme (getDisplayMedia).");
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: TAB_FPS, max: TAB_FPS }, displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  });
}

async function tabSource(stream, stage) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track || track.readyState !== "live") throw new Error("Tab-Aufnahme wurde nicht freigegeben oder ist beendet.");
  try { track.contentHint = "detail"; } catch { /* optional */ }
  let cropped = false;
  // Region Capture: Videospur exakt auf das 9:16-iframe der Live-Website zuschneiden (Chrome/Edge)
  if (typeof window.CropTarget?.fromElement === "function" && typeof track.cropTo === "function") {
    try { await track.cropTo(await window.CropTarget.fromElement(stage.frame)); cropped = true; } catch { cropped = false; }
  }
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  await video.play();
  let frames = 0, t0 = 0, counting = false;
  const count = () => { if (!counting) return; frames++; video.requestVideoFrameCallback?.(count); };
  // ein paar echte Frames abwarten (nach dem Zuschneiden), damit Frame 0 sicher die fertige Seite zeigt
  await new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== "function") return setTimeout(resolve, 400);
    let n = 0;
    const cb = () => (++n >= 3 ? resolve() : video.requestVideoFrameCallback(cb));
    video.requestVideoFrameCallback(cb);
  });
  return {
    fps: TAB_FPS,
    draw(ctx) {
      if (!video.videoWidth) return;
      if (cropped) { ctx.drawImage(video, 0, 0, OUT_W, OUT_H); return; }
      const r = stage.frame.getBoundingClientRect();
      const sx = video.videoWidth / window.innerWidth, sy = video.videoHeight / window.innerHeight;
      ctx.drawImage(video, r.left * sx, r.top * sy, r.width * sx, r.height * sy, 0, 0, OUT_W, OUT_H);
    },
    start() { counting = true; t0 = performance.now(); video.requestVideoFrameCallback?.(count); },
    stop() { counting = false; video.pause(); video.srcObject = null; },
    rate() { return t0 && frames ? frames / Math.max(0.001, (performance.now() - t0) / 1000) : TAB_FPS; },
  };
}

// ---------------------------------------------------------------------------
// Aufnahme
// ---------------------------------------------------------------------------
/**
 * Ein Live-Reel aufnehmen.
 * @param {object} o
 * @param {import("./live-stage.js").LiveStage} o.stage
 * @param {object} o.scenario       Szenario aus reel-scripts.js
 * @param {15|30} o.len             Ziellänge (bestimmt das Skript; die echte Länge ergibt sich aus der Stimme)
 * @param {"dom"|"tab"} [o.capture]
 * @param {MediaStream} [o.tabStream]  bei capture = "tab" (vorher per requestTabCapture() geholt)
 * @param {object|null} [o.voice]   Ergebnis von loadNarration() oder null (dann nur Musik)
 * @param {number} [o.mbit]
 * @param {HTMLCanvasElement} o.canvas  Aufnahme-Canvas (1080×1920)
 * @returns {Promise<null | { blob: Blob, ext: string, mime: string, duration: number, facts: object, lines: string[], fps: number, capture: string }>}
 *          null = abgebrochen, weil der Tab verdeckt wurde (bitte neu aufnehmen)
 */
export async function recordLive({ stage, scenario, len, capture = "dom", tabStream = null, voice = null, mbit = 8, canvas, onStatus, onTick }) {
  const { mime, audio } = pickMime();
  if (mime === null || typeof canvas.captureStream !== "function") throw new Error("Dieser Browser kann nicht aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.");
  const lines = scriptFor(scenario, len);
  const choreo = CHOREO[scenario.key];
  if (!choreo) throw new Error(`Keine Live-Choreografie für „${scenario.key}“`);
  // 1) Laufzeit aus der echten Sprachaufnahme (Audio-First)
  const speech = voice ? voice.buffer.duration : 0;
  const D = voice ? VO_LEAD + speech + TAIL : len;
  const marks = voice ? voice.marks.map((m) => ({ start: VO_LEAD + m.start, end: VO_LEAD + m.end })) : estimateMarks(lines, D);
  const ac = audio || voice ? unlockAudio() : null;
  if (voice && !ac) throw new Error("Dieser Browser kann keinen Ton mit aufnehmen – für das Voiceover bitte Chrome oder Edge verwenden.");

  let src = null, rec = null, sound = null, vstream = null, painting = false, choreoRun = null;
  let aborted = false, error = null;
  const onHide = () => { if (document.hidden) { aborted = true; stage.abort(); if (rec?.state === "recording") rec.stop(); } };
  try {
    // 2) Echte Website laden und komplett fertig rendern lassen
    onStatus?.(`🌐 Lade die Live-Website (${scenario.label}) in die 9:16-Stage …`);
    await stage.load({ tab: scenario.tab });
    await choreo.setup(stage);
    onStatus?.("⏳ Warte auf alle Live-Daten und Kartenbilder …");
    await stage.idle();
    // 3) Bildquelle vorbereiten und Frame 0 VOR MediaRecorder.start() zeichnen
    src = capture === "tab" ? await tabSource(tabStream, stage) : await domSource(stage, onStatus);
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext("2d", { alpha: false });
    src.draw(ctx);
    if (ac && ac.state !== "running") { try { await ac.resume(); } catch { /* unten geprüft */ } }
    if (voice && ac?.state !== "running") throw new Error("Tonspur konnte nicht gestartet werden (AudioContext blockiert) – bitte erneut auf Aufnehmen klicken.");
    vstream = canvas.captureStream(src.fps);
    document.addEventListener("visibilitychange", onHide);
    const placed = voice ? [{ id: "narration", start: VO_LEAD, stop: VO_LEAD + speech, buffer: voice.buffer, rate: 1 }] : [];
    if (ac && ac.state === "running") {
      try { sound = startSoundtrack(ac, D, cuesFor(scenario.key, marks, D), scenario.n, placed); } catch (e) { if (voice) throw e; sound = null; }
    }
    if (voice && !sound?.voiceEnded) throw new Error("Tonspur mit Sprecherin konnte nicht gestartet werden");
    const stream = sound ? new MediaStream([...vstream.getVideoTracks(), sound.track]) : vstream;
    const opts = { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.max(8, mbit) * 1_000_000, ...(sound ? { audioBitsPerSecond: 192_000 } : {}) };
    try { rec = new MediaRecorder(stream, opts); }
    catch (e) { throw new Error(`Aufnahme konnte nicht starten: ${e.message}`); }
    const chunks = [];
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { error = e.error?.message || "unbekannt"; aborted = true; stage.abort(); };
    // Frame 0 liegt bereits auf dem Canvas → das Video beginnt ab 0:00 mit der echten Website
    rec.start(250);
    const startPerf = performance.now();
    const clock = sound ? () => ac.currentTime - sound.t0 : () => (performance.now() - startPerf) / 1000;
    src.start();
    painting = true;
    const paint = () => {
      if (!painting) return;
      src.draw(ctx);
      onTick?.(clamp(clock(), 0, D), D);
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
    // 4) Live-Choreografie auf der Audio-Uhr
    onStatus?.(`⏺ Live-Aufnahme läuft (${capture === "tab" ? "native Tab-Aufnahme, 60 FPS" : "Live-DOM, bis 30 FPS"}) – Tab sichtbar lassen …`);
    choreoRun = runChoreo(stage, scenario.key, marks, () => Math.max(0, clock()), D);
    // 5) Ende: Sprecherin fertig (onended) + 0,5 s Ausklang; ohne Stimme: Ende der Musik
    if (sound?.voiceEnded) {
      const watchdog = new Promise((_, reject) => {
        const t = setInterval(() => {
          if (aborted) { clearInterval(t); reject(new Error("abgebrochen")); }
          // Sicherheitsnetz: meldet einen Fehler (verwirft das Video), statt es abzuschneiden
          else if (clock() > D + 6) { clearInterval(t); reject(new Error("Die Sprecherstimme hat nicht ordnungsgemäß geendet – Aufnahme verworfen")); }
        }, 200);
        sound.voiceEnded.finally(() => clearInterval(t));
      });
      await Promise.race([sound.voiceEnded, watchdog]);
      await sleep(TAIL * 1000);
    } else {
      while (!aborted && clock() < D) await sleep(30);
    }
    painting = false;
    src.draw(ctx);
    stage.abort();
    if (rec.state === "recording") rec.stop();
    await done;
    if (error) throw new Error(`Aufnahmefehler: ${error}`);
    if (aborted) return null;
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error("Die Aufnahme ist leer.");
    return { blob, ext: extOf(type), mime: type, duration: clock(), facts: { ...stage.facts }, lines, fps: Math.round(src.rate()), capture };
  } catch (e) {
    if (aborted && !error && /abgebrochen/.test(e?.message || "")) return null;
    throw e;
  } finally {
    painting = false;
    document.removeEventListener("visibilitychange", onHide);
    stage.abort();
    try { if (rec && rec.state === "recording") rec.stop(); } catch { /* egal */ }
    try { await choreoRun; } catch { /* abgebrochen */ }
    src?.stop();
    sound?.stop();
    vstream?.getTracks().forEach((t) => t.stop());
    stage.restoreStorage();
  }
}

/** Choreografie ohne Aufnahme live auf der Stage abspielen (Vorschau, geschätztes Timing). */
export async function previewLive({ stage, scenario, len, onTick }) {
  const lines = scriptFor(scenario, len);
  const D = len;
  const marks = estimateMarks(lines, D);
  try {
    await stage.load({ tab: scenario.tab });
    await CHOREO[scenario.key].setup(stage);
    await stage.idle();
    const t0 = performance.now();
    const clock = () => (performance.now() - t0) / 1000;
    let on = true;
    const tick = () => { if (!on) return; onTick?.(clamp(clock(), 0, D), D); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await runChoreo(stage, scenario.key, marks, clock, D);
    while (!stage.aborted && clock() < D) await sleep(50);
    on = false;
    return { facts: { ...stage.facts } };
  } finally {
    stage.restoreStorage();
  }
}

/** Datei lokal herunterladen. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Text in die Zwischenablage kopieren (mit Fallback für ältere Browser). Liefert true bei Erfolg. */
export async function copyText(text, fallbackEl = null) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback unten */ }
  const ta = fallbackEl || document.createElement("textarea");
  if (!fallbackEl) { ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.append(ta); }
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  if (!fallbackEl) ta.remove();
  return ok;
}
