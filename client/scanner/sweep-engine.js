// PokeSwipe & Radar – High-End-Scanner-Engine (läuft im Scanner-Web-Worker, teilt sich den Karten-Index mit der
// Foto-Erkennung). Zwei Wege je Live-Bild:
//   • Ordner-Seite (binderFrame): natives HD-Bild → 3 × 3- bzw. 2 × 2-Raster an das Linienmuster der Folie anpassen →
//     jedes Fach hochauflösend ausschneiden → Anti-Glare → Fingerabdruck → Treffer je Fach (Slot).
//   • Stapel / Einzelkarte (frame), ~480 px breit, bis zu 30 Bilder/s – 4-Stufen-Pipeline:
//     1) Präsenz- & Ruhe-Gate (cardPresence): genau EIN klares Karten-Rechteck (1 : 1,25 … 1 : 1,55, 20 … 88 % des Bilds),
//        scharf, nicht dunkel/einfarbig – sonst Standby: KEIN Abgleich, KEIN Treffer (Tisch, Sofa, 4 Karten, abgelegtes Handy)
//     2) unsichtbare Perspektiv-Begradigung über die 4 Ecken (Homographie), 3 % Rand ab (Sleeve/Ordner/Tisch), Folien-
//        Reflexe maskiert; auf Anfrage das Standardbild 300 × 420 px (Name+Nummer-OCR / Vision-Rückfall im Haupt-Thread)
//     3) pHash/dHash von Karte + Artwork gegen den KOMPLETTEN Katalog, Sammlernummer unten links/rechts lesen und die
//        Kandidaten danach filtern (Nummer + Artwork = verified), Grundfarbe darf nicht widersprechen
//     4) Entscheidung + physische Karten-Sperre im Haupt-Thread (createSweepGate)
// Kein Bild verlässt das Gerät (außer dem optionalen Vision-Rückfall, den der Haupt-Thread steuert); keine KI im Worker.
import {
  sobel, cardHashes, suppressGlare, glareMask, decide, wordsToHex, GLARE_HIGH, NORM_W, NORM_H,
  NUMBER_STRIPS, homography, project, prepareStrip, readNumber,
} from "../../server/scan-logic.ts";
import {
  SWEEP, edgeLines, rectQuad, frameThumb, motionStats, layoutFromRgba, layoutSimilarity,
  hashSimilarity, topMatchesIn, grayDown, warpGrayRgba, LAYOUT_LEN, confidencePercent, anchorThumb, cardPresence, insetQuad,
} from "./sweep-logic.js";
import {
  HD, warpCardRgba, glareGray, zmuv, artVector, artSimilarity, fuseMatch, ART_LEN, paletteVector, paletteCheck, PAL_LEN, cardSharpness,
  GRID_LAYOUTS, defaultGrid, fitGrid, gridSlots, smoothGrid, polishRect, cropRgba,
} from "./hd-scan-logic.js";
import { idbGetMany, idbSetMany } from "./idb-cache.js";

/** Modus-Profile: Stapel / Einzelkarte (schnellstmöglich) · Ordner-Seite (bis zu 9 Fächer je Bild, Zeitbudget < 50 ms) */
const PROFILE = {
  turbo: { budgetMs: 24 },
  binder: { maxEval: SWEEP.MAX_CARDS, budgetMs: 44, minEval: 3 },
};
/** Schlüssel-Präfix der Mehrfach-Fingerabdrücke im IndexedDB-Store „layout“ (Farb-Layout + HSV-Matrix + Kantengradient + Farbsignatur) */
const FP_PREFIX = "v3:";
const FP_LEN = LAYOUT_LEN + ART_LEN + PAL_LEN;
/** Nach so langer Ladezeit gilt eine Farb-Referenz als „nicht ladbar“ (rein informativ, kein Warten auf Treffer) */
const REF_WAIT_MS = 2500;
/** Farbe: gut passende Farbverteilung gibt höchstens +3 % Bonus; nur eine klar widersprechende Grundfarbe sperrt reine Artwork-Treffer */
const COLOR_TIE = 0.03;
const unpackFp = (u) => ({ layout: u.subarray(0, LAYOUT_LEN), art: u.subarray(LAYOUT_LEN, LAYOUT_LEN + ART_LEN), pal: u.subarray(LAYOUT_LEN + ART_LEN) });

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
   * Sammlernummer (unten links/rechts) auf der begradigten Karte lesen – Ziffern-Vorlagen auf kontrastnormalisiertem
   * Streifen. Liefert { num, total, conf } oder null (zu klein / keine Vorlagen / nichts sicher erkannt).
   */
  function readCardNumber(rgba, w, h, quad) {
    const glyphs = getGlyphs();
    if (!glyphs || !glyphs.length) return null;
    const H = homography(quad);
    for (const box of NUMBER_STRIPS) {
      const q = [project(H, box.u0, box.v0), project(H, box.u1, box.v0), project(H, box.u1, box.v1), project(H, box.u0, box.v1)];
      const widthPx = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
      if (widthPx < NUMBER_MIN_PX) return null;
      const strip = prepareStrip(warpGrayRgba(rgba, w, h, q, STRIP_W, STRIP_H));
      const r = readNumber(strip, glyphs);
      if (r && r.conf >= 0.5 && r.num >= 0) return r;
    }
    return null;
  }

  /**
   * Eine Kandidaten-Lage auswerten:
   *   begradigen → Folien-Reflexe (Luminanz > 238, kaum Sättigung) maskieren & herausrechnen → Helligkeit/Kontrast normalisieren
   *   → 64-Bit pHash + 64-Bit dHash des inneren Artworks (+ Karten-pHash) per XOR-Popcount gegen den KOMPLETTEN Katalog
   *   → Farbe (HSV-Verteilung Kamera ↔ Katalogbild) nur als Tie-Breaker: bis +3 % Bonus, nie Abzug, nie Ausschluss,
   *     kein Warten auf die Farb-Referenz.
   *   → Übereinstimmung (inkl. Farb-Übereinstimmung) + Abstand zum zweitbesten Motiv (Schwelle: Stapel-Gate, siehe quickOk).
   */
  function evaluate(rgba, w, h, quad, idx, rows, withNumber, numQuad = quad) {
    const card = warpCardRgba(rgba, w, h, quad, NORM_W, NORM_H);
    const glare = card.glareRatio;
    // Deckenlicht-/Folien-Reflexe (sehr hell, kaum Sättigung) maskieren und aus dem Fingerabdruck herausrechnen
    const gg = glare > 0.004 ? glareGray(card) : null;
    const mask = gg ? glareMask(gg) : null;
    const norm = zmuv(gg ? suppressGlare(gg) : card);
    const probe = cardHashes(norm);
    const meta = { localNum: (i) => idx.localNum[i], total: (i) => idx.total[i] };
    let matches = topMatchesIn(probe, idx.words, rows, idx.count, withNumber ? 24 : 12, mask);
    if (!matches.length) return null;
    const pal = paletteVector(card);
    let layoutProbe = null, artProbe = null;
    const groupKeys = (d) => { const seen = new Set(); return d.group.map((i) => idx.keys[i]).filter((k) => (seen.has(k) ? false : seen.add(k))); };
    // Stufe 3 A: Sammlernummer lesen und die Kandidaten der Bild-Suche danach filtern (decide wählt den Kandidaten mit
    // passender Nummer + Gesamtzahl, sofern sein Artwork-Abstand ≤ SCORE_WITH_NUMBER ist)
    let num = null;
    if (withNumber) { try { num = readCardNumber(rgba, w, h, numQuad); } catch { num = null; } }
    const d = decide(matches, idx.words, meta, num);
    if (!d) return null;
    const keys = groupKeys(d);
    const rs = refState(keys);
    const cc = rs?.ref ? paletteCheck(pal, rs.ref.pal) : null;
    const lead = idx.keys[d.best];
    const ref = rs?.ref || null;
    const hs = hashSimilarity(d.score);
    if (ref) { layoutProbe = layoutFromRgba(rgba, w, h, quad); artProbe = artVector(card, norm); }
    const ls = ref ? layoutSimilarity(layoutProbe, ref.layout) : null;
    const as = ref ? artSimilarity(artProbe, ref.art) : null;
    // Zusatz-Vektoren (Layout/Artwork) heben eine sichere Karte nur an – sie ziehen nie ab
    let match = Math.max(hs, fuseMatch(d.score, { layout: ls, hsv: as?.hsv, edge: as?.edge }));
    // Farbverteilung: gut passende Farbe gibt bis zu +3 %; klar widersprechende Grundfarbe (paletteCheck.reject) sperrt
    if (cc && Number.isFinite(cc.sim)) match += Math.max(0, Math.min(COLOR_TIE, (cc.sim - 0.6) * 0.15));
    match = Math.max(0, Math.min(1, match));
    // Referenzen der aussichtsreichen Kandidaten im Hintergrund nachladen
    if (!ref && hs > 0.5) askLayouts([lead, ...keys.slice(1, 2), ...matches.slice(1, 3).map((m) => idx.keys[m.i])]);
    // Nummer gelesen: passt sie zum gewählten Kandidaten (Nummer + Gesamtzahl)?
    let numOk = null;
    if (num) {
      const want = idx.localNum[d.best], tot = idx.total[d.best];
      if (want >= 0) numOk = num.num === want && (tot <= 0 || num.total <= 0 || num.total === tot);
    }
    const colorReject = Boolean(cc?.reject);
    const colorPending = rs === "pending";
    // Nummer + Gesamtzahl + Artwork übereinstimmend → sicherer Treffer
    const verified = Boolean(d.byNumber && numOk === true && num.total > 0 && hs >= SWEEP.NUM_MATCH - 0.001 && !colorReject);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const det = {
      quad, keys, lead, match: r3(match), hash: r3(hs),
      layout: ls === null ? null : r3(ls), hsv: as ? r3(as.hsv) : null, edge: as ? r3(as.edge) : null,
      color: cc ? r3(cc.sim) : null, hueDist: cc?.hueDist ?? null,
      sharp: cardSharpness(norm),
      score: d.score, margin: d.margin, glare: glare > GLARE_HIGH, glareRatio: r3(glare), numOk, verified,
      number: num ? { num: num.num, total: num.total, conf: r3(num.conf || 0) } : null,
      label: labelOf(keys[0]) || "",
      // Bild-Kandidaten für den Name+Nummer-Abgleich im Text-Index (Haupt-Thread → Worker „text“)
      cands: matches.slice(0, 12).map((m) => ({ key: idx.keys[m.i], score: Math.round(m.score) })),
      probe: { artP: wordsToHex(probe[0], probe[1]), artD: wordsToHex(probe[2], probe[3]), fullP: wordsToHex(probe[4], probe[5]) },
    };
    if (colorReject) det.colorReject = true;
    if (colorPending) det.colorPending = true;
    det.conf = confidencePercent(det);
    return det;
  }

  /** Standardbild 300 × 420 px (RGBA) der begradigten Karte – für Name+Nummer-OCR bzw. Vision-Rückfall im Haupt-Thread. */
  function standardCrop(rgba, w, h, quad) {
    const c = warpCardRgba(rgba, w, h, quad, SWEEP.STD_W, SWEEP.STD_H);
    const out = new Uint8ClampedArray(SWEEP.STD_W * SWEEP.STD_H * 4);
    for (let i = 0, j = 0; i < c.d.length; i++, j += 4) { out[j] = c.rgb[i * 3]; out[j + 1] = c.rgb[i * 3 + 1]; out[j + 2] = c.rgb[i * 3 + 2]; out[j + 3] = 255; }
    return { data: out.buffer, w: SWEEP.STD_W, h: SWEEP.STD_H };
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
            if (r && (!best || r.match > best.match)) { best = r; bestQuad = q.map(reg.unmap); }
            if (best && best.match >= SWEEP.DIRECT_MATCH) break;
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
   * Stapel / Einzelkarte – ein Live-Bild (Ziel < 25 ms), 4-Stufen-Pipeline:
   *   1) Präsenz- & Ruhe-Gate: genau EIN klares Karten-Rechteck im Kartenformat (20 … 88 % des Bilds), scharf, nicht
   *      dunkel/einfarbig. Sonst Standby – es wird gar nicht erst gegen den Katalog abgeglichen (0 Geister-Scans).
   *      Es gibt KEINEN Mittel-Zuschnitt mehr („Multi-Crop“ hat Sofa, Tisch und Ordnerränder gehasht).
   *   2) Begradigen über die 4 Ecken, 3 % Rand ab (Sleeve/Ordner/Tisch); Reflexe maskiert
   *   3) Fingerabdruck + Sammlernummer → Kandidat (verified = Nummer + Artwork). Liegt die begradigte Karte knapp
   *      darunter, wird zusätzlich die ganze Kontur (ohne Rand-Abzug) geprüft und das bessere Ergebnis genommen.
   *   msg.crop = true → zusätzlich das Standardbild 300 × 420 px (RGBA, übertragen) für den OCR-/Vision-Rückfall.
   */
  function frame(msg) {
    const t0 = performance.now();
    const { rgba, w, h } = readFrame(msg);
    const idx = getIdx();
    const sw = Math.min(SWEEP.DETECT_W, w), k = w / sw, sh = Math.round(h / k);
    const small = grayDown(rgba, w, h, sw, sh);
    const grad = sobel(small);
    const thumb = frameThumb(small);
    const mo = motionStats(st.prevThumb, thumb);
    st.prevThumb = thumb;
    st.frameNo++;
    const ready = idx.count > 0;
    // Stufe 1: Karten-Präsenz- & Ruhe-Gate
    const pres = cardPresence(small, grad);
    const tDetect = performance.now();
    const base = {
      type: "sweep-result", seq: msg.seq, w, h, mode: "turbo", setRows: -1, ready,
      motion: Math.round(mo.motion * 1000) / 1000, center: Math.round(mo.center * 1000) / 1000, changed: Math.round(mo.changed * 1000) / 1000,
      light: Math.round(thumb.mean),
      presence: { reason: pres.reason, count: pres.count, area: pres.area ?? null, ratio: pres.ratio ?? null, focus: pres.focus ?? null, mean: pres.mean, std: pres.std },
      // Anker-Miniatur für die physische Karten-Sperre im Haupt-Thread (Bildveränderung gegenüber dem Treffer-Bild)
      thumb: anchorThumb(small),
    };
    const done = (extra) => ({ ...base, ms: Math.round((performance.now() - t0) * 10) / 10, msDetect: Math.round((tDetect - t0) * 10) / 10, ...extra });
    if (!pres.ok || !ready) {
      return done({ found: false, card: false, standby: pres.ok ? "index" : pres.reason, top: 0, glare: 0, dets: [], boxes: [] });
    }
    // Stufe 2: Ecken ins volle Bild, 3 % Rand nach innen (in Karten-Koordinaten, auch bei schräger Karte exakt)
    const outer = pres.quad.map(([x, y]) => [x * k, y * k]);
    const inner = insetQuad(outer, SWEEP.CROP_INSET);
    // Stufe 3: begradigte Karte gegen den kompletten Katalog + Sammlernummer
    let det = evaluate(rgba, w, h, inner, idx, null, true, outer);
    if (det && !det.verified && det.match < SWEEP.MIN_MATCH && performance.now() - t0 < PROFILE.turbo.budgetMs) {
      const alt = evaluate(rgba, w, h, outer, idx, null, !det.number, outer);
      if (alt && (alt.verified || alt.match > det.match)) det = alt;
    }
    const dets = det ? [det] : [];
    let crop = null;
    if (det && msg.crop) { try { crop = standardCrop(rgba, w, h, inner); } catch { crop = null; } }
    return done({
      found: true, card: true, standby: "",
      top: det ? det.match : 0,
      glare: det ? det.glareRatio || 0 : 0,
      dets: dets.map((d) => ({ ...d, quad: d.quad.map(([x, y]) => [x / w, y / h]) })),
      boxes: [outer.map(([x, y]) => [x / w, y / h])],
      ...(crop ? { crop } : {}),
    });
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
        try {
          const r = msg.mode === "binder" ? binderFrame(msg) : frame(msg);
          post(r, r.crop?.data ? [r.crop.data] : []);
        }
        catch (err) { post({ type: "sweep-result", seq: msg.seq, error: String(err?.message || err) }); }
        finally { st.busy = false; }
        return true;
      }
      if (msg.type === "sweep-reset") { st.tracks = []; st.prevThumb = null; st.grid = null; st.slotLast.clear(); return true; }
      return false;
    },
  };
}
