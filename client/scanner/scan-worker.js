// PokeSwipe & Radar – Web Worker des On-Device-Scanners (eigener Thread, die Oberfläche bleibt flüssig).
// Ablauf pro Kamerabild: Graustufen → Kantenerkennung → Perspektivkorrektur → pHash/dHash des Artworks und der Karte →
// Hamming-Suche im lokalen Index → Kartennummer lesen (Plattform-Texterkennung, sonst Ziffern-Vorlagenvergleich) → Entscheidung.
// Es verlässt kein Bild das Gerät.
import {
  rgbaToGray, resize, detectCard, normalizeCard, cardHashes, topMatches, decide, homography, warp, readNumber,
  parseNumberText, glyphVector, splitIndexId, localNumber, decodeBase64, unpackWords, NUMBER_STRIPS, WORDS, SCORE_STRONG,
} from "../../server/scan-logic.ts";

const idx = { keys: [], langs: [], localNum: new Int32Array(0), total: new Int32Array(0), words: new Uint32Array(0), count: 0, perLang: {} };
let glyphs = null;
let textDetector = null;
let busy = false;

// ---------------------------------------------------------------------------
// Index laden (je Sprache, vom Service Worker auch offline gehalten)
// ---------------------------------------------------------------------------
async function loadIndex(langs) {
  const parts = [];
  for (const lang of langs) {
    postMessage({ type: "progress", lang, state: "loading" });
    try {
      const res = await fetch(`/api/scan/index?lang=${encodeURIComponent(lang)}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const words = unpackWords(decodeBase64(String(data.h || "")));
      const ids = String(data.ids || "").split("\n").filter(Boolean);
      const n = Math.min(ids.length, Math.floor(words.length / WORDS));
      parts.push({ lang, ids: ids.slice(0, n), words: words.subarray(0, n * WORDS), sets: data.sets || {} });
      postMessage({ type: "progress", lang, state: "ready", count: n });
    } catch (e) {
      postMessage({ type: "progress", lang, state: "error", error: String(e?.message || e) });
    }
  }
  const count = parts.reduce((s, p) => s + p.ids.length, 0);
  const words = new Uint32Array(count * WORDS);
  const localNum = new Int32Array(count), total = new Int32Array(count);
  const keys = new Array(count), langOf = new Array(count);
  const perLang = {};
  let o = 0;
  for (const p of parts) {
    words.set(p.words, o * WORDS);
    p.ids.forEach((id, j) => {
      const sp = splitIndexId(id);
      keys[o + j] = sp.kind === "print" ? `print:${id}` : `card:${id}`;
      langOf[o + j] = p.lang;
      localNum[o + j] = localNumber(sp.localId);
      total[o + j] = Number(p.sets[sp.setId]) || 0;
    });
    perLang[p.lang] = p.ids.length;
    o += p.ids.length;
  }
  Object.assign(idx, { keys, langs: langOf, localNum, total, words, count, perLang });
  return { count, perLang };
}

// ---------------------------------------------------------------------------
// Ziffern-Vorlagen (einmalig mit OffscreenCanvas gezeichnet; mehrere Schriften, normal und schmal)
// ---------------------------------------------------------------------------
function buildGlyphs() {
  if (typeof OffscreenCanvas === "undefined") return [];
  const out = [];
  const cv = new OffscreenCanvas(64, 80);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const fonts = ["bold 56px Arial, Helvetica, sans-serif", "56px Arial, Helvetica, sans-serif", "bold 56px 'Roboto Condensed', 'Arial Narrow', sans-serif", "600 56px Verdana, sans-serif"];
  for (const font of fonts) for (const squeeze of [1, 0.8]) for (const ch of "0123456789/") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 64, 80);
    ctx.setTransform(squeeze, 0, 0, 1, 32 * (1 - squeeze), 0);
    ctx.fillStyle = "#000"; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ch, 32, 42);
    const { data } = ctx.getImageData(0, 0, 64, 80);
    let x0 = 64, y0 = 80, x1 = -1, y1 = -1;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 64; x++) if (data[(y * 64 + x) * 4] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const bits = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = data[((y0 + y) * 64 + x0 + x) * 4] < 128 ? 1 : 0;
    out.push({ ch, v: glyphVector(bits, w, h) });
  }
  return out;
}

async function platformOcr(strip) {
  if (!textDetector || typeof ImageData === "undefined" || typeof createImageBitmap === "undefined") return null;
  try {
    const rgba = new Uint8ClampedArray(strip.w * strip.h * 4);
    for (let i = 0; i < strip.d.length; i++) { const v = strip.d[i]; rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
    const bmp = await createImageBitmap(new ImageData(rgba, strip.w, strip.h));
    const found = await textDetector.detect(bmp);
    bmp.close?.();
    for (const t of found) {
      const r = parseNumberText(t.rawValue);
      if (r) return { ...r, text: `${r.num}/${r.total}`, conf: 0.9, via: "text-detector" };
    }
  } catch { textDetector = null; }
  return null;
}

// ---------------------------------------------------------------------------
// Ein Kamerabild auswerten
// ---------------------------------------------------------------------------
async function analyse(msg) {
  const t0 = performance.now();
  const frame = rgbaToGray(new Uint8ClampedArray(msg.data), msg.w, msg.h);
  // Kantensuche auf halber Auflösung (schneller, rauschärmer), Entzerrung aus dem vollen Bild
  const sw = Math.round(msg.w / 2), sh = Math.round(msg.h / 2);
  const small = resize(frame, sw, sh);
  const g = msg.guide;
  const det = detectCard(small, { x0: g.x0 / 2, y0: g.y0 / 2, x1: g.x1 / 2, y1: g.y1 / 2 });
  const corners = det.corners.map(([x, y]) => [x * 2, y * 2]);
  const tDetect = performance.now();
  if (!idx.count) return { type: "result", ms: performance.now() - t0, found: det.found, corners, sharpness: det.sharpness, empty: true };

  const probe = cardHashes(normalizeCard(frame, corners));
  const matches = topMatches(probe, idx.words, idx.count, 14);
  const tMatch = performance.now();

  // Kartennummer nur lesen, wenn der Hash allein nicht eindeutig ist (spart Zeit bei klaren Treffern)
  let ocr = null;
  if (msg.ocr && (matches[0]?.score ?? 99) > SCORE_STRONG) {
    const H = homography(corners);
    for (const box of NUMBER_STRIPS) {
      const strip = warp(frame, H, 252, 72, box);
      ocr = (await platformOcr(strip)) || (glyphs?.length ? readNumber(strip, glyphs) : null);
      if (ocr) { ocr.strip = box.key; break; }
    }
  }
  const meta = { localNum: (i) => idx.localNum[i], total: (i) => idx.total[i] };
  const d = decide(matches, idx.words, meta, ocr);
  return {
    type: "result",
    ms: performance.now() - t0, msDetect: tDetect - t0, msMatch: tMatch - tDetect,
    found: det.found, confidence: det.confidence, sharpness: det.sharpness, corners,
    accepted: d.accepted, byNumber: d.byNumber, score: d.score, margin: d.margin,
    best: d.best >= 0 ? idx.keys[d.best] : null,
    group: d.group.map((i) => ({ key: idx.keys[i], lang: idx.langs[i] })),
    candidates: matches.slice(0, 6).map((m) => ({ key: idx.keys[m.i], lang: idx.langs[m.i], score: Math.round(m.score) })),
    ocr: ocr ? { num: ocr.num, total: ocr.total, text: ocr.text, conf: Math.round((ocr.conf || 0) * 100) / 100, via: ocr.via || "templates" } : null,
  };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "init") {
    if (!glyphs) { try { glyphs = buildGlyphs(); } catch { glyphs = []; } }
    try { if (!textDetector && typeof self.TextDetector === "function") textDetector = new self.TextDetector(); } catch { textDetector = null; }
    const r = await loadIndex(Array.isArray(msg.langs) && msg.langs.length ? msg.langs : ["de"]);
    postMessage({ type: "ready", ...r, ocr: glyphs.length ? (textDetector ? "text-detector" : "templates") : textDetector ? "text-detector" : "none" });
    return;
  }
  if (msg.type === "frame") {
    if (busy) return;
    busy = true;
    try { postMessage(await analyse(msg)); }
    catch (err) { postMessage({ type: "result", error: String(err?.message || err) }); }
    finally { busy = false; }
  }
};
