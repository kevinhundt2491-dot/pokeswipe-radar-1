// PokeSwipe & Radar – High-End-Scanner-Engine: reine Rechen-Logik (ohne DOM/Netzwerk, im Worker und in Tests nutzbar).
//
//  • warpCardRgba / prepareCard – Karte begradigen, Folien-Spiegelungen (Luminanz > 238 bei niedriger Sättigung) maskieren und
//                                 herausrechnen, Helligkeit & Kontrast normalisieren (Zero-Mean / Unit-Variance)
//  • artVector / artSimilarity   – Stufe 2: HSV-Farbmatrix + Sobel-Kantengradient des inneren Artworks (sprachunabhängig)
//  • typeClassOf / probeClasses  – Stufe 1: Schnell-Vorfilter nach Kartentyp / Rahmenfarbe
//  • paletteVector / paletteCheck – Pflicht-Farbabgleich: dominante Kartenfarbe (Artwork + Rahmen) Kamera ↔ Katalog
//  • fuseMatch                   – Übereinstimmung aus pHash/dHash + Farb-Layout + HSV-Matrix + Kantengradient + Farbsignatur
//  • fitGrid / gridSlots         – 3×3- bzw. 2×2-Binder-Raster an die aufgeschlagene Ordnerseite anpassen
//  • createSlotGate              – räumliche Slot-Sperre je Fach, Seitenwechsel-Reset (> 65 % Bildänderung), „gleiche Seite“-Schutz
import { homography, project, ART_BOX } from "../../server/scan-logic.ts";
import { TYPE_CLASSES, CLASS_UNKNOWN, typeClassOf } from "../../server/scan-text-logic.ts";
import { SWEEP, quadCenter } from "./sweep-logic.js";

export const HD = {
  /** Folien-Reflex: heller als GLARE_LUM (0…255) und kaum Farbe (Sättigung < GLARE_SAT) */
  GLARE_LUM: 238,
  GLARE_SAT: 0.25,
  /** Ziel der Helligkeits-/Kontrast-Normalisierung (Mittelwert, Standardabweichung) */
  NORM_MEAN: 128,
  NORM_STD: 50,
  /** Anteil von Farbe/Kanten an der Übereinstimmung, sobald Referenz-Vektoren vorliegen */
  VECTOR_WEIGHT: 0.35,
  /** Breite des Bilds an den Worker im Ordner-Modus (Slots werden aus dem nativen HD-Bild geschnitten) */
  BINDER_FRAME_W: 1280,
  /** Rückfall ohne OffscreenCanvas: Breite des Pixel-Puffers */
  BINDER_FALLBACK_W: 900,
  /** Auflösung eines ausgeschnittenen Kartenfachs */
  SLOT_W: 252,
  SLOT_H: 352,
  /** Raster: Mindest-Kantenstärke der Rasterlinien (relativ zur mittleren Bildkante) */
  GRID_MIN_SCORE: 1.15,
  /** Gleichmäßigkeit der Rasterlinien: schwächste Linie mindestens so stark (Anteil der stärksten) */
  GRID_MIN_CONTRAST: 0.25,
  /** Karte liegt etwas kleiner im Fach als das Fach selbst */
  SLOT_INSET: 0.035,
  /** Seitenwechsel: so viel Bildfläche muss sich deutlich ändern */
  FLIP_AREA: 0.65,
  /** Nach dem Umblättern: Bild gilt wieder als ruhig */
  CALM_AREA: 0.3,
  CALM_FRAMES: 2,
  /** Fächer mit anderer Karte als vor dem Umblättern, ab denen die Seite als NEUE Seite gilt */
  NEW_PAGE_DIFF: 2,
  /** Aufeinanderfolgende Auswertungen desselben Fachs mit derselben Karte */
  SLOT_FRAMES: 2,
};

// ---------------------------------------------------------------------------
// Begradigen + Anti-Glare + Normalisierung
// ---------------------------------------------------------------------------
/**
 * Perspektivisch entzerrte Karte aus dem RGBA-Bild: Graubild (bilinear), RGB (nächster Nachbar) und Glanz-Maske
 * (Luminanz > GLARE_LUM bei niedriger Sättigung = Lichtreflex auf Klarsichtfolie/Sleeve, kein Karteninhalt).
 */
export function warpCardRgba(rgba, w, h, quad, outW, outH) {
  const H = homography(quad);
  const n = outW * outH;
  const d = new Float32Array(n), rgb = new Uint8Array(n * 3), glare = new Uint8Array(n);
  let hot = 0;
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = project(H, (x + 0.5) / outW, v);
      const xc = Math.min(w - 1.001, Math.max(0, sx)), yc = Math.min(h - 1.001, Math.max(0, sy));
      const x0 = Math.floor(xc), y0 = Math.floor(yc), ax = xc - x0, ay = yc - y0;
      const o = (y0 * w + x0) * 4, o2 = o + w * 4;
      const l00 = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2], l10 = 0.299 * rgba[o + 4] + 0.587 * rgba[o + 5] + 0.114 * rgba[o + 6];
      const l01 = 0.299 * rgba[o2] + 0.587 * rgba[o2 + 1] + 0.114 * rgba[o2 + 2], l11 = 0.299 * rgba[o2 + 4] + 0.587 * rgba[o2 + 5] + 0.114 * rgba[o2 + 6];
      const lum = l00 + (l10 - l00) * ax + (l01 - l00) * ay + (l00 - l10 - l01 + l11) * ax * ay;
      const i = y * outW + x;
      d[i] = lum;
      const p = ((ay < 0.5 ? y0 : y0 + 1) * w + (ax < 0.5 ? x0 : x0 + 1)) * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      if (lum > HD.GLARE_LUM) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 0 && (mx - mn) / mx < HD.GLARE_SAT) { glare[i] = 1; hot++; }
      }
    }
  }
  return { w: outW, h: outH, d, rgb, glare, glareRatio: n ? hot / n : 0 };
}

/**
 * Graubild für die bestehenden Glanz-Werkzeuge (suppressGlare / glareMask, Schwelle 245): maskierte Pixel = 255,
 * alle übrigen höchstens 244 – so entscheidet allein die Farb-Maske, was als Reflex gilt.
 */
export function glareGray(card) {
  const d = new Float32Array(card.d.length);
  for (let i = 0; i < d.length; i++) d[i] = card.glare[i] ? 255 : Math.min(244, card.d[i]);
  return { w: card.w, h: card.h, d };
}

/** Helligkeits- & Kontrast-Normalisierung: Mittelwert 0 / Standardabweichung 1, auf NORM_MEAN ± NORM_STD skaliert. */
export function zmuv(g, mask = null) {
  let s = 0, n = 0;
  for (let i = 0; i < g.d.length; i++) if (!mask || !mask[i]) { s += g.d[i]; n++; }
  if (!n) return g;
  const mean = s / n;
  let q = 0;
  for (let i = 0; i < g.d.length; i++) if (!mask || !mask[i]) { const v = g.d[i] - mean; q += v * v; }
  const std = Math.sqrt(q / n);
  if (std < 1e-3) return g;
  const k = HD.NORM_STD / std;
  const d = new Float32Array(g.d.length);
  for (let i = 0; i < d.length; i++) d[i] = (g.d[i] - mean) * k + HD.NORM_MEAN;
  return { w: g.w, h: g.h, d };
}

// ---------------------------------------------------------------------------
// Stufe 2: HSV-Farbmatrix + Sobel-Kantengradient des inneren Artworks
// ---------------------------------------------------------------------------
export const ART_GX = 4;
export const ART_GY = 3;
export const ART_LEN = ART_GX * ART_GY * 6;

/**
 * Vektor des Illustrationsfensters (ART_BOX, obere Kartenmitte – bei DE/EN/JA identisch, frei von Hüllenrändern):
 * je Zelle (4 × 3) Farbton als Vektor (cos, sin · Sättigung), Sättigung, Helligkeit relativ zum Fenster-Mittel sowie
 * Kantengradient (Anteil waagerechter Gradient, Kantenenergie relativ zum Fenster-Mittel). Reflex-Pixel zählen nicht.
 * card: Ergebnis von warpCardRgba · gray: normalisiertes Graubild gleicher Größe (für den Gradienten).
 */
export function artVector(card, gray = card) {
  const { w, h, rgb, glare } = card;
  const x0 = Math.round(ART_BOX.u0 * w), x1 = Math.round(ART_BOX.u1 * w), y0 = Math.round(ART_BOX.v0 * h), y1 = Math.round(ART_BOX.v1 * h);
  const nC = ART_GX * ART_GY;
  const hx = new Float32Array(nC), hy = new Float32Array(nC), sS = new Float32Array(nC), sV = new Float32Array(nC), cnt = new Float32Array(nC);
  const ex = new Float32Array(nC), ey = new Float32Array(nC);
  const g = gray.d;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y += 2) {
    const cy = Math.min(ART_GY - 1, Math.floor(((y - y0) * ART_GY) / (y1 - y0)));
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x += 2) {
      const i = y * w + x;
      if (glare && glare[i]) continue;
      const c = cy * ART_GX + Math.min(ART_GX - 1, Math.floor(((x - x0) * ART_GX) / (x1 - x0)));
      const r = rgb[i * 3], gg = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dl = mx - mn;
      const sat = mx ? dl / mx : 0;
      if (dl > 0) {
        let hue = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4;
        hue *= Math.PI / 3;
        hx[c] += Math.cos(hue) * sat; hy[c] += Math.sin(hue) * sat;
      }
      sS[c] += sat; sV[c] += mx; cnt[c]++;
      ex[c] += Math.abs(g[i + 1] - g[i - 1]); ey[c] += Math.abs(g[i + w] - g[i - w]);
    }
  }
  let vAll = 0, eAll = 0, used = 0;
  for (let c = 0; c < nC; c++) if (cnt[c]) { vAll += sV[c] / cnt[c]; eAll += (ex[c] + ey[c]) / cnt[c]; used++; }
  const vMean = used ? vAll / used : 1, eMean = used ? eAll / used : 1;
  const out = new Uint8Array(ART_LEN);
  const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let c = 0; c < nC; c++) {
    const o = c * 6, n = cnt[c];
    if (!n) { out.set([128, 128, 0, 128, 128, 128], o); continue; }
    out[o] = u8(128 + 127 * (hx[c] / n)); out[o + 1] = u8(128 + 127 * (hy[c] / n));
    out[o + 2] = u8(255 * (sS[c] / n));
    out[o + 3] = u8((128 * (sV[c] / n)) / Math.max(8, vMean));
    const e = ex[c] + ey[c];
    out[o + 4] = u8(e > 0 ? (255 * ex[c]) / e : 128);
    out[o + 5] = u8((128 * (e / n)) / Math.max(0.5, eMean));
  }
  return out;
}

/** Ähnlichkeit zweier Artwork-Vektoren: { hsv, edge } je 0…1 (1 = gleich) – null bei fehlendem Vektor. */
export function artSimilarity(a, b) {
  if (!a || !b || a.length !== ART_LEN || b.length !== ART_LEN) return null;
  let dc = 0, de = 0;
  const n = ART_GX * ART_GY;
  for (let c = 0; c < n; c++) {
    const o = c * 6;
    dc += (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1])) * 0.5 + Math.abs(a[o + 2] - b[o + 2]) * 0.35 + Math.abs(a[o + 3] - b[o + 3]) * 0.9;
    de += Math.abs(a[o + 4] - b[o + 4]) * 0.6 + Math.abs(a[o + 5] - b[o + 5]) * 0.6;
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return { hsv: clamp(1 - (2.4 * dc) / n / 255), edge: clamp(1 - (2.4 * de) / n / 255) };
}

// ---------------------------------------------------------------------------
// Pflicht-Farbabgleich (Color-Sanity-Check): dominante Kartenfarbe / HSV-Farbverteilung von Artwork + Kartenrahmen
// ---------------------------------------------------------------------------
/** 12 Farbton-Fächer à 30° (0 = Rot, 4 = Grün, 7–8 = Blau …) + 1 Byte Farbanteil (wie bunt ist die Karte insgesamt) */
export const PAL_BINS = 12;
export const PAL_LEN = PAL_BINS + 1;

/**
 * Farbsignatur einer begradigten Karte (warpCardRgba): Farbton-Verteilung über die GANZE Karte (Artwork + Rahmen/Hintergrund,
 * äußerste 3–4 % ohne Hüllenkante), gewichtet mit Sättigung × Helligkeit. Graustufen-Hashes (pHash/dHash) sehen keine Farbe –
 * diese Signatur trennt z. B. eine rote Feuer-Karte von einer grünen Pflanzen- oder blauen Wasser-Karte.
 * Folien-Reflexe, sehr dunkle und kaum gesättigte Pixel zählen nicht. Rückgabe: Uint8Array(PAL_LEN).
 */
export function paletteVector(card) {
  const { w, h, rgb, glare } = card;
  const hist = new Float32Array(PAL_BINS);
  let chroma = 0, total = 0;
  const x0 = Math.round(w * 0.04), x1 = Math.round(w * 0.96), y0 = Math.round(h * 0.03), y1 = Math.round(h * 0.97);
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = y * w + x;
    if (glare && glare[i]) continue;
    total++;
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
    if (mx < 40 || dl < 24) continue;
    const sat = dl / mx;
    if (sat < 0.2) continue;
    let hue = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
    hue = ((hue * 60) + 360) % 360;
    const wgt = sat * (mx / 255);
    // weiche Zuordnung auf die zwei nächsten Fächer (kein Sprung an Fachgrenzen)
    const f = hue / 30 - 0.5, b0 = Math.floor(f), frac = f - b0;
    hist[(b0 + PAL_BINS) % PAL_BINS] += wgt * (1 - frac);
    hist[(b0 + 1 + PAL_BINS) % PAL_BINS] += wgt * frac;
    chroma += wgt;
  }
  const out = new Uint8Array(PAL_LEN);
  for (let k = 0; k < PAL_BINS; k++) out[k] = chroma > 0 ? Math.round((255 * hist[k]) / chroma) : 0;
  out[PAL_BINS] = Math.round(255 * Math.min(1, total ? chroma / total : 0));
  return out;
}

/** Fächer → geglättete Verteilung (Summe 1), mittlerer Farbton (Grad) und Bündelung R (0 = bunt gemischt, 1 = eine Farbe) */
function palStats(v) {
  const p = new Float32Array(PAL_BINS);
  let s = 0;
  for (let k = 0; k < PAL_BINS; k++) s += v[k];
  for (let k = 0; k < PAL_BINS; k++) p[k] = s ? v[k] / s : 0;
  const sm = new Float32Array(PAL_BINS);
  for (let k = 0; k < PAL_BINS; k++) sm[k] = 0.5 * p[k] + 0.25 * (p[(k + PAL_BINS - 1) % PAL_BINS] + p[(k + 1) % PAL_BINS]);
  let X = 0, Y = 0;
  for (let k = 0; k < PAL_BINS; k++) { const t = ((k + 0.5) * 30 * Math.PI) / 180; X += p[k] * Math.cos(t); Y += p[k] * Math.sin(t); }
  return { sm, hue: ((Math.atan2(Y, X) * 180) / Math.PI + 360) % 360, R: Math.hypot(X, Y), chroma: v[PAL_BINS] / 255 };
}

/** Schwellen des Farbabgleichs */
export const COLOR = {
  /** darunter gilt eine Karte als (fast) farblos – Trainer/Farblos/Metall: dann kein Verwerfen über den Farbton */
  MIN_CHROMA: 0.08,
  /** dominante Farbe nur vergleichen, wenn sie gebündelt ist (keine Regenbogen-Karte) */
  MIN_FOCUS: 0.3,
  /** Grundfarben weiter auseinander als HUE_REJECT (Grad) UND Überlappung der Verteilungen < OVERLAP_REJECT → verwerfen */
  HUE_REJECT: 70,
  OVERLAP_REJECT: 0.45,
  /** Verteilungen überlappen kaum noch → verwerfen (unabhängig vom mittleren Farbton) */
  OVERLAP_HARD: 0.2,
};

/**
 * Farb-Abgleich Kamera ↔ Katalogbild: { sim 0…1, overlap, hueDist (Grad oder null), reject }.
 * reject = true: Grundfarbe passt nicht (z. B. rote Feuer-Karte vor der Kamera vs. grüne Pflanzen-/blaue Wasser-Karte im
 * Katalog) → Kandidat wird sofort verworfen. null bei fehlendem Vektor.
 */
export function paletteCheck(a, b) {
  if (!a || !b || a.length !== PAL_LEN || b.length !== PAL_LEN) return null;
  const A = palStats(a), B = palStats(b);
  const colorful = A.chroma >= COLOR.MIN_CHROMA && B.chroma >= COLOR.MIN_CHROMA;
  let overlap = 0;
  for (let k = 0; k < PAL_BINS; k++) overlap += Math.min(A.sm[k], B.sm[k]);
  const dh = Math.abs(A.hue - B.hue), hueDist = colorful && A.R >= COLOR.MIN_FOCUS && B.R >= COLOR.MIN_FOCUS ? Math.min(dh, 360 - dh) : null;
  const reject = colorful && ((hueDist !== null && hueDist >= COLOR.HUE_REJECT && overlap < COLOR.OVERLAP_REJECT) || overlap < COLOR.OVERLAP_HARD);
  const chromaSim = 1 - Math.min(1, Math.abs(A.chroma - B.chroma) / 0.5);
  const sim = colorful ? 0.8 * overlap + 0.2 * chromaSim : 0.6 + 0.4 * chromaSim;
  return { sim: Math.max(0, Math.min(1, sim)), overlap: Math.round(overlap * 1000) / 1000, hueDist: hueDist === null ? null : Math.round(hueDist), reject };
}

/**
 * Schärfe einer begradigten, normalisierten Karte (zmuv): mittlere Gradientenstärke. Verwischte Bilder (Bewegungsunschärfe
 * beim Wegziehen) liegen deutlich darunter – der Gate vergleicht sie mit dem vorigen Bild derselben Karte.
 */
export function cardSharpness(g) {
  const { w, h, d } = g;
  let s = 0, n = 0;
  for (let y = 4; y < h - 4; y += 3) for (let x = 4; x < w - 4; x += 3) {
    const i = y * w + x;
    s += Math.abs(d[i + 1] - d[i - 1]) + Math.abs(d[i + w] - d[i - w]);
    n++;
  }
  return n ? Math.round((s / n) * 100) / 100 : 0;
}

/** Anteil übereinstimmender Fingerabdruck-Bits (gewichteter Hash-Abstand → 0…1). */
const hashSim = (score) => Math.max(0, Math.min(1, 1 - Number(score) / SWEEP.HASH_SCALE));

/**
 * Übereinstimmung 0…1 aus allen Stufen: Bild-Fingerabdruck (64-Bit pHash + 64-Bit dHash + Karten-pHash) und – sobald für
 * die Referenz vorhanden – Farb-Layout, HSV-Farbmatrix, Kantengradient und Farbsignatur (zusammen VECTOR_WEIGHT).
 */
export function fuseMatch(score, { layout = null, hsv = null, edge = null, color = null } = {}) {
  const h = hashSim(score);
  const parts = [[layout, 0.4], [hsv, 0.35], [edge, 0.25], [color, 0.4]].filter(([v]) => v !== null && v !== undefined && Number.isFinite(v));
  if (!parts.length) return h;
  const wsum = parts.reduce((s, [, k]) => s + k, 0);
  const vec = parts.reduce((s, [v, k]) => s + v * k, 0) / wsum;
  return (1 - HD.VECTOR_WEIGHT) * h + HD.VECTOR_WEIGHT * vec;
}

// ---------------------------------------------------------------------------
// Stufe 1: Schnell-Vorfilter nach Kartentyp / Rahmenfarbe
// ---------------------------------------------------------------------------
export { TYPE_CLASSES, CLASS_UNKNOWN, typeClassOf };

/**
 * Dominante Kartenfarbe (Textfeld unter dem Artwork: dort trägt die Karte ihre Typfarbe) → mittleres H (0…360), S, V (0…1).
 * card: Ergebnis von warpCardRgba. Reflex-Pixel zählen nicht.
 */
export function frameColor(card) {
  const { w, h, rgb, glare } = card;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.round(h * 0.57); y < Math.round(h * 0.86); y += 3) for (let x = Math.round(w * 0.1); x < Math.round(w * 0.9); x += 3) {
    const i = y * w + x;
    if (glare && glare[i]) continue;
    r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; n++;
  }
  if (!n) return { h: 0, s: 0, v: 0, n: 0 };
  r /= n; g /= n; b /= n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
  let hue = 0;
  if (dl > 0) { hue = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; hue *= 60; if (hue < 0) hue += 360; }
  return { h: hue, s: mx ? dl / mx : 0, v: mx / 255, n };
}

/**
 * Klassen, in denen eine Karte dieser Farbe liegen kann (großzügig – Nachbarfarben zählen mit). Der Vorfilter
 * durchsucht nur diese Klassen (+ Karten ohne bekannte Klasse); findet er dort keinen klaren Treffer, wird der ganze
 * Index durchsucht – der Filter spart Zeit, kostet aber nie einen Treffer.
 */
export function probeClasses(col) {
  if (!col || !col.n) return null;
  const { h, s, v } = col;
  if (s < 0.2) return v < 0.45 ? [6, 7, 9, 10] : [7, 9, 10];
  if (h < 12 || h >= 335) return [0, 4, 5];
  if (h < 40) return [0, 5, 8];
  if (h < 72) return [3, 8, 5];
  if (h < 165) return [2, 8];
  if (h < 255) return [1, 6, 7];
  return [4, 6];
}

/** Zeilen des Index, deren Klasse zur Farbe passt (immer inkl. Energie und unbekannt). base = Zeilen eines Sets oder null. */
export function classRows(cls, classes, base = null, count = cls?.length || 0) {
  if (!cls || !classes) return null;
  const allow = new Uint8Array(256);
  for (const c of classes) allow[c] = 1;
  allow[11] = 1; allow[CLASS_UNKNOWN] = 1;
  const out = [];
  const n = base ? base.length : count;
  for (let j = 0; j < n; j++) { const i = base ? base[j] : j; if (allow[cls[i]]) out.push(i); }
  return new Int32Array(out);
}

// ---------------------------------------------------------------------------
// Binder-Raster (3 × 3 / 2 × 2)
// ---------------------------------------------------------------------------
export const GRID_LAYOUTS = { "3x3": { cols: 3, rows: 3 }, "2x2": { cols: 2, rows: 2 } };
const pageRatio = (cols, rows) => (cols * 63) / (rows * 88);

/** Ausgangs-Raster: mittig, so groß wie möglich (frac der Bildfläche). */
export function defaultGrid(w, h, cols = 3, rows = 3, frac = 0.9) {
  const ratio = pageRatio(cols, rows);
  const ph = Math.min(h * frac, (w * frac) / ratio), pw = ph * ratio;
  return { x0: (w - pw) / 2, y0: (h - ph) / 2, x1: (w + pw) / 2, y1: (h + ph) / 2, score: 0, fitted: false };
}

/**
 * Raster an die Ordnerseite anpassen: Für jede Größe und Position wird die Kantenstärke entlang ALLER Rasterlinien
 * (Außenrand + Trennlinien zwischen den Fächern) über Präfixsummen gemessen. Karten liegen im Ordner Kante an Kante –
 * gesucht wird deshalb nicht die einzelne Karte vor dunklem Tisch, sondern das regelmäßige Linienmuster der Folie.
 * lines: edgeLines(grad, w, h) · sharp: edgeLines(grad, w, h, 0) (optional: scharfe Linien für die pixelgenaue Naht-Suche).
 * Rückgabe: { x0, y0, x1, y1, score, gap?, fitted: true } oder null (gap = halbe Nahtbreite relativ zum Fach).
 */
export function fitGrid(lines, w, h, cols = 3, rows = 3, { minFrac = 0.5, minScore = HD.GRID_MIN_SCORE, minContrast = HD.GRID_MIN_CONTRAST, sharp = null } = {}) {
  const { hLine, vLine, norm } = lines;
  const ratio = pageRatio(cols, rows);
  const score = (x0, y0, pw, ph) => {
    const mx = pw * 0.04, my = ph * 0.04;
    const xa = Math.round(x0 + mx), xb = Math.round(x0 + pw - mx), ya = Math.round(y0 + my), yb = Math.round(y0 + ph - my);
    let sum = 0, min = Infinity;
    for (let r = 0; r <= rows; r++) { const v = hLine(Math.max(0, Math.min(h - 1, Math.round(y0 + (ph * r) / rows))), xa, xb); sum += v; if (v < min) min = v; }
    for (let c = 0; c <= cols; c++) { const v = vLine(Math.max(0, Math.min(w - 1, Math.round(x0 + (pw * c) / cols))), ya, yb); sum += v; if (v < min) min = v; }
    return (0.5 * (sum / (rows + cols + 2)) + 0.5 * min) / norm;
  };
  // 1) Grob: beste Lage je Größe
  const maxH = Math.min(h - 2, (w - 2) / ratio), minH = maxH * minFrac;
  const perScale = [];
  let top = 0;
  for (let ph = maxH; ph >= minH; ph /= 1.06) {
    const pw = ph * ratio;
    const step = Math.max(2, Math.round(ph * 0.03));
    let best = null;
    for (let y0 = 0; y0 + ph <= h - 1; y0 += step) for (let x0 = 0; x0 + pw <= w - 1; x0 += step) {
      const sc = score(x0, y0, pw, ph);
      if (!best || sc > best.score) best = { x0, y0, pw, ph, score: sc, step };
    }
    if (best) { perScale.push(best); if (best.score > top) top = best.score; }
  }
  if (top < minScore) return null;
  // 2) Das GRÖSSTE Raster mit fast bester Linienstärke: die Fach-Nähte liegen außen, die inneren Kartenrahmen (Rand → Bild)
  //    ergäben ein etwas kleineres Raster mit ähnlich starken Linien.
  //    Dazu müssen ALLE Rasterlinien ähnlich stark sein (bei einer echten Ordnerseite sind alle Linien Kartenkanten). Liegt
  //    nur eine einzelne Karte oder ein gemusterter Tisch im Bild, trifft ein Teil der Linien bloß Textur: schwächste ≪ stärkste.
  const uniformOf = (x0, y0, pw, ph) => {
    const xa = Math.round(x0 + pw * 0.04), xb = Math.round(x0 + pw * 0.96), ya = Math.round(y0 + ph * 0.04), yb = Math.round(y0 + ph * 0.96);
    // Je Linie die stärkste Kante im Nahtbereich (± 4 % der Fachgröße): die Naht selbst kann glatt sein, die Kartenkanten liegen daneben
    const dx = Math.max(1, Math.round((pw / cols) * 0.04)), dy = Math.max(1, Math.round((ph / rows) * 0.04));
    let min = Infinity, max = 0;
    for (let r = 0; r <= rows; r++) {
      let v = 0;
      for (let k = -dy; k <= dy; k++) v = Math.max(v, hLine(Math.max(0, Math.min(h - 1, Math.round(y0 + (ph * r) / rows) + k)), xa, xb));
      if (v < min) min = v; if (v > max) max = v;
    }
    for (let c = 0; c <= cols; c++) {
      let v = 0;
      for (let k = -dx; k <= dx; k++) v = Math.max(v, vLine(Math.max(0, Math.min(w - 1, Math.round(x0 + (pw * c) / cols) + k)), ya, yb));
      if (v < min) min = v; if (v > max) max = v;
    }
    return max > 0 ? min / max : 0;
  };
  let pick = null, contrast = 0;
  for (const c of perScale) {
    if (c.score < Math.max(minScore, 0.8 * top)) continue;
    const u = uniformOf(c.x0, c.y0, c.pw, c.ph);
    if (u >= minContrast) { pick = c; contrast = u; break; }
  }
  if (!pick) return null;
  const coarse = { x0: pick.x0, y0: pick.y0, x1: pick.x0 + pick.pw, y1: pick.y0 + pick.ph, score: pick.score, contrast, fitted: true };
  if (!sharp) return coarse;
  const vL = sharp.vLine, hL = sharp.hLine;
  // ±1 Pixel mitnehmen: eine leicht schräge Kante verteilt sich auf zwei Pixelzeilen
  const vAt = (x, ya, yb) => { const xi = Math.max(1, Math.min(w - 2, Math.round(x))); return Math.max(vL(xi, ya, yb), 0.8 * vL(xi - 1, ya, yb), 0.8 * vL(xi + 1, ya, yb)); };
  const hAt = (y, xa, xb) => { const yi = Math.max(1, Math.min(h - 2, Math.round(y))); return Math.max(hL(yi, xa, xb), 0.8 * hL(yi - 1, xa, xb), 0.8 * hL(yi + 1, xa, xb)); };
  const vScore = (x0, pw, ph, y0, g) => {
    const ya = Math.round(y0 + ph * 0.04), yb = Math.round(y0 + ph * 0.96), gx = (pw / cols) * g;
    const at = (x) => vAt(x, ya, yb);
    let sum = 0, min = Infinity, n = 0;
    for (let c = 0; c <= cols; c++) {
      const x = x0 + (pw * c) / cols;
      for (const v of c === 0 ? [at(x + gx)] : c === cols ? [at(x - gx)] : [at(x - gx), at(x + gx)]) { sum += v; if (v < min) min = v; n++; }
    }
    return 0.5 * (sum / n) + 0.5 * min;
  };
  const hScore = (y0, ph, pw, x0, g) => {
    const xa = Math.round(x0 + pw * 0.04), xb = Math.round(x0 + pw * 0.96), gy = (ph / rows) * g;
    const at = (y) => hAt(y, xa, xb);
    let sum = 0, min = Infinity, n = 0;
    for (let r = 0; r <= rows; r++) {
      const y = y0 + (ph * r) / rows;
      for (const v of r === 0 ? [at(y + gy)] : r === rows ? [at(y - gy)] : [at(y - gy), at(y + gy)]) { sum += v; if (v < min) min = v; n++; }
    }
    return 0.5 * (sum / n) + 0.5 * min;
  };
  const span = pick.step + 2;
  const perGap = [];
  let topGap = 0;
  for (let g = 0.005; g <= 0.0451; g += 0.005) {
    let best = null;
    for (let f = 0.97; f <= 1.0301; f += 0.015) {
      const ph = pick.ph * f, pw = ph * ratio;
      const cx = pick.x0 + pick.pw / 2 - pw / 2, cy = pick.y0 + pick.ph / 2 - ph / 2;
      let bx = null, by = null;
      for (let d = -span; d <= span; d++) {
        const x0 = cx + d, y0 = cy + d;
        if (x0 >= 0 && x0 + pw <= w - 1) { const v = vScore(x0, pw, ph, cy, g); if (!bx || v > bx.v) bx = { v, x0 }; }
        if (y0 >= 0 && y0 + ph <= h - 1) { const v = hScore(y0, ph, pw, cx, g); if (!by || v > by.v) by = { v, y0 }; }
      }
      if (!bx || !by) continue;
      const sc = Math.min(bx.v, by.v) / norm;
      if (!best || sc > best.score) best = { x0: bx.x0, y0: by.y0, pw, ph, score: sc, gap: g };
    }
    if (best) { perGap.push(best); if (best.score > topGap) topGap = best.score; }
  }
  const fine = perGap.find((c) => c.score >= 0.85 * topGap && c.score >= 0.6 * minScore);
  if (!fine) return coarse;
  return { x0: fine.x0, y0: fine.y0, x1: fine.x0 + fine.pw, y1: fine.y0 + fine.ph, score: fine.score, gap: fine.gap, contrast, fitted: true };
}

/** Fächer eines Rasters: [{ slot, row, col, box, quad }] – quad = Karte im Fach (um die halbe Nahtbreite bzw. inset kleiner als das Fach). */
export function gridSlots(rect, cols = 3, rows = 3, inset = rect?.gap ?? HD.SLOT_INSET) {
  const cw = (rect.x1 - rect.x0) / cols, ch = (rect.y1 - rect.y0) / rows;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const box = { x0: rect.x0 + c * cw, y0: rect.y0 + r * ch, x1: rect.x0 + (c + 1) * cw, y1: rect.y0 + (r + 1) * ch };
    const ix = cw * inset, iy = ch * inset;
    out.push({ slot: r * cols + c, row: r, col: c, box, quad: [[box.x0 + ix, box.y0 + iy], [box.x1 - ix, box.y0 + iy], [box.x1 - ix, box.y1 - iy], [box.x0 + ix, box.y1 - iy]] });
  }
  return out;
}

/**
 * Kartenkanten im hochaufgelösten Fach-Ausschnitt pixelgenau nachziehen. Im Ordner liegen die Karten Kante an Kante –
 * schon 1–2 % Versatz kosten den Fingerabdruck Treffer. Jede der vier Seiten wird einzeln in einem schmalen Fenster
 * (± win, relativ zur Kartenbreite/-höhe) auf die stärkste durchgehende Kante gelegt; das Fenster ist schmaler als der
 * Abstand zur Nachbarkarte und zum inneren Kartenrahmen, verwechselt werden kann also nichts.
 * g: Graubild { w, h, d } des Ausschnitts, rect: erwartete Karte darin. Rückgabe: { x0, y0, x1, y1 }.
 */
export function polishRect(g, rect, win = 0.02) {
  const { w, h, d } = g;
  const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0;
  const wx = Math.max(1, Math.round(rw * win)), wy = Math.max(1, Math.round(rh * win));
  const xa = Math.max(1, Math.round(rect.x0 + rw * 0.1)), xb = Math.min(w - 2, Math.round(rect.x1 - rw * 0.1));
  const ya = Math.max(1, Math.round(rect.y0 + rh * 0.1)), yb = Math.min(h - 2, Math.round(rect.y1 - rh * 0.1));
  const rowEdge = (y) => { if (y < 1 || y > h - 2) return -1; let s = 0; for (let x = xa; x <= xb; x += 2) s += Math.abs(d[(y + 1) * w + x] - d[(y - 1) * w + x]); return s; };
  const colEdge = (x) => { if (x < 1 || x > w - 2) return -1; let s = 0; for (let y = ya; y <= yb; y += 2) s += Math.abs(d[y * w + x + 1] - d[y * w + x - 1]); return s; };
  const best = (pos, win, f) => {
    const p0 = Math.round(pos);
    let bp = p0, bv = f(p0) * 1.08; // leichte Vorliebe für die erwartete Lage
    for (let k = -win; k <= win; k++) { const v = f(p0 + k); if (v > bv) { bv = v; bp = p0 + k; } }
    return bp;
  };
  return { x0: best(rect.x0, wx, colEdge), y0: best(rect.y0, wy, rowEdge), x1: best(rect.x1, wx, colEdge), y1: best(rect.y1, wy, rowEdge) };
}

/** Ausschnitt eines RGBA-Bilds auf ow × oh umrechnen (nächster Nachbar) – Fach-Ausschnitt ohne Canvas. */
export function cropRgba(rgba, W, H, x0, y0, bw, bh, ow, oh) {
  const out = new Uint8ClampedArray(ow * oh * 4);
  const fx = bw / ow, fy = bh / oh;
  for (let y = 0; y < oh; y++) {
    const sy = Math.max(0, Math.min(H - 1, Math.floor(y0 + (y + 0.5) * fy))) * W;
    for (let x = 0; x < ow; x++) {
      const o = (sy + Math.max(0, Math.min(W - 1, Math.floor(x0 + (x + 0.5) * fx)))) * 4, t = (y * ow + x) * 4;
      out[t] = rgba[o]; out[t + 1] = rgba[o + 1]; out[t + 2] = rgba[o + 2]; out[t + 3] = 255;
    }
  }
  return out;
}

/** Raster zeitlich glätten (ruhiges Overlay): liegt das neue nahe am alten, wird gemittelt, sonst gesprungen. */
export function smoothGrid(prev, next, k = 0.45) {
  if (!prev || !next) return next || prev;
  const size = Math.max(1, prev.x1 - prev.x0);
  const far = Math.max(Math.abs(prev.x0 - next.x0), Math.abs(prev.x1 - next.x1), Math.abs(prev.y0 - next.y0), Math.abs(prev.y1 - next.y1)) / size > 0.025;
  if (far) return next;
  const m = (a, b) => a + (b - a) * k;
  return { ...next, x0: m(prev.x0, next.x0), y0: m(prev.y0, next.y0), x1: m(prev.x1, next.x1), y1: m(prev.y1, next.y1) };
}

// ---------------------------------------------------------------------------
// Räumliche Slot-Sperre (Ordner-Seite)
// ---------------------------------------------------------------------------
const overlap = (a, b) => a.some((k) => b.includes(k));

/**
 * Jedes Fach (Reihe, Spalte) hat seine eigene Positions-Sperre. Ein Fach zählt genau einmal, sobald SLOT_FRAMES
 * aufeinanderfolgende Auswertungen dieselbe Karte mit ≥ MIN_MATCH und klarem Abstand zeigen – danach bleibt es gesperrt,
 * egal wie lange das Handy über der Seite schwebt (kein Zeitlimit).
 *
 * push({ slots: [{ slot, keys, match, margin? }], changed }, now) → { hits: [{ slot, keys }], locked: [slot…], flipped, flipping }
 *  • changed ≥ FLIP_AREA (> 65 % der Bildfläche deutlich anders) = umgeblättert → alle Sperren leer, flipped = true.
 *    Bis das Bild wieder ruhig ist (CALM_FRAMES Bilder mit changed < CALM_AREA) zählt nichts – die halb sichtbare alte
 *    Seite wird so nie doppelt erfasst.
 *  • Schutz vor falschem Seitenwechsel (Handy kurz weggeschwenkt, dieselbe Seite wieder im Bild): Fächer, die dieselbe
 *    Karte wie vor dem „Umblättern“ zeigen, werden still wieder gesperrt. Erst wenn NEW_PAGE_DIFF Fächer eine andere
 *    Karte zeigen, gilt die Seite als neu – dann zählen auch die zunächst zurückgehaltenen Fächer.
 *  • Zusätzlich Inhalts-Prüfung: Der Scanner wertet reihum ein schon gesperrtes Fach nach; zeigt es wiederholt eine andere
 *    Karte, wurde umgeblättert (auch wenn kein Bild die Bewegung erwischt hat) → Sperren leer, flipped = true.
 *  • nextPage(): Knopf „Nächste Seite“ – alles leeren, ohne „gleiche Seite“-Schutz.
 */
export function createSlotGate(opts = {}) {
  // Ordner-Seite: realistische Handy-Schwelle 66 % (wie der Direkt-Treffer im Stapel-Modus) + klarer Abstand, je Fach
  // zwei Auswertungen – 9 Fächer auf einmal, die Fach-Lage stammt aus dem Raster und ist ungenauer als eine Einzelkarte
  const cfg = { MIN_MATCH: SWEEP.DIRECT_MATCH, MARGIN_MIN: SWEEP.MARGIN_MIN, ...HD, ...opts };
  let pending = new Map(); // slot → { keys, n }
  let locks = new Map(); // slot → keys
  let held = new Map(); // slot → keys (wie vor dem Umblättern – still gesperrt, bis die Seite als neu gilt)
  let prevPage = null; // Map slot → keys der Seite vor dem letzten Umblättern
  let mismatch = new Map(); // gesperrtes Fach → Anzahl Prüfungen in Folge, die dort eine ANDERE Karte zeigten
  let flipping = false, calm = 0, diff = 0;
  const qualifies = (d) => Array.isArray(d?.keys) && d.keys.length && !d.colorReject && !d.colorPending && Number(d.match) >= cfg.MIN_MATCH && (d.margin === undefined || d.margin === null || d.margin >= cfg.MARGIN_MIN) && d.numOk !== false;
  const clear = () => { pending = new Map(); locks = new Map(); held = new Map(); mismatch = new Map(); diff = 0; };
  return {
    push(frame, now = Date.now()) {
      const changed = Number(frame?.changed) || 0;
      let flipped = false;
      if (changed >= cfg.FLIP_AREA) {
        if (!flipping) {
          const page = new Map([...held, ...locks]);
          if (page.size) prevPage = page;
          clear();
          flipped = true;
        }
        flipping = true; calm = 0;
      } else if (flipping) {
        calm = changed < cfg.CALM_AREA ? calm + 1 : 0;
        if (calm >= cfg.CALM_FRAMES) flipping = false;
      }
      const hits = [];
      const list = Array.isArray(frame?.slots) ? frame.slots : [];
      // Inhalts-Prüfung: Zeigt ein gesperrtes Fach bei SLOT_FRAMES Nachprüfungen in Folge klar eine ANDERE Karte, liegt eine
      // neue Seite im Bild (umgeblättert, ohne dass ein Bild die große Bewegung erwischt hat) → Sperren leeren.
      if (!flipping) {
        for (const d of list) {
          const slot = Number(d?.slot), keys = locks.get(slot) || held.get(slot);
          if (!keys || d.carried) continue;
          if (qualifies(d) && !overlap(keys, d.keys)) mismatch.set(slot, (mismatch.get(slot) || 0) + 1);
          else if (Number(d.match) >= cfg.MIN_MATCH - 0.1 && overlap(keys, d.keys)) mismatch.delete(slot);
        }
        if ([...mismatch.values()].some((n) => n >= cfg.SLOT_FRAMES)) {
          prevPage = new Map([...held, ...locks]);
          clear();
          flipped = true;
        }
      }
      if (!flipping) {
        for (const d of list) {
          const slot = Number(d?.slot);
          if (!Number.isInteger(slot) || locks.has(slot) || held.has(slot) || d.carried) continue;
          if (!qualifies(d)) { pending.delete(slot); continue; }
          const p = pending.get(slot);
          const n = p && overlap(p.keys, d.keys) ? p.n + 1 : 1;
          if (n < cfg.SLOT_FRAMES) { pending.set(slot, { keys: d.keys, n }); continue; }
          pending.delete(slot);
          const before = prevPage?.get(slot);
          if (before && overlap(before, d.keys)) { held.set(slot, [...d.keys]); continue; }
          if (before) diff++;
          locks.set(slot, [...d.keys]);
          hits.push({ slot, keys: d.keys });
        }
        // Genug Fächer zeigen andere Karten → wirklich eine neue Seite: zurückgehaltene Fächer zählen jetzt
        if (prevPage && diff >= Math.min(cfg.NEW_PAGE_DIFF, Math.max(1, prevPage.size))) {
          for (const [slot, keys] of held) { locks.set(slot, keys); hits.push({ slot, keys }); }
          held = new Map(); prevPage = null; diff = 0;
        }
      }
      return { hits, locked: [...locks.keys(), ...held.keys()], flipped, flipping };
    },
    /** Knopf „Nächste Seite“: alle Slot-Sperren leeren, die nächste Seite zählt komplett neu */
    nextPage() { clear(); prevPage = null; flipping = false; calm = 0; },
    /** Sperre eines Fachs bzw. einer Karte aufheben (Rückgängig) */
    unlock(keys) { for (const m of [locks, held]) for (const [s, k] of m) if (!keys || overlap(k, keys)) m.delete(s); },
    reset() { clear(); prevPage = null; flipping = false; calm = 0; },
    get locked() { return new Map([...held, ...locks]); },
    get flipping() { return flipping; },
  };
}

/** Mittelpunkt eines Fachs relativ zum Bild (für Etiketten) */
export const slotCenter = (quad) => quadCenter(quad);
