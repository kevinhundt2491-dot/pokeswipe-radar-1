// Zero-Latency Sweep-Modus: rahmenlose Karten-Suche, Farb-Layout, Übereinstimmung, 2-Frame-Konsens mit Sperre und
// Bewegungs-Reset, Set-Lock-Suche und Scan-Session (Anzahl, Variante, Rückgängig, Gesamtwert, Doppelte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sobel, detectCard, cardHashes, warp, homography, topMatches, NORM_W, NORM_H, WORDS, type Gray,
} from "../server/scan-logic.ts";
import {
  SWEEP, findCardRects, rectQuad, quadBox, frameThumb, thumbMotion, layoutFromRgba, layoutSimilarity, matchPercent, hashSimilarity,
  topMatchesIn, setIdOfKey, langOfKey, orderByLang, createSweepGate, sessionAdd, sessionQty, sessionFinish, sessionUndo, sessionTotals,
  sessionDuplicates, rectIou,
} from "../client/scanner/sweep-logic.js";

/** Deterministisches farbiges „Artwork“ (RGB) je Seed. */
function artRgb(seed: number, w = NORM_W, h = NORM_H) {
  const d = new Uint8ClampedArray(w * h * 4);
  const r = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = 128;
      for (let k = 0; k < 4; k++) v += 38 * Math.sin((x / w) * (2 + 6 * r(k + c * 7)) * Math.PI + r(k + 9 + c) * 6) * Math.cos((y / h) * (2 + 5 * r(k + 3 + c)) * Math.PI + r(k + 4) * 6);
      d[o + c] = Math.max(0, Math.min(255, v));
    }
    d[o + 3] = 255;
  }
  return { w, h, d };
}

/** Karte (heller Rand + Artwork) perspektivisch in eine Szene (Holztisch-artiger Hintergrund) rendern – RGBA. */
function sceneRgba(seed: number, quad: [number, number][], W = 320, Hh = 560, light = 1, bgSeed = 7) {
  const art = artRgb(seed);
  const [a, b, c, d, e, f, g, h] = homography(quad);
  const out = new Uint8ClampedArray(W * Hh * 4);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const A00 = a - g * x, A01 = b - h * x, A10 = d - g * y, A11 = e - h * y, B0 = x - c, B1 = y - f;
    const det = A00 * A11 - A01 * A10;
    const u = (B0 * A11 - A01 * B1) / det, v = (A00 * B1 - B0 * A10) / det;
    const o = (y * W + x) * 4;
    let rgb: number[];
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const border = u < 0.05 || u > 0.95 || v < 0.04 || v > 0.96;
      if (border) rgb = [222, 205, 90];
      else { const ao = (Math.min(NORM_H - 1, Math.floor(v * NORM_H)) * NORM_W + Math.min(NORM_W - 1, Math.floor(u * NORM_W))) * 4; rgb = [art.d[ao], art.d[ao + 1], art.d[ao + 2]]; }
    } else {
      const n = 40 + 12 * Math.sin(x * 0.05 + bgSeed) + 8 * Math.sin(y * 0.21 + bgSeed * 3);
      rgb = [n + 18, n + 8, n];
    }
    out[o] = Math.min(255, rgb[0] * light); out[o + 1] = Math.min(255, rgb[1] * light); out[o + 2] = Math.min(255, rgb[2] * light); out[o + 3] = 255;
  }
  return { w: W, h: Hh, d: out };
}
const toGray = (img: { w: number; h: number; d: Uint8ClampedArray }): Gray => {
  const d = new Float32Array(img.w * img.h);
  for (let i = 0; i < d.length; i++) d[i] = 0.299 * img.d[i * 4] + 0.587 * img.d[i * 4 + 1] + 0.114 * img.d[i * 4 + 2];
  return { w: img.w, h: img.h, d };
};
const refHashes = (seed: number) => {
  const img = artRgb(seed);
  // Referenz = Karte frontal mit Rand (wie das Katalogbild)
  const s = sceneRgba(seed, [[0, 0], [NORM_W, 0], [NORM_W, NORM_H], [0, NORM_H]], NORM_W, NORM_H);
  return { hashes: cardHashes(toGray(s)), layout: layoutFromRgba(s.d, s.w, s.h, [[0, 0], [NORM_W, 0], [NORM_W, NORM_H], [0, NORM_H]]), img };
};

test("Rahmenlose Suche: Karte irgendwo im Bild (oben links, klein, leicht gedreht) wird gefunden und begradigt", () => {
  const cases: [number, number][][] = [
    [[20, 30], [150, 34], [148, 214], [17, 210]], // oben links, klein
    [[150, 300], [300, 296], [304, 506], [154, 510]], // unten rechts
    [[60, 120], [262, 110], [272, 392], [70, 402]], // Mitte, leicht gedreht
  ];
  for (const quad of cases) {
    const img = toGray(sceneRgba(3, quad));
    const grad = sobel(img);
    const rects = findCardRects(grad, img.w, img.h);
    assert.ok(rects.length >= 1, "mindestens ein Kandidat");
    const truth = quadBox(quad);
    const best = rects.find((r) => rectIou(r, truth) > 0.5);
    assert.ok(best, `Kandidat passt zur Karte ${JSON.stringify(quad)} → ${JSON.stringify(rects[0])}`);
    const det = detectCard(img, best!, grad);
    assert.equal(det.found, true, "Kanten verfeinert");
    det.corners.forEach((p, i) => assert.ok(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) < 7, `Ecke ${i}: ${p} vs ${quad[i]}`));
  }
});

test("Leeres Bild (nur Hintergrund) liefert keinen starken Karten-Kandidaten", () => {
  const W = 320, H = 560;
  const bg = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bg[y * W + x] = 40 + 12 * Math.sin(x * 0.05 + 7) + 8 * Math.sin(y * 0.21 + 21);
  const g: Gray = { w: W, h: H, d: bg };
  assert.equal(findCardRects(sobel(g), W, H).length, 0);
});

test("Fingerabdruck + Farb-Layout: richtige Karte ≥ 85 %, fremde deutlich darunter; Set-Lock sucht nur im Set", () => {
  const seeds = [3, 4, 5, 6, 8, 9, 11, 12];
  const words = new Uint32Array(seeds.length * WORDS);
  const layouts = seeds.map((s, i) => { const r = refHashes(s); words.set(r.hashes, i * WORDS); return r.layout; });
  const quad: [number, number][] = [[60, 120], [262, 112], [270, 392], [66, 400]];
  // gedämpftes Licht (Belichtung 80 %) – Layout ist weißabgleich-normiert, Hash helligkeitsunabhängig
  const scene = sceneRgba(3, quad, 320, 560, 0.8);
  const gray = toGray(scene);
  const grad = sobel(gray);
  const rect = findCardRects(grad, gray.w, gray.h)[0];
  const det = detectCard(gray, rect, grad);
  assert.equal(det.found, true);
  const card = warp(gray, homography(det.corners), NORM_W, NORM_H);
  const probe = cardHashes(card);
  const all = topMatchesIn(probe, words, null, seeds.length, 4);
  assert.deepEqual(all.map((m) => m.i), topMatches(probe, words, seeds.length, 4).map((m) => m.i), "gleiche Reihenfolge wie die bisherige Suche");
  assert.equal(all[0].i, 0);
  const lay = layoutFromRgba(scene.d, scene.w, scene.h, det.corners);
  const simOk = layoutSimilarity(lay, layouts[0])!;
  const simOther = Math.max(...layouts.slice(1).map((l) => layoutSimilarity(lay, l)!));
  assert.ok(simOk > 0.9, `Layout richtige Karte ${simOk}`);
  assert.ok(simOk - simOther > 0.15, `Layout-Abstand ${simOk} vs ${simOther}`);
  const pct = matchPercent(all[0].score, simOk);
  assert.ok(pct >= SWEEP.MIN_MATCH, `Übereinstimmung ${pct}`);
  const other = matchPercent(all[1].score, layoutSimilarity(lay, layouts[all[1].i]));
  assert.ok(other < SWEEP.MIN_MATCH && pct - other > 0.1, `fremde Karte ${other}`);
  // Set-Lock: nur Zeilen 2..4 durchsuchen → Zeile 0 taucht nicht auf
  const sub = topMatchesIn(probe, words, new Int32Array([2, 3, 4]), seeds.length, 3);
  assert.ok(sub.every((m) => [2, 3, 4].includes(m.i)));
  assert.equal(hashSimilarity(0), 1);
  assert.equal(hashSimilarity(160), 0);
  assert.equal(matchPercent(16), 0.9);
});

test("Bewegung: ruhiges Bild ≈ 0, Belichtungs-Sprung zählt nicht, neue Karte deutlich", () => {
  const a = toGray(sceneRgba(3, [[60, 120], [262, 112], [270, 392], [66, 400]]));
  const same = toGray(sceneRgba(3, [[61, 120], [263, 112], [271, 392], [67, 400]], 320, 560, 1.1));
  const other = toGray(sceneRgba(9, [[20, 40], [300, 40], [300, 430], [20, 430]], 320, 560, 1, 2));
  const ta = frameThumb(a), ts = frameThumb(same), to = frameThumb(other);
  assert.ok(thumbMotion(ta, ts) < 0.06, `ruhig ${thumbMotion(ta, ts)}`);
  assert.ok(thumbMotion(ta, to) >= SWEEP.MOTION_RESET, `Wechsel ${thumbMotion(ta, to)}`);
  assert.equal(thumbMotion(null, ta), 1);
});

test("Gate: 2 aufeinanderfolgende Bilder ≥ 85 % lösen aus; KEIN Zeit-Cooldown – gesperrt ist nur das Exemplar im Bild, Wegziehen/Aufdecken hebt die Sperre sofort auf", () => {
  const gate = createSweepGate();
  const A = ["card:sv08-238", "print:en:sv08-238"];
  const f = (match: number, motion = 0.01, keys = A) => ({ dets: [{ keys, match }], found: true, motion });
  let t = 1000;
  assert.deepEqual(gate.push(f(0.9), t).hits, [], "ein Bild allein löst nicht aus");
  assert.equal(gate.push(f(0.9), (t += 40)).hits.length, 1, "zweites Bild in 40 ms → Treffer");
  // Karte bleibt ruhig liegen → gesperrt, egal wie lange (die Sperre hängt am Exemplar, nicht an einer Uhr)
  for (let i = 0; i < 100; i++) assert.equal(gate.push(f(0.92), (t += 40)).hits.length, 0);
  assert.ok(gate.push(f(0.92), (t += 40)).locked.length === 1);
  assert.equal(gate.push(f(0.92), (t += 60_000)).hits.length, 0, "auch nach einer Minute kein zweiter Treffer");
  // Karte weggezogen (2 Bilder ohne Karte) → Sperre weg, gleiche Karte zählt erneut (nach neuem Konsens)
  gate.push({ dets: [], found: false, motion: 0.05 }, (t += 40));
  gate.push({ dets: [], found: false, motion: 0.05 }, (t += 40));
  assert.equal(gate.push(f(0.9), (t += 40)).hits.length, 0);
  assert.equal(gate.push(f(0.9), (t += 40)).hits.length, 1, "nächste identische Karte");
  // Bewegung im Bild und das Exemplar ist in EINEM Bild nicht zu sehen (Hand greift die Karte) → Sperre sofort weg
  gate.push({ dets: [], found: true, motion: 0.08 }, (t += 40));
  gate.push(f(0.9), (t += 40));
  assert.equal(gate.push(f(0.9), (t += 40)).hits.length, 1, "Duplikat direkt danach zählt");
  // Mindest-Übereinstimmung 85 %: darunter kein Treffer; zu große Lücke zwischen den Bildern → kein Treffer
  assert.equal(SWEEP.MIN_MATCH, 0.85);
  const g2 = createSweepGate();
  g2.push(f(0.84, 0.01, ["card:x-1"]), 0); assert.equal(g2.push(f(0.84, 0.01, ["card:x-1"]), 40).hits.length, 0);
  g2.push(f(0.85, 0.01, ["card:x-5"]), 500); assert.equal(g2.push(f(0.85, 0.01, ["card:x-5"]), 540).hits.length, 1, "genau 85 % zählt");
  g2.push(f(0.9, 0.01, ["card:x-2"]), 1000); assert.equal(g2.push(f(0.9, 0.01, ["card:x-2"]), 1300).hits.length, 0, "300 ms Lücke bei schnellem Gerät");
  // Langsames Gerät (Ø 160 ms je Bild): Fenster wächst auf bis zu 400 ms
  g2.push(f(0.9, 0.01, ["card:x-3"]), 5000); assert.equal(g2.push(f(0.9, 0.01, ["card:x-3"]), 5300, 160).hits.length, 1);
  // Kamera wackelt, die Karte bleibt durchgehend erkannt → KEIN zweiter Treffer (früher lief die Sperre nach 2,5 s ab)
  const g3 = createSweepGate();
  g3.push(f(0.9, 0.01), 0); g3.push(f(0.9, 0.01), 40);
  g3.push(f(0.9, 0.15), 2700);
  assert.equal(g3.push(f(0.9, 0.15), 2740).hits.length, 0);
  // unlock
  const g4 = createSweepGate();
  g4.push(f(0.9), 0); g4.push(f(0.9), 40); g4.unlock(A);
  assert.equal(g4.locks.length, 0);
});

test("Mehrere Karten im Bild (Ordnerseite): jede eigene Karte löst einzeln aus", () => {
  const gate = createSweepGate();
  const fr = { dets: [{ keys: ["card:a-1"], match: 0.9 }, { keys: ["card:b-2"], match: 0.88 }], found: true, motion: 0.02 };
  gate.push(fr, 0);
  assert.equal(gate.push(fr, 40).hits.length, 2);
  assert.equal(gate.push(fr, 80).hits.length, 0);
});

test("Schlüssel-Helfer: Set, Sprache, Reihenfolge nach Session-Sprache", () => {
  assert.equal(setIdOfKey("card:sv08-238"), "sv08");
  assert.equal(setIdOfKey("print:en:sv03.5-199"), "sv03.5");
  assert.equal(setIdOfKey("print:ja:SV2a-201"), "SV2a");
  assert.equal(langOfKey("print:ja:SV2a-201"), "ja");
  assert.equal(langOfKey("card:sv08-238"), "de");
  assert.deepEqual(orderByLang(["card:a-1", "print:en:a-1", "print:ja:b-1"], "en"), ["print:en:a-1", "card:a-1", "print:ja:b-1"]);
  assert.deepEqual(rectQuad({ x0: 1, y0: 2, x1: 3, y1: 4 }), [[1, 2], [3, 2], [3, 4], [1, 4]]);
});

test("Session: +1, Variante, Rückgängig, Gesamtwert und Doppelte", () => {
  let s = sessionAdd([], { key: "card:a-1", finish: "normal" }, 1);
  s = sessionAdd(s.items, { key: "card:b-2", finish: "holo" }, 2);
  s = sessionAdd(s.items, { key: "card:a-1", finish: "normal" }, 3);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].key, "card:a-1", "zuletzt gescannt oben");
  assert.equal(s.items[0].qty, 2);
  const history = ["s1", "s2", "s1"];
  let items = sessionQty(s.items, "s2", +1);
  assert.equal(items.find((i) => i.uid === "s2")!.qty, 2);
  const u = sessionUndo(items, history);
  assert.equal(u.items.find((i) => i.uid === "s1")!.qty, 1);
  assert.deepEqual(u.history, ["s1", "s2"]);
  items = sessionFinish(u.items, "s1", "reverse_holo");
  assert.equal(items.find((i) => i.uid === "s1")!.finish, "reverse_holo");
  // Zusammenlegen, wenn dieselbe Karte schon in der Ziel-Variante existiert
  let m = sessionAdd(items, { key: "card:a-1", finish: "normal" }, 9).items;
  m = sessionFinish(m, "s9", "reverse_holo");
  assert.equal(m.filter((i) => i.key === "card:a-1").length, 1);
  assert.equal(m.find((i) => i.key === "card:a-1")!.qty, 2);
  const tot = sessionTotals(m, (i: any) => (i.key === "card:a-1" ? 2.5 : 10));
  assert.deepEqual(tot, { count: 4, value: 25, distinct: 2 });
  const d = sessionDuplicates(m, (k: string) => k === "card:b-2");
  assert.deepEqual(d.map((x: any) => [x.key, x.extra]), [["card:a-1", 1], ["card:b-2", 2]]);
  assert.deepEqual(sessionQty([{ uid: "x", qty: 1 } as any], "x", -1), []);
});

test("Sweep-Scanner: kein Zielrahmen/Countdown, Kamera-Vorgaben, Torch, Vibration, Pling, Worker-Pipeline", () => {
  const ui = readFileSync(new URL("../client/scanner/sweep-scanner.js", import.meta.url), "utf8");
  assert.match(ui, /facingMode: \{ ideal: "environment" \}/);
  assert.match(ui, /width: \{ ideal: 1920 \}, height: \{ ideal: 1080 \}/);
  assert.match(ui, /focusMode: "continuous"/);
  assert.match(ui, /advanced: \[\{ torch: /);
  assert.match(ui, /navigator\.vibrate\(35\)/);
  assert.match(ui, /createOscillator/);
  assert.match(ui, /exposureMode: "continuous"/);
  assert.match(ui, /frameRate: \{ ideal: 30 \}/);
  assert.ok(!/ps-ls-guide|countdown/i.test(ui), "kein Rahmen, kein Countdown");
  const worker = readFileSync(new URL("../client/scanner/scan-worker.js", import.meta.url), "utf8");
  assert.match(worker, /sweep-engine\.js/);
  const engine = readFileSync(new URL("../client/scanner/sweep-engine.js", import.meta.url), "utf8");
  assert.match(engine, /findCardRects\(/);
  assert.match(engine, /indexedDB|idb/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(!/sweep-worker/.test(pkg.scripts["build:worker"]), "ein gemeinsamer Worker (Index nur einmal im Speicher)");
});
