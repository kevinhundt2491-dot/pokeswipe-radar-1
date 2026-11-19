// PokeSwipe & Radar – Web Worker des On-Device-Scanners (eigener Thread, die Oberfläche bleibt flüssig).
// Ablauf pro Kamerabild: Graustufen → Kantenerkennung → Perspektivkorrektur → pHash/dHash des Artworks und der Karte →
// Hamming-Suche im lokalen Index (Referenzbilder + gelernte Kamera-Fingerabdrücke) → Farb-Abgleich → Kartennummer lesen
// (Plattform-Texterkennung, sonst Ziffern-Vorlagenvergleich auf kontrastnormalisiertem Streifen) → Entscheidung.
// Es verlässt kein Bild das Gerät.
import {
  rgbaToGray, resize, detectCard, normalizeCard, cardHashes, topMatches, decide, homography, warp, readNumber,
  parseNumberText, glyphVector, splitIndexId, localNumber, decodeBase64, unpackWords, NUMBER_STRIPS, WORDS, SCORE_STRONG,
  normalizeContrast, glareRatio, colorSignature, colorDistance, colorPenalty, wordsToHex, GLARE_HIGH,
  suppressGlare, focusScore, sharpen, scaleQuad, FALLBACK_SCALES, sobel, rotateQuad, TILT_ANGLES,
  glareMask, maskBits, topMatchesMasked, prepareStrip,
} from "../../server/scan-logic.ts";
import { buildTextIndex, decideText } from "../../server/scan-text-logic.ts";
import { renderGlyphBitmaps } from "./glyph-render.js";
import { createSweepEngine } from "./sweep-engine.js";
import { cachedJson } from "./idb-cache.js";

const idx = { keys: [], langs: [], localNum: new Int32Array(0), total: new Int32Array(0), words: new Uint32Array(0), colors: [], count: 0, perLang: {}, learned: 0 };
let glyphs = null;
/** Text-Index (Name + Sammlernummer aller Katalogkarten) für die Erkennung ohne KI */
let textIdx = null;
let langsOrder = ["de", "en", "ja"];
/** Letzte Bild-Treffer (Fingerabdruck) – bestätigen bzw. entscheiden zwischen Text-Treffern */
let lastHash = { at: 0, cands: [] };
let textDetector = null;
let busy = false;
/** Zeitbudget je Live-Bild für Ersatz-Zuschnitte und Position, an der die Suche beim nächsten Bild weitermacht */
const LIVE_BUDGET_MS = 35;
let fbCursor = 0;
/** Zählt jedes Neuladen des Index (Sweep-Set-Lock baut seine Zeilenliste dann neu) */
let idxVersion = 0;
/** Zero-Latency Sweep-Modus (rahmenlose Live-Erkennung) – nutzt denselben Index wie die Foto-Erkennung */
const sweep = createSweepEngine({ getIdx: () => idx, getVersion: () => idxVersion, labelOf: (k) => labelOf(k), post: (m, t) => postMessage(m, t || []), getGlyphs: () => glyphs });

/** Ersatz-Zuschnitte in sinnvoller Reihenfolge: kleiner gehalten, schief (±5°/±9°), neben der Mitte (± leicht gedreht). */
function fallbackQuads(base0) {
  const out = FALLBACK_SCALES.slice(1).map((k) => scaleQuad(base0, k));
  const tilt = scaleQuad(base0, 0.93);
  for (const deg of TILT_ANGLES) out.push(rotateQuad(tilt, deg));
  const base = scaleQuad(base0, 0.9), w = base[1][0] - base[0][0], h = base[3][1] - base[0][1];
  for (const [dx, dy] of [[-0.08, 0], [0.08, 0], [-0.15, 0.04], [0.15, 0.04], [-0.15, -0.04], [0.15, -0.04], [0, 0.07], [0, -0.07]]) {
    for (const deg of [0, -7, 7]) out.push(rotateQuad(base.map(([x, y]) => [x + dx * w, y + dy * h]), deg));
  }
  return out;
}

/** Anzeigename „Glurak ex 199/165“ aus dem Text-Index – damit der Treffer sofort benannt ist, bevor der Preis geladen ist. */
function labelOf(key) {
  const i = textIdx?.byKey.get(key);
  if (i === undefined) return "";
  const r = textIdx.rows[i];
  const num = r.num >= 0 ? `${r.prefix}${r.num}${r.total > 0 ? `/${r.total}` : ""}` : "";
  return `${r.name}${num ? ` ${num}` : ""}`;
}

// ---------------------------------------------------------------------------
// Index laden (je Sprache, vom Service Worker auch offline gehalten)
// ---------------------------------------------------------------------------
async function loadIndex(langs) {
  const parts = [];
  for (const lang of langs) {
    postMessage({ type: "progress", lang, state: "loading" });
    try {
      // IndexedDB-Zwischenspeicher: beim zweiten Start ist der Index ohne Netz in Millisekunden da (auch offline)
      const { data } = await cachedJson(`/api/scan/index?lang=${encodeURIComponent(lang)}`, { fetchInit: { credentials: "same-origin" } });
      const words = unpackWords(decodeBase64(String(data.h || "")));
      const ids = String(data.ids || "").split("\n").filter(Boolean);
      const n = Math.min(ids.length, Math.floor(words.length / WORDS));
      // Farb-Signaturen gibt es nur für gelernte Zeilen (ab learnedStart)
      const start = Number(data.learnedStart) >= 0 ? Number(data.learnedStart) : n;
      const learnedColors = String(data.colors || "").split("\n");
      const colors = Array.from({ length: n }, (_, i) => (i >= start ? learnedColors[i - start] || "" : ""));
      parts.push({ lang, ids: ids.slice(0, n), words: words.subarray(0, n * WORDS), sets: data.sets || {}, colors, learned: Math.max(0, n - start) });
      postMessage({ type: "progress", lang, state: "ready", count: n });
    } catch (e) {
      postMessage({ type: "progress", lang, state: "error", error: String(e?.message || e) });
    }
  }
  const count = parts.reduce((s, p) => s + p.ids.length, 0);
  const words = new Uint32Array(count * WORDS);
  const localNum = new Int32Array(count), total = new Int32Array(count);
  const keys = new Array(count), langOf = new Array(count), colors = new Array(count);
  const perLang = {};
  let learned = 0;
  let o = 0;
  for (const p of parts) {
    words.set(p.words, o * WORDS);
    p.ids.forEach((id, j) => {
      const sp = splitIndexId(id);
      keys[o + j] = sp.kind === "print" ? `print:${id}` : `card:${id}`;
      langOf[o + j] = p.lang;
      localNum[o + j] = localNumber(sp.localId);
      total[o + j] = Number(p.sets[sp.setId]) || 0;
      colors[o + j] = p.colors[j] || "";
    });
    perLang[p.lang] = p.ids.length;
    learned += p.learned;
    o += p.ids.length;
  }
  Object.assign(idx, { keys, langs: langOf, localNum, total, words, colors, count, perLang, learned });
  idxVersion++;
  return { count, perLang, learned };
}

/** Text-Index je Sprache laden (parallel zum Fingerabdruck-Index; fehlt er, läuft der Scanner trotzdem). */
async function loadTextIndex(langs) {
  const parts = await Promise.all(langs.map(async (lang) => {
    try {
      const { data } = await cachedJson(`/api/scan/text-index?lang=${encodeURIComponent(lang)}`, { fetchInit: { credentials: "same-origin" } });
      return { lang, t: String(data.t || "") };
    } catch { return null; }
  }));
  textIdx = buildTextIndex(parts.filter(Boolean));
  return textIdx.rows.length;
}

// ---------------------------------------------------------------------------
// Ziffern-Vorlagen (einmalig mit OffscreenCanvas gezeichnet; mehrere Schriften, normal und schmal)
// ---------------------------------------------------------------------------
function buildGlyphs() {
  // Ohne OffscreenCanvas (bzw. ohne 2D-Kontext darin) zeichnet der Haupt-Thread die Vorlagen (Nachricht „need-glyphs“)
  if (typeof OffscreenCanvas === "undefined") return [];
  return renderGlyphBitmaps(new OffscreenCanvas(64, 80)).map((g) => ({ ch: g.ch, v: glyphVector(g.bits, g.w, g.h) }));
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

/** Ersatz-Rahmen für die Kantensuche: kleiner (0,8 / 0,64) und um ±12 % verschoben – alle im Bild. */
function searchGuides(g, w, h) {
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2, gw = g.x1 - g.x0, gh = g.y1 - g.y0;
  const out = [];
  for (const k of [0.8, 0.64]) {
    for (const [dx, dy] of [[0, 0], [-0.12, 0], [0.12, 0], [0, -0.1], [0, 0.1]]) {
      const x0 = cx - (gw * k) / 2 + dx * gw, y0 = cy - (gh * k) / 2 + dy * gh;
      const q = { x0, y0, x1: x0 + gw * k, y1: y0 + gh * k };
      if (q.x0 >= 2 && q.y0 >= 2 && q.x1 <= w - 2 && q.y1 <= h - 2) out.push(q);
      if (k === 0.8 && out.length > 3) break; // Großer Rahmen: Mitte + 3 Verschiebungen genügen
    }
  }
  return out;
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
  const half = { x0: g.x0 / 2, y0: g.y0 / 2, x1: g.x1 / 2, y1: g.y1 / 2 };
  // Nachsichtige Ausrichtung: Kanten erst am Rahmen suchen, dann an kleineren/verschobenen Rahmen (Karte weiter weg,
  // schief oder neben der Mitte gehalten). Der Gradient wird nur einmal berechnet.
  const grad = sobel(small);
  let det = detectCard(small, half, grad);
  if (!det.found) {
    for (const guide of searchGuides(half, small.w, small.h)) {
      if (!msg.capture && performance.now() - t0 > 18) break;
      const alt = detectCard(small, guide, grad);
      if (alt.found) { det = alt; break; }
    }
  }
  let corners = det.corners.map(([x, y]) => [x * 2, y * 2]);
  const tDetect = performance.now();
  if (!idx.count) return { type: "result", reqId: msg.reqId, ms: performance.now() - t0, found: det.found, corners, sharpness: det.sharpness, empty: true };
  const rgba = msg.data instanceof ArrayBuffer ? new Uint8ClampedArray(msg.data) : msg.data;

  // Eine Kandidaten-Lage auswerten: entzerren → Spiegelungen unterdrücken → Fingerabdruck → Farb-Abgleich → Top-Treffer
  const evaluate = (quad) => {
    const raw = normalizeCard(frame, quad);
    const glare = glareRatio(raw);
    // Holo-/Sleeve-Glanz: helle Flecken durch die Umgebung ersetzen, sonst kippen viele Hash-Bits
    const card = glare > 0.004 ? suppressGlare(raw) : raw;
    const probe = cardHashes(card);
    // Sleeve-/Toploader-Kompensation: dHash-Bits unter Lichtreflexen zählen beim Abgleich nicht (Maske vom Rohbild)
    const mask = glare > 0.004 ? glareMask(raw) : null;
    const color = colorSignature(rgba, msg.w, msg.h, quad);
    const matches = topMatchesMasked(probe, idx.words, idx.count, 18, mask)
      .map((m) => (idx.colors[m.i] ? { ...m, score: m.score + colorPenalty(colorDistance(color, idx.colors[m.i])) } : m))
      .sort((a, b) => a.score - b.score)
      .slice(0, 14);
    return { quad, raw, glare, probe, color, matches, masked: maskBits(mask), focus: focusScore(raw) };
  };
  // Kanten sicher gefunden: exakter Zuschnitt. Sonst Ersatz-Zuschnitte (kleiner, gedreht, verschoben) probieren und
  // den besten Treffer nehmen – mit Zeitbudget: im Live-Bild nur ~35 ms je Bild (auf dem Handy früher über 1 s mit bis zu
  // 33 Zuschnitten, das blockierte auch die Texterkennung). Die Live-Suche setzt beim nächsten Bild dort fort, wo sie
  // aufgehört hat – über wenige Bilder sind alle Lagen geprüft. Beim Auslösen/Foto gilt ein großzügiges Budget.
  let ev = evaluate(corners);
  if (!det.found) {
    const budget = msg.capture ? 450 : LIVE_BUDGET_MS;
    const best = () => ev.matches[0]?.score ?? 999;
    const alts = fallbackQuads(det.corners);
    const start = msg.capture ? 0 : fbCursor % alts.length;
    let tried = 0;
    for (let n = 0; n < alts.length && best() > SCORE_STRONG; n++) {
      if (tried >= 2 && performance.now() - t0 > budget) break;
      const q = alts[(start + n) % alts.length];
      const alt = evaluate(q.map(([x, y]) => [x * 2, y * 2]));
      tried++;
      if ((alt.matches[0]?.score ?? 999) < best()) ev = alt;
    }
    if (!msg.capture) fbCursor = start + tried;
    corners = ev.quad;
  }
  const { glare, probe, color, matches } = ev;
  const tMatch = performance.now();
  lastHash = { at: Date.now(), cands: matches.slice(0, 12).map((m) => ({ key: idx.keys[m.i], score: m.score })) };

  // Kartennummer nur lesen, wenn der Hash allein nicht eindeutig ist (spart Zeit bei klaren Treffern) – beim
  // Auslösen (Auto-Capture / Auslöser) immer, mit nachgeschärftem, kontrastnormalisiertem Streifen
  let ocr = null;
  if (msg.ocr && (msg.capture || (matches[0]?.score ?? 99) > SCORE_STRONG)) {
    const H = homography(corners);
    for (const box of NUMBER_STRIPS) {
      // Kontrast normalisieren + nachschärfen: Spiegelungen, dunkle Räume und leichte Unschärfe stören die Ziffern sonst stark
      // Glanzspitzen stauchen + lokaler Kontrast (milchige/verkratzte Hüllen) + nachschärfen
      const strip = prepareStrip(warp(frame, H, 252, 72, box));
      ocr = (await platformOcr(strip)) || (glyphs?.length ? readNumber(strip, glyphs) : null);
      if (ocr) { ocr.strip = box.key; break; }
    }
  }
  const meta = { localNum: (i) => idx.localNum[i], total: (i) => idx.total[i] };
  const d = decide(matches, idx.words, meta, ocr);
  // Gelernte Zeilen derselben Karte nicht doppelt melden
  const seen = new Set();
  const group = d.group.map((i) => ({ key: idx.keys[i], lang: idx.langs[i] })).filter((g) => (seen.has(g.key) ? false : seen.add(g.key)));
  return {
    type: "result", reqId: msg.reqId,
    ms: performance.now() - t0, msDetect: tDetect - t0, msMatch: tMatch - tDetect,
    found: det.found, confidence: det.confidence, sharpness: det.sharpness, focus: Math.round(ev.focus * 100) / 100, corners,
    accepted: d.accepted, byNumber: d.byNumber, score: d.score, margin: d.margin,
    best: d.best >= 0 ? idx.keys[d.best] : null,
    group, label: group.length ? labelOf(group[0].key) : "",
    glare: Math.round(glare * 1000) / 1000, glareHigh: glare > GLARE_HIGH, masked: ev.masked || 0,
    // Fingerabdruck dieses Bildes – wird beim Übernehmen an den lernenden Index geschickt
    probe: { artP: wordsToHex(probe[0], probe[1]), artD: wordsToHex(probe[2], probe[3]), fullP: wordsToHex(probe[4], probe[5]), color },
    candidates: matches.slice(0, 8).map((m) => ({ key: idx.keys[m.i], lang: idx.langs[m.i], score: Math.round(m.score) })),
    ocr: ocr ? { num: ocr.num, total: ocr.total, text: ocr.text, conf: Math.round((ocr.conf || 0) * 100) / 100, via: ocr.via || "templates" } : null,
  };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (typeof msg.type === "string" && msg.type.startsWith("sweep-")) { await sweep.handle(msg); return; }
  if (msg.type === "init") {
    if (!glyphs) { try { glyphs = buildGlyphs(); } catch { glyphs = []; } }
    // Rückfall für Safari/iOS ohne OffscreenCanvas im Worker: Vorlagen vom Haupt-Thread anfordern
    if (!glyphs.length) postMessage({ type: "need-glyphs" });
    try { if (!textDetector && typeof self.TextDetector === "function") textDetector = new self.TextDetector(); } catch { textDetector = null; }
    const langs = Array.isArray(msg.langs) && msg.langs.length ? msg.langs : ["de"];
    langsOrder = langs;
    const [r, textCount] = await Promise.all([loadIndex(langs), loadTextIndex(langs)]);
    postMessage({ type: "ready", ...r, textCount, offscreen: sweep.offscreen, ocr: glyphs.length ? (textDetector ? "text-detector" : "templates") : textDetector ? "text-detector" : "none" });
    return;
  }
  // Vom Haupt-Thread gezeichnete Ziffern-Vorlagen (Main-Thread-Canvas-Rückfall)
  if (msg.type === "glyphs") {
    try {
      const items = Array.isArray(msg.items) ? msg.items : [];
      const built = items.filter((g) => g && g.w > 0 && g.h > 0 && g.bits).map((g) => ({ ch: String(g.ch), v: glyphVector(new Float32Array(g.bits), g.w, g.h) }));
      if (built.length) { glyphs = built; postMessage({ type: "ocr-mode", ocr: textDetector ? "text-detector" : "templates" }); }
    } catch { /* bleibt ohne Vorlagen – Text-Erkennung läuft weiter */ }
    return;
  }
  // Gelesener Text (Name + Nummer) → Karte. Bild-Treffer der letzten 1,5 s (bzw. des Fotos) bestätigen/entscheiden.
  if (msg.type === "text") {
    const t0 = performance.now();
    let d = null;
    try {
      const hash = msg.useHash !== false && Date.now() - lastHash.at < 1500 ? lastHash.cands : [];
      d = textIdx ? decideText(textIdx, String(msg.text || ""), hash, langsOrder) : null;
    } catch (err) { d = null; }
    postMessage({ type: "text-result", reqId: msg.reqId, ms: performance.now() - t0, ...(d || { accepted: false, strength: "none", keys: [], candidates: [] }), label: d?.keys?.length ? labelOf(d.keys[0]) : "" });
    return;
  }
  if (msg.type === "frame") {
    // Einzelbilder (Foto-Scan) nie verwerfen; ein verworfenes Live-Bild wird gemeldet, damit die Kamera-Schleife sofort
    // das nächste schickt (sie wartet auf jede Antwort, statt Bilder aufzustauen)
    if (busy && !msg.reqId) { postMessage({ type: "result", skipped: true }); return; }
    busy = true;
    try { postMessage(await analyse(msg)); }
    catch (err) { postMessage({ type: "result", reqId: msg.reqId, error: String(err?.message || err) }); }
    finally { busy = false; }
  }
};
