// PokeSwipe & Radar – Ziffern-Vorlagen für die Kartennummer-Erkennung zeichnen.
// Gemeinsam genutzt vom Web Worker (OffscreenCanvas) und vom Haupt-Thread (normales <canvas>) als Rückfall für Browser,
// deren Worker kein OffscreenCanvas bzw. keinen 2D-Kontext darin kennen (z. B. ältere iOS-/Safari-Versionen).

export const GLYPH_FONTS = [
  "bold 56px Arial, Helvetica, sans-serif",
  "56px Arial, Helvetica, sans-serif",
  "bold 56px 'Roboto Condensed', 'Arial Narrow', sans-serif",
  "600 56px Verdana, sans-serif",
];
export const GLYPH_CHARS = "0123456789/";
const GW = 64, GH = 80;

/**
 * Zeichnet alle Vorlagen auf eine 64×80-Leinwand und liefert die beschnittenen Schwarz/Weiß-Bitmaps
 * ({ ch, w, h, bits: Float32Array }). `cv` ist ein OffscreenCanvas oder ein HTMLCanvasElement.
 * Ohne 2D-Kontext → leere Liste (kein Fehler).
 */
export function renderGlyphBitmaps(cv) {
  if (!cv) return [];
  cv.width = GW; cv.height = GH;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const out = [];
  for (const font of GLYPH_FONTS) for (const squeeze of [1, 0.8]) for (const ch of GLYPH_CHARS) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, GW, GH);
    ctx.setTransform(squeeze, 0, 0, 1, 32 * (1 - squeeze), 0);
    ctx.fillStyle = "#000"; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ch, 32, 42);
    const { data } = ctx.getImageData(0, 0, GW, GH);
    let x0 = GW, y0 = GH, x1 = -1, y1 = -1;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (data[(y * GW + x) * 4] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const bits = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = data[((y0 + y) * GW + x0 + x) * 4] < 128 ? 1 : 0;
    out.push({ ch, w, h, bits });
  }
  return out;
}
