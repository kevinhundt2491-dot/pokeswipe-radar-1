// PokeSwipe & Radar – Zero-Latency Sweep-Modus: reine Rechen-Logik (ohne DOM/Netzwerk, im Worker und in Tests nutzbar).
//
//  • findCardRects    – rahmenlose Karten-Suche: rechteckige Silhouetten im Seitenverhältnis 63:88 irgendwo im Bild
//                       (Kanten-Linienintegrale über Präfixsummen, alle Größen/Positionen in wenigen Millisekunden)
//  • layoutFromRgba   – räumlicher Farb-/Layout-Vektor (4 × 6 Zellen, weißabgleich-normiert) einer entzerrten Karte
//  • matchPercent     – Übereinstimmung 0…1 aus Bild-Fingerabdruck (pHash/dHash) und Farb-Layout
//  • topMatchesIn     – Hamming-Suche im ganzen Index oder nur in den Zeilen eines Sets („Set-Lock“), mit Früh-Abbruch
//  • createSweepGate  – 2-Frame-Stabilitätsprüfung (ruhige, scharfe Bilder), 0,8-s-Verschnaufpause nach jedem Treffer und
//                       Karten-Sperre (cardId) bis die Karte wirklich weggezogen/ausgetauscht wurde (≥ 18 % Bildveränderung)
//  • motionStats      – Frame-Delta: ganzes Bild, Bildzentrum, geänderter Flächenanteil (Seitenwechsel im Ordner)
//  • confidencePercent – kalibrierte Konfidenz 0…100 % aus Übereinstimmung, Abstand zum nächsten Motiv und Nummern-ROI
//  • Preisschild-/Zähler-Helfer – Etikett-Texte, Tages-Scan-Zähler, Gesamtwert der Karten im Bild
//  • Session-Helfer   – Scan-Liste mit Anzahl, Variante, Rückgängig, Gesamtwert, Doppelte
import { popcount32, WORDS, GLARE_MASK_MAX, maskBits, homography, project } from "../../server/scan-logic.ts";

export const SWEEP = {
  /** Breite des Analyse-Bilds für die Kantensuche */
  DETECT_W: 320,
  /** Breite des Bilds, das an den Worker geht (Entzerrung/Fingerabdruck aus diesem Bild) */
  FRAME_W: 480,
  /** Höchstens ~30 Bilder/s an den Worker */
  MIN_FRAME_MS: 33,
  /**
   * Präzisions-Schwellen (Stapel / Einzelkarte): ein Treffer braucht ≥ 68 % Übereinstimmung (inkl. Farb-Abgleich) UND
   * ≥ 6 % Vorsprung vor dem zweitbesten Motiv (MARGIN_PCT, siehe quickOk). Lieber ein Bild länger scharfstellen als eine
   * falsche Karte anzeigen. DIRECT_MATCH (66 %): Schwelle je Fach im Ordner-Modus.
   */
  MIN_MATCH: 0.68,
  DIRECT_MATCH: 0.66,
  /** Abstand zum zweitbesten Motiv als Anteil der Ähnlichkeit (margin / HASH_SCALE) – 6 % Vorsprung */
  MARGIN_PCT: 0.06,
  /** Ohne Farb-Referenz (Katalogbild nicht ladbar): so viel strenger muss der reine Bild-Fingerabdruck passen */
  NO_COLOR_EXTRA: 0.05,
  /** Ab dieser Übereinstimmung gilt eine Karte als „im Bild gesehen“ (hält die Sperre, Etikett folgt der Karte) */
  TRACK_MATCH: 0.55,
  /** 2-Frame-Stabilitätsprüfung: 2 direkt aufeinanderfolgende, ruhige Bilder müssen dieselbe Karte bestätigen */
  CONSENSUS_FRAMES: 2,
  /** Zeitfenster zwischen den beiden Bildern (~120 ms; langsame Geräte: bis 2,2 Bildzeiten, höchstens CONSENSUS_MAX_MS) */
  CONSENSUS_MS: 120,
  CONSENSUS_MAX_MS: 200,
  /** Verschnaufpause: nach jedem Treffer 0,8 s lang kein weiterer Scan (Karte/Kamera entspannt wegziehen) */
  HIT_PAUSE_MS: 800,
  /** Verwackelt: Bewegungsdifferenz im Bildzentrum bzw. im ganzen Bild ab hier = Bewegungsunschärfe → Bild zählt nicht */
  BLUR_CENTER: 0.1,
  BLUR_MOTION: 0.14,
  /** Schärfe einer Karte fällt gegenüber dem vorigen Bild unter diesen Anteil → verwischt (Wegziehen) → zählt nicht */
  BLUR_DROP: 0.7,
  /** Bewegungsdifferenz im Bildzentrum (0…1): ab hier gilt „es bewegt sich etwas“ */
  CENTER_MOVE: 0.045,
  /**
   * Karten-Sperre (cardId): die erkannte Karte bleibt gesperrt, bis sie wirklich aus dem Bild gezogen oder ausgetauscht
   * wurde – gemessen als Bildveränderung gegenüber dem Bild beim Treffer (Anteil deutlich geänderter Bildfläche).
   * Normales Handzittern bleibt unter 18 % und hebt die Sperre nie auf.
   */
  LOCK_DRIFT: 0.18,
  /** Rückfall für kleine Karten: so lange nicht mehr gesehen UND mindestens LOCK_IDLE_DRIFT Bildveränderung → frei */
  LOCK_IDLE_MS: 1200,
  LOCK_IDLE_DRIFT: 0.06,
  /** Helligkeitsdifferenz (0…255) je Zelle des Anker-Bilds, ab der eine Zelle als „deutlich geändert“ gilt */
  ANCHOR_DELTA: 26,
  /** „Dieselbe Stelle“ für die Aufdeck-Erkennung (Mittelpunkt-Abstand, relativ zum Bild) */
  STATIC_POS: 0.04,
  /** Dieselbe Karte an einer deutlich anderen Stelle (Mittelpunkt-Abstand, relativ) = zweites Exemplar (nur Binder-/Tisch-Sweep) */
  SAME_POS: 0.28,
  /** Binder- & Tisch-Sweep (mehrere Karten gleichzeitig): strikte Schwellen – nur 99–100 % Konfidenz zählt */
  STRICT_CONF: 99,
  STRICT_MATCH: 0.93,
  STRICT_MARGIN: 10,
  STRICT_FRAMES: 3,
  /** Höchstens so viele Karten gleichzeitig im Bild verfolgen (Ordnerseite = 9) */
  MAX_CARDS: 9,
  /** Preisschild: ab diesem Cardmarket-Preis gilt eine Karte als „Hit“ */
  HIT_EUR: 10,
  /** Deutliche Bildveränderung zwischen zwei Bildern (mittlere Helligkeitsdifferenz der Miniatur, 0…1) */
  MOTION_RESET: 0.16,
  /** Gewichteter Hash-Abstand: artP (64) + 0,75 · artD (64) + 0,75 · fullP (64) = 160 */
  HASH_SCALE: 160,
  /** Anteil des Farb-Layouts an der Übereinstimmung (wenn ein Layout-Vektor der Referenz vorliegt) */
  LAYOUT_WEIGHT: 0.35,
  /** Mindestabstand zum nächsten anderen Motiv (wie MARGIN_MIN der Foto-Erkennung) */
  MARGIN_MIN: 6,
  CARD_RATIO: 63 / 88,
};

// ---------------------------------------------------------------------------
// Rahmenlose Karten-Suche
// ---------------------------------------------------------------------------
/** Gradient (|gx|, |gy|) quer zur Kante um ±r Pixel aufweiten – leicht schräge oder unscharfe Kanten zählen trotzdem. */
function dilateAcross(src, w, h, r, horizontalEdges) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      if (horizontalEdges) {
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { const v = src[yy * w + x]; if (v > m) m = v; } }
      } else {
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { const v = src[y * w + xx]; if (v > m) m = v; } }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy, ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return ua > 0 ? inter / ua : 0;
};
export { iou as rectIou };

/**
 * Kandidaten-Rechtecke (Hochformat 63:88) im ganzen Bild: Für jede Größe und Position wird die Kantenstärke entlang der
 * vier Seiten über Präfixsummen in O(1) gemessen. Bewertet wird das geometrische Mittel der vier Seiten (alle vier
 * müssen Kante zeigen) relativ zur mittleren Bildkante, abzüglich der Kantendichte im Inneren direkt neben dem Rand
 * (ein Kartenrand ist eine Linie, keine Textur). Danach Nicht-Maximum-Unterdrückung.
 * grad: Ergebnis von sobel(); Rückgabe: [{ x0, y0, x1, y1, score }] (beste zuerst).
 */
/** Kanten-Linienintegrale (Präfixsummen): hLine(y, x0, x1) / vLine(x, y0, y1) = mittlere Kantenstärke entlang der Linie. */
export function edgeLines(grad, w, h, dilate = Math.max(1, Math.round(Math.min(w, h) / 160))) {
  const ax = new Float32Array(w * h), ay = new Float32Array(w * h);
  for (let i = 0; i < ax.length; i++) { ax[i] = Math.abs(grad.gx[i]); ay[i] = Math.abs(grad.gy[i]); }
  // dilate = 0: scharfe Linien (pixelgenaue Lage, z. B. Naht-Verfeinerung des Binder-Rasters)
  const ayD = dilate > 0 ? dilateAcross(ay, w, h, dilate, true) : ay, axD = dilate > 0 ? dilateAcross(ax, w, h, dilate, false) : ax;
  // Zeilen-Präfixsummen für waagerechte Kanten, Spalten-Präfixsummen für senkrechte Kanten
  const W1 = w + 1, H1 = h + 1;
  const rowP = new Float64Array(H1 * W1), colP = new Float64Array(W1 * H1);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += ayD[y * w + x]; rowP[y * W1 + x + 1] = s; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) { s += axD[y * w + x]; colP[x * H1 + y + 1] = s; } }
  const hLine = (y, x0, x1) => (rowP[y * W1 + x1] - rowP[y * W1 + x0]) / Math.max(1, x1 - x0);
  const vLine = (x, y0, y1) => (colP[x * H1 + y1] - colP[x * H1 + y0]) / Math.max(1, y1 - y0);
  return { hLine, vLine, norm: Math.max(4, grad.mean) };
}

export function findCardRects(grad, w, h, { max = 4, minFrac = 0.2, maxFrac = 0.96, minScore = 1.35, ratio = SWEEP.CARD_RATIO, lines = null } = {}) {
  const { hLine, vLine, norm } = lines || edgeLines(grad, w, h);
  const cands = [];
  const minH = Math.max(24, h * minFrac), maxH = Math.min(h * maxFrac, (w * maxFrac) / ratio);
  for (let ch = maxH; ch >= minH; ch /= 1.12) {
    const cw = ch * ratio;
    const iw = Math.round(cw), ih = Math.round(ch);
    const step = Math.max(2, Math.round(ch * 0.035));
    // Ecken sind abgerundet: nur die mittleren 80 % jeder Seite messen; Innen-Linie 5 % weiter innen
    const mx = Math.round(iw * 0.1), my = Math.round(ih * 0.1), inX = Math.max(2, Math.round(iw * 0.05)), inY = Math.max(2, Math.round(ih * 0.05));
    for (let y0 = 1; y0 + ih < h - 1; y0 += step) {
      const y1 = y0 + ih;
      for (let x0 = 1; x0 + iw < w - 1; x0 += step) {
        const x1 = x0 + iw;
        const t = hLine(y0, x0 + mx, x1 - mx), b = hLine(y1, x0 + mx, x1 - mx);
        const l = vLine(x0, y0 + my, y1 - my), rr = vLine(x1, y0 + my, y1 - my);
        const minSide = Math.min(t, b, l, rr);
        if (minSide < norm * 0.9) continue;
        const geo = Math.sqrt(Math.sqrt(t * b) * Math.sqrt(l * rr));
        const inner = (hLine(y0 + inY, x0 + mx, x1 - mx) + hLine(y1 - inY, x0 + mx, x1 - mx) + vLine(x0 + inX, y0 + my, y1 - my) + vLine(x1 - inX, y0 + my, y1 - my)) / 4;
        const score = (geo - 0.35 * inner) / norm;
        if (score >= minScore) cands.push({ x0, y0, x1, y1, score });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.every((o) => iou(o, c) < 0.3)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * RGBA → verkleinertes Graubild in einem Durchgang (Flächenmittel), ohne erst das ganze Graubild anzulegen.
 * Liefert zusätzlich nichts weiter – das volle Bild wird für die Entzerrung direkt aus RGBA abgetastet.
 */
export function grayDown(rgba, w, h, dw, dh) {
  const out = new Float32Array(dw * dh), cnt = new Float32Array(dw * dh);
  const fx = dw / w, fy = dh / h;
  for (let y = 0; y < h; y++) {
    const ty = Math.min(dh - 1, Math.floor(y * fy)) * dw;
    for (let x = 0, o = y * w * 4; x < w; x++, o += 4) {
      const t = ty + Math.min(dw - 1, Math.floor(x * fx));
      out[t] += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      cnt[t]++;
    }
  }
  for (let i = 0; i < out.length; i++) if (cnt[i]) out[i] /= cnt[i];
  return { w: dw, h: dh, d: out };
}

/** Perspektivisch entzerrte Graukarte (outW × outH) direkt aus dem RGBA-Bild (bilinear auf der Helligkeit). */
export function warpGrayRgba(rgba, w, h, quad, outW, outH) {
  const H = homography(quad);
  const d = new Float32Array(outW * outH);
  const lum = (x, y) => { const o = (y * w + x) * 4; return 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]; };
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = project(H, (x + 0.5) / outW, v);
      const xc = Math.min(w - 1.001, Math.max(0, sx)), yc = Math.min(h - 1.001, Math.max(0, sy));
      const x0 = Math.floor(xc), y0 = Math.floor(yc), ax = xc - x0, ay = yc - y0;
      const a = lum(x0, y0), b = lum(x0 + 1, y0), c = lum(x0, y0 + 1), e = lum(x0 + 1, y0 + 1);
      d[y * outW + x] = a + (b - a) * ax + (c - a) * ay + (a - b - c + e) * ax * ay;
    }
  }
  return { w: outW, h: outH, d };
}

export const rectQuad = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
export function quadBox(q, pad = 0) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const px = (x1 - x0) * pad, py = (y1 - y0) * pad;
  return { x0: x0 - px, y0: y0 - py, x1: x1 + px, y1: y1 + py };
}

// ---------------------------------------------------------------------------
// Bewegung zwischen zwei Bildern (Miniatur 32 px breit)
// ---------------------------------------------------------------------------
export function frameThumb(g, tw = 32) {
  const th = Math.max(8, Math.round((g.h * tw) / g.w));
  const out = new Float32Array(tw * th);
  const sx = g.w / tw, sy = g.h / th;
  let sum = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const v = g.d[Math.min(g.h - 1, Math.floor((y + 0.5) * sy)) * g.w + Math.min(g.w - 1, Math.floor((x + 0.5) * sx))];
    out[y * tw + x] = v; sum += v;
  }
  return { w: tw, h: th, d: out, mean: sum / out.length };
}

/** Mittlere Helligkeitsänderung 0…1 (ohne globalen Belichtungs-Sprung). 1 = kein Vorgängerbild. */
export function thumbMotion(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return 1;
  const off = b.mean - a.mean;
  let s = 0;
  for (let i = 0; i < a.d.length; i++) s += Math.abs(b.d[i] - a.d[i] - off);
  return s / a.d.length / 255;
}

/**
 * Bewegungsdifferenz zwischen zwei Miniaturen (Frame-Delta, ohne globalen Belichtungs-Sprung):
 *   motion  – mittlere Änderung im ganzen Bild (0…1; 1 = kein Vorgängerbild)
 *   center  – mittlere Änderung im Bildzentrum (mittlere 50 % × 50 %) – dort liegt die Karte vom Stapel
 *   changed – Flächenanteil, der sich deutlich geändert hat (Ordner: > 65 % = umgeblättert)
 */
export function motionStats(a, b, cellDelta = 22) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return { motion: 1, center: 0, changed: 0, first: true };
  const off = b.mean - a.mean;
  const x0 = Math.floor(a.w * 0.25), x1 = Math.ceil(a.w * 0.75), y0 = Math.floor(a.h * 0.25), y1 = Math.ceil(a.h * 0.75);
  let s = 0, c = 0, cn = 0, ch = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = y * a.w + x, d = Math.abs(b.d[i] - a.d[i] - off);
    s += d;
    if (d > cellDelta) ch++;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) { c += d; cn++; }
  }
  const n = a.d.length;
  return { motion: s / n / 255, center: cn ? c / cn / 255 : 0, changed: ch / n, first: false };
}

// ---------------------------------------------------------------------------
// Farb-/Layout-Vektor
// ---------------------------------------------------------------------------
export const LAYOUT_GX = 4;
export const LAYOUT_GY = 6;
export const LAYOUT_LEN = LAYOUT_GX * LAYOUT_GY * 3;

/**
 * Mittelwerte (R, G, B) in 4 × 6 Zellen der Karte (perspektivisch über das Viereck abgetastet), je Kanal durch den
 * Kartenmittelwert geteilt (Weißabgleich/Belichtung kürzen sich heraus) → 72 Bytes (128 = Kartenmittel).
 * quad: Ecken oben links, oben rechts, unten rechts, unten links (Pixel im RGBA-Bild).
 */
export function layoutFromRgba(rgba, w, h, quad, samples = 4) {
  const H = homography(quad);
  const cells = new Float32Array(LAYOUT_LEN);
  const mean = [0, 0, 0];
  for (let cy = 0; cy < LAYOUT_GY; cy++) for (let cx = 0; cx < LAYOUT_GX; cx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      // innere 90 % je Zelle, Rand der Karte (5 %) bleibt außen vor – dort liegen Sleeve-Kanten und Hintergrund
      const u = 0.05 + 0.9 * ((cx + (sx + 0.5) / samples) / LAYOUT_GX), v = 0.05 + 0.9 * ((cy + (sy + 0.5) / samples) / LAYOUT_GY);
      const [px, py] = project(H, u, v);
      const x = Math.round(px), y = Math.round(py);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = (y * w + x) * 4;
      r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
    }
    const i = (cy * LAYOUT_GX + cx) * 3;
    if (n) { cells[i] = r / n; cells[i + 1] = g / n; cells[i + 2] = b / n; }
    mean[0] += cells[i]; mean[1] += cells[i + 1]; mean[2] += cells[i + 2];
  }
  const nCells = LAYOUT_GX * LAYOUT_GY;
  const out = new Uint8Array(LAYOUT_LEN);
  for (let i = 0; i < LAYOUT_LEN; i++) {
    const m = mean[i % 3] / nCells;
    out[i] = Math.max(0, Math.min(255, Math.round((128 * cells[i]) / Math.max(8, m))));
  }
  return out;
}

/** Ähnlichkeit zweier Layout-Vektoren 0…1 (1 = gleich; fremde Karten liegen typischerweise unter 0,6). */
export function layoutSimilarity(a, b) {
  if (!a || !b || a.length !== LAYOUT_LEN || b.length !== LAYOUT_LEN) return null;
  let s = 0;
  for (let i = 0; i < LAYOUT_LEN; i++) s += Math.abs(a[i] - b[i]);
  const d = s / LAYOUT_LEN / 128;
  return Math.max(0, Math.min(1, 1 - 1.6 * d));
}

/** Gewichteter Hash-Abstand → Ähnlichkeit 0…1 (Anteil übereinstimmender Fingerabdruck-Bits). */
export const hashSimilarity = (score) => Math.max(0, Math.min(1, 1 - Number(score) / SWEEP.HASH_SCALE));

/** Übereinstimmung 0…1: Bild-Fingerabdruck, mit Farb-Layout verrechnet, sobald für die Referenz ein Vektor vorliegt. */
export function matchPercent(score, layoutSim = null) {
  const h = hashSimilarity(score);
  if (layoutSim === null || layoutSim === undefined || !Number.isFinite(layoutSim)) return h;
  return (1 - SWEEP.LAYOUT_WEIGHT) * h + SWEEP.LAYOUT_WEIGHT * layoutSim;
}

// ---------------------------------------------------------------------------
// Hamming-Suche (ganzer Index oder Set-Zeilen) mit Früh-Abbruch
// ---------------------------------------------------------------------------
/**
 * k beste Zeilen. rows = Int32Array der Zeilen eines Sets oder null (ganzer Index). Der artP-Abstand allein ist schon
 * eine untere Schranke des Gesamtabstands – liegt er über dem schlechtesten der k Besten, entfällt der Rest.
 * mask: optionale Glanz-Maske für den Artwork-dHash (wie topMatchesMasked).
 */
export function topMatchesIn(probe, words, rows, count, k = 10, mask = null) {
  const n = rows ? rows.length : count;
  const useMask = mask && maskBits(mask) && maskBits(mask) <= GLARE_MASK_MAX;
  const nm = useMask ? maskBits(mask) : 0, keep0 = useMask ? ~mask[0] : -1, keep1 = useMask ? ~mask[1] : -1;
  const p0 = probe[0], p1 = probe[1], p2 = probe[2], p3 = probe[3], p4 = probe[4], p5 = probe[5];
  const best = [];
  let worst = Infinity;
  for (let j = 0; j < n; j++) {
    const i = rows ? rows[j] : j;
    const o = i * WORDS;
    const d0 = popcount32(p0 ^ words[o]) + popcount32(p1 ^ words[o + 1]);
    if (best.length >= k && d0 >= worst) continue;
    let d1 = popcount32((p2 ^ words[o + 2]) & keep0) + popcount32((p3 ^ words[o + 3]) & keep1);
    if (useMask) d1 = Math.round((d1 * 64) / (64 - nm));
    const d2 = popcount32(p4 ^ words[o + 4]) + popcount32(p5 ^ words[o + 5]);
    const score = d0 + 0.75 * d1 + 0.75 * d2;
    if (best.length < k || score < worst) {
      best.push({ i, score, art: d0 });
      best.sort((a, b) => a.score - b.score);
      if (best.length > k) best.pop();
      worst = best.length >= k ? best[best.length - 1].score : Infinity;
    }
  }
  return best;
}

/** Set eines Index-Schlüssels („card:sv08-238“ → „sv08“, „print:en:sv08-238“ → „sv08“). */
export function setIdOfKey(key) {
  const id = String(key || "").replace(/^card:/, "").replace(/^print:(?:en|ja):/, "");
  const cut = id.lastIndexOf("-");
  return cut > 0 ? id.slice(0, cut) : "";
}
export const langOfKey = (key) => (/^print:(en|ja):/.exec(String(key || ""))?.[1]) || "de";

/** Sprachvarianten derselben Karte nach der Session-Sprache ordnen (gewählte Sprache zuerst, sonst DE → EN → JA). */
export function orderByLang(keys, lang = "de") {
  const pref = [lang, ...["de", "en", "ja"].filter((l) => l !== lang)];
  return [...keys].sort((a, b) => pref.indexOf(langOfKey(a)) - pref.indexOf(langOfKey(b)));
}

// ---------------------------------------------------------------------------
// Konfidenz (kalibriert, 0…100 %)
// ---------------------------------------------------------------------------
/**
 * Kalibrierte Konfidenz einer Erkennung:
 *   • Basis = Übereinstimmung (Bild-Fingerabdruck + Farb-Layout) in Prozent
 *   • klarer Abstand zum nächsten anderen Motiv (margin ≥ STRICT_MARGIN) bei ≥ STRICT_MATCH → mindestens 99 %
 *   • Sammlernummer im Nummern-Fenster (ROI) gelesen und passend (numOk = true) → 100 %; gelesen und falsch → höchstens 60 %
 *   • zu geringer Abstand (margin < MARGIN_MIN) → höchstens 85 %
 */
export function confidencePercent(d) {
  const match = Number(d?.match) || 0, margin = Number.isFinite(d?.margin) ? d.margin : 99;
  let pct = Math.round(match * 100);
  if (match >= SWEEP.STRICT_MATCH && margin >= SWEEP.STRICT_MARGIN) pct = Math.max(pct, 99);
  if (match >= 0.97 && margin >= SWEEP.STRICT_MARGIN) pct = 100;
  if (d?.numOk === true) pct = match >= SWEEP.MIN_MATCH ? 100 : Math.max(pct, 99);
  if (d?.numOk === false) pct = Math.min(pct, 60);
  if (margin < SWEEP.MARGIN_MIN) pct = Math.min(pct, 85);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Treffer-Prüfung (Stapel / Einzelkarte) je Bild: ≥ MIN_MATCH (68 %, inkl. Farb-Abgleich) UND Abstand zum zweitbesten Motiv
 * ≥ MARGIN_PCT (6 %). margin = Hash-Abstand (Punkte) zum nächsten anderen Motiv; fehlt er → klar.
 * Pflicht-Farbabgleich: Kandidaten mit falscher Grundfarbe (colorReject) oder noch fehlender Farb-Referenz (colorPending)
 * werden nie freigegeben. Ohne ladbare Farb-Referenz (color = "none") muss der Bild-Fingerabdruck NO_COLOR_EXTRA strenger passen.
 * Bewusst KEIN Treffer allein über die Höhe der Übereinstimmung: Ein leeres Bild (Tisch, Hand, Hintergrund) erreicht
 * gelegentlich hohe Werte – aber nie mit klarem Abstand. Der Abstand trennt eine echte Karte vom Bildrauschen.
 */
export function quickOk(d, cfg = SWEEP) {
  if (d?.colorReject || d?.colorPending) return false;
  const match = Number(d?.match) || 0;
  const margin = Number.isFinite(d?.margin) ? d.margin : 99;
  const min = cfg.MIN_MATCH + (d?.color === "none" ? cfg.NO_COLOR_EXTRA || 0 : 0);
  return match >= min && margin / cfg.HASH_SCALE >= cfg.MARGIN_PCT;
}

/** Strikte Prüfung für den Binder- & Tisch-Sweep: 99–100 % Konfidenz, keine widersprüchliche Nummer. */
export const strictOk = (d) => confidencePercent(d) >= SWEEP.STRICT_CONF && d?.numOk !== false && !d?.colorReject && !d?.colorPending;

/** Mittelpunkt eines Vierecks ([[x,y] × 4], relativ 0…1 oder Pixel) – null ohne Viereck. */
export function quadCenter(quad) {
  if (!Array.isArray(quad) || quad.length < 3) return null;
  let x = 0, y = 0, n = 0;
  for (const p of quad) { if (Array.isArray(p) && p.length >= 2) { x += Number(p[0]) || 0; y += Number(p[1]) || 0; n++; } }
  return n ? [x / n, y / n] : null;
}

// ---------------------------------------------------------------------------
// Frame-Konsens & Doppel-Scan-Schutz
// ---------------------------------------------------------------------------
const overlap = (a, b) => a.some((k) => b.includes(k));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Anker-Bild für die Karten-Sperre: Miniatur (16 Zellen breit) aus Flächenmitteln – unempfindlich gegen Bildrauschen
 * und leichtes Handzittern (eine Zelle ≈ 6 % der Bildbreite). g: Graubild { w, h, d }.
 */
export function anchorThumb(g, tw = 16) {
  const th = Math.max(8, Math.round((g.h * tw) / g.w));
  const out = new Float32Array(tw * th), cnt = new Float32Array(tw * th);
  const fx = tw / g.w, fy = th / g.h;
  let sum = 0;
  for (let y = 0; y < g.h; y++) {
    const ty = Math.min(th - 1, Math.floor(y * fy)) * tw;
    for (let x = 0; x < g.w; x++) { const t = ty + Math.min(tw - 1, Math.floor(x * fx)); out[t] += g.d[y * g.w + x]; cnt[t]++; }
  }
  for (let i = 0; i < out.length; i++) { if (cnt[i]) out[i] /= cnt[i]; sum += out[i]; }
  return { w: tw, h: th, d: out, mean: sum / out.length };
}

/**
 * Bildveränderung gegenüber dem Anker (0…1): Anteil der Zellen, die sich deutlich (> delta) geändert haben – ohne globalen
 * Belichtungs-Sprung. Handzittern ≈ wenige Prozent, Karte weggezogen/ausgetauscht ≫ 18 %. Ohne Anker: null.
 */
export function thumbDrift(a, b, delta = SWEEP.ANCHOR_DELTA) {
  if (!a || !b || a.w !== b.w || a.h !== b.h || !a.d || !b.d) return null;
  const off = b.mean - a.mean;
  let n = 0;
  for (let i = 0; i < a.d.length; i++) if (Math.abs(b.d[i] - a.d[i] - off) > delta) n++;
  return n / a.d.length;
}

/**
 * Entscheidet je Live-Bild, ob eine erkannte Karte als Scan zählt (Modus „Stapel / Einzelkarte“).
 * push({ dets: [{ keys, match, margin?, numOk?, quad?, carried?, sharp?, colorReject?, colorPending? }], found, motion, center?,
 *        changed?, thumb? }, now, avgFrameMs) → { hits: [keys[]], locked: [keys[]], view: dets[], paused, blurry }
 *  • 2-Frame-Stabilitätsprüfung: Treffer erst, wenn 2 DIREKT aufeinanderfolgende Bilder (innerhalb von ~120 ms) dieselbe
 *    Karte bestätigen – und keines davon verwackelt ist (Bewegungsdifferenz ≥ BLUR_CENTER/BLUR_MOTION oder Schärfe fällt
 *    unter BLUR_DROP des Vorbilds). So löst das Wegziehen der Karte nie einen Fehlschuss aus. Bei 30 FPS < 0,25 s.
 *  • 0,8-Sekunden-Verschnaufpause (HIT_PAUSE_MS): nach jedem Treffer wird 800 ms lang gar kein weiterer Scan ausgelöst.
 *  • Karten-Sperre (cardId): die erkannte Karte bleibt gesperrt – egal wo sie im Bild liegt –, bis sie wirklich aus dem Bild
 *    gezogen oder ausgetauscht wurde: Sie war mindestens ein Bild lang nicht zu sehen UND das Bild hat sich gegenüber dem
 *    Treffer-Bild um ≥ 18 % verändert (LOCK_DRIFT). Normales Handzittern (< 18 %) hebt die Sperre nie auf. Rückfall für
 *    kleine Karten: LOCK_IDLE_MS nicht mehr gesehen und ≥ LOCK_IDLE_DRIFT Veränderung.
 *  • Mehrere gleiche Karten auf einmal: über den „+1“-Knopf im Dock.
 *  • carried = vom Worker nur weitergetragene Erkennung (nicht neu ausgewertet) → hält die Sperre, zählt nicht für den Konsens
 *  • Modus „sweep“ (strikt, Binder-/Tisch-Sweep): ≥ 99 % Konfidenz über 3 Bilder, gleiche Karte an anderer Stelle = 2. Exemplar.
 */
export function createSweepGate(opts = {}) {
  let cfg = { mode: "turbo", ...SWEEP, ...opts };
  let prev = []; // qualifizierte Karten des letzten Bilds: [{ keys, at, n, center, sharp }]
  let locks = []; // [{ keys, center, miss, thumb, drift, lost, seenAt }]
  let lastHitAt = -Infinity;
  const strict = () => cfg.mode === "sweep";
  const near = (a, b, max = cfg.SAME_POS) => !a || !b || dist(a, b) < max;
  const qualifies = (d) => Array.isArray(d.keys) && d.keys.length && (strict() ? Number(d.match) >= cfg.STRICT_MATCH && strictOk(d) : quickOk(d, cfg));
  return {
    push(frame, now = Date.now(), avgFrameMs = 0) {
      const dets = Array.isArray(frame?.dets) ? frame.dets : [];
      const motion = Number(frame?.motion);
      const hasPrev = Number.isFinite(motion) && motion < 1;
      const center = Number.isFinite(Number(frame?.center)) && frame?.center !== undefined && frame?.center !== null ? Number(frame.center) : hasPrev ? motion : 0;
      const changed = Number(frame?.changed) || 0;
      const thumb = frame?.thumb && frame.thumb.d ? frame.thumb : null;
      // Verwackeltes Bild (Bewegungsunschärfe beim Wegziehen/Heranführen) zählt nie für einen Treffer
      const blurry = hasPrev && (center >= cfg.BLUR_CENTER || motion >= cfg.BLUR_MOTION);
      // Sperren den Karten im Bild zuordnen (jede Erkennung höchstens einer Sperre) und fortschreiben
      const visible = dets.filter((d) => Array.isArray(d.keys) && d.keys.length && Number(d.match) >= cfg.TRACK_MATCH && !d.colorReject);
      const taken = new Set();
      locks = locks.filter((l) => {
        let hit = null, hitD = Infinity;
        for (const d of visible) {
          if (taken.has(d) || !overlap(l.keys, d.keys)) continue;
          const c = quadCenter(d.quad);
          const dd = c && l.center ? dist(c, l.center) : 0;
          // Stapel: gesperrt ist die Karte (cardId), egal wo sie liegt · strikter Sweep: nur dasselbe Exemplar (Position)
          if (strict() && dd >= cfg.SAME_POS) continue;
          if (dd < hitD) { hit = d; hitD = dd; }
        }
        // Bildveränderung gegenüber dem Treffer-Bild (Anker); ohne Anker: größte Flächenänderung seit dem Treffer
        const drift = thumb && l.thumb ? thumbDrift(l.thumb, thumb) : null;
        l.drift = drift === null ? Math.max(l.drift || 0, changed) : drift;
        if (!hit) { l.miss++; l.lost = true; }
        // Wirklich weggezogen bzw. ausgetauscht: Karte war weg UND ≥ 18 % des Bilds sind neu
        if (l.lost && l.drift >= cfg.LOCK_DRIFT) return false;
        // Kleine Karte: lange nicht mehr gesehen und das Bild hat sich spürbar verändert
        if (!hit && now - l.seenAt >= cfg.LOCK_IDLE_MS && l.drift >= cfg.LOCK_IDLE_DRIFT) return false;
        if (hit) {
          taken.add(hit); hit._lock = l; l.miss = 0; l.seenAt = now;
          const c = quadCenter(hit.quad);
          if (c) l.center = c;
        }
        return true;
      });
      const windowMs = Math.max(cfg.CONSENSUS_MS, Math.min(cfg.CONSENSUS_MAX_MS, 2.2 * (Number(avgFrameMs) || 0)));
      const need = strict() ? cfg.STRICT_FRAMES : cfg.CONSENSUS_FRAMES;
      // 0,8-Sekunden-Verschnaufpause nach jedem Treffer (Stapel / Einzelkarte)
      const paused = !strict() && now - lastHitAt < cfg.HIT_PAUSE_MS;
      const qual = dets.filter(qualifies);
      const hits = [], locked = [], next = [];
      for (const d of dets) {
        const l = d._lock; delete d._lock;
        if (l && qual.includes(d)) locked.push(d.keys);
        if (l || !qual.includes(d) || d.carried) continue;
        // Karten-Sperre gilt auch für dieselbe Karte an anderer Stelle (Stapel) – und für einen Treffer in diesem Bild
        if (!strict() && locks.some((x) => overlap(x.keys, d.keys))) { locked.push(d.keys); continue; }
        if (paused || blurry) continue;
        const c = quadCenter(d.quad);
        const p = prev.find((x) => overlap(x.keys, d.keys) && now - x.at <= windowMs && near(x.center, c));
        const sharp = Number(d.sharp);
        // Schärfe bricht gegenüber dem Vorbild ein → Bewegungsunschärfe → Konsens beginnt neu
        const smeared = p && Number.isFinite(sharp) && Number.isFinite(p.sharp) && sharp < p.sharp * cfg.BLUR_DROP;
        const n = p && !smeared ? p.n + 1 : 1;
        if (n >= need) {
          hits.push(d.keys);
          locks.push({ keys: [...d.keys], center: c, miss: 0, thumb, drift: 0, lost: false, seenAt: now });
        } else next.push({ keys: d.keys, at: now, n, center: c, sharp: Number.isFinite(sharp) ? sharp : undefined });
      }
      if (hits.length) lastHitAt = now;
      if (locks.length > 16) locks = locks.slice(-16);
      prev = next;
      return { hits, locked, view: qual, paused: paused && !hits.length, blurry };
    },
    /** Sperre aufheben (z. B. nach „Rückgängig“: dieselbe Karte darf sofort neu erkannt werden) */
    unlock(keys) { locks = keys ? locks.filter((l) => !overlap(l.keys, keys)) : []; },
    reset() { prev = []; locks = []; lastHitAt = -Infinity; },
    /** „turbo“ (Stapel/Einzelkarten, 2-Frame-Konsens + Pause) oder „sweep“ (strikt: ≥ 99 % Konfidenz, 3 Bilder) */
    setMode(mode) { cfg = { ...cfg, mode: mode === "sweep" ? "sweep" : "turbo" }; prev = []; },
    /** Restzeit der Verschnaufpause in ms (0 = bereit) */
    pauseLeft(now = Date.now()) { return strict() ? 0 : Math.max(0, cfg.HIT_PAUSE_MS - (now - lastHitAt)); },
    get mode() { return cfg.mode; },
    get locks() { return locks.map((l) => ({ ...l })); },
  };
}

// ---------------------------------------------------------------------------
// Preisschild-Etikett, Tages-Zähler, Gesamtwert im Bild
// ---------------------------------------------------------------------------
const euroFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const euro = (n) => euroFmt.format(Number(n) || 0);

/** Set-Kürzel + Sammlernummer fürs Etikett („DRI 045/182“, Rückfall: Set-ID aus dem Schlüssel). */
export function tagCode(info, key = "") {
  const code = String(info?.setCode || "").trim() || setIdOfKey(key).toUpperCase();
  let num = String(info?.number || "").trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(num);
  if (m) num = `${m[1].padStart(Math.max(3, m[2].length), "0")}/${m[2].padStart(3, "0")}`;
  return [code, num].filter(Boolean).join(" ");
}

/**
 * Text „automatisch im Ordner“: erstes Exemplar → „✅ Automatisch im Ordner: [Set-Name] (1×)“, schon vorhanden bzw.
 * mehrere → „✅ Im Ordner gespeichert · Jetzt 2× vorhanden“. ownedQty = Anzahl dieser Karte im Set-Ordner nach dem Speichern.
 */
export function filedLabel({ setName = "", ownedQty = 1 } = {}) {
  const n = Math.max(1, Math.round(Number(ownedQty) || 1));
  if (n > 1) return `✅ Im Ordner gespeichert · Jetzt ${n}× vorhanden`;
  return `✅ Automatisch im Ordner${setName ? `: ${setName}` : ""} (1×)`;
}

/**
 * Status-Zeilen des Live-Preisschilds.
 *  status: „✅ Automatisch im Ordner: [Set-Name] (1×)“ / „✅ Im Ordner gespeichert · Jetzt 2× vorhanden“
 *          (sonst „📒 Sortiere automatisch in den Ordner …“ bzw. „📒 In der Scan-Liste“)
 *  flag:   „🔥 Hit > 10 €“ (ab HIT_EUR) · „⚡ Fehlt dir noch!“ (Lücke im Binder geschlossen) · „×2“ (Doppelte)
 */
export function tagLines({ price = 0, filed = false, saving = false, ownedBefore = false, qty = 1, hitEur = SWEEP.HIT_EUR, setName = "", ownedQty = 0 } = {}) {
  const status = filed ? filedLabel({ setName, ownedQty: ownedQty || (ownedBefore ? 2 : 1) }) : saving ? "📒 Sortiere automatisch in den Ordner …" : "📒 In der Scan-Liste";
  const p = Number(price) || 0;
  const flag = p >= hitEur ? `🔥 Hit > ${hitEur} €` : !ownedBefore && qty <= 1 ? "⚡ Fehlt dir noch!" : qty > 1 ? `×${qty} · Doppelte` : "";
  return { status, flag, hot: p >= hitEur };
}

/**
 * 1-Klick-Inserieren: Preis aus dem aktuellen Cardmarket-Wert (cm).
 *  mode „cm“   → genau der Cardmarket-Wert
 *  mode „deal“ → Schnell-Inserieren: 0,50 € bis 5,00 € unter Cardmarket (10 % Abschlag, mindestens 0,50 €, höchstens 5,00 €),
 *               auf 5 ct abgerundet; sehr günstige Karten (< 0,55 €) gehen zum halben Wert, mindestens 0,05 €.
 * Liefert den Preis in € (2 Nachkommastellen) oder null ohne Cardmarket-Wert.
 */
export function oneTapPrice(cm, mode = "cm") {
  const v = Number(cm);
  if (!Number.isFinite(v) || v <= 0) return null;
  const r2 = (x) => Math.round(x * 100) / 100;
  if (mode !== "deal") return r2(v);
  const off = Math.min(5, Math.max(0.5, v * 0.1));
  let p = Math.floor(r2(v - off) * 20 + 1e-6) / 20;
  if (p < 0.05) p = Math.max(0.05, Math.floor(v * 0.5 * 20) / 20);
  return r2(p);
}

/** Tages-Schlüssel (lokale Zeit) „2026-11-19“. */
export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tages-Scan-Zähler fortschreiben (neuer Tag → startet bei 0). prev: { day, count, value } | null */
export function bumpDaily(prev, { count = 1, value = 0 } = {}, now = Date.now()) {
  const day = dayKey(now);
  const base = prev && prev.day === day ? prev : { day, count: 0, value: 0 };
  return { day, count: Math.max(0, (Number(base.count) || 0) + count), value: Math.round(((Number(base.value) || 0) + (Number(value) || 0)) * 100) / 100 };
}

/** „Heute gescannt: 24 Karten · Gesamtwert: 87,40 €“ */
export function dailyLabel(d, now = Date.now()) {
  const cur = d && d.day === dayKey(now) ? d : { count: 0, value: 0 };
  const n = Number(cur.count) || 0;
  return `Heute gescannt: ${n.toLocaleString("de-DE")} ${n === 1 ? "Karte" : "Karten"} · Gesamtwert: ${euro(cur.value)}`;
}

/**
 * Gesamtwert aller gerade im Bild erkannten Karten (Sweep-Modus): je Erkennung ≥ minMatch einmal, Preis über priceOf(key).
 * Liefert { count, value, priced }.
 */
export function viewTotal(dets, priceOf, minMatch = SWEEP.MIN_MATCH) {
  const seen = new Set();
  let count = 0, value = 0, priced = 0;
  for (const d of Array.isArray(dets) ? dets : []) {
    if (!Array.isArray(d.keys) || !d.keys.length || Number(d.match) < minMatch) continue;
    const c = quadCenter(d.quad);
    const id = `${d.keys[0]}@${c ? `${Math.round(c[0] * 4)},${Math.round(c[1] * 4)}` : count}`;
    if (seen.has(id)) continue;
    seen.add(id);
    count++;
    const p = Number(priceOf(d.keys[0])) || 0;
    if (p > 0) { value += p; priced++; }
  }
  return { count, value: Math.round(value * 100) / 100, priced };
}

// ---------------------------------------------------------------------------
// Scan-Session (Liste der gescannten Karten)
// ---------------------------------------------------------------------------
export const FINISH_KEYS = ["normal", "holo", "reverse_holo"];
export const FINISH_LABEL = { normal: "Normal", holo: "Holo", reverse_holo: "Reverse Holo" };
const finishOk = (f) => (FINISH_KEYS.includes(f) ? f : "normal");

/**
 * Neuer Scan: gleiche Karte + gleiche Variante → Anzahl +1, sonst neuer Eintrag oben. Liefert { items, uid }.
 * entry: { key, finish, lang, info?, label?, at? }
 */
export function sessionAdd(items, entry, seq = Date.now()) {
  const finish = finishOk(entry.finish);
  const found = items.find((i) => i.key === entry.key && i.finish === finish);
  if (found) {
    const next = items.map((i) => (i === found ? { ...i, qty: i.qty + 1, at: entry.at ?? Date.now() } : i));
    return { items: [next.find((i) => i.uid === found.uid), ...next.filter((i) => i.uid !== found.uid)], uid: found.uid };
  }
  const uid = `s${seq}`;
  return { items: [{ uid, key: entry.key, finish, lang: entry.lang || langOfKey(entry.key), qty: 1, info: entry.info || null, label: entry.label || "", at: entry.at ?? Date.now() }, ...items], uid };
}

export function sessionQty(items, uid, delta) {
  return items.flatMap((i) => (i.uid !== uid ? [i] : i.qty + delta > 0 ? [{ ...i, qty: Math.min(999, i.qty + delta) }] : []));
}

/** Variante ändern; existiert dieselbe Karte schon mit der neuen Variante, werden die Einträge zusammengelegt. */
export function sessionFinish(items, uid, finish) {
  const f = finishOk(finish);
  const it = items.find((i) => i.uid === uid);
  if (!it || it.finish === f) return items;
  const twin = items.find((i) => i.uid !== uid && i.key === it.key && i.finish === f);
  if (twin) return items.filter((i) => i.uid !== uid).map((i) => (i === twin ? { ...i, qty: i.qty + it.qty } : i));
  return items.map((i) => (i.uid === uid ? { ...i, finish: f } : i));
}

/** Rückgängig: letzten Scan-Vorgang zurücknehmen (Anzahl −1 bzw. Eintrag entfernen). history = [uid, …] */
export function sessionUndo(items, history) {
  const h = [...history];
  while (h.length) {
    const uid = h.pop();
    if (items.some((i) => i.uid === uid)) return { items: sessionQty(items, uid, -1), history: h, uid };
  }
  return { items, history: h, uid: null };
}

/** Anzahl Karten und Gesamtwert (priceOf(item) → Stückpreis in €). */
export function sessionTotals(items, priceOf) {
  let count = 0, value = 0;
  for (const i of items) {
    count += i.qty;
    const p = Number(priceOf(i)) || 0;
    value += p * i.qty;
  }
  return { count, value: Math.round(value * 100) / 100, distinct: items.length };
}

/**
 * Doppelte fürs Marktplatz-Angebot: je Eintrag alle Exemplare über das erste hinaus. Liegt die Karte schon im
 * Set-Binder (owned(key) = true), zählt auch das erste Exemplar als doppelt.
 */
export function sessionDuplicates(items, owned = () => false) {
  const out = [];
  for (const i of items) {
    const extra = owned(i.key) ? i.qty : i.qty - 1;
    if (extra > 0) out.push({ ...i, extra });
  }
  return out;
}
