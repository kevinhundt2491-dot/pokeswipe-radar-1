// Szenen-Compositor für die Pro-Videos (1080×1920): legt Cover, Fokus-Zoom auf die echte App,
// Feature-Badges, Vertrauens-Infografik, Endscreen und Untertitel über die Live-Aufnahme.
// Jeder Frame wird aus der Videozeit t berechnet – Frame 0 ist bereits das fertige Cover (= Vorschaubild).
//
// Sicherer Bereich: Instagram/YouTube/Facebook legen oben (≈ 220 px), unten (≈ 380 px) und rechts (≈ 150 px)
// Bedienelemente über das Video. Texte und Untertitel bleiben deshalb in x 80–930, y 230–1500.

import { OUT_W as W, OUT_H as H } from "./live-stage.js";
import { DOMAIN, CTA_TEXT, isHook4, isShowcase, SHOWCASE_PRO_AT } from "./reel-pro.js";

const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const DISPLAY = `"Lilita One", "Figtree", system-ui, ${EMOJI}, sans-serif`;
const BODY = `"Figtree", system-ui, ${EMOJI}, sans-serif`;
const SAFE = { left: 80, right: 930, top: 230, bottom: 1500 };
const CX = (SAFE.left + SAFE.right) / 2; // optische Mitte links der Plattform-Buttons
const CAP_Y = 1330; // Untertitel-Mitte
const CAP_Y_PHONE = 1462; // Untertitel unter dem großen Smartphone (Fokus-Szene) – verdeckt keine Buttons/Karten
// Worauf die Kamera in der Fokus-Szene zielt (Highlight der jeweiligen Funktion)
const HIGHLIGHT = {
  overview: "📡 Live-Preise · 👆 Swipe · 🛡️ Käuferschutz",
  radar: "💶 Cardmarket vs. TCGplayer – live",
  swipe: "👆 Swipe-Entdecker in Aktion",
  market: "🛡️ Marktplatz mit Käuferschutz",
  portfolio: "📈 Portfolio-Wertentwicklung live",
  scansell: "📸 Scannen → 💰 Preis → 🚀 Live",
  quicklist: "⚡ Scannen → Preis steht → Inserat live",
};
const XFADE = 0.35; // weicher Übergang (s)
// Hook-Presets: engere Safe Zone für TikTok / Reels / Shorts (rechter Icon-Balken ab x ≈ 930,
// Caption- und Musikzeile unten ab y ≈ 1450). Alle Texte bleiben in x 80–920, y 250–1440.
const HZ = { left: 80, right: 920, top: 250, bottom: 1440 };
const HX = (HZ.left + HZ.right) / 2;
const CAP_Y_HOOK = 1352;
const GREEN = "#22c55e", RED = "#ef4444";
// Showcase: Untertitel unter dem Smartphone (y ≈ 1345–1440, oberhalb der Caption-/Musikzeile der Plattformen),
// im Abschluss zwischen Smartphone und Domain-Lockup
const CAP_Y_SHOWCASE = 1392, CAP_Y_FINALE = 1010;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); }; // Smootherstep – ruckfreie Kamerafahrten
// Showcase-Kamera (Zeit in s auf 29 s normiert): Bildschirmmitte, Maßstab (1 = 520×924 px Bildschirm), Neigung
const SC_CAMERA = [
  [0, { cx: 505, cy: 880, s: 1.0, rot: -0.03 }], [1.1, { cx: 505, cy: 868, s: 1.0, rot: -0.012 }], [5.4, { cx: 505, cy: 856, s: 1.0, rot: 0 }],
  [6.6, { cx: 505, cy: 850, s: 1.02, rot: 0.01 }], [14.4, { cx: 505, cy: 846, s: 1.06, rot: 0.004 }],
  [15.4, { cx: 505, cy: 850, s: 1.0, rot: -0.008 }], [18.9, { cx: 505, cy: 850, s: 1.02, rot: 0.006 }],
  [19.8, { cx: 505, cy: 700, s: 0.8, rot: 0 }], [22.7, { cx: 505, cy: 700, s: 0.8, rot: 0 }],
  [23.7, { cx: 505, cy: 640, s: 0.66, rot: 0 }], [29, { cx: 505, cy: 634, s: 0.68, rot: 0 }],
];
// Bildschirm-Zoom je Zeitfenster [von, bis, Zoom] – 1,0 zeigt die ganze App inkl. 5-Reiter-Navigation
const SC_ZOOM = [
  [0.25, 2.35, 1.4], [2.35, 4.85, 1.26], [4.85, 6.6, 1.0], [6.6, 11.0, 1.1], [11.0, 13.6, 1.32], [13.6, 16.0, 1.0],
  [16.0, 17.2, 1.22], [17.2, 23, 1.0],
]; 
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { const c = 1.6; x = clamp(x); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Schriften laden, damit schon Frame 0 mit der echten Markenschrift gezeichnet wird. */
export async function loadProFonts() {
  try {
    await Promise.all(["400 80px \"Lilita One\"", "900 40px Figtree", "800 40px Figtree", "700 40px Figtree"].map((f) => document.fonts.load(f, "PokeSwipe Radar ÄÖÜäöüß€ Schnäppchen Flohmarkt-Fund Nächstes")));
  } catch { /* System-Schrift als Rückfall */ }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Text in Zeilen umbrechen (max. Breite). */
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
/** Größte Schriftgröße, bei der der Text in maxLines Zeilen passt. */
function fitText(ctx, text, font, maxW, maxLines, from, to = 40) {
  for (let s = from; s >= to; s -= 4) { ctx.font = font(s); const l = wrap(ctx, text, maxW); if (l.length <= maxLines) return { size: s, lines: l }; }
  ctx.font = font(to); return { size: to, lines: wrap(ctx, text, maxW) };
}

export class ProCompositor {
  /**
   * @param {object} o
   * @param {object} o.tpl      Vorlage aus reel-pro.js
   * @param {string} o.cover    Cover-Schlagzeile
   * @param {Array} o.scenes    sceneTimes()
   * @param {Array} o.captions  captionChunks()
   * @param {() => ({x:number,y:number}|null)} [o.focus]  Fingerposition in Ausgabe-Pixeln (für den Fokus-Zoom)
   * @param {object} [o.facts]
   */
  constructor({ tpl, cover, badge = "", look = null, coverCard = null, scenes, captions, focus = () => null, facts = {}, fade = 0, pressed = () => false, cards = () => [] }) {
    Object.assign(this, { tpl, cover, badge, coverCard, scenes, captions, focus, facts, fade, pressed, cards });
    this.showcase = isShowcase(tpl);
    if (this.showcase && typeof Image !== "undefined") { this.icon = new Image(); this.icon.decoding = "async"; this.icon.src = "/icons/icon-512.png"; }
    this.accent = look?.accent || tpl.accent || "#ffcb05";
    this.layout = look?.layout || "left";
    this.m = 1; // Deckkraft-Faktor (für Überblendungen)
    this.reset();
    this.bg = this.#background();
    this.blur = document.createElement("canvas"); this.blur.width = W / 12; this.blur.height = H / 12;
  }

  /** Statischer Dark-Mode-Neon-Hintergrund (einmal vorberechnet). */
  #background() {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, "#070a18"); lg.addColorStop(0.55, "#0c1226"); lg.addColorStop(1, "#131a33");
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(120,140,255,0.07)"; g.lineWidth = 2;
    for (let x = 0; x <= W; x += 90) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 90) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    return c;
  }

  /** Kamera-Zustand zurücksetzen (nach dem Vorschaubild, vor Frame 0 der Aufnahme). */
  reset() {
    this.fx = 0.5; this.fy = 0.42; // geglättete Zoom-Mitte (normiert 0–1 im Live-Bild)
    this.zoom = this.showcase ? 1.25 : 1.1;
    this.lastT = 0;
    this.ripples = []; this.down = false;
  }

  /** Zeitbasierte Glättung (unabhängig von der Framerate): Anteil, um den sich ein Wert in dt Sekunden annähert. */
  #follow(t, rate) {
    const dt = clamp(t - this.lastT, 0, 0.12);
    return 1 - Math.exp(-dt * rate);
  }

  #backdrop(ctx, t) {
    ctx.drawImage(this.bg, 0, 0);
    // zwei langsam wandernde Neon-Lichter
    const blob = (x, y, r, col) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    ctx.globalCompositeOperation = "lighter";
    blob(W * 0.2 + Math.sin(t * 0.6) * 80, H * 0.25 + Math.cos(t * 0.4) * 60, 620, hexA(this.accent, 0.22));
    blob(W * 0.85 + Math.cos(t * 0.5) * 70, H * 0.72 + Math.sin(t * 0.45) * 90, 700, "rgba(217,54,62,0.18)");
    ctx.globalCompositeOperation = "source-over";
  }

  #logo(ctx, x, y, size, align = "center") {
    ctx.save();
    ctx.font = `400 ${size}px ${DISPLAY}`; ctx.textBaseline = "middle";
    const label = "PokeSwipe Radar", tw = ctx.measureText(label).width, r = size * 0.55, gap = size * 0.35;
    const total = r * 2 + gap + tw;
    const x0 = align === "center" ? x - total / 2 : x;
    // Radar-Linse
    const cx = x0 + r, cy = y;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, "#c8ecff"); g.addColorStop(0.25, "#4a9be0"); g.addColorStop(1, "#1f4f87");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = r * 0.18; ctx.strokeStyle = "#f3efe4"; ctx.stroke();
    ctx.fillStyle = "#f3efe4"; ctx.textAlign = "left";
    ctx.shadowColor = hexA(this.accent, 0.8); ctx.shadowBlur = size * 0.4;
    ctx.fillText("PokeSwipe ", x0 + r * 2 + gap, y);
    ctx.fillStyle = this.accent;
    ctx.fillText("Radar", x0 + r * 2 + gap + ctx.measureText("PokeSwipe ").width, y);
    ctx.restore();
  }

  #pill(ctx, text, x, y, { size = 34, bg = "rgba(12,16,34,0.82)", fg = "#f3efe4", border = this.accent, align = "center", maxW = SAFE.right - SAFE.left } = {}) {
    ctx.save();
    ctx.font = `800 ${size}px ${BODY}`;
    // lange Texte (z. B. Schritt-Overlays) verkleinern, damit die Pille im sicheren Bereich bleibt
    while (size > 20 && ctx.measureText(text).width + size * 1.3 > maxW) { size -= 2; ctx.font = `800 ${size}px ${BODY}`; }
    const w = ctx.measureText(text).width + size * 1.3, h = size * 1.75;
    const x0 = align === "center" ? x - w / 2 : x;
    rr(ctx, x0, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = border; ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x0 + w / 2, y + 1);
    ctx.restore();
    return w;
  }

  /**
   * Echte App in einem schwebenden Dark-Mode-Smartphone (abgerundet, Neon-Glow-Rahmen, Schlagschatten,
   * Dynamic Island, Glas-Reflexion). (x, y, w, h) = Bildschirmfläche. Der Ausschnitt aus dem Live-Bild hat
   * immer exakt das Seitenverhältnis des Bildschirms – nichts wird gestreckt. zoom > 1 = Kamerafahrt auf die Fokus-Mitte.
   */
  #phone(ctx, live, x, y, w, h, zoom = 1, alpha = 1, { spot = null, fx = false, t = 0 } = {}) {
    const bez = Math.max(10, w * 0.034), R = w * 0.12, r = R - bez * 0.6;
    ctx.save();
    ctx.globalAlpha = alpha * this.m;
    // realistischer Schlagschatten (versetzt, weich) + Neon-Glow in der Akzentfarbe
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.75)"; ctx.shadowBlur = w * 0.14; ctx.shadowOffsetY = w * 0.07;
    rr(ctx, x - bez, y - bez, w + bez * 2, h + bez * 2, R); ctx.fillStyle = "#04060d"; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = hexA(this.accent, 0.7); ctx.shadowBlur = w * 0.09;
    rr(ctx, x - bez, y - bez, w + bez * 2, h + bez * 2, R); ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.95); ctx.stroke();
    ctx.restore();
    // Gehäuse: dunkles Metall mit Kantenlicht
    const body = ctx.createLinearGradient(x - bez, y - bez, x + w + bez, y + h + bez);
    body.addColorStop(0, "#2b3045"); body.addColorStop(0.18, "#0b0e19"); body.addColorStop(0.82, "#0b0e19"); body.addColorStop(1, "#242a3f");
    rr(ctx, x - bez, y - bez, w + bez * 2, h + bez * 2, R); ctx.fillStyle = body; ctx.fill();
    rr(ctx, x - bez + 2, y - bez + 2, w + bez * 2 - 4, h + bez * 2 - 4, R - 2); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.stroke();
    // Seitentasten
    ctx.fillStyle = "#1a1f30";
    rr(ctx, x + w + bez - 1, y + h * 0.2, bez * 0.45, h * 0.09, 3); ctx.fill();
    rr(ctx, x - bez - bez * 0.45 + 1, y + h * 0.16, bez * 0.45, h * 0.06, 3); ctx.fill();
    rr(ctx, x - bez - bez * 0.45 + 1, y + h * 0.24, bez * 0.45, h * 0.06, 3); ctx.fill();
    // Bildschirm mit der echten App
    ctx.save();
    rr(ctx, x, y, w, h, r); ctx.clip();
    if (live) {
      const LW = live.width, LH = live.height;
      const base = Math.min(LW / w, LH / h);
      const sw = (w * base) / zoom, sh = (h * base) / zoom;
      const sx = clamp(this.fx * LW - sw / 2, 0, LW - sw), sy = clamp(this.fy * LH - sh / 2, 0, LH - sh);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(live, sx, sy, sw, sh, x, y, w, h);
      if (fx) this.#screenFx(ctx, t, { x, y, w, h, sx, sy, sw, sh, LW, LH });
      // Spotlight auf die Stelle, die gerade bedient wird
      if (spot) {
        const px = x + ((spot.x * LW - sx) / sw) * w, py = y + ((spot.y * LH - sy) / sh) * h;
        if (px > x && px < x + w && py > y && py < y + h) {
          const rad = w * 0.2;
          const v = ctx.createRadialGradient(px, py, rad * 0.6, px, py, Math.max(w, h));
          v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(3,5,12,${0.42 * spot.a})`);
          ctx.fillStyle = v; ctx.fillRect(x, y, w, h);
          ctx.beginPath(); ctx.arc(px, py, rad * (0.55 + 0.06 * Math.sin(spot.t * 6)), 0, Math.PI * 2);
          ctx.lineWidth = 5; ctx.strokeStyle = hexA(this.accent, 0.85 * spot.a); ctx.shadowColor = this.accent; ctx.shadowBlur = 24; ctx.stroke();
        }
      }
    } else { ctx.fillStyle = "#0c1022"; ctx.fillRect(x, y, w, h); }
    // Glas-Reflexion
    const gl = ctx.createLinearGradient(x, y, x + w * 0.9, y + h * 0.55);
    gl.addColorStop(0, "rgba(255,255,255,0.10)"); gl.addColorStop(0.35, "rgba(255,255,255,0.03)"); gl.addColorStop(0.36, "rgba(255,255,255,0)");
    ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
    ctx.restore();
    // Dynamic Island
    const iw = w * 0.22, ih = Math.max(12, w * 0.052);
    rr(ctx, x + w / 2 - iw / 2, y + h * 0.01, iw, ih, ih / 2); ctx.fillStyle = "#000"; ctx.fill();
    ctx.restore();
  }

  #heading(ctx, text, y, p, size = 64) {
    ctx.save();
    ctx.globalAlpha = ease(p * 3) * this.m;
    const { size: s, lines } = fitText(ctx, text, (n) => `400 ${n}px ${DISPLAY}`, SAFE.right - SAFE.left, 2, size, 44);
    ctx.font = `400 ${s}px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#f3efe4"; ctx.shadowColor = hexA(this.accent, 0.7); ctx.shadowBlur = 24;
    lines.forEach((l, i) => ctx.fillText(l, CX, y + i * s * 1.1 + (1 - ease(p * 3)) * 30));
    ctx.restore();
  }

  // ---------------------------------------------------------------- Szenen
  /**
   * 1 · Cover = Vorschaubild im Profil-Raster. Ab Frame 0 zu 100 % fertig (keine Einblendung):
   * Themen-Badge, echte App-Ansicht im Mockup, echtes Kartenmotiv mit Live-Preis und Preiskurve,
   * fette Schlagzeile. Layout (links/rechts/schräg) und Akzentfarbe rotieren je Video.
   * Alles liegt in y 300–1640 – so bleibt es auch im 3:4-Ausschnitt des Instagram-Rasters sichtbar.
   */
  sceneCover(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    // hellere Bühne in der Akzentfarbe
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(CX, 780, 40, CX, 780, 760);
    glow.addColorStop(0, hexA(this.accent, 0.42)); glow.addColorStop(0.6, hexA(this.accent, 0.12)); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // Themen-Badge
    this.#pill(ctx, this.badge || this.tpl.label.toUpperCase(), CX, 335, { size: 42, bg: this.accent, fg: "#0b0f22", border: "#ffffff" });
    const L = this.layout, bob = Math.sin(t * 1.8) * 8; // Bewegung erst ab t > 0 – Frame 0 ist exakt das Vorschaubild
    const pw = 400, ph = 711;
    const mock = L === "right" ? { x: SAFE.right - pw, y: 430, rot: 0.035 } : L === "tilt" ? { x: CX - pw / 2 - 90, y: 425, rot: -0.14 } : { x: SAFE.left + 20, y: 430, rot: -0.035 };
    const card = L === "right" ? { x: 300, y: 720, rot: -0.12 } : L === "tilt" ? { x: CX + 215, y: 800, rot: 0.16 } : { x: 725, y: 720, rot: 0.12 };
    const panel = L === "right" ? { x: SAFE.left, y: 985 } : L === "tilt" ? { x: SAFE.left, y: 1000 } : { x: SAFE.right - 390, y: 985 };
    // echte App-Ansicht der Funktion, um die es im Video geht
    ctx.save();
    ctx.translate(mock.x + pw / 2, mock.y + ph / 2); ctx.rotate(mock.rot); ctx.translate(-pw / 2, -ph / 2);
    this.fx = 0.5; this.fy = 0.5;
    this.#phone(ctx, live, 0, 0, pw, ph, 1);
    ctx.restore();
    this.#coverCard(ctx, card.x, card.y + bob, card.rot);
    this.#pricePanel(ctx, panel.x, panel.y);
    // Schlagzeile
    ctx.save();
    const { size, lines } = fitText(ctx, this.cover, (n) => `400 ${n}px ${DISPLAY}`, SAFE.right - SAFE.left, 3, 104, 60);
    ctx.font = `400 ${size}px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lh = size * 1.06, mid = 1335;
    lines.forEach((l, i) => {
      const y = mid + (i - (lines.length - 1) / 2) * lh;
      ctx.lineJoin = "round"; ctx.lineWidth = 16; ctx.strokeStyle = "#05070f"; ctx.strokeText(l, CX, y);
      ctx.fillStyle = i === 0 ? this.accent : "#ffffff";
      ctx.fillText(l, CX, y);
    });
    ctx.restore();
    // Marke + Domain
    this.#logo(ctx, CX, 1560, 46);
    ctx.save(); ctx.font = `800 30px ${BODY}`; ctx.fillStyle = "#e7e9f7"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(DOMAIN, CX, 1625); ctx.restore();
  }

  /** Echtes Kartenmotiv (oder neutrale Silhouette, falls kein Bild geladen werden konnte). */
  #coverCard(ctx, x, y, rot) {
    const c = this.coverCard, cw = 330, ch = 460;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.shadowColor = this.accent; ctx.shadowBlur = 70;
    rr(ctx, -cw / 2 - 8, -ch / 2 - 8, cw + 16, ch + 16, 26); ctx.fillStyle = this.accent; ctx.fill();
    ctx.shadowBlur = 0;
    rr(ctx, -cw / 2, -ch / 2, cw, ch, 20); ctx.save(); ctx.clip();
    if (c?.img) ctx.drawImage(c.img, -cw / 2, -ch / 2, cw, ch);
    else {
      const g = ctx.createLinearGradient(-cw / 2, -ch / 2, cw / 2, ch / 2);
      g.addColorStop(0, "#2a2147"); g.addColorStop(1, "#0b0f22"); ctx.fillStyle = g; ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.fillStyle = "rgba(255,255,255,0.12)"; rr(ctx, -cw / 2 + 24, -ch / 2 + 50, cw - 48, ch * 0.45, 14); ctx.fill();
    }
    ctx.restore();
    if (c?.price) {
      const label = eurFmt(c.price);
      ctx.font = `400 52px ${DISPLAY}`;
      const w = ctx.measureText(label).width + 44;
      rr(ctx, cw / 2 - w + 24, ch / 2 - 46, w, 78, 39); ctx.fillStyle = "#0b0f22"; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = this.accent; ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, cw / 2 - w / 2 + 24, ch / 2 - 5);
    }
    ctx.restore();
  }

  /** Live-Preisdaten der Karte: Kurve aus dem echten Verlauf, Cardmarket-Trend, TCGplayer, 30-Tage-Änderung. */
  #pricePanel(ctx, x, y) {
    const c = this.coverCard;
    if (!c?.price) return;
    const w = 390, h = 160;
    ctx.save();
    rr(ctx, x, y, w, h, 26); ctx.fillStyle = "rgba(8,11,26,0.92)"; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.8); ctx.stroke();
    const hist = (c.history || []).map(Number).filter((v) => v > 0);
    if (hist.length >= 2) {
      const min = Math.min(...hist), max = Math.max(...hist), span = max - min || 1;
      const gx = x + 20, gy = y + 92, gw = w - 40, gh = 52;
      const pts = hist.map((v, i) => [gx + (i / (hist.length - 1)) * gw, gy + gh - ((v - min) / span) * gh]);
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.lineTo(gx + gw, gy + gh); ctx.lineTo(gx, gy + gh); ctx.closePath(); ctx.fillStyle = hexA(this.accent, 0.18); ctx.fill();
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.strokeStyle = this.accent; ctx.stroke();
      const [lx, ly] = pts[pts.length - 1];
      ctx.beginPath(); ctx.arc(lx, ly, 9, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
    }
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.font = `800 24px ${BODY}`; ctx.fillStyle = "#cfd3ea";
    ctx.fillText(String(c.name || "").slice(0, 26), x + 20, y + 28);
    const parts = [`CM ${eurFmt(c.price)}`, c.usd ? `TCG $${Number(c.usd).toFixed(2).replace(".", ",")}` : ""].filter(Boolean).join("  ·  ");
    let fs = 30;
    do { ctx.font = `900 ${fs}px ${BODY}`; fs -= 2; } while (ctx.measureText(parts).width > w - 40 && fs > 18);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(parts, x + 20, y + 64);
    if (c.avg30 > 0) {
      const ch = ((c.price - c.avg30) / c.avg30) * 100;
      ctx.font = `900 26px ${BODY}`; ctx.textAlign = "right"; ctx.fillStyle = ch >= 0 ? "#34d399" : "#fb7185";
      ctx.fillText(`${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)} %`, x + w - 20, y + 28);
    }
    ctx.restore();
  }

  /**
   * 2 · Fokus-Szene: schwebendes Smartphone mit langsamer Kamerafahrt (Push-in + leichte Neigung). Im Bildschirm
   * fährt die Kamera gezielt auf die Stelle, an der die App gerade bedient wird (Preisvergleich, Swipe-Karte,
   * Käuferschutz-Badge, Portfolio-Wert) – mit Spotlight. Ohne Interaktion: sanfter Ken-Burns-Schwenk.
   */
  focusScene(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    const f = this.focus();
    const tx = f ? f.x : 0.5, ty = f ? f.y : 0.36 + 0.1 * Math.sin(t * 0.55);
    const k = this.#follow(t, f ? 3.2 : 1.4), kz = this.#follow(t, 1.8);
    this.fx += (tx - this.fx) * k; this.fy += (ty - this.fy) * k;
    this.zoom += ((f ? 1.6 : 1.14 + 0.08 * ease(p)) - this.zoom) * kz;
    const w = 580, h = 1031, x = CX - w / 2, y = 335;
    const push = 1 + 0.045 * ease(p), tilt = Math.sin(t * 0.7) * 0.012, bob = Math.sin(t * 1.3) * 6;
    ctx.save();
    ctx.translate(CX, y + h / 2 + bob); ctx.rotate(tilt); ctx.scale(push, push); ctx.translate(-CX, -(y + h / 2));
    this.#phone(ctx, live, x, y, w, h, this.zoom, 1, { spot: f ? { x: f.x, y: f.y, a: clamp((this.zoom - 1.14) / 0.4), t } : null });
    ctx.restore();
    this.#pill(ctx, this.tpl.highlight || HIGHLIGHT[this.tpl.key] || this.tpl.label, CX, 250, { size: 36 });
  }

  /** 3 · Nutzen: kleine Live-Ansicht + animierte Feature-Badges und Kennzahlen. */
  sceneBenefit(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    this.#heading(ctx, this.tpl.headings?.benefit || "Warum das genial ist 💡", 290, p, 70);
    // Kennzahlen
    const stats = this.tpl.stats || [];
    const sw = 250, gap = 20, total = stats.length * sw + (stats.length - 1) * gap;
    stats.forEach(([big, small], i) => {
      const a = ease((p - 0.04 - i * 0.07) * 5);
      if (a <= 0) return;
      const x = CX - total / 2 + i * (sw + gap), y = 380 + (1 - a) * 40;
      ctx.save(); ctx.globalAlpha = a * this.m;
      rr(ctx, x, y, sw, 150, 26); ctx.fillStyle = "rgba(20,26,54,0.92)"; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.6); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const fs = fitText(ctx, big, (n) => `400 ${n}px ${DISPLAY}`, sw - 30, 1, 56, 30).size;
      ctx.font = `400 ${fs}px ${DISPLAY}`; ctx.fillStyle = this.accent; ctx.fillText(big, x + sw / 2, y + 58);
      ctx.font = `700 28px ${BODY}`; ctx.fillStyle = "#cfd3ea"; ctx.fillText(small, x + sw / 2, y + 112);
      ctx.restore();
    });
    // Live-Ansicht links, leicht gezoomt
    const kb = this.#follow(t, 1.2);
    this.fx += (0.5 - this.fx) * kb; this.fy += (0.36 - this.fy) * kb;
    ctx.save();
    const pcx = SAFE.left + 190, pcy = 900 + Math.sin(t * 1.4) * 6;
    ctx.translate(pcx, pcy); ctx.rotate(-0.04 + Math.sin(t * 0.8) * 0.01); ctx.translate(-pcx, -pcy);
    this.#phone(ctx, live, SAFE.left + 10, 580, 360, 640, 1.12 + 0.12 * ease(p));
    ctx.restore();
    // Badges rechts, nacheinander einfliegend
    (this.tpl.badges || []).forEach((b, i) => {
      const a = back((p - 0.12 - i * 0.12) * 4);
      if (a <= 0) return;
      const x = 500 + (1 - clamp(a)) * 300, y = 640 + i * 150;
      ctx.save(); ctx.globalAlpha = clamp(a) * this.m;
      rr(ctx, x, y, SAFE.right - 500, 118, 30);
      const g = ctx.createLinearGradient(x, y, SAFE.right, y + 118);
      g.addColorStop(0, hexA(this.accent, 0.3)); g.addColorStop(1, "rgba(20,26,54,0.95)");
      ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.85); ctx.stroke();
      const fs = fitText(ctx, b, (n) => `800 ${n}px ${BODY}`, SAFE.right - 540, 2, 34, 22);
      ctx.font = `800 ${fs.size}px ${BODY}`; ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
      fs.lines.forEach((l, k) => ctx.fillText(l, x + 22, y + 59 + (k - (fs.lines.length - 1) / 2) * fs.size * 1.15));
      ctx.restore();
    });
  }

  /** 4 · Vertrauen & Praxis-Mehrwert: Check-Liste über gedimmter Live-Ansicht. */
  sceneTrust(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    if (live) {
      // günstige Unschärfe: stark verkleinern und wieder hochskalieren
      const b = this.blur.getContext("2d");
      b.drawImage(live, 0, 0, this.blur.width, this.blur.height);
      ctx.save(); ctx.globalAlpha = 0.35 * this.m; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.blur, 0, 0, W, H); ctx.restore();
      ctx.fillStyle = "rgba(7,10,24,0.55)"; ctx.fillRect(0, 0, W, H);
    }
    this.#heading(ctx, this.tpl.headings?.trust || "Darum lieben Sammler PokeSwipe Radar", 300, p, 64);
    (this.tpl.trust || []).forEach((txt, i) => {
      const a = ease((p - 0.06 - i * 0.13) * 4.5);
      if (a <= 0) return;
      const y = 480 + i * 175, x = SAFE.left + 10 + (1 - a) * -80;
      ctx.save(); ctx.globalAlpha = a * this.m;
      rr(ctx, x, y, SAFE.right - SAFE.left - 20, 140, 34); ctx.fillStyle = "rgba(16,22,46,0.9)"; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(52,211,153,0.65)"; ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 75, y + 70, 40, 0, Math.PI * 2); ctx.fillStyle = "#10b981"; ctx.fill();
      ctx.strokeStyle = "#052e1f"; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const k = ease((p - 0.1 - i * 0.13) * 6);
      ctx.beginPath(); ctx.moveTo(x + 56, y + 72); ctx.lineTo(x + 56 + 14 * Math.min(1, k * 2), y + 72 + 14 * Math.min(1, k * 2));
      if (k > 0.5) ctx.lineTo(x + 70 + 24 * (k - 0.5) * 2, y + 86 - 34 * (k - 0.5) * 2);
      ctx.stroke();
      const fs = fitText(ctx, txt, (n) => `800 ${n}px ${BODY}`, SAFE.right - SAFE.left - 190, 2, 42, 28);
      ctx.font = `800 ${fs.size}px ${BODY}`; ctx.fillStyle = "#ffffff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      fs.lines.forEach((l, j) => ctx.fillText(l, x + 140, y + 70 + (j - (fs.lines.length - 1) / 2) * fs.size * 1.15));
      ctx.restore();
    });
  }

  /** 5 · Call-to-Action-Endscreen. */
  sceneCta(ctx, t, p) {
    this.#backdrop(ctx, t);
    const a = ease(p * 4);
    ctx.save(); ctx.globalAlpha = a * this.m;
    // großes Radar-Symbol mit Sweeps
    const cy = 620, R = 210;
    ctx.save(); ctx.translate(CX, cy);
    for (let i = 3; i >= 1; i--) { ctx.beginPath(); ctx.arc(0, 0, (R * i) / 3, 0, Math.PI * 2); ctx.strokeStyle = hexA(this.accent, 0.25 + 0.15 * i); ctx.lineWidth = 5; ctx.stroke(); }
    ctx.rotate(t * 2.4);
    const sweep = ctx.createLinearGradient(0, 0, R, 0);
    sweep.addColorStop(0, hexA(this.accent, 0.7)); sweep.addColorStop(1, hexA(this.accent, 0));
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -0.5, 0); ctx.closePath(); ctx.fillStyle = sweep; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(CX, cy, 26, 0, Math.PI * 2); ctx.fillStyle = this.accent; ctx.fill();
    this.#logo(ctx, CX, 930, 84);
    ctx.font = `800 40px ${BODY}`; ctx.fillStyle = "#cfd3ea"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const cta = this.tpl.cta || null;
    if (cta?.tagline) {
      const ft = fitText(ctx, cta.tagline, (n) => `900 ${n}px ${BODY}`, SAFE.right - SAFE.left, 2, 46, 30);
      ctx.font = `900 ${ft.size}px ${BODY}`; ctx.fillStyle = "#ffffff";
      ft.lines.forEach((l, i) => ctx.fillText(l, CX, 1030 + (i - (ft.lines.length - 1) / 2) * ft.size * 1.15));
    } else ctx.fillText("Die All-in-One-App für Pokémon-Sammler", CX, 1030);
    // pulsierender Button
    const s = 1 + Math.sin(t * 5) * 0.025;
    ctx.save(); ctx.translate(CX, 1190); ctx.scale(s, s);
    const bw = SAFE.right - SAFE.left - 20, bh = 150;
    ctx.shadowColor = this.accent; ctx.shadowBlur = 50;
    rr(ctx, -bw / 2, -bh / 2, bw, bh, 75); ctx.fillStyle = "#ffcb05"; ctx.fill(); ctx.shadowBlur = 0;
    const btn = cta?.button || "Jetzt kostenlos testen";
    const bf = fitText(ctx, btn, (n) => `900 ${n}px ${BODY}`, bw - 60, 1, 50, 30).size;
    ctx.font = `900 ${bf}px ${BODY}`; ctx.fillStyle = "#1a1420"; ctx.fillText(btn, 0, 4);
    ctx.restore();
    this.#pill(ctx, `🔗 ${cta?.link || DOMAIN}`, CX, 1350, { size: 50, border: this.accent });
    ctx.font = `700 30px ${BODY}`; ctx.fillStyle = "#9aa0bf";
    ctx.fillText(cta?.sub || CTA_TEXT, CX, 1450);
    if (cta) { ctx.font = `800 30px ${BODY}`; ctx.fillStyle = this.accent; ctx.fillText("👇 Link in der Bio & im angehefteten Kommentar", CX, 1515); }
    ctx.restore();
  }


  // ================================================================ Hook-Presets (4 Szenen)
  /** Live-App im Smartphone mit Fokus-Zoom auf die gerade bediente Stelle (wie Szene 2, frei platzierbar). */
  #livePhone(ctx, t, p, live, x, y, w, h, { rot = 0, zoomIn = 1.5, rest = 1.12 } = {}) {
    const f = this.focus();
    const tx = f ? f.x : 0.5, ty = f ? f.y : 0.38 + 0.08 * Math.sin(t * 0.55);
    const k = this.#follow(t, f ? 3.2 : 1.4), kz = this.#follow(t, 1.8);
    this.fx += (tx - this.fx) * k; this.fy += (ty - this.fy) * k;
    this.zoom += ((f ? zoomIn : rest + 0.06 * ease(p)) - this.zoom) * kz;
    const bob = Math.sin(t * 1.3) * 5;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 + bob); ctx.rotate(rot + Math.sin(t * 0.7) * 0.01); ctx.translate(-(x + w / 2), -(y + h / 2));
    this.#phone(ctx, live, x, y, w, h, this.zoom, 1, { spot: f ? { x: f.x, y: f.y, a: clamp((this.zoom - rest) / 0.4), t } : null });
    ctx.restore();
    return f;
  }

  /** Kontrast-Banner oben (Hook): volle Safe-Zone-Breite, fette Schrift mit dunkler Kontur, leichtes Pulsieren. */
  #banner(ctx, text, t, y = 268) {
    const v = this.tpl.visual;
    const bg = v === "scan" ? "#facc15" : v === "swipe" ? "#db2777" : RED, fg = v === "scan" ? "#111111" : "#ffffff";
    const w = HZ.right - HZ.left, h = 190;
    const s = 1 + 0.018 * Math.sin(t * 7);
    ctx.save();
    ctx.translate(HX, y + h / 2); ctx.scale(s, s); ctx.rotate(-0.018); ctx.translate(-HX, -(y + h / 2));
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    rr(ctx, HZ.left, y, w, h, 28); ctx.fillStyle = bg; ctx.fill();
    ctx.shadowColor = "transparent";
    if (v === "scan") { // Warn-Streifen
      ctx.save(); rr(ctx, HZ.left, y, w, h, 28); ctx.clip();
      ctx.fillStyle = "#111111";
      for (let x = HZ.left - 60; x < HZ.right + 60; x += 56) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.lineTo(x - 2, y + 18); ctx.lineTo(x - 28, y + 18); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y + h - 18); ctx.lineTo(x + 26, y + h - 18); ctx.lineTo(x - 2, y + h); ctx.lineTo(x - 28, y + h); ctx.fill(); }
      ctx.restore();
    }
    ctx.lineWidth = 5; ctx.strokeStyle = "#ffffff"; rr(ctx, HZ.left, y, w, h, 28); ctx.stroke();
    const ft = fitText(ctx, text, (n) => `400 ${n}px ${DISPLAY}`, w - 60, 2, 92, 52);
    ctx.font = `400 ${ft.size}px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ft.lines.forEach((l, i) => {
      const ly = y + h / 2 + (i - (ft.lines.length - 1) / 2) * ft.size * 1.05 + 4;
      ctx.lineJoin = "round"; ctx.lineWidth = 10; ctx.strokeStyle = fg === "#ffffff" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)"; ctx.strokeText(l, HX, ly);
      ctx.fillStyle = fg; ctx.fillText(l, HX, ly);
    });
    ctx.restore();
  }

  /** Durchgestrichener Preis → großer grüner Preis (Hook-Badge „Marktwert 65 € → Deal 29 €“ / „Verkäufer 45 € vs. Echt 14 €“). */
  #priceDrop(ctx, x, y, w, t) {
    const b = this.tpl.hookBadge;
    if (!b) return;
    const h = 380, s = 1 + 0.03 * Math.sin(t * 6);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s); ctx.rotate(0.03); ctx.translate(-(x + w / 2), -(y + h / 2));
    ctx.shadowColor = hexA(GREEN, 0.6); ctx.shadowBlur = 50;
    rr(ctx, x, y, w, h, 30); ctx.fillStyle = "rgba(6,10,22,0.95)"; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = GREEN; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // oben: alter Preis, rot durchgestrichen
    ctx.font = `800 32px ${BODY}`; ctx.fillStyle = "#fca5a5"; ctx.fillText(b.label, x + w / 2, y + 48);
    ctx.font = `400 84px ${DISPLAY}`; ctx.fillStyle = "#fecaca"; ctx.fillText(b.from, x + w / 2, y + 118);
    const fw = ctx.measureText(b.from).width;
    ctx.lineWidth = 9; ctx.strokeStyle = RED; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + w / 2 - fw / 2 - 12, y + 136); ctx.lineTo(x + w / 2 + fw / 2 + 12, y + 100); ctx.stroke();
    // Pfeil (gezeichnet, nicht als Glyphe – sieht in jeder Schrift gleich aus)
    const ay = y + 182;
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(x + w / 2 - 12, ay - 22); ctx.lineTo(x + w / 2 + 12, ay - 22); ctx.lineTo(x + w / 2 + 12, ay + 2);
    ctx.lineTo(x + w / 2 + 28, ay + 2); ctx.lineTo(x + w / 2, ay + 30); ctx.lineTo(x + w / 2 - 28, ay + 2); ctx.lineTo(x + w / 2 - 12, ay + 2); ctx.closePath(); ctx.fill();
    // unten: neuer Preis, groß und grün
    ctx.font = `800 32px ${BODY}`; ctx.fillStyle = "#bbf7d0"; ctx.fillText(b.tag, x + w / 2, y + 240);
    ctx.font = `400 116px ${DISPLAY}`; ctx.lineJoin = "round"; ctx.lineWidth = 10; ctx.strokeStyle = "#04130a";
    ctx.strokeText(b.to, x + w / 2, y + 318); ctx.fillStyle = GREEN; ctx.fillText(b.to, x + w / 2, y + 318);
    ctx.restore();
    const pct = Math.round((1 - num(b.to) / num(b.from)) * 100);
    if (pct > 0) this.#pill(ctx, `−${pct} %`, x + w / 2, y - 6, { size: 38, bg: GREEN, fg: "#04130a", border: "#ffffff" });
  }

  /** Swipe-Karte (echtes Kartenmotiv) fliegt nach rechts mit „LIKE“-Stempel – läuft in Schleife. */
  #swipeCard(ctx, cx, cy, t, { period = 1.6, w = 330, h = 460 } = {}) {
    const ph = (t % period) / period;
    const out = ease(clamp((ph - 0.35) / 0.45));
    // Karte darunter (nächste)
    ctx.save(); ctx.translate(cx, cy + 16); ctx.scale(0.92 + 0.08 * out, 0.92 + 0.08 * out); this.#cardFace(ctx, w, h, 0.55 + 0.45 * out); ctx.restore();
    ctx.save();
    ctx.translate(cx + out * 520, cy - out * 60); ctx.rotate(out * 0.45 + Math.sin(ph * Math.PI * 2) * 0.02 * (1 - out));
    ctx.globalAlpha = (1 - clamp((out - 0.7) / 0.3)) * this.m;
    this.#cardFace(ctx, w, h, 1);
    const st = clamp((ph - 0.15) / 0.2);
    if (st > 0) {
      ctx.save(); ctx.rotate(-0.3); ctx.globalAlpha *= st;
      ctx.lineWidth = 8; ctx.strokeStyle = GREEN; rr(ctx, -w / 2 + 20, -h / 2 + 40, 210, 90, 16); ctx.stroke();
      ctx.font = `400 64px ${DISPLAY}`; ctx.fillStyle = GREEN; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("LIKE", -w / 2 + 125, -h / 2 + 88);
      ctx.restore();
    }
    ctx.restore();
  }
  #cardFace(ctx, w, h, a) {
    const c = this.coverCard;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.shadowColor = hexA(this.accent, 0.8); ctx.shadowBlur = 50;
    rr(ctx, -w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 24); ctx.fillStyle = this.accent; ctx.fill();
    ctx.shadowBlur = 0;
    rr(ctx, -w / 2, -h / 2, w, h, 18); ctx.save(); ctx.clip();
    if (c?.img) ctx.drawImage(c.img, -w / 2, -h / 2, w, h);
    else {
      const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, "#3b1f5e"); g.addColorStop(1, "#0b0f22"); ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.14)"; rr(ctx, -w / 2 + 22, -h / 2 + 46, w - 44, h * 0.45, 12); ctx.fill();
      ctx.font = `400 40px ${DISPLAY}`; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Chase-Karte", 0, h * 0.25);
    }
    ctx.restore(); ctx.restore();
  }

  /** Kleiner Info-Toast (Deal-Listing, Treffer, Pin) mit grünem Badge links. */
  #toast(ctx, x, y, w, a, { badge, title, sub, badgeBg = GREEN }) {
    if (a <= 0) return;
    const h = 118;
    ctx.save(); ctx.globalAlpha = clamp(a) * this.m;
    ctx.shadowColor = "rgba(0,0,0,0.65)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    rr(ctx, x, y, w, h, 26); ctx.fillStyle = "rgba(9,13,28,0.96)"; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.lineWidth = 3; ctx.strokeStyle = hexA(badgeBg, 0.9); ctx.stroke();
    ctx.font = `900 34px ${BODY}`;
    const bw = Math.max(118, ctx.measureText(badge).width + 30);
    rr(ctx, x + 16, y + 22, bw, h - 44, 18); ctx.fillStyle = badgeBg; ctx.fill();
    ctx.fillStyle = "#04130a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(badge, x + 16 + bw / 2, y + h / 2 + 1);
    ctx.textAlign = "left";
    const tx = x + bw + 34, tw = w - bw - 50;
    const ft = fitText(ctx, title, (n) => `900 ${n}px ${BODY}`, tw, 1, 32, 20);
    ctx.font = `900 ${ft.size}px ${BODY}`; ctx.fillStyle = "#ffffff"; ctx.fillText(ft.lines[0], tx, y + 42);
    const fs = fitText(ctx, sub, (n) => `700 ${n}px ${BODY}`, tw, 1, 26, 16);
    ctx.font = `700 ${fs.size}px ${BODY}`; ctx.fillStyle = "#cbd5e1"; ctx.fillText(fs.lines[0], tx, y + 82);
    ctx.restore();
  }

  /** H1 · Hook (0–3 s): Kontrast-Banner, echte App im Smartphone, Preis-Badge bzw. Swipe-Animation. Frame 0 = fertiges Vorschaubild. */
  sceneHook(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    const v = this.tpl.visual;
    if (v === "swipe") {
      this.#livePhone(ctx, t, p, live, HZ.left + 10, 500, 380, 676, { rot: -0.05 });
      this.#swipeCard(ctx, 690, 820, t);
      this.#pill(ctx, "👉 Rechts = will ich haben", 690, 1150, { size: 30, border: GREEN });
    } else {
      this.#livePhone(ctx, t, p, live, HZ.left + 10, 500, 400, 711, { rot: -0.045 });
      this.#priceDrop(ctx, 520, 640, 400, t);
    }
    this.#banner(ctx, this.cover, t);
  }

  /** H2 · UI-Beweis (3–8 s): großes Smartphone mit der echten App + animierte Live-Overlays. */
  sceneProof(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    const v = this.tpl.visual, pr = this.tpl.proof || {};
    const w = 540, h = 960, x = HX - w / 2, y = 340;
    this.#livePhone(ctx, t, p, live, x, y, w, h, { zoomIn: v === "flip" ? 1.45 : 1.55 });
    this.#pill(ctx, `${pr.title || this.tpl.label}  ●  LIVE`, HX, 282, { size: 36, border: GREEN });
    const lt = t - (this.scenes[1]?.start || 0); // Sekunden seit Szenenbeginn
    if (v === "flip") {
      const deals = (pr.deals || []).map(([n, set, from, to]) => ({ n, set, from, to }));
      const f = this.facts || {};
      if (f.card && f.pct) deals[0] = { n: String(f.card).slice(0, 28), set: "gerade live im Radar", pct: String(f.pct).replace(/\s/g, ""), price: f.price };
      deals.slice(0, 3).forEach((d, i) => {
        const a = back((lt - 0.35 - i * 0.9) * 2.6);
        const left = i % 2 === 1;
        const tw = 470, tx = left ? HZ.left + (1 - clamp(a)) * -120 : HZ.right - tw + (1 - clamp(a)) * 120, ty = 470 + i * 250;
        const pct = d.pct ? (d.pct.includes("%") ? `−${d.pct.replace(/^[−-]/, "")}` : `−${d.pct} %`) : `−${Math.round((1 - d.to / d.from) * 100)} %`;
        const sub = d.from ? `${d.set} · ${d.from} € → ${d.to} €` : `${d.set}${d.price ? ` · ${d.price}` : ""}`;
        this.#toast(ctx, tx, ty, tw, a, { badge: pct, title: d.n, sub });
      });
    } else if (v === "scan") {
      // Kamera-Scan-Rahmen über dem Bildschirm + Laser-Linie, danach Live-Preis-Popup
      const fx = x + 70, fy = y + 190, fw = w - 140, fh = 560, L = 70;
      ctx.save(); ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.strokeStyle = GREEN; ctx.shadowColor = GREEN; ctx.shadowBlur = 24;
      const corner = (cx, cy, dx, dy) => { ctx.beginPath(); ctx.moveTo(cx, cy + dy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * L, cy); ctx.stroke(); };
      const pulse = 4 * Math.sin(t * 6);
      corner(fx - pulse, fy - pulse, 1, 1); corner(fx + fw + pulse, fy - pulse, -1, 1); corner(fx - pulse, fy + fh + pulse, 1, -1); corner(fx + fw + pulse, fy + fh + pulse, -1, -1);
      const found = lt > 1.6;
      if (!found) {
        const ly = fy + ((Math.sin(lt * 3.2 - Math.PI / 2) + 1) / 2) * fh;
        const g = ctx.createLinearGradient(0, ly - 40, 0, ly + 4);
        g.addColorStop(0, "rgba(34,197,94,0)"); g.addColorStop(1, "rgba(34,197,94,0.45)");
        ctx.fillStyle = g; ctx.fillRect(fx, ly - 40, fw, 44);
        ctx.fillStyle = "#86efac"; ctx.fillRect(fx, ly - 2, fw, 5);
      }
      ctx.restore();
      if (!found) this.#pill(ctx, "🔍 Scanne Karte …", HX, fy + fh + 70, { size: 34, border: GREEN });
      const a = back((lt - 1.6) * 3);
      if (a > 0) {
        const f = this.facts || {};
        const price = f.price || pr.fallbackPrice || "";
        const pw = 640, ph = 210, px = HX - pw / 2, py = fy + fh - 120;
        ctx.save(); ctx.globalAlpha = clamp(a) * this.m;
        ctx.translate(HX, py + ph / 2); ctx.scale(0.85 + 0.15 * clamp(a), 0.85 + 0.15 * clamp(a)); ctx.translate(-HX, -(py + ph / 2));
        ctx.shadowColor = hexA(GREEN, 0.7); ctx.shadowBlur = 50;
        rr(ctx, px, py, pw, ph, 32); ctx.fillStyle = "rgba(5,12,10,0.96)"; ctx.fill();
        ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = GREEN; ctx.stroke();
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        const nm = fitText(ctx, `✓ Erkannt: ${f.card || "Pokémon-Karte"}`, (n) => `900 ${n}px ${BODY}`, pw - 60, 1, 34, 22);
        ctx.font = `900 ${nm.size}px ${BODY}`; ctx.fillStyle = "#bbf7d0"; ctx.fillText(nm.lines[0], px + 30, py + 50);
        ctx.font = `800 30px ${BODY}`; ctx.fillStyle = "#e2e8f0"; ctx.fillText(pr.popup || "Echter Marktwert", px + 30, py + 110);
        ctx.font = `400 92px ${DISPLAY}`; ctx.textAlign = "right"; ctx.fillStyle = GREEN; ctx.fillText(price, px + pw - 30, py + 140);
        ctx.restore();
      }
    } else if (v === "swipe") {
      // Swipe-Richtungen, LIKE-/NOPE-Stempel und Match-Animation über dem echten Swipe-Modus
      const ph = (lt % 1.8) / 1.8, right = Math.floor(lt / 1.8) % 2 === 0;
      this.#pill(ctx, "👈 Weiter", HZ.left + 95, 1170, { size: 30, border: "#94a3b8", fg: right ? "#94a3b8" : "#ffffff" });
      this.#pill(ctx, "Like 👉", HZ.right - 95, 1170, { size: 30, border: GREEN, fg: right ? "#bbf7d0" : "#94a3b8" });
      const st = Math.sin(clamp(ph / 0.5) * Math.PI);
      if (st > 0.05 && lt < 3.6) {
        ctx.save(); ctx.globalAlpha = st * this.m;
        ctx.translate(right ? HX - 150 : HX + 150, 560); ctx.rotate(right ? -0.25 : 0.25);
        const col = right ? GREEN : RED, txt = right ? "LIKE" : "NOPE";
        ctx.lineWidth = 9; ctx.strokeStyle = col; rr(ctx, -130, -55, 260, 110, 18); ctx.stroke();
        ctx.font = `400 78px ${DISPLAY}`; ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, 0, 4);
        ctx.restore();
      }
      const m = back((lt - 3.4) * 2.8);
      if (m > 0) {
        ctx.save(); ctx.globalAlpha = clamp(m) * this.m;
        for (let i = 0; i < 14; i++) { // Herzchen-Burst
          const ang = (i / 14) * Math.PI * 2, r = 120 + 230 * clamp(m) + (i % 3) * 30;
          ctx.font = `${34 + (i % 3) * 8}px ${EMOJI}`; ctx.textAlign = "center"; ctx.fillText(i % 2 ? "💚" : "✨", HX + Math.cos(ang) * r, 760 + Math.sin(ang) * r * 0.8);
        }
        ctx.translate(HX, 760); ctx.scale(clamp(m, 0, 1.15), clamp(m, 0, 1.15)); ctx.rotate(-0.06);
        ctx.font = `400 120px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineJoin = "round"; ctx.lineWidth = 16; ctx.strokeStyle = "#05070f"; ctx.strokeText("MATCH!", 0, 0);
        ctx.fillStyle = GREEN; ctx.fillText("MATCH!", 0, 0);
        ctx.restore();
        this.#pill(ctx, "⭐ Fehlt mir – auf die Wunschliste", HX, 900, { size: 34, bg: GREEN, fg: "#04130a", border: "#ffffff" });
      }
    }
  }

  /** H3 · USP (8–13 s): kein Download, aktives Deals-Finden & Tauschen. */
  sceneUsp(ctx, t, p, live) {
    this.#backdrop(ctx, t);
    const v = this.tpl.visual, u = this.tpl.usp || {};
    const lt = t - (this.scenes[2]?.start || 0);
    if (v === "flip") {
      const w = 470, h = 836, x = HX - w / 2, y = 450;
      this.#livePhone(ctx, t, p, live, x, y, w, h, { zoomIn: 1.4 });
      // Klick-Animation: Fingertipp mit Ripple auf den Deal, danach „Gesichert“-Toast
      const f = this.focus();
      const cx = x + w * (f ? clamp(f.x, 0.15, 0.85) : 0.62), cy = y + h * (f ? clamp(f.y, 0.2, 0.8) : 0.55);
      for (const d of [0.5, 0.75]) {
        const r = clamp((lt - d) / 0.6);
        if (r > 0 && r < 1) { ctx.beginPath(); ctx.arc(cx, cy, 30 + r * 120, 0, Math.PI * 2); ctx.lineWidth = 8 * (1 - r); ctx.strokeStyle = hexA("#ffffff", 0.9 * (1 - r)); ctx.stroke(); }
      }
      if (lt > 0.3 && lt < 1.1) { ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fill(); }
      this.#toast(ctx, HZ.left, 1110, HZ.right - HZ.left, back((lt - 1.0) * 3), { badge: "✓", title: u.title || "Deal gesichert", sub: "Schneller als alle anderen – direkt zum Angebot" });
      this.#badgeBig(ctx, u.badge, 330, back((lt - 0.2) * 3), GREEN);
    } else if (v === "scan") {
      // Browser-Adressleiste mit der echten Domain
      const by = 268, bh = 100;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 30;
      rr(ctx, HZ.left, by, HZ.right - HZ.left, bh, 50); ctx.fillStyle = "#f8fafc"; ctx.fill(); ctx.restore();
      ctx.save(); ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.font = `800 34px ${BODY}`; ctx.fillStyle = "#16a34a"; ctx.fillText("🔒", HZ.left + 34, by + bh / 2 + 2);
      const typed = DOMAIN.slice(0, Math.max(0, Math.min(DOMAIN.length, Math.floor(lt * 22))));
      ctx.font = `900 46px ${BODY}`; ctx.fillStyle = "#0f172a"; ctx.fillText(typed || DOMAIN.slice(0, 1), HZ.left + 96, by + bh / 2 + 2);
      if (typed.length < DOMAIN.length && Math.floor(t * 3) % 2 === 0) { const tw = ctx.measureText(typed).width; ctx.fillRect(HZ.left + 100 + tw, by + 28, 4, 46); }
      ctx.font = `800 34px ${BODY}`; ctx.textAlign = "right"; ctx.fillStyle = "#475569"; ctx.fillText("⟳", HZ.right - 36, by + bh / 2 + 2);
      ctx.restore();
      this.#livePhone(ctx, t, p, live, HZ.left + 20, 430, 420, 746, { rot: -0.03 });
      // durchgestrichenes App-Store-Symbol (neutral gezeichnet, keine fremde Marke)
      const a = back((lt - 0.5) * 2.8), ix = 690, iy = 640, S = 230;
      if (a > 0) {
        ctx.save(); ctx.globalAlpha = clamp(a) * this.m; ctx.translate(ix, iy); ctx.scale(clamp(a, 0, 1.1), clamp(a, 0, 1.1));
        const g = ctx.createLinearGradient(-S / 2, -S / 2, S / 2, S / 2); g.addColorStop(0, "#60a5fa"); g.addColorStop(1, "#2563eb");
        rr(ctx, -S / 2, -S / 2, S, S, 52); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 16; ctx.lineCap = "round"; // Download-Pfeil
        ctx.beginPath(); ctx.moveTo(0, -60); ctx.lineTo(0, 30); ctx.moveTo(-40, -8); ctx.lineTo(0, 32); ctx.lineTo(40, -8); ctx.moveTo(-58, 66); ctx.lineTo(58, 66); ctx.stroke();
        ctx.font = `900 26px ${BODY}`; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText("APP-STORE", 0, -S * 0.66 - 34);
        ctx.strokeStyle = RED; ctx.lineWidth = 22; // Verbots-Kreis
        ctx.beginPath(); ctx.arc(0, 0, S * 0.66, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-S * 0.47, -S * 0.47); ctx.lineTo(S * 0.47, S * 0.47); ctx.stroke();
        ctx.restore();
      }
      this.#pill(ctx, u.badge || "Kein Download nötig", 690, 900, { size: 34, bg: RED, fg: "#ffffff", border: "#ffffff", maxW: 440 });
      this.#pill(ctx, "⚡ Sofort startklar", 690, 1000, { size: 30, border: GREEN, maxW: 440 });
      this.#pill(ctx, "📱 Auf jedem Handy", 690, 1090, { size: 30, border: GREEN, maxW: 440 });
    } else {
      // Tausch-Hub (echte App) + Sammler-Radar mit Pins in der Nähe
      this.#pill(ctx, u.title || "Tausch-Hub & Sammler-Radar", HX, 282, { size: 36, border: this.accent });
      this.#livePhone(ctx, t, p, live, HZ.left + 10, 380, 360, 640, { rot: -0.03 });
      const cx = 700, cy = 650, R = 205;
      ctx.save();
      rr(ctx, cx - R - 15, cy - R - 15, (R + 15) * 2, (R + 15) * 2, 36); ctx.fillStyle = "rgba(8,14,30,0.95)"; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.8); ctx.stroke();
      ctx.save(); rr(ctx, cx - R - 15, cy - R - 15, (R + 15) * 2, (R + 15) * 2, 36); ctx.clip();
      ctx.strokeStyle = "rgba(148,163,184,0.12)"; ctx.lineWidth = 2; // Straßenraster
      for (let k = -R; k <= R; k += 52) { ctx.beginPath(); ctx.moveTo(cx + k, cy - R - 20); ctx.lineTo(cx + k + 40, cy + R + 20); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - R - 20, cy + k); ctx.lineTo(cx + R + 20, cy + k - 30); ctx.stroke(); }
      for (let i = 3; i >= 1; i--) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); ctx.strokeStyle = hexA(this.accent, 0.18 + 0.1 * i); ctx.lineWidth = 3; ctx.stroke(); }
      ctx.translate(cx, cy); ctx.rotate(t * 2.2);
      const sw = ctx.createLinearGradient(0, 0, R, 0); sw.addColorStop(0, hexA(this.accent, 0.55)); sw.addColorStop(1, hexA(this.accent, 0));
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -0.55, 0); ctx.closePath(); ctx.fillStyle = sw; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fillStyle = "#38bdf8"; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = "#ffffff"; ctx.stroke();
      ctx.font = `900 24px ${BODY}`; ctx.fillStyle = "#e0f2fe"; ctx.textAlign = "center"; ctx.fillText("Du", cx, cy + 44);
      const pins = u.pins || [], pos = [[-0.45, -0.5], [0.55, -0.15], [-0.2, 0.62]];
      pins.forEach((pin, i) => {
        const a = back((lt - 0.4 - i * 0.55) * 3);
        if (a <= 0) return;
        const px = cx + pos[i % 3][0] * R, py = cy + pos[i % 3][1] * R;
        ctx.save(); ctx.translate(px, py); ctx.scale(clamp(a, 0, 1.2), clamp(a, 0, 1.2));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-26, -30, -26, -62, 0, -62); ctx.bezierCurveTo(26, -62, 26, -30, 0, 0); ctx.fillStyle = this.accent; ctx.fill();
        ctx.beginPath(); ctx.arc(0, -42, 9, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.restore();
      });
      ctx.restore();
      pins.forEach(([name, dist, card], i) => {
        this.#toast(ctx, HZ.left + (1 - clamp(back((lt - 0.6 - i * 0.55) * 3))) * -80, 1040 + i * 128, HZ.right - HZ.left, back((lt - 0.6 - i * 0.55) * 3) * (i < 2 ? 1 : 0), // 3. Pin nur auf der Karte – sonst kollidiert die Liste mit den Untertiteln
          { badge: `📍 ${dist}`, title: `${name} gibt ab: ${card}`, sub: "🤝 Tausch anfragen im Tausch-Hub", badgeBg: this.accent });
      });
    }
  }

  /** Großes Badge über die ganze Breite (z. B. „Kostenlos im Browser – Kein Download“). */
  #badgeBig(ctx, text, y, a, col) {
    if (!text || a <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp(a) * this.m;
    ctx.translate(HX, y); ctx.scale(0.8 + 0.2 * clamp(a, 0, 1.1), 0.8 + 0.2 * clamp(a, 0, 1.1));
    const ft = fitText(ctx, text, (n) => `900 ${n}px ${BODY}`, HZ.right - HZ.left - 60, 2, 44, 28);
    const h = ft.lines.length * ft.size * 1.2 + 40, w = HZ.right - HZ.left;
    ctx.shadowColor = hexA(col, 0.6); ctx.shadowBlur = 36;
    rr(ctx, -w / 2, -h / 2, w, h, 30); ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 4; ctx.strokeStyle = "#ffffff"; ctx.stroke();
    ctx.font = `900 ${ft.size}px ${BODY}`; ctx.fillStyle = "#04130a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ft.lines.forEach((l, i) => ctx.fillText(l, 0, (i - (ft.lines.length - 1) / 2) * ft.size * 1.2 + 2));
    ctx.restore();
  }

  /** H4 · Frage-Endscreen (13–17 s): Domain groß + echte Sammler-Frage als Kommentar-Trigger. Kein „Like & Abo“. */
  sceneAsk(ctx, t, p) {
    this.#backdrop(ctx, t);
    const lt = t - (this.scenes[3]?.start || 0);
    const a = ease(lt * 4);
    ctx.save(); ctx.globalAlpha = a * this.m;
    this.#logo(ctx, HX, 330, 54);
    // Domain als Browser-Adresse, so groß wie möglich
    const by = 440, bh = 150;
    ctx.save(); ctx.shadowColor = hexA(this.accent, 0.7); ctx.shadowBlur = 50;
    rr(ctx, HZ.left, by, HZ.right - HZ.left, bh, 75); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.restore();
    let df = 88; // einzelnes Wort: nach Breite verkleinern (wrap() bricht ein Wort nicht um)
    do { ctx.font = `400 ${df}px ${DISPLAY}`; df -= 2; } while (ctx.measureText(DOMAIN).width > HZ.right - HZ.left - 170 && df > 44);
    df += 2;
    ctx.font = `800 44px ${BODY}`; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#16a34a"; ctx.fillText("🔒", HZ.left + 40, by + bh / 2 + 2);
    ctx.font = `400 ${df}px ${DISPLAY}`; ctx.fillStyle = "#0b0f22"; ctx.textAlign = "center"; ctx.fillText(DOMAIN, HX + 34, by + bh / 2 + 4);
    ctx.font = `800 34px ${BODY}`; ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Kostenlos im Browser · kein Download", HX, by + bh + 58);
    // Frage-Box (Kommentar-Trigger) mit Sprechblasen-Spitze
    const s = 1 + 0.02 * Math.sin(t * 5), qy = 760, qw = HZ.right - HZ.left, q = this.tpl.question || "";
    const ft = fitText(ctx, q, (n) => `400 ${n}px ${DISPLAY}`, qw - 90, 3, 80, 50);
    const qh = ft.lines.length * ft.size * 1.1 + 110;
    ctx.save(); ctx.translate(HX, qy + qh / 2); ctx.scale(s, s); ctx.translate(-HX, -(qy + qh / 2));
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    rr(ctx, HZ.left, qy, qw, qh, 40); ctx.fillStyle = this.accent; ctx.fill();
    ctx.beginPath(); ctx.moveTo(HZ.left + 110, qy + qh - 2); ctx.lineTo(HZ.left + 90, qy + qh + 60); ctx.lineTo(HZ.left + 190, qy + qh - 2); ctx.closePath(); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.font = `900 32px ${BODY}`; ctx.fillStyle = "#0b0f22"; ctx.textAlign = "left"; ctx.fillText("💬 Sammler-Frage", HZ.left + 40, qy + 48);
    ctx.font = `400 ${ft.size}px ${DISPLAY}`; ctx.textAlign = "center"; ctx.fillStyle = "#0b0f22";
    ft.lines.forEach((l, i) => ctx.fillText(l, HX, qy + 100 + ft.size * 0.5 + i * ft.size * 1.1));
    ctx.restore();
    // Kommentarzeile mit blinkendem Cursor – zeigt, wo die Antwort hingehört
    const cy = Math.min(HZ.bottom - 70, qy + qh + 130);
    rr(ctx, HZ.left, cy - 46, HZ.right - HZ.left, 92, 46); ctx.fillStyle = "rgba(15,23,42,0.92)"; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(148,163,184,0.6)"; ctx.stroke();
    ctx.font = `700 34px ${BODY}`; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "left"; ctx.fillText("Kommentar schreiben …", HZ.left + 40, cy + 2);
    if (Math.floor(t * 2.5) % 2 === 0) { ctx.fillStyle = "#ffffff"; ctx.fillRect(HZ.left + 38 + ctx.measureText("Kommentar schreiben …").width + 8, cy - 22, 4, 44); }
    ctx.restore();
  }


  // ================================================================ Pro-Showcase (4 Szenen, 29 s, 60 FPS)
  // Durchgehende Kamera statt Diashow: ein schwebendes Smartphone mit Tiefenschatten fährt per Keyframes
  // (weich interpoliert) durch alle Szenen, der Bildschirminhalt zoomt zusätzlich auf die gerade bediente Stelle.
  // Übergänge: Whip-Pan mit Lichtwischer. Darüber: Szenen-Overlay oben, Untertitel unten im sicheren Bereich,
  // Tipp-Impulse genau an der Fingerposition und ein bewegter Holo-Lichtreflex auf allen sichtbaren Karten.

  /** Kamera-Zustand des Smartphones zur Zeit t (Bildschirmmitte, Maßstab, Neigung). */
  #scCamera(t) {
    const D = this.scenes[this.scenes.length - 1].end, k = D / 29;
    const K = SC_CAMERA;
    const tt = t / k;
    let i = 0;
    while (i < K.length - 2 && tt > K[i + 1][0]) i++;
    const [t0, a] = K[i], [t1, b] = K[i + 1];
    const u = smooth((tt - t0) / Math.max(0.001, t1 - t0));
    const lerp = (p) => a[p] + (b[p] - a[p]) * u;
    return { cx: lerp("cx"), cy: lerp("cy"), s: lerp("s"), rot: lerp("rot") };
  }

  /** Ziel-Zoom des Bildschirminhalts (1 = ganze App inkl. 5-Reiter-Navigation sichtbar). */
  #scZoom(t) {
    const tt = t / ((this.scenes[this.scenes.length - 1].end || 29) / 29);
    for (const [a, b, z] of SC_ZOOM) if (tt >= a && tt < b) return z;
    return 1;
  }

  /** Whip-Pan an den Szenengrenzen: Versatz (px), Maßstabs-Delle und Lichtwischer-Stärke. */
  #scWhip(t) {
    for (let i = 1; i < this.scenes.length; i++) {
      const b = this.scenes[i].start, u = (t - (b - 0.3)) / 0.6;
      if (u > 0 && u < 1) {
        const w = Math.sin(u * Math.PI);
        return { x: (i % 2 ? -1 : 1) * 80 * Math.sin(u * Math.PI * 2) * (1 - u * 0.3), dip: 1 - 0.05 * w, flash: w, u };
      }
    }
    return { x: 0, dip: 1, flash: 0, u: 0 };
  }

  /** Holo-Lichtreflex + Tipp-Impulse im Bildschirm (Koordinaten über die aktuelle Kamera-Abbildung). */
  #screenFx(ctx, t, m) {
    const X = (nx) => m.x + ((nx * m.LW - m.sx) / m.sw) * m.w;
    const Y = (ny) => m.y + ((ny * m.LH - m.sy) / m.sh) * m.h;
    const kx = (m.LW / m.sw) * m.w, ky = (m.LH / m.sh) * m.h, unit = m.w / 520;
    // Holo-Schimmer: diagonale Regenbogen-Lichtkante wandert über jede sichtbare Karte (versetzt je Karte)
    let rects = [];
    try { rects = this.cards() || []; } catch { rects = []; }
    rects.forEach((r, i) => {
      const px = X(r.x), py = Y(r.y), pw = r.w * kx, ph = r.h * ky;
      if (pw < 18 || px > m.x + m.w || py > m.y + m.h || px + pw < m.x || py + ph < m.y) return;
      const p = ((t * 0.42 + i * 0.23) % 1.5) - 0.25;
      if (p < -0.2 || p > 1.2) return; // Lichtkante gerade nicht über dieser Karte
      const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
      const stop = (o, c) => { if (o >= 0 && o <= 1) g.addColorStop(o, c); };
      g.addColorStop(0, "rgba(255,255,255,0)");
      stop(p - 0.2, "rgba(255,255,255,0)"); stop(p - 0.09, "rgba(110,220,255,0.20)"); stop(p, "rgba(255,255,255,0.46)");
      stop(p + 0.09, "rgba(255,140,235,0.20)"); stop(p + 0.2, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      rr(ctx, px, py, pw, ph, Math.max(3, 7 * unit)); ctx.clip();
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.6;
      ctx.fillStyle = g; ctx.fillRect(px, py, pw, ph);
      ctx.restore();
    });
    // Tipp-Impulse: leuchtender Kern + zwei auslaufende Ringe genau an der Tipp-Stelle
    this.ripples = this.ripples.filter((r) => t - r.t0 < 0.8);
    for (const r of this.ripples) {
      const a = clamp((t - r.t0) / 0.8), px = X(r.x), py = Y(r.y);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const core = ctx.createRadialGradient(px, py, 0, px, py, 46 * unit);
      core.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - a)})`); core.addColorStop(0.45, hexA(this.accent, 0.5 * (1 - a))); core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(px, py, 46 * unit, 0, Math.PI * 2); ctx.fill();
      for (const [delay, max] of [[0, 78], [0.14, 110]]) {
        const q = clamp((a * 0.8 - delay) / (0.8 - delay));
        if (q <= 0) continue;
        ctx.beginPath(); ctx.arc(px, py, (16 + max * ease(q)) * unit, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.5, 6 * (1 - q)) * unit * 1.4; ctx.strokeStyle = hexA(this.accent, 0.9 * (1 - q));
        ctx.shadowColor = this.accent; ctx.shadowBlur = 18; ctx.stroke();
      }
      ctx.restore();
    }
    // gehaltener Finger: ruhiger Leuchtpunkt
    if (this.down) {
      const f = this.focus();
      if (f) {
        const px = X(f.x), py = Y(f.y);
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(px, py, 0, px, py, 34 * unit);
        g.addColorStop(0, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 34 * unit, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }

  /** Szenen-Overlay oben (Glas-Panel, max. 2 Zeilen, Wort für Wort einschwebend). Szene 1 steht ab Frame 0. */
  #scHeadline(ctx, text, t, start, end, { lines = 2, size = 56, y = 300 } = {}) {
    const inA = start <= 0.01 ? 1 : ease((t - start) / 0.5), outA = 1 - ease((t - (end - 0.32)) / 0.32);
    const a = clamp(Math.min(inA, outA));
    if (a <= 0) return;
    ctx.save();
    const maxW = SAFE.right - SAFE.left - 70;
    const { size: s, lines: ls } = fitText(ctx, text, (n) => `400 ${n}px ${DISPLAY}`, maxW, lines, size, 36);
    ctx.font = `400 ${s}px ${DISPLAY}`;
    const lh = s * 1.12, h = ls.length * lh + 34;
    const w = Math.min(SAFE.right - SAFE.left, Math.max(...ls.map((l) => ctx.measureText(l).width)) + 64);
    const top = y - h / 2 + (1 - inA) * 22;
    ctx.globalAlpha = a * this.m;
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    rr(ctx, CX - w / 2, top, w, h, 26); ctx.fillStyle = "rgba(6,9,20,0.78)"; ctx.fill();
    ctx.shadowColor = "transparent";
    const bg = ctx.createLinearGradient(CX - w / 2, top, CX + w / 2, top + h);
    bg.addColorStop(0, hexA(this.accent, 0.95)); bg.addColorStop(1, hexA(this.tpl.gold || "#fbbf24", 0.95));
    ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.55)";
    // Wörter schweben nacheinander ein (gestaffelt), danach ruhig
    let wi = 0;
    ls.forEach((line, li) => {
      const words = line.split(" "), total = ctx.measureText(line).width;
      let x = CX - total / 2;
      const ly = top + 17 + lh * (li + 0.5);
      for (const word of words) {
        const ww = ctx.measureText(word).width, sp = ctx.measureText(" ").width;
        const wa = start <= 0.01 ? 1 : ease((t - start - wi * 0.045) / 0.3);
        ctx.globalAlpha = a * wa * this.m;
        ctx.textAlign = "left";
        ctx.strokeText(word, x, ly + (1 - wa) * 14);
        ctx.fillStyle = /€|Pro|29,90|pokeswipe/i.test(word) ? (this.tpl.gold || "#fbbf24") : "#ffffff";
        ctx.fillText(word, x, ly + (1 - wa) * 14);
        x += ww + sp; wi++;
      }
    });
    ctx.restore();
  }

  /** Edle Pro-Abo-/Pro-Pass-Einblendung (Glas-Panel mit Goldkante, 3 gestaffelte Vorteile, Lichtwischer). */
  #proPanel(ctx, t, from, to) {
    const a = clamp(Math.min(ease((t - from) / 0.5), 1 - ease((t - (to - 0.35)) / 0.35)));
    if (a <= 0) return;
    const gold = this.tpl.gold || "#fbbf24";
    const x = 95, w = 820, top = 905 + (1 - a) * 60, h = 400;
    ctx.save();
    ctx.globalAlpha = a * this.m;
    ctx.shadowColor = "rgba(0,0,0,0.75)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
    rr(ctx, x, top, w, h, 36);
    const bg = ctx.createLinearGradient(x, top, x, top + h);
    bg.addColorStop(0, "rgba(22,18,40,0.97)"); bg.addColorStop(1, "rgba(8,10,22,0.97)");
    ctx.fillStyle = bg; ctx.fill();
    ctx.shadowColor = hexA(gold, 0.55); ctx.shadowBlur = 36; ctx.shadowOffsetY = 0;
    const edge = ctx.createLinearGradient(x, top, x + w, top + h);
    edge.addColorStop(0, "#fde68a"); edge.addColorStop(0.5, gold); edge.addColorStop(1, "#f59e0b");
    ctx.lineWidth = 4; ctx.strokeStyle = edge; ctx.stroke();
    ctx.shadowColor = "transparent";
    // Kopf: Gold-Badge „PRO-PASS“ + Titel
    ctx.font = `900 30px ${BODY}`;
    const label = "⚡ PRO-PASS", bw = ctx.measureText(label).width + 40;
    rr(ctx, x + 34, top + 30, bw, 54, 27); ctx.fillStyle = edge; ctx.fill();
    ctx.fillStyle = "#1a1203"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + 34 + bw / 2, top + 58);
    ctx.textAlign = "left"; ctx.font = `400 40px ${DISPLAY}`; ctx.fillStyle = "#ffffff";
    ctx.fillText("Alles, was Profis nutzen", x + 54 + bw, top + 59);
    // 3 Vorteile, gestaffelt
    (this.tpl.pro || []).forEach(([icon, title, sub], i) => {
      const ra = ease((t - from - 0.45 - i * 0.4) / 0.35);
      if (ra <= 0) return;
      const ry = top + 112 + i * 94;
      ctx.save();
      ctx.globalAlpha = a * ra * this.m;
      ctx.translate((1 - ra) * 40, 0);
      rr(ctx, x + 30, ry, w - 60, 82, 22); ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x + 76, ry + 41, 30, 0, Math.PI * 2); ctx.fillStyle = hexA(gold, 0.18); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = hexA(gold, 0.8); ctx.stroke();
      ctx.font = `400 34px ${BODY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.fillText(icon, x + 76, ry + 43);
      ctx.textAlign = "left";
      const ft = fitText(ctx, title, (n) => `900 ${n}px ${BODY}`, w - 200, 1, 34, 24);
      ctx.font = `900 ${ft.size}px ${BODY}`; ctx.fillStyle = "#ffffff"; ctx.fillText(ft.lines[0], x + 126, ry + 29);
      const fs = fitText(ctx, sub, (n) => `700 ${n}px ${BODY}`, w - 200, 1, 24, 18);
      ctx.font = `700 ${fs.size}px ${BODY}`; ctx.fillStyle = "#cbd5e1"; ctx.fillText(fs.lines[0], x + 126, ry + 60);
      ctx.font = `900 30px ${BODY}`; ctx.fillStyle = GREEN; ctx.textAlign = "right"; ctx.fillText("✓", x + w - 56, ry + 42);
      ctx.restore();
    });
    // Lichtwischer über das Panel
    const sw = ((t - from) * 0.55) % 1.6 - 0.3;
    if (sw > -0.2 && sw < 1.2) {
      ctx.save(); rr(ctx, x, top, w, h, 36); ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(x + w * (sw - 0.15), top, x + w * (sw + 0.15), top + h);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,240,200,0.16)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(x, top, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Abschluss-Lockup: App-Icon + Domain + „Kostenlos starten, kein Download“ + Vertrauens-Chips. */
  #scFinale(ctx, t, start) {
    const a = ease((t - start - 0.35) / 0.55);
    if (a <= 0) return;
    const fin = this.tpl.finale || {};
    ctx.save();
    ctx.globalAlpha = a * this.m;
    // Zeile: Icon + Domain
    const icon = 132, gap = 30;
    ctx.font = `400 64px ${DISPLAY}`;
    const dom = fin.domain || DOMAIN, dw = ctx.measureText(dom).width;
    const total = icon + gap + dw, x0 = CX - total / 2, cy = 1150 + (1 - a) * 30;
    const pop = back(clamp((t - start - 0.35) / 0.6));
    ctx.save();
    ctx.translate(x0 + icon / 2, cy); ctx.scale(pop, pop);
    ctx.shadowColor = hexA(this.accent, 0.8); ctx.shadowBlur = 40;
    rr(ctx, -icon / 2, -icon / 2, icon, icon, 30); ctx.fillStyle = "#0b1022"; ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.save(); rr(ctx, -icon / 2, -icon / 2, icon, icon, 30); ctx.clip();
    if (this.icon?.complete && this.icon.naturalWidth) ctx.drawImage(this.icon, -icon / 2, -icon / 2, icon, icon);
    else { ctx.font = `400 72px ${BODY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("📡", 0, 4); }
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.25)"; rr(ctx, -icon / 2, -icon / 2, icon, icon, 30); ctx.stroke();
    ctx.restore();
    ctx.font = `400 64px ${DISPLAY}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,0.6)";
    const tx = x0 + icon + gap, dot = dom.lastIndexOf(".");
    ctx.strokeText(dom, tx, cy + 4);
    ctx.fillStyle = "#ffffff"; ctx.shadowColor = hexA(this.accent, 0.7); ctx.shadowBlur = 22;
    ctx.fillText(dot > 0 ? dom.slice(0, dot) : dom, tx, cy + 4);
    if (dot > 0) { ctx.fillStyle = this.accent; ctx.fillText(dom.slice(dot), tx + ctx.measureText(dom.slice(0, dot)).width, cy + 4); }
    ctx.shadowColor = "transparent";
    // „Kostenlos starten, kein Download“
    const sa = ease((t - start - 0.75) / 0.45);
    if (sa > 0) {
      ctx.globalAlpha = a * sa * this.m;
      const sub = fin.sub || "Kostenlos starten, kein Download";
      ctx.font = `900 40px ${BODY}`;
      const sw = ctx.measureText(sub).width + 70, sy = 1290 + (1 - sa) * 16;
      const gold = this.tpl.gold || "#fbbf24";
      const g = ctx.createLinearGradient(CX - sw / 2, sy, CX + sw / 2, sy);
      g.addColorStop(0, "#fde68a"); g.addColorStop(1, gold);
      ctx.shadowColor = hexA(gold, 0.6); ctx.shadowBlur = 26;
      rr(ctx, CX - sw / 2, sy - 36, sw, 72, 36); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.fillStyle = "#1a1203"; ctx.textAlign = "center"; ctx.fillText(sub, CX, sy + 2);
    }
    // Vertrauens-Chips
    const ca = ease((t - start - 1.15) / 0.45);
    if (ca > 0 && fin.chips?.length) {
      ctx.globalAlpha = a * ca * this.m;
      // Chips immer innerhalb der Safe Zone (x 80–930): Schrift verkleinern, bis die Zeile passt
      let fsz = 24, pad = 20, gapC = 12, ws = [];
      for (; fsz >= 16; fsz -= 1) {
        ctx.font = `800 ${fsz}px ${BODY}`; pad = Math.round(fsz * 0.8);
        ws = fin.chips.map((c) => ctx.measureText(c).width + pad * 2);
        if (ws.reduce((p, c) => p + c, 0) + gapC * (ws.length - 1) <= SAFE.right - SAFE.left) break;
      }
      let cx = CX - (ws.reduce((p, c) => p + c, 0) + gapC * (ws.length - 1)) / 2;
      fin.chips.forEach((c, i) => {
        rr(ctx, cx, 1352, ws[i], 46, 23); ctx.fillStyle = "rgba(8,12,26,0.85)"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = hexA(this.accent, 0.6); ctx.stroke();
        ctx.fillStyle = "#e2e8f0"; ctx.textAlign = "center"; ctx.fillText(c, cx + ws[i] / 2, 1376);
        cx += ws[i] + gapC;
      });
    }
    ctx.restore();
  }

  /** Ein kompletter Showcase-Frame (Hintergrund, Kamera, Smartphone, Overlays). */
  #showcaseFrame(ctx, t, live) {
    this.#backdrop(ctx, t);
    const [scan, binder, market, finale] = this.scenes;
    const D = this.scenes[this.scenes.length - 1].end, k = D / 29;
    // Tipp-Erkennung (Finger gedrückt → neuer Impuls)
    let down = false;
    try { down = !!this.pressed(); } catch { down = false; }
    if (down && !this.down) { const f = this.focus(); if (f) this.ripples.push({ t0: t, x: f.x, y: f.y }); }
    this.down = down;
    // Bildschirm-Zoom folgt dem Finger (weich), sonst ruhige Mitte
    const f = this.focus();
    const zt = this.#scZoom(t);
    const tx = f ? f.x : 0.5, ty = f ? f.y : 0.46;
    const kf = this.#follow(t, f ? 2.6 : 1.2), kz = this.#follow(t, 2.2);
    this.fx += (tx - this.fx) * kf; this.fy += (ty - this.fy) * kf;
    this.zoom += (zt - this.zoom) * kz;
    // Kamera + Whip-Pan + Schweben
    const cam = this.#scCamera(t), wh = this.#scWhip(t);
    const s = cam.s * wh.dip, w = 520 * s, h = 924 * s;
    const bob = Math.sin(t * 1.15) * 9 * s, sway = Math.sin(t * 0.62) * 0.012;
    const cx = cam.cx + wh.x, cy = cam.cy + bob;
    const x = cx - w / 2, y = cy - h / 2;
    // Tiefenschatten am „Boden“ – wird kleiner/heller, wenn das Gerät nach oben schwebt
    ctx.save();
    const lift = (bob / (9 * s) + 1) / 2;
    const sh = ctx.createRadialGradient(cx, y + h + 70 * s, 10, cx, y + h + 70 * s, w * 0.62);
    sh.addColorStop(0, `rgba(0,0,0,${0.55 - lift * 0.15})`); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.translate(cx, y + h + 70 * s); ctx.scale(1, 0.16); ctx.translate(-cx, -(y + h + 70 * s));
    ctx.fillStyle = sh; ctx.fillRect(cx - w, y + h + 70 * s - w, w * 2, w * 2);
    ctx.restore();
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(cam.rot + sway); ctx.translate(-cx, -cy);
    this.#phone(ctx, live, x, y, w, h, this.zoom, 1, { fx: true, t });
    ctx.restore();
    // Lichtwischer beim Szenenwechsel
    if (wh.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const gx = -W * 0.4 + wh.u * W * 1.8;
      const g = ctx.createLinearGradient(gx - 260, 0, gx + 260, H);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, `rgba(200,240,255,${0.16 * wh.flash})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // Overlays je Szene
    const ov = this.tpl.overlays || {};
    const sc = this.sceneAt(t);
    if (sc === scan) this.#scHeadline(ctx, ov.scan || this.cover, t, 0, scan.end);
    else if (sc === binder) this.#scHeadline(ctx, ov.binder, t, binder.start, binder.end);
    else if (sc === market) {
      this.#scHeadline(ctx, ov.market, t, market.start, market.end);
      const pa = SHOWCASE_PRO_AT * k;
      if (t >= pa) {
        // Smartphone tritt zurück, edle Pro-Einblendung davor
        const dim = clamp(Math.min(ease((t - pa) / 0.5), 1 - ease((t - (market.end - 0.35)) / 0.35)));
        ctx.fillStyle = `rgba(3,5,12,${0.4 * dim})`; ctx.fillRect(0, 380, W, H - 380);
        this.#proPanel(ctx, t, pa, market.end + 0.2);
      }
    } else if (sc === finale) {
      this.#scHeadline(ctx, "Ohne Login-Zwang – sofort loslegen", t, finale.start, D + 1, { lines: 1, size: 50, y: 270 });
      this.#scFinale(ctx, t, finale.start);
    }
  }

  /** Showcase-Frame komplett: durchgehende Kamera (keine Überblend-Diashow), Untertitel, Fortschritt, Ausblenden. */
  #drawShowcase(ctx, t, live) {
    this.#showcaseFrame(ctx, t, live);
    this.subtitles(ctx, t);
    const D = this.scenes[this.scenes.length - 1].end;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, this.accent); g.addColorStop(1, this.tpl.gold || this.accent);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * clamp(t / D), 8);
    if (this.fade > 0 && t > D - this.fade) {
      const a = clamp((t - (D - this.fade)) / this.fade);
      ctx.fillStyle = `rgba(0,0,0,${a * a * (3 - 2 * a)})`; ctx.fillRect(0, 0, W, H);
    }
    this.lastT = t;
  }

  /** Untertitel (Karaoke-Stil, aktuelles Wort in Akzentfarbe) im mittleren, geschützten Bereich. */
  subtitles(ctx, t) {
    const sc = this.sceneAt(t);
    if (sc.key === "cover" || sc.key === "cta" || sc.key === "ask") return;
    const c = this.captions.find((x) => t >= x.start - 0.05 && t < x.end + 0.15);
    if (!c) return;
    ctx.save();
    ctx.font = `900 58px ${BODY}`; ctx.textBaseline = "middle";
    const txt = c.words.map((w) => w.w).join(" ");
    const hook4 = isHook4(this.tpl);
    const maxW = hook4 ? HZ.right - HZ.left - 70 : SAFE.right - SAFE.left - 60;
    let size = 58;
    while (ctx.measureText(txt).width > maxW && size > 38) { size -= 4; ctx.font = `900 ${size}px ${BODY}`; }
    const tw = Math.min(maxW, ctx.measureText(txt).width), h = size * 1.7;
    const pop = 0.94 + 0.06 * ease((t - c.start) * 8);
    const capY = this.showcase ? (sc.key === "finale" ? CAP_Y_FINALE : CAP_Y_SHOWCASE) : hook4 ? CAP_Y_HOOK : sc.key === "focus" ? CAP_Y_PHONE : CAP_Y;
    ctx.translate(hook4 ? HX : CX, capY); ctx.scale(pop, pop);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 8;
    rr(ctx, -tw / 2 - 34, -h / 2, tw + 68, h, 30); ctx.fillStyle = "rgba(5,7,15,0.88)"; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = hexA(this.accent, 0.7); ctx.stroke();
    ctx.lineJoin = "round"; ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,0.85)";
    let x = -tw / 2;
    for (const w of c.words) {
      const ww = ctx.measureText(`${w.w} `).width;
      const on = t >= w.start && t < w.end + 0.05;
      const lift = on && this.showcase ? -4 : 0;
      ctx.textAlign = "left"; ctx.strokeText(w.w, x, 2 + lift);
      ctx.fillStyle = on ? (this.showcase ? this.tpl.gold || this.accent : this.accent) : "#ffffff";
      ctx.fillText(w.w, x, 2 + lift);
      x += ww;
    }
    ctx.restore();
  }

  sceneAt(t) { return this.scenes.find((s) => t < s.end) || this.scenes[this.scenes.length - 1]; }
  /** Braucht der Frame zur Zeit t ein frisches Live-Bild? (Cover/Endscreens zeigen keine Live-Aktion.) */
  showsLive(t) { const k = this.sceneAt(t).key; return k !== "cover" && k !== "cta" && k !== "ask"; }

  #scene(ctx, s, t, live) {
    const p = clamp((t - s.start) / Math.max(0.01, s.end - s.start));
    if (s.key === "hook") this.sceneHook(ctx, t, p, live);
    else if (s.key === "proof") this.sceneProof(ctx, t, p, live);
    else if (s.key === "usp") this.sceneUsp(ctx, t, p, live);
    else if (s.key === "ask") this.sceneAsk(ctx, t, p);
    else if (s.key === "cover") this.sceneCover(ctx, t, p, live);
    else if (s.key === "focus") this.focusScene(ctx, t, p, live);
    else if (s.key === "benefit") this.sceneBenefit(ctx, t, p, live);
    else if (s.key === "trust") this.sceneTrust(ctx, t, p, live);
    else this.sceneCta(ctx, t, p);
  }

  /** Kompletten Frame zur Videozeit t zeichnen. live = Canvas mit der aktuellen Live-Aufnahme (1080×1920). */
  draw(ctx, t, live) {
    if (this.showcase) return this.#drawShowcase(ctx, t, live);
    const i = this.scenes.indexOf(this.sceneAt(t));
    const s = this.scenes[i], next = this.scenes[i + 1];
    this.#scene(ctx, s, t, live);
    // weicher Übergang: nächste Szene blendet in den letzten XFADE Sekunden ein (mit leichtem Zoom)
    if (next && t > s.end - XFADE) {
      const a = ease((t - (s.end - XFADE)) / XFADE);
      ctx.save(); ctx.globalAlpha = a * this.m;
      const z = 1.04 - 0.04 * a;
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      this.#scene(ctx, next, Math.max(t, next.start), live);
      ctx.restore();
    }
    this.subtitles(ctx, t);
    // dezenter Fortschrittsbalken (hält Zuschauer bis zum Ende)
    const D = this.scenes[this.scenes.length - 1].end;
    ctx.fillStyle = hexA(this.accent, 0.85); ctx.fillRect(0, 0, W * clamp(t / D), 8);
    // sanftes Ausblenden nach dem letzten Wort (synchron zur Tonspur)
    if (this.fade > 0 && t > D - this.fade) {
      const a = clamp((t - (D - this.fade)) / this.fade);
      ctx.fillStyle = `rgba(0,0,0,${a * a * (3 - 2 * a)})`; ctx.fillRect(0, 0, W, H);
    }
    this.lastT = t;
  }
}

const num = (s) => { const m = String(s || "").replace(/\./g, "").replace(",", ".").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
const eurFmt = (v) => `${Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function hexA(hex, a) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
