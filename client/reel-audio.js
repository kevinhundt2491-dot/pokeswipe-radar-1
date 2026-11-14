// Tonspur für die Canvas-Reels (Auto-Reels-Generator + Reel-Studio).
// Erzeugt per Web Audio API live eine lizenzfreie Synth-Musik (Beat, Bass, Akkorde, Arpeggio)
// plus Soundeffekte an den Szenenwechseln (Whoosh, Swipe, Scan-Piep, Alarm, Finale).
// Das Signal läuft in einen MediaStreamAudioDestinationNode, dessen Audiospur zusammen mit
// der Canvas-Videospur vom MediaRecorder aufgenommen wird – so haben die MP4s echten Ton.

// MIME-Typen mit Audio-Codec zuerst (AAC für Instagram), danach Varianten ohne Audio als Fallback.
const AV_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.64002A,mp4a.40.2",
  "video/mp4;codecs=avc1.4D402A,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1.64002A,opus",
  "video/mp4;codecs=avc1,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
];

/** Bestes Aufnahmeformat inkl. Ton. Liefert { mime, audio } – audio=false, wenn nur Video geht. */
export function pickAvMime(fallbackPick) {
  if (typeof MediaRecorder === "undefined") return { mime: null, audio: false };
  if (typeof AudioContext !== "undefined" || typeof window.webkitAudioContext !== "undefined") {
    const m = AV_MIME_CANDIDATES.find((x) => { try { return MediaRecorder.isTypeSupported(x); } catch { return false; } });
    if (m) return { mime: m, audio: true };
  }
  const mime = fallbackPick();
  // Ohne explizite Codec-Angabe (z. B. "video/mp4" in Safari) wählt der Browser selbst einen Audio-Codec.
  const audio = mime !== null && !/codecs=/.test(mime) && typeof (window.AudioContext || window.webkitAudioContext) === "function";
  return { mime, audio };
}

let shared = null;
/** Gemeinsamen AudioContext holen und entsperren – möglichst direkt im Klick-Handler aufrufen. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!shared || shared.state === "closed") shared = new AC({ latencyHint: "playback" });
    if (shared.state === "suspended") shared.resume().catch(() => {});
    return shared;
  } catch { return null; }
}

let noiseBuf = null;
function noise(ac) {
  if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
  const len = ac.sampleRate * 2;
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Akkordfolgen (MIDI-Grundtöne + Moll/Dur), je Episode eine andere – klingt nach Serie, aber nicht gleich.
const PROGRESSIONS = [
  [[57, "m"], [53, ""], [48, ""], [55, ""]],   // Am F C G
  [[50, "m"], [58, ""], [53, ""], [48, ""]],   // Dm Bb F C
  [[52, "m"], [48, ""], [55, ""], [50, ""]],   // Em C G D
  [[48, ""], [55, ""], [57, "m"], [53, ""]],   // C G Am F
  [[55, ""], [52, "m"], [48, ""], [50, ""]],   // G Em C D
];

/**
 * Soundtrack für eine Aufnahme starten.
 * @param {AudioContext} ac
 * @param {number} D        Länge in Sekunden
 * @param {Array<[number,string]>} cues  Soundeffekte: [Zeitpunkt in s, Typ]
 * @param {number} seed     Variation (z. B. Episodennummer)
 * @param {Array<{start:number, buffer:AudioBuffer, rate:number}>} voice  Sprecher-Clips (siehe placeVoice)
 * @returns {{ track: MediaStreamTrack, stop: () => void }}
 */
export function startSoundtrack(ac, D, cues = [], seed = 1, voice = []) {
  const dest = ac.createMediaStreamDestination();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  const master = ac.createGain();
  master.connect(comp); comp.connect(dest);

  const T0 = ac.currentTime + 0.05;
  // Ein-/Ausblenden
  master.gain.setValueAtTime(0.0001, T0);
  master.gain.exponentialRampToValueAtTime(0.9, T0 + 0.25);
  master.gain.setValueAtTime(0.9, T0 + Math.max(0.3, D - 1.2));
  master.gain.linearRampToValueAtTime(0.0001, T0 + D);

  const music = ac.createGain(); music.gain.value = 0.55; music.connect(master);
  const sfx = ac.createGain(); sfx.gain.value = 0.85; sfx.connect(master);
  if (voice.length) { music.gain.value = 0.42; sfx.gain.value = 0.6; }
  const nodes = [];
  const track = (n) => { nodes.push(n); return n; };

  const env = (g, t, a, peak, dec) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  };
  const osc = (type, f, t, dur, peak, out, { a = 0.005, glideTo = null, detune = 0 } = {}) => {
    const o = track(ac.createOscillator()), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    env(g, t, a, peak, dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + a + dur + 0.05);
  };
  const burst = (t, dur, peak, out, { type = "highpass", f = 6000, f2 = null, q = 0.7, a = 0.002 } = {}) => {
    const s = track(ac.createBufferSource()), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise(ac);
    fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
    env(g, t, a, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
  };

  // ---- Musik: 120 BPM, 4/4, ein Akkord pro Takt ----
  const prog = PROGRESSIONS[(Math.abs(seed) - 1 + PROGRESSIONS.length) % PROGRESSIONS.length];
  const beat = 0.5, bar = beat * 4;
  const pad = ac.createBiquadFilter(); pad.type = "lowpass"; pad.frequency.value = 1400; pad.connect(music);
  const lead = ac.createBiquadFilter(); lead.type = "lowpass"; lead.frequency.value = 3200; lead.connect(music);
  const bars = Math.ceil(D / bar);
  for (let b = 0; b < bars; b++) {
    const tb = T0 + b * bar;
    const [root, q] = prog[b % prog.length];
    const third = root + (q === "m" ? 3 : 4), fifth = root + 7;
    const intro = b === 0; // erster Takt: nur Pad + Arpeggio, Beat setzt danach ein
    // Pad-Akkord (zwei leicht verstimmte Sägezähne je Ton)
    [root + 12, third + 12, fifth + 12].forEach((m) => {
      [-8, 8].forEach((dt) => osc("sawtooth", hz(m), tb, bar - 0.05, 0.028, pad, { a: 0.12, detune: dt }));
    });
    for (let k = 0; k < 8; k++) {
      const t = tb + k * (beat / 2);
      if (t > T0 + D) break;
      // Arpeggio (Achtel)
      const arp = [root + 24, third + 24, fifth + 24, third + 24][k % 4] + (k >= 4 ? 12 : 0);
      osc("square", hz(arp), t, 0.16, 0.035, lead, { a: 0.004 });
      if (intro) continue;
      // Hi-Hat auf jede Achtel, offen auf der "und"
      burst(t, k % 2 ? 0.09 : 0.035, k % 2 ? 0.07 : 0.05, music, { f: 8000 });
      // Bass auf Achteln (Grundton, auf der 8 die Quinte)
      osc("triangle", hz(root - 12 + (k === 7 ? 7 : 0)), t, 0.2, 0.32, music, { a: 0.006 });
    }
    if (intro) continue;
    for (let k = 0; k < 4; k++) {
      const t = tb + k * beat;
      if (t > T0 + D) break;
      // Kick auf jedem Schlag
      osc("sine", 150, t, 0.28, 0.9, music, { a: 0.002, glideTo: 42 });
      // Clap/Snare auf 2 und 4
      if (k % 2) burst(t, 0.16, 0.32, music, { type: "bandpass", f: 1800, q: 0.9 });
    }
  }

  // ---- Soundeffekte ----
  const SFX = {
    impact(t) {
      osc("sine", 120, t, 0.6, 0.9, sfx, { a: 0.002, glideTo: 35 });
      burst(t, 0.5, 0.35, sfx, { type: "lowpass", f: 3000, f2: 200 });
    },
    cut(t) { burst(t - 0.12, 0.28, 0.3, sfx, { type: "bandpass", f: 600, f2: 5000, q: 1.2, a: 0.1 }); },
    swipe(t) { burst(t, 0.22, 0.38, sfx, { type: "bandpass", f: 2500, f2: 500, q: 1.5, a: 0.03 }); },
    scan(t) {
      osc("sine", 1320, t, 0.1, 0.2, sfx, { a: 0.003 });
      osc("sine", 1760, t + 0.12, 0.16, 0.2, sfx, { a: 0.003 });
    },
    coin(t) {
      osc("square", hz(83), t, 0.08, 0.1, sfx, { a: 0.002 });
      osc("square", hz(88), t + 0.08, 0.3, 0.1, sfx, { a: 0.002 });
    },
    alert(t) {
      for (let i = 0; i < 3; i++) osc("triangle", i % 2 ? 988 : 1319, t + i * 0.14, 0.12, 0.22, sfx, { a: 0.003 });
    },
    match(t) { [72, 76, 79, 84].forEach((m, i) => osc("triangle", hz(m), t + i * 0.07, 0.35, 0.16, sfx, { a: 0.004 })); },
    pop(t) { osc("sine", 500, t, 0.12, 0.35, sfx, { a: 0.002, glideTo: 1100 }); },
    riser(t) { burst(t - 1.2, 1.2, 0.22, sfx, { type: "bandpass", f: 300, f2: 7000, q: 2, a: 1.1 }); },
    finale(t) {
      SFX.impact(t);
      [60, 64, 67, 72].forEach((m) => osc("sawtooth", hz(m), t, 1.4, 0.05, pad, { a: 0.02 }));
    },
  };
  cues.forEach(([t, type]) => {
    if (t < 0 || t > D || !SFX[type]) return;
    try { SFX[type](T0 + Math.max(0.01, t)); } catch { /* ein fehlerhafter Effekt soll die Aufnahme nicht stoppen */ }
  });

  // ---- Sprecherstimme: eigener Pfad mit Präsenz-EQ; Musik + Effekte werden darunter abgesenkt (Ducking) ----
  if (voice.length) {
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
    const presence = ac.createBiquadFilter(); presence.type = "peaking"; presence.frequency.value = 3000; presence.Q.value = 0.9; presence.gain.value = 3;
    const vg = ac.createGain(); vg.gain.value = 1.15;
    hp.connect(presence); presence.connect(vg); vg.connect(comp);
    const duck = (g, base, low) => {
      voice.forEach(({ start, buffer, rate }) => {
        const a = T0 + start, b = a + buffer.duration / rate;
        g.gain.setTargetAtTime(low, a - 0.15, 0.06);
        g.gain.setTargetAtTime(base, b + 0.05, 0.25);
      });
    };
    duck(music, music.gain.value, 0.13);
    duck(sfx, sfx.gain.value, 0.3);
    voice.forEach(({ start, buffer, rate }) => {
      const src = track(ac.createBufferSource());
      src.buffer = buffer; src.playbackRate.value = rate;
      src.connect(hp);
      src.start(T0 + start);
    });
  }

  const out = dest.stream.getAudioTracks()[0];
  return {
    track: out,
    stop() {
      nodes.forEach((n) => { try { n.stop(); } catch { /* schon beendet */ } });
      try { master.disconnect(); comp.disconnect(); } catch { /* egal */ }
      out.stop();
    },
  };
}

/**
 * Soundeffekt-Zeitpunkte aus einem Szenen-Zeitplan ableiten.
 * @param {Array<[string, number, number]>} tl  [Szenenname, Start, Ende]
 * @param {{ swipeDirs?: number[] }} opts
 */
export function cuesFromTimeline(tl, opts = {}) {
  const cues = [[0.02, "impact"]];
  tl.forEach(([name, a, b], i) => {
    const d = b - a;
    if (i > 0) cues.push([a, "cut"]);
    switch (name) {
      case "scan": cues.push([a + d * 0.35, "scan"], [a + d * 0.7, "coin"]); break;
      case "binder": case "portfolio": case "movers": cues.push([a + d * 0.3, "coin"]); break;
      case "swipe": {
        const n = Math.max(1, (opts.swipeDirs || [1]).length), slot = d / n;
        for (let k = 0; k < n; k++) cues.push([a + slot * (k + 0.55), "swipe"]);
        break;
      }
      case "radar": case "map": cues.push([a + d * 0.45, "alert"]); break;
      case "chat": case "wishlist": case "pullwall": cues.push([a + d * 0.3, "pop"], [a + d * 0.6, "match"]); break;
      case "cta": cues.push([a, "riser"], [a + 0.05, "finale"], [a + d * 0.55, "pop"]); break;
      default: break;
    }
  });
  return cues;
}

/**
 * Sprecher-Clips auf die Szenen legen: jeder Satz startet kurz nach Beginn "seiner" Szene,
 * Sätze überlappen sich nie und alles endet vor dem Videoende. Ist es zu knapp, wird das Tempo
 * leicht erhöht (max. 12 %) und notfalls ein entbehrlicher Szenen-Satz weggelassen –
 * Hook und Call to Action bleiben immer erhalten.
 * @param {Array<{id:string, at:number, end:number, buffer:AudioBuffer, keep?:boolean}>} clips (zeitlich sortiert)
 * @param {number} D Videolänge in s
 */
export function placeVoice(clips, D) {
  const LEAD = 0.18, GAP = 0.15, TAIL = 0.35;
  const layout = (list, rate) => {
    let cursor = 0;
    const out = list.map((c) => {
      const start = Math.max(c.at + LEAD, cursor + GAP);
      const end = start + c.buffer.duration / rate;
      cursor = end;
      return { ...c, start, stop: end, rate };
    });
    // CTA darf nicht über das Ende hinaus: notfalls etwas früher in die CTA-Szene hinein starten
    const last = out[out.length - 1];
    if (last && last.stop > D - TAIL) {
      const shift = last.stop - (D - TAIL);
      const prevEnd = out.length > 1 ? out[out.length - 2].stop + GAP : 0;
      if (last.start - shift >= Math.max(prevEnd, last.at - 2.5)) { last.start -= shift; last.stop -= shift; }
    }
    return out;
  };
  // ein Satz darf höchstens 0,9 s in die nächste Szene hineinragen, der letzte muss vor dem Ende fertig sein
  const fits = (out) => out.every((c, i) => c.stop <= (i === out.length - 1 ? D - TAIL : c.end + 0.9));
  let list = clips.slice();
  for (;;) {
    for (const rate of [1, 1.04, 1.08, 1.12]) {
      const out = layout(list, rate);
      if (fits(out)) return out.map(({ id, start, stop, buffer, rate: r }) => ({ id, start, stop, buffer, rate: r }));
    }
    // entbehrlichsten (längsten) Szenen-Satz streichen und neu versuchen
    const drop = list.filter((c) => !c.keep).sort((a, b) => b.buffer.duration - a.buffer.duration)[0];
    if (!drop) {
      const out = layout(list, 1.12); // nur Hook + CTA übrig – so gut es geht
      return out.map(({ id, start, stop, buffer, rate }) => ({ id, start, stop, buffer, rate }));
    }
    list = list.filter((c) => c !== drop);
  }
}
