// Live-Swipe im Marktplatz (client/market-swipe-logic.js): Verkäufer-Rang, gewichtetes Mischen, Händler-Ordner & Stadt-Filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sellerScore, sellerRank, sellerKind, swipeWeight, weightedShuffle, nextDeck, cityOptions, sellerFolders, normCity, BROWSE_MODES,
} from "../client/market-swipe-logic.js";

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

test("Live-Swipe: drei Ansichten, Live-Swipe zuerst", () => {
  assert.deepEqual(BROWSE_MODES, ["swipe", "folder", "search"]);
});

test("Verkäufer-Rang: Pro-Händler mit Top-Bewertungen = Diamant, neues Konto = Starter", () => {
  const top = { verified: true, buy_now: true, seller_shop: true, rating: 4.9, rating_count: 12 };
  assert.equal(sellerScore(top), 80);
  assert.equal(sellerRank(top).key, "diamond");
  assert.equal(sellerRank({ verified: true, buy_now: true }).key, "gold");
  assert.equal(sellerRank({ seller_founder: true, seller_badge: "ref-vip" }).key, "silver");
  assert.equal(sellerRank({}).key, "starter");
  assert.equal(sellerRank(null).key, "starter");
  assert.equal(sellerScore({ rating: 2, rating_count: 5 }), 0); // nie negativ
  assert.ok(swipeWeight(top) > swipeWeight({}));
  assert.equal(swipeWeight({ boosted: true }), 1.5);
});

test("Händler oder Sammler", () => {
  assert.equal(sellerKind({ seller_shop: true }), "dealer");
  assert.equal(sellerKind({ verified: true, buy_now: true }), "dealer");
  assert.equal(sellerKind({ verified: true }), "collector");
  assert.equal(sellerKind({}), "collector");
});

test("Gewichtetes Mischen: jede Karte genau einmal, höherer Rang landet häufiger vorne", () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3, verified: true, buy_now: true, seller_shop: true, rating: 5, rating_count: 9 }];
  const d = weightedShuffle(list, seq([0.5, 0.5, 0.5]));
  assert.deepEqual(d.map((l) => l.id).sort(), [1, 2, 3]);
  assert.equal(d[0].id, 3); // gleicher Zufallswert → höheres Gewicht gewinnt
  let front = 0, r = 7;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (let i = 0; i < 2000; i++) if (weightedShuffle(list, rnd)[0].id === 3) front++;
  assert.ok(front > 1000, `Diamant-Händler vorne in ${front}/2000`);
  assert.deepEqual(weightedShuffle(null), []);
});

test("Neuer Stapel beginnt nie mit der zuletzt gezeigten Karte", () => {
  const list = [{ id: 1, verified: true, buy_now: true, seller_shop: true }, { id: 2 }];
  const d = nextDeck(list, 1, seq([0.5]));
  assert.equal(d[0].id, 2);
  assert.equal(d.length, 2);
  assert.equal(nextDeck([{ id: 1 }], 1)[0].id, 1);
});

test("Händler-Ordner: ein Ordner je Verkäufer, Händler zuerst, Stadt-Filter", () => {
  const list = [
    { id: 1, user_id: "a", seller: "@Ash", city: "Köln" },
    { id: 2, user_id: "a", seller: "@Ash", city: "Köln" },
    { id: 3, user_id: "b", seller: "Kartenladen", city: "Berlin", seller_shop: true, verified: true },
    { id: 4, user_id: "c", seller: "@Misty", city: " berlin " },
  ];
  const f = sellerFolders(list);
  assert.deepEqual(f.map((x) => x.userId), ["b", "a", "c"]);
  assert.equal(f[0].kind, "dealer");
  assert.equal(f[1].listings.length, 2);
  assert.equal(f[1].city, "Köln");
  const cities = cityOptions(list);
  assert.deepEqual(cities.map((c) => [c.id, c.n]), [["berlin", 2], ["köln", 2]]);
  const berlin = sellerFolders(list, normCity("Berlin"));
  assert.deepEqual(berlin.map((x) => x.userId), ["b", "c"]);
  assert.deepEqual(sellerFolders(null), []);
});
