import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGrade, rawCondition, titleLang, isJunkTitle, titleMatchesCard, titleMatchesSealed, median, quantile, trimOutliers,
  dailyMedians, discountPct, evaluateDeal, chooseRef, sealedAutoPrice, gradingRoi, affiliateItemUrl, ebaySearchUrl,
  buildQuery, parseTargetKey, targetKey, nameTokens, EPN_CAMPAIGN_ID,
} from "../server/flip-logic.ts";
import { parseDealQuery } from "../server/flip.ts";

test("Grading aus dem Titel: PSA 10/9/8, BGS, CGC, „PSA ready“ bleibt Raw", () => {
  assert.equal(parseGrade("Glurak ex 199/165 PSA 10 GEM MINT 151").key, "psa10");
  assert.equal(parseGrade("Charizard ex PSA10 Pokemon 151").key, "psa10");
  assert.equal(parseGrade("Pikachu PSA 9 MINT").key, "psa9");
  assert.equal(parseGrade("Pikachu PSA 8").key, "psa8");
  assert.equal(parseGrade("Pikachu PSA 7").key, "other");
  assert.equal(parseGrade("Umbreon VMAX BGS 9.5 Gem Mint").key, "bgs");
  assert.equal(parseGrade("Umbreon VMAX Beckett 10 Black Label").key, "bgs");
  assert.equal(parseGrade("Mew ex CGC 10 Pristine").key, "cgc");
  assert.equal(parseGrade("Glurak ex 199/165 NM PSA 10 Kandidat").key, "raw");
  assert.equal(parseGrade("Glurak ex 199/165 PSA ready").key, "raw");
  assert.equal(parseGrade("Glurak ex 199/165 Near Mint").key, "raw");
  assert.equal(parseGrade("Glurak ex 199/165 graded slab").key, "other");
});

test("Zustand, Sprache und Ausschluss-Titel", () => {
  assert.equal(rawCondition("Glurak ex NM pack fresh"), "nm");
  assert.equal(rawCondition("Glurak ex light played"), "lp");
  assert.equal(rawCondition("Glurak ex mit Knick"), "dmg");
  assert.equal(rawCondition("Glurak ex 330 HP Karte"), "");
  assert.equal(rawCondition("Glurak ex 199/165 EX"), "lp");
  assert.equal(titleLang("Charizard ex 201/165 Japanese SV2a"), "ja");
  assert.equal(titleLang("Charizard ex 199/165 English"), "en");
  assert.equal(titleLang("Glurak ex 199/165 Deutsch"), "de");
  assert.equal(titleLang("Glurak ex 199/165"), null);
  for (const t of ["Glurak ex Proxy Karte", "Pokemon Karten Konvolut 50 Stück", "Glurak Gold Metal Card", "Charizard Custom Orica", "Glurak ex Jumbo Oversize"]) {
    assert.equal(isJunkTitle(t), true, t);
  }
  assert.equal(isJunkTitle("Glurak ex 199/165 Pokemon 151 NM"), false);
});

test("Kartenzuordnung: Nummer x/y genügt, sonst Name + Nummer; fremde Sets und JP werden abgelehnt", () => {
  const target = { names: ["Glurak-ex", "Charizard ex"], localId: "199", total: 165, rejectLang: ["ja" as const] };
  assert.equal(titleMatchesCard("Pokemon 151 Charizard ex 199/165 SIR NM", target), true);
  assert.equal(titleMatchesCard("Glurak ex 199 / 165 Deutsch", target), true);
  assert.equal(titleMatchesCard("Glurak ex 199/198 Karmesin Purpur", target), false);
  assert.equal(titleMatchesCard("Glurak ex 199/165 japanisch", target), false);
  assert.equal(titleMatchesCard("Bisasam 166/165 151", target), false);
  const jp = { names: ["Charizard ex"], localId: "201", total: 165, requireLang: "ja" as const };
  assert.equal(titleMatchesCard("Charizard ex 201/165 SAR Japanese 151 SV2a", jp), true);
  assert.equal(titleMatchesCard("Charizard ex 201/165 SAR", jp), false);
  const promo = { names: ["Pikachu"], localId: "SVP085", total: null };
  assert.equal(titleMatchesCard("Pikachu SVP 085 Promo", promo), true);
  assert.equal(titleMatchesCard("Pikachu SVP 086 Promo", promo), false);
  assert.deepEqual(nameTokens("Mega-Rayquaza-ex"), ["rayquaza"]);
});

test("Sealed-Zuordnung: Kernwörter + Produktart, geöffnete/leere Produkte raus", () => {
  assert.equal(titleMatchesSealed("Pokemon Prismatische Entwicklungen Top Trainer Box deutsch OVP", "Prismatische Entwicklungen Top-Trainer-Box", "etb"), true);
  assert.equal(titleMatchesSealed("Pokemon Prismatische Entwicklungen Top Trainer Box LEER", "Prismatische Entwicklungen Top-Trainer-Box", "etb"), false);
  assert.equal(titleMatchesSealed("Pokemon Prismatische Entwicklungen Booster Bundle", "Prismatische Entwicklungen Top-Trainer-Box", "etb"), false);
  assert.equal(titleMatchesSealed("Pokemon Stellarkrone Display 36 Booster deutsch", "Stellarkrone Display", "display"), true);
});

test("Statistik: Median, Quantil, Ausreißer, Tages-Mediane", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
  assert.deepEqual(trimOutliers([100, 105, 98, 102, 101, 5, 900]), [98, 100, 101, 102, 105]);
  assert.deepEqual(dailyMedians([{ day: "2026-11-02", price: 10 }, { day: "2026-11-01", price: 8 }, { day: "2026-11-02", price: 20 }]),
    [{ day: "2026-11-01", median: 8, n: 1 }, { day: "2026-11-02", median: 15, n: 2 }]);
});

test("Deal-Regel: ≥ 20 % unter Referenz, Auktionen nur kurz vor Ende, Fälschungen/Beschädigte nie", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  assert.equal(discountPct(100, 75), 25);
  assert.deepEqual(evaluateDeal({ total: 79, ref: 100, buyingOption: "FIXED_PRICE", now }), { pct: 21, isDeal: true, suspicious: false });
  assert.equal(evaluateDeal({ total: 85, ref: 100, buyingOption: "FIXED_PRICE", now }).isDeal, false);
  assert.equal(evaluateDeal({ total: 3, ref: 4.5, buyingOption: "FIXED_PRICE", now }).isDeal, false); // Referenz < 5 €
  assert.equal(evaluateDeal({ total: 50, ref: 100, buyingOption: "AUCTION", endAt: new Date(now + 3 * 86400_000), now }).isDeal, false);
  assert.equal(evaluateDeal({ total: 50, ref: 100, buyingOption: "AUCTION", endAt: new Date(now + 3600_000), now }).isDeal, true);
  assert.equal(evaluateDeal({ total: 50, ref: 100, buyingOption: "FIXED_PRICE", rawCondition: "dmg", now }).isDeal, false);
  assert.equal(evaluateDeal({ total: 50, ref: 100, buyingOption: "FIXED_PRICE", junk: true, now }).isDeal, false);
  assert.equal(evaluateDeal({ total: 30, ref: 100, buyingOption: "FIXED_PRICE", now }).suspicious, true);
  assert.equal(evaluateDeal({ total: 70, ref: 100, buyingOption: "FIXED_PRICE", sellerFeedbackPct: 91, now }).suspicious, true);
});

test("Referenzpreis: Raw konservativ (kleinerer Wert), Slabs nur mit genug Verkäufen", () => {
  assert.deepEqual(chooseRef("raw", 100, null), { ref: 100, source: "cardmarket" });
  assert.deepEqual(chooseRef("raw", 100, { median: 80, sample: 6 }), { ref: 80, source: "sold" });
  assert.deepEqual(chooseRef("raw", 100, { median: 80, sample: 2 }), { ref: 100, source: "cardmarket" });
  assert.deepEqual(chooseRef("raw", 100, { median: 130, sample: 9 }), { ref: 100, source: "cardmarket" });
  assert.deepEqual(chooseRef("psa10", 100, null), { ref: null, source: null });
  assert.deepEqual(chooseRef("psa10", null, { median: 450, sample: 3 }), { ref: 450, source: "sold" });
});

test("Sealed-Autopreis: Verkäufe > Auktionen > unteres Angebotsquartil > Community", () => {
  assert.deepEqual(sealedAutoPrice({ sold: [200, 210, 190], auctions: [150, 150, 150], asks: [], community: [] }), { price: 200, source: "ebay-sold", sample: 3 });
  assert.deepEqual(sealedAutoPrice({ sold: [200], auctions: [150, 160, 170], asks: [], community: [] }), { price: 160, source: "ebay-auction", sample: 3 });
  assert.deepEqual(sealedAutoPrice({ sold: [], auctions: [], asks: [100, 110, 120, 130, 140], community: [] }), { price: 110, source: "ebay-ask", sample: 5 });
  assert.deepEqual(sealedAutoPrice({ sold: [], auctions: [], asks: [100], community: [90, 110] }), { price: 100, source: "community", sample: 2 });
  assert.equal(sealedAutoPrice({ sold: [], auctions: [], asks: [100], community: [90] }), null);
});

test("Grading-ROI: Kosten, erwarteter Wert, Gewinnschwelle", () => {
  const r = gradingRoi({ raw: 100, fee: 25, shipping: 15, psa10: 400, psa9: 180, psa8: 110, p10: 0.4, p9: 0.4, sellFeePct: 0 });
  assert.equal(r.cost, 140);
  assert.equal(r.expected, 160 + 72 + 22);
  assert.equal(r.profit, 114);
  assert.equal(r.worth, true);
  assert.equal(r.profitIf10, 260);
  // 0,4·180 + 0,6·110 = 138 → (140 − 138) / (400 − 110) ≈ 0,7 %
  assert.equal(r.breakEvenP10, 0.7);
  const bad = gradingRoi({ raw: 100, fee: 25, shipping: 15, psa10: 120, p10: 0.3, p9: 0.3 });
  assert.equal(bad.worth, false);
});

test("ePN-Links: Partner-URL von eBay bevorzugt, sonst Parameter anhängen, fremde Hosts nie", () => {
  assert.equal(affiliateItemUrl("https://www.ebay.de/itm/123", "https://www.ebay.de/itm/123?mkcid=1&campid=5339244109"), "https://www.ebay.de/itm/123?mkcid=1&campid=5339244109");
  const u = new URL(affiliateItemUrl("https://www.ebay.de/itm/123456"));
  assert.equal(u.searchParams.get("campid"), EPN_CAMPAIGN_ID);
  assert.equal(u.pathname, "/itm/123456");
  assert.equal(affiliateItemUrl("https://evil.example/itm/1"), "");
  assert.equal(affiliateItemUrl("javascript:alert(1)"), "");
  assert.match(ebaySearchUrl("Glurak 199/165"), /campid=5339244109/);
});

test("Suchbegriffe, Ziel-Schlüssel und Deal-Filter", () => {
  assert.equal(buildQuery({ kind: "print", lang: "ja", name: "リザードンex", nameEn: "Charizard", number: "201/165" }), "Charizard 201/165 japanese");
  assert.equal(buildQuery({ kind: "sealed", name: "Pokémon Stellarkrone Display" }), "Pokemon Stellarkrone Display");
  assert.equal(targetKey("print", "ja:SV2a-201"), "print:ja:SV2a-201");
  assert.deepEqual(parseTargetKey("print:ja:SV2a-201"), { kind: "print", id: "ja:SV2a-201" });
  assert.equal(parseTargetKey("user:1"), null);
  const f = parseDealQuery({ cat: "sealed", grade: "x", minPct: "5", limit: "999", sort: "ending" });
  assert.deepEqual(f, { cat: "sealed", grade: "all", option: "all", lang: "all", minPct: 20, sort: "ending", limit: 60 });
});
