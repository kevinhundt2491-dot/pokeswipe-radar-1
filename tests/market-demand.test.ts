import { test } from "node:test";
import assert from "node:assert/strict";
import { demandPrice, rankDemand, variantMatches, demandDigestText, type DemandRow } from "../server/demand-logic.ts";

const row = (o: Partial<DemandRow>): DemandRow => ({
  portfolioItemId: 1, cardId: "sv03.5-199", name: "Glurak-ex", image: "", setName: "151", condition: "NM", variant: "normal",
  lang: "de", printId: null, quantity: 1, wishers: 1, maxPrice: null, market: null, activeLow: null, listed: false, ...o,
});

test("variantMatches: leere Wunsch-Variante passt zu allem, sonst nur exakt", () => {
  assert.equal(variantMatches("", "reverse_holo"), true);
  assert.equal(variantMatches("holo", "holo"), true);
  assert.equal(variantMatches("holo", "normal"), false);
  assert.equal(variantMatches("normal", undefined), true);
});

test("demandPrice: Marktwert als Basis, knapp unter fremdem Inserat", () => {
  assert.equal(demandPrice({ market: 50, maxPrice: null, activeLow: null }), 50);
  assert.equal(demandPrice({ market: 50, maxPrice: null, activeLow: 45 }), 44);
  assert.equal(demandPrice({ market: null, maxPrice: 12, activeLow: null }), 12);
  assert.equal(demandPrice({ market: null, maxPrice: null, activeLow: null }), null);
});

test("demandPrice: nie über dem Wunschpreis – außer der läge unter 70 % des Marktwerts", () => {
  assert.equal(demandPrice({ market: 50, maxPrice: 40, activeLow: null }), 40);
  assert.equal(demandPrice({ market: 50, maxPrice: 20, activeLow: null }), 50);
  assert.equal(demandPrice({ market: 50, maxPrice: 60, activeLow: null }), 50);
});

test("rankDemand: Inseriertes fällt raus, viele Suchende zuerst, dann höherer Wert", () => {
  const r = rankDemand([
    row({ portfolioItemId: 1, wishers: 1, market: 100 }),
    row({ portfolioItemId: 2, wishers: 3, market: 5 }),
    row({ portfolioItemId: 3, wishers: 3, market: 20 }),
    row({ portfolioItemId: 4, wishers: 9, market: 80, listed: true }),
    row({ portfolioItemId: 5, wishers: 0, market: 80 }),
  ]);
  assert.deepEqual(r.map((x) => x.portfolioItemId), [3, 2, 1]);
  assert.equal(r[0].suggestedPrice, 20);
  assert.equal(rankDemand([row({}), row({ portfolioItemId: 2 })], 1).length, 1);
});

test("demandDigestText: Einzahl und Mehrzahl", () => {
  assert.match(demandDigestText(1, [{ name: "Pikachu", wishers: 2 }]).title, /Deine Karte Pikachu wird gesucht/);
  const t = demandDigestText(4, [{ name: "A", wishers: 3 }, { name: "B", wishers: 2 }, { name: "C", wishers: 1 }, { name: "D", wishers: 1 }]);
  assert.match(t.title, /4 Karten/);
  assert.match(t.body, /A \(3× gesucht\), B \(2× gesucht\), C \(1× gesucht\)\./);
  assert.doesNotMatch(t.body, /D \(/);
});
