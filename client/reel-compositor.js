// Szenen-Compositor für die Pro-Videos (1080×1920): legt Cover, Fokus-Zoom auf die echte App,
// Feature-Badges, Vertrauens-Infografik, Endscreen und Untertitel über die Live-Aufnahme.
// Jeder Frame wird aus der Videozeit t berechnet – Frame 0 ist bereits das fertige Cover (= Vorschaubild).
//
// Sicherer Bereich: Instagram/YouTube/Facebook legen oben (≈ 220 px), unten (≈ 380 px) und rechts (≈ 150 px)
// Bedienelemente über das Video. Texte und Untertitel bleiben deshalb in x 80–930, y 230–1500.

import { OUT_W as W, OUT_H as H } from "./live-stage.js";
import { DOMAIN, CTA_TEXT } from "./reel-pro.js";

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
};
const XFADE = 0.35; // weicher Übergang (s)

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { const c = 1.6; x = clamp(x); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Schriften laden, damit schon Frame 0 mit der echten Markenschrift gezeichnet wird. */
export async function loadProFonts() {
  try {
    await Promise.all(["400 80px \"Lilita One\"", "900 40px Figtree", "800 40px Figtree", "700 40px Figtree"].map((f) => document.fonts.load(f, "PokeSwipe Radar ÄÖÜ€")));
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
  constructor({ tpl, cover, badge = "", look = null, coverCard = null, scenes, captions, focus = () => null, facts = {}, fade = 0 }) {
    Object.assign(this, { tpl, cover, badge, coverCard, scenes, captions, focus, facts, fade });
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
    this.zoom = 1.1;
    this.lastT = 0;
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
  #phone(ctx, live, x, y, w, h, zoom = 1, alpha = 1, { spot = null } = {}) {
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

  /** Untertitel (Karaoke-Stil, aktuelles Wort in Akzentfarbe) im mittleren, geschützten Bereich. */
  subtitles(ctx, t) {
    const sc = this.sceneAt(t);
    if (sc.key === "cover" || sc.key === "cta") return;
    const c = this.captions.find((x) => t >= x.start - 0.05 && t < x.end + 0.15);
    if (!c) return;
    ctx.save();
    ctx.font = `900 58px ${BODY}`; ctx.textBaseline = "middle";
    const txt = c.words.map((w) => w.w).join(" ");
    const maxW = SAFE.right - SAFE.left - 60;
    let size = 58;
    while (ctx.measureText(txt).width > maxW && size > 38) { size -= 4; ctx.font = `900 ${size}px ${BODY}`; }
    const tw = Math.min(maxW, ctx.measureText(txt).width), h = size * 1.7;
    const pop = 0.94 + 0.06 * ease((t - c.start) * 8);
    ctx.translate(CX, sc.key === "focus" ? CAP_Y_PHONE : CAP_Y); ctx.scale(pop, pop);
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
      ctx.textAlign = "left"; ctx.strokeText(w.w, x, 2);
      ctx.fillStyle = on ? this.accent : "#ffffff";
      ctx.fillText(w.w, x, 2);
      x += ww;
    }
    ctx.restore();
  }

  sceneAt(t) { return this.scenes.find((s) => t < s.end) || this.scenes[this.scenes.length - 1]; }

  #scene(ctx, s, t, live) {
    const p = clamp((t - s.start) / Math.max(0.01, s.end - s.start));
    if (s.key === "cover") this.sceneCover(ctx, t, p, live);
    else if (s.key === "focus") this.focusScene(ctx, t, p, live);
    else if (s.key === "benefit") this.sceneBenefit(ctx, t, p, live);
    else if (s.key === "trust") this.sceneTrust(ctx, t, p, live);
    else this.sceneCta(ctx, t, p);
  }

  /** Kompletten Frame zur Videozeit t zeichnen. live = Canvas mit der aktuellen Live-Aufnahme (1080×1920). */
  draw(ctx, t, live) {
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

const eurFmt = (v) => `${Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function hexA(hex, a) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
