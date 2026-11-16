import { test } from "node:test";
import assert from "node:assert/strict";
import { shopForUrl, parseAvailability, uvpVerdict, affiliateUrl, matchesFilter, isDropTransition } from "../server/drops-logic.ts";
import { PLANS } from "../server/plans.ts";

test("Restock: nur https-Seiten bekannter Shops werden geprüft", () => {
  assert.equal(shopForUrl("https://www.amazon.de/dp/B0TEST"), "amazon");
  assert.equal(shopForUrl("https://www.smythstoys.com/de/de-de/p/123"), "smyths");
  assert.equal(shopForUrl("http://www.amazon.de/dp/B0TEST"), null);
  assert.equal(shopForUrl("https://amazon.de.evil.com/x"), null);
  assert.equal(shopForUrl("https://user:pw@www.otto.de/p"), null);
  assert.equal(shopForUrl("https://169.254.169.254/latest"), null);
  assert.equal(shopForUrl("kein link"), null);
});

test("Restock: Verfügbarkeit und Preis aus schema.org-Daten", () => {
  const inStock = `<script type="application/ld+json">{"@type":"Product","offers":{"price":"149.99","availability":"https://schema.org/InStock"}}</script>`;
  assert.deepEqual(parseAvailability(inStock), { status: "in_stock", price: 149.99 });
  assert.equal(parseAvailability(`{"availability":"http://schema.org/PreOrder","price":54.99}`).status, "preorder");
  assert.equal(parseAvailability(`{"availability":"https://schema.org/OutOfStock"}`).status, "out_of_stock");
  assert.equal(parseAvailability(`<meta itemprop="price" content="49,99">`).price, 49.99);
  assert.equal(parseAvailability("<html>nichts</html>").status, "unknown");
});

test("Restock: UVP-Ampel", () => {
  assert.equal(uvpVerdict(149.99, 149.99).level, "fair");
  assert.equal(uvpVerdict(129, 149.99).level, "fair");
  assert.equal(uvpVerdict(169, 149.99).level, "high");
  assert.equal(uvpVerdict(249, 149.99).level, "scalper");
  assert.equal(uvpVerdict(null, 149.99).level, "unknown");
});

test("Restock: Partner-Kennungen", () => {
  assert.match(affiliateUrl("https://www.amazon.de/dp/B0X?th=1", { amazon: "pokeswipe-21" }), /tag=pokeswipe-21/);
  assert.equal(affiliateUrl("https://www.amazon.de/dp/B0X", {}), "https://www.amazon.de/dp/B0X");
  assert.match(affiliateUrl("https://www.cardmarket.com/de/Pokemon/Products", { cardmarket: "abc" }), /referrer=abc/);
  assert.equal(affiliateUrl("https://www.otto.de/p/1", { amazon: "x" }), "https://www.otto.de/p/1");
});

test("Restock: Filter greifen nur für Pro", () => {
  const drop = { title: "151 Display", shop: "amazon", kind: "restock", price: "189.00", uvp: "149.99" };
  const f = { shops: "smyths", keywords: "", maxPrice: null, uvpOnly: false, preorders: true };
  assert.equal(matchesFilter(drop, f, false), true);
  assert.equal(matchesFilter(drop, f, true), false);
  assert.equal(matchesFilter(drop, { ...f, shops: "", uvpOnly: true }, true), false);
  assert.equal(matchesFilter(drop, { ...f, shops: "", keywords: "151, prismatisch" }, true), true);
  assert.equal(matchesFilter({ ...drop, kind: "preorder" }, { ...f, preorders: false }, false), false);
});

test("Restock: nur echte Wechsel lösen Alarme aus", () => {
  assert.equal(isDropTransition("out_of_stock", "in_stock"), true);
  assert.equal(isDropTransition("unknown", "preorder"), true);
  assert.equal(isDropTransition("preorder", "in_stock"), true);
  assert.equal(isDropTransition("in_stock", "in_stock"), false);
  assert.equal(isDropTransition("in_stock", "preorder"), false);
  assert.equal(isDropTransition("in_stock", "out_of_stock"), false);
});

test("Tarife: Free bekommt Restock-Alarme verzögert, bezahlte sofort", () => {
  assert.ok(PLANS.free.restockDelayMin > 0);
  assert.equal(PLANS.premium.restockDelayMin, 0);
  assert.equal(PLANS.pro.restockFilters, true);
  assert.ok(PLANS.free.fakeChecksPerMonth < PLANS.premium.fakeChecksPerMonth);
});

test("Schnell-Import: Produktname aus og:title/<title> und Art-Erkennung", async () => {
  const { pageTitle, guessKind } = await import("../server/drops.ts");
  assert.equal(pageTitle(`<meta property="og:title" content="Pokémon Karmesin &amp; Purpur 151 Elite-Trainer-Box | Smyths Toys Deutschland">`), "Pokémon Karmesin & Purpur 151 Elite-Trainer-Box");
  assert.equal(pageTitle("<title>Amazon.de: Pokémon 151 Display : Spielzeug</title>"), "Pokémon 151 Display");
  assert.equal(guessKind("151 Elite-Trainer-Box"), "etb");
  assert.equal(guessKind("Prismatic Evolutions Booster Display"), "display");
  assert.equal(guessKind("Glurak Tin"), "tin");
});
