import { test } from "node:test";
import assert from "node:assert/strict";
import { sellerFolderPages, bySeller, cmDiff, mixFeed, quickTarget } from "../client/home-split-logic.js";
import { filterSealed, sealedKindOf, isSealedListing, sealedDeliveryOf, normalizeSealedMeta, sealedRefPrice } from "../server/sealed-market-logic.ts";

const L = (id: number, o: Record<string, any> = {}) => ({ id, user_id: "u1", seller: "Anna", card_name: `Karte ${id}`, price: 5, created_at: new Date(2026, 10, id).toISOString(), ...o });

test("Marktplatz-Binder: Ordner je Anbieter, eigene Inserate ausgeblendet, Händler-Filter", () => {
  const list = [L(1), L(2), L(3), L(4), L(5), L(6, { user_id: "shop", seller: "Kartenladen", seller_dealer: true }), L(7, { user_id: "me" })];
  const pages = sellerFolderPages(list, { viewerId: "me", size: 4 });
  assert.equal(pages.length, 3); // Anna: 5 Angebote = 2 Seiten, Händler: 1 Seite
  assert.equal(pages[0].seller.name, "Anna");
  assert.deepEqual([pages[0].page, pages[0].pages, pages[1].items.length], [0, 2, 1]);
  assert.ok(pages[2].seller.dealer);
  assert.ok(!pages.some((p) => p.items.some((l: any) => l.user_id === "me")));
  assert.equal(sellerFolderPages(list, { viewerId: "me", seller: "dealer" }).length, 1);
  assert.equal(bySeller(list, "private").length, 6);
  assert.equal(sellerFolderPages(list, { q: "karte 6" }).length, 1);
});

test("Cardmarket-Vergleich in Prozent", () => {
  assert.equal(cmDiff({ price: 9, market_price: 10 }), 10);
  assert.equal(cmDiff({ price: 0, market_price: 10 }), null);
});

test("Live-Feed: Pull-Wall, Artikel & Konvolute, Sealed", () => {
  const posts = [{ id: 1, category: "pull", createdAt: "2026-11-19T10:00:00Z" }, { id: 2, category: "trade", createdAt: "2026-11-19T11:00:00Z" }];
  const listings = [L(1), L(9, { listing_type: "item", item_category: "lots" }), L(10, { listing_type: "item", item_category: "display", item_condition: "sealed" })];
  assert.equal(mixFeed(posts, listings, "all").length, 4);
  assert.deepEqual(mixFeed(posts, listings, "pulls").map((x: any) => x.post.id), [1]);
  assert.equal(mixFeed(posts, listings, "items").length, 3);
  assert.deepEqual(mixFeed(posts, listings, "sealed").map((x: any) => x.listing.id), [10]);
});

test("Schnell-Upload: Pull → Pull-Wall, Artikel mit Preis → Marktplatz, ohne Preis → Tausch-Beitrag", () => {
  assert.deepEqual(quickTarget("pull", "12"), { to: "post", category: "pull" });
  assert.equal(quickTarget("lot", "40").to, "listing");
  assert.equal(quickTarget("sealed", "0").itemCondition, "sealed");
  assert.deepEqual(quickTarget("item", ""), { to: "post", category: "trade" });
});

test("Sealed & OVP: Erkennung, Kategorien, Filter, Übergabe", () => {
  const d = L(1, { listing_type: "item", item_category: "display", item_meta: { sealed: true, set: "151", delivery: "pickup" }, city: "Köln" });
  const e = L(2, { listing_type: "item", item_category: "etb", item_condition: "sealed", price: 60, seller_dealer: true });
  const legacy = L(3, { sealed_product_id: 4, card_name: "Stürmische Funken Display (36 Booster)", want: "Verkauf · Nur Versand" });
  const plush = L(4, { listing_type: "item", item_category: "pluesch", item_condition: "used" });
  const card = L(5);
  assert.deepEqual([d, e, legacy, plush, card].map(isSealedListing), [true, true, true, false, false]);
  assert.deepEqual([d, e, legacy].map(sealedKindOf), ["display", "etb", "display"]);
  assert.equal(sealedKindOf(L(6, { listing_type: "item", item_category: "booster", card_name: "Sleeved Booster" })), "blister");
  assert.equal(sealedDeliveryOf(legacy), "ship");
  const all = [d, e, legacy, plush, card];
  assert.equal(filterSealed(all).length, 3);
  assert.deepEqual(filterSealed(all, { kind: "etb" }).map((l) => l.id), [2]);
  assert.deepEqual(filterSealed(all, { seller: "dealer" }).map((l) => l.id), [2]);
  assert.deepEqual(filterSealed(all, { delivery: "pickup" }).map((l) => l.id), [1, 2]);
  assert.deepEqual(filterSealed(all, { delivery: "ship" }).map((l) => l.id), [2, 3]);
  assert.deepEqual(filterSealed(all, { min: 10 }).map((l) => l.id), [2]);
  assert.deepEqual(filterSealed(all, { set: "151" }).map((l) => l.id), [1]);
});

test("Sealed-Formular: Zusatzangaben werden bereinigt, Richtpreis aus dem Katalog", () => {
  assert.equal(normalizeSealedMeta(null), null);
  assert.equal(normalizeSealedMeta({ set: "x" }), null);
  assert.deepEqual(normalizeSealedMeta({ sealed: true, set: "  151\n", factorySealed: true, mintBox: "ja", delivery: "teleport" }, "vintage"),
    { sealed: true, set: "151", factorySealed: true, mintBox: false, delivery: "both", vintage: true });
  const products = [{ id: 1, name: "151 Top-Trainer-Box", kind: "etb", price: 69.9 }, { id: 2, name: "151 Booster Bundle", kind: "bundle", price: 39 }, { id: 3, name: "Obsidian Display", kind: "display", price: 150 }];
  assert.equal(sealedRefPrice(products, "etb", "151")?.id, 1);
  assert.equal(sealedRefPrice(products, "display", "Obsidian Flammen")?.price, 150);
  assert.equal(sealedRefPrice(products, "etb", ""), null);
});
