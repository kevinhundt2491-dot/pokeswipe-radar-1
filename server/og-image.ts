// Phase 4: dynamische OpenGraph-Vorschaubilder (1200×630 JPEG) für öffentliche Profile und Pull-Wall-Beiträge.
// WhatsApp, Telegram, Facebook, X & Co. zeigen keine SVGs – daher ein echtes JPEG: Verlauf + aufgefächerte Kartenbilder.
import jpeg from "jpeg-js";

export type Rgba = { width: number; height: number; data: Uint8Array };
export const OG_W = 1200, OG_H = 630;

/** Hintergrund: dunkler Verlauf (Navy → Violett) mit gelber Akzentleiste unten. */
function background(accent: [number, number, number]): Uint8Array {
  const buf = new Uint8Array(OG_W * OG_H * 4);
  for (let y = 0; y < OG_H; y++) {
    for (let x = 0; x < OG_W; x++) {
      const t = (x / OG_W) * 0.6 + (y / OG_H) * 0.4;
      const glow = Math.max(0, 1 - Math.hypot(x - OG_W * 0.5, y - OG_H * 0.45) / 520) * 40;
      const i = (y * OG_W + x) * 4;
      buf[i] = Math.min(255, 7 + t * 40 + glow * 0.6);
      buf[i + 1] = Math.min(255, 10 + t * 12 + glow * 0.4);
      buf[i + 2] = Math.min(255, 20 + t * 70 + glow);
      buf[i + 3] = 255;
    }
  }
  for (let y = OG_H - 14; y < OG_H; y++) for (let x = 0; x < OG_W; x++) {
    const i = (y * OG_W + x) * 4;
    buf[i] = accent[0]; buf[i + 1] = accent[1]; buf[i + 2] = accent[2];
  }
  return buf;
}

/** Zeichnet ein Bild skaliert (bilinear) und leicht gedreht mit Schatten und abgerundeten Ecken. */
function drawCard(dst: Uint8Array, img: Rgba, cx: number, cy: number, h: number, angleDeg: number) {
  const w = Math.round((img.width / img.height) * h);
  const a = (angleDeg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const half = Math.ceil(Math.hypot(w, h) / 2) + 16;
  const radius = Math.max(6, Math.round(w * 0.045));
  for (let y = Math.max(0, cy - half); y < Math.min(OG_H, cy + half); y++) {
    for (let x = Math.max(0, cx - half); x < Math.min(OG_W, cx + half); x++) {
      // Rücktransformation in Kartenkoordinaten
      const dx = x - cx, dy = y - cy;
      const u = dx * cos + dy * sin + w / 2, v = -dx * sin + dy * cos + h / 2;
      const i = (y * OG_W + x) * 4;
      // Schatten (versetzt, weich)
      const su = u - 10, sv = v - 14;
      if (su > -12 && su < w + 12 && sv > -12 && sv < h + 12 && !(u >= 0 && u < w && v >= 0 && v < h)) {
        const d = Math.max(0, Math.max(-su, su - w, -sv, sv - h));
        const k = 0.45 * (1 - Math.min(1, d / 12));
        dst[i] *= 1 - k; dst[i + 1] *= 1 - k; dst[i + 2] *= 1 - k;
      }
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      // abgerundete Ecken
      const ex = u < radius ? radius - u : u > w - radius ? u - (w - radius) : 0;
      const ey = v < radius ? radius - v : v > h - radius ? v - (h - radius) : 0;
      if (ex && ey && ex * ex + ey * ey > radius * radius) continue;
      const sx = (u / w) * (img.width - 1), sy = (v / h) * (img.height - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + ch], p10 = img.data[(y0 * img.width + x1) * 4 + ch];
        const p01 = img.data[(y1 * img.width + x0) * 4 + ch], p11 = img.data[(y1 * img.width + x1) * 4 + ch];
        dst[i + ch] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
    }
  }
}

/**
 * Collage aus bis zu 5 Karten, aufgefächert wie ein Kartenblatt (wertvollste in der Mitte, ganz vorne).
 * Ohne Karten: nur Verlauf (die Plattformen zeigen Titel & Beschreibung aus den Meta-Tags daneben).
 */
export function composeCardFan(cards: Rgba[], accent: [number, number, number] = [255, 203, 5]): Uint8Array {
  const dst = background(accent);
  const list = cards.slice(0, 5);
  const n = list.length;
  if (n) {
    const h = n === 1 ? 520 : 470;
    // Reihenfolge des Zeichnens: außen zuerst, Mitte (Index 0 = wertvollste) zuletzt
    const slots = n === 1 ? [0] : Array.from({ length: n }, (_, k) => k - (n - 1) / 2);
    // Zuordnung: wertvollste Karte (Index 0) bekommt die mittlere Position, die nächsten rücken nach außen
    const bySlot = [...slots].sort((a, b) => Math.abs(a) - Math.abs(b));
    const placed = list.map((img, idx) => ({ img, slot: bySlot[idx] }));
    placed.sort((a, b) => Math.abs(b.slot) - Math.abs(a.slot));
    for (const p of placed) {
      const cx = Math.round(OG_W / 2 + p.slot * 200);
      const cy = Math.round(OG_H / 2 - 6 + Math.abs(p.slot) * 22);
      drawCard(dst, p.img, cx, cy, h - Math.abs(p.slot) * 30, p.slot * 7);
    }
  }
  return dst;
}

export function encodeJpeg(rgba: Uint8Array, quality = 82): Uint8Array {
  const out = jpeg.encode({ data: rgba, width: OG_W, height: OG_H }, quality);
  return new Uint8Array(out.data);
}

export function decodeJpeg(buf: Uint8Array): Rgba | null {
  try {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 6, maxMemoryUsageInMB: 96 });
    return img.width > 20 && img.height > 20 ? { width: img.width, height: img.height, data: img.data as Uint8Array } : null;
  } catch { return null; }
}
