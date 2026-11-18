// Texterkennung: Vorverarbeitung der Lesestreifen (Kontrast, Invertieren) und Übergabe an Tesseract als PGM.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – reines Browser-Modul ohne Typen; die getesteten Funktionen brauchen kein DOM
import { enhanceGray, toPgm } from "../client/scanner/ocr.js";

const rgba = (vals: number[]) => {
  const d = new Uint8ClampedArray(vals.length * 4);
  vals.forEach((v, i) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; });
  return d;
};

test("enhanceGray: dunkle Schrift auf hellem Grund wird auf vollen Kontrast gestreckt", () => {
  const vals = [...Array(90).fill(200), ...Array(10).fill(60)];
  const g = enhanceGray(rgba(vals), vals.length);
  assert.equal(g[0], 255);
  assert.equal(g[95], 0);
});

test("enhanceGray: helle Schrift auf dunklem Grund (Full-Art) wird invertiert", () => {
  const vals = [...Array(90).fill(30), ...Array(10).fill(220)];
  const g = enhanceGray(rgba(vals), vals.length);
  assert.ok(g[0] > 200, "Hintergrund hell");
  assert.ok(g[95] < 40, "Schrift dunkel");
});

test("toPgm: P5-Kopf und Pixel unverändert", () => {
  const z = { w: 3, h: 2, gray: new Uint8Array([0, 10, 20, 30, 40, 255]) };
  const out = toPgm(z);
  const head = new TextDecoder().decode(out.subarray(0, out.length - 6));
  assert.equal(head, "P5\n3 2\n255\n");
  assert.deepEqual([...out.subarray(out.length - 6)], [0, 10, 20, 30, 40, 255]);
});
