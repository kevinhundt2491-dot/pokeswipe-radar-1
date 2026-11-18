// High-Speed-Scanner: Sleeve-/Toploader-Kompensation (Glanz-Maske im Visual-Hash, Highlight-Kompression, lokaler
// Kontrast), 2-aus-3-Multi-Frame-Voting, KP-Lesung als Entscheidungshilfe und ROI-Lese-Streifen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  glareMask, maskBits, maskedDistances, distances, topMatchesMasked, toneMap, localContrast, prepareStrip, WORDS,
  NORM_W, NORM_H, ART_BOX, GLARE_MASK_MAX, type Gray,
} from "../server/scan-logic.ts";
import { createFrameVoter, lockDecision, voteWindow, VOTE_WINDOW_MS, VOTE_WINDOW_MAX_MS } from "../client/scanner/scan-ui-logic.js";
import { buildTextIndex, decideText, parseHp, parseCollectorNumbers } from "../server/scan-text-logic.ts";
import { SCORE_STRONG, SCORE_ACCEPT } from "../server/scan-logic.ts";

const flat = (w: number, h: number, v: number): Gray => ({ w, h, d: new Float32Array(w * h).fill(v) });

test("Glanz-Maske: Lichtreflex im Artwork markiert nur die betroffenen dHash-Bits", () => {
  const card = flat(NORM_W, NORM_H, 110);
  assert.equal(maskBits(glareMask(card)), 0, "ohne Reflex keine Maske");
  // Reflex oben links im Artwork (erste Zellen der ersten Zeile)
  const x0 = Math.round(ART_BOX.u0 * NORM_W), y0 = Math.round(ART_BOX.v0 * NORM_H);
  for (let y = y0; y < y0 + 12; y++) for (let x = x0; x < x0 + 16; x++) card.d[y * NORM_W + x] = 255;
  const m = glareMask(card);
  const n = maskBits(m);
  assert.ok(n > 0 && n <= 6, `nur wenige Bits maskiert (${n})`);
  assert.ok((m[0] >>> 31) === 1, "Bit 0 (Zeile 0, Zelle 0/1) ist maskiert");
});

test("Maskierter Abgleich: Bits unter dem Reflex kippen den Treffer nicht mehr zur falschen Karte", () => {
  // Probe = Karte A, aber 10 dHash-Bits durch Spiegelung gekippt (genau die maskierten)
  const mask: [number, number] = [0xffc00000 >>> 0, 0];
  const a = new Uint32Array([0x12345678, 0x9abcdef0, 0x0f0f0f0f, 0xf0f0f0f0, 0x11111111, 0x22222222]);
  const probe = Uint32Array.from(a);
  probe[2] = (probe[2] ^ mask[0]) >>> 0;
  // Karte B: Artwork-pHash 2 Bit anders, dHash entspricht zufällig dem gespiegelten Probe
  const b = Uint32Array.from(a);
  b[0] = (b[0] ^ 0b11) >>> 0;
  b[2] = probe[2];
  const index = new Uint32Array(2 * WORDS);
  index.set(a, 0); index.set(b, WORDS);
  assert.equal(distances(probe, index, 0)[1], 10, "ohne Maske: 10 Bit Abstand zu A");
  assert.equal(maskedDistances(probe, index, 0, mask)[1], 0, "mit Maske: verdeckte Bits zählen nicht");
  assert.equal(topMatchesMasked(probe, index, 2, 2, null)[0].i, 1, "ohne Maske gewinnt fälschlich B");
  assert.equal(topMatchesMasked(probe, index, 2, 2, mask)[0].i, 0, "mit Maske gewinnt A");
  // Zu große Maske (Artwork größtenteils verdeckt) → ehrlich ohne Maske rechnen
  const huge: [number, number] = [0xffffffff >>> 0, 0x0000ffff];
  assert.ok(maskBits(huge) > GLARE_MASK_MAX);
  assert.deepEqual(maskedDistances(probe, index, 0, huge), distances(probe, index, 0));
});

test("Highlight-Kompression + adaptive Gamma, lokaler Kontrast und Lese-Streifen", () => {
  const g = flat(100, 20, 120);
  for (let i = 0; i < 100 * 4; i++) g.d[i] = 255; // Glanzstreifen oben
  const t = toneMap(g);
  assert.ok(Math.max(...t.d) <= 255);
  assert.ok(t.d[0] < 248, "Glanzspitzen sind nicht mehr reinweiß (gestaucht)");
  assert.ok(t.d[0] > t.d[100 * 10], "Reihenfolge der Helligkeit bleibt erhalten");
  // Milchige Hülle: linke Hälfte heller Grund mit dunklen Ziffern (Kontrast 20), rechte Hälfte dunkel
  const s = flat(80, 16, 0);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 80; x++) {
    const base = x < 40 ? 200 : 60;
    s.d[y * 80 + x] = (x % 6 < 2) ? base - 20 : base;
  }
  const l = localContrast(s, 4, 1);
  const range = (x0: number, x1: number) => { let a = 255, b = 0; for (let x = x0; x < x1; x++) { const v = l.d[8 * 80 + x]; a = Math.min(a, v); b = Math.max(b, v); } return b - a; };
  assert.ok(range(0, 20) > 60, "Ziffern links treten hervor");
  assert.ok(range(60, 80) > 60, "Ziffern rechts treten hervor");
  const p = prepareStrip(s);
  assert.equal(p.w, 80); assert.equal(p.h, 16);
});

test("2-aus-3-Konsens: Lock erst, wenn 2 Bilder in ~250 ms dieselbe Karte zeigen", () => {
  const v = createFrameVoter();
  assert.equal(v.push(["card:a"], 1000).locked, false, "ein Bild allein lockt nie");
  assert.equal(v.push(["card:a", "print:en:a"], 1080).locked, true, "zweites Bild in 80 ms → Lock");
  v.reset();
  v.push(["card:a"], 1000);
  assert.equal(v.push(["card:a"], 1400).locked, false, "400 ms später zählt das erste Bild nicht mehr");
  v.reset();
  v.push(["card:a"], 1000);
  v.push(["card:b"], 1070); // Karte wird gerade hingelegt
  assert.equal(v.push(["card:a"], 1140).locked, true, "2 von 3 genügen");
  v.reset();
  v.push(["card:a"], 1000);
  v.push([], 1060);
  v.push([], 1120);
  assert.equal(v.push(["card:a"], 1180).locked, false, "nur die letzten 3 Bilder zählen");
  assert.equal(voteWindow(0), VOTE_WINDOW_MS);
  assert.equal(voteWindow(200), 500, "langsame Handys: 2,5 Bildzeiten");
  assert.equal(voteWindow(9999), VOTE_WINDOW_MAX_MS);
  // Hybrid: Artwork + gelesene Nummer im selben Bild → sofort; sonst Konsens
  assert.equal(lockDecision({ accepted: true, byNumber: true, score: SCORE_STRONG - 4 }, { locked: false }), "hit");
  assert.equal(lockDecision({ accepted: true, score: SCORE_STRONG - 4 }, { locked: false }), "wait");
  assert.equal(lockDecision({ accepted: true, score: SCORE_ACCEPT - 2 }, { locked: true }), "hit");
  assert.equal(lockDecision({ accepted: false }, { locked: true }), "none");
});

test("KP/HP lesen und als Entscheidungshilfe nutzen (Reprints gleichen Namens)", () => {
  assert.equal(parseHp("KP 180"), 180);
  assert.equal(parseHp("HP130"), 130);
  assert.equal(parseHp("120 HP"), 120);
  assert.equal(parseHp("KP 1O0"), 100, "OCR-Verwechslung O→0");
  assert.equal(parseHp("KP 125"), 0, "keine Zehnerstufe → unplausibel");
  assert.equal(parseHp("045/191"), 0);
  const idx = buildTextIndex([{ lang: "de", t: [
    "card:sv03-125\tGlurak ex\t125\t197\tOBF\t330",
    "card:sv03.5-006\tGlurak ex\t6\t165\tMEW\t330",
    "card:swsh12-018\tGlurak\t18\t195\tSIT\t170",
    "card:sv04.5-009\tGlurak\t9\t91\tPAF\t180",
    "card:base-004\tGlurak\t4\t102\tBS",
  ].join("\n") }]);
  assert.equal(idx.rows[4].hp, 0, "altes 5-Spalten-Format bleibt lesbar");
  const d = decideText(idx, "Glurak\nKP 180");
  assert.equal(d.accepted, true);
  assert.equal(d.strength, "medium", "rastet erst nach zweiter gleicher Lesung ein");
  assert.deepEqual(d.keys, ["card:sv04.5-009"]);
  // Ohne KP bleibt es ein Vorschlag
  assert.equal(decideText(idx, "Glurak").accepted, false);
  // Nummer + Name gewinnt weiterhin
  assert.equal(decideText(idx, "Glurak ex\n006/165\nKP 330").keys[0], "card:sv03.5-006");
});

test("Lose Nummernlesung verschmilzt nicht mit der KP-Zeile darunter/darüber", () => {
  assert.equal(parseCollectorNumbers("045\n130").length, 0);
  assert.equal(parseCollectorNumbers("205 165")[0]?.loose, true);
});

test("Scanner-Pipeline: Glanz-Maske im Worker, ROI-Zonen inkl. KP, 15 Analysen/s, hochauflösender Snapshot", () => {
  const worker = readFileSync(new URL("../client/scanner/scan-worker.js", import.meta.url), "utf8");
  assert.match(worker, /glareMask\(raw\)/, "Maske vom Rohbild (vor der Glanz-Unterdrückung)");
  assert.match(worker, /topMatchesMasked\(/);
  assert.match(worker, /prepareStrip\(warp\(/);
  const ocr = readFileSync(new URL("../client/scanner/ocr.js", import.meta.url), "utf8");
  assert.match(ocr, /const hp = warpZone\(/);
  assert.match(ocr, /boostZone\(left\)/);
  const live = readFileSync(new URL("../client/scanner/live-scanner.js", import.meta.url), "utf8");
  const interval = Number(/const MIN_INTERVAL_MS = (\d+);/.exec(live)?.[1]);
  assert.ok(interval > 0 && 1000 / interval >= 10 && 1000 / interval <= 16, `10–15 Analysen/s (${interval} ms)`);
  assert.match(live, /SNAPSHOT_W/);
  assert.match(live, /focusMode: "continuous"/);
  assert.match(live, /PS\.liveScanTorch\(\)/);
});
