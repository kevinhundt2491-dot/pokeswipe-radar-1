// Admin-Reel-Studio – die App zeichnet ein 15-Sekunden-Promo-Reel (9:16, 1080x1920, 60 FPS)
// auf ein Canvas und speichert es per MediaRecorder als Videodatei (MP4 bevorzugt).
// Nutzt die echten Karten der App (REAL_CARDS inkl. Live-Cardmarket-Preise) und die Theme-Farben.
import { state, cdn } from "./core.js";

const W = 1080, H = 1920, FPS = 60, BITRATE = 8_000_000;

// ---------------------------------------------------------------------------
// Design der App (Werte aus theme.css; werden beim Öffnen live aus den CSS-Variablen gelesen)
// ---------------------------------------------------------------------------
const C = {
  night: "#0c1022", night2: "#131a33", night3: "#1b2444", red: "#d9363e", redDark: "#9e1f2a",
  electric: "#f5c84b", water: "#4a9be0", ink: "#f3efe4", soft: "#b9b7c9", hinge: "#1a1420",
  pokeYellow: "#ffcb05", slate950: "#020617", slate900: "#0f172a", slate800: "#1e293b", slate400: "#94a3b8",
  indigo950: "#1e1b4b", emerald: "#34d399", teal: "#14b8a6", blue: "#2563eb", indigo: "#4f46e5",
  purple: "#9333ea", rose: "#f43f5e", amber200: "#fde68a",
};
let DISPLAY = '"Lilita One", "Trebuchet MS", sans-serif';
let BODY = 'Figtree, "Segoe UI", sans-serif';

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const map = { night: "--night", night2: "--night-2", night3: "--night-3", red: "--dex-red", redDark: "--dex-red-dark", electric: "--t-electric", water: "--t-water", ink: "--ink", soft: "--ink-soft", pokeYellow: "--poke-yellow" };
  for (const [k, n] of Object.entries(map)) if (v(n)) C[k] = v(n);
  if (v("--font-display")) DISPLAY = v("--font-display");
  if (v("--font-body")) BODY = v("--font-body");
}

const disp = (px) => `400 ${px}px ${DISPLAY}`;
const font = (px, weight = 800) => `${weight} ${px}px ${BODY}`;
const eur = (n) => `${(Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const km = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Vorlagen (Storyboards, alle 15 Sekunden)
// ---------------------------------------------------------------------------
const TEMPLATES = {
  tour: {
    label: "All-in-One Komplett-Tour (Binder, Swipe & Radar)",
    scenes: [["scan", 0, 3], ["swipe", 3, 8], ["radar", 8, 12], ["cta", 12, 15]],
    swipeDirs: [-1, 1, 1], radarMode: "deal", dealCount: 1,
    scan: "Frische Pulls im virtuellen Binder scannen! ⚡️💎",
    swipe: "Tinder für Pokémon-Karten 💚",
    alert: "🚨 PREIS-ALARM: Wunschbudget erreicht auf Cardmarket & eBay!",
    radarLabel: (n) => `📡 Live-Radar · ${n} Deals unter Cardmarket-Trend`,
    ctaTag: "Binder, Swipe & Preis-Radar in einer App",
  },
  trade: {
    label: "Fokus: Tinder-Tauschbörse in deiner Nähe",
    scenes: [["scan", 0, 2.5], ["swipe", 2.5, 10], ["radar", 10, 12.5], ["cta", 12.5, 15]],
    swipeDirs: [-1, 1, -1, 1], radarMode: "trade", dealCount: 1,
    scan: "Doppelte Karten? Tausch sie in deiner Nähe! 🤝⚡️",
    swipe: "Swipe rechts = Tausch-Match 📍",
    alert: "🤝 TAUSCH-MATCH: Ein Sammler in deiner Nähe will tauschen!",
    radarLabel: (n) => `📡 Tausch-Radar · ${n} Sammler im Umkreis von 10 km`,
    ctaTag: "Sicher tauschen mit Sammlern in deiner Nähe",
  },
  deals: {
    label: "Fokus: eBay & Cardmarket Schnäppchen-Alarm",
    scenes: [["scan", 0, 3], ["swipe", 3, 6], ["radar", 6, 12], ["cta", 12, 15]],
    swipeDirs: [-1, 1], radarMode: "deal", dealCount: 3,
    scan: "Was ist dein Pull wirklich wert? 💰⚡️",
    swipe: "Unter Trend? Sofort zuschlagen 🔥",
    alert: "🚨 PREIS-ALARM: Wunschbudget erreicht auf Cardmarket & eBay!",
    radarLabel: (n) => `📡 Schnäppchen-Radar · ${n} Deals unter Trend`,
    ctaTag: "Nie wieder ein Schnäppchen verpassen",
  },
};
const DURATION = 15;

// ---------------------------------------------------------------------------
// Karten aus dem bestehenden App-Code (REAL_CARDS in index.html, Preise live aktualisiert)
// ---------------------------------------------------------------------------
function catalog() {
  let list = [];
  try { list = REAL_CARDS; } catch { list = []; } // globale Konstante aus index.html
  return (Array.isArray(list) ? list : []).filter((c) => c && c.img && c.name && Number(c.trend) > 0);
}
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

const imgCache = new Map();
function loadImg(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((resolve) => {
      const i = new Image();
      i.crossOrigin = "anonymous"; // Pflicht, sonst wäre das Canvas "tainted" und nicht aufnehmbar
      i.decoding = "async";
      const timer = setTimeout(() => resolve(null), 12000);
      i.onload = () => { clearTimeout(timer); resolve(i); };
      i.onerror = () => { clearTimeout(timer); resolve(null); };
      i.src = src;
    }));
  }
  return imgCache.get(src);
}
const cardSrc = (c) => cdn(c.img, 800);

async function pickLoaded(pool, n) {
  const out = [];
  let i = 0;
  while (i < pool.length && out.length < n) {
    const batch = pool.slice(i, i + (n - out.length) + 2);
    i += batch.length;
    const imgs = await Promise.all(batch.map((c) => loadImg(cardSrc(c))));
    batch.forEach((c, k) => { if (imgs[k] && out.length < n) out.push({ card: c, image: imgs[k] }); });
  }
  return out;
}

function dealOf(c) {
  const was = Number(c.trend);
  const low = Number(c.low);
  const now = low > 0 && low < was * 0.92 ? low : Math.round(was * 0.66 * 100) / 100;
  return { was, now, off: Math.round((1 - now / was) * 100) };
}

let plan = null;
let icon = null;

async function buildPlan() {
  const pool = shuffle(catalog());
  if (!pool.length) throw new Error("Keine Karten im App-Code gefunden.");
  const picked = await pickLoaded(pool, 8);
  if (!picked.length) throw new Error("Kartenbilder konnten nicht geladen werden.");
  const at = (k) => picked[k % picked.length];
  const rnd = (a, b) => a + Math.random() * (b - a);
  plan = {
    scan: at(0),
    swipe: [at(1), at(2), at(3), at(4)],
    deals: [at(5), at(6), at(7)].sort((a, b) => dealOf(b.card).off - dealOf(a.card).off),
    trade: [at(2), at(5)],
    cta: [at(1), at(0), at(3)],
    km: [rnd(0.8, 6.5), rnd(0.8, 6.5), rnd(0.8, 6.5), rnd(0.8, 6.5)],
    nearby: Math.floor(rnd(3, 9)),
    dealsCount: Math.floor(rnd(9, 27)),
    blips: Array.from({ length: 7 }, () => ({ a: rnd(0, Math.PI * 2), r: rnd(0.25, 0.92) })),
    target: { a: rnd(-0.6, 0.6) - Math.PI / 4, r: rnd(0.45, 0.7) },
  };
  return plan;
}

// ---------------------------------------------------------------------------
// Zeichen-Helfer
// ---------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const eOut = (k) => 1 - Math.pow(1 - k, 3);
const eIn = (k) => k * k * k;
const eInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const eBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return k <= 0 ? 0 : 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const rgba = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

function text(ctx, s, x, y, o = {}) {
  ctx.save();
  ctx.font = o.font || font(32);
  ctx.fillStyle = o.color || C.ink;
  ctx.textAlign = o.align || "left";
  ctx.textBaseline = o.base || "alphabetic";
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || 30; }
  if (o.maxW) {
    let size = parseInt(/(\d+)px/.exec(ctx.font)[1], 10);
    while (ctx.measureText(s).width > o.maxW && size > 14) { size -= 2; ctx.font = ctx.font.replace(/\d+px/, `${size}px`); }
  }
  ctx.fillText(s, x, y);
  ctx.restore();
}
function wrap(ctx, s, maxW) {
  const words = s.split(" "), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

/** Sammelkarte mit abgerundeten Ecken, gelbem Rand und Holo-Schimmer (wie #swipe-img der App). */
function drawCard(ctx, item, cx, cy, w, o = {}) {
  const h = w * 88 / 63;
  ctx.save();
  ctx.translate(cx, cy);
  if (o.rot) ctx.rotate(o.rot);
  if (o.scale) ctx.scale(o.scale, o.scale);
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  const r = w * 0.05;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 26;
  rr(ctx, -w / 2, -h / 2, w, h, r); ctx.fillStyle = C.night3; ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, -w / 2, -h / 2, w, h, r); ctx.clip();
  drawCover(ctx, item.image, -w / 2, -h / 2, w, h);
  if (o.holo !== false) {
    const p = ((o.t || 0) * 0.45) % 1.6 - 0.3;
    const g = ctx.createLinearGradient(-w / 2 + w * p * 1.6 - w * 0.6, -h / 2, -w / 2 + w * p * 1.6 + w * 0.2, h / 2);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,255,255,.22)");
    g.addColorStop(0.55, "rgba(120,200,255,.16)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  if (o.dim) { ctx.fillStyle = `rgba(2,6,23,${o.dim})`; ctx.fillRect(-w / 2, -h / 2, w, h); }
  if (o.inner) o.inner(ctx, w, h);
  ctx.restore();
  rr(ctx, -w / 2, -h / 2, w, h, r);
  ctx.lineWidth = Math.max(3, w * 0.008); ctx.strokeStyle = rgba(C.pokeYellow, 0.55); ctx.stroke();
  if (o.after) o.after(ctx, w, h);
  ctx.restore();
}

// Hintergrund (theme.css: Nachtblau, rote/blaue/gelbe Lichter, Pokéball-Raster) einmal vorrendern
let bgCanvas = null, patternTile = null;
function prerender() {
  bgCanvas = document.createElement("canvas"); bgCanvas.width = W; bgCanvas.height = H;
  const b = bgCanvas.getContext("2d");
  b.fillStyle = C.night; b.fillRect(0, 0, W, H);
  const glow = (x, y, r, col, a) => { const g = b.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); b.fillStyle = g; b.fillRect(0, 0, W, H); };
  glow(W * 0.85, -H * 0.08, 1050, C.red, 0.32);
  glow(-W * 0.1, H * 0.32, 900, C.water, 0.22);
  glow(W * 0.6, H * 1.08, 950, C.electric, 0.16);
  patternTile = document.createElement("canvas"); patternTile.width = patternTile.height = 180;
  const p = patternTile.getContext("2d");
  p.strokeStyle = "rgba(243,239,228,0.05)"; p.lineWidth = 3;
  circle(p, 90, 90, 51); p.stroke(); circle(p, 90, 90, 16.5); p.stroke();
  p.beginPath(); p.moveTo(39, 90); p.lineTo(72, 90); p.moveTo(108, 90); p.lineTo(141, 90); p.stroke();
}
function drawBackground(ctx, t) {
  ctx.drawImage(bgCanvas, 0, 0);
  const pat = ctx.createPattern(patternTile, "repeat");
  const off = (t * 14) % 180;
  ctx.save(); ctx.translate(off, off * 2 % 180 - 180); ctx.fillStyle = pat; ctx.fillRect(-180, 0, W + 360, H + 360); ctx.restore();
}

/** Pokédex-Linse aus dem Header der App */
function lens(ctx, x, y, r) {
  circle(ctx, x, y, r + 10); ctx.fillStyle = C.hinge; ctx.fill();
  circle(ctx, x, y, r + 6); ctx.fillStyle = C.ink; ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
  g.addColorStop(0, "#c8ecff"); g.addColorStop(0.12, "#c8ecff"); g.addColorStop(0.13, C.water);
  g.addColorStop(0.55, C.water); g.addColorStop(0.56, "#1f4f87"); g.addColorStop(1, "#1f4f87");
  circle(ctx, x, y, r); ctx.fillStyle = g; ctx.fill();
}
/** Roter Pokédex-Kopf mit Scharnier-Band, LEDs und "PokeSwipe Radar"-Logo */
function dexBar(ctx, sub, t) {
  const g = ctx.createLinearGradient(0, 0, 0, 190);
  g.addColorStop(0, C.red); g.addColorStop(1, C.redDark);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 190);
  ctx.restore();
  ctx.fillStyle = C.hinge; ctx.fillRect(0, 190, W, 12);
  lens(ctx, 100, 98, 50);
  const pulse = (t * 0.6) % 1;
  circle(ctx, 100, 98, 56 + pulse * 40); ctx.strokeStyle = rgba(C.water, 0.6 * (1 - pulse)); ctx.lineWidth = 6; ctx.stroke();
  [["#ff8a8a", 196], [C.electric, 226], ["#8be39a", 256]].forEach(([col, x]) => { circle(ctx, x, 46, 11); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.hinge; ctx.stroke(); });
  ctx.font = disp(68);
  ctx.fillStyle = "#fff7e6"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("PokeSwipe ", 186, 132);
  const w1 = ctx.measureText("PokeSwipe ").width;
  ctx.fillStyle = C.electric; ctx.fillText("Radar", 186 + w1, 132);
  text(ctx, sub, 188, 170, { font: font(24, 800), color: "#ffd9d4" });
  rr(ctx, W - 250, 66, 200, 56, 28); ctx.fillStyle = "rgba(26,20,32,.7)"; ctx.fill();
  text(ctx, "Pokémon TCG", W - 150, 104, { font: font(24, 900), color: C.electric, align: "center" });
}

function caption(ctx, s, y, k, px = 84) {
  ctx.save();
  ctx.font = disp(px);
  const lines = wrap(ctx, s, 940);
  const lh = px * 1.12;
  const sc = lerp(0.82, 1, eBack(k));
  ctx.globalAlpha *= clamp(k * 2.2);
  ctx.translate(W / 2, y + (lines.length * lh) / 2);
  ctx.scale(sc, sc);
  lines.forEach((line, i) => {
    const ly = -(lines.length * lh) / 2 + lh * (i + 0.8);
    ctx.textAlign = "center";
    ctx.lineWidth = 14; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(12,16,34,.75)"; ctx.strokeText(line, 0, ly);
    ctx.shadowColor = rgba(C.electric, 0.85); ctx.shadowBlur = 34;
    const g = ctx.createLinearGradient(0, ly - px, 0, ly);
    g.addColorStop(0, "#fff7e6"); g.addColorStop(1, C.electric);
    ctx.fillStyle = g; ctx.fillText(line, 0, ly);
    ctx.shadowBlur = 0;
  });
  ctx.restore();
  return lines.length * lh;
}

function watermark(ctx) {
  text(ctx, "pokeswipe-radar.de", W / 2, 1880, { font: font(30, 900), color: rgba(C.ink, 0.55), align: "center" });
}

function pill(ctx, s, cx, cy, o = {}) {
  ctx.save();
  ctx.font = o.font || font(28, 900);
  const w = ctx.measureText(s).width + (o.padX || 40), h = o.h || 56;
  rr(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = o.bg || C.pokeYellow; ctx.fill();
  if (o.stroke) { ctx.lineWidth = 3; ctx.strokeStyle = o.stroke; ctx.stroke(); }
  ctx.fillStyle = o.color || C.slate950; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(s, cx, cy + 2);
  ctx.restore();
  return w;
}

function button(ctx, s, x, y, w, h, fill, color = "#fff", o = {}) {
  ctx.save();
  if (o.scale && o.scale !== 1) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(o.scale, o.scale); ctx.translate(-(x + w / 2), -(y + h / 2)); }
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || 30; }
  rr(ctx, x, y, w, h, o.r || 26);
  if (Array.isArray(fill)) { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]); ctx.fillStyle = g; } else ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  if (o.stroke) { ctx.lineWidth = 3; ctx.strokeStyle = o.stroke; ctx.stroke(); }
  text(ctx, s, x + w / 2, y + h / 2 + 2, { font: o.font || font(30, 900), color, align: "center", base: "middle", maxW: w - 24 });
  ctx.restore();
}

function tapRipple(ctx, x, y, k) {
  if (k <= 0 || k >= 1) return;
  ctx.save();
  circle(ctx, x, y, 34 * (1 - k * 0.3)); ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`; ctx.fill();
  circle(ctx, x, y, 30 + 70 * k); ctx.lineWidth = 6; ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Szene 1 – Hook & Binder-Scanner
// ---------------------------------------------------------------------------
function sceneScan(ctx, lt, d, tpl, t) {
  const r = d / 3;
  dexBar(ctx, "SAMMLUNG · BINDER-SCANNER", t);
  caption(ctx, tpl.scan, 240, prog(lt, 0, 0.4 * r), 82);

  // Binder-Panel (Farbverlauf wie der Swipe-Container der App)
  const g = ctx.createLinearGradient(0, 600, 0, 1720);
  g.addColorStop(0, C.slate950); g.addColorStop(0.7, rgba(C.indigo950, 0.85)); g.addColorStop(1, C.slate950);
  rr(ctx, 90, 600, 900, 1120, 50); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.pokeYellow, 0.3); ctx.stroke();
  text(ctx, "📒 Virtueller Binder", 140, 670, { font: font(32, 900), color: C.electric });
  const blink = Math.sin(t * 8) > 0 ? 1 : 0.35;
  circle(ctx, W - 300, 659, 10); ctx.fillStyle = rgba(C.emerald, blink); ctx.fill();
  text(ctx, "Scanner aktiv", W - 140, 670, { font: font(28, 800), color: C.emerald, align: "right" });

  const item = plan.scan, cw = 520, ch = cw * 88 / 63, cx = W / 2, cy = 730 + ch / 2;
  const appear = eOut(prog(lt, 0.05 * r, 0.6 * r));
  const scan = eInOut(prog(lt, 0.55 * r, 1.95 * r));
  const done = lt >= 1.95 * r;
  const flash = done ? 1 - prog(lt, 1.95 * r, 2.35 * r) : 0;

  const halo = ctx.createRadialGradient(cx, cy, 50, cx, cy, 520);
  halo.addColorStop(0, rgba(C.pokeYellow, 0.22)); halo.addColorStop(0.6, rgba(C.purple, 0.12)); halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo; ctx.fillRect(cx - 520, cy - 520, 1040, 1040);

  drawCard(ctx, item, cx, cy, cw, {
    t, scale: lerp(0.8, 1, appear), rot: lerp(-0.12, 0, appear), alpha: appear,
    inner: (c, w, h) => {
      const ly = -h / 2 + scan * h;
      if (!done) {
        c.fillStyle = "rgba(2,6,23,.6)"; c.fillRect(-w / 2, ly, w, h / 2 - ly);
        c.fillStyle = rgba(C.emerald, 0.14); c.fillRect(-w / 2, -h / 2, w, ly + h / 2);
        // Raster der bereits gescannten Fläche
        c.strokeStyle = rgba(C.emerald, 0.22); c.lineWidth = 2;
        for (let gy = -h / 2; gy < ly; gy += 34) { c.beginPath(); c.moveTo(-w / 2, gy); c.lineTo(w / 2, gy); c.stroke(); }
        if (scan > 0) {
          const tr = c.createLinearGradient(0, ly - 150, 0, ly);
          tr.addColorStop(0, rgba(C.emerald, 0)); tr.addColorStop(1, rgba(C.emerald, 0.45));
          c.fillStyle = tr; c.fillRect(-w / 2, ly - 150, w, 150);
        }
      }
      if (flash > 0) { c.fillStyle = `rgba(220,255,240,${0.65 * flash})`; c.fillRect(-w / 2, -h / 2, w, h); }
    },
    after: (c, w, h) => {
      if (!done && scan > 0) {
        const ly = -h / 2 + scan * h;
        c.save(); c.shadowColor = C.emerald; c.shadowBlur = 40;
        c.fillStyle = "#b7ffdf"; c.fillRect(-w / 2 - 40, ly - 4, w + 80, 8);
        c.fillStyle = C.emerald; c.fillRect(-w / 2 - 40, ly - 2, w + 80, 4);
        c.restore();
      }
      // grüne Scan-Ecken
      const pad = 26, L = 70;
      c.save(); c.strokeStyle = rgba(C.emerald, 0.6 + 0.4 * Math.sin(t * 6)); c.lineWidth = 9; c.lineCap = "round";
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        const x = sx * (w / 2 + pad), y = sy * (h / 2 + pad);
        c.beginPath(); c.moveTo(x, y - sy * L); c.lineTo(x, y); c.lineTo(x - sx * L, y); c.stroke();
      });
      c.restore();
    },
  });

  if (!done && lt > 0.5 * r) {
    text(ctx, `🔍 Scanne Karte … ${Math.round(scan * 100)} %`, W / 2, 1580, { font: font(36, 900), color: C.emerald, align: "center" });
  }
  // Preis-Pop-up (Cardmarket-Trend der Karte)
  const k = prog(lt, 1.98 * r, 2.45 * r);
  if (k > 0) {
    const sc = eBack(k);
    ctx.save();
    ctx.translate(W / 2, 1530); ctx.scale(sc, sc);
    ctx.shadowColor = rgba(C.emerald, 0.6); ctx.shadowBlur = 50;
    rr(ctx, -400, -130, 800, 260, 40); ctx.fillStyle = rgba(C.night2, 0.97); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = C.emerald; ctx.stroke();
    text(ctx, `✓ Erkannt: ${item.card.name} · ${item.card.num}`, 0, -66, { font: font(32, 900), color: C.emerald, align: "center", maxW: 740 });
    text(ctx, "Aktueller Cardmarket-Trend", 0, -20, { font: font(26, 700), color: C.slate400, align: "center" });
    const val = Number(item.card.trend) * eOut(prog(lt, 1.98 * r, 2.7 * r));
    text(ctx, eur(val), 0, 90, { font: disp(110), color: C.electric, align: "center", glow: rgba(C.electric, 0.6), blur: 30 });
    ctx.restore();
  }
  watermark(ctx);
}

// ---------------------------------------------------------------------------
// Szene 2 – Swipe-Interface (wie der Arena-Tab)
// ---------------------------------------------------------------------------
function sceneSwipe(ctx, lt, d, tpl, t) {
  dexBar(ctx, "ARENA · SWIPE", t);
  caption(ctx, tpl.swipe, 232, prog(lt, 0, 0.35), 70);

  const cards = plan.swipe.slice(0, tpl.swipeDirs.length);
  const n = cards.length, slot = d / n;
  const i = Math.min(n - 1, Math.floor(lt / slot));
  const f = (lt - i * slot) / slot;
  const dir = tpl.swipeDirs[i];
  const cur = cards[i], next = cards[(i + 1) % n];

  // Set-Chips + Seltenheit (wie Deck-Filter der App)
  let x = 80;
  ctx.font = font(26, 900);
  [["Alle Sets", true], [`⚡ ${cur.card.setTag}`, false]].forEach(([s, on]) => {
    const w = ctx.measureText(s).width + 40;
    rr(ctx, x, 380, w, 56, 20); ctx.fillStyle = on ? C.pokeYellow : C.slate800; ctx.fill();
    text(ctx, s, x + w / 2, 418, { font: font(26, on ? 900 : 700), color: on ? C.slate950 : "#fff", align: "center" });
    x += w + 14;
  });
  ctx.font = font(24, 900);
  const rar = String(cur.card.rarity || "Selten");
  const rw = Math.min(380, ctx.measureText(rar).width + 34);
  rr(ctx, W - 80 - rw, 384, rw, 48, 14); ctx.fillStyle = C.pokeYellow; ctx.fill();
  text(ctx, rar, W - 80 - rw / 2, 417, { font: font(24, 900), color: C.slate950, align: "center", maxW: rw - 20 });

  // Container
  const g = ctx.createLinearGradient(0, 470, 0, 1700);
  g.addColorStop(0, C.slate950); g.addColorStop(0.55, rgba(C.indigo950, 0.75)); g.addColorStop(1, C.slate950);
  rr(ctx, 60, 470, 960, 1230, 44); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.pokeYellow, 0.3); ctx.stroke();

  const cw = 490, ch = cw * 88 / 63, cx = W / 2, cy = 520 + ch / 2;
  const halo = ctx.createRadialGradient(cx, cy, 40, cx, cy, 460);
  halo.addColorStop(0, rgba(C.pokeYellow, 0.25)); halo.addColorStop(0.5, rgba("#ef4444", 0.14)); halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo; ctx.fillRect(cx - 460, cy - 460, 920, 920);

  // nächste Karte im Stapel
  const enter = eOut(prog(f, 0, 0.15));
  drawCard(ctx, next, cx, cy + 26, cw, { t, scale: 0.93, dim: 0.35 });

  const drag = eInOut(prog(f, 0.28, 0.58));
  const fly = eIn(prog(f, 0.58, 0.86));
  const dx = dir * (120 * drag + 1150 * fly), rot = dir * (0.1 * drag + 0.38 * fly);
  const stampA = prog(f, 0.3, 0.48);
  drawCard(ctx, cur, cx + dx, cy + lerp(26, 0, enter) - 90 * fly, cw, {
    t, rot, scale: lerp(0.93, 1, enter),
    after: (c, w, h) => {
      if (stampA <= 0) return;
      c.save();
      c.globalAlpha *= stampA;
      if (dir < 0) {
        c.translate(w * 0.18, -h * 0.34); c.rotate(0.24);
        rr(c, -150, -62, 300, 124, 20); c.fillStyle = "rgba(2,6,23,.55)"; c.fill();
        c.lineWidth = 10; c.strokeStyle = C.rose; c.stroke();
        text(c, "PASS", 0, 32, { font: disp(96), color: C.rose, align: "center" });
      } else {
        c.translate(-w * 0.08, -h * 0.32); c.rotate(-0.22);
        rr(c, -215, -92, 430, 184, 22); c.fillStyle = "rgba(2,6,23,.6)"; c.fill();
        c.lineWidth = 10; c.strokeStyle = C.emerald; c.stroke();
        text(c, "DEAL /", 0, -14, { font: disp(70), color: C.emerald, align: "center", glow: rgba(C.emerald, 0.7), blur: 20 });
        text(c, "TAUSCH-MATCH!", 0, 60, { font: disp(58), color: C.emerald, align: "center", maxW: 400 });
      }
      c.restore();
    },
  });

  // Karten-Infos & Preis-Raster (wie unter #swipe-img)
  const infoA = Math.min(prog(f, 0, 0.12), 1 - prog(f, 0.86, 0.97));
  ctx.save(); ctx.globalAlpha *= infoA;
  text(ctx, `${cur.card.name} (${cur.card.num})`, W / 2, 1290, { font: font(50, 900), color: "#fff", align: "center", maxW: 880 });
  text(ctx, cur.card.setFull || cur.card.setTag, W / 2, 1336, { font: font(28, 600), color: rgba(C.amber200, 0.85), align: "center", maxW: 880 });
  rr(ctx, 100, 1370, 880, 160, 30); ctx.fillStyle = "rgba(2,6,23,.9)"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.pokeYellow, 0.2); ctx.stroke();
  const deal = dealOf(cur.card);
  [["Cardmarket-Trend", eur(deal.was), "#fff", font(38, 800)], ["Günstigstes Angebot", eur(deal.now), C.emerald, font(44, 900)], ["Unter Trend", `−${deal.off} %`, "#facc15", font(40, 800)]]
    .forEach(([l, v, col, fnt], k) => {
      const mx = 100 + 880 / 6 + (880 / 3) * k;
      text(ctx, l, mx, 1422, { font: font(24, 700), color: C.slate400, align: "center" });
      text(ctx, v, mx, 1488, { font: fnt, color: col, align: "center", maxW: 270 });
    });
  ctx.restore();

  // Swipe-Steuerung
  const press = Math.sin(Math.PI * prog(f, 0.28, 0.6));
  button(ctx, "❌ Weiter", 100, 1560, 280, 104, C.slate800, "#e2e8f0", { scale: dir < 0 ? 1 + 0.08 * press : 1 });
  button(ctx, "💼 + Portfolio", 400, 1560, 280, 104, C.purple, "#fff");
  button(ctx, "💚 Merken & Deal", 700, 1560, 280, 104, [C.emerald, C.teal], C.slate950, { scale: dir > 0 ? 1 + 0.08 * press : 1, glow: dir > 0 && press > 0 ? rgba(C.emerald, 0.8) : null });
  tapRipple(ctx, dir < 0 ? 240 : 840, 1612, prog(f, 0.26, 0.5));

  // Umkreis-Anzeige für lokales Tauschen (nur bei Rechts-Swipe)
  if (dir > 0) {
    const k = prog(f, 0.42, 0.62), out = prog(f, 0.9, 1);
    if (k > 0) {
      ctx.save();
      ctx.globalAlpha *= 1 - out;
      const sc = eBack(k);
      ctx.translate(W / 2, 1165); ctx.scale(sc, sc);
      ctx.shadowColor = rgba(C.emerald, 0.55); ctx.shadowBlur = 40;
      rr(ctx, -430, -78, 860, 156, 78); ctx.fillStyle = "rgba(12,16,34,.95)"; ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 4; ctx.strokeStyle = C.emerald; ctx.stroke();
      const rx = -350;
      [0, 0.33, 0.66].forEach((ph) => { const p = (t * 0.9 + ph) % 1; circle(ctx, rx, 0, 14 + p * 50); ctx.lineWidth = 4; ctx.strokeStyle = rgba(C.emerald, 0.8 * (1 - p)); ctx.stroke(); });
      circle(ctx, rx, 0, 14); ctx.fillStyle = C.emerald; ctx.fill();
      text(ctx, `📍 Tauschpartner in ${km(plan.km[i])} km`, -270, -8, { font: font(38, 900), color: C.emerald, maxW: 680 });
      text(ctx, `Umkreis 10 km · ${plan.nearby} Sammler suchen diese Karte`, -270, 40, { font: font(26, 700), color: C.soft, maxW: 680 });
      ctx.restore();
    }
  }
  watermark(ctx);
}

// ---------------------------------------------------------------------------
// Szene 3 – Push-Benachrichtigung + Live-Radar
// ---------------------------------------------------------------------------
function sceneRadar(ctx, lt, d, tpl, t) {
  dexBar(ctx, tpl.radarMode === "trade" ? "TAUSCH · LIVE-RADAR" : "PREISE · LIVE-RADAR", t);
  const deals = plan.deals.slice(0, tpl.dealCount);
  const panelIn = 1.0;
  const per = (d - panelIn - 0.3) / deals.length;
  const di = Math.min(deals.length - 1, Math.max(0, Math.floor((lt - panelIn) / per)));
  const cur = deals[di];
  const deal = dealOf(cur.card);

  // Radar
  const cx = W / 2, cy = 820, R = 300;
  const land = prog(lt, 0.2, 0.75);
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  rg.addColorStop(0, rgba(C.emerald, 0.2)); rg.addColorStop(1, "rgba(2,6,23,.92)");
  circle(ctx, cx, cy, R); ctx.fillStyle = rg; ctx.fill();
  ctx.save();
  ctx.shadowColor = rgba(C.emerald, 0.7); ctx.shadowBlur = 30;
  circle(ctx, cx, cy, R); ctx.lineWidth = 6; ctx.strokeStyle = rgba(C.emerald, 0.75); ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.emerald, 0.25);
  [0.25, 0.5, 0.75].forEach((k) => { circle(ctx, cx, cy, R * k); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  const a = t * 2.3;
  ctx.save();
  circle(ctx, cx, cy, R); ctx.clip();
  for (let j = 0; j < 26; j++) {
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a - (j + 1) * 0.045, a - j * 0.045);
    ctx.closePath(); ctx.fillStyle = rgba(C.emerald, 0.32 * (1 - j / 26)); ctx.fill();
  }
  ctx.restore();
  ctx.save(); ctx.shadowColor = C.emerald; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineWidth = 5; ctx.strokeStyle = "#b7ffdf"; ctx.stroke();
  ctx.restore();
  const TAU = Math.PI * 2;
  plan.blips.forEach((b) => {
    const diff = ((a - b.a) % TAU + TAU) % TAU;
    const al = Math.max(0.15, 1 - diff / 3.2);
    circle(ctx, cx + Math.cos(b.a) * R * b.r, cy + Math.sin(b.a) * R * b.r, 10); ctx.fillStyle = rgba(C.emerald, al); ctx.fill();
  });
  if (icon) { ctx.save(); ctx.globalAlpha = 0.95; ctx.drawImage(icon, cx - 40, cy - 40, 80, 80); ctx.restore(); }
  // Ziel-Blip (der Deal) blinkt
  if (land > 0) {
    const tx = cx + Math.cos(plan.target.a) * R * plan.target.r, ty = cy + Math.sin(plan.target.a) * R * plan.target.r;
    const p = (t * 1.4) % 1;
    circle(ctx, tx, ty, 18 + p * 60); ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.pokeYellow, 0.9 * (1 - p)); ctx.stroke();
    circle(ctx, tx, ty, 18); ctx.fillStyle = Math.sin(t * 10) > -0.2 ? C.pokeYellow : "#fff"; ctx.fill();
    const lab = tpl.radarMode === "trade" ? `🤝 ${km(plan.km[0])} km` : `−${deal.off} %`;
    pill(ctx, lab, tx + 10, ty - 62, { font: font(30, 900), h: 58 });
  }
  const count = tpl.radarMode === "trade" ? plan.nearby : plan.dealsCount;
  text(ctx, tpl.radarLabel(count), W / 2, 1192, { font: font(32, 900), color: C.ink, align: "center", maxW: 960 });

  // Deal- bzw. Tausch-Panel
  const pk = prog(lt, panelIn, panelIn + 0.45);
  if (pk > 0) {
    const slideK = deals.length > 1 && di > 0 ? eOut(prog(lt - panelIn - di * per, 0, 0.35)) : 1;
    ctx.save();
    ctx.globalAlpha *= clamp(pk * 2);
    ctx.translate((1 - slideK) * 700, (1 - eOut(pk)) * 140);
    const bl = 0.5 + 0.5 * Math.sin(t * 7);
    ctx.shadowColor = rgba(C.emerald, 0.35 + 0.35 * bl); ctx.shadowBlur = 50;
    rr(ctx, 80, 1236, 920, 470, 40); ctx.fillStyle = rgba(C.night2, 0.97); ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 4; ctx.strokeStyle = rgba(C.emerald, 0.5 + 0.5 * bl); ctx.stroke();

    if (tpl.radarMode === "trade") {
      const [mine, theirs] = plan.trade;
      text(ctx, "Deine Karte", 230, 1290, { font: font(24, 800), color: C.soft, align: "center" });
      text(ctx, "Partner-Karte", 850, 1290, { font: font(24, 800), color: C.soft, align: "center" });
      drawCard(ctx, mine, 230, 1310 + 150, 215, { t, holo: true });
      drawCard(ctx, theirs, 850, 1310 + 150, 215, { t: t + 1, holo: true });
      text(ctx, "⇄", W / 2, 1420, { font: disp(110), color: C.electric, align: "center", glow: rgba(C.electric, 0.7), blur: 26 });
      text(ctx, "Wert ≈", W / 2, 1478, { font: font(26, 700), color: C.soft, align: "center" });
      text(ctx, `${eur(mine.card.trend)} ⇄ ${eur(theirs.card.trend)}`, W / 2, 1522, { font: font(30, 900), color: C.ink, align: "center", maxW: 380 });
      text(ctx, `📍 ${km(plan.km[0])} km entfernt`, W / 2, 1572, { font: font(30, 900), color: C.emerald, align: "center" });
      button(ctx, "💬 Tausch-Chat", 120, 1610, 410, 76, C.purple, "#fff", { font: font(28, 900) });
      button(ctx, "✅ Tausch annehmen", 550, 1610, 410, 76, [C.emerald, C.teal], C.slate950, { font: font(28, 900) });
      tapRipple(ctx, 755, 1648, prog(lt, d - 1.1, d - 0.5));
    } else {
      drawCard(ctx, cur, 120 + 125, 1280 + 175, 250, { t });
      const live = Math.sin(t * 9) > 0;
      circle(ctx, 424, 1300, 11); ctx.fillStyle = live ? C.rose : rgba(C.rose, 0.3); ctx.fill();
      text(ctx, "LIVE-DEAL", 446, 1311, { font: font(28, 900), color: C.rose });
      pill(ctx, `−${deal.off} %`, 900, 1300, { font: font(30, 900), h: 56 });
      text(ctx, cur.card.name, 410, 1376, { font: font(46, 900), color: C.ink, maxW: 560 });
      text(ctx, `${cur.card.setTag} · ${cur.card.num}`, 410, 1418, { font: font(26, 700), color: C.soft, maxW: 560 });
      text(ctx, eur(deal.now), 410, 1515, { font: disp(96), color: C.emerald, glow: rgba(C.emerald, 0.55), blur: 24, maxW: 560 });
      ctx.save();
      ctx.font = font(34, 800);
      const st = `statt ${eur(deal.was)}`, sw = ctx.measureText(st).width;
      text(ctx, st, 410, 1564, { font: font(34, 800), color: C.soft });
      ctx.fillStyle = C.rose; ctx.fillRect(408, 1550, sw + 4, 4);
      ctx.restore();
      button(ctx, "🛒 eBay-Bestpreis*", 410, 1596, 280, 80, C.blue, "#fff", { font: font(26, 900), r: 20 });
      button(ctx, "📊 Cardmarket", 706, 1596, 264, 80, C.indigo, "#fff", { font: font(26, 900), r: 20 });
      tapRipple(ctx, 550, 1636, prog(lt, d - 1.1, d - 0.5));
    }
    ctx.restore();
  }
  text(ctx, tpl.radarMode === "trade" ? "Sicherer Tausch mit Chat & Bewertungen" : "*Partner-Link (eBay Partner Network) · Preise: Cardmarket", W / 2, 1770, { font: font(24, 700), color: rgba(C.soft, 0.8), align: "center" });

  // Push-Benachrichtigung gleitet von oben herein
  const nk = prog(lt, 0.15, 0.8);
  const ny = lerp(-360, 46, eBack(nk));
  const shake = nk >= 1 ? Math.sin(lt * 70) * 8 * (1 - prog(lt, 0.8, 1.15)) : 0;
  ctx.save();
  ctx.translate(shake, 0);
  ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
  rr(ctx, 36, ny, 1008, 300, 52); ctx.fillStyle = "rgba(30,36,64,.97)"; ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.pokeYellow, 0.5); ctx.stroke();
  if (icon) ctx.drawImage(icon, 76, ny + 40, 88, 88);
  text(ctx, "POKESWIPE RADAR", 190, ny + 76, { font: font(26, 900), color: C.soft });
  text(ctx, "jetzt", 1000, ny + 76, { font: font(26, 700), color: C.soft, align: "right" });
  ctx.font = font(38, 900);
  const lines = wrap(ctx, tpl.alert, 790).slice(0, 3);
  lines.forEach((l, k) => text(ctx, l, 190, ny + 128 + k * 46, { font: font(38, 900), color: C.ink }));
  const subLine = tpl.radarMode === "trade"
    ? `${plan.trade[0].card.name} ⇄ ${plan.trade[1].card.name}`
    : `${cur.card.name} ${cur.card.num}: ${eur(deal.now)} statt ${eur(deal.was)}`;
  text(ctx, subLine, 190, ny + 128 + lines.length * 46 + 6, { font: font(30, 800), color: C.emerald, maxW: 800 });
  ctx.restore();
  watermark(ctx);
}

// ---------------------------------------------------------------------------
// Szene 4 – Call to Action
// ---------------------------------------------------------------------------
function sceneCta(ctx, lt, d, tpl, t) {
  // Lichtstrahlen
  ctx.save();
  ctx.translate(W / 2, 520); ctx.rotate(t * 0.25);
  for (let k = 0; k < 14; k++) {
    ctx.rotate(Math.PI / 7);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -1400); ctx.lineTo(90, -1400); ctx.closePath();
    ctx.fillStyle = rgba(C.electric, 0.05); ctx.fill();
  }
  ctx.restore();

  // Karten-Fächer
  const fan = eOut(prog(lt, 0.2, 0.9));
  plan.cta.forEach((it, k) => {
    const off = k - 1;
    drawCard(ctx, it, W / 2 + off * 250 * fan, 1110 + Math.abs(off) * 40 + Math.sin(t * 2 + k) * 14, 300, {
      t: t + k, rot: off * 0.24 * fan, alpha: fan, scale: k === 1 ? 1.08 : 0.95,
    });
  });

  // Logo
  const lk = prog(lt, 0, 0.7);
  if (icon) {
    ctx.save();
    ctx.translate(W / 2, 330); ctx.rotate((1 - eBack(lk)) * -Math.PI * 1.2); ctx.scale(lerp(0.2, 1, eBack(lk)), lerp(0.2, 1, eBack(lk)));
    ctx.globalAlpha *= clamp(lk * 3);
    ctx.shadowColor = rgba(C.electric, 0.6); ctx.shadowBlur = 70;
    ctx.drawImage(icon, -150, -150, 300, 300);
    ctx.restore();
  }
  const tk = eOut(prog(lt, 0.25, 0.75));
  ctx.save();
  ctx.globalAlpha *= tk; ctx.translate(0, (1 - tk) * 60);
  ctx.font = disp(124);
  const w1 = ctx.measureText("PokeSwipe ").width, w2 = ctx.measureText("Radar").width;
  const sx = W / 2 - (w1 + w2) / 2;
  ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 20;
  text(ctx, "PokeSwipe ", sx, 640, { font: disp(124), color: "#fff7e6" });
  text(ctx, "Radar", sx + w1, 640, { font: disp(124), color: C.electric, glow: rgba(C.electric, 0.7), blur: 30 });
  text(ctx, tpl.ctaTag, W / 2, 712, { font: font(40, 800), color: C.ink, align: "center", maxW: 960 });
  ctx.restore();

  // Leuchtender Button
  const bk = prog(lt, 0.6, 1.1);
  if (bk > 0) {
    const sc = eBack(bk) * (1 + 0.035 * Math.sin(t * 6));
    ctx.save();
    ctx.translate(W / 2, 1520); ctx.scale(sc, sc);
    ctx.shadowColor = rgba(C.pokeYellow, 0.85); ctx.shadowBlur = 50 + 25 * Math.sin(t * 6);
    rr(ctx, -420, -82, 840, 164, 82);
    const g = ctx.createLinearGradient(0, -82, 0, 82); g.addColorStop(0, C.pokeYellow); g.addColorStop(1, C.electric);
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); rr(ctx, -420, -82, 840, 164, 82); ctx.clip();
    const sh = ((t * 0.7) % 1.6) * 1400 - 900;
    const sg = ctx.createLinearGradient(sh, 0, sh + 260, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,.55)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg; ctx.fillRect(-420, -82, 840, 164);
    ctx.restore();
    text(ctx, "Jetzt kostenlos starten", 0, 24, { font: disp(70), color: C.hinge, align: "center", maxW: 780 });
    ctx.restore();
  }
  const dk = eOut(prog(lt, 0.9, 1.4));
  if (dk > 0) {
    text(ctx, "pokeswipe-radar.de 🚀🔥", W / 2, 1730 + (1 - dk) * 50, { font: disp(86), color: C.ink, align: "center", alpha: dk, glow: rgba(C.electric, 0.6), blur: 30, maxW: 1000 });
  }
}

const SCENES = { scan: sceneScan, swipe: sceneSwipe, radar: sceneRadar, cta: sceneCta };

/** Zeichnet ein einzelnes Bild des Reels zum Zeitpunkt t (Sekunden). */
function renderFrame(ctx, t, tplKey) {
  const tpl = TEMPLATES[tplKey] || TEMPLATES.tour;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, t);
  const idx = Math.max(0, tpl.scenes.findIndex(([, a, b]) => t >= a && t < b));
  const [name, a, b] = tpl.scenes[t >= DURATION ? tpl.scenes.length - 1 : idx];
  const d = b - a, lt = Math.min(t, DURATION) - a;
  const last = name === "cta";
  const enter = a === 0 ? 1 : eOut(prog(lt, 0, 0.3));
  const exit = last ? 0 : eIn(prog(lt, d - 0.22, d));
  ctx.save();
  ctx.globalAlpha = enter * (1 - exit);
  const z = lerp(1.05, 1, enter) * lerp(1, 0.97, exit);
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  SCENES[name](ctx, lt, d, tpl, t);
  ctx.restore();
  // weißer Blitz an jedem Schnitt
  const cutDist = Math.min(...tpl.scenes.slice(1).map(([, s]) => Math.abs(t - s)));
  if (cutDist < 0.14) { ctx.fillStyle = `rgba(255,255,255,${0.22 * (1 - cutDist / 0.14)})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Overlay-UI
// ---------------------------------------------------------------------------
const CSS = `
#reel-studio{position:fixed;inset:0;z-index:9999;background:rgba(5,7,15,.88);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;font-family:var(--font-body,Figtree,sans-serif);color:var(--ink,#f3efe4)}
#reel-studio[hidden]{display:none}
#reel-studio .rs-panel{width:min(980px,100%);background:var(--night-2,#131a33);border:2px solid rgba(245,200,75,.28);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
#reel-studio .rs-head{display:flex;align-items:center;gap:14px;padding:14px 18px;background:linear-gradient(180deg,var(--dex-red,#d9363e),var(--dex-red-dark,#9e1f2a));box-shadow:0 6px 0 #1a1420}
#reel-studio .rs-head b{font-family:var(--font-display,"Lilita One",sans-serif);font-weight:400;font-size:24px;display:block;line-height:1.1}
#reel-studio .rs-head small{font-size:12px;font-weight:800;color:#ffd9d4;letter-spacing:.5px}
#reel-studio .rs-lens{width:40px;height:40px;border-radius:50%;flex:none;border:4px solid #f3efe4;box-shadow:0 0 0 3px #1a1420;background:radial-gradient(circle at 35% 30%,#c8ecff 0 12%,#4a9be0 13% 55%,#1f4f87 56% 100%)}
#reel-studio .rs-x{margin-left:auto;background:rgba(26,20,32,.55);border:1px solid rgba(243,239,228,.22);color:#fff;border-radius:12px;width:40px;height:40px;font-size:18px;font-weight:900;cursor:pointer}
#reel-studio .rs-body{padding:18px;display:flex;flex-direction:column;gap:12px}
#reel-studio .rs-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#reel-studio select,#reel-studio button.rs-btn{font:800 14px var(--font-body,Figtree,sans-serif);border-radius:12px;padding:11px 14px;border:1px solid rgba(245,200,75,.25);background:var(--night-3,#1b2444);color:var(--ink,#f3efe4);cursor:pointer}
#reel-studio select{flex:1 1 300px;min-width:0}
#reel-studio button.rs-primary{background:#ffcb05;color:#1a1420;border-color:#ffcb05;font-weight:900}
#reel-studio button.rs-rec{background:#e11d48;border-color:#e11d48;color:#fff;font-weight:900}
#reel-studio button:disabled,#reel-studio select:disabled{opacity:.45;cursor:not-allowed}
#reel-studio .rs-cards{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;font-weight:700;color:var(--ink-soft,#b9b7c9)}
#reel-studio .rs-cards span{background:var(--night-3,#1b2444);border-radius:999px;padding:4px 10px}
#reel-studio .rs-progress{height:8px;border-radius:4px;background:var(--night-3,#1b2444);overflow:hidden}
#reel-studio .rs-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcb05,#34d399)}
#reel-studio .rs-status{font-size:14px;font-weight:800;min-height:20px}
#reel-studio .rs-status.err{color:#fb7185}#reel-studio .rs-status.ok{color:#34d399}
#reel-studio .rs-stage{display:flex;justify-content:center;position:relative}
#reel-studio canvas{height:min(68vh,760px);aspect-ratio:9/16;width:auto;max-width:100%;border-radius:18px;background:#0c1022;box-shadow:0 0 0 3px #2a3050,0 20px 50px rgba(0,0,0,.6)}
#reel-studio .rs-time{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(12,16,34,.85);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:900}
#reel-studio .rs-time.rec{background:#e11d48;color:#fff}
#reel-studio .rs-hint{font-size:12px;line-height:1.45;color:var(--ink-soft,#b9b7c9)}
#reel-studio a.rs-dl{display:inline-block;background:#10b981;color:#052e1f;font-weight:900;font-size:14px;border-radius:12px;padding:10px 14px;text-decoration:none}
`;

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.64002A",
  "video/mp4;codecs=avc1.4D402A",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
}

const ui = {};
let built = false, ctx = null, raf = 0, mode = "idle", startAt = 0, recorder = null, chunks = [], lastUrl = null, abortRec = false;

function isAdmin() { return !!state.me?.isAdmin; }

function build() {
  if (built) return;
  built = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement("div");
  el.id = "reel-studio"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Admin-Reel-Studio");
  el.innerHTML = `
    <div class="rs-panel">
      <div class="rs-head"><div class="rs-lens"></div><div><b>🎬 Admin-Reel-Studio</b><small>9:16 · 1080×1920 · 60 FPS · 15 Sekunden</small></div>
        <button type="button" class="rs-x" data-rs="close" aria-label="Schließen">✕</button></div>
      <div class="rs-body">
        <div class="rs-bar">
          <select id="rs-template" aria-label="Vorlage">${Object.entries(TEMPLATES).map(([k, v], i) => `<option value="${k}">${i + 1}) ${v.label}</option>`).join("")}</select>
          <button type="button" class="rs-btn" data-rs="shuffle">🔀 Zufällige Karten wählen</button>
        </div>
        <div class="rs-cards" id="rs-cards"></div>
        <div class="rs-bar">
          <button type="button" class="rs-btn" data-rs="preview">▶ Vorschau abspielen</button>
          <button type="button" class="rs-btn rs-rec" data-rs="record">⏺ Reel aufnehmen &amp; herunterladen</button>
          <a id="rs-download" class="rs-dl" hidden>⬇ Erneut herunterladen</a>
        </div>
        <div class="rs-progress"><i id="rs-bar"></i></div>
        <div class="rs-status" id="rs-status"></div>
        <div class="rs-stage"><canvas id="rs-canvas" width="${W}" height="${H}"></canvas><span class="rs-time" id="rs-time">0,0 / 15,0 s</span></div>
        <p class="rs-hint" id="rs-format"></p>
        <p class="rs-hint">Während der Aufnahme diesen Tab sichtbar lassen (nicht minimieren oder wechseln) – das Video wird in Echtzeit gezeichnet. Die fertige Datei landet in deinem Download-Ordner; von dort in Google Drive hochladen oder den Download-Ordner per Google-Drive-Desktop synchronisieren. Kein Ton enthalten – Musik am besten direkt in Instagram/TikTok hinzufügen.</p>
      </div>
    </div>`;
  document.body.append(el);
  ui.root = el;
  ui.canvas = el.querySelector("#rs-canvas");
  ui.tpl = el.querySelector("#rs-template");
  ui.cards = el.querySelector("#rs-cards");
  ui.bar = el.querySelector("#rs-bar");
  ui.status = el.querySelector("#rs-status");
  ui.time = el.querySelector("#rs-time");
  ui.format = el.querySelector("#rs-format");
  ui.dl = el.querySelector("#rs-download");
  ctx = ui.canvas.getContext("2d");
  el.addEventListener("click", (e) => {
    const act = e.target.closest("[data-rs]")?.dataset.rs;
    if (e.target === el && mode !== "rec") return close();
    if (act === "close") close();
    if (act === "shuffle") shuffleCards();
    if (act === "preview") mode === "preview" ? stopPreview() : startPreview();
    if (act === "record") record();
  });
  ui.tpl.addEventListener("change", () => { if (mode === "idle") drawStill(); else if (mode === "preview") startPreview(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "rec") { abortRec = true; recorder?.state === "recording" && recorder.stop(); }
  });
}

function setStatus(msg, kind = "") { ui.status.textContent = msg; ui.status.className = `rs-status ${kind}`; }
function setBusy(b) { ui.root.querySelectorAll("select, button.rs-btn").forEach((x) => { x.disabled = b; }); }
function showCards() {
  if (!plan) return;
  const names = [plan.scan, ...plan.swipe, ...plan.deals].map((x) => `${x.card.name} ${x.card.num}`);
  ui.cards.innerHTML = [...new Set(names)].map((n) => `<span>${n.replace(/[<>&]/g, "")}</span>`).join("");
}
function fmtTime(t) { return `${t.toFixed(1).replace(".", ",")} / ${DURATION.toFixed(1).replace(".", ",")} s`; }
function drawStill() { if (plan) { renderFrame(ctx, 2.6, ui.tpl.value); ui.time.textContent = fmtTime(0); } }

async function prepare() {
  readTheme();
  prerender();
  try {
    await Promise.all([
      document.fonts?.load(disp(80)), document.fonts?.load(font(40, 900)), document.fonts?.load(font(40, 800)),
      document.fonts?.load(font(40, 700)), document.fonts?.load(font(40, 600)),
    ]);
  } catch { /* Systemschrift als Fallback */ }
  icon = await loadImg("/icon.svg");
}

async function shuffleCards() {
  if (mode === "rec") return;
  const wasPreview = mode === "preview";
  stopPreview();
  setBusy(true); setStatus("Lade Karten aus der App …");
  try {
    await buildPlan();
    showCards();
    setStatus(`✓ ${catalog().length} Karten im Bestand – neue Auswahl geladen.`, "ok");
    wasPreview ? startPreview() : drawStill();
  } catch (e) {
    setStatus(`⚠️ ${e.message}`, "err");
  } finally { setBusy(false); }
}

function startPreview() {
  if (!plan) return;
  cancelAnimationFrame(raf);
  mode = "preview"; startAt = performance.now();
  ui.root.querySelector('[data-rs="preview"]').textContent = "■ Vorschau stoppen";
  const loop = (now) => {
    if (mode !== "preview") return;
    const t = ((now - startAt) / 1000) % DURATION;
    renderFrame(ctx, t, ui.tpl.value);
    ui.time.textContent = fmtTime(t);
    ui.bar.style.width = `${(t / DURATION) * 100}%`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function stopPreview() {
  if (mode === "preview") { mode = "idle"; cancelAnimationFrame(raf); }
  const b = ui.root?.querySelector('[data-rs="preview"]');
  if (b) b.textContent = "▶ Vorschau abspielen";
}

async function record() {
  if (mode === "rec" || !plan) return;
  const mime = pickMime();
  if (mime === null || typeof ui.canvas.captureStream !== "function") {
    return setStatus("⚠️ Dieser Browser kann kein Canvas aufnehmen. Bitte aktuelles Chrome, Edge oder Safari verwenden.", "err");
  }
  stopPreview();
  const isMp4 = mime.startsWith("video/mp4");
  const ext = isMp4 ? "mp4" : "webm";
  const tplKey = ui.tpl.value;
  renderFrame(ctx, 0, tplKey);
  let stream;
  try {
    stream = ui.canvas.captureStream(FPS);
    recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: BITRATE });
  } catch (e) {
    return setStatus(`⚠️ Aufnahme konnte nicht starten: ${e.message}`, "err");
  }
  chunks = []; abortRec = false;
  mode = "rec"; setBusy(true);
  ui.time.classList.add("rec");
  ui.dl.hidden = true;
  setStatus(`⏺ Aufnahme läuft (${ext.toUpperCase()}, 60 FPS, 8 Mbit/s) – Tab bitte sichtbar lassen …`);

  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onerror = (e) => { abortRec = true; setStatus(`⚠️ Aufnahmefehler: ${e.error?.message || "unbekannt"}`, "err"); };
  recorder.start(250);
  startAt = performance.now();

  await new Promise((resolve) => {
    const loop = (now) => {
      if (abortRec) return resolve();
      const t = (now - startAt) / 1000;
      renderFrame(ctx, Math.min(t, DURATION), tplKey);
      ui.time.textContent = `⏺ ${fmtTime(Math.min(t, DURATION))}`;
      ui.bar.style.width = `${Math.min(100, (t / DURATION) * 100)}%`;
      if (t >= DURATION + 0.25) return resolve();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
  if (recorder.state === "recording") recorder.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  mode = "idle"; setBusy(false); ui.time.classList.remove("rec");

  if (abortRec) {
    if (!/Aufnahmefehler/.test(ui.status.textContent)) setStatus("⚠️ Aufnahme abgebrochen – der Tab war nicht sichtbar. Bitte erneut aufnehmen.", "err");
    return drawStill();
  }
  const blob = new Blob(chunks, { type: (recorder.mimeType || mime || `video/${ext}`).split(";")[0] });
  if (!blob.size) return setStatus("⚠️ Die Aufnahme ist leer. Bitte erneut versuchen.", "err");
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
  const name = `pokeswipe-reel-${tplKey}-${stamp}.${ext}`;
  ui.dl.href = lastUrl; ui.dl.download = name; ui.dl.hidden = false;
  ui.dl.click();
  setStatus(`✓ Fertig: ${name} (${(blob.size / 1048576).toFixed(1)} MB) wurde heruntergeladen.`, "ok");
}

async function open() {
  build();
  if (!ui.root.hidden) return;
  ui.root.hidden = false;
  document.documentElement.style.overflow = "hidden";
  const mime = pickMime();
  ui.format.textContent = mime === null
    ? "⚠️ MediaRecorder wird von diesem Browser nicht unterstützt."
    : mime.startsWith("video/mp4")
      ? `✓ Ausgabeformat: MP4 (${mime}) – passt für Instagram Reels, TikTok, YouTube Shorts und Make.com.`
      : `⚠️ Dieser Browser kann kein MP4 aufnehmen – es wird WebM (${mime || "Standard"}) gespeichert. Für MP4 bitte aktuelles Chrome/Edge (ab Version 126) oder Safari nutzen.`;
  if (!plan) {
    setBusy(true); setStatus("Lade Schriften, Logo und Karten aus der App …");
    try { await prepare(); await buildPlan(); showCards(); setStatus("✓ Bereit. Vorlage wählen, Vorschau ansehen, dann aufnehmen.", "ok"); }
    catch (e) { setStatus(`⚠️ ${e.message}`, "err"); }
    finally { setBusy(false); }
  }
  if (plan) startPreview();
}

function close() {
  if (!ui.root || mode === "rec") return;
  stopPreview();
  ui.root.hidden = true;
  document.documentElement.style.overflow = "";
}

/** Footer-Button und Hash-Link nur für Admins freischalten (nach jedem Login-Wechsel aufrufen). */
export function syncReelStudio() {
  const btn = document.getElementById("reel-studio-btn");
  if (btn) btn.classList.toggle("hidden", !isAdmin());
  if (isAdmin() && location.hash === "#reel-studio") open();
  if (!isAdmin()) close();
}

export function initReelStudio() {
  document.getElementById("reel-studio-btn")?.addEventListener("click", () => { if (isAdmin()) open(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyR" || e.key === "R" || e.key === "r")) {
      if (!isAdmin()) return; // für alle anderen bleibt Strg+Shift+R der normale Neu-Laden-Befehl
      e.preventDefault();
      open();
    }
    if (e.key === "Escape" && ui.root && !ui.root.hidden) close();
  }, true);
}

// ---------------------------------------------------------------------------
// Zeichen-Engine für den 10x-Auto-Reel-Generator (client/auto-reels.js) freigeben
// ---------------------------------------------------------------------------
export const reelEngine = {
  W, H, FPS, BITRATE, C, disp, font, eur, km, clamp, prog, lerp, eOut, eIn, eInOut, eBack, rgba,
  rr, circle, text, wrap, drawCard, drawBackground, dexBar, caption, watermark, pill, button, tapRipple,
  SCENES, catalog, shuffle, pickLoaded, loadImg, cardSrc, dealOf, pickMime, prepare, buildPlan,
  getPlan: () => plan, getIcon: () => icon, isAdmin,
  isStudioBusy: () => mode === "rec",
};
