// Set-Binder: genau EIN Preisetikett je Tasche (eigene Karte = Cardmarket-Wert + ×2, fehlende Karte = Marktplatz zuerst, sonst eBay),
// 3D-Umblättern mit Finger-Physik und Karten-Stapel-Physik im Marktplatz-Swipe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBinderCards, pocketLabel, ownedPriceTag, ebaySearchQuery, ebaySearchUrl, euroLabel } from "../server/binder-logic.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Binder-Preisetiketten: Besitz = Cardmarket-Wert, fehlend = Marktplatz (Stufe 1) vor eBay (Stufe 2)", () => {
  const cards = buildBinderCards({
    catalog: [
      { id: "sv08-1", name: "Pikachu", localId: "1", price: 14.9 }, { id: "sv08-2", name: "Glurak", localId: "2", price: 10 },
      { id: "sv08-3", name: "Evoli", localId: "3", price: 8.9 }, { id: "sv08-4", name: "Mew", localId: "4", price: null },
    ],
    owned: [{ cardId: "sv08-1", quantity: 2 }], viewerId: "me", official: 191, myListings: [],
    marketListings: [{ id: 7, cardId: "sv08-2", price: 9.5, userId: "x" }],
    ebayOffers: [{ cardId: "sv08-2", price: 4 }, { cardId: "sv08-3", price: 9.5 }, { cardId: "sv08-3", price: 7.2 }, { cardId: "sv08-1", price: 1 }],
  });
  const by = Object.fromEntries(cards.map((c) => [c.cardId, c]));
  assert.deepEqual(ownedPriceTag(by["sv08-1"]), { text: euroLabel(14.9), qty: "×2" });
  assert.equal(pocketLabel(by["sv08-1"]), null, "eigene Karte: kein Kauf-Etikett");
  assert.equal(by["sv08-1"].ebayPrice, 0, "eigene Karten ohne eBay-Preis");
  assert.equal(pocketLabel(by["sv08-2"])!.kind, "market", "Marktplatz hat Vorrang vor eBay, auch wenn eBay günstiger ist");
  assert.deepEqual(pocketLabel(by["sv08-3"]), { kind: "ebay", text: `🏷️ eBay ab ${euroLabel(7.2)}`, listingId: 0, live: true }, "günstigstes eBay-Angebot");
  assert.deepEqual(pocketLabel(by["sv08-4"]), { kind: "ebay", text: "🔎 eBay prüfen", listingId: 0, live: false });
  assert.equal(ownedPriceTag(by["sv08-2"]), null);
  assert.deepEqual(ownedPriceTag({ owned: true, price: 0, quantity: 1 }), { text: "– €", qty: "" });
});

test("eBay-Link: vorbefüllte deutsche Sofort-Kaufen-Suche, günstigster Preis zuerst, Partner-ID optional", () => {
  const q = ebaySearchQuery({ name: "Pikachu ex", number: "238/191" }, "Stürmische Funken");
  assert.equal(q, "Pikachu ex 238/191 Stürmische Funken Pokemon");
  const plain = ebaySearchUrl(q);
  assert.ok(plain.startsWith("https://www.ebay.de/sch/i.html?_nkw=Pikachu+ex+238%2F191+St%C3%BCrmische+Funken+Pokemon&LH_BIN=1&_sop=15"));
  assert.ok(!plain.includes("campid"));
  const aff = ebaySearchUrl(q, "5339244109", "pokeswipe-binder");
  assert.match(aff, /&LH_BIN=1&_sop=15&.*campid=5339244109&customid=pokeswipe-binder/);
  assert.ok(!ebaySearchUrl(q, "abc").includes("campid"), "ungültige Partner-ID wird ignoriert");
});

test("Binder-Oberfläche: ein Etikett je Tasche, 3D-Umblättern mit Feder-Physik + Haptik, Server liefert eBay-Preise", () => {
  const b = src("client/binder.js");
  assert.ok(!/ps-bslot-price/.test(b), "kein zweiter Preis in der Info-Zeile");
  assert.match(b, /ps-price-tag-owned/);
  assert.match(b, /PS\.binderEbay\(/);
  assert.match(b, /function springTo\(/);
  assert.match(b, /navigator\.vibrate\?\.\(ms\)/);
  assert.match(b, /haptic\(10\)/);
  assert.match(b, /progress > 0\.5 \|\| \(progress > 0\.3 && along > 0\.18\)/, "über die Mitte oder schneller Wisch → umblättern");
  assert.ok(!/ps-bslot-price/.test(src("client/home-binder.js")));
  const css = src("public/theme.css");
  assert.match(css, /\.ps-binder-track \{ display: grid; perspective:/);
  assert.match(css, /\.ps-bpage-shade/); assert.match(css, /\.ps-bpage-gloss/);
  assert.match(css, /\.ps-pocket-tag-ebay \{/);
  const srv = src("server/binder.ts");
  assert.match(srv, /async function setEbayOffers\(/);
  assert.match(srv, /ebayOffers, ebayCampaign: ebayCampaign\(\)/);
});

test("Marktplatz-Swipe: Karten-Stapel, Neigung je Griffpunkt, Holo-Schimmer, Velocity-Wurf und Haptik", () => {
  const m = src("client/market-swipe.js");
  assert.match(m, /ps-msw-stack/);
  assert.match(m, /navigator\.vibrate\?\.\(ms\)/); assert.match(m, /haptic\(12\)/);
  assert.match(m, /grabSign/);
  assert.match(m, /--holo-x/);
  const css = src("public/theme.css");
  assert.match(css, /\.ps-msw-under/);
  assert.match(css, /overscroll-behavior-x: none/);
});
