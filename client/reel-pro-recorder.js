// Aufnahme der Pro-Videos: echte Live-Website als Bildquelle, darüber der Szenen-Compositor
// (Cover → Fokus-Zoom → Nutzen → Vertrauen → Endscreen) mit Untertiteln, Sprecherin und Musik.
// Ausgabe: MP4 1080×1920, H.264 High Profile, 30/60 FPS, AAC 192 kbit/s Stereo, garantiert ≤ 95 MB.

import { pickAvMime, unlockAudio, startSoundtrack } from "./reel-audio.js";
import { VIEW_W, VIEW_H, OUT_W, OUT_H } from "./live-stage.js";
import { CHOREO, runChoreo } from "./reel-scenarios.js";
import { domSource, loadNarration, estimateMarks, pickVideoMime, extOf, VO_LEAD, TAIL } from "./reel-recorder.js";
import { ProCompositor, loadProFonts } from "./reel-compositor.js";
import {
  proScript, checkProScript, sceneTimes, choreoMarks, captionChunks, bitrateFor, shrinkBitrate, speedFor,
  SAFE_MB, MB, AUDIO_KBPS, PRO_MIN_S, PRO_MAX_S,
} from "./reel-pro.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Sprecherin für eine Pro-Vorlage laden und das Tempo so wählen, dass das Video 20–30 s lang wird.
 * @returns {Promise<{ take: object, speed: number, seconds: number }>}
 */
export async function loadProNarration(lines, ac, tone = "energetic") {
  let speed = 1.04;
  let take = await loadNarration(lines, ac, { tone, speed });
  const next = speedFor(take.duration, speed);
  if (next !== speed) { speed = next; take = await loadNarration(lines, ac, { tone, speed }); }
  return { take, speed, seconds: VO_LEAD + take.duration + TAIL };
}

function cuesFor(scenes) {
  const [, f, b, t, c] = scenes;
  return [[0.02, "impact"], [f.start, "cut"], [f.start + 0.5, "swipe"], [b.start, "cut"], [b.start + 0.6, "pop"], [b.start + 1.4, "pop"],
    [t.start, "cut"], [t.start + 0.5, "coin"], [c.start, "riser"], [c.start + 0.05, "finale"]];
}

/**
 * Ein Pro-Video aufnehmen.
 * @param {object} o
 * @param {object} o.tpl        Vorlage aus reel-pro.js
 * @param {number} [o.variant]  Hook-Variante (rotiert)
 * @param {object|null} o.voice Ergebnis von loadNarration() (oder null = nur Musik, 26 s)
 * @param {number} o.mbit       gewünschte Video-Bitrate (wird für das 95-MB-Limit automatisch begrenzt)
 * @param {30|60} [o.fps]
 * @param {number} [o.maxMb]
 * @returns {Promise<null | { blob, ext, mime, duration, facts, lines, fps, liveFps, capture, mbit, cover, scenes }>}
 */
export async function recordPro({ stage, tpl, variant = 0, look = null, coverCard = null, voice = null, mbit = 15, fps = 30, maxMb = SAFE_MB, canvas, onStatus, onTick }) {
  const { mime, audio } = pickAvMime(pickVideoMime);
  if (mime === null || typeof canvas.captureStream !== "function") throw new Error("Dieser Browser kann nicht aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.");
  const script = proScript(tpl, variant);
  const chk = checkProScript(script.say);
  if (!chk.ok) throw new Error(`Skript „${tpl.label}“ hat ${chk.words} Wörter (erlaubt ${chk.min}–${chk.max})`);
  const choreo = CHOREO[tpl.choreo];
  if (!choreo) throw new Error(`Keine Live-Choreografie für „${tpl.choreo}“`);
  const speech = voice ? voice.buffer.duration : 0;
  const D = voice ? VO_LEAD + speech + TAIL : 26;
  const marks = voice ? voice.marks.map((m) => ({ start: VO_LEAD + m.start, end: VO_LEAD + m.end })) : estimateMarks(script.say, D);
  const scenes = sceneTimes(marks, D);
  const captions = captionChunks(script.show, marks);
  const useMbit = bitrateFor(D, mbit, maxMb);
  const ac = audio || voice ? unlockAudio() : null;
  if (voice && !ac) throw new Error("Dieser Browser kann keinen Ton mit aufnehmen – für das Voiceover bitte Chrome oder Edge verwenden.");

  let src = null, rec = null, sound = null, vstream = null, painting = false, choreoRun = null, aborted = false, error = null;
  const onHide = () => { if (document.hidden) { aborted = true; stage.abort(); if (rec?.state === "recording") rec.stop(); } };
  try {
    onStatus?.(`🌐 Lade die Live-Website (${tpl.label}) …`);
    await stage.load({ tab: tpl.tab });
    await choreo.setup(stage);
    await stage.idle();
    await loadProFonts();
    src = await domSource(stage, onStatus);
    const live = document.createElement("canvas"); live.width = OUT_W; live.height = OUT_H;
    const lctx = live.getContext("2d", { alpha: false });
    src.draw(lctx);
    const sx = OUT_W / VIEW_W, sy = OUT_H / VIEW_H;
    const comp = new ProCompositor({
      tpl, cover: script.cover, badge: script.badge, look, coverCard, scenes, captions, facts: stage.facts,
      focus: () => { const f = stage.finger; return f && f.el?.style.opacity !== "0" ? { x: f.x * sx, y: f.y * sy } : null; },
    });
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext("2d", { alpha: false });
    comp.draw(ctx, 0, live); // Frame 0 = fertiges Cover (Vorschaubild), ohne Einblendung
    // exakt dieses Bild wird als JPEG-Vorschaubild ausgeliefert
    let thumb = null;
    try { thumb = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92)); } catch { thumb = null; }
    comp.draw(ctx, 0, live);
    if (ac && ac.state !== "running") { try { await ac.resume(); } catch { /* unten geprüft */ } }
    if (voice && ac?.state !== "running") throw new Error("Tonspur konnte nicht gestartet werden (AudioContext blockiert) – bitte erneut klicken.");
    vstream = canvas.captureStream(fps);
    document.addEventListener("visibilitychange", onHide);
    const placed = voice ? [{ id: "narration", start: VO_LEAD, stop: VO_LEAD + speech, buffer: voice.buffer, rate: 1 }] : [];
    if (ac && ac.state === "running") {
      try { sound = startSoundtrack(ac, D, cuesFor(scenes), tpl.key.length + variant, placed); } catch (e) { if (voice) throw e; sound = null; }
    }
    if (voice && !sound?.voiceEnded) throw new Error("Tonspur mit Sprecherin konnte nicht gestartet werden");
    const stream = sound ? new MediaStream([...vstream.getVideoTracks(), sound.track]) : vstream;
    const opts = { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.round(useMbit * 1_000_000), ...(sound ? { audioBitsPerSecond: AUDIO_KBPS * 1000 } : {}) };
    try { rec = new MediaRecorder(stream, opts); } catch (e) { throw new Error(`Aufnahme konnte nicht starten: ${e.message}`); }
    const chunks = [];
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onerror = (e) => { error = e.error?.message || "unbekannt"; aborted = true; stage.abort(); };
    rec.start(250);
    const startPerf = performance.now();
    const clock = sound ? () => ac.currentTime - sound.t0 : () => (performance.now() - startPerf) / 1000;
    src.start();
    painting = true;
    let frames = 0;
    const paint = () => {
      if (!painting) return;
      const t = clamp(clock(), 0, D);
      const k = comp.sceneAt(t).key;
      if (k !== "cover" && k !== "cta") src.draw(lctx); // Live-Bild nur, wenn es zu sehen ist
      comp.draw(ctx, t, live); frames++;
      onTick?.(t, D);
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
    onStatus?.(`⏺ Pro-Video „${tpl.label}“ läuft (${fps} FPS, ${useMbit} Mbit/s) – Tab sichtbar lassen …`);
    choreoRun = runChoreo(stage, tpl.choreo, choreoMarks(scenes), () => Math.max(0, clock()), scenes[4].start);
    if (sound?.voiceEnded) {
      const watchdog = new Promise((_, reject) => {
        const t = setInterval(() => {
          if (aborted) { clearInterval(t); reject(new Error("abgebrochen")); }
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
    comp.draw(ctx, D, live);
    stage.abort();
    if (rec.state === "recording") rec.stop();
    await done;
    if (error) throw new Error(`Aufnahmefehler: ${error}`);
    if (aborted) return null;
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error("Die Aufnahme ist leer.");
    const duration = clock();
    return {
      blob, ext: extOf(type), mime: rec.mimeType || type, duration, facts: { ...stage.facts }, lines: script.say, cover: script.cover,
      fps: Math.round(frames / Math.max(0.1, duration)), liveFps: Math.round(src.rate()), capture: "pro", mbit: useMbit, scenes, thumb, badge: script.badge, look,
    };
  } catch (e) {
    if (aborted && !error && /abgebrochen/.test(e?.message || "")) return null;
    throw e;
  } finally {
    painting = false;
    document.removeEventListener("visibilitychange", onHide);
    stage.abort();
    try { if (rec?.state === "recording") rec.stop(); } catch { /* egal */ }
    try { await choreoRun; } catch { /* abgebrochen */ }
    src?.stop();
    sound?.stop();
    vstream?.getTracks().forEach((t) => t.stop());
    stage.restoreStorage();
  }
}

/**
 * Pro-Video mit Größen-Garantie: liegt die Datei über maxMb, wird mit angepasster Bitrate neu aufgenommen
 * (höchstens 2 weitere Versuche). So lehnt Make.com Core (100 MB) den Upload nie ab.
 */
export async function recordProSafe(o) {
  const maxMb = o.maxMb || SAFE_MB;
  let mbit = o.mbit;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await recordPro({ ...o, mbit, maxMb });
    if (!res) return null;
    if (res.blob.size <= maxMb * MB) return { ...res, attempts: attempt };
    mbit = shrinkBitrate(res.mbit, res.blob.size, maxMb);
    o.onStatus?.(`⚖️ ${(res.blob.size / MB).toFixed(1)} MB liegt über ${maxMb} MB – nehme mit ${mbit} Mbit/s neu auf …`);
  }
  throw new Error(`Das Video bleibt trotz reduzierter Bitrate über ${maxMb} MB – bitte 30 FPS wählen.`);
}

export { PRO_MIN_S, PRO_MAX_S };
