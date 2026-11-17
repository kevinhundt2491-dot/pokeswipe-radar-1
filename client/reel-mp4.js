// Frame-genaue MP4-Ausgabe für die Pro-Videos über WebCodecs (VideoEncoder + AudioEncoder) und mp4-muxer.
// Im Gegensatz zum MediaRecorder bekommt hier JEDER Video-Frame und JEDES Audio-Sample einen exakten
// Zeitstempel auf derselben Zeitbasis (Frame k = k / fps s, Sample n = n / 48000 s). Damit gibt es im
// MP4-Container weder Versatz noch Drift, und das Video endet exakt mit dem letzten gerenderten Frame.

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

const SAMPLE_RATE = 48000;
// H.264 High → Main → Baseline (Level 4.0 reicht für 1080×1920 @ 30 FPS, Level 4.2 für 60 FPS)
const AVC = { 30: ["avc1.640028", "avc1.4D4028", "avc1.420028"], 60: ["avc1.64002A", "avc1.4D402A", "avc1.42002A"] };

/** Prüft, ob dieser Browser frame-genau als MP4 (H.264 + AAC) kodieren kann. Liefert die Encoder-Konfiguration oder null. */
export async function exactMp4Support({ width, height, fps, mbit, audioKbps = 192 }) {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof AudioData === "undefined") return null;
  if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return null;
  let video = null;
  for (const codec of AVC[fps] || AVC[30]) {
    const cfg = { codec, width, height, bitrate: Math.round(mbit * 1e6), framerate: fps, bitrateMode: "variable", latencyMode: "quality", avc: { format: "avc" } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { video = cfg; break; } } catch { /* nächstes Profil */ }
  }
  if (!video) return null;
  const audio = { codec: "mp4a.40.2", sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: audioKbps * 1000 };
  try { if (!(await AudioEncoder.isConfigSupported(audio)).supported) return null; } catch { return null; }
  return { video, audio, fps, width, height, sampleRate: SAMPLE_RATE };
}

/**
 * MP4-Schreiber. Video-Frames werden live (während die echte App läuft) mit ihrem exakten Videozeitpunkt
 * kodiert, die offline gerenderte Tonspur danach sample-genau dazugemischt.
 */
export class ExactMp4Writer {
  constructor(cfg) {
    this.cfg = cfg;
    this.error = null;
    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target,
      video: { codec: "avc", width: cfg.width, height: cfg.height, frameRate: cfg.fps },
      audio: { codec: /^opus$/.test(cfg.audio.codec) ? "opus" : "aac", numberOfChannels: 2, sampleRate: cfg.sampleRate },
      fastStart: "in-memory", // moov-Atom vorne → sofort abspielbar, ideal für Instagram/TikTok/YouTube
      firstTimestampBehavior: "offset", // Frame 0 und Sample 0 liegen beide exakt bei 0 s (AAC-Vorlauf des Encoders wird ausgeglichen)
    });
    const fail = (e) => { this.error = this.error || e; };
    this.venc = new VideoEncoder({ output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta), error: fail });
    this.venc.configure(cfg.video);
    this.aenc = new AudioEncoder({ output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta), error: fail });
    this.aenc.configure(cfg.audio);
    this.lastKey = -Infinity;
    this.frames = 0;
  }

  /** Warteschlange des Video-Encoders (für Gegendruck: bei Stau wird ein Frame ausgelassen, die Zeitbasis bleibt exakt). */
  get queue() { return this.venc.encodeQueueSize; }

  /** Canvas-Inhalt als Frame k kodieren (Zeitstempel k / fps, Dauer bis zum nächsten Frame). */
  addFrame(canvas, k, nextK = k + 1) {
    if (this.error) throw this.error;
    const us = (n) => Math.round((n * 1e6) / this.cfg.fps);
    const frame = new VideoFrame(canvas, { timestamp: us(k), duration: us(nextK) - us(k) });
    const keyFrame = k - this.lastKey >= this.cfg.fps * 2; // alle 2 s ein Keyframe
    if (keyFrame) this.lastKey = k;
    try { this.venc.encode(frame, { keyFrame }); } finally { frame.close(); }
    this.frames++;
  }

  /** Offline gerenderte Tonspur (AudioBuffer, 48 kHz Stereo) sample-genau kodieren. */
  addAudio(buffer) {
    if (this.error) throw this.error;
    const sr = this.cfg.sampleRate, len = buffer.length, CH = 2, BLOCK = 4096;
    const chans = [buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)];
    for (let off = 0; off < len; off += BLOCK) {
      const n = Math.min(BLOCK, len - off);
      const data = new Float32Array(n * CH);
      for (let c = 0; c < CH; c++) data.set(chans[c].subarray(off, off + n), c * n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round((off * 1e6) / sr), data });
      try { this.aenc.encode(ad); } finally { ad.close(); }
    }
  }

  /** Encoder leeren und fertige MP4-Datei liefern. */
  async finish() {
    await Promise.all([this.venc.flush(), this.aenc.flush()]);
    if (this.error) throw this.error;
    this.muxer.finalize();
    this.close();
    return new Blob([this.target.buffer], { type: "video/mp4" });
  }

  close() {
    for (const e of [this.venc, this.aenc]) { try { if (e.state !== "closed") e.close(); } catch { /* egal */ } }
  }
}
