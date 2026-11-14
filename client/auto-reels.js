// 10x Auto-Reel-Generator – zeichnet nacheinander 10 Feature-Episoden (9:16, 1080x1920, 60 FPS)
// auf ein Canvas, nimmt sie per canvas.captureStream(60) + MediaRecorder (8 Mbit/s, MP4 bevorzugt) auf
// und schickt jede fertige Datei per POST (multipart/form-data) an die eingetragene Make.com-Webhook-URL.
// Ohne Webhook-URL (oder wenn der Versand scheitert) wird die Datei lokal heruntergeladen.
// Der Dateiname ist "Episode N - <Werbespruch>", damit Make.com ihn als Caption übernehmen kann.
// Nutzt die Zeichen-Engine, Farben, Schriften und echten Karten (REAL_CARDS) des Admin-Reel-Studios.
import { reelEngine as E } from "./reel-studio.js";

const { W, H, FPS, BITRATE, C, disp, font, eur, km, clamp, prog, lerp, eOut, eIn, eInOut, eBack, rgba,
  rr, circle, text, wrap, drawCard, drawBackground, dexBar, caption, watermark, pill, button, tapRipple } = E;

// ---------------------------------------------------------------------------
// Die 10 Episoden
// ---------------------------------------------------------------------------
const base = {
  swipeDirs: [-1, 1, 1], radarMode: "deal", dealCount: 1,
  scan: "Frische Pulls im virtuellen Binder scannen! ⚡️💎",
  swipe: "Tinder für Pokémon-Karten 💚",
  alert: "🚨 PREIS-ALARM: Wunschbudget erreicht auf Cardmarket & eBay!",
  radarLabel: (n) => `📡 Live-Radar · ${n} Deals unter Cardmarket-Trend`,
};
const EPISODES = [
  { ...base, n: 1, title: "Virtueller Binder-Scanner & Live Cardmarket-Preis-Check",
    slogan: "Frische Pulls direkt in den digitalen Binder scannen und Cardmarket-Preise live prüfen! ⚡️💎",
    scenes: [["scan", 3], ["binder", 2]], ctaTag: "Scannen, sammeln, Preise live checken" },
  { ...base, n: 2, title: "Tinder-Swipe für Tauschkarten & lokales Match",
    slogan: "Swipe nach rechts für dein nächstes Tausch-Match mit Sammlern direkt in deiner Nähe! 💚🤝",
    scenes: [["swipe", 3], ["radar", 1.4]], swipeDirs: [-1, 1, -1, 1], radarMode: "trade",
    swipe: "Swipe rechts = Tausch-Match 📍", alert: "🤝 TAUSCH-MATCH: Ein Sammler in deiner Nähe will tauschen!",
    radarLabel: (n) => `📡 Tausch-Radar · ${n} Sammler im Umkreis von 10 km`, ctaTag: "Sicher tauschen mit Sammlern in deiner Nähe" },
  { ...base, n: 3, title: "Live Flip-Radar & Schnäppchen-Alarm für eBay/Cardmarket",
    slogan: "Der Flip-Radar schlägt Alarm – Schnäppchen unter Cardmarket-Trend auf eBay & Cardmarket! 🚨💸",
    scenes: [["radar", 3], ["movers", 1.3]], dealCount: 3,
    radarLabel: (n) => `📡 Flip-Radar · ${n} Deals unter Trend`, ctaTag: "Nie wieder ein Schnäppchen verpassen" },
  { ...base, n: 4, title: "Portfolio-Wert & Sammlungs-Tracker",
    slogan: "Dein Portfolio-Wert live im Blick – jede Karte, jeder Euro, jedes Set! 📈💼",
    scenes: [["scan", 1.4], ["portfolio", 3]], scan: "Karte scannen = Portfolio wächst 📈", ctaTag: "Deine Sammlung. Dein Wert. Live." },
  { ...base, n: 5, title: "Umkreis-Radar auf der Karte für sichere Übergabe vor Ort",
    slogan: "Tauschpartner im Umkreis finden und sicher vor Ort übergeben! 📍🛡️",
    scenes: [["map", 3], ["radar", 1.3]], radarMode: "trade",
    alert: "📍 IN DEINER NÄHE: Tauschpartner gefunden – sicher vor Ort übergeben!",
    radarLabel: (n) => `📡 Umkreis-Radar · ${n} Sammler bis 10 km`, ctaTag: "Lokal tauschen – sicher & persönlich" },
  { ...base, n: 6, title: "Pull-Wall & Community-Feed für die besten Hits",
    slogan: "Zeig deine krassesten Pulls auf der Pull-Wall und feier die Hits der Community! 📸🔥",
    scenes: [["pullwall", 3], ["scan", 1.2]], scan: "Pull gezogen? Ab auf die Wall! 📸", ctaTag: "Die Community für deutsche Sammler" },
  { ...base, n: 7, title: "P2P Tausch-Hub & Direkt-Chat",
    slogan: "Tausch-Hub mit Direkt-Chat – Angebot schicken, Deal klarmachen, fertig! 💬🤝",
    scenes: [["swipe", 1.2], ["chat", 3]], swipeDirs: [-1, 1], swipe: "Karte gefunden? Direkt anschreiben 💬",
    ctaTag: "Tauschen ohne Gebühren – direkt im Chat" },
  { ...base, n: 8, title: "Top-Mover & Preissturz-Analyse aktueller Sets",
    slogan: "Top-Mover & Preisstürze – diese Karten bewegen gerade den Markt! 📊📉",
    scenes: [["movers", 3], ["radar", 1.3]], dealCount: 2, ctaTag: "Markt verstehen. Clever kaufen." },
  { ...base, n: 9, title: "Automatischer Wunschlisten-Abgleich beim Tauschen",
    slogan: "Deine Wunschliste tauscht mit – der automatische Abgleich findet sofort passende Karten! ⭐🔄",
    scenes: [["wishlist", 3], ["chat", 1.6]], ctaTag: "Wunschkarten finden – automatisch" },
  { ...base, n: 10, title: "All-in-One App-Tour",
    slogan: "Scannen, Swipen, Tauschen & Sparen – die komplette Pokémon-TCG-App für deutsche Sammler! 🚀🔥",
    scenes: [["scan", 1], ["swipe", 1], ["radar", 1], ["map", 0.9], ["portfolio", 0.9], ["pullwall", 0.8]],
    ctaTag: "Binder, Swipe, Radar, Tausch & Portfolio" },
];

const DURATIONS = [15, 20, 30, 45, 60];
let duration = 30;

/** Szenen-Zeitplan: Hook + Feature-Szenen (nach Gewicht) + Call to Action, auf die Länge D skaliert. */
function timeline(ep, D) {
  const hook = clamp(D * 0.12, 2, 3.2), cta = clamp(D * 0.15, 2.6, 4.5);
  const rest = D - hook - cta, sum = ep.scenes.reduce((s, [, w]) => s + w, 0);
  const out = [["hook", 0, hook]];
  let at = hook;
  ep.scenes.forEach(([name, w]) => { const d = rest * (w / sum); out.push([name, at, at + d]); at += d; });
  out.push(["cta", at, D]);
  return out;
}

/** Dateiname = Werbespruch (ohne in Windows/macOS/Drive verbotene Zeichen). */
function fileBase(ep) {
  return `Episode ${ep.n} - ${ep.slogan}`.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Zusätzliche Karten-Daten pro Episode (echte Karten + Preise aus REAL_CARDS)
// ---------------------------------------------------------------------------
let xp = null;
const USERS = ["@lena_sammelt", "@pikachu_jonas", "@tcg_mia", "@binder_ben", "@holo_hanna", "@glurak_tim"];
const change = (c) => (Number(c.avg30) > 0 ? (Number(c.trend) - Number(c.avg30)) / Number(c.avg30) : 0);

async function buildExtras() {
  const items = await E.pickLoaded(E.shuffle(E.catalog()), 12);
  if (!items.length) throw new Error("Kartenbilder konnten nicht geladen werden.");
  const at = (k) => items[k % items.length];
  const withAvg = E.catalog().filter((c) => Number(c.avg30) > 0);
  const sorted = withAvg.slice().sort((a, b) => change(b) - change(a));
  const ups = await E.pickLoaded(sorted.filter((c) => change(c) > 0), 3);
  const downs = await E.pickLoaded(sorted.filter((c) => change(c) < 0).reverse(), 2);
  const rnd = (a, b) => a + Math.random() * (b - a);
  xp = {
    items, at,
    ups: ups.length ? ups : [at(0)], downs: downs.length ? downs : [at(1)],
    pins: Array.from({ length: 6 }, (_, k) => ({ a: (k / 6) * Math.PI * 2 + rnd(-0.4, 0.4), r: rnd(0.3, 0.92), item: at(k + 2) })),
    users: E.shuffle(USERS),
    likes: Array.from({ length: 6 }, () => Math.floor(rnd(40, 420))),
    seed: Math.random() * 100,
  };
}

// ---------------------------------------------------------------------------
// Neue Szenen
// ---------------------------------------------------------------------------
function panel(ctx, x, y, w, h, o = {}) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.slate950); g.addColorStop(0.6, rgba(C.indigo950, 0.8)); g.addColorStop(1, C.slate950);
  ctx.save();
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 40; }
  rr(ctx, x, y, w, h, o.r || 44); ctx.fillStyle = o.fill || g; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = o.stroke || rgba(C.pokeYellow, 0.3); ctx.stroke();
  ctx.restore();
}
const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

/** Hook: Episoden-Nummer, Feature-Titel, Werbespruch und Karten-Fächer */
function sceneHook(ctx, lt, d, ep, t) {
  ctx.save();
  ctx.translate(W / 2, 1050); ctx.rotate(t * 0.2);
  for (let k = 0; k < 12; k++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-110, -1500); ctx.lineTo(110, -1500); ctx.closePath();
    ctx.fillStyle = rgba(C.electric, 0.045); ctx.fill();
  }
  ctx.restore();
  const icon = E.getIcon();
  const ik = eBack(prog(lt, 0, 0.5));
  if (icon) {
    ctx.save(); ctx.translate(W / 2, 200); ctx.scale(ik, ik);
    ctx.shadowColor = rgba(C.electric, 0.6); ctx.shadowBlur = 50;
    ctx.drawImage(icon, -85, -85, 170, 170); ctx.restore();
  }
  const pk = eBack(prog(lt, 0.1, 0.55));
  ctx.save(); ctx.translate(W / 2, 360); ctx.scale(pk, pk);
  pill(ctx, `🎬 EPISODE ${ep.n} / 10`, 0, 0, { font: font(34, 900), h: 70, padX: 60, bg: C.red, color: "#fff7e6", stroke: C.pokeYellow });
  ctx.restore();
  const tk = eOut(prog(lt, 0.2, 0.7));
  ctx.save(); ctx.globalAlpha *= tk; ctx.translate(0, (1 - tk) * 40);
  ctx.font = disp(66);
  wrap(ctx, ep.title, 940).slice(0, 3).forEach((l, i) => text(ctx, l, W / 2, 490 + i * 76, { font: disp(66), color: "#fff7e6", align: "center", maxW: 960 }));
  ctx.restore();
  const fan = eOut(prog(lt, 0.15, 0.9));
  [xp.at(0), xp.at(1), xp.at(2)].forEach((it, k) => {
    const off = k - 1;
    drawCard(ctx, it, W / 2 + off * 230 * fan, 1060 + Math.abs(off) * 40 + Math.sin(t * 2 + k) * 12, 330,
      { t: t + k, rot: off * 0.2 * fan, alpha: fan, scale: k === 1 ? 1.06 : 0.92 });
  });
  caption(ctx, ep.slogan, 1360, prog(lt, 0.45, 1.1), 70);
  watermark(ctx);
}

/** Binder-Seite (3x3), Karten fallen in die Fächer, Gesamtwert zählt mit */
function sceneBinder(ctx, lt, d, ep, t) {
  dexBar(ctx, "SAMMLUNG · VIRTUELLER BINDER", t);
  caption(ctx, "Dein digitaler Binder 📒", 230, prog(lt, 0, 0.4), 70);
  panel(ctx, 70, 390, 940, 1290);
  const cw = 262, ch = cw * 88 / 63, gap = 26, x0 = 70 + (940 - 3 * cw - 2 * gap) / 2, y0 = 430;
  let total = 0;
  for (let k = 0; k < 9; k++) {
    const col = k % 3, row = Math.floor(k / 3), cx = x0 + col * (cw + gap) + cw / 2, cy = y0 + row * (ch + 36) + ch / 2;
    rr(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 14); ctx.fillStyle = "rgba(243,239,228,.05)"; ctx.fill();
    ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.pokeYellow, 0.25); ctx.stroke(); ctx.setLineDash([]);
    const k0 = 0.05 * d + k * (0.62 * d / 9), kk = prog(lt, k0, k0 + 0.45);
    if (kk <= 0) continue;
    const it = xp.at(k);
    total += Number(it.card.trend) * eOut(kk);
    drawCard(ctx, it, cx, cy - (1 - eOut(kk)) * 60, cw, { t: t + k, scale: lerp(1.35, 1, eOut(kk)), alpha: clamp(kk * 2), rot: (1 - eOut(kk)) * 0.15 });
    if (kk >= 1) pill(ctx, eur(it.card.trend), cx, cy + ch / 2 - 6, { font: font(22, 900), h: 40, padX: 22 });
  }
  ctx.save();
  ctx.shadowColor = rgba(C.emerald, 0.5); ctx.shadowBlur = 40;
  rr(ctx, 140, 1700, 800, 140, 36); ctx.fillStyle = rgba(C.night2, 0.97); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = C.emerald; rr(ctx, 140, 1700, 800, 140, 36); ctx.stroke();
  text(ctx, "Binder-Wert (Cardmarket-Trend)", W / 2, 1746, { font: font(26, 800), color: C.slate400, align: "center" });
  text(ctx, eur(total), W / 2, 1818, { font: disp(70), color: C.electric, align: "center", glow: rgba(C.electric, 0.5), blur: 20 });
}

/** Portfolio-Wert mit 30-Tage-Verlauf und Bestandsliste */
function scenePortfolio(ctx, lt, d, ep, t) {
  dexBar(ctx, "PORTFOLIO · SAMMLUNGS-TRACKER", t);
  caption(ctx, "Portfolio-Wert live 📈", 230, prog(lt, 0, 0.4), 70);
  const hold = [0, 1, 2, 3, 4].map((k) => xp.at(k + 3));
  const now = hold.reduce((s, it) => s + Number(it.card.trend), 0);
  const then = hold.reduce((s, it) => s + (Number(it.card.avg30) || Number(it.card.trend)), 0);
  const diff = then > 0 ? (now - then) / then : 0;
  panel(ctx, 70, 380, 940, 620);
  text(ctx, "💼 Gesamtwert deiner Sammlung", 120, 450, { font: font(30, 900), color: C.soft });
  const ck = eOut(prog(lt, 0.05 * d, 0.45 * d));
  text(ctx, eur(now * ck), 120, 560, { font: disp(110), color: C.electric, glow: rgba(C.electric, 0.5), blur: 24, maxW: 560 });
  pill(ctx, `${pct(diff)} · 30 Tage`, 850, 520, { font: font(28, 900), h: 60, bg: diff >= 0 ? C.emerald : C.rose, color: C.slate950 });
  text(ctx, `📦 ${hold.length} Karten · ${new Set(hold.map((h) => h.card.setTag)).size} Sets`, 120, 616, { font: font(26, 800), color: C.soft });
  // Verlauf von Ø 30 Tage zum aktuellen Trend
  const gx = 120, gy = 650, gw = 840, gh = 310, N = 40, dk = eInOut(prog(lt, 0.1 * d, 0.6 * d));
  const pts = Array.from({ length: N }, (_, i) => {
    const f = i / (N - 1);
    const v = lerp(then, now, f) + Math.sin(f * 11 + xp.seed) * Math.abs(now - then) * 0.25 * Math.sin(f * Math.PI);
    return v;
  });
  const lo = Math.min(...pts) * 0.97, hi = Math.max(...pts) * 1.03;
  const P = (i) => [gx + (i / (N - 1)) * gw, gy + gh - ((pts[i] - lo) / (hi - lo || 1)) * gh];
  ctx.strokeStyle = "rgba(243,239,228,.07)"; ctx.lineWidth = 2;
  for (let k = 0; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(gx, gy + (gh / 3) * k); ctx.lineTo(gx + gw, gy + (gh / 3) * k); ctx.stroke(); }
  const last = Math.max(1, Math.floor(dk * (N - 1)));
  ctx.beginPath(); ctx.moveTo(...P(0));
  for (let i = 1; i <= last; i++) ctx.lineTo(...P(i));
  const col = diff >= 0 ? C.emerald : C.rose;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.lineWidth = 7; ctx.strokeStyle = col; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore();
  ctx.lineTo(P(last)[0], gy + gh); ctx.lineTo(gx, gy + gh); ctx.closePath();
  const fg = ctx.createLinearGradient(0, gy, 0, gy + gh); fg.addColorStop(0, rgba(col, 0.3)); fg.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = fg; ctx.fill();
  circle(ctx, ...P(last), 12); ctx.fillStyle = "#fff"; ctx.fill();
  // Bestandsliste
  hold.forEach((it, k) => {
    const rk = eOut(prog(lt, 0.3 * d + k * 0.08 * d, 0.3 * d + k * 0.08 * d + 0.5));
    if (rk <= 0) return;
    const y = 1040 + k * 160;
    ctx.save(); ctx.globalAlpha *= rk; ctx.translate((1 - rk) * 300, 0);
    rr(ctx, 70, y, 940, 140, 30); ctx.fillStyle = rgba(C.night2, 0.95); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.pokeYellow, 0.18); ctx.stroke();
    drawCard(ctx, it, 140, y + 70, 86, { t: t + k, holo: false });
    text(ctx, `${it.card.name} · ${it.card.num}`, 210, y + 60, { font: font(34, 900), color: C.ink, maxW: 470 });
    text(ctx, it.card.setTag, 210, y + 104, { font: font(26, 700), color: C.soft, maxW: 470 });
    const c = change(it.card);
    text(ctx, eur(it.card.trend), 980, y + 60, { font: font(36, 900), color: "#fff", align: "right" });
    text(ctx, pct(c), 980, y + 106, { font: font(28, 900), color: c >= 0 ? C.emerald : C.rose, align: "right" });
    ctx.restore();
  });
  watermark(ctx);
}

/** Umkreis-Karte mit 10-km-Radius, Pins und sicherem Treffpunkt */
function sceneMap(ctx, lt, d, ep, t) {
  dexBar(ctx, "TAUSCH-HUB · UMKREIS-MAP", t);
  caption(ctx, "Tauschpartner im Umkreis 📍", 230, prog(lt, 0, 0.4), 70);
  const mx = 60, my = 380, mw = 960, mh = 1100, cx = W / 2, cy = my + mh / 2;
  ctx.save();
  rr(ctx, mx, my, mw, mh, 44); ctx.clip();
  ctx.fillStyle = "#111833"; ctx.fillRect(mx, my, mw, mh);
  ctx.fillStyle = "rgba(52,211,153,.10)";
  [[110, 470, 220, 160], [700, 1180, 260, 190], [640, 430, 200, 120], [130, 1240, 170, 150]].forEach(([x, y, w, h]) => { rr(ctx, x, y, w, h, 30); ctx.fill(); });
  ctx.beginPath(); ctx.moveTo(mx, my + 860); ctx.bezierCurveTo(300, 1100, 620, 760, mx + mw, my + 980);
  ctx.lineWidth = 46; ctx.strokeStyle = rgba(C.water, 0.32); ctx.stroke();
  ctx.strokeStyle = "rgba(243,239,228,.09)"; ctx.lineWidth = 14;
  for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.moveTo(mx, my + 80 + k * 160); ctx.lineTo(mx + mw, my + 20 + k * 175); ctx.stroke(); }
  for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(mx + 60 + k * 175, my); ctx.lineTo(mx + 120 + k * 165, my + mh); ctx.stroke(); }
  ctx.strokeStyle = "rgba(245,200,75,.18)"; ctx.lineWidth = 24;
  ctx.beginPath(); ctx.moveTo(mx, my + 300); ctx.lineTo(mx + mw, my + 760); ctx.stroke();
  // Radius
  const R = 420 * eOut(prog(lt, 0.05 * d, 0.3 * d));
  circle(ctx, cx, cy, R); ctx.fillStyle = rgba(C.emerald, 0.1); ctx.fill();
  ctx.setLineDash([18, 12]); ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.emerald, 0.8); ctx.stroke(); ctx.setLineDash([]);
  if (R > 300) pill(ctx, "Umkreis 10 km", cx, cy - R + 4, { font: font(26, 900), h: 50, bg: C.emerald, color: C.slate950 });
  const p = (t * 0.8) % 1;
  circle(ctx, cx, cy, 20 + p * 90); ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.water, 0.8 * (1 - p)); ctx.stroke();
  circle(ctx, cx, cy, 22); ctx.fillStyle = C.water; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = "#fff"; ctx.stroke();
  // Pins
  const sel = 1;
  xp.pins.forEach((pin, k) => {
    const pk = prog(lt, 0.2 * d + k * 0.05 * d, 0.2 * d + k * 0.05 * d + 0.4);
    if (pk <= 0) return;
    const px = cx + Math.cos(pin.a) * 420 * pin.r, py = cy + Math.sin(pin.a) * 420 * pin.r - (1 - eOut(pk)) * 120;
    const active = k === sel && lt > 0.5 * d;
    ctx.save(); ctx.globalAlpha *= clamp(pk * 2);
    ctx.translate(px, py); if (active) ctx.scale(1.25 + 0.06 * Math.sin(t * 8), 1.25 + 0.06 * Math.sin(t * 8));
    ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, -64, 40, Math.PI * 0.8, Math.PI * 2.2); ctx.lineTo(0, 0); ctx.closePath();
    ctx.fillStyle = active ? C.pokeYellow : C.red; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff7e6"; ctx.stroke();
    ctx.save(); circle(ctx, 0, -64, 30); ctx.clip();
    const img = pin.item.image, iw = 76, ih = iw * img.naturalHeight / img.naturalWidth;
    ctx.drawImage(img, -iw / 2, -64 - ih * 0.32, iw, ih);
    ctx.restore(); ctx.restore();
  });
  ctx.restore();
  rr(ctx, mx, my, mw, mh, 44); ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.pokeYellow, 0.3); ctx.stroke();
  // Info-Karte des gewählten Tauschpartners
  const ik = prog(lt, 0.5 * d, 0.5 * d + 0.5);
  if (ik > 0) {
    const it = xp.pins[sel].item, dist = km(E.getPlan().km[0]);
    ctx.save(); ctx.globalAlpha *= clamp(ik * 2); ctx.translate(0, (1 - eOut(ik)) * 200);
    panel(ctx, 60, 1500, 960, 350, { fill: rgba(C.night2, 0.98), stroke: C.emerald, glow: rgba(C.emerald, 0.45) });
    drawCard(ctx, it, 175, 1675, 170, { t });
    text(ctx, `${xp.users[0]} · 📍 ${dist} km`, 290, 1566, { font: font(32, 900), color: C.emerald, maxW: 700 });
    text(ctx, `Bietet: ${it.card.name} ${it.card.num}`, 290, 1614, { font: font(32, 900), color: C.ink, maxW: 700 });
    text(ctx, "🛡️ Treffpunkt: öffentlicher Ort, z. B. Café am Bahnhof", 290, 1660, { font: font(26, 700), color: C.soft, maxW: 700 });
    text(ctx, "⭐ 4,9 Bewertung · verifiziertes Profil", 290, 1700, { font: font(26, 700), color: C.soft, maxW: 700 });
    button(ctx, "🤝 Treffen vorschlagen", 290, 1730, 380, 84, [C.emerald, C.teal], C.slate950, { font: font(28, 900), r: 22 });
    button(ctx, "💬 Chat", 690, 1730, 290, 84, C.purple, "#fff", { font: font(28, 900), r: 22 });
    tapRipple(ctx, 480, 1772, prog(lt, d - 1.0, d - 0.4));
    ctx.restore();
  }
}

/** Pull-Wall: scrollender Community-Feed mit Likes */
function scenePullwall(ctx, lt, d, ep, t) {
  dexBar(ctx, "COMMUNITY · PULL-WALL", t);
  caption(ctx, "Die besten Hits der Community 📸", 230, prog(lt, 0, 0.4), 66);
  const top = 380, bottom = 1830, postH = 560, n = 5;
  const scroll = eInOut(prog(lt, 0.15 * d, 0.92 * d)) * (n * postH - (bottom - top) + 40);
  ctx.save();
  rr(ctx, 50, top, 980, bottom - top, 44); ctx.clip();
  for (let k = 0; k < n; k++) {
    const y = top + 20 + k * postH - scroll;
    if (y > bottom || y + postH < top) continue;
    const it = xp.at(k + 4), mid = Math.abs(y + postH / 2 - (top + bottom) / 2) < postH / 2;
    panel(ctx, 70, y, 940, postH - 30, { fill: rgba(C.night2, 0.96), stroke: k === 0 ? C.pokeYellow : rgba(C.pokeYellow, 0.18) });
    circle(ctx, 130, y + 60, 34); ctx.fillStyle = [C.red, C.water, C.purple, C.emerald, C.electric][k % 5]; ctx.fill();
    text(ctx, xp.users[k % xp.users.length].slice(1, 2).toUpperCase(), 130, y + 72, { font: disp(36), color: "#fff", align: "center" });
    text(ctx, xp.users[k % xp.users.length], 184, y + 56, { font: font(30, 900), color: C.ink });
    text(ctx, `vor ${k * 7 + 2} Min. · hat gezogen`, 184, y + 92, { font: font(24, 700), color: C.soft });
    if (k === 0) pill(ctx, "🏆 Hit des Tages", 850, y + 62, { font: font(24, 900), h: 50 });
    drawCard(ctx, it, 260, y + 300, 270, { t: t + k });
    text(ctx, it.card.name, 430, y + 220, { font: disp(54), color: "#fff7e6", maxW: 560 });
    text(ctx, `${it.card.setTag} · ${it.card.num}`, 430, y + 262, { font: font(26, 700), color: C.soft, maxW: 560 });
    text(ctx, String(it.card.rarity || ""), 430, y + 300, { font: font(24, 800), color: C.amber200, maxW: 560 });
    text(ctx, "Wert (Cardmarket-Trend)", 430, y + 360, { font: font(24, 700), color: C.slate400 });
    text(ctx, eur(it.card.trend), 430, y + 420, { font: disp(64), color: C.electric, glow: rgba(C.electric, 0.4), blur: 18 });
    const likes = xp.likes[k] + (mid ? Math.floor(eOut(prog(lt, 0.2 * d, d)) * 37) : 0);
    text(ctx, `🔥 ${likes}   💬 ${Math.floor(likes / 9)}   ↗ Teilen`, 430, y + 480, { font: font(28, 900), color: C.ink });
    if (mid) {
      for (let h = 0; h < 5; h++) {
        const hp = ((t * 0.9 + h * 0.21) % 1);
        text(ctx, h % 2 ? "🔥" : "❤️", 560 + h * 50 + Math.sin(t * 3 + h) * 20, y + 470 - hp * 260, { font: font(40, 900), alpha: 1 - hp, align: "center" });
      }
    }
  }
  ctx.restore();
  watermark(ctx);
}

/** Tausch-Hub: Inserat + Direkt-Chat + Tausch-Bestätigung */
function sceneChat(ctx, lt, d, ep, t) {
  dexBar(ctx, "TAUSCH-HUB · DIREKT-CHAT", t);
  const A = xp.at(6), B = xp.at(7), partner = xp.users[1];
  panel(ctx, 60, 230, 960, 210, { fill: rgba(C.night2, 0.97) });
  drawCard(ctx, A, 145, 335, 120, { t, holo: false });
  text(ctx, `Inserat: ${A.card.name} ${A.card.num}`, 230, 300, { font: font(34, 900), color: C.ink, maxW: 600 });
  text(ctx, `Tausch oder ${eur(A.card.trend)} · ${A.card.setTag}`, 230, 346, { font: font(26, 700), color: C.soft, maxW: 600 });
  const on = Math.sin(t * 5) > -0.3;
  circle(ctx, 244, 386, 9); ctx.fillStyle = on ? C.emerald : rgba(C.emerald, 0.4); ctx.fill();
  text(ctx, `${partner} ist online`, 262, 396, { font: font(24, 800), color: C.emerald });
  pill(ctx, "0 € Gebühren", 900, 300, { font: font(22, 900), h: 44, bg: C.emerald });
  const msgs = [
    [0, `Hey! Ist dein ${A.card.name} noch zu haben? 👀`],
    [1, `Klar! Ich suche dafür ${B.card.name} 🔥`],
    [0, `Hab ich doppelt! Tausch + Treffen am Samstag?`],
    [1, "Deal! 🤝 Ich schick dir das Angebot."],
  ];
  let y = 500;
  msgs.forEach(([me, s], k) => {
    const a = 0.06 * d + k * 0.13 * d, mk = prog(lt, a, a + 0.35);
    if (!me && lt > a - 0.6 && mk <= 0) {
      rr(ctx, 90, y, 170, 80, 40); ctx.fillStyle = C.night3; ctx.fill();
      [0, 1, 2].forEach((j) => { circle(ctx, 135 + j * 40, y + 40, 10); ctx.fillStyle = rgba(C.ink, 0.4 + 0.6 * Math.max(0, Math.sin(t * 8 - j))); ctx.fill(); });
    }
    if (mk <= 0) return;
    ctx.font = font(32, 800);
    const lines = wrap(ctx, s, 600), bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 60, bh = lines.length * 44 + 40;
    const bx = me ? 1000 - bw : 80;
    ctx.save(); ctx.globalAlpha *= clamp(mk * 2);
    ctx.translate(bx + (me ? bw : 0), y); ctx.scale(eBack(mk), eBack(mk)); ctx.translate(-(bx + (me ? bw : 0)), -y);
    rr(ctx, bx, y, bw, bh, 34);
    if (me) { const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, C.emerald); g.addColorStop(1, C.teal); ctx.fillStyle = g; } else ctx.fillStyle = C.night3;
    ctx.fill();
    lines.forEach((l, i) => text(ctx, l, bx + 30, y + 58 + i * 44, { font: font(32, 800), color: me ? C.slate950 : C.ink }));
    ctx.restore();
    y += bh + 26;
  });
  const ok = prog(lt, 0.62 * d, 0.62 * d + 0.5);
  if (ok > 0) {
    ctx.save(); ctx.globalAlpha *= clamp(ok * 2); ctx.translate(0, (1 - eOut(ok)) * 160);
    panel(ctx, 80, 1250, 920, 560, { fill: rgba(C.night2, 0.98), stroke: C.electric, glow: rgba(C.electric, 0.35) });
    text(ctx, "📨 Tauschangebot", W / 2, 1310, { font: font(32, 900), color: C.electric, align: "center" });
    drawCard(ctx, A, 270, 1500, 210, { t });
    drawCard(ctx, B, 810, 1500, 210, { t: t + 1 });
    text(ctx, "⇄", W / 2, 1530, { font: disp(120), color: C.electric, align: "center", glow: rgba(C.electric, 0.7), blur: 26 });
    text(ctx, `${eur(A.card.trend)} ⇄ ${eur(B.card.trend)}`, W / 2, 1600, { font: font(30, 900), color: C.ink, align: "center", maxW: 360 });
    button(ctx, "✅ Tausch annehmen", 240, 1680, 600, 96, [C.emerald, C.teal], C.slate950, { font: font(34, 900) });
    tapRipple(ctx, 540, 1728, prog(lt, 0.8 * d, 0.8 * d + 0.6));
    const sk = prog(lt, 0.84 * d, 0.84 * d + 0.35);
    if (sk > 0) {
      ctx.save(); ctx.translate(W / 2, 1450); ctx.rotate(-0.16); ctx.scale(lerp(2, 1, eOut(sk)), lerp(2, 1, eOut(sk))); ctx.globalAlpha *= sk;
      rr(ctx, -360, -80, 720, 160, 24); ctx.fillStyle = "rgba(2,6,23,.75)"; ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = C.emerald; ctx.stroke();
      text(ctx, "TAUSCH BESTÄTIGT!", 0, 26, { font: disp(76), color: C.emerald, align: "center", glow: rgba(C.emerald, 0.7), blur: 20, maxW: 680 });
      ctx.restore();
    }
    ctx.restore();
  }
  watermark(ctx);
}

/** Top-Mover & Preisstürze (echte Daten: Cardmarket-Trend vs. 30-Tage-Durchschnitt) */
function sceneMovers(ctx, lt, d, ep, t) {
  dexBar(ctx, "MARKT · TOP-MOVER", t);
  caption(ctx, "Wer steigt? Wer stürzt ab? 📊", 230, prog(lt, 0, 0.4), 66);
  const rows = [...xp.ups.map((x) => [x, 1]), ...xp.downs.map((x) => [x, -1])];
  const maxAbs = Math.max(0.01, ...rows.map(([x]) => Math.abs(change(x.card))));
  let y = 400;
  rows.forEach(([it, dir], k) => {
    if (k === 0 || k === xp.ups.length) {
      text(ctx, dir > 0 ? "🚀 Top-Gewinner · 30 Tage" : "📉 Preissturz · 30 Tage", 80, y + 40, { font: font(32, 900), color: dir > 0 ? C.emerald : C.rose });
      y += 64;
    }
    const a = 0.08 * d + k * 0.08 * d, rk = eOut(prog(lt, a, a + 0.5));
    const c = change(it.card), col = dir > 0 ? C.emerald : C.rose;
    const hl = dir < 0 && k === xp.ups.length && lt > 0.6 * d;
    ctx.save(); ctx.globalAlpha *= rk; ctx.translate((1 - rk) * -300, 0);
    panel(ctx, 60, y, 960, 190, { r: 32, fill: rgba(C.night2, 0.96), stroke: hl ? C.pokeYellow : rgba(col, 0.4), glow: hl ? rgba(C.pokeYellow, 0.5 + 0.3 * Math.sin(t * 7)) : null });
    drawCard(ctx, it, 135, y + 95, 110, { t: t + k, holo: false });
    text(ctx, `${it.card.name} · ${it.card.num}`, 215, y + 58, { font: font(32, 900), color: C.ink, maxW: 520 });
    text(ctx, it.card.setTag, 215, y + 96, { font: font(24, 700), color: C.soft, maxW: 520 });
    const bw = 480 * (Math.abs(c) / maxAbs) * eOut(prog(lt, a + 0.2, a + 0.9));
    rr(ctx, 215, y + 122, 480, 30, 15); ctx.fillStyle = "rgba(243,239,228,.07)"; ctx.fill();
    if (bw > 4) { rr(ctx, 215, y + 122, bw, 30, 15); ctx.fillStyle = col; ctx.fill(); }
    text(ctx, pct(c), 990, y + 70, { font: font(40, 900), color: col, align: "right" });
    text(ctx, eur(it.card.trend), 990, y + 116, { font: font(30, 900), color: "#fff", align: "right" });
    text(ctx, `Ø ${eur(it.card.avg30)}`, 990, y + 156, { font: font(22, 700), color: C.slate400, align: "right" });
    ctx.restore();
    y += 210;
  });
  const hk = prog(lt, 0.66 * d, 0.66 * d + 0.4);
  if (hk > 0 && xp.downs.length) {
    const it = xp.downs[0];
    ctx.save(); ctx.translate(W / 2, 1790); ctx.scale(eBack(hk), eBack(hk));
    pill(ctx, `💡 ${it.card.name}: ${eur(it.card.avg30)} → ${eur(it.card.trend)} – jetzt günstig einsteigen?`, 0, 0, { font: font(28, 900), h: 76, padX: 50 });
    ctx.restore();
  } else watermark(ctx);
}

/** Automatischer Wunschlisten-Abgleich mit dem Binder eines Tauschpartners */
function sceneWishlist(ctx, lt, d, ep, t) {
  dexBar(ctx, "TAUSCH · WUNSCHLISTEN-ABGLEICH", t);
  caption(ctx, "Deine Wunschliste tauscht mit ⭐", 230, prog(lt, 0, 0.4), 66);
  const wish = [0, 1, 2, 3].map((k) => xp.at(k + 8));
  const binder = [wish[1], xp.at(1), wish[3], xp.at(2), xp.at(3), wish[0]];
  const isMatch = (k) => [0, 2, 5].includes(k);
  panel(ctx, 60, 380, 960, 400);
  text(ctx, "⭐ Deine Wunschliste", 100, 440, { font: font(30, 900), color: C.electric });
  const found = new Set();
  const scan = eInOut(prog(lt, 0.25 * d, 0.7 * d));
  const gx0 = 130, gy0 = 900, cw = 230, ch = cw * 88 / 63;
  const pos = (k) => [gx0 + (k % 3) * 310 + cw / 2 + 20, gy0 + Math.floor(k / 3) * (ch + 30) + ch / 2];
  binder.forEach((it, k) => { if (isMatch(k) && pos(k)[1] - ch / 2 < 860 + scan * 760) found.add(wish.indexOf(it)); });
  wish.forEach((it, k) => {
    const x = 180 + k * 240, y = 610, wk = eOut(prog(lt, 0.03 * d + k * 0.04 * d, 0.03 * d + k * 0.04 * d + 0.4));
    drawCard(ctx, it, x, y, 170, { t: t + k, alpha: wk, scale: lerp(0.7, 1, wk), dim: found.has(k) ? 0 : 0.25 });
    if (found.has(k)) { circle(ctx, x + 70, y - 100, 30); ctx.fillStyle = C.emerald; ctx.fill(); text(ctx, "✓", x + 70, y - 88, { font: font(36, 900), color: C.slate950, align: "center" }); }
  });
  panel(ctx, 60, 800, 960, 900);
  text(ctx, `📒 Binder von ${xp.users[2]} · 📍 ${km(E.getPlan().km[1])} km`, 100, 860, { font: font(30, 900), color: C.ink, maxW: 880 });
  binder.forEach((it, k) => {
    const [x, y] = pos(k), hit = isMatch(k) && y - ch / 2 < 860 + scan * 760;
    drawCard(ctx, it, x, y, cw, {
      t: t + k, dim: scan > 0 && !hit ? 0.45 : 0,
      after: hit ? (c, w, h) => { c.save(); c.shadowColor = C.pokeYellow; c.shadowBlur = 30; rr(c, -w / 2, -h / 2, w, h, w * 0.05); c.lineWidth = 9; c.strokeStyle = C.pokeYellow; c.stroke(); c.restore(); } : null,
    });
    if (hit) pill(ctx, "⭐ Wunschkarte", x, y + ch / 2 - 10, { font: font(22, 900), h: 44, padX: 24 });
  });
  if (scan > 0 && scan < 1) {
    const ly = 860 + scan * 760;
    ctx.save(); ctx.shadowColor = C.emerald; ctx.shadowBlur = 40; ctx.fillStyle = "#b7ffdf"; ctx.fillRect(80, ly - 4, 920, 8); ctx.restore();
  }
  // Verbindungslinien Binder -> Wunschliste
  binder.forEach((it, k) => {
    if (!isMatch(k)) return;
    const [x, y] = pos(k), wi = wish.indexOf(it), hit = y - ch / 2 < 860 + scan * 760;
    if (!hit) return;
    const tx = 180 + wi * 240, ty = 730;
    ctx.save(); ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 60; ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.pokeYellow, 0.8);
    ctx.beginPath(); ctx.moveTo(x, y - ch / 2); ctx.quadraticCurveTo((x + tx) / 2, ty + 60, tx, ty); ctx.stroke(); ctx.restore();
  });
  const rk = prog(lt, 0.74 * d, 0.74 * d + 0.4);
  if (rk > 0) {
    ctx.save(); ctx.translate(W / 2, 1780); ctx.scale(eBack(rk), eBack(rk));
    pill(ctx, `🎯 ${found.size} Treffer – Tauschvorschlag automatisch erstellt!`, 0, 0, { font: font(32, 900), h: 84, padX: 60, bg: C.emerald, color: C.slate950 });
    ctx.restore();
  } else watermark(ctx);
}

const SCENES = { ...E.SCENES, hook: sceneHook, binder: sceneBinder, portfolio: scenePortfolio, map: sceneMap, pullwall: scenePullwall, chat: sceneChat, movers: sceneMovers, wishlist: sceneWishlist };

/** Ein Bild der Episode zum Zeitpunkt t zeichnen */
function renderEpisode(ctx, t, ep, D) {
  const tl = timeline(ep, D);
  t = Math.min(t, D);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, t);
  let idx = tl.findIndex(([, a, b]) => t >= a && t < b);
  if (idx < 0) idx = tl.length - 1;
  const [name, a, b] = tl[idx];
  const d = b - a, lt = t - a, last = idx === tl.length - 1;
  const enter = a === 0 ? 1 : eOut(prog(lt, 0, 0.3));
  const exit = last ? 0 : eIn(prog(lt, d - 0.22, d));
  ctx.save();
  ctx.globalAlpha = enter * (1 - exit);
  const z = lerp(1.05, 1, enter) * lerp(1, 0.97, exit);
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  SCENES[name](ctx, lt, d, ep, t);
  ctx.restore();
  const cutDist = Math.min(...tl.slice(1).map(([, s]) => Math.abs(t - s)));
  if (cutDist < 0.14) { ctx.fillStyle = `rgba(255,255,255,${0.22 * (1 - cutDist / 0.14)})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Overlay-UI & Batch-Aufnahme
// ---------------------------------------------------------------------------
const CSS = `
#auto-reels{position:fixed;inset:0;z-index:9999;background:rgba(5,7,15,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;font-family:var(--font-body,Figtree,sans-serif);color:var(--ink,#f3efe4)}
#auto-reels[hidden]{display:none}
#auto-reels .ar-panel{width:min(1100px,100%);background:var(--night-2,#131a33);border:2px solid rgba(245,200,75,.28);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
#auto-reels .ar-head{display:flex;align-items:center;gap:14px;padding:14px 18px;background:linear-gradient(180deg,var(--dex-red,#d9363e),var(--dex-red-dark,#9e1f2a));box-shadow:0 6px 0 #1a1420}
#auto-reels .ar-head b{font-family:var(--font-display,"Lilita One",sans-serif);font-weight:400;font-size:24px;display:block;line-height:1.1}
#auto-reels .ar-head small{font-size:12px;font-weight:800;color:#ffd9d4}
#auto-reels .ar-lens{width:40px;height:40px;border-radius:50%;flex:none;border:4px solid #f3efe4;box-shadow:0 0 0 3px #1a1420;background:radial-gradient(circle at 35% 30%,#c8ecff 0 12%,#4a9be0 13% 55%,#1f4f87 56% 100%)}
#auto-reels .ar-x{margin-left:auto;background:rgba(26,20,32,.55);border:1px solid rgba(243,239,228,.22);color:#fff;border-radius:12px;width:40px;height:40px;font-size:18px;font-weight:900;cursor:pointer}
#auto-reels .ar-body{padding:18px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px}
@media (max-width:820px){#auto-reels .ar-body{grid-template-columns:1fr}}
#auto-reels .ar-col{display:flex;flex-direction:column;gap:10px;min-width:0}
#auto-reels .ar-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#auto-reels select,#auto-reels button.ar-btn{font:800 14px var(--font-body,Figtree,sans-serif);border-radius:12px;padding:11px 14px;border:1px solid rgba(245,200,75,.25);background:var(--night-3,#1b2444);color:var(--ink,#f3efe4);cursor:pointer}
#auto-reels button.ar-go{background:#ffcb05;color:#1a1420;border-color:#ffcb05;font-weight:900;font-size:16px;padding:14px 16px;width:100%}
#auto-reels button.ar-stop{background:#e11d48;border-color:#e11d48;color:#fff}
#auto-reels button:disabled,#auto-reels select:disabled{opacity:.45;cursor:not-allowed}
#auto-reels ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
#auto-reels li{display:flex;gap:10px;align-items:flex-start;background:var(--night-3,#1b2444);border:1px solid transparent;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.35}
#auto-reels li.on{border-color:#e11d48}#auto-reels li.ok{border-color:rgba(52,211,153,.5)}#auto-reels li.err{border-color:#fb7185}
#auto-reels li .ar-st{flex:none;width:22px;text-align:center;font-size:15px}
#auto-reels li b{display:block;font-size:13px}
#auto-reels li small{color:var(--ink-soft,#b9b7c9);word-break:break-word}
#auto-reels li .ar-acts{margin-left:auto;display:flex;gap:6px;flex:none}
#auto-reels li .ar-acts button,#auto-reels li .ar-acts a{font:800 11px var(--font-body,Figtree,sans-serif);border-radius:8px;padding:5px 8px;border:1px solid rgba(245,200,75,.25);background:var(--night-2,#131a33);color:var(--ink,#f3efe4);cursor:pointer;text-decoration:none}
#auto-reels li .ar-acts a{background:#10b981;color:#052e1f;border-color:#10b981}
#auto-reels .ar-progress{height:8px;border-radius:4px;background:var(--night-3,#1b2444);overflow:hidden}
#auto-reels .ar-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcb05,#34d399)}
#auto-reels .ar-status{font-size:14px;font-weight:800;min-height:20px}
#auto-reels .ar-status.err{color:#fb7185}#auto-reels .ar-status.ok{color:#34d399}
#auto-reels .ar-stage{position:relative;display:flex;justify-content:center}
#auto-reels canvas{height:min(72vh,780px);aspect-ratio:9/16;width:auto;max-width:100%;border-radius:18px;background:#0c1022;box-shadow:0 0 0 3px #2a3050,0 20px 50px rgba(0,0,0,.6)}
#auto-reels .ar-time{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(12,16,34,.85);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:900;white-space:nowrap}
#auto-reels .ar-time.rec{background:#e11d48;color:#fff}
#auto-reels .ar-hook{display:flex;flex-direction:column;gap:6px;background:var(--night-3,#1b2444);border:1px solid rgba(245,200,75,.2);border-radius:12px;padding:10px}
#auto-reels .ar-hook label{font-size:13px;font-weight:800}
#auto-reels .ar-hook input{font:600 13px var(--font-body,Figtree,sans-serif);border-radius:10px;padding:9px 11px;border:1px solid rgba(245,200,75,.25);background:var(--night-2,#131a33);color:var(--ink,#f3efe4);width:100%;box-sizing:border-box}
#auto-reels .ar-hook input.bad{border-color:#fb7185}
#auto-reels .ar-hook small{font-size:12px;color:var(--ink-soft,#b9b7c9)}
#auto-reels li input[type=checkbox]{flex:none;margin-top:3px;width:16px;height:16px;accent-color:#ffcb05}
#auto-reels button.ar-batch{background:#7c3aed;border-color:#7c3aed;color:#fff;flex:1}
#auto-reels .ar-hint{font-size:12px;line-height:1.45;color:var(--ink-soft,#b9b7c9);margin:0}
`;

const ui = {};
let built = false, ctx = null, raf = 0, mode = "idle", previewEp = null, previewStart = 0, stopAll = false, wake = null;
const results = new Map(); // Episode-Nummer -> { url, name, size, sent }
const batchSel = new Set(); // im Serien-Modus ausgewählte Episoden

// Make.com-Webhook-URL (einmal eintragen, bleibt im localStorage)
const HOOK_KEY = "pokeswipe.autoReels.webhook";
const getHook = () => { try { return localStorage.getItem(HOOK_KEY) || ""; } catch { return ""; } };
function validHook(u) {
  try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; }
}

function build() {
  if (built) return;
  built = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement("div");
  el.id = "auto-reels"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Auto-Reels (10x)");
  el.innerHTML = `
    <div class="ar-panel">
      <div class="ar-head"><div class="ar-lens"></div><div><b>🎬 Auto-Reels (10x)</b><small>10 Feature-Episoden · 9:16 · 1080×1920 · 60 FPS · 8 Mbit/s · Dateiname = Instagram-Caption</small></div>
        <button type="button" class="ar-x" data-ar="close" aria-label="Schließen">✕</button></div>
      <div class="ar-body">
        <div class="ar-col">
          <div class="ar-bar">
            <label for="ar-len" style="font-size:13px;font-weight:800">Länge pro Reel:</label>
            <select id="ar-len">${DURATIONS.map((s) => `<option value="${s}"${s === duration ? " selected" : ""}>${s} Sekunden</option>`).join("")}</select>
          </div>
          <div class="ar-hook">
            <label for="ar-hook">🔗 Make.com Webhook-URL</label>
            <input id="ar-hook" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://hook.eu1.make.com/…">
            <small id="ar-hook-info"></small>
          </div>
          <button type="button" class="ar-btn ar-go" data-ar="all">🚀 Alle 10 Episoden jetzt vollautomatisch generieren</button>
          <button type="button" class="ar-btn ar-stop" data-ar="stop" hidden>■ Generierung abbrechen</button>
          <div class="ar-progress"><i id="ar-bar"></i></div>
          <div class="ar-bar">
            <button type="button" class="ar-btn" data-ar="sel-all">☑ Alle</button>
            <button type="button" class="ar-btn" data-ar="sel-none">☐ Keine</button>
            <button type="button" class="ar-btn ar-batch" data-ar="batch">🎞️ Serien-Modus: ausgewählte nacheinander</button>
          </div>
          <div class="ar-status" id="ar-status"></div>
          <ol id="ar-list"></ol>
          <p class="ar-hint" id="ar-format"></p>
          <p class="ar-hint">Während der Generierung diesen Tab sichtbar lassen (nicht minimieren oder wechseln) – jedes Reel wird in Echtzeit gezeichnet, alle 10 dauern zusammen etwa <span id="ar-total"></span>. Wird der Tab verdeckt, wartet der Generator und nimmt die Episode danach neu auf. Ist eine Webhook-URL eingetragen, geht jedes fertige MP4 direkt an Make.com (Felder: <code>file</code>, <code>filename</code>, <code>episode</code>, <code>slogan</code>, <code>title</code>). Ohne URL oder bei einem Fehler landet die Datei im Download-Ordner – beim ersten Mal fragt der Browser evtl. „Mehrere Dateien herunterladen?“, bitte erlauben.</p>
        </div>
        <div class="ar-stage"><canvas id="ar-canvas" width="${W}" height="${H}"></canvas><span class="ar-time" id="ar-time"></span></div>
      </div>
    </div>`;
  document.body.append(el);
  ui.root = el;
  ui.canvas = el.querySelector("#ar-canvas");
  ui.list = el.querySelector("#ar-list");
  ui.bar = el.querySelector("#ar-bar");
  ui.status = el.querySelector("#ar-status");
  ui.time = el.querySelector("#ar-time");
  ui.format = el.querySelector("#ar-format");
  ui.len = el.querySelector("#ar-len");
  ui.total = el.querySelector("#ar-total");
  ui.go = el.querySelector('[data-ar="all"]');
  ui.stop = el.querySelector('[data-ar="stop"]');
  ui.batch = el.querySelector('[data-ar="batch"]');
  ui.hook = el.querySelector("#ar-hook");
  ui.hookInfo = el.querySelector("#ar-hook-info");
  ui.hook.value = getHook();
  const saveHook = () => {
    const raw = ui.hook.value.trim(), ok = !raw || validHook(raw);
    ui.hook.classList.toggle("bad", !ok);
    if (ok) { try { raw ? localStorage.setItem(HOOK_KEY, raw) : localStorage.removeItem(HOOK_KEY); } catch { /* privater Modus */ } }
    updateHookInfo();
  };
  ui.hook.addEventListener("input", saveHook);
  ui.hook.addEventListener("change", saveHook);
  ctx = ui.canvas.getContext("2d");
  renderList();
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ar]");
    if (e.target === el && mode !== "rec") return close();
    if (!btn) return;
    const act = btn.dataset.ar, n = Number(btn.dataset.n);
    if (act === "close") close();
    if (act === "all") generateAll();
    if (act === "stop") { stopAll = true; setStatus("Abbruch nach der laufenden Episode …"); }
    if (act === "preview") startPreview(EPISODES[n - 1]);
    if (act === "one") generateAll([EPISODES[n - 1]]);
    if (act === "sel-all") { EPISODES.forEach((ep) => batchSel.add(ep.n)); renderList(); }
    if (act === "sel-none") { batchSel.clear(); renderList(); }
    if (act === "batch") {
      const list = EPISODES.filter((ep) => batchSel.has(ep.n));
      if (!list.length) return setStatus("Bitte zuerst Episoden für den Serien-Modus anhaken.", "err");
      generateAll(list);
    }
  });
  el.addEventListener("change", (e) => {
    const box = e.target.closest("[data-sel]");
    if (!box) return;
    const n = Number(box.dataset.sel);
    box.checked ? batchSel.add(n) : batchSel.delete(n);
    updateBatchLabel();
  });
  ui.len.addEventListener("change", () => { duration = Number(ui.len.value) || 30; updateTotal(); if (previewEp) startPreview(previewEp); });
  updateTotal();
  updateHookInfo();
}

function updateHookInfo() {
  const raw = ui.hook.value.trim();
  ui.hookInfo.textContent = !raw
    ? "Keine URL eingetragen → fertige Reels werden lokal heruntergeladen."
    : validHook(raw)
      ? "✓ Gespeichert. Fertige MP4-Reels werden automatisch per POST an diesen Webhook geschickt."
      : "⚠️ Bitte eine gültige https://-Adresse eintragen.";
}
function updateBatchLabel() {
  if (ui.batch) ui.batch.textContent = `🎞️ Serien-Modus: ${batchSel.size} ausgewählte nacheinander`;
}

function updateTotal() { const m = (duration * 10 + 25) / 60; ui.total.textContent = `${m.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Minuten`; }
function setStatus(msg, kind = "") { ui.status.textContent = msg; ui.status.className = `ar-status ${kind}`; }
function setBusy(b) {
  ui.len.disabled = b; ui.go.disabled = b; ui.stop.hidden = !b;
  ui.batch.disabled = b; ui.hook.disabled = b;
  ui.root.querySelectorAll('[data-ar^="sel-"]').forEach((x) => { x.disabled = b; });
  ui.list.querySelectorAll("button").forEach((x) => { x.disabled = b; });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderList(states = {}) {
  ui.list.innerHTML = EPISODES.map((ep) => {
    const st = states[ep.n] || (results.has(ep.n) ? "ok" : "");
    const r = results.get(ep.n);
    const icon = { on: "⏺", ok: "✅", err: "⚠️", wait: "⏳" }[st] || "🎞️";
    return `<li class="${st}"><input type="checkbox" data-sel="${ep.n}" aria-label="Episode ${ep.n} für den Serien-Modus"${batchSel.has(ep.n) ? " checked" : ""}><span class="ar-st">${icon}</span><div><b>${ep.n}. ${esc(ep.title)}</b><small>${esc(fileBase(ep))}.mp4</small></div>
      <span class="ar-acts"><button type="button" data-ar="preview" data-n="${ep.n}" title="Vorschau">▶</button><button type="button" data-ar="one" data-n="${ep.n}" title="Nur diese Episode aufnehmen">⏺</button>${r ? `${r.sent ? `<span title="An Make.com gesendet">📤</span>` : ""}<a href="${r.url}" download="${esc(r.name)}" title="Herunterladen">⬇</a>` : ""}</span></li>`;
  }).join("");
  if (mode === "rec") ui.list.querySelectorAll("button,input").forEach((x) => { x.disabled = true; });
  updateBatchLabel();
}

const fmt = (t, D) => `${t.toFixed(1).replace(".", ",")} / ${D.toFixed(1).replace(".", ",")} s`;

function startPreview(ep) {
  if (mode === "rec") return;
  cancelAnimationFrame(raf);
  previewEp = ep; mode = "preview"; previewStart = performance.now();
  const D = duration;
  const loop = (now) => {
    if (mode !== "preview" || previewEp !== ep) return;
    const t = ((now - previewStart) / 1000) % D;
    renderEpisode(ctx, t, ep, D);
    ui.time.textContent = `▶ Ep. ${ep.n} · ${fmt(t, D)}`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function stopPreview() { if (mode === "preview") { mode = "idle"; cancelAnimationFrame(raf); } previewEp = null; }

const waitVisible = () => new Promise((resolve) => {
  if (!document.hidden) return resolve();
  const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); resolve(); } };
  document.addEventListener("visibilitychange", on);
});

/** Eine Episode in Echtzeit aufnehmen. Liefert { blob, ext } oder null bei Abbruch (Tab verdeckt). */
async function recordEpisode(ep, D, mime, onTick) {
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  renderEpisode(ctx, 0, ep, D);
  const stream = ui.canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: BITRATE });
  const chunks = [];
  let aborted = false, error = null;
  const onHide = () => { if (document.hidden) { aborted = true; if (rec.state === "recording") rec.stop(); } };
  document.addEventListener("visibilitychange", onHide);
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = (e) => { error = e.error?.message || "unbekannt"; aborted = true; };
  rec.start(250);
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = (now) => {
      if (aborted) return resolve();
      const t = (now - start) / 1000;
      renderEpisode(ctx, t, ep, D);
      onTick(Math.min(t, D));
      if (t >= D + 0.25) return resolve();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
  if (rec.state === "recording") rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  document.removeEventListener("visibilitychange", onHide);
  if (error) throw new Error(`Aufnahmefehler: ${error}`);
  if (aborted) return null;
  const blob = new Blob(chunks, { type: (rec.mimeType || mime || `video/${ext}`).split(";")[0] });
  if (!blob.size) throw new Error("Die Aufnahme ist leer.");
  return { blob, ext };
}

/** Ergebnis merken (für den ⬇-Link) und optional sofort lokal herunterladen. */
function keep(ep, blob, ext, { click = false, sent = false } = {}) {
  const old = results.get(ep.n);
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(blob), name = `${fileBase(ep)}.${ext}`;
  results.set(ep.n, { url, name, size: blob.size, sent });
  if (click) {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.append(a); a.click(); a.remove();
  }
  return name;
}

/** Fertiges Reel als multipart/form-data an den Make.com-Webhook schicken (mit Upload-Fortschritt). */
function postToWebhook(url, ep, blob, ext, onProgress) {
  const name = `${fileBase(ep)}.${ext}`;
  const form = new FormData();
  form.append("file", blob, name);
  form.append("filename", name);
  form.append("episode", String(ep.n));
  form.append("slogan", ep.slogan);
  form.append("title", ep.title);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.timeout = 10 * 60 * 1000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(name) : reject(new Error(`Webhook antwortet mit ${x.status}`)));
    x.onerror = () => reject(new Error("Netzwerkfehler"));
    x.ontimeout = () => reject(new Error("Zeitüberschreitung"));
    x.send(form);
  });
}

async function sendWithRetry(url, ep, blob, ext, onProgress) {
  let err;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await postToWebhook(url, ep, blob, ext, onProgress); }
    catch (e) { err = e; if (/ 4\d\d$/.test(e.message)) break; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
  throw err;
}

async function generateAll(list = EPISODES) {
  if (mode === "rec") return;
  if (E.isStudioBusy()) return setStatus("⚠️ Das Reel-Studio nimmt gerade auf – bitte warten.", "err");
  const mime = E.pickMime();
  if (mime === null || typeof ui.canvas.captureStream !== "function") {
    return setStatus("⚠️ Dieser Browser kann kein Canvas aufnehmen. Bitte aktuelles Chrome, Edge oder Safari verwenden.", "err");
  }
  stopPreview();
  mode = "rec"; stopAll = false; setBusy(true); ui.time.classList.add("rec");
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
  const D = duration, states = {};
  list.forEach((ep) => { states[ep.n] = "wait"; });
  renderList(states);
  let ok = 0, sent = 0;
  const hook = validHook(getHook());
  for (let i = 0; i < list.length && !stopAll; i++) {
    const ep = list[i];
    states[ep.n] = "on"; renderList(states); setBusy(true);
    try {
      setStatus(`Lade Karten für Episode ${ep.n} …`);
      await E.buildPlan(); await buildExtras();
      let res = null;
      while (!res && !stopAll) {
        await waitVisible();
        setStatus(`⏺ Episode ${ep.n} (${i + 1}/${list.length}) wird aufgenommen (${mime.startsWith("video/mp4") ? "MP4" : "WebM"}, 60 FPS, 8 Mbit/s) – Tab sichtbar lassen …`);
        res = await recordEpisode(ep, D, mime, (t) => {
          ui.time.textContent = `⏺ Ep. ${ep.n} · ${fmt(t, D)}`;
          ui.bar.style.width = `${((i + t / D) / list.length) * 100}%`;
        });
        if (!res && !stopAll) setStatus(`⏸ Tab war verdeckt – Episode ${ep.n} wird neu aufgenommen, sobald der Tab wieder sichtbar ist …`, "err");
      }
      if (!res) break;
      const mb = (res.blob.size / 1048576).toFixed(1);
      if (hook && res.ext === "mp4") {
        try {
          setStatus(`📤 Episode ${ep.n} wird an Make.com gesendet (${mb} MB) …`);
          const name = await sendWithRetry(hook, ep, res.blob, res.ext, (p) => { ui.time.textContent = `📤 Ep. ${ep.n} · ${Math.round(p * 100)} %`; });
          keep(ep, res.blob, res.ext, { sent: true }); sent++;
          setStatus(`✓ ${name} (${mb} MB) an Make.com übergeben.`, "ok");
        } catch (e) {
          const name = keep(ep, res.blob, res.ext, { click: true });
          setStatus(`⚠️ Webhook fehlgeschlagen (${e.message}) – ${name} wurde stattdessen heruntergeladen.`, "err");
          await new Promise((r) => setTimeout(r, 1500));
        }
      } else {
        const name = keep(ep, res.blob, res.ext, { click: true });
        setStatus(`✓ ${name} (${mb} MB) heruntergeladen${hook ? " (WebM wird nicht an Make.com gesendet)" : ""}.`, hook ? "err" : "ok");
        await new Promise((r) => setTimeout(r, 700)); // kurze Pause zwischen den Downloads
      }
      states[ep.n] = "ok"; ok++;
    } catch (e) {
      states[ep.n] = "err";
      setStatus(`⚠️ Episode ${ep.n}: ${e.message}`, "err");
    }
    renderList(states);
  }
  try { await wake?.release(); } catch { /* egal */ }
  wake = null;
  mode = "idle"; ui.time.classList.remove("rec"); setBusy(false);
  renderList(Object.fromEntries(Object.entries(states).filter(([, s]) => s === "err")));
  ui.bar.style.width = "100%";
  const failed = Object.values(states).filter((s) => s === "err").length;
  const where = sent && sent === ok ? "an Make.com gesendet" : sent ? `fertig (${sent} an Make.com, ${ok - sent} heruntergeladen)` : "heruntergeladen";
  if (stopAll) setStatus(`■ Abgebrochen – ${ok} von ${list.length} Reels ${where}.`, ok ? "ok" : "err");
  else if (failed) setStatus(`⚠️ ${ok} von ${list.length} Reels ${where}, ${failed} fehlgeschlagen – einzeln über ⏺ erneut aufnehmen.`, "err");
  else setStatus(`🎉 Fertig! ${ok} Reel${ok === 1 ? "" : "s"} ${where} – Dateinamen sind die Captions.`, "ok");
  if (list[list.length - 1]) startPreview(list[list.length - 1]);
}

async function open() {
  build();
  if (!ui.root.hidden) return;
  ui.root.hidden = false;
  document.documentElement.style.overflow = "hidden";
  const mime = E.pickMime();
  ui.format.textContent = mime === null
    ? "⚠️ MediaRecorder wird von diesem Browser nicht unterstützt."
    : mime.startsWith("video/mp4")
      ? `✓ Ausgabeformat: MP4 (${mime}) – passt für Instagram Reels und Make.com.`
      : `⚠️ Dieser Browser kann kein MP4 aufnehmen – es wird WebM gespeichert, das Instagram nicht annimmt. Für MP4 bitte aktuelles Chrome/Edge (ab Version 126) oder Safari nutzen.`;
  if (!xp) {
    setBusy(true); ui.stop.hidden = true; setStatus("Lade Schriften, Logo und Karten aus der App …");
    try { await E.prepare(); await E.buildPlan(); await buildExtras(); setStatus("✓ Bereit. Ein Klick auf 🚀 nimmt alle 10 Episoden nacheinander auf.", "ok"); }
    catch (e) { setStatus(`⚠️ ${e.message}`, "err"); }
    finally { setBusy(false); }
  }
  if (xp && mode === "idle") startPreview(EPISODES[0]);
}

function close() {
  if (!ui.root || mode === "rec") return;
  stopPreview();
  ui.root.hidden = true;
  document.documentElement.style.overflow = "";
}

/** Footer-Button nur für Admins zeigen (nach jedem Login-Wechsel aufrufen). */
export function syncAutoReels() {
  const btn = document.getElementById("auto-reels-btn");
  if (btn) btn.classList.toggle("hidden", !E.isAdmin());
  if (E.isAdmin() && location.hash === "#auto-reels") open();
  if (!E.isAdmin()) close();
}

export function initAutoReels() {
  document.getElementById("auto-reels-btn")?.addEventListener("click", () => { if (E.isAdmin()) open(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.root && !ui.root.hidden) close();
  }, true);
}
