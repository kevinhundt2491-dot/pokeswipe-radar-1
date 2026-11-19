// PokeSwipe & Radar – Zero-Latency Sweep-Modus: reine Rechen-Logik (ohne DOM/Netzwerk, im Worker und in Tests nutzbar).
//
//  4-Stufen-Pipeline (Stapel / Einzelkarte):
//   1) cardPresence    – Präsenz- & Ruhe-Gate: GENAU EIN klares Karten-Rechteck (Seitenverhältnis 1 : 1,25 … 1 : 1,55,
//                        20 … 88 % der Bildfläche), scharf (Laplace-Varianz), nicht dunkel/einfarbig – sonst Standby (0 Scans)
//   2) insetQuad       – unsichtbare Perspektiv-Begradigung: Karte auf 300 × 420 px, 3 % Rand ab (Sleeve/Ordner/Tisch weg)
//   3) imageOk / verifiedOk – Hybrid-Verifikation: Sammlernummer + Artwork (sofort) ODER reines Artwork ≥ 82 % mit ≥ 10 %
//                        Vorsprung in 2 aufeinanderfolgenden Bildern (keine 58-%-Zufallsschwelle mehr)
//   4) createSweepGate – physische Karten-Sperre: nach einem Treffer friert der Auslöser global ein, bis die Karte wirklich
//                        weg bzw. ausgetauscht ist (Rechteck weg oder > 40 % Bildveränderung im Zentrum für ≥ 200 ms)
//
//  • findCardRects    – rahmenlose Karten-Suche: rechteckige Silhouetten im Seitenverhältnis 63:88 irgendwo im Bild
//                       (Kanten-Linienintegrale über Präfixsummen, alle Größen/Positionen in wenigen Millisekunden)
//  • layoutFromRgba   – räumlicher Farb-/Layout-Vektor (4 × 6 Zellen, weißabgleich-normiert) einer entzerrten Karte
//  • matchPercent     – Übereinstimmung 0…1 aus Bild-Fingerabdruck (pHash/dHash) und Farb-Layout
//  • topMatchesIn     – Hamming-Suche im ganzen Index oder nur in den Zeilen eines Sets („Set-Lock“), mit Früh-Abbruch
//  • motionStats      – Frame-Delta: ganzes Bild, Bildzentrum, geänderter Flächenanteil (Seitenwechsel im Ordner)
//  • confidencePercent – kalibrierte Konfidenz 0…100 % aus Übereinstimmung, Abstand zum nächsten Motiv und Nummern-ROI
//  • Preisschild-/Zähler-Helfer – Etikett-Texte, Tages-Scan-Zähler, Gesamtwert der Karten im Bild
//  • Session-Helfer   – Scan-Liste mit Anzahl, Variante, Rückgängig, Gesamtwert, Doppelte
import { popcount32, WORDS, GLARE_MASK_MAX, maskBits, homography, project, detectCard } from "../../server/scan-logic.ts";

export const SWEEP = {
  /** Breite des Analyse-Bilds für die Kantensuche */
  DETECT_W: 320,
  /** Breite des Bilds, das an den Worker geht (Entzerrung/Fingerabdruck aus diesem Bild) */
  FRAME_W: 480,
  /** Höchstens ~30 Bilder/s an den Worker */
  MIN_FRAME_MS: 33,
  /**
   * Stufe 3 – reiner Artwork-Treffer (ohne gelesene Nummer): ≥ 82 % Übereinstimmung (inkl. normalisierter Farbverteilung)
   * UND ≥ 10 % Vorsprung vor dem zweitbesten Motiv (MARGIN_PCT · HASH_SCALE = 16 Punkte) in 2 aufeinanderfolgenden Bildern.
   * Die frühere 58-%-Schwelle ist abgeschafft: Bildrauschen über 35 000 Karten erreicht 58–59 % und löste Geister-Scans aus.
   * DIRECT_MATCH (66 %): Schwelle je Fach im Ordner-Modus (unverändert).
   */
  MIN_MATCH: 0.82,
  DIRECT_MATCH: 0.66,
  /** Abstand zum zweitbesten Motiv als Anteil der Ähnlichkeit (margin / HASH_SCALE) – 10 % Vorsprung */
  MARGIN_PCT: 0.1,
  /** Farbe ohne Referenzbild: keine zusätzliche Hürde (die 82 % gelten trotzdem) */
  NO_COLOR_EXTRA: 0,
  /**
   * Stufe 3 A – Nummer + Artwork: Sammlernummer auf der begradigten Karte gelesen, passt zu einem Kandidaten der Bild-Suche
   * (Gesamtzahl „/159“ muss passen) UND dessen Artwork-Ähnlichkeit ≥ NUM_MATCH → sofort sicherer Treffer (1 Bild).
   */
  NUM_MATCH: 0.66,
  /** Stufe 3 C – unsicherer Bereich (klare, scharfe Karte, aber < 82 %): ab hier Name+Nummer-OCR bzw. Vision-Rückfall */
  FALLBACK_MIN: 0.65,
  /** So lange muss eine Karte im unsicheren Bereich ruhig im Bild liegen, bevor der Rückfall startet (ms) */
  FALLBACK_HOLD_MS: 300,
  /** Stufe 1 – Präsenz-Gate: Karten-Rechteck (Hochformat lang:kurz) und Flächenanteil am Kamerabild */
  RECT_RATIO_MIN: 1.25,
  RECT_RATIO_MAX: 1.55,
  RECT_MIN_AREA: 0.2,
  RECT_MAX_AREA: 0.88,
  /** Mindest-Kantenbewertung eines Rechtecks (findCardRects) und Stärke, ab der es auch ohne Ecken-Verfeinerung zählt */
  RECT_MIN_SCORE: 1.45,
  RECT_STRONG: 1.9,
  /** Zweites, getrenntes Rechteck (ab 8 % Fläche) mit ≥ 80 % der Kantenstärke des besten → mehrere Karten im Bild → Standby */
  MULTI_SCORE: 0.8,
  MULTI_MIN_AREA: 0.08,
  /** Schärfe: Laplace-Varianz (Graubild 320 px) innerhalb der Karte – darunter verwackelt/unscharf → Standby */
  FOCUS_MIN: 30,
  /** Dunkel (mittlere Helligkeit 0…255) bzw. einfarbig (Standardabweichung) – z. B. Handy liegt auf Tisch/Sofa → Standby */
  DARK_MEAN: 22,
  FLAT_STD: 9,
  /** Stufe 2 – Rand, der nach der Begradigung abgeschnitten wird (je Seite) – Sleeve, Ordner-Tasche, Tisch */
  CROP_INSET: 0.03,
  /** Standardbild der begradigten Karte (Name+Nummer-OCR / Vision-Rückfall) */
  STD_W: 300,
  STD_H: 420,
  /**
   * Stufe 4 – physische Karten-Sperre: nach einem Treffer friert der Auslöser für den GANZEN Scanner ein. Frei erst, wenn die
   * Karte wirklich weg bzw. ausgetauscht ist: Karten-Rechteck verschwunden oder > 40 % Veränderung im Bildzentrum, jeweils
   * durchgehend ≥ 200 ms – und das Bildzentrum hat sich seit dem Treffer mindestens einmal um > 40 % verändert (ein kurz
   * flackerndes Rechteck über derselben, ruhig liegenden Karte gibt die Sperre also nie frei).
   */
  FREEZE_DRIFT: 0.4,
  FREEZE_RELEASE_MS: 200,
  /** Ab dieser Übereinstimmung gilt eine Karte als „im Bild gesehen“ (hält die Sperre, Etikett folgt der Karte) */
  TRACK_MATCH: 0.55,
  /** Reiner Artwork-Treffer: 2 aufeinanderfolgende ruhige Bilder mit derselben Karte (Nummer + Artwork: sofort) */
  CONSENSUS_FRAMES: 2,
  /** Zeitfenster zwischen den beiden Bildern (~120 ms; langsame Geräte: bis 2,2 Bildzeiten, höchstens CONSENSUS_MAX_MS) */
  CONSENSUS_MS: 120,
  CONSENSUS_MAX_MS: 200,
  /** Keine Zeit-Pause: die physische Karten-Sperre (Stufe 4) verhindert Doppel- und Mehrfach-Namen */
  HIT_PAUSE_MS: 0,
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
  /** 1,2-Sekunden-Sperre pro Karte: 1,2 s nicht mehr gesehen → dieselbe cardId darf wieder zählen */
  LOCK_IDLE_MS: 1200,
  LOCK_IDLE_DRIFT: 0,
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

export function findCardRects(grad, w, h, { max = 4, minFrac = 0.2, maxFrac = 0.96, minScore = 1.35, ratio = SWEEP.CARD_RATIO, lines = null, sizeStep = 1.12, posStep = 0.035 } = {}) {
  const { hLine, vLine, norm } = lines || edgeLines(grad, w, h);
  const cands = [];
  const minH = Math.max(24, h * minFrac), maxH = Math.min(h * maxFrac, (w * maxFrac) / ratio);
  for (let ch = maxH; ch >= minH; ch /= sizeStep) {
    const cw = ch * ratio;
    const iw = Math.round(cw), ih = Math.round(ch);
    const step = Math.max(2, Math.round(ch * posStep));
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
// Stufe 1: Karten-Präsenz- & Ruhe-Gate
// ---------------------------------------------------------------------------
/** Fläche (Shoelace), Seitenverhältnis lang:kurz (Mittel gegenüberliegender Seiten) und Konvexität eines Vierecks. */
export function quadGeometry(q) {
  let area = 0;
  for (let i = 0; i < 4; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % 4]; area += x0 * y1 - x1 * y0; }
  const side = (a, b) => Math.hypot(q[b][0] - q[a][0], q[b][1] - q[a][1]);
  const wAvg = (side(0, 1) + side(3, 2)) / 2, hAvg = (side(0, 3) + side(1, 2)) / 2;
  let sign = 0, convex = true;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-9) continue;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) convex = false;
  }
  return { area: Math.abs(area) / 2, ratio: Math.max(wAvg, hAvg) / Math.max(1e-6, Math.min(wAvg, hAvg)), w: wAvg, h: hAvg, convex };
}

/** Viereck um k (Anteil je Seite) nach innen ziehen – in Karten-Koordinaten (u, v), also auch für schräge Karten exakt. */
export function insetQuad(q, k = SWEEP.CROP_INSET) {
  const H = homography(q);
  return [project(H, k, k), project(H, 1 - k, k), project(H, 1 - k, 1 - k), project(H, k, 1 - k)];
}

/** Mittlere Helligkeit und Standardabweichung eines Graubilds (dunkel / einfarbig erkennen). */
export function grayStats(g) {
  let s = 0, q = 0;
  const n = g.d.length;
  for (let i = 0; i < n; i++) { const v = g.d[i]; s += v; q += v * v; }
  const mean = n ? s / n : 0;
  return { mean, std: n ? Math.sqrt(Math.max(0, q / n - mean * mean)) : 0 };
}

/** Schärfe: Varianz des Laplace-Operators im Rechteck box (inkl. Kartenkante) des Graubilds. */
export function laplacianVar(g, box = null) {
  const { w, h, d } = g;
  const bx0 = box ? box.x0 : 0, bx1 = box ? box.x1 : w, by0 = box ? box.y0 : 0, by1 = box ? box.y1 : h;
  const x0 = Math.max(1, Math.floor(bx0)), x1 = Math.min(w - 1, Math.ceil(bx1)), y0 = Math.max(1, Math.floor(by0)), y1 = Math.min(h - 1, Math.ceil(by1));
  let s = 0, q = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x;
    const v = 4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w];
    s += v; q += v * v; n++;
  }
  if (!n) return 0;
  const m = s / n;
  return Math.max(0, q / n - m * m);
}

/** Überdeckung zweier Rechtecke: { iou, small } (small = Schnittfläche / Fläche des kleineren). */
function boxOverlap(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const sa = (a.x1 - a.x0) * (a.y1 - a.y0), sb = (b.x1 - b.x0) * (b.y1 - b.y0), inter = ix * iy;
  return { iou: inter / Math.max(1e-6, sa + sb - inter), small: inter / Math.max(1e-6, Math.min(sa, sb)) };
}

/**
 * Stufe 1 – Karten-Präsenz- & Ruhe-Gate (Graubild ~320 px + Sobel-Gradient). Erst wenn GENAU EIN klares Karten-Rechteck
 * im Trading-Card-Format (lang:kurz 1,25 … 1,55) 20 … 88 % des Bilds einnimmt, scharf ist und das Bild weder dunkel noch
 * einfarbig ist, darf überhaupt gegen den Katalog abgeglichen werden.
 *  • Karte ↔ Sleeve (fast deckungsgleich, IoU ≥ 0,5) = EIN Objekt; Rechtecke innerhalb der Karte zählen nie als 2. Karte.
 *  • Weitere getrennte Karten-Rechtecke (ab 8 % Fläche, ≥ 80 % der Kantenstärke) → „multi“ (z. B. 4 Karten auf dem Tisch).
 * Liefert { ok, reason: "" | "dark" | "flat" | "none" | "multi" | "blur", quad?, area?, ratio?, focus?, mean, std, count }.
 */
export function cardPresence(g, grad, cfg = SWEEP) {
  const { mean, std } = grayStats(g);
  const base = { mean: Math.round(mean), std: Math.round(std * 10) / 10 };
  if (mean < cfg.DARK_MEAN) return { ok: false, reason: "dark", count: 0, ...base };
  if (std < cfg.FLAT_STD) return { ok: false, reason: "flat", count: 0, ...base };
  const W = g.w, H = g.h;
  // kleinste gesuchte Kartenhöhe: 8 % Fläche (kleinere Karten zählen nur für „mehrere Karten im Bild“), etwas Luft für Perspektive
  const minH = Math.sqrt((cfg.MULTI_MIN_AREA * W * H) / SWEEP.CARD_RATIO) * 0.85;
  // feines Größen-/Positionsraster (4 % / 2 %): die Kante muss exakt sitzen, sonst scheitert die Ecken-Verfeinerung
  const rects = findCardRects(grad, W, H, { max: 8, minFrac: Math.min(0.95, minH / H), maxFrac: 0.995, minScore: cfg.RECT_MIN_SCORE, sizeStep: 1.04, posStep: 0.02 });
  const found = [];
  // Ecken nur für konkurrenzfähige Rechtecke verfeinern (≥ MULTI_SCORE der besten Kantenstärke) – der Rest spielt keine Rolle
  const top = rects.length ? rects[0].score : 0;
  for (const r of rects) {
    if (r.score < top * cfg.MULTI_SCORE) break;
    const det = detectCard(g, r, grad);
    const quad = det.found ? det.corners : r.score >= cfg.RECT_STRONG ? rectQuad(r) : null;
    if (!quad) continue;
    const geo = quadGeometry(quad);
    const area = geo.area / (W * H);
    if (!geo.convex || geo.ratio < cfg.RECT_RATIO_MIN || geo.ratio > cfg.RECT_RATIO_MAX || area < cfg.MULTI_MIN_AREA || area > cfg.RECT_MAX_AREA) continue;
    found.push({ quad, area, ratio: geo.ratio, score: r.score, box: quadBox(quad) });
  }
  // Karte ↔ Sleeve zusammenfassen (bestes Rechteck mit ≥ 20 % Fläche vertritt das Objekt)
  const objs = [];
  for (const f of found) {
    const o = objs.find((x) => boxOverlap(x.members[0].box, f.box).iou >= 0.5);
    if (o) o.members.push(f); else objs.push({ members: [f], score: f.score });
  }
  const big = objs.map((o) => ({ o, rep: o.members.find((m) => m.area >= cfg.RECT_MIN_AREA) || null })).filter((x) => x.rep);
  const separate = (a, b) => boxOverlap(a.box, b.box).small <= 0.3;
  if (!big.length) {
    const small = objs.filter((o, i) => objs.findIndex((x) => !separate(x.members[0], o.members[0])) === i);
    return { ok: false, reason: small.length >= 2 ? "multi" : "none", count: small.length, ...base };
  }
  const best = big.sort((a, b) => b.o.score - a.o.score)[0];
  const rivals = objs.filter((o) => o !== best.o && o.score >= best.o.score * cfg.MULTI_SCORE && separate(o.members[0], best.rep)).length;
  if (rivals) return { ok: false, reason: "multi", count: rivals + 1, ...base };
  const focus = laplacianVar(g, best.rep.box);
  const r2 = (v) => Math.round(v * 100) / 100;
  if (focus < cfg.FOCUS_MIN) return { ok: false, reason: "blur", count: 1, focus: Math.round(focus), quad: best.rep.quad, ...base };
  return { ok: true, reason: "", count: 1, quad: best.rep.quad, area: r2(best.rep.area), ratio: r2(best.rep.ratio), score: r2(best.o.score), focus: Math.round(focus), ...base };
}

/**
 * Veränderung im Bildzentrum (mittlere 50 % × 50 % der Anker-Miniatur) gegenüber dem Anker, 0…1:
 * größerer Wert aus 1 − normierter Kreuzkorrelation und Anteil deutlich geänderter Zellen (Belichtung kürzt sich heraus). Dieselbe Karte mit Handzittern ≈ 0 … 0,15,
 * eine andere Karte bzw. leerer Tisch ≫ 0,4. Sehr kontrastarme Zentren: Helligkeitssprung relativ. Ohne Miniaturen: null.
 */
export function centerDrift(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h || !a.d || !b.d) return null;
  const x0 = Math.floor(a.w * 0.25), x1 = Math.ceil(a.w * 0.75), y0 = Math.floor(a.h * 0.25), y1 = Math.ceil(a.h * 0.75);
  let ma = 0, mb = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * a.w + x; ma += a.d[i]; mb += b.d[i]; n++; }
  if (!n) return null;
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * a.w + x, da = a.d[i] - ma, db = b.d[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  const sa = Math.sqrt(saa / n), sb = Math.sqrt(sbb / n);
  // beide (fast) einfarbig: nur der Helligkeitssprung zählt; nur eines einfarbig: Struktur kam/ging → deutliche Änderung
  if (sa < 4 && sb < 4) return Math.min(1, Math.abs(ma - mb) / 60);
  if (sa < 4 || sb < 4) return 1;
  // zusätzlich: Anteil deutlich geänderter Zellen (ohne Belichtungs-Sprung) – der größere Wert zählt
  const off = mb - ma;
  let c = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * a.w + x; if (Math.abs(b.d[i] - a.d[i] - off) > SWEEP.ANCHOR_DELTA) c++; }
  return Math.max(c / n, Math.max(0, Math.min(1, 1 - sab / Math.sqrt(saa * sbb))));
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
 * Stufe 3 B – reiner Artwork-Treffer (Stapel / Einzelkarte) je Bild: ≥ MIN_MATCH (82 %) UND Vorsprung zum zweitbesten Motiv
 * ≥ MARGIN_PCT (10 % ≙ 16 Hash-Punkte). Dazu: Grundfarbe darf nicht widersprechen (colorReject = rote Karte vs. grüne/blaue
 * Referenz), Farb-Referenz darf nicht gerade noch laden (colorPending – lieber ein Bild länger) und eine gelesene Nummer darf
 * nicht widersprechen. margin = Hash-Abstand (Punkte) zum nächsten anderen Motiv; fehlt er → klar.
 */
export function quickOk(d, cfg = SWEEP) {
  const match = Number(d?.match) || 0;
  const margin = Number.isFinite(d?.margin) ? d.margin : 99;
  const min = cfg.MIN_MATCH + (d?.color === "none" ? cfg.NO_COLOR_EXTRA || 0 : 0);
  return match >= min && margin / cfg.HASH_SCALE >= cfg.MARGIN_PCT && !d?.colorReject && !d?.colorPending && d?.numOk !== false;
}
export { quickOk as imageOk };

/**
 * Stufe 3 A – Nummer + Artwork: Sammlernummer auf der begradigten Karte gelesen und sie passt zu genau diesem Kandidaten
 * (verified, vom Worker gesetzt), Artwork-Ähnlichkeit ≥ NUM_MATCH, keine widersprechende Grundfarbe → sofort sicher.
 */
export function verifiedOk(d, cfg = SWEEP) {
  return d?.verified === true && d?.numOk === true && Number(d?.match) >= cfg.NUM_MATCH && !d?.colorReject;
}

/** Strikte Prüfung für den Binder- & Tisch-Sweep: 99–100 % Konfidenz, keine widersprüchliche Nummer. */
export const strictOk = (d) => confidencePercent(d) >= SWEEP.STRICT_CONF && d?.numOk !== false;

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
 * Stapel / Einzelkarte (Modus „turbo“) – entscheidet je Live-Bild, ob eine erkannte Karte als Scan zählt.
 * push({ dets, card?, motion, center?, changed?, thumb? }, now, avgFrameMs)
 *   → { hits: [keys[]], locked: [keys[]], view, paused, blurry, frozen, epoch }
 *  • card = Ergebnis des Präsenz-Gates (Stufe 1). Fehlt es, gilt „Karte da“, sobald eine Erkennung vorliegt.
 *  • Stufe 3: Nummer + Artwork (verifiedOk) → sofort; reiner Artwork-Treffer (imageOk: ≥ 82 %, ≥ 10 % Vorsprung) erst,
 *    wenn 2 DIREKT aufeinanderfolgende, nicht verwackelte Bilder dieselbe Karte zeigen. Höchstens EIN Treffer je Bild.
 *  • Stufe 4 – physische Karten-Sperre: nach jedem Treffer friert der Auslöser für ALLE Karten ein (kein zweiter oder
 *    dritter Name über derselben Karte). Frei erst, wenn das Bildzentrum sich gegenüber dem Treffer-Bild um > 40 %
 *    verändert hat UND (Karten-Rechteck weg oder > 40 % Veränderung) durchgehend ≥ 200 ms anhält.
 *    Wurde die Sperre freigegeben, ohne dass das Rechteck je verschwand (Karte nur stark bewegt), bleibt genau diese Karte
 *    noch gesperrt, bis einmal keine Karte im Bild war – weitere Exemplare zählt der „+1“-Knopf.
 *  • epoch zählt jede neue physische Karte (Sperre frei bzw. ≥ 200 ms keine Karte) – für den OCR-/Vision-Rückfall.
 *  • external(keys, now, thumb?) – Treffer aus dem Name+Nummer-OCR bzw. Vision-Rückfall (respektiert die Sperre).
 */
function createTurboGate(opts = {}) {
  const cfg = { ...SWEEP, ...opts, mode: "turbo" };
  let prev = null; // { keys, at, n, sharp }
  let freeze = null; // { keys, thumb, at, awayAt, moved, gone }
  let ghost = null; // keys, die nach einer Freigabe ohne „Karte weg“ noch gesperrt bleiben
  let epoch = 0, absentAt = null, lastThumb = null;
  const lockOn = (keys, now, thumb) => { freeze = { keys: [...keys], thumb, at: now, awayAt: null, moved: false, gone: false }; prev = null; };
  return {
    push(frame, now = Date.now(), avgFrameMs = 0) {
      const dets = Array.isArray(frame?.dets) ? frame.dets : [];
      const motion = Number(frame?.motion);
      const hasPrev = Number.isFinite(motion) && motion < 1;
      const center = Number.isFinite(Number(frame?.center)) && frame?.center !== undefined && frame?.center !== null ? Number(frame.center) : hasPrev ? motion : 0;
      const changed = Number(frame?.changed) || 0;
      const thumb = frame?.thumb && frame.thumb.d ? frame.thumb : null;
      if (thumb) lastThumb = thumb;
      const present = typeof frame?.card === "boolean" ? frame.card : dets.some((d) => Array.isArray(d.keys) && d.keys.length);
      const blurry = hasPrev && (center >= cfg.BLUR_CENTER || motion >= cfg.BLUR_MOTION);
      // Neue physische Karte: ≥ 200 ms gar keine Karte im Bild
      if (!present) { if (absentAt === null) absentAt = now; ghost = null; }
      else if (absentAt !== null) { if (now - absentAt >= cfg.FREEZE_RELEASE_MS) epoch++; absentAt = null; }
      // Stufe 4: globale Sperre fortschreiben
      if (freeze) {
        const cd = thumb && freeze.thumb ? centerDrift(freeze.thumb, thumb) : null;
        const drift = cd === null ? changed : cd;
        if (drift > cfg.FREEZE_DRIFT) freeze.moved = true;
        if (!present) freeze.gone = true;
        const away = !present || drift > cfg.FREEZE_DRIFT;
        if (away) { if (freeze.awayAt === null) freeze.awayAt = now; } else freeze.awayAt = null;
        if (freeze.moved && freeze.awayAt !== null && now - freeze.awayAt >= cfg.FREEZE_RELEASE_MS) {
          ghost = freeze.gone || !present ? null : freeze.keys;
          freeze = null; prev = null; epoch++;
        }
      }
      const valid = (d) => Array.isArray(d.keys) && d.keys.length && !d.carried;
      const verified = dets.filter((d) => valid(d) && verifiedOk(d, cfg));
      const image = dets.filter((d) => valid(d) && !verifiedOk(d, cfg) && quickOk(d, cfg));
      const view = [...verified, ...image];
      const hits = [];
      if (freeze) return { hits, locked: [freeze.keys], view, paused: false, blurry, frozen: true, epoch };
      const windowMs = Math.max(cfg.CONSENSUS_MS, Math.min(cfg.CONSENSUS_MAX_MS, 2.2 * (Number(avgFrameMs) || 0)));
      const blocked = (d) => ghost && overlap(ghost, d.keys);
      let next = null, hit = null;
      if (!blurry && present) {
        hit = verified.find((d) => !blocked(d)) || null;
        if (!hit) {
          // reiner Artwork-Treffer: nur die beste Erkennung des Bilds, 2 Bilder in Folge
          const d = image.filter((x) => !blocked(x)).sort((a, b) => Number(b.match) - Number(a.match))[0];
          if (d) {
            const sharp = Number(d.sharp);
            const p = prev && overlap(prev.keys, d.keys) && now - prev.at <= windowMs ? prev : null;
            const smeared = p && Number.isFinite(sharp) && Number.isFinite(p.sharp) && sharp < p.sharp * cfg.BLUR_DROP;
            const n = p && !smeared ? p.n + 1 : 1;
            if (n >= cfg.CONSENSUS_FRAMES) hit = d;
            else next = { keys: d.keys, at: now, n, sharp: Number.isFinite(sharp) ? sharp : undefined };
          }
        }
      }
      prev = next;
      if (hit) { hits.push(hit.keys); lockOn(hit.keys, now, thumb || lastThumb); }
      return { hits, locked: freeze ? [freeze.keys] : [], view, paused: false, blurry, frozen: Boolean(freeze), epoch };
    },
    /** Treffer aus dem Name+Nummer-OCR- bzw. Vision-Rückfall: zählt nur, wenn der Scanner gerade nicht gesperrt ist */
    external(keys, now = Date.now(), thumb = null) {
      if (freeze || !Array.isArray(keys) || !keys.length || (ghost && overlap(ghost, keys))) return false;
      lockOn(keys, now, thumb || lastThumb);
      return true;
    },
    /** Sperre aufheben (z. B. Modus-Wechsel): die Karte im Bild darf sofort neu erkannt werden */
    unlock(keys) { if (!keys || (freeze && overlap(freeze.keys, keys))) freeze = null; if (!keys || (ghost && overlap(ghost, keys))) ghost = null; },
    reset() { prev = null; freeze = null; ghost = null; absentAt = null; lastThumb = null; epoch++; },
    pauseLeft() { return 0; },
    get frozen() { return Boolean(freeze); },
    get epoch() { return epoch; },
    get locks() { return freeze ? [{ keys: [...freeze.keys], at: freeze.at, moved: freeze.moved, gone: freeze.gone }] : []; },
  };
}

/**
 * Scan-Gate: „turbo“ (Stapel / Einzelkarte – 4-Stufen-Pipeline mit physischer Karten-Sperre) oder „sweep“ (strikt, Binder-/
 * Tisch-Sweep: ≥ 99 % Konfidenz über 3 Bilder, gleiche Karte an anderer Stelle = 2. Exemplar).
 */
export function createSweepGate(opts = {}) {
  let mode = opts.mode === "sweep" ? "sweep" : "turbo";
  let g = mode === "sweep" ? createStrictGate(opts) : createTurboGate(opts);
  return {
    push: (frame, now, avg) => g.push(frame, now, avg),
    external: (keys, now, thumb) => (g.external ? g.external(keys, now, thumb) : false),
    unlock: (keys) => g.unlock(keys),
    reset: () => g.reset(),
    setMode(m) {
      const next = m === "sweep" ? "sweep" : "turbo";
      if (next === mode) return;
      mode = next;
      g = mode === "sweep" ? createStrictGate({ ...opts, mode }) : createTurboGate({ ...opts, mode });
    },
    pauseLeft: (now) => g.pauseLeft(now),
    get mode() { return mode; },
    get frozen() { return Boolean(g.frozen); },
    get epoch() { return g.epoch || 0; },
    get locks() { return g.locks; },
  };
}

/**
 * Strikter Binder-/Tisch-Sweep (Modus „sweep“, früherer Stapel-Gate) – entscheidet je Live-Bild, ob eine erkannte Karte zählt.
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
function createStrictGate(opts = {}) {
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
      const visible = dets.filter((d) => Array.isArray(d.keys) && d.keys.length && Number(d.match) >= cfg.TRACK_MATCH);
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
