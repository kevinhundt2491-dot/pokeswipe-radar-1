// PokeSwipe & Radar – Texterkennung ohne KI für den Live-Scanner und Foto-Scans.
//
// Motor: browsereigener TextDetector (Shape Detection API, wo verfügbar) – sonst Tesseract.js (WebAssembly in eigenen
// Workern, Dateien selbst gehostet unter /assets/ocr/, kein CDN, nichts verlässt das Gerät).
// Zwei Leser laufen parallel:
//   • Name   – Namenszeile oben (Buchstaben, Umlaute, Bindestrich),
//   • Nummer – Nummernzone unten links und unten rechts, nur Ziffern, „/“ und Großbuchstaben (TG12, SVP 085, SWSH123).
// Die Zuschnitte werden in Graustufen umgerechnet, Spiegelungen (Holo/Folie) gekappt, der Kontrast gestreckt und helle
// Schrift auf dunklem Grund (Full-Art) invertiert. Sind die Kartenecken bekannt, werden die Streifen entzerrt und eng
// zugeschnitten (schnell, genau); sonst haben sie bewusst Luft: die Karte muss nicht exakt im Rahmen liegen.
// An Tesseract gehen die Zuschnitte als rohe Graustufen-PGM (kein PNG-Kodieren/-Dekodieren je Lesung).

const OCR_BASE = "/assets/ocr";
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüßéÉèêàâç-'’ ";
const NUMBER_CHARS = "0123456789/ ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let engine = null; // { kind, read({ name, number }) → Promise<string> }
let starting = null;
let workers = [];

/** Graustufen-Zuschnitt ({ w, h, gray }) als Canvas – nur für den TextDetector nötig. */
function grayToCanvas(z) {
  const c = document.createElement("canvas");
  c.width = z.w; c.height = z.h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(z.w, z.h);
  for (let i = 0, j = 0; i < z.gray.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = z.gray[i]; img.data[j + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Graustufen-Zuschnitt als PGM-Datei (P5). Tesseract (Leptonica) liest PGM direkt – früher wurde jeder Zuschnitt als
 * Canvas übergeben, den Tesseract.js erst als PNG kodiert (toBlob) und im Worker wieder dekodiert hat. Das kostete bei
 * jeder Lesung zweimal Rechenzeit, ohne irgendeinen Nutzen.
 */
export function toPgm(z) {
  const head = new TextEncoder().encode(`P5\n${z.w} ${z.h}\n255\n`);
  const out = new Uint8Array(head.length + z.gray.length);
  out.set(head, 0); out.set(z.gray, head.length);
  return out;
}

async function textDetectorEngine() {
  if (typeof window === "undefined" || typeof window.TextDetector !== "function") return null;
  try {
    const td = new window.TextDetector();
    // Manche Browser kennen die Klasse, liefern aber nie Ergebnisse (Flag aus) – einmal mit leerem Bild prüfen
    const probe = document.createElement("canvas");
    probe.width = 8; probe.height = 8;
    await td.detect(probe);
    const one = async (z) => (await td.detect(grayToCanvas(z))).map((t) => t.rawValue).join("\n");
    return { kind: "text-detector", read: async ({ name, number }) => (await Promise.all([one(name), one(number)])).join("\n") };
  } catch { return null; }
}

async function tesseractEngine() {
  const mod = await import("tesseract.js");
  // CommonJS-Paket: je nach Bundler liegt createWorker direkt oder unter default
  const createWorker = mod.createWorker || mod.default?.createWorker;
  if (typeof createWorker !== "function") throw new Error("Tesseract.js nicht verfügbar");
  // OEM 1 = nur LSTM (kleinster Kern), Worker direkt von /assets (CSP: worker-src 'self', keine blob:-URL)
  const opts = { workerPath: `${OCR_BASE}/worker.min.js`, corePath: OCR_BASE, langPath: OCR_BASE, workerBlobURL: false, gzip: true, cacheMethod: "write" };
  // Ohne Wörterbücher: schnellerer Start, und Pokémon-Namen werden nicht zu englischen Wörtern „korrigiert“
  const init = { load_system_dawg: "0", load_freq_dawg: "0" };
  const [nameW, numW] = await Promise.all([createWorker("eng", 1, opts, init), createWorker("eng", 1, opts, init)]);
  // tessedit_do_invert = 0: die Zuschnitte sind schon kontrastgestreckt und bei heller Schrift invertiert – Tesseract
  // muss unsichere Zeilen nicht zusätzlich invertiert ein zweites Mal lesen (gemessen ~25 % schneller, gleich genau).
  const common = { tessedit_pageseg_mode: "11", user_defined_dpi: "300", tessedit_do_invert: "0" };
  await Promise.all([
    nameW.setParameters({ ...common, tessedit_char_whitelist: NAME_CHARS }),
    numW.setParameters({ ...common, tessedit_char_whitelist: NUMBER_CHARS }),
  ]);
  workers = [nameW, numW];
  const text = async (w, z) => (await w.recognize(toPgm(z))).data.text || "";
  return { kind: "tesseract", read: async ({ name, number }) => (await Promise.all([text(nameW, name), text(numW, number)])).join("\n") };
}

/** OCR-Motor bereitstellen (einmalig; Tesseract lädt ~4 MB beim ersten Mal, danach aus dem Browser-Speicher). */
export function getOcr() {
  if (engine) return Promise.resolve(engine);
  if (!starting) {
    starting = (async () => {
      engine = (await textDetectorEngine()) || (await tesseractEngine().catch(() => null));
      if (!engine) starting = null; // später erneut versuchen (z. B. offline beim ersten Start)
      return engine;
    })();
  }
  return starting;
}

export const ocrKind = () => engine?.kind || (starting ? "loading" : "none");

/** Im Hintergrund vorladen, sobald der Scanner geöffnet wird – die erste Erkennung ist dann sofort schnell. */
export function warmupOcr() {
  const run = () => getOcr().catch(() => null);
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 300);
}

export async function terminateOcr() {
  await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  workers = []; engine = null; starting = null;
}

// ---------------------------------------------------------------------------
// Vorverarbeitung
// ---------------------------------------------------------------------------
/**
 * Graustufen, Spiegelungen kappen (oberste 3 % der Helligkeit), Kontrast auf 0…255 strecken, bei dunklem Hintergrund
 * (Full-Art, helle Schrift) invertieren – Tesseract liest dunkle Schrift auf hellem Grund am besten.
 * `d` = RGBA-Pixel, Ergebnis: ein Graustufen-Byte je Pixel.
 */
export function enhanceGray(d, n) {
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000 | 0;
    gray[i] = v; hist[v]++; sum += v;
  }
  const pct = (p) => { let acc = 0; const lim = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lim) return v; } return 255; };
  const lo = pct(0.02), hi = Math.max(lo + 24, pct(0.97)); // hi < 255: Glanzlichter werden gekappt
  const invert = sum / n < 105;
  const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    let v = (Math.min(gray[i], hi) - lo) * k;
    if (invert) v = 255 - v;
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return gray;
}

/** Zuschnitte untereinander auf eine weiße Fläche setzen. */
function stack(parts, gap = 14) {
  const w = Math.max(...parts.map((p) => p.w));
  const h = Math.max(1, parts.reduce((s, p) => s + p.h + gap, 0) - gap);
  const gray = new Uint8Array(w * h).fill(255);
  let oy = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) gray.set(p.gray.subarray(y * p.w, (y + 1) * p.w), (oy + y) * w);
    oy += p.h + gap;
  }
  return { w, h, gray };
}

/** Wiederverwendete Zeichenfläche (kein neues Canvas je Lesung – spart Speicher und Müllsammlung auf dem Handy). */
let scratch = null;
function scratchCtx(w, h) {
  if (!scratch) scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const c = scratch.canvas;
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.imageSmoothingEnabled = true;
  scratch.imageSmoothingQuality = "high";
  scratch.fillStyle = "#fff";
  scratch.fillRect(0, 0, w, h);
  return scratch;
}

/** Bildpunkt (u, v ∈ 0…1, Kartenkoordinaten) im Quellbild – bilinear zwischen den vier Kartenecken TL, TR, BR, BL. */
function onQuad(q, u, v) {
  const [tl, tr, br, bl] = q;
  const tx = tl[0] + (tr[0] - tl[0]) * u, ty = tl[1] + (tr[1] - tl[1]) * u;
  const bx = bl[0] + (br[0] - bl[0]) * u, by = bl[1] + (br[1] - bl[1]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}

/**
 * Streifen der Karte (u0…u1 × v0…v1) entzerrt ausschneiden: die Kanten sind bekannt, also wird der Streifen gedreht und
 * geschert, bis die Schrift waagerecht liegt. Früher wurde das achsenparallele Rechteck um die Karte gelesen – bei schief
 * gehaltener Karte lag die Nummer dann schräg im Bild und Tesseract las sie oft nicht.
 */
function warpZone(src, q, u0, v0, u1, v1, pw) {
  const p00 = onQuad(q, u0, v0), p10 = onQuad(q, u1, v0), p01 = onQuad(q, u0, v1);
  const e1 = [p10[0] - p00[0], p10[1] - p00[1]], e2 = [p01[0] - p00[0], p01[1] - p00[1]];
  const len1 = Math.hypot(...e1), len2 = Math.hypot(...e2);
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  if (len1 < 4 || len2 < 2 || Math.abs(det) < 1) return null;
  const ph = Math.max(8, Math.round((len2 / len1) * pw));
  // Quelle → Ziel: e1 ↦ (pw, 0), e2 ↦ (0, ph)
  const a = (pw * e2[1]) / det, c = (-pw * e2[0]) / det, b = (-ph * e1[1]) / det, d = (ph * e1[0]) / det;
  const ctx = scratchCtx(pw, ph);
  ctx.setTransform(a, b, c, d, -(a * p00[0] + c * p00[1]), -(b * p00[0] + d * p00[1]));
  ctx.drawImage(src, 0, 0);
  return { w: pw, h: ph, gray: enhanceGray(ctx.getImageData(0, 0, pw, ph).data, pw * ph) };
}

/**
 * Lese-Bilder: Namenszeile (oben) und Nummernzonen unten links/rechts (die Sammlernummer steht je nach Ära links oder
 * rechts) – jeweils so vergrößert, dass die kleine Nummer ~25–30 px hoch ist.
 *
 * Mit Kartenecken (`rect.quad`, Quellbild-Koordinaten TL, TR, BR, BL): entzerrte, enge Streifen genau über der Namens-
 * und der Nummernzeile. Gemessen an echten Kartenbildern ist die Nummernlesung damit rund 2,5-mal schneller (≈ 270 →
 * ≈ 100 ms) und liest mehr Nummern richtig, weil Illustrator-Zeile, Copyright und Regeltext nicht mehr mitgelesen werden.
 * Ohne Ecken: großzügige achsenparallele Streifen (Karte liegt irgendwo um den Rahmen).
 */
export function ocrCanvases(src, rect, { width = 900 } = {}) {
  if (Array.isArray(rect?.quad) && rect.quad.length === 4) {
    const q = rect.quad;
    const name = warpZone(src, q, 0.08, 0.01, 0.74, 0.105, 600);
    const left = warpZone(src, q, -0.02, 0.912, 0.5, 0.988, 560);
    const right = warpZone(src, q, 0.52, 0.912, 1.03, 0.988, 560);
    if (name && left && right) return { name, number: stack([left, right]) };
  }
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  const clamp = (r) => {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.max(1, Math.min(sw - x, r.w - (x - r.x))), h: Math.max(1, Math.min(sh - y, r.h - (y - r.y))) };
  };
  const { x, y, w, h } = rect;
  const zone = (r, pw) => {
    const z = clamp(r);
    const ph = Math.max(8, Math.round((z.h / z.w) * pw));
    const ctx = scratchCtx(pw, ph);
    ctx.drawImage(src, z.x, z.y, z.w, z.h, 0, 0, pw, ph);
    return { w: pw, h: ph, gray: enhanceGray(ctx.getImageData(0, 0, pw, ph).data, pw * ph) };
  };
  const pw = width;
  const nameW = Math.round(pw * 0.8);
  const nz = { y: y - h * 0.03, h: h * 0.17 }, bz = { y: y + h * 0.86, h: h * 0.17 };
  return {
    name: zone({ x: x - w * 0.03, y: nz.y, w: w * 0.8, h: nz.h }, nameW),
    number: stack([
      zone({ x: x - w * 0.04, y: bz.y, w: w * 0.56, h: bz.h }, pw), // unten links (Karmesin & Purpur, Schwert & Schild)
      zone({ x: x + w * 0.48, y: bz.y, w: w * 0.56, h: bz.h }, pw), // unten rechts (ältere Karten)
    ]),
  };
}

/** Name + Nummer lesen. Liefert { text, ms, engine } oder null, wenn kein OCR-Motor verfügbar ist. */
export async function readCardText(src, rect, opts = {}) {
  const eng = await getOcr();
  if (!eng) return null;
  const t0 = performance.now();
  const text = await eng.read(ocrCanvases(src, rect, opts));
  return { text: String(text || ""), ms: performance.now() - t0, engine: eng.kind };
}
