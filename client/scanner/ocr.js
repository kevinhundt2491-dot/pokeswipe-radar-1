// PokeSwipe & Radar – Texterkennung ohne KI für den Live-Scanner und Foto-Scans.
//
// Motor: browsereigener TextDetector (Shape Detection API, wo verfügbar) – sonst Tesseract.js (WebAssembly in eigenen
// Workern, Dateien selbst gehostet unter /assets/ocr/, kein CDN, nichts verlässt das Gerät).
// Zwei Leser laufen parallel:
//   • Name   – Namenszeile oben (Buchstaben, Umlaute, Bindestrich),
//   • Nummer – Nummernzone unten links und unten rechts, nur Ziffern, „/“ und Großbuchstaben (TG12, SVP 085, SWSH123).
// Die Zuschnitte werden in Graustufen umgerechnet, Spiegelungen (Holo/Folie) gekappt, der Kontrast gestreckt und helle
// Schrift auf dunklem Grund (Full-Art) invertiert. Sie haben bewusst Luft: die Karte muss nicht exakt im Rahmen liegen.

const OCR_BASE = "/assets/ocr";
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüßéÉèêàâç-'’ ";
const NUMBER_CHARS = "0123456789/ ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let engine = null; // { kind, read({ name, number }) → Promise<string> }
let starting = null;
let workers = [];

async function textDetectorEngine() {
  if (typeof window === "undefined" || typeof window.TextDetector !== "function") return null;
  try {
    const td = new window.TextDetector();
    // Manche Browser kennen die Klasse, liefern aber nie Ergebnisse (Flag aus) – einmal mit leerem Bild prüfen
    const probe = document.createElement("canvas");
    probe.width = 8; probe.height = 8;
    await td.detect(probe);
    const one = async (cv) => (await td.detect(cv)).map((t) => t.rawValue).join("\n");
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
  const [nameW, numW] = await Promise.all([createWorker("eng", 1, opts), createWorker("eng", 1, opts)]);
  await Promise.all([
    nameW.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: NAME_CHARS, user_defined_dpi: "300" }),
    numW.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: NUMBER_CHARS, user_defined_dpi: "300" }),
  ]);
  workers = [nameW, numW];
  const text = async (w, cv) => (await w.recognize(cv)).data.text || "";
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
 * Zuschnitt in Graustufen, Spiegelungen kappen (oberste 3 % der Helligkeit), Kontrast auf 0…255 strecken,
 * bei dunklem Hintergrund (Full-Art, helle Schrift) invertieren – Tesseract liest dunkle Schrift auf hellem Grund am besten.
 */
export function enhanceStrip(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    hist[gray[i]]++;
  }
  const pct = (p) => { let acc = 0; const lim = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lim) return v; } return 255; };
  const lo = pct(0.02), hi = Math.max(lo + 24, pct(0.97)); // hi < 255: Glanzlichter werden gekappt
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const invert = sum / n < 105;
  const k = 255 / (hi - lo);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let v = (Math.min(gray[i], hi) - lo) * k;
    if (invert) v = 255 - v;
    d[j] = d[j + 1] = d[j + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return invert;
}

/** Zuschnitte untereinander auf eine weiße Fläche setzen. */
function stack(parts, width, gap = 14) {
  const cv = document.createElement("canvas");
  cv.width = width; cv.height = Math.max(1, parts.reduce((s, p) => s + p.height + gap, 0));
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  let oy = 0;
  for (const p of parts) { ctx.drawImage(p, 0, oy); oy += p.height + gap; }
  return cv;
}

/**
 * Lese-Bilder: Namenszeile (oben, linke 80 %) und Nummernzonen unten links/rechts (die Sammlernummer steht je nach Ära
 * links oder rechts) – jeweils stark vergrößert, damit die kleine Nummer ~30 px hoch ist.
 * `rect` = achsenparalleles Rechteck der Karte im Quellbild ({x, y, w, h}); die Zuschnitte haben Luft nach außen
 * (Karte schief, zu nah, zu weit, neben der Mitte).
 */
export function ocrCanvases(src, rect, { width = 900, tight = false } = {}) {
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  const clamp = (r) => {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.max(1, Math.min(sw - x, r.w - (x - r.x))), h: Math.max(1, Math.min(sh - y, r.h - (y - r.y))) };
  };
  const { x, y, w, h } = rect;
  const zone = (r, pw) => {
    const z = clamp(r);
    const ph = Math.max(8, Math.round((z.h / z.w) * pw));
    const c = document.createElement("canvas");
    c.width = pw; c.height = ph;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, z.x, z.y, z.w, z.h, 0, 0, pw, ph);
    enhanceStrip(cx, pw, ph);
    return c;
  };
  // Kartenkanten bekannt („tight“): schmale Streifen genau über Name und Nummer – rund 45 % weniger Pixel und damit
  // deutlich schnellere Texterkennung. Ohne Kanten großzügige Streifen (Karte liegt irgendwo um den Rahmen).
  // Breite 760 px: die Sammlernummer ist damit weiterhin ~30 px hoch (früher 900 px, unnötig langsam).
  const pw = tight ? Math.min(width, 760) : width;
  const nameW = Math.round(pw * 0.8);
  const nz = tight ? { y: y + h * 0.005, h: h * 0.11 } : { y: y - h * 0.03, h: h * 0.17 };
  const bz = tight ? { y: y + h * 0.88, h: h * 0.11 } : { y: y + h * 0.86, h: h * 0.17 };
  return {
    name: stack([zone({ x: x - w * 0.03, y: nz.y, w: w * 0.8, h: nz.h }, nameW)], nameW),
    number: stack([
      zone({ x: x - w * 0.04, y: bz.y, w: w * 0.56, h: bz.h }, pw), // unten links (Karmesin & Purpur, Schwert & Schild)
      zone({ x: x + w * 0.48, y: bz.y, w: w * 0.56, h: bz.h }, pw), // unten rechts (ältere Karten)
    ], pw),
  };
}

/** Name + Nummer lesen. Liefert { text, ms, engine } oder null, wenn kein OCR-Motor verfügbar ist. */
export async function readCardText(src, rect, opts = {}) {
  if (rect?.tight) opts = { ...opts, tight: true };
  const eng = await getOcr();
  if (!eng) return null;
  const t0 = performance.now();
  const text = await eng.read(ocrCanvases(src, rect, opts));
  return { text: String(text || ""), ms: performance.now() - t0, engine: eng.kind };
}
