// PokeSwipe & Radar – Zero-Latency Sweep-Engine (läuft im Scanner-Web-Worker, teilt sich den Karten-Index mit der
// Foto-Erkennung). Pro Live-Bild (~480 px breit, bis zu 30 Bilder/s):
//   Graustufen 320 px → Sobel → rahmenlose Karten-Suche (Seitenverhältnis 63:88) bzw. Verfolgen der zuletzt gefundenen
//   Karten → Kanten verfeinern → perspektivisch begradigen → pHash/dHash von Karte + Artwork-Fenster → Hamming-Suche
//   (ganzer Index oder nur das gesperrte Set) → Farb-/Layout-Vektor gegen den IndexedDB-Cache → Übereinstimmung
//   → Sammlernummer im Nummern-Fenster (ROI) gegenlesen, wenn der Streifen groß genug ist.
// Multi-Card-Fix: NEUE Karten im Bild werden IMMER zuerst ausgewertet (vor den schon verfolgten), verfolgte Karten reihum –
// so kann eine schon erkannte Karte, die im Bild liegen bleibt, nie das Zeitbudget für Karte #2, #3, #4 … verbrauchen.
// Kein Bild verlässt das Gerät; keine KI.
import {
  sobel, detectCard, cardHashes, glareRatio, suppressGlare, glareMask, decide, wordsToHex, GLARE_HIGH, NORM_W, NORM_H,
  NUMBER_STRIPS, homography, project, prepareStrip, readNumber,
} from "../../server/scan-logic.ts";
import {
  SWEEP, findCardRects, rectQuad, quadBox, rectIou, frameThumb, thumbMotion, layoutFromRgba, layoutSimilarity, matchPercent,
  hashSimilarity, topMatchesIn, setIdOfKey, grayDown, warpGrayRgba, LAYOUT_LEN, confidencePercent,
} from "./sweep-logic.js";
import { idbGetMany, idbSetMany } from "./idb-cache.js";

/** Modus-Profile: Stapel-Turbo (Einzelkarten, schnellstmöglich) · Binder- & Tisch-Sweep (viele Karten, strikt) */
const PROFILE = {
  turbo: { maxEval: 3, maxRects: 4, budgetMs: 30, globalEvery: 2, trackMs: 500, minEval: 2 },
  sweep: { maxEval: 6, maxRects: SWEEP.MAX_CARDS, budgetMs: 48, globalEvery: 1, trackMs: 900, minEval: 3 },
};
const LAYOUT_THUMB_W = 48, LAYOUT_THUMB_H = 67;
/** Nummern-Fenster: so breit (Pixel im Kamerabild) muss der Streifen mindestens sein, damit Ziffern lesbar sind */
const NUMBER_MIN_PX = 105;
const STRIP_W = 252, STRIP_H = 72;

/**
 * getIdx(): aktueller Index ({ keys, langs, words, count, localNum, total }) · getVersion(): Zähler, der sich bei jedem
 * Neuladen ändert · labelOf(key): „Glurak ex 199/165“ · post(msg, transfer?) · getGlyphs(): Ziffern-Vorlagen (optional)
 */
export function createSweepEngine({ getIdx, getVersion, labelOf, post, getGlyphs = () => null }) {
  const st = {
    setId: "", mode: "turbo", rows: null, rowsFor: "", layouts: new Map(), layoutLoading: new Set(), asked: new Set(),
    prevThumb: null, tracks: [], frameNo: 0, canvas: null, ctx: null, needAt: 0, busy: false,
  };
  const offscreen = (() => { try { return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d"); } catch { return false; } })();
  const profile = () => PROFILE[st.mode] || PROFILE.turbo;

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

  function evaluate(rgba, w, h, quad, idx, rows, withNumber) {
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
    // Nummern-ROI nur für aussichtsreiche Kandidaten (spart Zeit bei klaren Nicht-Treffern)
    let numOk = null;
    if (withNumber && match >= SWEEP.MIN_MATCH - 0.06) { try { numOk = verifyNumber(rgba, w, h, quad, idx, d.best); } catch { numOk = null; } }
    const det = {
      quad, keys, lead, match: Math.round(match * 1000) / 1000, hash: Math.round(hashSimilarity(d.score) * 1000) / 1000,
      layout: ls === null ? null : Math.round(ls * 1000) / 1000, score: d.score, margin: d.margin, glare: glare > GLARE_HIGH, numOk,
      label: labelOf(keys[0]) || "",
      probe: { artP: wordsToHex(probe[0], probe[1]), artD: wordsToHex(probe[2], probe[3]), fullP: wordsToHex(probe[4], probe[5]) },
    };
    det.conf = confidencePercent(det);
    return det;
  }

  function frame(msg) {
    const t0 = performance.now();
    const pr = profile();
    const { rgba, w, h } = readFrame(msg);
    const idx = getIdx();
    const sw = Math.min(SWEEP.DETECT_W, w), k = w / sw, sh = Math.round(h / k);
    const small = grayDown(rgba, w, h, sw, sh);
    const grad = sobel(small);
    const thumb = frameThumb(small);
    const motion = thumbMotion(st.prevThumb, thumb);
    st.prevThumb = thumb;
    st.frameNo++;
    const now = Date.now();
    // 1) Verfolgen: zuletzt gefundene Karten an ihrer alten Position verfeinern (reihum sortiert → jede kommt dran)
    st.tracks = st.tracks.filter((t) => now - t.at < pr.trackMs);
    const rot = st.tracks.length ? st.frameNo % st.tracks.length : 0;
    const tracked = [];
    st.tracks.forEach((t, i) => {
      const det = detectCard(small, quadBox(t.quad, 0.04), grad);
      if (det.found) tracked.push({ quad: det.corners, conf: det.confidence, tracked: true, order: (i - rot + st.tracks.length) % st.tracks.length, track: t });
    });
    tracked.sort((a, b) => a.order - b.order);
    // 2) Globale Suche: immer ohne verfolgte Karte, im Sweep-Modus jedes Bild, sonst jedes 2. Bild (weitere Karten im Bild finden)
    const fresh = [];
    if (!tracked.length || st.frameNo % pr.globalEvery === 0) {
      const rects = findCardRects(grad, small.w, small.h, { max: pr.maxRects });
      for (const r of rects) {
        if (tracked.some((c) => rectIou(quadBox(c.quad), r) > 0.4) || fresh.some((c) => rectIou(quadBox(c.quad), r) > 0.4)) continue;
        const det = detectCard(small, r, grad);
        fresh.push(det.found ? { quad: det.corners, conf: det.confidence } : { quad: rectQuad(r), conf: r.score, coarse: true });
        if (fresh.length >= pr.maxEval || performance.now() - t0 > pr.budgetMs * 0.5) break;
      }
    }
    // NEUE Karten zuerst, dann die verfolgten – so bekommt Karte #2 ihr Zeitbudget, auch wenn Karte #1 liegen bleibt
    const cands = [...fresh, ...tracked];
    const tDetect = performance.now();
    const dets = [];
    const ready = idx.count > 0;
    const rows = ready ? rowsForSet() : null;
    const withNumber = st.mode === "sweep" || Boolean(getGlyphs()?.length);
    const evaluated = new Set();
    if (ready && !(rows && !rows.length)) {
      let n = 0;
      for (const c of cands) {
        if (n >= pr.maxEval) break;
        // Mindestens minEval Kandidaten je Bild, danach gilt das Zeitbudget
        if (n >= pr.minEval && performance.now() - t0 > pr.budgetMs) break;
        n++;
        const r = evaluate(rgba, w, h, c.quad.map(([x, y]) => [x * k, y * k]), idx, rows, withNumber);
        evaluated.add(c);
        if (r) dets.push({ ...r, small: c.quad, coarse: Boolean(c.coarse) });
      }
    }
    // Verfolgte Karten, die in diesem Bild nicht neu ausgewertet wurden, werden mit ihrem letzten Ergebnis weitergetragen
    // (Etikett + Gesamtwert bleiben stabil; für den Treffer-Konsens zählen sie nicht)
    for (const c of tracked) {
      if (evaluated.has(c) || !c.track.last) continue;
      const q = c.quad.map(([x, y]) => [x * k, y * k]);
      dets.push({ ...c.track.last, quad: q, small: c.quad, carried: true });
    }
    // Verfolgung nur für sichere Kanten bzw. erkannte Karten weiterführen (mit letztem Ergebnis für das Weitertragen)
    const keep = (d) => !d.coarse || d.match >= SWEEP.TRACK_MATCH;
    st.tracks = dets.filter(keep).map((d) => ({ quad: d.small, at: d.carried ? d.at || now : now, last: d.match >= SWEEP.TRACK_MATCH ? { ...d, small: undefined, carried: undefined, at: now } : null }))
      .concat(cands.filter((c) => !c.coarse && !dets.some((d) => d.small === c.quad)).map((c) => ({ quad: c.quad, at: now, last: null })))
      .slice(0, pr.maxRects);
    dets.sort((a, b) => b.match - a.match);
    const found = cands.some((c) => !c.coarse) || dets.some((d) => d.match >= SWEEP.TRACK_MATCH);
    return {
      type: "sweep-result", seq: msg.seq, w, h, ms: Math.round((performance.now() - t0) * 10) / 10, msDetect: Math.round((tDetect - t0) * 10) / 10,
      motion: Math.round(motion * 1000) / 1000, light: Math.round(thumb.mean), found, ready, setRows: rows ? rows.length : -1, mode: st.mode,
      // Ecken relativ zum Bild (0…1) – der Haupt-Thread zeichnet daraus die Preisschild-Etiketten
      dets: dets.map((d) => ({ ...d, small: undefined, at: undefined, quad: d.quad.map(([x, y]) => [x / w, y / h]) })),
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
        if (typeof msg.mode === "string") st.mode = msg.mode === "sweep" ? "sweep" : "turbo";
        st.rowsFor = ""; st.tracks = [];
        const rows = rowsForSet();
        post({ type: "sweep-config-done", setId: st.setId, mode: st.mode, rows: rows ? rows.length : getIdx().count, ms: Math.round(performance.now() - t0) });
        return true;
      }
      if (msg.type === "sweep-layouts") {
        const items = Array.isArray(msg.items) ? msg.items.slice(0, 700) : [];
        const n = await loadLayouts(items);
        post({ type: "sweep-layouts-done", requested: items.length, ready: n, total: st.layouts.size, setId: msg.setId || "" });
        return true;
      }
      if (msg.type === "sweep-frame") {
        // Gegendruck: nie zwei Bilder gleichzeitig – das Flag wird in JEDEM Fall (auch bei Fehlern) per finally zurückgesetzt
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
