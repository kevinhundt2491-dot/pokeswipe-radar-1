// PokeSwipe & Radar – High-End-Scanner-Engine (läuft im Scanner-Web-Worker, teilt sich den Karten-Index mit der
// Foto-Erkennung). Zwei Wege je Live-Bild:
//   • Ordner-Seite (binderFrame): natives HD-Bild → 3 × 3- bzw. 2 × 2-Raster an das Linienmuster der Folie anpassen →
//     jedes Fach hochauflösend ausschneiden → Anti-Glare → Fingerabdruck → Treffer je Fach (Slot).
//   • Stapel / Einzelkarte (frame), ~480 px breit, bis zu 30 Bilder/s:
//   Graustufen 320 px → Sobel → rahmenlose Karten-Suche (Seitenverhältnis 63:88) bzw. Verfolgen der zuletzt gefundenen
//   Karten → Kanten verfeinern → perspektivisch begradigen → pHash/dHash von Karte + Artwork-Fenster → Hamming-Suche
//   (ganzer Index) → Pflicht-Farbabgleich (dominante Kartenfarbe Kamera ↔ Katalogbild, Farb-Referenz im IndexedDB-Cache):
//   falsche Grundfarbe → Kandidat sofort verworfen, nächstbester Kandidat rückt nach → Übereinstimmung + Abstand
//   → Sammlernummer im Nummern-Fenster (ROI) gegenlesen, wenn der Streifen groß genug ist.
// Multi-Card-Fix: NEUE Karten im Bild werden IMMER zuerst ausgewertet (vor den schon verfolgten), verfolgte Karten reihum –
// so kann eine schon erkannte Karte, die im Bild liegen bleibt, nie das Zeitbudget für Karte #2, #3, #4 … verbrauchen.
// Kein Bild verlässt das Gerät; keine KI.
import {
  sobel, detectCard, cardHashes, suppressGlare, glareMask, decide, wordsToHex, GLARE_HIGH, NORM_W, NORM_H,
  NUMBER_STRIPS, homography, project, prepareStrip, readNumber, rotateQuad,
} from "../../server/scan-logic.ts";
import {
  SWEEP, findCardRects, edgeLines, rectQuad, quadBox, rectIou, frameThumb, motionStats, layoutFromRgba, layoutSimilarity,
  hashSimilarity, topMatchesIn, grayDown, warpGrayRgba, LAYOUT_LEN, confidencePercent, anchorThumb,
} from "./sweep-logic.js";
import {
  HD, warpCardRgba, glareGray, zmuv, artVector, artSimilarity, fuseMatch, ART_LEN, paletteVector, paletteCheck, PAL_LEN, cardSharpness,
  GRID_LAYOUTS, defaultGrid, fitGrid, gridSlots, smoothGrid, polishRect, cropRgba,
} from "./hd-scan-logic.js";
import { idbGetMany, idbSetMany } from "./idb-cache.js";

/** Modus-Profile: Stapel / Einzelkarte (schnellstmöglich) · Ordner-Seite (bis zu 9 Fächer je Bild, Zeitbudget < 50 ms) */
const PROFILE = {
  turbo: { maxEval: 2, maxRects: 3, budgetMs: 22, globalEvery: 2, trackMs: 500, minEval: 1 },
  binder: { maxEval: SWEEP.MAX_CARDS, budgetMs: 44, minEval: 3 },
};
/** Schlüssel-Präfix der Mehrfach-Fingerabdrücke im IndexedDB-Store „layout“ (Farb-Layout + HSV-Matrix + Kantengradient + Farbsignatur) */
const FP_PREFIX = "v3:";
const FP_LEN = LAYOUT_LEN + ART_LEN + PAL_LEN;
/** So lange wartet ein Kandidat höchstens auf seine Farb-Referenz – danach gilt der strengere Rückfall ohne Farbe */
const REF_WAIT_MS = 2500;
/** Bis zu so viele verschiedene Motive werden der Reihe nach geprüft, wenn der Farbabgleich den besten verwirft */
const COLOR_RERANK = 3;
const unpackFp = (u) => ({ layout: u.subarray(0, LAYOUT_LEN), art: u.subarray(LAYOUT_LEN, LAYOUT_LEN + ART_LEN), pal: u.subarray(LAYOUT_LEN + ART_LEN) });
/**
 * Multi-Crop (Stapel / Einzelkarte): je Bild drei überlappende, mittige Ausschnitte im Kartenformat (88 %, 72 %, 55 % der
 * größtmöglichen Kartenhöhe) – Karte nah, mittel oder weiter weg. Reihum kommt je Bild eine leichte Verschiebung bzw.
 * Neigung dazu (Handzittern, nicht exakt mittig, leicht schräg): nach wenigen Bildern ist jede Lage einmal geprüft.
 */
const CROP_SCALES = [0.88, 0.72, 0.55];
const CROP_JITTER = [[0, 0, 0], [-0.07, 0, 0], [0.07, 0, 0], [0, -0.06, 0], [0, 0.06, 0], [0, 0, -5], [0, 0, 5], [-0.05, -0.04, 3], [0.05, 0.04, -3]];
export function cropQuads(w, h, n = 0, ratio = SWEEP.CARD_RATIO) {
  const maxH = Math.min(h * 0.98, (w * 0.98) / ratio);
  const [jx, jy, deg] = CROP_JITTER[((n % CROP_JITTER.length) + CROP_JITTER.length) % CROP_JITTER.length];
  return CROP_SCALES.map((k) => {
    const ch = maxH * k, cw = ch * ratio;
    const cx = Math.max(cw / 2, Math.min(w - cw / 2, w / 2 + jx * w)), cy = Math.max(ch / 2, Math.min(h - ch / 2, h / 2 + jy * h));
    const base = rectQuad({ x0: cx - cw / 2, y0: cy - ch / 2, x1: cx + cw / 2, y1: cy + ch / 2 });
    return { quad: deg ? rotateQuad(base, deg) : base, box: { x0: cx - cw / 2, y0: cy - ch / 2, x1: cx + cw / 2, y1: cy + ch / 2 }, scale: k };
  });
}
const keyOverlap = (a, b) => a.some((k) => b.includes(k));

/** Nummern-Fenster: so breit (Pixel im Kamerabild) muss der Streifen mindestens sein, damit Ziffern lesbar sind */
const NUMBER_MIN_PX = 105;
const STRIP_W = 252, STRIP_H = 72;

/**
 * getIdx(): aktueller Index ({ keys, langs, words, count, localNum, total }) · getVersion(): Zähler, der sich bei jedem
 * Neuladen ändert · labelOf(key): „Glurak ex 199/165“ · post(msg, transfer?) · getGlyphs(): Ziffern-Vorlagen (optional)
 */
export function createSweepEngine({ getIdx, getVersion, labelOf, post, getGlyphs = () => null }) {
  const st = {
    mode: "turbo", layouts: new Map(), layoutLoading: new Set(), asked: new Map(), noRef: new Set(),
    prevThumb: null, tracks: [], frameNo: 0, canvas: null, ctx: null, needAt: 0, busy: false,
    grid: null, gridAt: 0, gridFor: "", slotCursor: 0, slotLast: new Map(), small: null, slotCv: null,
  };
  const offscreen = (() => { try { return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d"); } catch { return false; } })();

  /** Kein Set-Lock und kein Farb-Vorfilter: es wird IMMER der komplette Katalog durchsucht (Farbe prüft evaluate je Kandidat). */
  const rowsForSet = () => null;

  // ------------------------------------------------------------------ Mehrfach-Fingerabdrücke (dauerhaft in IndexedDB)
  /**
   * Je Karte: Farb-Layout (4 × 6) + HSV-Farbmatrix und Kantengradient des Artworks – aus dem vorhandenen Kartenbild
   * berechnet, dauerhaft in IndexedDB gehalten (zweiter Start: ohne Netz in Millisekunden). Meldet den Fortschritt.
   */
  async function loadLayouts(items, setId = "") {
    const want = items.filter((it) => it?.key && it?.url && !st.layouts.has(it.key) && !st.layoutLoading.has(it.key));
    if (!want.length) return 0;
    want.forEach((it) => st.layoutLoading.add(it.key));
    const cached = await idbGetMany("layout", want.map((it) => FP_PREFIX + it.key));
    for (const [k, v] of cached) {
      if (!v || v.length !== FP_LEN) continue;
      const u = v instanceof Uint8Array ? v : new Uint8Array(v);
      st.layouts.set(k.slice(FP_PREFIX.length), unpackFp(u));
    }
    const todo = want.filter((it) => !st.layouts.has(it.key));
    let done = want.length - todo.length;
    const progress = (final = false) => post({ type: "sweep-fp-progress", setId, done, total: want.length, final });
    if (want.length > 8) progress();
    if (todo.length && offscreen && typeof createImageBitmap === "function") {
      let fresh = [];
      let next = 0, lastPost = 0;
      const full = rectQuad({ x0: 0, y0: 0, x1: NORM_W - 1, y1: NORM_H - 1 });
      const one = async () => {
        while (next < todo.length) {
          const it = todo[next++];
          try {
            const res = await fetch(it.url, { credentials: "same-origin" });
            if (!res.ok) continue;
            const bmp = await createImageBitmap(await res.blob());
            // Eigene Zeichenfläche je Bild: mehrere Ladevorgänge laufen verschränkt
            const cv = new OffscreenCanvas(NORM_W, NORM_H);
            const cx = cv.getContext("2d", { willReadFrequently: true });
            cx.drawImage(bmp, 0, 0, NORM_W, NORM_H);
            bmp.close?.();
            const px = cx.getImageData(0, 0, NORM_W, NORM_H).data;
            const card = warpCardRgba(px, NORM_W, NORM_H, full, NORM_W, NORM_H);
            const u = new Uint8Array(FP_LEN);
            u.set(layoutFromRgba(px, NORM_W, NORM_H, full), 0);
            u.set(artVector(card, zmuv(card)), LAYOUT_LEN);
            u.set(paletteVector(card), LAYOUT_LEN + ART_LEN);
            st.layouts.set(it.key, unpackFp(u));
            fresh.push([FP_PREFIX + it.key, u]); done++;
            if (fresh.length >= 40) { idbSetMany("layout", fresh).catch(() => {}); fresh = []; }
            if (want.length > 8 && Date.now() - lastPost > 250) { lastPost = Date.now(); progress(); }
          } catch { /* Bild fehlt/gesperrt → Karte bleibt beim reinen Bild-Fingerabdruck */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, todo.length) }, one));
      if (fresh.length) idbSetMany("layout", fresh).catch(() => {});
    }
    // Bild fehlt/gesperrt bzw. ohne OffscreenCanvas → keine Farb-Referenz möglich (strengerer Rückfall statt ewig warten)
    want.forEach((it) => { st.layoutLoading.delete(it.key); if (!st.layouts.has(it.key)) st.noRef.add(it.key); });
    if (want.length > 8) progress(true);
    return done;
  }

  /** Vektoren eines Treffers – gleiches Motiv in anderer Sprache darf sie mitbenutzen. */
  const layoutOf = (keys) => { for (const k of keys) { const v = st.layouts.get(k); if (v) return v; } return null; };

  /** Für Kandidaten ohne Farb-Referenz den Haupt-Thread nach Bildadressen fragen (gedrosselt, je Karte einmal). */
  function askLayouts(keys) {
    const now = Date.now();
    const fresh = keys.filter((k) => k && !st.asked.has(k) && !st.layouts.has(k) && !st.noRef.has(k));
    if (!fresh.length || now - st.needAt < 120) return;
    st.needAt = now;
    fresh.slice(0, 4).forEach((k) => st.asked.set(k, now));
    post({ type: "sweep-need-layout", keys: fresh.slice(0, 4) });
  }

  /**
   * Farb-Referenz eines Motivs (alle Sprach-Schlüssel derselben Karte):
   *   { ref } – liegt vor · "pending" – wird gerade geladen (Kandidat wartet, lieber 1 Bild länger) · "none" – nicht ladbar
   */
  function refState(keys) {
    const ref = layoutOf(keys);
    if (ref) return { ref };
    if (!offscreen || keys.every((k) => st.noRef.has(k))) return "none";
    const now = Date.now();
    const asked = keys.map((k) => st.asked.get(k)).filter(Boolean);
    if (asked.length && now - Math.min(...asked) > REF_WAIT_MS && !keys.some((k) => st.layoutLoading.has(k))) return "none";
    return "pending";
  }

  // ------------------------------------------------------------------ Ein Live-Bild
  function readFrame(msg) {
    if (msg.bitmap) {
      const { w, h } = msg;
      if (!st.canvas || st.canvas.width !== w || st.canvas.height !== h) { st.canvas = new OffscreenCanvas(w, h); st.ctx = st.canvas.getContext("2d", { willReadFrequently: true }); }
      st.ctx.drawImage(msg.bitmap, 0, 0, w, h);
      msg.bitmap.close?.();
      return { rgba: st.ctx.getImageData(0, 0, w, h).data, w, h };
    }
    return { rgba: new Uint8ClampedArray(msg.data), w: msg.w, h: msg.h };
  }

  /**
   * Nummern-ROI-Verifikation: Sammlernummer unten links/rechts aus dem Kamerabild lesen und mit der Index-Zeile vergleichen.
   * true = passt · false = gelesen, aber eine andere Nummer · null = nicht lesbar (zu klein / keine Vorlagen / nichts erkannt)
   */
  function verifyNumber(rgba, w, h, quad, idx, row) {
    const glyphs = getGlyphs();
    if (!glyphs || !glyphs.length || row < 0) return null;
    const want = idx.localNum[row], total = idx.total[row];
    if (!(want >= 0)) return null;
    const H = homography(quad);
    for (const box of NUMBER_STRIPS) {
      const q = [project(H, box.u0, box.v0), project(H, box.u1, box.v0), project(H, box.u1, box.v1), project(H, box.u0, box.v1)];
      const widthPx = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
      if (widthPx < NUMBER_MIN_PX) return null;
      const strip = prepareStrip(warpGrayRgba(rgba, w, h, q, STRIP_W, STRIP_H));
      const r = readNumber(strip, glyphs);
      if (r && r.conf >= 0.5) return r.num === want && (total <= 0 || r.total <= 0 || r.total === total);
    }
    return null;
  }

  /**
   * Eine Kandidaten-Lage auswerten:
   *   begradigen → Folien-Reflexe (Luminanz > 238, kaum Sättigung) maskieren & herausrechnen → Helligkeit/Kontrast normalisieren
   *   → 64-Bit pHash + 64-Bit dHash des inneren Artworks (+ Karten-pHash) per XOR-Popcount gegen den KOMPLETTEN Katalog
   *   → PFLICHT-FARBABGLEICH: dominante Kartenfarbe / HSV-Farbverteilung (Artwork + Rahmen) gegen das Katalogbild des
   *     Kandidaten. Falsche Grundfarbe → Kandidat sofort verworfen, das nächstbeste Motiv rückt nach (bis COLOR_RERANK).
   *     Fehlt die Farb-Referenz noch, wird sie geladen und der Kandidat wartet (colorPending) – kein Treffer ohne Farbprüfung.
   *   → Übereinstimmung (inkl. Farb-Übereinstimmung) + Abstand zum zweitbesten Motiv (Schwelle: Stapel-Gate, siehe quickOk).
   */
  function evaluate(rgba, w, h, quad, idx, rows, withNumber) {
    const card = warpCardRgba(rgba, w, h, quad, NORM_W, NORM_H);
    const glare = card.glareRatio;
    const gg = glare > 0.004 ? glareGray(card) : null;
    const mask = gg ? glareMask(gg) : null;
    const norm = zmuv(gg ? suppressGlare(gg) : card);
    const probe = cardHashes(norm);
    const meta = { localNum: (i) => idx.localNum[i], total: (i) => idx.total[i] };
    let matches = topMatchesIn(probe, idx.words, rows, idx.count, 12, mask);
    if (!matches.length) return null;
    const pal = paletteVector(card);
    let layoutProbe = null, artProbe = null;
    const groupKeys = (d) => { const seen = new Set(); return d.group.map((i) => idx.keys[i]).filter((k) => (seen.has(k) ? false : seen.add(k))); };
    // Kandidaten der Reihe nach: verwirft der Farbabgleich das beste Motiv, rückt das nächste nach
    let d = null, keys = null, rs = null, cc = null, rejected = 0, rejectedKey = "";
    for (let t = 0; t < COLOR_RERANK && matches.length; t++) {
      d = decide(matches, idx.words, meta, null);
      keys = groupKeys(d);
      rs = refState(keys);
      cc = rs?.ref ? paletteCheck(pal, rs.ref.pal) : null;
      if (!cc?.reject) break;
      rejected++; rejectedKey ||= keys[0];
      const drop = new Set(d.group);
      matches = matches.filter((m) => !drop.has(m.i));
      if (!matches.length) { d = null; break; }
    }
    if (!d) return null;
    const lead = idx.keys[d.best];
    const ref = rs?.ref || null;
    const hs = hashSimilarity(d.score);
    if (ref) { layoutProbe = layoutFromRgba(rgba, w, h, quad); artProbe = artVector(card, norm); }
    const ls = ref ? layoutSimilarity(layoutProbe, ref.layout) : null;
    const as = ref ? artSimilarity(artProbe, ref.art) : null;
    // Übereinstimmung inkl. Farbe: Zusatz-Vektoren heben eine sichere Karte an; eine schwache Farb-Übereinstimmung zieht ab
    let match = Math.max(hs, fuseMatch(d.score, { layout: ls, hsv: as?.hsv, edge: as?.edge, color: cc?.sim }));
    if (cc && cc.sim < 0.55) match -= (0.55 - cc.sim) * 0.5;
    match = Math.max(0, match);
    const colorPending = rs === "pending";
    // Farb-Referenzen der aussichtsreichen Kandidaten sofort nachladen (Pflicht für die Freigabe)
    if (!ref && hs > 0.5) askLayouts([lead, ...keys.slice(1, 2), ...matches.slice(1, 3).map((m) => idx.keys[m.i])]);
    else if (cc?.reject === false && hs > 0.5) askLayouts(matches.slice(1, 3).map((m) => idx.keys[m.i]));
    // Nummern-ROI nur für aussichtsreiche Kandidaten (spart Zeit bei klaren Nicht-Treffern)
    let numOk = null;
    if (withNumber && match >= SWEEP.MIN_MATCH - 0.06) { try { numOk = verifyNumber(rgba, w, h, quad, idx, d.best); } catch { numOk = null; } }
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const det = {
      quad, keys, lead, match: r3(match), hash: r3(hs),
      layout: ls === null ? null : r3(ls), hsv: as ? r3(as.hsv) : null, edge: as ? r3(as.edge) : null,
      // Farbabgleich: Übereinstimmung 0…1, "none" = keine Referenz ladbar (strengerer Rückfall), verworfene Motive
      color: cc ? r3(cc.sim) : colorPending ? null : "none", hueDist: cc?.hueDist ?? null, colorPending, colorRejected: rejected,
      ...(cc?.reject ? { colorReject: true } : {}), ...(rejectedKey ? { rejectedKey } : {}),
      sharp: cardSharpness(norm),
      score: d.score, margin: d.margin, glare: glare > GLARE_HIGH, glareRatio: r3(glare), numOk,
      label: labelOf(keys[0]) || "",
      probe: { artP: wordsToHex(probe[0], probe[1]), artD: wordsToHex(probe[2], probe[3]), fullP: wordsToHex(probe[4], probe[5]) },
    };
    det.conf = confidencePercent(det);
    return det;
  }

  // ------------------------------------------------------------------ Ordner-Seite: 3 × 3 / 2 × 2 Fächer aus dem HD-Bild
  /**
   * Bildquelle des Ordner-Modus. Mit ImageBitmap (natives HD-Bild): kleines Analysebild für Raster/Bewegung, jedes Fach
   * wird einzeln hochauflösend aus dem Original geschnitten. Ohne OffscreenCanvas: Pixel-Puffer des ganzen Bilds.
   */
  function openSource(msg) {
    const W = msg.w, H = msg.h;
    const sw = Math.min(SWEEP.DETECT_W, W), k = W / sw, sh = Math.max(8, Math.round(H / k));
    if (msg.bitmap) {
      if (!st.small || st.small.width !== sw || st.small.height !== sh) { st.small = new OffscreenCanvas(sw, sh); st.smallCtx = st.small.getContext("2d", { willReadFrequently: true }); }
      st.smallCtx.drawImage(msg.bitmap, 0, 0, sw, sh);
      const px = st.smallCtx.getImageData(0, 0, sw, sh).data;
      if (!st.slotCv) { st.slotCv = new OffscreenCanvas(HD.SLOT_W, HD.SLOT_H); st.slotCtx = st.slotCv.getContext("2d", { willReadFrequently: true }); }
      return {
        W, H, k, small: grayDown(px, sw, sh, sw, sh),
        /** Fach (Rechteck im Analysebild) hochauflösend aus dem nativen Bild schneiden → { rgba, w, h, map(pt), unmap(pt) } */
        region(box) {
          const x0 = Math.max(0, Math.floor(box.x0 * k)), y0 = Math.max(0, Math.floor(box.y0 * k));
          const x1 = Math.min(W, Math.ceil(box.x1 * k)), y1 = Math.min(H, Math.ceil(box.y1 * k));
          const bw = Math.max(2, x1 - x0), bh = Math.max(2, y1 - y0);
          st.slotCtx.drawImage(msg.bitmap, x0, y0, bw, bh, 0, 0, HD.SLOT_W, HD.SLOT_H);
          const fx = HD.SLOT_W / bw, fy = HD.SLOT_H / bh;
          return {
            rgba: st.slotCtx.getImageData(0, 0, HD.SLOT_W, HD.SLOT_H).data, w: HD.SLOT_W, h: HD.SLOT_H,
            map: ([x, y]) => [(x * k - x0) * fx, (y * k - y0) * fy], unmap: ([x, y]) => [(x / fx + x0) / k, (y / fy + y0) / k],
          };
        },
        close() { msg.bitmap.close?.(); },
      };
    }
    const rgba = new Uint8ClampedArray(msg.data);
    return {
      W, H, k, small: grayDown(rgba, W, H, sw, sh),
      region(box) {
        const x0 = Math.max(0, Math.floor(box.x0 * k)), y0 = Math.max(0, Math.floor(box.y0 * k));
        const x1 = Math.min(W, Math.ceil(box.x1 * k)), y1 = Math.min(H, Math.ceil(box.y1 * k));
        const bw = Math.max(2, x1 - x0), bh = Math.max(2, y1 - y0);
        const fx = HD.SLOT_W / bw, fy = HD.SLOT_H / bh;
        return {
          rgba: cropRgba(rgba, W, H, x0, y0, bw, bh, HD.SLOT_W, HD.SLOT_H), w: HD.SLOT_W, h: HD.SLOT_H,
          map: ([x, y]) => [(x * k - x0) * fx, (y * k - y0) * fy], unmap: ([x, y]) => [(x / fx + x0) / k, (y / fy + y0) / k],
        };
      },
      close() {},
    };
  }

  function binderFrame(msg) {
    const t0 = performance.now();
    const pr = PROFILE.binder;
    const lay = GRID_LAYOUTS[msg.grid] || GRID_LAYOUTS["3x3"];
    const src = openSource(msg);
    try {
      const small = src.small, sw = small.w, sh = small.h;
      const idx = getIdx();
      const grad = sobel(small);
      const thumb = frameThumb(small);
      const mo = motionStats(st.prevThumb, thumb);
      st.prevThumb = thumb;
      st.frameNo++;
      const now = Date.now();
      // Raster an die Ordnerseite anpassen (Linienmuster der Folie); ohne klares Muster: letztes bzw. mittiges Raster
      const tag = `${msg.grid}|${sw}x${sh}`;
      if (st.gridFor !== tag || mo.changed >= HD.FLIP_AREA) { st.grid = null; st.gridFor = tag; st.slotLast.clear(); }
      // (ruhiges Bild mit sitzendem Raster: nur jedes 5. Bild neu anpassen – spart Rechenzeit für die Fächer)
      let fit = null;
      const refit = !st.grid?.fitted || mo.motion > 0.012 || st.frameNo % 5 === 0;
      if (refit) {
        fit = fitGrid(edgeLines(grad, sw, sh), sw, sh, lay.cols, lay.rows, { sharp: edgeLines(grad, sw, sh, 0) });
        if (fit) { st.grid = smoothGrid(st.grid?.fitted ? st.grid : null, fit); st.gridAt = now; }
        else if (!st.grid || now - st.gridAt > 1200) st.grid = defaultGrid(sw, sh, lay.cols, lay.rows);
      } else st.gridAt = now;
      const tDetect = performance.now();
      const slots = gridSlots(st.grid, lay.cols, lay.rows);
      const skip = new Set(Array.isArray(msg.skip) ? msg.skip : []);
      const ready = idx.count > 0;
      const rows = ready ? rowsForSet() : null;
      const out = [];
      let glareSum = 0, glareN = 0, n = 0;
      if (ready && !(rows && !rows.length)) {
        // Offene Fächer reihum (jedes kommt dran, auch wenn das Zeitbudget nicht für alle 9 je Bild reicht)
        const open = slots.filter((s) => !skip.has(s.slot));
        const start = open.length ? st.slotCursor % open.length : 0;
        for (let j = 0; j < open.length; j++) {
          if (n >= pr.maxEval || (n >= pr.minEval && performance.now() - t0 > pr.budgetMs)) break;
          const s = open[(start + j) % open.length];
          n++;
          const padX = (s.box.x1 - s.box.x0) * 0.03, padY = (s.box.y1 - s.box.y0) * 0.03;
          const reg = src.region({ x0: s.box.x0 - padX, y0: s.box.y0 - padY, x1: s.box.x1 + padX, y1: s.box.y1 + padY });
          // Kartenkanten im HD-Ausschnitt pixelgenau nachziehen; reicht das nicht, zählt die Fach-Lage aus dem Raster
          const q0 = s.quad.map(reg.map);
          const half = grayDown(reg.rgba, reg.w, reg.h, reg.w >> 1, reg.h >> 1);
          const pr2 = polishRect(half, { x0: q0[0][0] / 2, y0: q0[0][1] / 2, x1: q0[2][0] / 2, y1: q0[2][1] / 2 });
          const q1 = [[pr2.x0 * 2, pr2.y0 * 2], [pr2.x1 * 2, pr2.y0 * 2], [pr2.x1 * 2, pr2.y1 * 2], [pr2.x0 * 2, pr2.y1 * 2]];
          let best = null, bestQuad = s.quad;
          for (const q of [q1, q0]) {
            const r = evaluate(reg.rgba, reg.w, reg.h, q, idx, rows, false);
            // Farblich verworfene Kandidaten verlieren immer gegen eine farblich passende Lage
            const rank = (x) => (x.colorReject ? x.match - 1 : x.match);
            if (r && (!best || rank(r) > rank(best))) { best = r; bestQuad = q.map(reg.unmap); }
            if (best && !best.colorReject && best.match >= SWEEP.MIN_MATCH) break;
          }
          if (best) {
            glareSum += best.glareRatio || 0; glareN++;
            const d = { ...best, slot: s.slot, row: s.row, col: s.col, quad: bestQuad.map(([x, y]) => [x / sw, y / sh]) };
            st.slotLast.set(s.slot, d);
            out.push(d);
          } else st.slotLast.delete(s.slot);
        }
        st.slotCursor = start + n;
      }
      return {
        type: "sweep-result", seq: msg.seq, w: src.W, h: src.H, mode: "binder", ms: Math.round((performance.now() - t0) * 10) / 10, msDetect: Math.round((tDetect - t0) * 10) / 10,
        motion: Math.round(mo.motion * 1000) / 1000, center: Math.round(mo.center * 1000) / 1000, changed: Math.round(mo.changed * 1000) / 1000,
        light: Math.round(thumb.mean), ready, setRows: rows ? rows.length : -1, found: Boolean(st.grid.fitted) || out.length > 0,
        glare: glareN ? Math.round((glareSum / glareN) * 1000) / 1000 : 0,
        grid: { x0: st.grid.x0 / sw, y0: st.grid.y0 / sh, x1: st.grid.x1 / sw, y1: st.grid.y1 / sh, cols: lay.cols, rows: lay.rows, fitted: Boolean(st.grid.fitted), score: Math.round((st.grid.score || 0) * 100) / 100 },
        // Lage aller Fächer (0…1) – der Haupt-Thread zeichnet daraus Raster, grüne Haken und Preis-Badges
        cells: slots.map((s) => ({ slot: s.slot, quad: s.quad.map(([x, y]) => [x / sw, y / sh]) })),
        slots: out,
      };
    } finally { src.close(); }
  }

  /**
   * Stapel / Einzelkarte – ein Live-Bild (Ziel < 25 ms):
   *   1) Karten-Silhouetten (Kanten) suchen bzw. zuletzt gefundene Karten verfolgen – höchstens 2 Kandidaten
   *   2) Multi-Crop: drei mittige Ausschnitte (88 / 72 / 55 %) + reihum leichte Verschiebung/Neigung. Jeder Ausschnitt
   *      wird, wenn möglich, an die Kartenkanten angelegt (detectCard), sonst direkt gehasht – so wird eine Karte auch
   *      in der Hülle, vor unruhigem Hintergrund oder in der Hand erkannt, wenn keine saubere Kontur zu finden ist.
   *   3) Ergebnisse derselben Karte zusammenführen (eine Karte = eine Erkennung → nie doppelt gezählt).
   */
  function frame(msg) {
    const t0 = performance.now();
    const pr = PROFILE.turbo;
    const { rgba, w, h } = readFrame(msg);
    const idx = getIdx();
    const sw = Math.min(SWEEP.DETECT_W, w), k = w / sw, sh = Math.round(h / k);
    const small = grayDown(rgba, w, h, sw, sh);
    const grad = sobel(small);
    const thumb = frameThumb(small);
    const mo = motionStats(st.prevThumb, thumb);
    const motion = mo.motion;
    st.prevThumb = thumb;
    st.frameNo++;
    const now = Date.now();
    // 1) Verfolgen: zuletzt gefundene Karten an ihrer alten Position verfeinern
    st.tracks = st.tracks.filter((t) => now - t.at < pr.trackMs);
    const rot = st.tracks.length ? st.frameNo % st.tracks.length : 0;
    const tracked = [];
    st.tracks.forEach((t, i) => {
      const det = detectCard(small, quadBox(t.quad, 0.04), grad);
      if (det.found) tracked.push({ quad: det.corners, conf: det.confidence, tracked: true, order: (i - rot + st.tracks.length) % st.tracks.length, track: t });
    });
    tracked.sort((a, b) => a.order - b.order);
    // Globale Silhouetten-Suche (ohne verfolgte Karte jedes Bild, sonst jedes 2.)
    const fresh = [];
    if (!tracked.length || st.frameNo % pr.globalEvery === 0) {
      const rects = findCardRects(grad, small.w, small.h, { max: pr.maxRects });
      for (const r of rects) {
        if (tracked.some((c) => rectIou(quadBox(c.quad), r) > 0.4) || fresh.some((c) => rectIou(quadBox(c.quad), r) > 0.4)) continue;
        const det = detectCard(small, r, grad);
        if (det.found) fresh.push({ quad: det.corners, conf: det.confidence });
        if (fresh.length >= pr.maxEval || performance.now() - t0 > 7) break;
      }
    }
    const cands = [...fresh, ...tracked].slice(0, pr.maxEval);
    const tDetect = performance.now();
    const dets = [];
    const ready = idx.count > 0;
    const rows = null; // immer der komplette Katalog
    const evaluated = new Set();
    let best = 0;
    if (ready) {
      for (const c of cands) {
        if (dets.length >= pr.minEval && performance.now() - t0 > pr.budgetMs) break;
        const r = evaluate(rgba, w, h, c.quad.map(([x, y]) => [x * k, y * k]), idx, rows, false);
        evaluated.add(c);
        if (r) { dets.push({ ...r, small: c.quad }); if (!r.colorReject) best = Math.max(best, r.match); }
      }
      // 2) Multi-Crop – auch wenn eine Kontur gefunden wurde (sie kann ein Teil der Hülle/des Tischs sein)
      let cropBest = null;
      for (const cr of cropQuads(sw, sh, st.frameNo)) {
        if (best >= SWEEP.MIN_MATCH + 0.06 || (cropBest && performance.now() - t0 > pr.budgetMs)) break;
        // An die Kartenkanten anlegen, wenn sie im Ausschnitt zu sehen sind – sonst den Ausschnitt selbst hashen
        const det = detectCard(small, cr.box, grad);
        for (const q of det.found ? [det.corners, cr.quad] : [cr.quad]) {
          const r = evaluate(rgba, w, h, q.map(([x, y]) => [x * k, y * k]), idx, rows, false);
          if (r && !r.colorReject && (!cropBest || r.match > cropBest.match)) cropBest = { ...r, small: q, crop: true };
          if (r && !r.colorReject) best = Math.max(best, r.match);
          if (cropBest && cropBest.match >= SWEEP.MIN_MATCH) break;
          if (performance.now() - t0 > pr.budgetMs) break;
        }
      }
      // 3) Zusammenführen: dieselbe Karte aus Kontur und Ausschnitt = EINE Erkennung (bessere Übereinstimmung, Kontur-Lage)
      if (cropBest) {
        const same = dets.find((d) => keyOverlap(d.keys, cropBest.keys));
        if (!same) dets.push(cropBest);
        else if (cropBest.match > same.match) Object.assign(same, { ...cropBest, quad: same.quad, small: same.small, crop: false });
      }
    }
    // Verfolgte Karten, die in diesem Bild nicht neu ausgewertet wurden, mit ihrem letzten Ergebnis weitertragen
    for (const c of tracked) {
      if (evaluated.has(c) || !c.track.last) continue;
      if (dets.some((d) => keyOverlap(d.keys, c.track.last.keys))) continue;
      const q = c.quad.map(([x, y]) => [x * k, y * k]);
      dets.push({ ...c.track.last, quad: q, small: c.quad, carried: true });
    }
    // Verfolgung nur für sichere Kanten (keine reinen Ausschnitte)
    st.tracks = dets.filter((d) => !d.crop).map((d) => ({ quad: d.small, at: d.carried ? d.at || now : now, last: d.match >= SWEEP.TRACK_MATCH && !d.colorReject && !d.colorPending ? { ...d, small: undefined, carried: undefined, at: now } : null }))
      .concat(cands.filter((c) => !dets.some((d) => d.small === c.quad)).map((c) => ({ quad: c.quad, at: now, last: null })))
      .slice(0, pr.maxRects);
    dets.sort((a, b) => b.match - a.match);
    const found = cands.length > 0 || dets.some((d) => d.match >= SWEEP.TRACK_MATCH && !d.colorReject);
    return {
      type: "sweep-result", seq: msg.seq, w, h, ms: Math.round((performance.now() - t0) * 10) / 10, msDetect: Math.round((tDetect - t0) * 10) / 10,
      motion: Math.round(motion * 1000) / 1000, center: Math.round(mo.center * 1000) / 1000, changed: Math.round(mo.changed * 1000) / 1000,
      light: Math.round(thumb.mean), found, ready, setRows: -1, mode: "turbo",
      // Live-Diagnose: beste Übereinstimmung dieses Bilds (auch unter der Schwelle)
      top: Math.round(best * 1000) / 1000,
      glare: dets.length ? Math.round((dets.reduce((s, d) => s + (d.glareRatio || 0), 0) / dets.length) * 1000) / 1000 : 0,
      dets: dets.map((d) => ({ ...d, small: undefined, at: undefined, quad: d.quad.map(([x, y]) => [x / w, y / h]) })),
      // Anker-Miniatur für die Karten-Sperre im Haupt-Thread (Bildveränderung gegenüber dem Treffer-Bild)
      thumb: anchorThumb(small),
      boxes: cands.map((c) => c.quad.map(([x, y]) => [(x * k) / w, (y * k) / h])),
    };
  }

  return {
    offscreen,
    /** true = Nachricht wurde verarbeitet */
    async handle(msg) {
      if (msg.type === "sweep-config") {
        const t0 = performance.now();
        // Set-Lock gibt es nicht mehr – es wird immer der ganze Katalog durchsucht (setId wird ignoriert)
        if (typeof msg.mode === "string") st.mode = msg.mode === "binder" ? "binder" : "turbo";
        st.tracks = []; st.slotLast.clear();
        post({ type: "sweep-config-done", setId: "", mode: st.mode, rows: getIdx().count, ms: Math.round(performance.now() - t0) });
        return true;
      }
      if (msg.type === "sweep-layouts") {
        const items = Array.isArray(msg.items) ? msg.items.slice(0, 700) : [];
        // Karten ohne Bild: keine Farb-Referenz möglich → strengerer Rückfall statt zu warten
        if (Array.isArray(msg.missing)) for (const k of msg.missing.slice(0, 20)) if (typeof k === "string" && !st.layouts.has(k)) st.noRef.add(k);
        const n = await loadLayouts(items, msg.setId || "");
        post({ type: "sweep-layouts-done", requested: items.length, ready: n, total: st.layouts.size, setId: msg.setId || "" });
        return true;
      }
      if (msg.type === "sweep-frame") {
        // Gegendruck: nie zwei Bilder gleichzeitig – das Flag wird in JEDEM Fall (auch bei Fehlern) per finally zurückgesetzt
        if (st.busy) { msg.bitmap?.close?.(); post({ type: "sweep-result", seq: msg.seq, skipped: true }); return true; }
        st.busy = true;
        try { post(msg.mode === "binder" ? binderFrame(msg) : frame(msg)); }
        catch (err) { post({ type: "sweep-result", seq: msg.seq, error: String(err?.message || err) }); }
        finally { st.busy = false; }
        return true;
      }
      if (msg.type === "sweep-reset") { st.tracks = []; st.prevThumb = null; st.grid = null; st.slotLast.clear(); return true; }
      return false;
    },
  };
}
