// PokeSwipe & Radar – Bildverarbeitung des On-Device-Scanners (rein rechnerisch, ohne DOM/Netzwerk).
// Läuft identisch auf dem Server (Referenz-Fingerabdrücke aus den TCGdex-Kartenbildern) und im Browser-Worker
// (Kamerabild): Graustufen, Kantenerkennung, Perspektivkorrektur, pHash/dHash, Hamming-Suche, Ziffern-Erkennung.

/** Normiertes Kartenformat (63 × 88 mm ≈ 0,716). */
export const NORM_W = 200;
export const NORM_H = 280;
/** Artwork-Bereich (relativ zur Karte) – gleiche Box für Referenz und Kamera. */
export const ART_BOX = { u0: 0.08, v0: 0.1, u1: 0.92, v1: 0.52 };
/** Kartennummer: neue Karten unten links, ältere unten rechts. */
export const NUMBER_STRIPS = [
  { key: "left", u0: 0.02, v0: 0.885, u1: 0.46, v1: 0.975 },
  { key: "right", u0: 0.54, v0: 0.885, u1: 0.98, v1: 0.975 },
];
/** Gewichteter Abstand (0 … ~160): artP + 0,75·artD + 0,75·fullP. */
export const SCORE_ACCEPT = 38;
export const SCORE_STRONG = 26;
export const SCORE_WITH_NUMBER = 54;
export const MARGIN_MIN = 7;
/** Gleiches Artwork (z. B. DE/EN/JA derselben Karte): artP-Abstand höchstens so groß. */
export const SAME_ART_MAX = 8;
/** Uint32-Wörter je Eintrag: 3 Hashes à 64 Bit. */
export const WORDS = 6;

export type Gray = { w: number; h: number; d: Float32Array };
export type Pt = [number, number];

// ---------------------------------------------------------------------------
// Grundfunktionen
// ---------------------------------------------------------------------------
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number, channels = 4): Gray {
  const d = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i++, p += channels) d[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return { w, h, d };
}

/** Flächenmittel-Verkleinerung (kein Aliasing); vergrößert per bilinearer Interpolation. */
export function resize(src: Gray, dw: number, dh: number): Gray {
  const out = new Float32Array(dw * dh);
  const sx = src.w / dw, sy = src.h / dh;
  if (sx < 1 || sy < 1) {
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) out[y * dw + x] = sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
    return { w: dw, h: dh, d: out };
  }
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(src.h, Math.floor((y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(src.w, Math.floor((x + 1) * sx)));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) { const row = yy * src.w; for (let xx = x0; xx < x1; xx++) s += src.d[row + xx]; }
      out[y * dw + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return { w: dw, h: dh, d: out };
}

/** Bilinearer Wert an (x, y), Ränder geklemmt. */
export function sample(g: Gray, x: number, y: number): number {
  const xc = Math.min(g.w - 1.001, Math.max(0, x)), yc = Math.min(g.h - 1.001, Math.max(0, y));
  const x0 = Math.floor(xc), y0 = Math.floor(yc), fx = xc - x0, fy = yc - y0;
  const i = y0 * g.w + x0;
  const a = g.d[i], b = g.d[i + 1], c = g.d[i + g.w], e = g.d[i + g.w + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

export function crop(g: Gray, box: { u0: number; v0: number; u1: number; v1: number }): Gray {
  const x0 = Math.round(box.u0 * g.w), y0 = Math.round(box.v0 * g.h);
  const w = Math.max(1, Math.round(box.u1 * g.w) - x0), h = Math.max(1, Math.round(box.v1 * g.h) - y0);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) d.set(g.d.subarray((y0 + y) * g.w + x0, (y0 + y) * g.w + x0 + w), y * w);
  return { w, h, d };
}

// ---------------------------------------------------------------------------
// Perceptual Hashes
// ---------------------------------------------------------------------------
const DCT_N = 32;
const DCT_K = 8;
const DCT_TABLE = (() => {
  const t = new Float32Array(DCT_K * DCT_N);
  for (let k = 0; k < DCT_K; k++) for (let n = 0; n < DCT_N; n++) t[k * DCT_N + n] = Math.cos((Math.PI / DCT_N) * (n + 0.5) * k);
  return t;
})();

function bitsToWords(bits: ArrayLike<number | boolean>): [number, number] {
  let hi = 0, lo = 0;
  for (let i = 0; i < 32; i++) if (bits[i]) hi |= 1 << (31 - i);
  for (let i = 0; i < 32; i++) if (bits[32 + i]) lo |= 1 << (31 - i);
  return [hi >>> 0, lo >>> 0];
}

/** pHash: 32×32 → DCT → 8×8 niedrigste Frequenzen → Bit = Koeffizient > Median (ohne Gleichanteil). */
export function pHash(g: Gray): [number, number] {
  const s = resize(g, DCT_N, DCT_N).d;
  const rowsK = new Float32Array(DCT_N * DCT_K);
  for (let y = 0; y < DCT_N; y++) for (let k = 0; k < DCT_K; k++) {
    let acc = 0;
    for (let x = 0; x < DCT_N; x++) acc += s[y * DCT_N + x] * DCT_TABLE[k * DCT_N + x];
    rowsK[y * DCT_K + k] = acc;
  }
  const coeff = new Float32Array(DCT_K * DCT_K);
  for (let ky = 0; ky < DCT_K; ky++) for (let kx = 0; kx < DCT_K; kx++) {
    let acc = 0;
    for (let y = 0; y < DCT_N; y++) acc += rowsK[y * DCT_K + kx] * DCT_TABLE[ky * DCT_N + y];
    coeff[ky * DCT_K + kx] = acc;
  }
  const sorted = Array.from(coeff.subarray(1)).sort((a, b) => a - b);
  const med = (sorted[31] + sorted[32]) / 2;
  return bitsToWords(Array.from(coeff, (v, i) => i > 0 && v > med));
}

/** dHash: 9×8, Bit = linker Nachbar heller als rechter. */
export function dHash(g: Gray): [number, number] {
  const s = resize(g, 9, 8).d;
  const bits: boolean[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(s[y * 9 + x] > s[y * 9 + x + 1]);
  return bitsToWords(bits);
}

/** Alle drei Fingerabdrücke einer normierten Karte (NORM_W × NORM_H). */
export function cardHashes(card: Gray): Uint32Array {
  const art = crop(card, ART_BOX);
  const out = new Uint32Array(WORDS);
  out.set(pHash(art), 0);
  out.set(dHash(art), 2);
  out.set(pHash(card), 4);
  return out;
}

/** Referenzbild (ganze Karte, z. B. TCGdex low.jpg) → Fingerabdrücke. */
export function referenceHashes(rgba: ArrayLike<number>, w: number, h: number, channels = 4): Uint32Array {
  return cardHashes(resize(rgbaToGray(rgba, w, h, channels), NORM_W, NORM_H));
}

export const wordsToHex = (a: number, b: number) => (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
export function hexToWords(hex: string): [number, number] | null {
  if (!/^[0-9a-f]{16}$/i.test(String(hex || ""))) return null;
  return [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8), 16) >>> 0];
}

export function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Abstände (artP, artD, fullP) zwischen Probe und Index-Eintrag i. */
export function distances(probe: Uint32Array, index: Uint32Array, i: number): [number, number, number] {
  const o = i * WORDS;
  return [
    popcount32(probe[0] ^ index[o]) + popcount32(probe[1] ^ index[o + 1]),
    popcount32(probe[2] ^ index[o + 2]) + popcount32(probe[3] ^ index[o + 3]),
    popcount32(probe[4] ^ index[o + 4]) + popcount32(probe[5] ^ index[o + 5]),
  ];
}
export const combinedScore = (d: [number, number, number]) => d[0] + 0.75 * d[1] + 0.75 * d[2];

/** k beste Treffer per linearer Suche (30.000 Einträge ≈ 2 ms). */
export function topMatches(probe: Uint32Array, index: Uint32Array, count: number, k = 12): { i: number; score: number; art: number }[] {
  const best: { i: number; score: number; art: number }[] = [];
  let worst = Infinity;
  for (let i = 0; i < count; i++) {
    const d = distances(probe, index, i);
    const score = combinedScore(d);
    if (best.length < k || score < worst) {
      best.push({ i, score, art: d[0] });
      best.sort((a, b) => a.score - b.score);
      if (best.length > k) best.pop();
      worst = best[best.length - 1].score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Kantenerkennung & Perspektivkorrektur
// ---------------------------------------------------------------------------
export function sobel(g: Gray): { gx: Float32Array; gy: Float32Array; mean: number } {
  const { w, h, d } = g;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1], l = d[i - 1], r = d[i + 1], e = d[i + w - 1], f = d[i + w], k = d[i + w + 1];
      const vx = c + 2 * r + k - a - 2 * l - e;
      const vy = e + 2 * f + k - a - 2 * b - c;
      gx[i] = vx; gy[i] = vy;
      sum += Math.abs(vx) + Math.abs(vy);
    }
  }
  return { gx, gy, mean: sum / Math.max(1, (w - 2) * (h - 2) * 2) };
}

type Line = { p: Pt; q: Pt; score: number };
/** Gewichte der Kantenauswahl (per Simulation mit echten Kartenbildern abgestimmt). */
export const TUNE = { strong: 0.3, outer: 1.5, ratio: 8, keep: 6 };
export type Guide = { x0: number; y0: number; x1: number; y1: number };

/**
 * Kandidaten für eine gerade Kante je Seite in einem Band um die Führungslinie (Overlay-Rahmen):
 * stärkste Linien mit Nicht-Maximum-Unterdrückung, damit Kartenrand, Innenrahmen und Hintergrundkanten getrennt bleiben.
 */
function edgeCandidates(gr: { gx: Float32Array; gy: Float32Array }, w: number, h: number, side: "top" | "bottom" | "left" | "right", guide: Guide, band: number, keep = TUNE.keep): Line[] {
  const horiz = side === "top" || side === "bottom";
  const grad = horiz ? gr.gy : gr.gx;
  const base = side === "top" ? guide.y0 : side === "bottom" ? guide.y1 : side === "left" ? guide.x0 : guide.x1;
  const limit = horiz ? h - 2 : w - 2;
  const lo = Math.max(1, Math.round(base - band)), hi = Math.min(limit, Math.round(base + band));
  const a0 = horiz ? guide.x0 : guide.y0, a1 = horiz ? guide.x1 : guide.y1;
  const len = a1 - a0;
  const SAMPLES = 40;
  const step = Math.max(1, Math.round((hi - lo) / 28));
  const cands: Line[] = [];
  for (let s = lo; s <= hi; s += step) {
    for (let e = lo; e <= hi; e += step) {
      let acc = 0, accSigned = 0;
      for (let k = 0; k < SAMPLES; k++) {
        const t = 0.12 + (0.76 * k) / (SAMPLES - 1);
        const along = a0 + t * len;
        const across = s + (e - s) * t;
        const x = Math.round(horiz ? along : across), y = Math.round(horiz ? across : along);
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const v = grad[y * w + x];
        acc += Math.abs(v); accSigned += v;
      }
      // Eine echte Kartenkante hat durchgehend dieselbe Helligkeitsrichtung
      const score = (0.5 * acc + 0.5 * Math.abs(accSigned)) / SAMPLES;
      cands.push({ p: horiz ? [a0, s] : [s, a0], q: horiz ? [a1, e] : [e, a1], score });
    }
  }
  if (!cands.length) return [{ p: horiz ? [a0, base] : [base, a0], q: horiz ? [a1, base] : [base, a1], score: 0 }];
  cands.sort((a, b) => b.score - a.score);
  const mid = (c: Line) => (horiz ? (c.p[1] + c.q[1]) / 2 : (c.p[0] + c.q[0]) / 2);
  const out: Line[] = [];
  const sep = Math.max(3, band * 0.12);
  for (const c of cands) {
    if (out.every((o) => Math.abs(mid(o) - mid(c)) > sep)) out.push(c);
    if (out.length >= keep) break;
  }
  return out;
}

function intersect(a: Line, b: Line): Pt | null {
  const [x1, y1] = a.p, [x2, y2] = a.q, [x3, y3] = b.p, [x4, y4] = b.q;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-6) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

const polyArea = (q: Pt[]) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;

/**
 * Kartenkanten im Bild finden. Liefert die 4 Ecken (oben links, oben rechts, unten rechts, unten links), eine Konfidenz
 * und die Bildschärfe. Ohne sichere Kanten: Führungsrahmen als Fallback (found = false).
 */
export function detectCard(g: Gray, guide: Guide): { corners: Pt[]; found: boolean; confidence: number; sharpness: number } {
  const gr = sobel(g);
  const gw = guide.x1 - guide.x0, gh = guide.y1 - guide.y0;
  const band = Math.max(4, Math.min(gw, gh) * 0.13);
  const sides = (["top", "right", "bottom", "left"] as const).map((sd) => edgeCandidates(gr, g.w, g.h, sd, guide, band));
  const fallback: Pt[] = [[guide.x0, guide.y0], [guide.x1, guide.y0], [guide.x1, guide.y1], [guide.x0, guide.y1]];
  const sharpness = gr.mean;
  const maxes = sides.map((c) => c[0]?.score || 1);
  // Je Seite nur starke Kanten (≥ 80 % der stärksten); die äußerste bekommt einen Bonus (Kartenrand statt Innenrahmen)
  const outerPos = (c: Line, si: number) => {
    const m = si % 2 === 0 ? (c.p[1] + c.q[1]) / 2 : (c.p[0] + c.q[0]) / 2;
    return si === 0 || si === 3 ? -m : m;
  };
  const strong = sides.map((cands, si) => cands.filter((c) => c.score >= maxes[si] * TUNE.strong)
    .sort((a, b) => outerPos(b, si) - outerPos(a, si))
    .map((c, rank) => ({ line: c, bonus: rank === 0 ? TUNE.outer : 0 })));
  // Beste Kombination: starke Kanten + Seitenverhältnis 63:88
  let best: { quad: Pt[]; value: number; minScore: number } | null = null;
  for (const t of strong[0]) for (const r of strong[1]) for (const b of strong[2]) for (const l of strong[3]) {
    const c = [intersect(t.line, l.line), intersect(t.line, r.line), intersect(b.line, r.line), intersect(b.line, l.line)];
    if (c.some((p) => !p)) continue;
    const quad = c as Pt[];
    const wAvg = (Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) + Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1])) / 2;
    const hAvg = (Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]) + Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1])) / 2;
    const ratio = wAvg / Math.max(1, hAvg);
    const area = polyArea(quad) / (gw * gh);
    if (area < 0.55 || area > 1.6) continue;
    const strength = t.line.score / maxes[0] + r.line.score / maxes[1] + b.line.score / maxes[2] + l.line.score / maxes[3];
    const value = strength + t.bonus + r.bonus + b.bonus + l.bonus - TUNE.ratio * Math.abs(ratio - 0.716) / 0.716;
    if (!best || value > best.value) best = { quad, value, minScore: Math.min(t.line.score, r.line.score, b.line.score, l.line.score) };
  }
  if (!best) return { corners: fallback, found: false, confidence: 0, sharpness };
  const conf = best.minScore / (gr.mean + 4);
  const q = best.quad;
  const ratio = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) / Math.max(1, Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]));
  const ok = conf >= 1.4 && ratio > 0.58 && ratio < 0.88;
  return { corners: ok ? q : fallback, found: ok, confidence: conf, sharpness };
}

/** Homographie, die (u, v) ∈ [0,1]² auf das Viereck abbildet (Ecken: oben links, oben rechts, unten rechts, unten links). */
export function homography(corners: Pt[]): number[] {
  const src: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = corners[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // Gauß-Elimination mit Pivotsuche
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const div = A[col][col] || 1e-12;
    for (let c = col; c < 9; c++) A[col][c] /= div;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f) for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

export function project(H: number[], u: number, v: number): Pt {
  const z = H[6] * u + H[7] * v + H[8];
  return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
}

/** Ausschnitt (u0..u1, v0..v1 der Karte) perspektivisch entzerrt auf outW × outH. */
export function warp(g: Gray, H: number[], outW: number, outH: number, box = { u0: 0, v0: 0, u1: 1, v1: 1 }): Gray {
  const d = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const v = box.v0 + ((y + 0.5) / outH) * (box.v1 - box.v0);
    for (let x = 0; x < outW; x++) {
      const u = box.u0 + ((x + 0.5) / outW) * (box.u1 - box.u0);
      const [sx, sy] = project(H, u, v);
      d[y * outW + x] = sample(g, sx, sy);
    }
  }
  return { w: outW, h: outH, d };
}

/** Kamerabild → normierte Karte (erst doppelt so groß entzerren, dann flächig verkleinern = weniger Aliasing). */
export function normalizeCard(g: Gray, corners: Pt[]): Gray {
  return resize(warp(g, homography(corners), NORM_W * 2, NORM_H * 2), NORM_W, NORM_H);
}

// ---------------------------------------------------------------------------
// Phase 9: Vorverarbeitung & Farb-Signatur (Hybrid-Scanner Stufe 1)
// ---------------------------------------------------------------------------
/**
 * Helligkeits-/Kontrast-Normalisierung: streckt das 2.–98.-Perzentil auf 0…255. Gleicht dunkle Räume,
 * Blitzlicht und Sleeves aus; die Spitzen (Spiegelungen) werden abgeschnitten statt das Bild zu dominieren.
 */
export function normalizeContrast(g: Gray, lo = 0.02, hi = 0.98): Gray {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.d.length; i++) hist[Math.max(0, Math.min(255, g.d[i] | 0))]++;
  const n = g.d.length;
  let acc = 0, a = 0, b = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * lo) { a = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * (1 - hi)) { b = v; break; } }
  if (b - a < 16) return g; // fast einfarbig – nichts zu strecken
  const scale = 255 / (b - a);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.max(0, Math.min(255, (g.d[i] - a) * scale));
  return { w: g.w, h: g.h, d };
}

/** Anteil fast weißer Pixel (Spiegelung / Glanz der Folie). Über ~6 % sinkt die Treffsicherheit deutlich. */
export function glareRatio(g: Gray, threshold = 248): number {
  let n = 0;
  for (let i = 0; i < g.d.length; i++) if (g.d[i] >= threshold) n++;
  return g.d.length ? n / g.d.length : 0;
}
export const GLARE_HIGH = 0.06;

/** 16 Farbklassen: 12 Farbtöne (gesättigt) + 4 Helligkeitsstufen (ungesättigt: schwarz, dunkel, hell, weiß). */
export const COLOR_BINS = 16;

/**
 * Farb-Signatur des Artworks direkt aus dem RGBA-Kamerabild (perspektivisch korrekt über die Homographie).
 * Ergebnis: 16 Klassen × 4 Bit als Hex-Text (16 Zeichen). Ergänzt pHash/dHash, die nur Helligkeit sehen –
 * z. B. bei gleichen Motiven mit anderer Farbgebung (Shiny, Gold, Reverse-Muster).
 */
export function colorSignature(rgba: ArrayLike<number>, w: number, h: number, corners: Pt[], channels = 4): string {
  const H = homography(corners);
  const hist = new Float32Array(COLOR_BINS);
  const GX = 24, GY = 16;
  let total = 0;
  for (let gy = 0; gy < GY; gy++) {
    const v = ART_BOX.v0 + ((gy + 0.5) / GY) * (ART_BOX.v1 - ART_BOX.v0);
    for (let gx = 0; gx < GX; gx++) {
      const u = ART_BOX.u0 + ((gx + 0.5) / GX) * (ART_BOX.u1 - ART_BOX.u0);
      const [x, y] = project(H, u, v);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      const p = (yi * w + xi) * channels;
      const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      const sat = max ? delta / max : 0;
      let bin: number;
      if (sat > 0.25 && max > 0.15) {
        let hue = 0;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = (hue * 60 + 360) % 360;
        bin = Math.min(11, Math.floor(hue / 30));
      } else bin = 12 + Math.min(3, Math.floor(max * 4));
      hist[bin]++; total++;
    }
  }
  let out = "";
  for (let i = 0; i < COLOR_BINS; i++) out += Math.round(Math.min(1, (total ? hist[i] / total : 0) * 3) * 15).toString(16);
  return out;
}

export const isColorSig = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{16}$/.test(s);

/** L1-Abstand zweier Farb-Signaturen (0 … 240). */
export function colorDistance(a: string, b: string): number {
  if (!isColorSig(a) || !isColorSig(b)) return 0;
  let d = 0;
  for (let i = 0; i < COLOR_BINS; i++) d += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  return d;
}

/** Zuschlag auf den Hash-Abstand bei abweichenden Farben (ähnliche Farben: 0). */
export const colorPenalty = (dist: number) => Math.max(0, dist - 18) * 0.3;

/** Hamming-Abstand zweier 64-Bit-Hex-Hashes (null bei ungültigem Format). */
export function hexDistance(a: string, b: string): number | null {
  const x = hexToWords(a), y = hexToWords(b);
  if (!x || !y) return null;
  return popcount32(x[0] ^ y[0]) + popcount32(x[1] ^ y[1]);
}

// ---------------------------------------------------------------------------
// Ziffern-Erkennung (Kartennummer „199/165“) über Vorlagenvergleich
// ---------------------------------------------------------------------------
export const GLYPH_W = 12;
export const GLYPH_H = 16;
export type Glyph = { ch: string; v: Float32Array };

/** Otsu-Schwelle (0…255). */
export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.d) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = g.d.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

type Comp = { x0: number; y0: number; x1: number; y1: number; n: number; px: number[] };

/** Zusammenhängende Vordergrund-Flächen (8er-Nachbarschaft – hält auch unscharfe, dünne Ziffern zusammen). */
export function components(mask: Uint8Array, w: number, h: number): Comp[] {
  const seen = new Uint8Array(w * h);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, n: 0, px: [] };
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j / w) | 0;
      c.n++; c.px.push(j);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (c.n > 4000) break;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || !mask[k]) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    stack.length = 0;
    out.push(c);
  }
  return out;
}

/** Zeichen-Bitmap (beliebige Größe) → normierter Vektor GLYPH_W × GLYPH_H (Seitenverhältnis bleibt, zentriert, mittelwertfrei). */
export function glyphVector(bits: ArrayLike<number>, w: number, h: number): Float32Array {
  const v = new Float32Array(GLYPH_W * GLYPH_H);
  const scale = Math.max(w / GLYPH_W, h / GLYPH_H);
  const ox = (GLYPH_W - w / scale) / 2, oy = (GLYPH_H - h / scale) / 2;
  for (let y = 0; y < GLYPH_H; y++) for (let x = 0; x < GLYPH_W; x++) {
    const sx = (x + 0.5 - ox) * scale, sy = (y + 0.5 - oy) * scale;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    // Mittel über den Quellbereich des Zielpixels
    let s = 0, n = 0;
    const r = Math.max(0.5, scale / 2);
    for (let yy = Math.floor(sy - r + 0.5); yy <= Math.floor(sy + r - 0.5); yy++) for (let xx = Math.floor(sx - r + 0.5); xx <= Math.floor(sx + r - 0.5); xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += bits[yy * w + xx]; n++;
    }
    v[y * GLYPH_W + x] = n ? s / n : 0;
  }
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * Liest „123/456“ aus einem Nummern-Streifen. Probiert beide Polaritäten (dunkle Schrift auf hellem Rand und
 * helle Schrift auf Full-Art-Karten). Liefert Nummer, Gesamtzahl und Konfidenz (mittlere Korrelation).
 */
export function readNumber(strip: Gray, glyphs: Glyph[]): { num: number; total: number; text: string; conf: number } | null {
  if (!glyphs.length) return null;
  const thr = otsu(strip);
  let best: { num: number; total: number; text: string; conf: number } | null = null;
  for (const dark of [true, false]) {
    const mask = new Uint8Array(strip.d.length);
    for (let i = 0; i < mask.length; i++) mask[i] = (dark ? strip.d[i] <= thr : strip.d[i] > thr) ? 1 : 0;
    const comps = components(mask, strip.w, strip.h).filter((c) => {
      const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1;
      return ch >= strip.h * 0.14 && ch <= strip.h * 0.6 && cw <= ch * 1.25 && c.n >= 8 && c.y0 > 0 && c.y1 < strip.h - 1;
    });
    if (comps.length < 4) continue;
    // Zeilen bilden: ähnliche Höhe und Mittellinie
    comps.sort((a, b) => a.x0 - b.x0);
    const used = new Set<Comp>();
    for (const seed of comps) {
      if (used.has(seed)) continue;
      const sh = seed.y1 - seed.y0 + 1, sc = (seed.y0 + seed.y1) / 2;
      const row = comps.filter((c) => !used.has(c) && Math.abs((c.y0 + c.y1) / 2 - sc) < sh * 0.35 && Math.abs(c.y1 - c.y0 + 1 - sh) < sh * 0.4 || (c === seed));
      row.forEach((c) => used.add(c));
      if (row.length < 4) continue;
      row.sort((a, b) => a.x0 - b.x0);
      let text = "", confSum = 0, n = 0, prevX = -1;
      for (const c of row) {
        const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
        if (prevX >= 0 && c.x0 - prevX > sh * 1.1) text += " ";
        prevX = c.x1;
        const bits = new Float32Array(cw * ch);
        for (const j of c.px) bits[((j / strip.w) | 0) * cw - c.y0 * cw + (j % strip.w) - c.x0] = 1;
        const vec = glyphVector(bits, cw, ch);
        let bestCh = "?", bestS = -1;
        for (const g of glyphs) { const s = dot(vec, g.v); if (s > bestS) { bestS = s; bestCh = g.ch; } }
        // „1“ und „/“ unterscheiden sich vor allem in der Neigung – sehr schmale, senkrechte Striche sind „1“
        if (bestCh === "/" && cw <= ch * 0.28) bestCh = "1";
        text += bestS > 0.45 ? bestCh : "?";
        confSum += bestS; n++;
      }
      const m = text.replace(/ /g, "").match(/(\d{1,3})\/(\d{2,3})/);
      if (!m) continue;
      const conf = confSum / n;
      const num = Number(m[1]), total = Number(m[2]);
      if (!(num > 0) || !(total >= 10)) continue;
      if (!best || conf > best.conf) best = { num, total, text: `${m[1]}/${m[2]}`, conf };
    }
  }
  return best;
}

/** Text einer Plattform-Texterkennung (TextDetector) nach „123/456“ durchsuchen. */
export function parseNumberText(text: string): { num: number; total: number } | null {
  const m = String(text || "").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").match(/(\d{1,3})\s*\/\s*(\d{2,3})/);
  if (!m) return null;
  const num = Number(m[1]), total = Number(m[2]);
  return num > 0 && total >= 10 ? { num, total } : null;
}

// ---------------------------------------------------------------------------
// Index-Format (vom Server ausgeliefert, im Worker durchsucht)
// ---------------------------------------------------------------------------
/** Index-Schlüssel → Art + lokale Nummer: "sv03.5-199" (deutsch) bzw. "en:sv03.5-199" (Druck). */
export function splitIndexId(id: string): { kind: "card" | "print"; lang: string; setId: string; localId: string } {
  const m = String(id).match(/^(?:(en|ja):)?(.+)-([^-]+)$/);
  if (!m) return { kind: "card", lang: "de", setId: "", localId: "" };
  return { kind: m[1] ? "print" : "card", lang: m[1] || "de", setId: m[2], localId: m[3] };
}
export const localNumber = (localId: string) => (/^\d{1,4}$/.test(localId) ? Number(localId) : -1);

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Hashes als Big-Endian-Uint32 in Bytes (unabhängig von der Byte-Reihenfolge des Geräts). */
export function packWords(words: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) dv.setUint32(i * 4, words[i] >>> 0, false);
  return out;
}
export function unpackWords(bytes: Uint8Array): Uint32Array {
  const n = Math.floor(bytes.length / 4);
  const out = new Uint32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, false);
  return out;
}

/**
 * Treffer bewerten: gleiches Artwork (Sprachversionen/Varianten) zusammenfassen, Abstand zum nächsten anderen Motiv
 * und optional die gelesene Kartennummer einbeziehen.
 */
export function decide(
  matches: { i: number; score: number; art: number }[],
  index: Uint32Array,
  meta: { localNum: (i: number) => number; total: (i: number) => number },
  ocr: { num: number; total: number } | null,
) {
  if (!matches.length) return { accepted: false, group: [] as number[], best: -1, score: Infinity, margin: 0, byNumber: false };
  const sameArt = (a: number, b: number) => {
    const d = popcount32(index[a * WORDS] ^ index[b * WORDS]) + popcount32(index[a * WORDS + 1] ^ index[b * WORDS + 1]);
    return d <= SAME_ART_MAX;
  };
  let lead = matches[0];
  let byNumber = false;
  if (ocr) {
    const hit = matches.find((m) => m.score <= SCORE_WITH_NUMBER && meta.localNum(m.i) === ocr.num && (meta.total(m.i) <= 0 || meta.total(m.i) === ocr.total));
    if (hit) { lead = hit; byNumber = true; }
  }
  const group = matches.filter((m) => m.i === lead.i || (sameArt(m.i, lead.i) && m.score <= lead.score + 14 && (meta.localNum(m.i) === meta.localNum(lead.i) || meta.localNum(lead.i) < 0)));
  const other = matches.find((m) => !group.includes(m));
  const margin = other ? other.score - lead.score : 99;
  const accepted = byNumber || (lead.score <= SCORE_ACCEPT && margin >= MARGIN_MIN);
  return { accepted, group: group.map((g) => g.i), best: lead.i, score: lead.score, margin, byNumber };
}

// ---------------------------------------------------------------------------
// Scanner-Upgrade: Spiegelungen, Schärfe, Nachschärfen, Ersatz-Zuschnitte
// ---------------------------------------------------------------------------
/**
 * Spiegelungen (Holo-Folie, Toploader, Sleeve) unterdrücken: fast weiße Pixel werden durch den Mittelwert der
 * nicht gespiegelten Nachbarschaft (Box-Radius r) ersetzt. Die Referenzbilder haben keine Spiegelungen –
 * ohne diese Korrektur verschieben helle Flecken den pHash/dHash des Artworks und der Treffer geht verloren.
 */
export function suppressGlare(g: Gray, threshold = 245, r = 6): Gray {
  const { w, h, d } = g;
  let glare = 0;
  for (let i = 0; i < d.length; i++) if (d[i] >= threshold) glare++;
  if (!glare || glare === d.length) return g;
  // Integralbilder über Summe und Anzahl der NICHT gespiegelten Pixel
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1)), cnt = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < w; x++) {
      const v = d[y * w + x];
      if (v < threshold) { rs += v; rc++; }
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      cnt[(y + 1) * W + x + 1] = cnt[y * W + x + 1] + rc;
    }
  }
  const out = new Float32Array(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (d[i] < threshold) continue;
    let rr = r, s = 0, c = 0;
    // Große Glanzflächen: Radius schrittweise vergrößern, bis genug echte Nachbarn gefunden sind
    for (let k = 0; k < 4 && c < 4; k++, rr *= 2) {
      const x0 = Math.max(0, x - rr), y0 = Math.max(0, y - rr), x1 = Math.min(w, x + rr + 1), y1 = Math.min(h, y + rr + 1);
      s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      c = cnt[y1 * W + x1] - cnt[y0 * W + x1] - cnt[y1 * W + x0] + cnt[y0 * W + x0];
    }
    out[i] = c ? s / c : d[i];
  }
  return { w, h, d: out };
}

/**
 * Schärfemaß einer normierten Karte (mittlerer Betrag des Laplace-Operators). Unabhängig von der Kamera-Auflösung,
 * weil immer auf NORM_W × NORM_H gemessen wird – Grundlage für die Auto-Auslösung („scharf und ruhig“).
 */
export function focusScore(g: Gray): number {
  const { w, h, d } = g;
  let s = 0, n = 0;
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    s += Math.abs(4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w]);
    n++;
  }
  return n ? s / n : 0;
}

/** Unscharfe Maske (3×3): hebt Kanten der Sammlernummer hervor, bevor die Ziffern gelesen werden. */
export function sharpen(g: Gray, amount = 0.8): Gray {
  const { w, h, d } = g;
  const out = new Float32Array(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const blur = (d[i - w - 1] + d[i - w] + d[i - w + 1] + d[i - 1] + d[i] + d[i + 1] + d[i + w - 1] + d[i + w] + d[i + w + 1]) / 9;
    out[i] = Math.max(0, Math.min(255, d[i] + amount * (d[i] - blur)));
  }
  return { w, h, d: out };
}

/** Viereck um seinen Mittelpunkt skalieren (Ersatz-Zuschnitte, wenn die Kartenkanten nicht sicher gefunden wurden). */
export function scaleQuad(q: Pt[], k: number): Pt[] {
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cy = q.reduce((s, p) => s + p[1], 0) / q.length;
  return q.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt);
}
/** Ohne erkannte Kanten werden diese Skalierungen des Führungsrahmens probiert (Karte kleiner gehalten, Toploader-Rand). */
export const FALLBACK_SCALES = [1, 0.93, 0.86];

/** Mittlere Eckenbewegung zweier Vierecke relativ zur Breite – Grundlage der Stabilitäts-Erkennung. */
export function quadMotion(a: Pt[] | null | undefined, b: Pt[] | null | undefined): number {
  if (!a || !b || a.length !== 4 || b.length !== 4) return 1;
  const width = Math.max(1, Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]));
  let s = 0;
  for (let i = 0; i < 4; i++) s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return s / 4 / width;
}
/** Bewegung unter diesem Anteil der Kartenbreite gilt als „ruhig gehalten“. */
export const STABLE_MOTION = 0.025;
