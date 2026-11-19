// Marktplatz-Erweiterungen: 📦 Pokémon-Artikel, 📖 16er Binder (4×4) & 👆 Swipe (Hochschieben), Creator-Sammler-Mail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  M16_MODES, M16_PAGE, mixListings, isNear, isDeal, quickFilter, pages16, clampPage, turnDecision, swipeDecision, velocityOf, springStep, rubber,
} from "../client/market16-logic.js";
import {
  ITEM_CATEGORIES, ITEM_CONDITIONS, normalizeItemFields, filterByType, listingTypeOf, itemCategoryLabel, itemConditionLabel,
} from "../server/item-listing-logic.ts";
import {
  TIKTOK_DE_CREATORS, NO_EMAIL_TIKTOK_LABEL, bulkSendGap, BULK_SEND_GAP_MIN_MS, BULK_SEND_GAP_MAX_MS, fillSammlerMail, sammlerLink, suggestPromoCode,
  FEATURED_CREATORS, tiktokProfileUrl,
} from "../server/creator-logic.ts";

const L = (id: number, extra: Record<string, unknown> = {}) => ({ id, card_name: `Karte ${id}`, price: 10, city: "Köln", ...extra });

test("Pokémon-Artikel: Unterkategorien & Zustände wie gewünscht", () => {
  assert.deepEqual(ITEM_CATEGORIES.map((c) => c.label), [
    "Booster & Displays", "ETBs & Kollektionen", "Ordner & Zubehör (Sleeves/Toploader)", "Plüsch & Figuren", "Sammlungen / Lots", "Sonstiges",
  ]);
  assert.deepEqual(ITEM_CONDITIONS.map((c) => c.label), ["Neu & OVP (Sealed)", "Wie neu", "Gebraucht"]);
  assert.equal(itemCategoryLabel("etb"), "ETBs & Kollektionen");
  assert.equal(itemConditionLabel("like_new"), "Wie neu");
});

test("Pokémon-Artikel: Normalisierung, Karten-Inserate bleiben unberührt", () => {
  assert.equal(normalizeItemFields({ card: "Glurak ex", price: 5 }), null, "ohne listingType = Karte wie bisher");
  assert.equal(normalizeItemFields({ listingType: "card" }), null);
  const n = normalizeItemFields({ listingType: "item", itemCategory: "booster", itemCondition: "sealed", description: "  Display OVP\r\nmit Folie " });
  assert.deepEqual(n, { listingType: "item", itemCategory: "booster", itemCondition: "sealed", description: "Display OVP\nmit Folie", condition: "sealed" });
  const bad = normalizeItemFields({ listingType: "item", itemCategory: "<script>", itemCondition: "kaputt", description: "x".repeat(5000) });
  assert.equal(bad?.itemCategory, "sonstiges");
  assert.equal(bad?.itemCondition, "used");
  assert.equal(bad?.condition, "");
  assert.equal(bad?.description.length, 1000);
});

test("Typ-Filter: alte Inserate ohne listing_type gelten als Karte", () => {
  const list = [L(1), L(2, { listing_type: "item", item_category: "pluesch" }), L(3, { listing_type: "card" }), L(4, { listing_type: "item", item_category: "etb" })];
  assert.equal(listingTypeOf(list[0]), "card");
  assert.deepEqual(filterByType(list, "all").map((l) => l.id), [1, 2, 3, 4]);
  assert.deepEqual(filterByType(list, "card").map((l) => l.id), [1, 3]);
  assert.deepEqual(filterByType(list, "item").map((l) => l.id), [2, 4]);
  assert.deepEqual(filterByType(list, "item", "etb").map((l) => l.id), [4]);
});

test("16er Binder: Seiten zu je 16 Fächern, gemischt aber stabil", () => {
  assert.deepEqual(M16_MODES, ["std", "binder", "swipe"]);
  assert.equal(M16_PAGE, 16);
  const list = Array.from({ length: 37 }, (_, i) => L(i + 1));
  const pages = pages16(list);
  assert.equal(pages.length, 3);
  assert.ok(pages.every((p) => p.length === 16));
  assert.equal(pages[2].filter(Boolean).length, 5);
  assert.equal(pages16([]).length, 1, "leerer Ordner = eine leere Seite");
  const a = mixListings(list, 7).map((l) => l.id), b = mixListings(list, 7).map((l) => l.id);
  assert.deepEqual(a, b, "gleiche Sitzung = gleiche Reihenfolge");
  assert.notDeepEqual(a, list.map((l) => l.id), "bunt gemischt");
  assert.deepEqual([...a].sort((x, y) => x - y), list.map((l) => l.id), "nichts geht verloren");
  assert.equal(clampPage(9, 3), 2);
  assert.equal(clampPage(-1, 3), 0);
});

test("Schnellfilter: Alle · Nur Deals · In meiner Nähe · Karten · Artikel", () => {
  const list = [
    L(1, { priceCheck: "deal", city: "50667 Köln" }), L(2, { price: 80, market_price: 100, city: "Berlin" }),
    L(3, { listing_type: "item", item_category: "booster", city: "Köln-Ehrenfeld" }), L(4, { city: "50999 Köln" }), L(5, { city: "München" }),
  ];
  assert.deepEqual(quickFilter(list, { quick: "deals" }).map((l) => l.id), [1, 2]);
  assert.deepEqual(quickFilter(list, { quick: "near", myCity: "Köln" }).map((l) => l.id), [1, 3, 4]);
  assert.deepEqual(quickFilter(list, { quick: "near", myCity: "50321 Brühl" }).map((l) => l.id), [1, 4], "gleiches PLZ-Gebiet");
  assert.deepEqual(quickFilter(list, { quick: "near", myCity: "" }).map((l) => l.id), []);
  assert.deepEqual(quickFilter(list, { type: "item" }).map((l) => l.id), [3]);
  assert.deepEqual(quickFilter(list, { type: "card", quick: "deals" }).map((l) => l.id), [1, 2]);
  assert.ok(isDeal({ price: 8, market_price: 10 }) && !isDeal({ price: 9.5, market_price: 10 }));
  assert.ok(isNear("Köln", "köln") && !isNear("Kölner Str. 1, Bonn", ""));
});

test("Blätter-Physik: unter 30 % federt zurück, Schwung schlägt um", () => {
  assert.equal(turnDecision(0.29, 0), "back");
  assert.equal(turnDecision(0.3, 0), "commit");
  assert.equal(turnDecision(0.1, 0.8), "commit", "schneller Wisch");
  assert.equal(turnDecision(0.02, 0.8), "back", "Mini-Zucken zählt nicht");
  assert.equal(turnDecision(0.5, -0.9), "back", "zurückgeworfen");
  assert.ok(Math.abs(rubber(500, 100)) < 40, "Gummiband am Ordner-Ende");
  // Feder kommt zur Ruhe am Ziel
  let s = { x: 0.2, v: 0 };
  for (let i = 0; i < 200; i++) s = springStep(s.x, s.v, 0, 16);
  assert.ok(Math.abs(s.x) < 0.001);
});

test("Hochschieben: Velocity-Tracking, Momentum & elastisches Zurückfedern", () => {
  assert.equal(swipeDecision(-200, 0, 500), "next");
  assert.equal(swipeDecision(-100, 0, 500), "back", "halbes Ziehen federt zurück");
  assert.equal(swipeDecision(-40, -0.9, 500), "next", "schneller Wisch nach oben");
  assert.equal(swipeDecision(200, 0, 500), "prev");
  assert.equal(swipeDecision(200, 0, 500, { hasPrev: false }), "back");
  assert.equal(swipeDecision(-300, -2, 500, { hasNext: false }), "back");
  const v = velocityOf([{ t: 0, y: 400 }, { t: 40, y: 360 }, { t: 80, y: 300 }, { t: 100, y: 260 }], "y");
  assert.ok(v < -1 && v > -2, String(v));
  assert.equal(velocityOf([{ t: 0, y: 1 }], "y"), 0);
});

test("Android-Schutz & Integration: touch-action, overscroll, Haptik, Detail-Sheet", () => {
  const css = readFileSync("public/theme.css", "utf8");
  assert.match(css, /\.ps-m16-vs \{[^}]*touch-action: none[^}]*overscroll-behavior-y: contain/);
  assert.match(css, /\.ps-m16-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  const js = readFileSync("client/market16.js", "utf8");
  assert.match(js, /navigator\.vibrate\?\.\(10\)/);
  assert.match(js, /⚡ Spontan mitnehmen \/ Kaufen/);
  assert.match(js, /💬 Verkäufer fragen/);
  assert.match(js, /📖 16er Binder/);
  assert.match(js, /👆 Swipe/);
  const main = readFileSync("client/main.js", "utf8");
  assert.match(main, /renderMarket16\(list, f\)/);
  assert.match(main, /m16TypeFilter\(filterListings/);
  const app = readFileSync("server/app.ts", "utf8");
  assert.match(app, /normalizeItemFields\(it\)/);
  assert.match(app, /l\.listing_type, l\.item_category/);
  const nav = readFileSync("client/app-nav.js", "utf8");
  assert.match(nav, /🃏 Einzelkarten/);
  assert.match(nav, /📦 Pokémon-Artikel/);
});

test("Creator-Outreach: neue TikTok-Creator ohne erfundene E-Mails, Sammler-Mail, 500–800 ms Pause", () => {
  assert.ok(TIKTOK_DE_CREATORS.length >= 10);
  const names = new Set(FEATURED_CREATORS.map((f) => f.name.toLowerCase()));
  for (const c of TIKTOK_DE_CREATORS) {
    assert.equal(c.platform, "tiktok");
    assert.ok(!("email" in c), "keine E-Mail erfunden");
    assert.equal(tiktokProfileUrl(c.channelUrl), c.channelUrl);
    assert.equal(tiktokProfileUrl(c.name), c.channelUrl, "@handle passt zum Profil-Link");
    assert.match(suggestPromoCode(c.name), /^[A-Z0-9]+30$/);
    assert.ok(!names.has(c.name.toLowerCase()));
  }
  assert.equal(NO_EMAIL_TIKTOK_LABEL, "Nur TikTok-DM (keine E-Mail)");
  assert.equal(BULK_SEND_GAP_MIN_MS, 500);
  assert.equal(BULK_SEND_GAP_MAX_MS, 800);
  assert.equal(bulkSendGap(0), 500);
  assert.equal(bulkSendGap(1), 800);
  assert.ok(bulkSendGap() >= 500 && bulkSendGap() <= 800);
  assert.equal(sammlerLink("https://pokeswipe-radar.de/", "POKENING30"), "https://pokeswipe-radar.de/?src=creator&promo=POKENING30");
  const mail = fillSammlerMail({ name: "@poke.ning", code: "POKENING30", site: "https://pokeswipe-radar.de", platform: "tiktok" });
  assert.match(mail.subject, /poke\.ning/);
  assert.ok(!mail.subject.includes("@poke"), "ohne @ in der Anrede");
  assert.match(mail.body, /60 Tage PokeSwipe Pro gratis/);
  assert.match(mail.body, /VIP-Creator-Code POKENING30/);
  assert.match(mail.body, /https:\/\/pokeswipe-radar\.de\/\?src=creator&promo=POKENING30/);
  assert.match(mail.body, /auf TikTok/);
  assert.ok(!/[{}]/.test(mail.body + mail.subject), "alle Platzhalter ersetzt");
  const srv = readFileSync("server/creator.ts", "utf8");
  assert.match(srv, /\/api\/admin\/creators\/outreach-log/);
  assert.match(srv, /resendId: r\.resendId/);
  const ui = readFileSync("client/creator-admin.js", "utf8");
  assert.match(ui, /📧 Mails an alle noch nicht kontaktierten Creator senden/);
  assert.match(ui, /\+ Neuen Creator &amp; E-Mail hinzufügen|\+ Neuen Creator & E-Mail hinzufügen/);
  assert.match(ui, /Live-Versand-Protokoll/);
});
