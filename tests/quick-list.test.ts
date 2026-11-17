import { test } from "node:test";
import assert from "node:assert/strict";
import { roundPrice, suggestPrice, conditionFactor, tierFor } from "../server/quick-list-logic.ts";

test("roundPrice: glatte Beträge je Preisklasse", () => {
  assert.equal(roundPrice(0.33), 0.35);
  assert.equal(roundPrice(12.34), 12.3);
  assert.equal(roundPrice(47.2), 47);
  assert.equal(roundPrice(123.6), 124);
  assert.equal(roundPrice(0), 0);
  assert.equal(roundPrice(0.01), 0.05);
});

test("Zustand: unbekannt/Slab zählt als NM, schlechtere Zustände mit Abschlag", () => {
  assert.equal(tierFor("graded"), "nm");
  assert.equal(conditionFactor("nm"), 1);
  assert.ok(conditionFactor("po") < conditionFactor("ex"));
});

test("suggestPrice: Bewertung schlägt Referenz, schnell liegt unter fair", () => {
  const s = suggestPrice({ tierValue: 20, tierLow: 17, tierHigh: 24, reference: 30, condition: "nm" });
  assert.equal(s.basis, "valuation");
  assert.equal(s.fair, 20);
  assert.ok(s.quick! < s.fair! && s.quick! >= 17);
  assert.deepEqual([s.low, s.high], [17, 24]);
});

test("suggestPrice: Referenz mit Zustandsfaktor, knapp unter günstigstem fremden Inserat", () => {
  const s = suggestPrice({ tierValue: null, reference: 10, condition: "nm", activeLow: 9.5 });
  assert.equal(s.basis, "reference");
  assert.equal(s.fair, 10);
  assert.ok(s.quick! < 9.5);
  const ex = suggestPrice({ tierValue: null, reference: 10, condition: "po" });
  assert.ok(ex.fair! < 10);
});

test("suggestPrice: Billig-Inserat drückt den Schnellpreis nicht unter 85 %", () => {
  const s = suggestPrice({ tierValue: 100, reference: null, activeLow: 50 });
  assert.equal(s.quick, 92);
  const t = suggestPrice({ tierValue: 100, reference: null, activeLow: 88 });
  assert.ok(t.quick! >= 85 && t.quick! < 88);
});

test("suggestPrice: ohne Daten kein Vorschlag", () => {
  assert.deepEqual(suggestPrice({ tierValue: null, reference: null }), { fair: null, quick: null, low: null, high: null, basis: "none" });
});
