// High-End-Scanner-Engine: Ruckzuck-Sweep (Duplikate vom Stapel zählen, kein Zeit-Cooldown) und 9er-Ordner-Scan
// (Raster passt sich der Seite an, Slot-Sperre je Fach, Seitenwechsel-Reset), Anti-Glare, Normalisierung,
// Typ-Vorfilter, HSV-/Kanten-Vektor – inkl. Ende-zu-Ende-Lauf der Worker-Engine auf einer gerenderten Ordnerseite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORM_W, NORM_H, cardHashes, sobel, WORDS, popcount32 } from "../server/scan-logic.ts";
import { buildTextIndex, typeClassOf as serverClass } from "../server/scan-text-logic.ts";
import { SWEEP, createSweepGate, edgeLines, grayDown, frameThumb, motionStats } from "../client/scanner/sweep-logic.js";
import {
  HD, warpCardRgba, glareGray, zmuv, artVector, artSimilarity, fuseMatch, typeClassOf, frameColor, probeClasses, classRows, CLASS_UNKNOWN,
  TYPE_CLASSES, fitGrid, gridSlots, defaultGrid, polishRect, createSlotGate, ART_LEN,
} from "../client/scanner/hd-scan-logic.js";
import { createSweepEngine } from "../client/scanner/sweep-engine.js";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const FULL: [number, number][] = [[0, 0], [NORM_W - 1, 0], [NORM_W - 1, NORM_H - 1], [0, NORM_H - 1]];

/** Deterministische „Karte“ (gelber Rand + farbiges Artwork) je Seed – RGBA, NORM_W × NORM_H. */
function cardRgba(seed: number, tint: [number, number, number] | null = null) {
  const w = NORM_W, h = NORM_H, d = new Uint8ClampedArray(w * h * 4);
  const r = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const border = x < w * 0.05 || x > w * 0.95 || y < h * 0.04 || y > h * 0.96;
    for (let c = 0; c < 3; c++) {
      let v = 128;
      for (let k = 0; k < 4; k++) v += 38 * Math.sin((x / w) * (2 + 6 * r(k + c * 7)) * Math.PI + r(k + 9 + c) * 6) * Math.cos((y / h) * (2 + 5 * r(k + 3 + c)) * Math.PI + r(k + 4) * 6);
      if (tint && y > h * 0.55 && !border) v = tint[c];
      d[o + c] = border ? [222, 205, 90][c] : Math.max(0, Math.min(255, v));
    }
    d[o + 3] = 255;
  }
  return d;
}

/** Ordnerseite: Karten Kante an Kante (nur eine schmale dunkle Naht), optional mit Folien-Reflex auf jedem Fach. */
function pageRgba(seeds: number[], W: number, H: number, rect: { x0: number; y0: number; x1: number; y1: number }, cols = 3, rows = 3, glare = false) {
  const out = new Uint8ClampedArray(W * H * 4), cards = seeds.map((s) => cardRgba(s));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let rgb = [70, 60, 55];
    const u = (x - rect.x0) / (rect.x1 - rect.x0), v = (y - rect.y0) / (rect.y1 - rect.y0);
    if (u >= 0 && u < 1 && v >= 0 && v < 1) {
      const c = Math.floor(u * cols), r = Math.floor(v * rows), cu = u * cols - c, cv = v * rows - r;
      if (cu < 0.03 || cu > 0.97 || cv < 0.025 || cv > 0.975) rgb = [35, 35, 40];
      else {
        const a = cards[r * cols + c], au = (cu - 0.03) / 0.94, av = (cv - 0.025) / 0.95;
        const ao = (Math.min(NORM_H - 1, Math.floor(av * NORM_H)) * NORM_W + Math.min(NORM_W - 1, Math.floor(au * NORM_W))) * 4;
        rgb = [a[ao], a[ao + 1], a[ao + 2]];
      }
      if (glare && Math.hypot(cu - 0.5, cv - 0.3) < 0.07) rgb = [252, 252, 250];
    }
    out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255;
  }
  return out;
}

const SEEDS = [3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
function testEngine() {
  const words = new Uint32Array(SEEDS.length * WORDS);
  SEEDS.forEach((s, i) => words.set(cardHashes(warpCardRgba(cardRgba(s), NORM_W, NORM_H, FULL, NORM_W, NORM_H)), i * WORDS));
  const idx = { keys: SEEDS.map((s) => `card:t-${s}`), words, count: SEEDS.length, localNum: new Int32Array(SEEDS.length).fill(-1), total: new Int32Array(SEEDS.length) };
  const posts: any[] = [];
  const engine = createSweepEngine({ getIdx: () => idx, getVersion: () => 1, labelOf: (k: string) => k, post: (m: any) => posts.push(m) });
  return { engine, posts, last: () => posts[posts.length - 1] };
}

test("ABNAHME Stapel: zwei identische Karten nacheinander → beide werden gezählt (kein Zeit-Cooldown, Sperre fällt beim Aufdecken)", () => {
  const A = ["card:sv08-238"];
  const quad: [number, number][] = [[0.3, 0.25], [0.7, 0.25], [0.7, 0.8], [0.3, 0.8]];
  const see = (center: number, carried = false) => ({ dets: [{ keys: A, match: 0.93, margin: 14, quad, carried }], found: true, motion: center * 0.6, center });
  const gate = createSweepGate();
  let t = 0, hits = 0;
  const push = (f: any) => { hits += gate.push(f, (t += 33)).hits.length; };
  push(see(0.01)); push(see(0.01));
  assert.equal(hits, 1, "Exemplar 1 nach 2 Bildern (≈ 66 ms bei 30 FPS)");
  for (let i = 0; i < 30; i++) push(see(0.01));
  assert.equal(hits, 1, "liegt ruhig → nicht doppelt");
  // a) Hand greift die Karte: ein Bild ohne Erkennung bei Bewegung im Zentrum → Sperre sofort weg → Duplikat zählt
  push({ dets: [], found: true, motion: 0.1, center: 0.18 });
  push(see(0.06)); push(see(0.01));
  assert.equal(hits, 2, "Exemplar 2 (identische Karte) nur ~100 ms später");
  // b) Aufdecken an derselben Stelle: starke Änderung im Bildzentrum, Karte liegt am selben Fleck → Sperre weg
  push(see(0.3)); push(see(0.01));
  assert.equal(hits, 3, "Exemplar 3 nach Frame-Delta im Zentrum");
  // c) Kamera wackelt leicht, Karte durchgehend erkannt → KEIN Doppel-Scan
  for (let i = 0; i < 20; i++) push(see(0.08));
  assert.equal(hits, 3);
  // d) Karte wird aus dem Bild gezogen (wandert, bleibt erkannt) → kein Doppel-Scan unterwegs
  for (let i = 1; i <= 4; i++) push({ dets: [{ keys: A, match: 0.9, margin: 12, quad: quad.map(([x, y]) => [x + i * 0.08, y]) }], found: true, motion: 0.1, center: 0.12 });
  assert.equal(hits, 3);
  assert.ok(!/COOLDOWN_MS/.test(src("client/scanner/sweep-logic.js")), "kein Zeit-Cooldown im Quelltext");
});

test("Slot-Sperre: jedes Fach zählt genau einmal; Umblättern (> 65 % Bildänderung) und „Nächste Seite“ leeren die Sperren; gleiche Seite wird nicht doppelt gezählt", () => {
  assert.equal(HD.FLIP_AREA, 0.65);
  const gate = createSlotGate();
  const page = (keys: string[], changed = 0.02) => ({ changed, slots: keys.map((k, slot) => ({ slot, keys: [k], match: 0.92, margin: 12 })) });
  const P1 = Array.from({ length: 9 }, (_, i) => `card:a-${i}`), P2 = Array.from({ length: 9 }, (_, i) => `card:b-${i}`);
  let hits = 0;
  const push = (f: any) => { const r = gate.push(f); hits += r.hits.length; return r; };
  assert.equal(push(page(P1)).hits.length, 0, "ein Bild allein reicht nicht");
  assert.equal(push(page(P1)).hits.length, 9, "alle 9 Fächer nach dem 2. Bild");
  for (let i = 0; i < 200; i++) push(page(P1, 0.05));
  assert.equal(hits, 9, "Handy bleibt über der Seite → nichts doppelt");
  assert.equal(gate.locked.size, 9);
  // Zu schwach / kein klarer Abstand → Fach bleibt offen
  const weak = createSlotGate();
  for (let i = 0; i < 4; i++) assert.equal(weak.push({ changed: 0, slots: [{ slot: 0, keys: ["card:x"], match: 0.84, margin: 12 }, { slot: 1, keys: ["card:y"], match: 0.95, margin: 2 }] }).hits.length, 0);
  // Umblättern: Sperren sofort leer, während der Bewegung zählt nichts, danach die neue Seite komplett
  const flip = push(page(P1, 0.8));
  assert.equal(flip.flipped, true); assert.equal(flip.locked.length, 0);
  push(page(P1, 0.7));
  assert.equal(hits, 9, "halb sichtbare alte Seite zählt beim Umblättern nicht");
  push(page(P2, 0.1)); push(page(P2, 0.05)); push(page(P2)); push(page(P2));
  assert.equal(hits, 18, "nächste Seite sofort komplett gezählt");
  // Falscher Seitenwechsel (Handy kurz weggeschwenkt, DIESELBE Seite wieder im Bild) → still gesperrt, nicht neu gezählt
  push(page(P2, 0.9)); push(page(P2, 0.1)); push(page(P2, 0.05));
  for (let i = 0; i < 5; i++) push(page(P2));
  assert.equal(hits, 18);
  assert.equal(gate.locked.size, 9, "Haken bleiben sichtbar");
  // Knopf „Nächste Seite“ → zählt die Seite im Bild komplett neu
  gate.nextPage();
  push(page(P2)); push(page(P2));
  assert.equal(hits, 27);
  // Inhalts-Prüfung: gesperrtes Fach zeigt zweimal in Folge eine andere Karte → neue Seite, auch ohne erkannte Bewegung
  const cg = createSlotGate();
  cg.push(page(P1)); assert.equal(cg.push(page(P1)).hits.length, 9);
  const check = { changed: 0.2, slots: [{ slot: 4, keys: [P2[4]], match: 0.93, margin: 12 }] };
  assert.equal(cg.push(check).flipped, false);
  assert.equal(cg.push(check).flipped, true);
  assert.equal(cg.locked.size, 0);
  assert.equal(cg.push(page(P2)).hits.length + cg.push(page(P2)).hits.length, 9, "neue Seite komplett");
  // Neue Seite, auf der zufällig ein Fach dieselbe Karte trägt wie zuvor → zählt mit, sobald die Seite als neu erkannt ist
  const P3 = [...P2.slice(0, 1), ...Array.from({ length: 8 }, (_, i) => `card:c-${i}`)];
  push(page(P3, 0.9)); push(page(P3, 0.1)); push(page(P3, 0.05)); push(page(P3)); push(page(P3)); push(page(P3));
  assert.equal(hits, 36);
});

test("Bewegung: Frame-Delta im Zentrum und geänderter Flächenanteil (ruhig ≈ 0, neue Seite > 65 %)", () => {
  const W = 320, H = 498;
  const a = frameThumb(grayDown(pageRgba(SEEDS.slice(0, 9), W, H, { x0: 20, y0: 30, x1: 300, y1: 421 }), W, H, W, H));
  const same = frameThumb(grayDown(pageRgba(SEEDS.slice(0, 9), W, H, { x0: 21, y0: 30, x1: 301, y1: 421 }), W, H, W, H));
  // Mitten im Umblättern: das aufgestellte Blatt / die Hand verdeckt fast das ganze Bild
  const turning = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = x < W * 0.12 ? 60 : 150 + 90 * Math.sin(x * 0.02 + y * 0.013); turning[o] = v; turning[o + 1] = v; turning[o + 2] = v; turning[o + 3] = 255; }
  const other = frameThumb(grayDown(turning, W, H, W, H));
  const calm = motionStats(a, same), flip = motionStats(a, other);
  assert.ok(calm.changed < 0.2 && calm.center < SWEEP.CENTER_RESET, JSON.stringify(calm));
  assert.ok(flip.changed >= HD.FLIP_AREA, `Seitenwechsel ${JSON.stringify(flip)}`);
  assert.ok(flip.center >= SWEEP.CENTER_MOVE);
  assert.deepEqual(motionStats(null, a), { motion: 1, center: 0, changed: 0, first: true });
});

test("Binder-Raster: passt sich Lage und Größe der Ordnerseite an (Karten Kante an Kante, ohne Tischrand), 3 × 3 und 2 × 2", () => {
  const W = 320, H = 498;
  for (const [cols, rows, rect] of [[3, 3, { x0: 30, y0: 70, x1: 290, y1: 433 }], [3, 3, { x0: 70, y0: 105, x1: 250, y1: 356 }], [2, 2, { x0: 40, y0: 60, x1: 280, y1: 395 }]] as const) {
    const g = grayDown(pageRgba(SEEDS.slice(0, cols * rows), W, H, rect, cols, rows), W, H, W, H);
    const grad = sobel(g);
    const fit = fitGrid(edgeLines(grad, W, H), W, H, cols, rows, { sharp: edgeLines(grad, W, H, 0) });
    assert.ok(fit, "Raster gefunden");
    for (const k of ["x0", "y0", "x1", "y1"] as const) assert.ok(Math.abs(fit![k] - rect[k]) <= 5, `${cols}×${rows} ${k}: ${fit![k]} vs ${rect[k]}`);
    assert.equal(gridSlots(fit!, cols, rows).length, cols * rows);
  }
  // Leeres Bild → kein Raster; das Standard-Raster liegt mittig
  const flat = { w: W, h: H, d: new Float32Array(W * H).map((_, i) => 60 + 10 * Math.sin((i % W) * 0.05)) };
  assert.equal(fitGrid(edgeLines(sobel(flat), W, H), W, H), null);
  const def = defaultGrid(W, H);
  assert.ok(Math.abs((def.x0 + def.x1) / 2 - W / 2) < 1 && def.fitted === false);
  // Kanten pixelgenau nachziehen
  const img = { w: 100, h: 140, d: new Float32Array(100 * 140) };
  for (let y = 0; y < 140; y++) for (let x = 0; x < 100; x++) img.d[y * 100 + x] = x >= 12 && x < 90 && y >= 10 && y < 128 ? 200 : 30;
  const r = polishRect(img, { x0: 10, y0: 12, x1: 91, y1: 126 }, 0.04);
  assert.ok(Math.abs(r.x0 - 12) <= 1 && Math.abs(r.y0 - 10) <= 1 && Math.abs(r.x1 - 90) <= 1 && Math.abs(r.y1 - 128) <= 1, JSON.stringify(r));
});

test("Anti-Glare + Normalisierung: Reflexe (Luminanz > 238, kaum Sättigung) werden maskiert, Fingerabdruck bleibt stabil bei Belichtung/Kontrast", () => {
  assert.equal(HD.GLARE_LUM, 238);
  const px = cardRgba(5);
  const clean = warpCardRgba(px, NORM_W, NORM_H, FULL, NORM_W, NORM_H);
  assert.equal(clean.glareRatio, 0);
  // Weißer Reflex-Fleck + kräftig gelbe (gesättigte, helle) Fläche: nur der Reflex wird maskiert
  const hot = new Uint8ClampedArray(px);
  for (let y = 60; y < 90; y++) for (let x = 80; x < 120; x++) { const o = (y * NORM_W + x) * 4; hot[o] = 252; hot[o + 1] = 252; hot[o + 2] = 248; }
  for (let y = 200; y < 215; y++) for (let x = 40; x < 80; x++) { const o = (y * NORM_W + x) * 4; hot[o] = 255; hot[o + 1] = 250; hot[o + 2] = 60; }
  const g = warpCardRgba(hot, NORM_W, NORM_H, FULL, NORM_W, NORM_H);
  assert.ok(g.glare[75 * NORM_W + 100] === 1 && g.glare[207 * NORM_W + 60] === 0);
  assert.ok(Math.abs(g.glareRatio - (30 * 40) / (NORM_W * NORM_H)) < 0.004);
  const gg = glareGray(g);
  assert.equal(gg.d[75 * NORM_W + 100], 255); assert.ok(gg.d[207 * NORM_W + 60] <= 244);
  // Zero-Mean / Unit-Variance: dunkles, flaues Bild → gleicher Mittelwert/Kontrast, gleicher Fingerabdruck
  const dim = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i++) dim[i] = i % 4 === 3 ? 255 : Math.round(px[i] * 0.45 + 20);
  const a = zmuv(clean), b = zmuv(warpCardRgba(dim, NORM_W, NORM_H, FULL, NORM_W, NORM_H));
  const stat = (d: Float32Array) => { let s = 0, q = 0; for (const v of d) s += v; const m = s / d.length; for (const v of d) q += (v - m) ** 2; return [m, Math.sqrt(q / d.length)]; };
  for (const z of [a, b]) { const [m, sd] = stat(z.d); assert.ok(Math.abs(m - HD.NORM_MEAN) < 0.5 && Math.abs(sd - HD.NORM_STD) < 0.5, `${m} ${sd}`); }
  const ha = cardHashes(a), hb = cardHashes(b);
  let dist = 0; for (let i = 0; i < WORDS; i++) dist += popcount32(ha[i] ^ hb[i]);
  assert.ok(dist <= 6, `Hash-Abstand hell/dunkel ${dist}`);
});

test("Stufe 2: HSV-Farbmatrix + Kantengradient des Artworks trennen Karten; Übereinstimmung ≥ 85 % nur für die richtige", () => {
  const vec = (seed: number, scale = 1) => {
    const px = cardRgba(seed);
    if (scale !== 1) for (let i = 0; i < px.length; i++) if (i % 4 !== 3) px[i] = Math.min(255, px[i] * scale);
    const c = warpCardRgba(px, NORM_W, NORM_H, FULL, NORM_W, NORM_H);
    return artVector(c, zmuv(c));
  };
  const ref = vec(7);
  assert.equal(ref.length, ART_LEN);
  const same = artSimilarity(vec(7, 0.8), ref)!, other = artSimilarity(vec(12), ref)!;
  assert.ok(same.hsv > 0.9 && same.edge > 0.9, JSON.stringify(same));
  assert.ok(same.hsv - other.hsv > 0.15 && same.edge - other.edge > 0.1, `${JSON.stringify(same)} vs ${JSON.stringify(other)}`);
  assert.equal(artSimilarity(ref, null), null);
  assert.equal(fuseMatch(16), 0.9, "ohne Referenz-Vektoren zählt der Bild-Fingerabdruck allein");
  assert.ok(fuseMatch(16, { layout: 0.95, hsv: same.hsv, edge: same.edge }) >= SWEEP.MIN_MATCH);
  assert.ok(fuseMatch(16, { layout: 0.5, hsv: other.hsv, edge: other.edge }) < SWEEP.MIN_MATCH, "gleicher Hash-Abstand, falsche Farben/Kanten → kein Treffer");
});

test("Stufe 1: Typ-/Rahmenfarben-Vorfilter (12 Klassen) – grenzt die Suche ein, unbekannte Karten bleiben immer dabei", () => {
  assert.equal(TYPE_CLASSES.length, 12);
  assert.equal(typeClassOf("Pokémon", "Feuer"), 0); assert.equal(typeClassOf("Pokémon", "Wasser,Metall"), 1);
  assert.equal(typeClassOf("Trainer", ""), 10); assert.equal(typeClassOf("Energie", "Feuer"), 11); assert.equal(typeClassOf("Energy", ""), 11);
  assert.equal(typeClassOf("Pokémon", "Fee"), CLASS_UNKNOWN); assert.equal(typeClassOf(null, null), CLASS_UNKNOWN);
  assert.equal(serverClass("Pokémon", "Drache"), 8);
  const col = (tint: [number, number, number]) => frameColor(warpCardRgba(cardRgba(3, tint), NORM_W, NORM_H, FULL, NORM_W, NORM_H));
  assert.ok(probeClasses(col([225, 70, 40]))!.includes(0), "rot → Feuer");
  assert.ok(probeClasses(col([60, 130, 225]))!.includes(1), "blau → Wasser");
  assert.ok(probeClasses(col([90, 180, 70]))!.includes(2), "grün → Pflanze");
  assert.ok(probeClasses(col([240, 210, 60]))!.includes(3), "gelb → Elektro");
  assert.ok(probeClasses(col([150, 80, 190]))!.includes(4), "violett → Psycho");
  assert.ok(probeClasses(col([190, 190, 195]))!.includes(10), "grau → Trainer/Metall/Farblos");
  assert.equal(probeClasses({ h: 0, s: 0, v: 0, n: 0 }), null);
  // 12 gleich große Klassen + unbekannt: Feuer-Farbe durchsucht nur einen Bruchteil
  const cls = new Uint8Array(1300).map((_, i) => (i < 1200 ? i % 12 : CLASS_UNKNOWN));
  const rows = classRows(cls, probeClasses(col([225, 70, 40])), null, cls.length)!;
  assert.ok(rows.length < 0.45 * cls.length, `${rows.length} von ${cls.length}`);
  assert.ok([...rows].some((i) => cls[i] === CLASS_UNKNOWN) && [...rows].some((i) => cls[i] === 11), "unbekannt + Energie immer dabei");
  assert.deepEqual([...classRows(cls, [0], new Int32Array([0, 1, 12, 1250]), cls.length)!], [0, 12, 1250], "kombinierbar mit Set-Lock");
  // Text-Index trägt die Klasse als 7. Spalte; alte Index-Stände ohne Spalte → unbekannt
  const ti = buildTextIndex([{ lang: "de", t: "card:a-1\tGlurak\t1\t100\tA\t330\t0\ncard:a-2\tAlt\t2\t100\tA\t0" }]);
  assert.equal(ti.rows[0].cls, 0); assert.equal(ti.rows[1].cls, CLASS_UNKNOWN);
  assert.match(src("server/scan-index.ts"), /typeClassOf\(r\.category, r\.types\)/);
  assert.match(src("client/scanner/scan-worker.js"), /idx\.cls = cls/);
});

test("ABNAHME Ordner: Worker-Engine erkennt alle 9 Fächer einer Seite (auch mit Folien-Reflexen), jedes genau einmal; nächste Seite nach dem Umblättern", async () => {
  const { engine, last } = testEngine();
  const W = 900, H = 1400;
  const gate = createSlotGate();
  const counted: string[] = [];
  let seq = 0, maxSlots = 0;
  const frame = async (px: Uint8ClampedArray) => {
    // wie die Oberfläche: gesperrte Fächer überspringen, reihum eines zur Inhalts-Prüfung drin lassen
    const locked = [...gate.locked.keys()].sort((a, b) => a - b);
    const verify = locked.length ? locked[Math.floor(++seq / 2) % locked.length] : -1;
    await engine.handle({ type: "sweep-frame", seq, data: px.slice().buffer, w: W, h: H, mode: "binder", grid: "3x3", skip: locked.filter((x) => x !== verify) });
    const m = last();
    assert.equal(m.error, undefined);
    assert.equal(m.mode, "binder");
    maxSlots = Math.max(maxSlots, m.slots.length);
    const r = gate.push({ slots: m.slots, changed: m.changed });
    if (process.env.DBG) console.log(seq, "changed", m.changed, "fit", m.grid.fitted, m.slots.map((x: any) => `${x.slot}:${x.lead}@${x.match}/${x.margin}`).join(" "), "hits", r.hits.length, "flip", r.flipped, r.flipping);
    for (const h of r.hits) counted.push(`${h.slot}:${h.keys[0]}`);
    return m;
  };
  const page1 = pageRgba(SEEDS.slice(0, 9), W, H, { x0: 90, y0: 210, x1: 870, y1: 1300 }, 3, 3, true);
  let m: any;
  for (let i = 0; i < 8; i++) m = await frame(page1);
  assert.equal(m.grid.fitted, true);
  assert.equal(m.cells.length, 9);
  assert.deepEqual([...counted].sort(), SEEDS.slice(0, 9).map((s, i) => `${i}:card:t-${s}`).sort(), "alle 9 Karten im richtigen Fach, jede genau einmal");
  assert.ok(m.slots.length <= 1, "gesperrte Fächer werden nicht mehr ausgewertet (nur eines reihum zur Inhalts-Prüfung)");
  for (let i = 0; i < 10; i++) await frame(page1);
  assert.equal(counted.length, 9, "weiter über der Seite → nichts doppelt");
  // Umblättern (hier ohne Zwischenbild der Bewegung: die Inhalts-Prüfung bemerkt die neue Seite) → komplett neu gezählt
  const page2 = pageRgba(SEEDS.slice(9, 18), W, H, { x0: 70, y0: 180, x1: 850, y1: 1270 });
  for (let i = 0; i < 12; i++) await frame(page2);
  assert.equal(counted.length, 18);
  assert.deepEqual(counted.slice(9).sort(), SEEDS.slice(9, 18).map((s, i) => `${i}:card:t-${s}`).sort());
  assert.ok(maxSlots >= 3, "mehrere Fächer je Bild");
});

test("Stapel-Engine: Karte frei im Bild wird erkannt; Ergebnis trägt Bewegungsdifferenz im Zentrum; Automatik sieht das Ordner-Raster", async () => {
  const { engine, last } = testEngine();
  const W = 480, H = 760;
  const scene = (seed: number | null) => {
    const out = new Uint8ClampedArray(W * H * 4), card = seed === null ? null : cardRgba(seed);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, n = 40 + 12 * Math.sin(x * 0.05 + 7) + 8 * Math.sin(y * 0.21 + 21);
      let rgb = [n + 18, n + 8, n];
      const u = (x - 110) / 260, v = (y - 190) / 363;
      if (card && u >= 0 && u < 1 && v >= 0 && v < 1) { const ao = (Math.floor(v * NORM_H) * NORM_W + Math.floor(u * NORM_W)) * 4; rgb = [card[ao], card[ao + 1], card[ao + 2]]; }
      out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255;
    }
    return out;
  };
  const gate = createSweepGate();
  let hits = 0, seq = 0;
  const frame = async (px: Uint8ClampedArray, extra = {}) => {
    await engine.handle({ type: "sweep-frame", seq: ++seq, data: px.slice().buffer, w: W, h: H, mode: "turbo", ...extra });
    const m = last();
    assert.equal(m.error, undefined);
    hits += gate.push({ dets: m.dets, found: m.found, motion: m.motion, center: m.center }, seq * 40).hits.length;
    return m;
  };
  let m = await frame(scene(5)); m = await frame(scene(5));
  assert.equal(m.dets[0].lead, "card:t-5");
  assert.ok(m.dets[0].match >= SWEEP.MIN_MATCH, `Übereinstimmung ${m.dets[0].match}`);
  assert.equal(hits, 1);
  for (let i = 0; i < 6; i++) await frame(scene(5));
  assert.equal(hits, 1);
  // Karte weg (leerer Tisch), dann dieselbe Karte wieder → zählt erneut
  m = await frame(scene(null));
  assert.ok(m.center >= SWEEP.CENTER_MOVE, `Zentrum ${m.center}`);
  await frame(scene(5)); await frame(scene(5));
  assert.equal(hits, 2, "Duplikat vom Stapel");
  assert.equal((await frame(scene(5), { probeGrid: true, grid: "3x3" })).gridSeen, false);
  const page = pageRgba(SEEDS.slice(0, 9), W, H, { x0: 40, y0: 100, x1: 440, y1: 659 });
  assert.equal((await frame(page, { probeGrid: true, grid: "3x3" })).gridSeen, true);
});

test("Oberfläche: Modi, Raster-Overlay, Slot-Haken, Dock (+1, Variante, DE/EN/JP, Rückgängig), Summe, Drawer-Aktionen, Kamera, Torch-Warnung, Foto-Upload", () => {
  const ui = src("client/scanner/sweep-scanner.js");
  for (const re of [
    /Stapel \/ Einzelkarte/, /Ruckzuck-Sweep/, /Ordner-Seite/, /9er-Binder-Scan/, /PS\.sweep\('mode'/,
    /PS\.sweep\('nextPage'\)/, /📖 Nächste Seite/, /PS\.sweep\('grid'\)/, /function drawBinder/, /"#10b981"/,
    /PS\.sweep\('plus'\)/, />\+1</, /PS\.sweep\('undo'\)/, /PS\.sweep\('dockFinish'/, /PS\.sweep\('dockLang'/, /LANG_SHORT = \{ de: "DE", en: "EN", ja: "JP" \}/,
    /Karten"\} gescannt • Gesamtwert: /, /📒 In Set-Binder einsortieren/, /🏷️ Direkt auf Marktplatz inserieren/, /Nur Doppelte inserieren/,
    /facingMode: \{ ideal: "environment" \}, width: \{ ideal: 1920 \}, height: \{ ideal: 1080 \}, frameRate: \{ ideal: 30 \}/,
    /width: \{ ideal: 1280 \}, height: \{ ideal: 720 \}/, /focusMode: "continuous"/, /exposureMode: "continuous"/,
    /LED blendet auf der Folie/, /data-ls-upload="1"/, /mode: "binder", grid: sw\.prefs\.grid, skip:/, /HD\.BINDER_FRAME_W/, /sweep-fp-progress/,
  ]) assert.match(ui, re);
  assert.equal(HD.BINDER_FRAME_W, 1280);
  assert.ok(!/fetch\(|XMLHttpRequest/.test(ui), "die Oberfläche lädt keine Kamerabilder hoch");
  const engine = src("client/scanner/sweep-engine.js");
  assert.ok(!/api\/scan\/(vision|ai)|anthropic|genai/i.test(engine), "keine Cloud-Vision im Live-Pfad");
  assert.match(engine, /idbSetMany\("layout"/); assert.match(engine, /FP_PREFIX = "v2:"/);
  // Bestehende Wege bleiben verdrahtet: Set-Binder (Mengen-Addierung), Bulk-Listing, Foto-Upload
  const ls = src("client/scanner/live-scanner.js");
  assert.match(ls, /body\.merge = true/); assert.match(ls, /openQuickList: \(infos, opts\) => openQuickList\(infos, opts\)/);
  assert.match(ls, /fileItem: async \(info, choice, qty\)/);
});
