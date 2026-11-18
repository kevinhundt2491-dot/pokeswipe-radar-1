// PokeSwipe & Radar – Zero-Latency Sweep-Modus: reine Rechen-Logik (ohne DOM/Netzwerk, im Worker und in Tests nutzbar).
//
//  • findCardRects    – rahmenlose Karten-Suche: rechteckige Silhouetten im Seitenverhältnis 63:88 irgendwo im Bild
//                       (Kanten-Linienintegrale über Präfixsummen, alle Größen/Positionen in wenigen Millisekunden)
//  • layoutFromRgba   – räumlicher Farb-/Layout-Vektor (4 × 6 Zellen, weißabgleich-normiert) einer entzerrten Karte
//  • matchPercent     – Übereinstimmung 0…1 aus Bild-Fingerabdruck (pHash/dHash) und Farb-Layout
//  • topMatchesIn     – Hamming-Suche im ganzen Index oder nur in den Zeilen eines Sets („Set-Lock“), mit Früh-Abbruch
//  • createSweepGate  – 2-Frame-Konsens, 2,5-s-Sperre je Karte, Bewegungs-Reset
//  • Session-Helfer   – Scan-Liste mit Anzahl, Variante, Rückgängig, Gesamtwert, Doppelte
import { popcount32, WORDS, GLARE_MASK_MAX, maskBits, homography, project } from "../../server/scan-logic.ts";

export const SWEEP = {
  /** Breite des Analyse-Bilds für die Kantensuche */
  DETECT_W: 320,
  /** Breite des Bilds, das an den Worker geht (Entzerrung/Fingerabdruck aus diesem Bild) */
  FRAME_W: 480,
  /** Höchstens ~30 Bilder/s an den Worker */
  MIN_FRAME_MS: 33,
  /** Mindest-Übereinstimmung für einen Treffer */
  MIN_MATCH: 0.86,
  /** Ab dieser Übereinstimmung wird die Karte im Live-Bild dezent markiert (noch kein Treffer) */
  TRACK_MATCH: 0.72,
  /** Aufeinanderfolgende Bilder mit derselben Karte, bis ausgelöst wird */
  CONSENSUS_FRAMES: 2,
  /** Zeitfenster zwischen den beiden Bildern (langsame Geräte: bis 2,2 Bildzeiten, höchstens CONSENSUS_MAX_MS) */
  CONSENSUS_MS: 150,
  CONSENSUS_MAX_MS: 400,
  /** Gerade gescannte Karte bleibt so lange gesperrt (verlängert sich, solange sie ruhig im Bild bleibt) */
  COOLDOWN_MS: 2500,
  /** Deutliche Bildveränderung zwischen zwei Bildern (mittlere Helligkeitsdifferenz der Miniatur, 0…1) */
  MOTION_RESET: 0.16,
  /** So viele Bilder ohne Karte → Karte gilt als weggezogen, Sperre aufgehoben */
  GONE_RESET_FRAMES: 2,
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
export function findCardRects(grad, w, h, { max = 4, minFrac = 0.2, maxFrac = 0.96, minScore = 1.35, ratio = SWEEP.CARD_RATIO } = {}) {
  const ax = new Float32Array(w * h), ay = new Float32Array(w * h);
  for (let i = 0; i < ax.length; i++) { ax[i] = Math.abs(grad.gx[i]); ay[i] = Math.abs(grad.gy[i]); }
  const r = Math.max(1, Math.round(Math.min(w, h) / 160));
  const ayD = dilateAcross(ay, w, h, r, true), axD = dilateAcross(ax, w, h, r, false);
  // Zeilen-Präfixsummen für waagerechte Kanten, Spalten-Präfixsummen für senkrechte Kanten
  const W1 = w + 1, H1 = h + 1;
  const rowP = new Float64Array(H1 * W1), colP = new Float64Array(W1 * H1);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += ayD[y * w + x]; rowP[y * W1 + x + 1] = s; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) { s += axD[y * w + x]; colP[x * H1 + y + 1] = s; } }
  const hLine = (y, x0, x1) => (rowP[y * W1 + x1] - rowP[y * W1 + x0]) / Math.max(1, x1 - x0);
  const vLine = (x, y0, y1) => (colP[x * H1 + y1] - colP[x * H1 + y0]) / Math.max(1, y1 - y0);
  const norm = Math.max(4, grad.mean);
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
// Frame-Konsens & Doppel-Scan-Schutz
// ---------------------------------------------------------------------------
const overlap = (a, b) => a.some((k) => b.includes(k));

/**
 * Entscheidet je Live-Bild, ob eine erkannte Karte als Scan zählt.
 * push({ dets: [{ keys, match }], found, motion }, now, avgFrameMs) → { hits: [keys[]], locked: [keys[]] }
 *  • Treffer erst, wenn ZWEI aufeinanderfolgende Bilder (innerhalb CONSENSUS_MS) dieselbe Karte mit ≥ MIN_MATCH zeigen
 *  • gerade gescannte Karte ist COOLDOWN_MS gesperrt; die Sperre verlängert sich, solange die Karte ruhig im Bild liegt
 *  • deutliche Bildveränderung (motion ≥ MOTION_RESET) oder GONE_RESET_FRAMES Bilder ohne Karte → alle Sperren weg
 */
export function createSweepGate(opts = {}) {
  const cfg = { ...SWEEP, ...opts };
  let prev = []; // qualifizierte Karten des vorigen Bildes: [{ keys, at }]
  let locks = []; // [{ keys, until }]
  let gone = 0;
  return {
    push(frame, now = Date.now(), avgFrameMs = 0) {
      const dets = Array.isArray(frame?.dets) ? frame.dets : [];
      const motion = Number(frame?.motion);
      if (frame?.found === false && !dets.some((d) => d.match >= cfg.TRACK_MATCH)) gone++; else gone = 0;
      if ((Number.isFinite(motion) && motion >= cfg.MOTION_RESET && motion < 1) || gone >= cfg.GONE_RESET_FRAMES) locks = [];
      locks = locks.filter((l) => l.until > now);
      const windowMs = Math.max(cfg.CONSENSUS_MS, Math.min(cfg.CONSENSUS_MAX_MS, 2.2 * (Number(avgFrameMs) || 0)));
      const qual = dets.filter((d) => Array.isArray(d.keys) && d.keys.length && Number(d.match) >= cfg.MIN_MATCH);
      const hits = [], locked = [];
      const still = !(Number.isFinite(motion) && motion >= cfg.MOTION_RESET * 0.5 && motion < 1);
      for (const d of qual) {
        const lock = locks.find((l) => overlap(l.keys, d.keys));
        if (lock) {
          // Karte liegt (ruhig) weiter im Bild → Sperre verlängern
          if (still) lock.until = now + cfg.COOLDOWN_MS;
          locked.push(d.keys);
          continue;
        }
        const agree = prev.some((p) => overlap(p.keys, d.keys) && now - p.at <= windowMs);
        if (!agree) continue;
        hits.push(d.keys);
        locks.push({ keys: [...d.keys], until: now + cfg.COOLDOWN_MS });
      }
      // Nur Karten, die nicht gerade ausgelöst haben, zählen als „vorheriges Bild“ für den nächsten Konsens
      prev = qual.filter((d) => !hits.includes(d.keys)).map((d) => ({ keys: d.keys, at: now }));
      return { hits, locked };
    },
    /** Sperre aufheben (z. B. nach „Rückgängig“: dieselbe Karte darf sofort neu erkannt werden) */
    unlock(keys) { locks = keys ? locks.filter((l) => !overlap(l.keys, keys)) : []; },
    reset() { prev = []; locks = []; gone = 0; },
    get locks() { return locks.map((l) => ({ ...l })); },
  };
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
