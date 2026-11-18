// Sprecherin auf eine exakte Länge bringen (z. B. 29-s-Master-Vorlagen), OHNE die Tonhöhe zu verändern.
// Reine PCM-Logik ohne DOM/Web Audio (läuft im Browser und in den Node-Tests).
//
//   1. Sprechpausen kürzen: Stille-Stellen länger als minPause werden in der Mitte auf `keep` Sekunden gekürzt –
//      nur so viel wie nötig (gleichmäßig über alle Pausen verteilt). Klingt natürlich, Wörter bleiben unberührt.
//   2. Falls das nicht reicht: WSOLA-Zeitraffung (Waveform-Similarity Overlap-Add) um höchstens maxStretch
//      (Standard 10 %) – Tempo steigt minimal, Stimmlage bleibt exakt gleich.
// Liefert die neuen Kanäle und eine Zeit-Abbildung (alte Sekunde → neue Sekunde) für Satz- und Wort-Zeitstempel.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Mono-Mischung (für Pausenerkennung und WSOLA-Ähnlichkeitssuche). */
function mixdown(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length, out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Stille-Abschnitte [start, end) in Samples (RMS je 10 ms unter thr), ohne Anfangs- und Schluss-Stille. */
export function silentRuns(channels, sr, { thr = 0.006, frameS = 0.01 } = {}) {
  const mono = mixdown(channels), f = Math.max(1, Math.round(sr * frameS)), frames = Math.floor(mono.length / f);
  const quiet = new Uint8Array(frames);
  for (let k = 0; k < frames; k++) {
    let s = 0;
    for (let i = k * f; i < (k + 1) * f; i++) s += mono[i] * mono[i];
    quiet[k] = Math.sqrt(s / f) < thr ? 1 : 0;
  }
  const first = quiet.indexOf(0), last = quiet.lastIndexOf(0);
  if (first < 0) return [];
  const runs = [];
  for (let k = first; k <= last; k++) {
    if (!quiet[k]) continue;
    let e = k;
    while (e + 1 <= last && quiet[e + 1]) e++;
    runs.push([k * f, (e + 1) * f]);
    k = e;
  }
  return runs;
}

/** Stückweise lineare Zeit-Abbildung aus [alt, neu]-Punkten (Sekunden). */
export function timeMap(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0]);
  return (t) => {
    if (!p.length) return t;
    if (t <= p[0][0]) return p[0][1] + (t - p[0][0]);
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const [a0, b0] = p[i - 1], [a1, b1] = p[i];
        return a1 === a0 ? b1 : b0 + ((t - a0) / (a1 - a0)) * (b1 - b0);
      }
    }
    const [aL, bL] = p[p.length - 1];
    return bL + (t - aL);
  };
}

/**
 * Pausen kürzen, bis `need` Sekunden eingespart sind (höchstens bis auf `keep` je Pause).
 * @returns {{ channels: Float32Array[], saved: number, points: Array<[number, number]> }}
 */
export function compressPauses(channels, sr, need, { minPause = 0.24, keep = 0.14, thr = 0.006 } = {}) {
  const len = channels[0].length;
  const runs = silentRuns(channels, sr, { thr }).filter(([a, b]) => b - a > minPause * sr);
  const removable = runs.map(([a, b]) => Math.max(0, b - a - Math.round(keep * sr)));
  const total = removable.reduce((s, x) => s + x, 0);
  if (!(need > 0) || !total) return { channels: channels.map((c) => c.slice()), saved: 0, points: [[0, 0], [len / sr, len / sr]] };
  const scale = Math.min(1, (need * sr) / total);
  const cuts = runs.map(([a, b], i) => {
    const r = Math.round(removable[i] * scale), mid = Math.round((a + b) / 2);
    return [mid - Math.floor(r / 2), mid - Math.floor(r / 2) + r];
  }).filter(([a, b]) => b > a);
  const removed = cuts.reduce((s, [a, b]) => s + (b - a), 0);
  const out = channels.map(() => new Float32Array(len - removed));
  const points = [[0, 0]];
  let src = 0, dst = 0;
  const XF = Math.min(64, Math.round(sr * 0.002)); // kurzer Übergang gegen Knackser
  for (const [a, b] of [...cuts, [len, len]]) {
    const n = a - src;
    channels.forEach((ch, c) => out[c].set(ch.subarray(src, a), dst));
    dst += n;
    if (b > a && b < len) {
      // Übergang über die Schnittstelle (liegt mitten in der Stille)
      channels.forEach((ch, c) => {
        for (let i = 0; i < XF && dst - XF + i >= 0 && b + i < len; i++) {
          const w = i / XF;
          out[c][dst - XF + i] = out[c][dst - XF + i] * (1 - w) + ch[b - XF + i] * w;
        }
      });
      points.push([a / sr, dst / sr], [b / sr, dst / sr]);
    }
    src = b;
  }
  points.push([len / sr, dst / sr]);
  return { channels: out, saved: removed / sr, points };
}

/**
 * WSOLA-Zeitraffung um `factor` (> 1 = kürzer) – Tonhöhe bleibt gleich.
 * Fenster 32 ms (Hann), 50 % Überlappung, Ähnlichkeitssuche ±10 ms.
 */
export function wsola(channels, sr, factor) {
  const len = channels[0].length;
  if (!(factor > 1.0005) || len < sr * 0.1) return channels.map((c) => c.slice());
  const N = Math.max(256, Math.round(sr * 0.032) & ~1), Hs = N / 2, Ha = Hs * factor, tol = Math.round(sr * 0.01);
  const outLen = Math.floor(len / factor);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const mono = mixdown(channels);
  const out = channels.map(() => new Float32Array(outLen + N)), norm = new Float32Array(outLen + N);
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const pos = k * Hs, nominal = Math.round(k * Ha);
    let best = Math.min(nominal, Math.max(0, len - N));
    const target = prev + Hs;
    if (k > 0 && target + N <= len) {
      let score = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const p = nominal + d;
        if (p < 0 || p + N > len) continue;
        let s = 0;
        for (let i = 0; i < N; i += 8) s += mono[p + i] * mono[target + i];
        if (s > score) { score = s; best = p; }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c], dst = out[c];
      for (let i = 0; i < N && best + i < len; i++) dst[pos + i] += src[best + i] * win[i];
    }
    for (let i = 0; i < N; i++) norm[pos + i] += win[i];
    prev = best;
  }
  return out.map((ch) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : ch[i];
    return r;
  });
}

/**
 * Sprecherin auf höchstens `target` Sekunden Sprechzeit bringen.
 * @param {Float32Array[]} channels  PCM je Kanal
 * @param {number} sr                Abtastrate
 * @param {number} speech            gemessene Sprechdauer (letztes hörbares Sample, s)
 * @param {number} target            Ziel-Sprechdauer (s)
 * @returns {{ channels: Float32Array[], map: (t:number)=>number, saved: number, factor: number, speech: number, changed: boolean }}
 */
export function fitVoice(channels, sr, speech, target, { maxStretch = 1.1, minPause = 0.24, keep = 0.14 } = {}) {
  const need = speech - target;
  if (!(need > 0.01)) return { channels, map: (t) => t, saved: 0, factor: 1, speech, changed: false };
  const p = compressPauses(channels, sr, need + 0.02, { minPause, keep });
  const pm = timeMap(p.points);
  const after = pm(speech);
  const factor = after > target ? clamp(Math.ceil((after / target) * 1000) / 1000, 1, maxStretch) : 1;
  const out = factor > 1 ? wsola(p.channels, sr, factor) : p.channels;
  const map = (t) => pm(t) / factor;
  return { channels: out, map, saved: p.saved, factor, speech: map(speech), changed: true };
}
