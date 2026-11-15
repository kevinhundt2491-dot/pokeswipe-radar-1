// Phase 6: Varianten-Preise, Zustandsbewertung, CSV-Erkennung, Suchtext-Zerlegung, Set-Vollständigkeit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVariant, parseVariant, normalizeCondition, availableVariants, splitCardmarketPricing, tcgplayerVariantPrices,
  variantPrice, itemUnitValue, printVariantPrices,
} from "../server/variant-logic.ts";
import { parseSearchQuery, parseSearchFilters, searchCacheKey } from "../server/search-logic.ts";
import { setCompleteness } from "../server/set-completeness-logic.ts";
import { detectVariant, detectCondition, csvToRows } from "../client/csv.js";

test("Varianten: Eingaben normalisieren und streng prüfen", () => {
  assert.equal(normalizeVariant("Reverse Holo"), "reverse_holo");
  assert.equal(normalizeVariant("1st Edition"), "first_edition");
  assert.equal(normalizeVariant("holofoil"), "holo");
  assert.equal(normalizeVariant("unbekannt"), "normal");
  assert.equal(parseVariant(""), "normal");
  assert.equal(parseVariant("shadowless"), "shadowless");
  assert.equal(parseVariant("glitzer"), null);
  assert.equal(normalizeCondition("Light Played"), "LP");
  assert.equal(normalizeCondition("xx"), "NM");
  assert.deepEqual(availableVariants("normal,reverse,firstEdition"), ["normal", "reverse_holo", "first_edition"]);
});

test("Varianten-Preise: Cardmarket-Reihe *-holo ist Reverse Holo, außer bei reinen Holo-Karten", () => {
  const cm = { trend: 1.2, avg: 1.1, low: 0.5, "trend-holo": 4.5, "avg-holo": 4.2, "low-holo": 3 };
  const split = splitCardmarketPricing(cm, { normal: true, reverse: true });
  assert.equal(split.base.trend, 1.2);
  assert.equal(split.reverse.trend, 4.5);
  const holoOnly = splitCardmarketPricing({ "trend-holo": 30 }, { holo: true, normal: false, reverse: false });
  assert.equal(holoOnly.base.trend, 30);
  assert.equal(holoOnly.reverse.trend, null);
});

test("Varianten-Preise: Stückwert je Variante und Zustand", () => {
  const card = { trend: "10.00", avg: null, low: null, reverseTrend: "25.00", reverseAvg: null, reverseLow: null };
  assert.deepEqual(variantPrice(card, "reverse_holo"), { price: 25, exact: true, source: "cardmarket" });
  assert.equal(variantPrice(card, "first_edition").exact, false); // kein eigener Preis → Basispreis
  assert.equal(variantPrice(card, "first_edition", { first_edition: { price: 80 } }).price, 80);
  assert.equal(itemUnitValue(card, { variant: "reverse_holo", condition: "LP" }).unit, 15);
  assert.equal(itemUnitValue(card, { variant: "normal", condition: "NM" }).unit, 10);
  assert.deepEqual(itemUnitValue(null, { manualValue: "3.5" }).unit, 3.5);
});

test("Varianten-Preise: TCGplayer-Varianten in EUR", () => {
  const out = tcgplayerVariantPrices({ normal: { marketPrice: 2.2 }, reverseHolofoil: { marketPrice: 5.5, lowPrice: 4.4 }, "1stEditionHolofoil": { marketPrice: 110 } }, 1.1);
  assert.deepEqual(out.normal, { price: 2, low: null });
  assert.deepEqual(out.reverse_holo, { price: 5, low: 4 });
  assert.equal(out.first_edition?.price, 100);
  assert.equal(printVariantPrices({ cardmarket: { trend: 1, "trend-holo": 3 } }, null)?.reverse_holo?.price, 3);
});

test("CSV-Import: Variante, Zustand und Sprache werden erkannt", () => {
  assert.equal(detectVariant("Reverse Holofoil"), "reverse_holo");
  assert.equal(detectVariant("yes", "is reverse holo"), "reverse_holo");
  assert.equal(detectVariant("", "", "Glurak (1st Edition)"), "first_edition");
  assert.equal(detectCondition("Lightly Played"), "LP");
  const rows = csvToRows("Name;Number;Condition;Finish;Language\nGlurak;4/102;Near Mint;1st Edition;English\nPikachu;58;Played;Normal;Deutsch");
  assert.equal(rows[0].variant, "first_edition");
  assert.equal(rows[0].lang, "en");
  assert.equal(rows[1].condition, "PL");
  assert.equal(rows[1].variant, "normal");
});

test("Suche: Nummer, Setgröße, Set-Kürzel, Sprache und TCGdex-ID", () => {
  assert.deepEqual(parseSearchQuery("Glurak 4/102"), { text: "glurak", number: "4", total: 102, cardId: null, setCode: null, langHint: null });
  const q = parseSearchQuery("Pikachu ex OBF #125");
  assert.equal(q.number, "125"); assert.equal(q.setCode, "OBF"); assert.equal(q.text, "pikachu ex");
  assert.equal(parseSearchQuery("glurak jp").langHint, "ja");
  assert.equal(parseSearchQuery("sv03.5-199").cardId, "sv03.5-199");
  assert.equal(parseSearchQuery("Mew 151").number, "151");
  assert.equal(parseSearchQuery("100%_Glu").text, "100glu");
});

test("Suche: Filter werden geprüft", () => {
  const ok = parseSearchFilters({ lang: "de,ja", variant: "reverse_holo", rarity: "sir", min: "2,5", limit: "500" });
  assert.ok(!("error" in ok));
  if (!("error" in ok)) { assert.deepEqual(ok.langs, ["de", "ja"]); assert.equal(ok.min, 2.5); assert.equal(ok.limit, 50); }
  assert.ok("error" in parseSearchFilters({ lang: "fr" }));
  assert.ok("error" in parseSearchFilters({ variant: "glitzer" }));
  assert.ok("error" in parseSearchFilters({ min: "abc" }));
  assert.ok("error" in parseSearchFilters({ set: "a b" }));
  const f = parseSearchFilters({}) as any;
  assert.equal(searchCacheKey(parseSearchQuery("Glurak"), f), searchCacheKey(parseSearchQuery("  GLURAK "), f));
});

test("Set-Vollständigkeit: fehlende reguläre Nummern und Secret Rares", () => {
  const r = setCompleteness(["1", "2", "4", "5", "6", "007"], { official: 5, total: 7 });
  assert.equal(r.status, "incomplete");
  assert.deepEqual(r.missingMain, ["3"]);
  assert.deepEqual(r.missingSecret, []);
  assert.equal(r.missingCount, 1);
  const full = setCompleteness(["1", "2", "TG01"], { official: 2, total: 3 });
  assert.equal(full.status, "complete");
  assert.equal(full.specialImported, 1);
  assert.equal(setCompleteness(["SWSH001"], { official: 0, total: 0 }).status, "unknown");
});
