// PokeSwipe & Radar – Zero-Latency Sweep-Engine (läuft im Scanner-Web-Worker, teilt sich den Karten-Index mit der
// Foto-Erkennung). Pro Live-Bild (~480 px breit, bis zu 30 Bilder/s):
//   Graustufen 320 px → Sobel → rahmenlose Karten-Suche (Seitenverhältnis 63:88) bzw. Verfolgen der zuletzt gefundenen
//   Karte → Kanten verfeinern → perspektivisch begradigen → pHash/dHash von Karte + Artwork-Fenster → Hamming-Suche
//   (ganzer Index oder nur das gesperrte Set) → Farb-/Layout-Vektor gegen den IndexedDB-Cache → Übereinstimmung.
// Kein Bild verlässt das Gerät; keine Texterkennung, keine KI.
import {
  sobel, detectCard, cardHashes, glareRatio, suppressGlare, glareMask, decide, wordsToHex, GLARE_HIGH, NORM_W, NORM_H,
} from "../../server/scan-logic.ts";
import {
  SWEEP, findCardRects, rectQuad, quadBox, rectIou, frameThumb, thumbMotion, layoutFromRgba, layoutSimilarity, matchPercent,
  hashSimilarity, topMatchesIn, setIdOfKey, grayDown, warpGrayRgba, LAYOUT_LEN,
} from "./sweep-logic.js";
import { idbGetMany, idbSetMany } from "./idb-cache.js";

/** Höchstens so viele Karten-Kandidaten je Bild prüfen (Ordnerseite: über mehrere Bilder verteilt) */
const MAX_EVAL = 3;
/** Globale Suche nur jedes n-te Bild, solange eine Karte verfolgt wird (spart ~60 % Rechenzeit) */
const GLOBAL_EVERY = 3;
/** Zeitbudget je Bild, danach keine weiteren Kandidaten */
const BUDGET_MS = 26;
const LAYOUT_THUMB_W = 48, LAYOUT_THUMB_H = 67;

/**
 * getIdx(): aktueller Index ({ keys, langs, words, count, localNum, total }) · getVersion(): Zähler, der sich bei jedem
 * Neuladen ändert · labelOf(key): „Glurak ex 199/165“ · post(msg, transfer?)
 */
export function createSweepEngine({ getIdx, getVersion, labelOf, post }) {
  const st = {
    setId: "", rows: null, rowsFor: "", layouts: new Map(), layoutLoading: new Set(), asked: new Set(),
    prevThumb: null, tracks: [], frameNo: 0, canvas: null, ctx: null, needAt: 0,
  };
  const offscreen = (() => { try { return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d"); } catch { return false; } })();

  /** Zeilen des gesperrten Sets (DE-Karten + EN-Drucke mit derselben Set-ID) – einmal je Index-Version. */
  function rowsForSet() {
    if (!st.setId) return null;
    const tag = `${st.setId}|${getVersion()}`;
    if (st.rowsFor === tag) return st.rows;
    const idx = getIdx();
    const out = [];
    for (let i = 0; i < idx.count; i++) if (setIdOfKey(idx.keys[i]) === st.setId) out.push(i);
    st.rows = new Int32Array(out); st.rowsFor = tag;
    return st.rows;
  }

  // ------------------------------------------------------------------ Farb-/Layout-Fingerabdrücke (IndexedDB)
  async function loadLayouts(items) {
    const want = items.filter((it) => it?.key && it?.url && !st.layouts.has(it.key) && !st.layoutLoading.has(it.key));
    if (!want.length) return 0;
    want.forEach((it) => st.layoutLoading.add(it.key));
    const cached = await idbGetMany("layout", want.map((it) => it.key));
    for (const [k, v] of cached) if (v && v.length === LAYOUT_LEN) st.layouts.set(k, v instanceof Uint8Array ? v : new Uint8Array(v));
    const todo = want.filter((it) => !st.layouts.has(it.key));
    let done = want.length - todo.length;
    if (todo.length && offscreen && typeof createImageBitmap === "function") {
      const fresh = [];
      let next = 0;
      const one = async () => {
        while (next < todo.length) {
          const it = todo[next++];
          try {
            const res = await fetch(it.url, { credentials: "same-origin" });
            if (!res.ok) continue;
            const bmp = await createImageBitmap(await res.blob());
            st.canvasL ||= new OffscreenCanvas(LAYOUT_THUMB_W, LAYOUT_THUMB_H);
            const cx = st.canvasL.getContext("2d", { willReadFrequently: true });
            cx.drawImage(bmp, 0, 0, LAYOUT_THUMB_W, LAYOUT_THUMB_H);
            bmp.close?.();
            const px = cx.getImageData(0, 0, LAYOUT_THUMB_W, LAYOUT_THUMB_H).data;
            const v = layoutFromRgba(px, LAYOUT_THUMB_W, LAYOUT_THUMB_H, rectQuad({ x0: 0, y0: 0, x1: LAYOUT_THUMB_W - 1, y1: LAYOUT_THUMB_H - 1 }));
            st.layouts.set(it.key, v); fresh.push([it.key, v]); done++;
          } catch { /* Bild fehlt/gesperrt → Karte bleibt beim reinen Bild-Fingerabdruck */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, todo.length) }, one));
      if (fresh.length) idbSetMany("layout", fresh).catch(() => {});
    }
    want.forEach((it) => st.layoutLoading.delete(it.key));
    return done;
  }

  /** Layout eines Treffers – gleiches Motiv in anderer Sprache darf seinen Vektor mitbenutzen. */
  const layoutOf = (keys) => { for (const k of keys) { const v = st.layouts.get(k); if (v) return v; } return null; };

  /** Für knappe Kandidaten ohne Layout den Haupt-Thread nach Bildadressen fragen (gedrosselt, je Karte einmal). */
  function askLayouts(keys) {
    const now = Date.now();
    const fresh = keys.filter((k) => !st.asked.has(k) && !st.layouts.has(k));
    if (!fresh.length || now - st.needAt < 350) return;
    st.needAt = now;
    fresh.slice(0, 4).forEach((k) => st.asked.add(k));
    post({ type: "sweep-need-layout", keys: fresh.slice(0, 4) });
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

  function evaluate(rgba, w, h, quad, idx, rows) {
    const raw = warpGrayRgba(rgba, w, h, quad, NORM_W, NORM_H);
    const glare = glareRatio(raw);
    const card = glare > 0.004 ? suppressGlare(raw) : raw;
    const mask = glare > 0.004 ? glareMask(raw) : null;
    const probe = cardHashes(card);
    const matches = topMatchesIn(probe, idx.words, rows, idx.count, 10, mask);
    if (!matches.length) return null;
    const d = decide(matches, idx.words, { localNum: (i) => idx.localNum[i], total: (i) => idx.total[i] }, null);
    const seen = new Set();
    const keys = d.group.map((i) => idx.keys[i]).filter((k) => (seen.has(k) ? false : seen.add(k)));
    const lead = idx.keys[d.best];
    const ref = layoutOf(keys);
    const layout = layoutFromRgba(rgba, w, h, quad);
    const ls = ref ? layoutSimilarity(layout, ref) : null;
    let match = matchPercent(d.score, ls);
    // Nur mit klarem Abstand zum nächsten anderen Motiv zählt die Übereinstimmung voll (Reprints, ähnliche Artworks)
    if (d.margin < SWEEP.MARGIN_MIN) match = Math.min(match, SWEEP.MIN_MATCH - 0.01);
    // Knapp unter der Schwelle, Layout fehlt → Referenzbilder der Top-Kandidaten nachladen (nächste Bilder sind genauer)
    if (!ref && hashSimilarity(d.score) > 0.7) askLayouts([lead, ...matches.slice(1, 3).map((m) => idx.keys[m.i])]);
    return {
      quad, keys, lead, match: Math.round(match * 1000) / 1000, hash: Math.round(hashSimilarity(d.score) * 1000) / 1000,
      layout: ls === null ? null : Math.round(ls * 1000) / 1000, score: d.score, margin: d.margin, glare: glare > GLARE_HIGH,
      label: labelOf(keys[0]) || "",
      probe: { artP: wordsToHex(probe[0], probe[1]), artD: wordsToHex(probe[2], probe[3]), fullP: wordsToHex(probe[4], probe[5]) },
    };
  }

  function frame(msg) {
    const t0 = performance.now();
    const { rgba, w, h } = readFrame(msg);
    const idx = getIdx();
    const sw = Math.min(SWEEP.DETECT_W, w), k = w / sw, sh = Math.round(h / k);
    const small = grayDown(rgba, w, h, sw, sh);
    const grad = sobel(small);
    const thumb = frameThumb(small);
    const motion = thumbMotion(st.prevThumb, thumb);
    st.prevThumb = thumb;
    st.frameNo++;
    // 1) Verfolgen: zuletzt gefundene Karten zuerst an ihrer alten Position verfeinern
    const cands = [];
    const now = Date.now();
    st.tracks = st.tracks.filter((t) => now - t.at < 500);
    for (const t of st.tracks) {
      const det = detectCard(small, quadBox(t.quad, 0.04), grad);
      if (det.found) cands.push({ quad: det.corners, conf: det.confidence, tracked: true });
    }
    // 2) Globale Suche: immer ohne verfolgte Karte, sonst jedes GLOBAL_EVERY-te Bild (weitere Karten im Bild finden)
    if (!cands.length || st.frameNo % GLOBAL_EVERY === 0) {
      const rects = findCardRects(grad, small.w, small.h, { max: 4 });
      for (const r of rects) {
        if (cands.some((c) => rectIou(quadBox(c.quad), r) > 0.4)) continue;
        const det = detectCard(small, r, grad);
        cands.push(det.found ? { quad: det.corners, conf: det.confidence } : { quad: rectQuad(r), conf: r.score, coarse: true });
        if (cands.length >= MAX_EVAL + 1 || performance.now() - t0 > BUDGET_MS * 0.5) break;
      }
    }
    const tDetect = performance.now();
    const dets = [];
    const ready = idx.count > 0;
    const rows = ready ? rowsForSet() : null;
    if (ready && !(rows && !rows.length)) {
      for (const c of cands.slice(0, MAX_EVAL)) {
        if (dets.length && performance.now() - t0 > BUDGET_MS) break;
        const r = evaluate(rgba, w, h, c.quad.map(([x, y]) => [x * k, y * k]), idx, rows);
        if (r) dets.push({ ...r, small: c.quad, coarse: Boolean(c.coarse) });
      }
    }
    // Verfolgung nur für sichere Kanten bzw. erkannte Karten weiterführen
    st.tracks = dets.filter((d) => !d.coarse || d.match >= SWEEP.TRACK_MATCH).map((d) => ({ quad: d.small, at: now }))
      .concat(cands.filter((c) => !c.coarse && !dets.some((d) => d.small === c.quad)).map((c) => ({ quad: c.quad, at: now }))).slice(0, 3);
    dets.sort((a, b) => b.match - a.match);
    const found = cands.some((c) => !c.coarse) || dets.some((d) => d.match >= SWEEP.TRACK_MATCH);
    return {
      type: "sweep-result", seq: msg.seq, w, h, ms: Math.round((performance.now() - t0) * 10) / 10, msDetect: Math.round((tDetect - t0) * 10) / 10,
      motion: Math.round(motion * 1000) / 1000, light: Math.round(thumb.mean), found, ready, setRows: rows ? rows.length : -1,
      // Ecken relativ zum Bild (0…1) – der Haupt-Thread zeichnet daraus den Leuchtrahmen
      dets: dets.map((d) => ({ ...d, small: undefined, quad: d.quad.map(([x, y]) => [x / w, y / h]) })),
      boxes: cands.filter((c) => !c.coarse).map((c) => c.quad.map(([x, y]) => [(x * k) / w, (y * k) / h])),
    };
  }

  return {
    offscreen,
    /** true = Nachricht wurde verarbeitet */
    async handle(msg) {
      if (msg.type === "sweep-config") {
        const t0 = performance.now();
        st.setId = typeof msg.setId === "string" ? msg.setId.slice(0, 40) : "";
        st.rowsFor = ""; st.tracks = [];
        const rows = rowsForSet();
        post({ type: "sweep-config-done", setId: st.setId, rows: rows ? rows.length : getIdx().count, ms: Math.round(performance.now() - t0) });
        return true;
      }
      if (msg.type === "sweep-layouts") {
        const items = Array.isArray(msg.items) ? msg.items.slice(0, 700) : [];
        const n = await loadLayouts(items);
        post({ type: "sweep-layouts-done", requested: items.length, ready: n, total: st.layouts.size, setId: msg.setId || "" });
        return true;
      }
      if (msg.type === "sweep-frame") {
        if (st.busy) { msg.bitmap?.close?.(); post({ type: "sweep-result", seq: msg.seq, skipped: true }); return true; }
        st.busy = true;
        try { post(frame(msg)); }
        catch (err) { post({ type: "sweep-result", seq: msg.seq, error: String(err?.message || err) }); }
        finally { st.busy = false; }
        return true;
      }
      if (msg.type === "sweep-reset") { st.tracks = []; st.prevThumb = null; return true; }
      return false;
    },
  };
}
