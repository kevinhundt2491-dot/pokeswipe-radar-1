import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rgbaToGray, resize, pHash, dHash, cardHashes, popcount32, wordsToHex, hexToWords, packWords, unpackWords, encodeBase64, decodeBase64,
  homography, project, detectCard, normalizeCard, topMatches, decide, readNumber, glyphVector, parseNumberText, splitIndexId, localNumber,
  otsu, NORM_W, NORM_H, WORDS, type Gray, type Glyph,
} from "../server/scan-logic.ts";
import { lowJpegUrl } from "../server/scan-index.ts";

// Deterministisches Test-„Artwork“: Summe von Sinuswellen je Seed
function artwork(seed: number, w = NORM_W, h = NORM_H): Gray {
  const d = new Float32Array(w * h);
  const r = (k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 128;
    for (let k = 0; k < 5; k++) v += 40 * Math.sin((x / w) * (2 + 6 * r(k)) * Math.PI + r(k + 9) * 6) * Math.cos((y / h) * (2 + 5 * r(k + 3)) * Math.PI + r(k + 4) * 6);
    d[y * w + x] = Math.max(0, Math.min(255, v));
  }
  return { w, h, d };
}
const dist = (a: Uint32Array, b: Uint32Array, o = 0) => popcount32(a[o] ^ b[o]) + popcount32(a[o + 1] ^ b[o + 1]);

test("Bit-Hilfen: popcount, Hex, Big-Endian-Packen, Base64", () => {
  assert.equal(popcount32(0), 0);
  assert.equal(popcount32(0xffffffff), 32);
  assert.equal(popcount32(0x80000001), 2);
  assert.equal(wordsToHex(0xdeadbeef, 1), "deadbeef00000001");
  assert.deepEqual(hexToWords("deadbeef00000001"), [0xdeadbeef, 1]);
  assert.equal(hexToWords("xyz"), null);
  const words = new Uint32Array([1, 0xffffffff, 0x12345678]);
  assert.deepEqual([...unpackWords(decodeBase64(encodeBase64(packWords(words))))], [...words]);
});

test("pHash/dHash: identisch = 0, Helligkeit/Kontrast/Rauschen klein, anderes Motiv groß", () => {
  const a = artwork(1), b = artwork(2);
  const ha = cardHashes(a);
  assert.equal(dist(ha, cardHashes(a)), 0);
  const changed: Gray = { w: a.w, h: a.h, d: a.d.map((v, i) => Math.max(0, Math.min(255, v * 0.8 + 25 + ((i * 7919) % 13) - 6))) };
  const hc = cardHashes(changed);
  assert.ok(dist(ha, hc, 0) <= 8, `artP ${dist(ha, hc, 0)}`);
  assert.ok(dist(ha, hc, 4) <= 8, `fullP ${dist(ha, hc, 4)}`);
  const hb = cardHashes(b);
  assert.ok(dist(ha, hb, 0) >= 18, `fremdes Motiv artP ${dist(ha, hb, 0)}`);
  assert.equal(pHash(a).length, 2);
  assert.equal(dHash(a).length, 2);
});

test("Verkleinern per Flächenmittel erhält den Mittelwert", () => {
  const g: Gray = { w: 4, h: 2, d: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70]) };
  const r = resize(g, 2, 1);
  assert.deepEqual([...r.d], [25, 45]);
  assert.equal(rgbaToGray([255, 255, 255, 255], 1, 1).d[0].toFixed(0), "255");
});

test("Homographie bildet das Einheitsquadrat auf die Ecken ab", () => {
  const corners: [number, number][] = [[10, 20], [110, 25], [105, 160], [8, 150]];
  const H = homography(corners);
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => project(H, u, v));
  pts.forEach((p, i) => { assert.ok(Math.abs(p[0] - corners[i][0]) < 1e-6); assert.ok(Math.abs(p[1] - corners[i][1]) < 1e-6); });
});

/** Karte (Rand + Innenrahmen + Motiv) schräg auf dunklem Hintergrund rendern. */
function scene(seed: number, quad: [number, number][], W = 300, Hh = 400): Gray {
  const art = artwork(seed);
  const H = homography(quad);
  // Inverse über Lösen des 2×2-Systems je Pixel
  const [a, b, c, d, e, f, g, h] = H;
  const out = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const A00 = a - g * x, A01 = b - h * x, A10 = d - g * y, A11 = e - h * y, B0 = x - c, B1 = y - f;
    const det = A00 * A11 - A01 * A10;
    const u = (B0 * A11 - A01 * B1) / det, v = (A00 * B1 - B0 * A10) / det;
    let val = 35;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const border = u < 0.05 || u > 0.95 || v < 0.04 || v > 0.96;
      val = border ? 215 : art.d[Math.min(NORM_H - 1, Math.floor(v * NORM_H)) * NORM_W + Math.min(NORM_W - 1, Math.floor(u * NORM_W))];
    }
    out[y * W + x] = val;
  }
  return { w: W, h: Hh, d: out };
}

test("Kantenerkennung findet schräge Karten und die Entzerrung trifft den Fingerabdruck", () => {
  const quad: [number, number][] = [[52, 44], [246, 50], [250, 318], [46, 312]];
  const img = scene(3, quad);
  const guide = { x0: 50, y0: 46, x1: 250, y1: 325 };
  const det = detectCard(img, guide);
  assert.equal(det.found, true);
  det.corners.forEach((p, i) => assert.ok(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) < 6, `Ecke ${i}: ${p}`));
  // Referenz: dieselbe Karte frontal
  const ref = scene(3, [[0, 0], [NORM_W, 0], [NORM_W, NORM_H], [0, NORM_H]], NORM_W, NORM_H);
  const probe = cardHashes(normalizeCard(img, det.corners));
  const index = new Uint32Array(3 * WORDS);
  index.set(cardHashes(ref), 0);
  index.set(cardHashes(scene(4, [[0, 0], [NORM_W, 0], [NORM_W, NORM_H], [0, NORM_H]], NORM_W, NORM_H)), WORDS);
  index.set(cardHashes(scene(5, [[0, 0], [NORM_W, 0], [NORM_W, NORM_H], [0, NORM_H]], NORM_W, NORM_H)), 2 * WORDS);
  const m = topMatches(probe, index, 3, 3);
  assert.equal(m[0].i, 0);
  const dcs = decide(m, index, { localNum: () => -1, total: () => 0 }, null);
  assert.equal(dcs.accepted, true);
  assert.equal(dcs.best, 0);
});

test("Entscheidung: Kartennummer bevorzugt passenden Kandidaten, gleiche Motive werden gruppiert", () => {
  const index = new Uint32Array(3 * WORDS);
  index.set([1, 1, 5, 5, 9, 9], 0); // Eintrag 0
  index.set([1, 1, 5, 5, 9, 9], WORDS); // Eintrag 1: gleiches Artwork (andere Sprache)
  index.set([0xffff, 0, 5, 5, 9, 9], 2 * WORDS); // Eintrag 2: anderes Motiv
  const matches = [{ i: 2, score: 40, art: 10 }, { i: 0, score: 44, art: 12 }, { i: 1, score: 45, art: 12 }];
  const meta = { localNum: (i: number) => [199, 199, 12][i], total: (i: number) => [165, 165, 198][i] };
  const withoutNumber = decide(matches, index, meta, null);
  assert.equal(withoutNumber.accepted, false); // Abstand zu groß, Vorsprung zu klein
  const byNumber = decide(matches, index, meta, { num: 199, total: 165 });
  assert.equal(byNumber.accepted, true);
  assert.equal(byNumber.byNumber, true);
  assert.deepEqual(byNumber.group.sort(), [0, 1]);
  assert.equal(decide([], index, meta, null).accepted, false);
});

// Mini-Bitmapschrift (5×7) für den Ziffern-Test
const FONT: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
};
const glyphSet: Glyph[] = Object.entries(FONT).map(([ch, rows]) => ({ ch, v: glyphVector(rows.join("").split("").map(Number), 5, 7) }));

test("Ziffern-Erkennung liest „199/165“ aus einem Nummern-Streifen (dunkel auf hell und hell auf dunkel)", () => {
  for (const dark of [true, false]) {
    const text = "199/165", scale = 4, W = 252, H = 72;
    const d = new Float32Array(W * H).fill(dark ? 230 : 30);
    text.split("").forEach((ch, k) => {
      FONT[ch].forEach((row, y) => row.split("").forEach((bit, x) => {
        if (bit !== "1") return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) d[(20 + y * scale + dy) * W + 12 + k * 26 + x * scale + dx] = dark ? 20 : 240;
      }));
    });
    const r = readNumber({ w: W, h: H, d }, glyphSet);
    assert.ok(r, "keine Nummer gelesen");
    assert.equal(r!.num, 199);
    assert.equal(r!.total, 165);
  }
  assert.ok(otsu({ w: 2, h: 1, d: new Float32Array([10, 240]) }) >= 10);
});

test("Text-Erkennung, Index-IDs und Bildadressen", () => {
  assert.deepEqual(parseNumberText("HP 230  199 / 165  SIR"), { num: 199, total: 165 });
  assert.deepEqual(parseNumberText("O25/I65"), { num: 25, total: 165 });
  assert.equal(parseNumberText("Glurak"), null);
  assert.deepEqual(splitIndexId("sv03.5-199"), { kind: "card", lang: "de", setId: "sv03.5", localId: "199" });
  assert.deepEqual(splitIndexId("ja:SV2a-201"), { kind: "print", lang: "ja", setId: "SV2a", localId: "201" });
  assert.equal(localNumber("025"), 25);
  assert.equal(localNumber("SVP085"), -1);
  assert.equal(lowJpegUrl("https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp"), "https://assets.tcgdex.net/de/sv/sv03.5/199/low.jpg");
  assert.equal(lowJpegUrl("https://evil.example/x/high.webp"), "");
});
