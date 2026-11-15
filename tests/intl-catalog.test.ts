import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normLang, parseLangs, printId, splitPrintId, displayNumber, rarityBucket, pickCardmarket, pickTcgplayer, choosePrice,
  toEur, parseEcbXml, dealPct, parseDeckQuery, PRINT_ID_RE, estimatedPriority, releasePriority, DIGITAL_SERIES,
} from "../server/intl-logic.ts";

test("Sprachen: jp ist Alias für ja, ungültige Werte → alle Sprachen", () => {
  assert.equal(normLang("JP"), "ja");
  assert.equal(normLang("en"), "en");
  assert.equal(normLang("fr"), null);
  assert.deepEqual(parseLangs("de,jp,ja,xx"), ["de", "ja"]);
  assert.deepEqual(parseLangs(""), ["de", "en", "ja"]);
});

test("Druck-IDs: Sprache + TCGdex-ID, nur en/ja", () => {
  assert.equal(printId("ja", "SV2a-201"), "ja:SV2a-201");
  assert.deepEqual(splitPrintId("en:sv03.5-199"), { lang: "en", tcgdexId: "sv03.5-199" });
  assert.equal(splitPrintId("de:sv03.5-199"), null);
  assert.equal(splitPrintId("ja:<script>"), null);
  assert.equal(PRINT_ID_RE.test("ja:SV2a-201"), true);
});

test("Kartennummer wie auf der Karte", () => {
  assert.equal(displayNumber("199", 165), "199/165");
  assert.equal(displayNumber("001", 66), "001/066");
  assert.equal(displayNumber("SWSH050", 0), "SWSH050");
  assert.equal(displayNumber("", 165), "");
});

test("Seltenheiten aller Sprachen werden zu Gruppen zusammengefasst", () => {
  assert.equal(rarityBucket("Selten, besondere Illustration"), "sir");
  assert.equal(rarityBucket("Special illustration rare"), "sir");
  assert.equal(rarityBucket("Illustration rare"), "ir");
  assert.equal(rarityBucket("Hyperselten"), "hyper");
  assert.equal(rarityBucket("Ultra Selten"), "ultra");
  assert.equal(rarityBucket("Doppelselten"), "ultra");
  assert.equal(rarityBucket("Häufig"), "common");
  assert.equal(rarityBucket("Nicht so häufig"), "common");
  assert.equal(rarityBucket("Selten"), "rare");
  assert.equal(rarityBucket(""), null);
});

test("Preis-Feeds: Cardmarket (EUR) vor TCGplayer (USD → EUR)", () => {
  const cm = pickCardmarket({ trend: 306.03, low: 205, avg7: 338.98, avg30: 358.67, updated: "2026-11-14T22:16:19.052Z" });
  assert.equal(cm.trend, 306.03);
  assert.equal(cm.low, 205);
  const tcg = pickTcgplayer({ unit: "USD", updated: "2026-11-14T22:16:33.353Z", normal: { marketPrice: 0.28, lowPrice: 0.01 }, "reverse-holofoil": { marketPrice: 0.42, lowPrice: 0.07 } });
  assert.equal(tcg.market, 0.42);
  assert.equal(tcg.variant, "reverse-holofoil");
  const tcgSir = pickTcgplayer({ unit: "USD", holofoil: { marketPrice: 292.22, lowPrice: 247.72 } });
  assert.deepEqual(choosePrice(cm, tcgSir, 1.1052), { priceEur: 306.03, lowEur: 205, source: "cardmarket" });
  const onlyTcg = choosePrice(pickCardmarket(null), pickTcgplayer({ holofoil: { marketPrice: 110.52, lowPrice: 55.26 } }), 1.1052);
  assert.deepEqual(onlyTcg, { priceEur: 100, lowEur: 50, source: "tcgplayer" });
  assert.deepEqual(choosePrice(pickCardmarket({ trend: 0 }), pickTcgplayer(null), 1.1), { priceEur: null, lowEur: null, source: null });
  // Widersprüchliche Feeds (Cardmarket 4 € vs. TCGplayer 222 $) → TCGplayer
  const conflict = choosePrice(pickCardmarket({ trend: 4, low: 2.98 }), pickTcgplayer({ holofoil: { marketPrice: 222.23, lowPrice: 180 } }), 1.1);
  assert.equal(conflict.source, "tcgplayer");
  assert.equal(conflict.priceEur, 202.03);
  assert.equal(toEur(176.83, 176.83), 1);
  assert.equal(toEur(10, 0), null);
});

test("EZB-Kurse lesen", () => {
  const xml = `<Cube><Cube time='2026-11-13'><Cube currency='USD' rate='1.1052'/><Cube currency='JPY' rate='176.83'/></Cube></Cube>`;
  assert.deepEqual(parseEcbXml(xml), { USD: 1.1052, JPY: 176.83, day: "2026-11-13" });
  assert.deepEqual(parseEcbXml("kaputt"), { USD: null, JPY: null, day: null });
});

test("Deal-Abstand in Prozent", () => {
  assert.equal(dealPct(100, 80), 20);
  assert.equal(dealPct(0.65, 0.08), 0); // Cent-Karten sind keine Deals
  assert.equal(dealPct(100, 120), 0);
  assert.equal(dealPct(0, 5), 0);
});

test("Swipe-Filter werden begrenzt und bereinigt", () => {
  const q = parseDeckQuery({ lang: "de,jp", rarity: "sir", min: "50", max: "10", wish: "1", deals: "1", exclude: "sv08-238,ja:SV2a-201,l42,<x>", limit: "999" });
  assert.deepEqual(q.langs, ["de", "ja"]);
  assert.equal(q.rarity, "sir");
  assert.equal(q.min, 10);
  assert.equal(q.max, 50);
  assert.equal(q.wishlist, true);
  assert.equal(q.deals, true);
  assert.deepEqual(q.exclude, ["sv08-238", "ja:SV2a-201", "l42"]);
  assert.equal(q.limit, 60);
  const set = parseDeckQuery({ set: "jp:SV2a", lang: "de" });
  assert.deepEqual(set.set, { lang: "ja", id: "SV2a" });
  assert.deepEqual(set.langs, ["ja"]);
  const any = parseDeckQuery({ rarity: "any" });
  assert.equal(any.rarity, null);
  assert.equal(any.anyRarity, true);
  assert.equal(parseDeckQuery({}).rarity, "hits");
});

test("Import-Reihenfolge: neue Serien zuerst, echtes Datum ersetzt die Schätzung", () => {
  assert.ok(estimatedPriority("me", 0) > estimatedPriority("sv", 30));
  assert.ok(estimatedPriority("SV", 3) > estimatedPriority("SM", 50));
  assert.equal(releasePriority("2023-06-16", 0), 20230616);
  assert.equal(releasePriority(null, 123), 123);
  assert.ok(releasePriority("2025-01-17", 0) > estimatedPriority("sv", 99));
  assert.equal(DIGITAL_SERIES.has("tcgp"), true);
});
