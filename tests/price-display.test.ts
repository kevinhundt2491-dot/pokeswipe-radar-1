// Realistische Preise in der Swipe-Arena: Etikett, Mittelzeile und Kauf-Knopf aus genau einer Quelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceDisplay, discountVsMarket } from "../server/price-display-logic.ts";

test("Rabatt: ((Trend − Angebot) / Trend) × 100, nur wenn das Angebot günstiger ist", () => {
  assert.equal(discountVsMarket(12.66, 10.59), 16);
  assert.equal(discountVsMarket(100, 80), 20);
  assert.equal(discountVsMarket(100, 100), 0);
  assert.equal(discountVsMarket(100, 120), 0);
  assert.equal(discountVsMarket(null, 5), 0);
  assert.equal(discountVsMarket(10, 0), 0);
});

test("Ohne verifiziertes Angebot: Marktwert statt erfundenem „ab 0,99 €“", () => {
  // Fall aus dem Fehlerbericht: Trend 2,54 €, Cardmarket-„ab“ 0,99 € ist KEIN verifiziertes Angebot → wird gar nicht übergeben
  const pd = priceDisplay({ market: 2.54, offer: null });
  assert.equal(pd.mode, "market");
  assert.equal(pd.dealPct, 0);
  assert.equal(pd.tagPrice, 2.54);
  assert.equal(pd.tagLabel, "Markt");
  assert.equal(pd.buttonLabel, "🔎 Auf eBay / Cardmarket suchen (2,54 €)");
});

test("Verifiziertes, günstigeres Live-Angebot: „Kaufen ab“ und echter Rabatt – überall gleich", () => {
  const pd = priceDisplay({ market: 12.66, offer: 10.59, offerSource: "ebay" });
  assert.equal(pd.mode, "offer");
  assert.equal(pd.tagPrice, 10.59);
  assert.equal(pd.offer, 10.59);
  assert.equal(pd.dealPct, 16);
  assert.equal(pd.buttonLabel, "🛒 Kaufen ab 10,59 €");
  assert.equal(pd.offerSource, "ebay");
});

test("Live-Angebot teurer als der Markt: kein Rabatt-Badge, Marktwert bleibt maßgeblich", () => {
  const pd = priceDisplay({ market: 20, offer: 24.9, offerSource: "pokeswipe" });
  assert.equal(pd.mode, "market");
  assert.equal(pd.dealPct, 0);
  assert.equal(pd.tagPrice, 20);
  assert.match(pd.buttonLabel, /suchen \(20,00 €\)/);
});

test("Weder Marktwert noch Angebot: neutraler Such-Knopf ohne Preis", () => {
  const pd = priceDisplay({ market: 0, offer: 0 });
  assert.equal(pd.mode, "none");
  assert.equal(pd.tagPrice, null);
});

test("Swipe-Stapel: keine festen Demo-Karten mehr, Kaufpreis nie aus dem Cardmarket-„ab“-Preis", () => {
  const legacy = readFileSync(new URL("../public/js/legacy-app.js", import.meta.url), "utf8");
  assert.ok(!/swipeCatalog/.test(legacy), "der feste Chase-Katalog darf nicht mehr als Stapel dienen");
  assert.match(legacy, /let activeDeck = \[\];/);
  const arena = readFileSync(new URL("../client/arena.js", import.meta.url), "utf8");
  assert.ok(!/isListing \? it\.offer : it\.low/.test(arena), "price darf nicht aus it.low kommen");
  assert.match(arena, /price: Number\(it\.offer\) \|\| 0,/);
  const deck = readFileSync(new URL("../server/intl-catalog.ts", import.meta.url), "utf8");
  assert.match(deck, /dealPct: discountVsMarket\(r\.price, r\.offer\)/);
  assert.ok(!/x\.low <= x\.price/.test(deck), "Deal-Filter darf nicht den Cardmarket-Tiefstpreis nutzen");
});
