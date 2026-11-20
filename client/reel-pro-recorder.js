// Aufnahme der Pro-Videos: echte Live-Website als Bildquelle, darüber der Szenen-Compositor
// (Cover → Fokus-Zoom → Nutzen → Vertrauen → Endscreen) mit Untertiteln, Sprecherin und Musik.
// Ausgabe: MP4 1080×1920, H.264, 30/60 FPS, AAC 192 kbit/s Stereo, garantiert ≤ 95 MB.
//
// Zeitbasis (frame-genau):
//  1. Die Sprecherin wird VOR der Aufnahme komplett dekodiert; ihre exakte Sprechdauer wird aus den PCM-Samples
//     gemessen. Videolänge = Vorlauf + Sprechdauer + 0,8 s Ausblenden, gerundet auf das Frame-Raster (N / fps).
//  2. Die komplette Tonspur wird offline sample-genau auf genau diese Länge gerendert.
//  3. Einzige Uhr während der Aufnahme ist die AudioContext-Zeit. Szenen, Animationen, Untertitel, Live-Choreografie
//     und der Zeitstempel jedes Video-Frames (k / fps) leiten sich daraus ab – keine setTimeout-Ketten.
//  4. WebCodecs schreibt Frames und Samples mit exakten Zeitstempeln ins MP4 (kein Drift, kein Abschneiden).
//     Browser ohne WebCodecs-AAC nutzen den MediaRecorder als Rückfall (gleiche Zeitbasis, gleiche Länge).

import { pickAvMime, unlockAudio, startSoundtrack, renderSoundtrack } from "./reel-audio.js";
import { VIEW_W, VIEW_H, OUT_W, OUT_H } from "./live-stage.js";
import { CHOREO, runChoreo } from "./reel-scenarios.js";
import { domSource, loadNarration, estimateMarks, pickVideoMime, extOf, DEFAULT_VOICE_SPEED } from "./reel-recorder.js";
import { ProCompositor, loadProFonts } from "./reel-compositor.js";
import { exactMp4Support, ExactMp4Writer } from "./reel-mp4.js";
import {
  proScript, checkProScript, sceneTimes, choreoMarks, captionChunks, bitrateFor, shrinkBitrate, speedFor, audibleEnd, frameGrid,
  secondsFor, scenesFor, isHook4, segmentReport, SAFE_MB, MB, AUDIO_KBPS, PRO_MIN_S, PRO_MAX_S, PRO_LEAD, END_FADE,
  isShowcase, showcaseScript, checkTemplateScript, showcaseScenes, showcaseMarks, templateCues, showcaseSpec,
} from "./reel-pro.js";
import { fitVoice } from "./voice-fit.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Live-Bild der App in 1,5-facher Ausgabeauflösung (1620×2880) – bleibt beim Zoom im Smartphone-Rahmen gestochen scharf. */
const LIVE_SCALE = 1.5;
const LIVE_W = Math.round(OUT_W * LIVE_SCALE), LIVE_H = Math.round(OUT_H * LIVE_SCALE);
const NO_VOICE_S = 26;

/**
 * Sprecherin für eine Pro-Vorlage laden und das Tempo so wählen, dass das Video 20–30 s lang wird.
 * @returns {Promise<{ take: object, speed: number, seconds: number }>}
 */
export async function loadProNarration(lines, ac, tone = "energetic", range = [PRO_MIN_S, PRO_MAX_S], cap = 1.12, { format = "", startSpeed = 0, fit: fitOpts = null, voiceId = "" } = {}) {
  const vo = voiceId ? { voiceId } : {};
  // Exakte Länge (Showcase 29 s): natürliches Tempo, bis zu 2 Feinanpassungen, damit das letzte Wort
  // spätestens 0,8 s vor dem Ende fällt – das Video bleibt dann frame-genau exakt `range[1]` Sekunden lang.
  // Master-Vorlagen (fitOpts): Start direkt mit dem Höchsttempo; reicht es nicht, werden Sprechpausen gekürzt und die
  // Stimme tonhöhenneutral um höchstens fitOpts.maxStretch gerafft (fitTake) – so bleibt das Video exakt 29 s.
  if (format === "showcase" || format === "autobinder" || range[0] === range[1]) {
    const fit = range[1] - PRO_LEAD - END_FADE;
    let speed = Math.min(cap, Number(startSpeed) > 0 ? Number(startSpeed) : DEFAULT_VOICE_SPEED);
    let take = await loadNarration(lines, ac, { tone, speed, format, ...vo });
    for (let i = 0; i < 2; i++) {
      const sec = speechSeconds(take);
      const want = sec > fit ? Math.min(cap, Math.ceil(speed * (sec / (fit - 0.25)) * 100) / 100)
        : sec < fit - 4 ? Math.max(0.9, Math.round(speed * (sec / (fit - 1.5)) * 100) / 100) : speed;
      if (want === speed) break;
      try { take = await loadNarration(lines, ac, { tone, speed: want, format, ...vo }); speed = want; }
      catch (e) { console.warn("Showcase-Voiceover: Tempo-Anpassung fehlgeschlagen, nutze vorherigen Take", e); break; }
    }
    let fitted = null;
    if (fitOpts && speechSeconds(take) > fit - 0.05) {
      try { fitted = fitTake(take, ac, fit - 0.08, fitOpts); if (fitted) take = fitted; }
      catch (e) { console.warn("Master-Voiceover: Längen-Anpassung fehlgeschlagen, nutze Original-Take", e); }
    }
    return { take, speed, seconds: Math.max(range[1], PRO_LEAD + speechSeconds(take) + END_FADE), fitted: fitted ? fitted.fit : null };
  }
  // Kurze Vorlagen (z. B. 15–20 s) starten gleich mit dem schnellsten erlaubten Tempo (Hook-Presets: 1,2)
  let speed = Number(startSpeed) > 0 ? Math.min(cap, Number(startSpeed)) : range[1] <= 20 ? cap : Math.min(cap, DEFAULT_VOICE_SPEED);
  let take = await loadNarration(lines, ac, { tone, speed, format, ...vo });
  const next = speedFor(speechSeconds(take), speed, range, cap);
  if (next !== speed) {
    // Zweiter Take nur zur Feinanpassung der Länge – scheitert er, bleibt der erste (fertige) Take
    try { take = await loadNarration(lines, ac, { tone, speed: next, format, ...vo }); speed = next; }
    catch (e) { console.warn("Pro-Voiceover: Tempo-Anpassung fehlgeschlagen, nutze ersten Take", e); }
  }
  // Aktuelle Pro-Videos (fitOpts): ist die Stimme trotz Höchsttempo länger als die Ziellänge, werden Sprechpausen
  // gekürzt und die Stimme tonhöhenneutral um höchstens fitOpts.maxStretch gerafft.
  // fitOpts.target: Wunschlänge des Videos (z. B. Video 4: 38 s) statt der Obergrenze; fitOpts.hardMax: harte Grenze –
  // liegt die Stimme danach noch darüber, wird der Original-Take einmalig mit fitOpts.hardStretch auf hardMax gebracht.
  let fitted = null;
  const fitTo = (Number(fitOpts?.target) > 0 ? Number(fitOpts.target) : range[1]) - PRO_LEAD - END_FADE;
  const original = take;
  if (fitOpts && speechSeconds(take) > fitTo) {
    try { fitted = fitTake(take, ac, fitTo - 0.05, fitOpts); if (fitted) take = fitted; }
    catch (e) { console.warn("Pro-Voiceover: Längen-Anpassung fehlgeschlagen, nutze Original-Take", e); }
    const hard = Number(fitOpts.hardMax) > 0 ? Number(fitOpts.hardMax) - PRO_LEAD - END_FADE : 0;
    if (hard && speechSeconds(take) > hard && Number(fitOpts.hardStretch) > Number(fitOpts.maxStretch || 1.1)) {
      try { const f2 = fitTake(original, ac, hard - 0.05, { ...fitOpts, maxStretch: Number(fitOpts.hardStretch) }); if (f2) { fitted = f2; take = f2; } }
      catch (e) { console.warn("Pro-Voiceover: Notbremse fehlgeschlagen", e); }
    }
  }
  return { take, speed, seconds: PRO_LEAD + speechSeconds(take) + END_FADE, fitted: fitted ? fitted.fit : null };
}

/**
 * Take auf höchstens `target` Sekunden Sprechzeit bringen (Pausen kürzen, dann tonhöhenneutral raffen).
 * Erzeugt einen NEUEN Take (der zwischengespeicherte Original-Take bleibt unverändert) inkl. umgerechneter Satz-
 * und Wort-Zeitstempel. null, wenn nichts zu tun ist.
 */
export function fitTake(take, ac, target, { maxStretch = 1.1, minPause = 0.24, keep = 0.14 } = {}) {
  const b = take.buffer;
  const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const before = speechSeconds(take);
  const r = fitVoice(chans, b.sampleRate, before, target, { maxStretch, minPause, keep });
  if (!r.changed) return null;
  const buffer = ac.createBuffer(r.channels.length, r.channels[0].length, b.sampleRate);
  r.channels.forEach((ch, c) => buffer.copyToChannel(ch, c));
  const m = (x) => ({ ...x, start: r.map(Number(x.start) || 0), end: r.map(Number(x.end) || 0) });
  return {
    ...take, buffer, duration: buffer.duration, speechEnd: undefined,
    marks: (take.marks || []).map(m), wordMarks: take.wordMarks ? take.wordMarks.map((ws) => (ws || []).map(m)) : null,
    fit: { before: +before.toFixed(3), after: +r.speech.toFixed(3), pausesSaved: +r.saved.toFixed(3), stretch: r.factor },
  };
}

/** Exakte Sprechdauer eines dekodierten Takes (letztes hörbares Sample, nie kürzer als das letzte Wort). */
export function speechSeconds(take) {
  if (take.speechEnd) return take.speechEnd;
  const b = take.buffer;
  const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const lastWord = Math.max(0, ...(take.marks || []).map((m) => Number(m.end) || 0));
  take.speechEnd = Math.min(b.duration, Math.max(audibleEnd(chans, b.sampleRate), lastWord + 0.06));
  return take.speechEnd;
}

function cuesFor(scenes) {
  if (scenes[0]?.key === "hook") {
    // Hook-Presets: Impact sofort auf Frame 0, Swipe/Pop im UI-Beweis, Klick-Pop im USP, Riser zur Frage
    const [, p, u, a] = scenes;
    return [[0.02, "impact"], [0.5, "pop"], [p.start, "cut"], [p.start + 0.4, "swipe"], [p.start + 1.6, "coin"],
      [u.start, "cut"], [u.start + 0.7, "pop"], [a.start - 0.4, "riser"], [a.start, "finale"]];
  }
  const [, f, b, t, c] = scenes;
  return [[0.02, "impact"], [f.start, "cut"], [f.start + 0.5, "swipe"], [b.start, "cut"], [b.start + 0.6, "pop"], [b.start + 1.4, "pop"],
    [t.start, "cut"], [t.start + 0.5, "coin"], [c.start, "riser"], [c.start + 0.05, "finale"]];
}

/**
 * Uhr auf Basis der AudioContext-Zeit. getOutputTimestamp() koppelt die Audio-Zeit an performance.now(),
 * damit sie zwischen zwei Audio-Blöcken nicht springt (sonst ruckeln die Frames). Monoton steigend.
 */
function audioClock(ac) {
  if (!ac || ac.state !== "running") return null;
  const now = () => {
    try {
      const ts = ac.getOutputTimestamp?.();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    } catch { /* unten */ }
    return ac.currentTime;
  };
  const t0 = now();
  let last = 0;
  return () => { last = Math.max(last, now() - t0); return last; };
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
 * @returns {Promise<null | { blob, ext, mime, duration, facts, lines, fps, liveFps, capture, mbit, cover, scenes, exact }>}
 */
export async function recordPro({ stage, tpl, variant = 0, look = null, coverCard = null, voice = null, mbit = 18, fps = 30, maxMb = SAFE_MB, canvas, onStatus, onTick }) {
  const show = isShowcase(tpl);
  if (show) fps = tpl.fps || 60; // Showcase: immer 60 FPS
  const script = show ? showcaseScript(tpl, variant) : proScript(tpl, variant);
  const chk = checkTemplateScript(tpl, script.say); // Showcase/Feature-Vorlagen mit eigenem Wortlimit, sonst Standard
  if (!chk.ok) throw new Error(`Skript „${tpl.label}“ hat ${chk.words} Wörter (erlaubt ${chk.min}–${chk.max})`);
  const choreo = CHOREO[tpl.choreo];
  if (!choreo) throw new Error(`Keine Live-Choreografie für „${tpl.choreo}“`);

  // ---- 1. Zeitplan aus der vollständig dekodierten Sprecherin ----
  const speech = voice ? speechSeconds(voice) : 0; // exactAudioDuration (gemessen an den Samples)
  // Showcase: exakt 29 s (1740 Frames bei 60 FPS) – nur falls die Sprecherin trotz Höchsttempo länger braucht, wird verlängert
  const want = show ? Math.max(tpl.exact, voice ? PRO_LEAD + speech + END_FADE : 0) : voice ? PRO_LEAD + speech + END_FADE : Math.min(NO_VOICE_S, secondsFor(tpl)[1]);
  const { frames: N, duration: D } = frameGrid(want, fps);
  const shift = (m) => ({ start: PRO_LEAD + m.start, end: PRO_LEAD + m.end });
  const marks = voice ? voice.marks.map(shift) : estimateMarks(script.say, D);
  const wordMarks = voice?.wordMarks ? voice.wordMarks.map((ws) => ws.map(shift)) : null;
  const scenes = show ? showcaseScenes(D, tpl.plan) : sceneTimes(marks, D, scenesFor(tpl));
  // Kurz-Reels ohne Sprecherin: keine Untertitel – der große Hook-Text oben trägt die Botschaft
  const captions = tpl.short && !voice ? [] : captionChunks(script.show, marks, wordMarks);
  const audioFade = tpl.noFade ? 0.15 : END_FADE;
  const mixOpts = show ? { studio: true, ...(tpl.sfxOnly ? { sfxOnly: true } : {}) } : {};
  const useMbit = show ? Math.min(bitrateFor(D, tpl.mbit || mbit, maxMb), 12) : bitrateFor(D, mbit, maxMb);
  const cues = show ? templateCues(tpl, scenes) : cuesFor(scenes), seed = tpl.key.length + variant;
  const placed = voice ? [{ id: "narration", start: PRO_LEAD, stop: PRO_LEAD + speech, buffer: voice.buffer, rate: 1 }] : [];

  const exactCfg = await exactMp4Support({ width: OUT_W, height: OUT_H, fps, mbit: useMbit, audioKbps: AUDIO_KBPS });
  const { mime, audio } = exactCfg ? { mime: "video/mp4", audio: true } : pickAvMime(pickVideoMime);
  if (!exactCfg && (mime === null || typeof canvas.captureStream !== "function")) throw new Error("Dieser Browser kann nicht aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.");
  const ac = audio || voice ? unlockAudio() : null;
  if (voice && !ac) throw new Error("Dieser Browser kann keinen Ton mit aufnehmen – für das Voiceover bitte Chrome oder Edge verwenden.");

  let bitrateMode = "variable";
  let src = null, rec = null, sound = null, vstream = null, writer = null, painting = false, choreoRun = null, aborted = false, error = null;
  const onHide = () => { if (document.hidden) { aborted = true; stage.abort(); if (rec?.state === "recording") rec.stop(); } };
  try {
    // ---- 2. Tonspur offline sample-genau rendern (exakt N Frames lang) ----
    let mixed = null;
    if (exactCfg) {
      onStatus?.("🎚️ Rendere die Tonspur sample-genau (Sprecherin, Musik, Effekte) …");
      try { mixed = await renderSoundtrack(D, cues, seed, placed, { sampleRate: exactCfg.sampleRate, fadeOut: audioFade, ...mixOpts }); }
      catch (e) { if (voice) throw new Error(`Tonspur konnte nicht gerendert werden: ${e?.message || e}`); mixed = null; }
    }
    onStatus?.(`🌐 Lade die Live-Website (${tpl.label}) …`);
    await stage.load({ tab: tpl.tab });
    await choreo.setup(stage);
    await stage.idle();
    await loadProFonts();
    src = await domSource(stage, onStatus, { outW: LIVE_W, outH: LIVE_H });
    const live = document.createElement("canvas"); live.width = LIVE_W; live.height = LIVE_H;
    const lctx = live.getContext("2d", { alpha: false });
    src.draw(lctx);
    const comp = new ProCompositor({
      tpl, cover: script.cover, badge: script.badge, look, coverCard, scenes, captions, facts: stage.facts, fade: END_FADE,
      // Fingerposition normiert (0–1) – der Fokus-Zoom fährt gezielt auf die Stelle, an der die App gerade bedient wird
      focus: () => { const f = stage.finger; return f && f.el?.style.opacity !== "0" ? { x: f.x / VIEW_W, y: f.y / VIEW_H } : null; },
      // Showcase: Tipp-Impulse (Finger gedrückt) und Kartenflächen für den Holo-Lichtreflex – normiert 0–1
      pressed: () => !!stage.finger?.el?.classList.contains("down"),
      cards: show ? () => stage.cardRects?.() || [] : () => [],
    });
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext("2d", { alpha: false });
    comp.draw(ctx, 0, live); // Frame 0 = fertiges Cover (Vorschaubild), ohne Einblendung
    let thumb = null;
    try { thumb = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92)); } catch { thumb = null; }
    comp.reset();
    comp.draw(ctx, 0, live);
    if (ac && ac.state !== "running") { try { await ac.resume(); } catch { /* unten geprüft */ } }
    if (voice && !exactCfg && ac?.state !== "running") throw new Error("Tonspur konnte nicht gestartet werden (AudioContext blockiert) – bitte erneut klicken.");
    document.addEventListener("visibilitychange", onHide);

    // ---- 3. Aufnahme vorbereiten ----
    const chunks = [];
    let done = null;
    let clock;
    if (exactCfg) {
      let vcfg = { ...exactCfg.video, bitrate: Math.round(useMbit * 1e6) };
      // Hook-Presets: konstante 8 Mbit/s (VBR bleibt bei Grafik-lastigen Szenen sonst bei ≈ 4–5 Mbit/s) – Rückfall VBR
      if (tpl.cbr) {
        const cbr = { ...vcfg, bitrateMode: "constant" };
        try { if ((await VideoEncoder.isConfigSupported(cbr)).supported) vcfg = cbr; } catch { /* VBR bleibt */ }
      }
      writer = new ExactMp4Writer({ ...exactCfg, video: vcfg });
      bitrateMode = vcfg.bitrateMode || "variable";
      if (mixed) writer.addAudio(mixed);
      const startPerf = performance.now();
      clock = audioClock(ac) || (() => (performance.now() - startPerf) / 1000);
    } else {
      vstream = canvas.captureStream(fps);
      if (ac && ac.state === "running") {
        try { sound = startSoundtrack(ac, D, cues, seed, placed, { fadeOut: audioFade, ...mixOpts }); } catch (e) { if (voice) throw e; sound = null; }
      }
      if (voice && !sound?.voiceEnded) throw new Error("Tonspur mit Sprecherin konnte nicht gestartet werden");
      const stream = sound ? new MediaStream([...vstream.getVideoTracks(), sound.track]) : vstream;
      const opts = { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.round(useMbit * 1_000_000), ...(sound ? { audioBitsPerSecond: AUDIO_KBPS * 1000 } : {}) };
      try { rec = new MediaRecorder(stream, opts); } catch (e) { throw new Error(`Aufnahme konnte nicht starten: ${e.message}`); }
      done = new Promise((resolve) => { rec.onstop = resolve; });
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onerror = (e) => { error = e.error?.message || "unbekannt"; aborted = true; stage.abort(); };
      rec.start(250);
      const startPerf = performance.now();
      clock = sound ? () => Math.max(0, ac.currentTime - sound.t0) : () => (performance.now() - startPerf) / 1000;
    }

    // ---- 4. Frame-Schleife: jeder Frame k zeigt exakt die Videozeit k / fps ----
    src.start();
    painting = true;
    let lastK = -1, encoded = 0, dropped = 0;
    const finished = new Promise((resolve, reject) => {
      const paint = () => {
        if (!painting) return resolve();
        if (aborted) return resolve();
        try {
          const now = clock();
          if (exactCfg) {
            const k = Math.min(N - 1, Math.floor(now * fps + 1e-6));
            if (k > lastK) {
              const tk = k / fps;
              if (comp.showsLive(tk)) src.draw(lctx); // Live-Bild nur, wenn es zu sehen ist
              comp.draw(ctx, tk, live);
              // Gegendruck: staut sich der Encoder, entfällt dieser Frame – die Zeitstempel bleiben trotzdem exakt
              if (k === 0 || k === N - 1 || writer.queue < 8) { writer.addFrame(canvas, k); encoded++; } else dropped++;
              lastK = k;
              onTick?.(tk, D);
              if (k >= N - 1) return resolve();
            }
          } else {
            const t = clamp(now, 0, D);
            if (comp.showsLive(t)) src.draw(lctx);
            comp.draw(ctx, t, live); encoded++;
            onTick?.(t, D);
            if (now >= D + 0.12) return resolve(); // letzter (schwarzer) Frame steht kurz, damit nichts abgeschnitten wird
          }
        } catch (e) { return reject(e); }
        requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);
    });
    onStatus?.(`⏺ Pro-Video „${tpl.label}“ läuft (${fps} FPS, ${useMbit} Mbit/s${exactCfg ? ", frame-genau" : ""}) – Tab sichtbar lassen …`);
    choreoRun = runChoreo(stage, tpl.choreo, show ? showcaseMarks(scenes) : choreoMarks(scenes), () => Math.max(0, clock()), show ? D : scenes[scenes.length - 1].start);
    // Wachhund: läuft die Uhr nicht weiter (z. B. Tab im Hintergrund), wird die Aufnahme verworfen statt zu hängen
    const startWall = performance.now();
    const watchdog = new Promise((_, reject) => {
      const iv = setInterval(() => {
        if (!painting) return clearInterval(iv);
        if (aborted) { clearInterval(iv); painting = false; reject(new Error("abgebrochen")); }
        else if ((performance.now() - startWall) / 1000 > D + 15) { clearInterval(iv); painting = false; reject(new Error("Die Aufnahme ist nicht rechtzeitig fertig geworden – bitte Tab im Vordergrund lassen und erneut starten")); }
      }, 250);
    });
    await Promise.race([finished, watchdog]);
    painting = false;
    stage.abort();
    if (aborted) return null;

    // ---- 5. Datei fertigstellen ----
    let blob, type;
    if (exactCfg) {
      onStatus?.("📦 Schreibe MP4 (Bild und Ton auf derselben Zeitbasis) …");
      blob = await writer.finish(); writer = null; type = "video/mp4";
      if (!mixed) console.warn("Pro-Video ohne Tonspur geschrieben");
    } else {
      if (rec.state === "recording") rec.stop();
      await done;
      if (error) throw new Error(`Aufnahmefehler: ${error}`);
      type = (rec.mimeType || mime || "video/webm").split(";")[0];
      blob = new Blob(chunks, { type });
    }
    if (!blob.size) throw new Error("Die Aufnahme ist leer.");
    if (dropped) console.info(`Pro-Video „${tpl.label}“: ${dropped} Frames wegen Encoder-Stau ausgelassen (Zeitbasis unverändert)`);
    return {
      blob, ext: extOf(type), mime: exactCfg ? `video/mp4;codecs=${exactCfg.video.codec},mp4a.40.2` : rec.mimeType || type, duration: D, facts: { ...stage.facts }, lines: script.say, cover: script.cover,
      fps: exactCfg ? fps : Math.round(encoded / Math.max(0.1, D)), liveFps: Math.round(src.rate()), capture: "pro", mbit: useMbit, scenes, thumb, badge: script.badge, look,
      exact: !!exactCfg, frames: exactCfg ? N : encoded, bitrateMode: exactCfg ? bitrateMode : "recorder", speech, timing: isHook4(tpl) ? segmentReport(scenes, tpl.segments) : null,
      spec: show ? showcaseSpec(tpl, { duration: D, fps: exactCfg ? fps : Math.round(encoded / Math.max(0.1, D)), mbit: useMbit }) : null,
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
    writer?.close();
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
  let mbit = o.mbit, last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await recordPro({ ...o, mbit, maxMb });
    if (!res) return null;
    last = { ...res, attempts: attempt };
    if (res.blob.size <= maxMb * MB) return last;
    mbit = shrinkBitrate(res.mbit, res.blob.size, maxMb);
    if (attempt < 3) o.onStatus?.(`⚖️ ${(res.blob.size / MB).toFixed(1)} MB liegt über ${maxMb} MB – nehme mit ${mbit} Mbit/s neu auf …`);
  }
  // Fertiges Video nie verwerfen: es wird trotzdem heruntergeladen, nur nicht an Make.com gesendet.
  return { ...last, oversize: true };
}

export { PRO_MIN_S, PRO_MAX_S };
