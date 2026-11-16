import { test } from "node:test";
import assert from "node:assert/strict";
import {
  updatePrefs, prefWeights, encodePrefParam, parsePrefParam, featureKeys, priceBand, mergePrefs, prefSummary, COLD_START_SWIPES,
} from "../server/arena-logic.ts";
import { radarRound, parseCardNumber } from "../server/community-logic.ts";
import { seedMap, seedInfo } from "../server/scan-index.ts";

test("Preisbänder", () => {
  assert.equal(priceBand(0), 0);
  assert.equal(priceBand(4.99), 0);
  assert.equal(priceBand(5), 1);
  assert.equal(priceBand(80), 3);
  assert.equal(priceBand(900), 5);
});

test("Merkmale einer Karte", () => {
  assert.deepEqual(featureKeys({ lang: "ja", rarity: "sir", set: "ja:SV2a", price: 60 }), ["r:sir", "l:ja", "s:ja:SV2a", "p:3"]);
  assert.deepEqual(featureKeys({ lang: "xx", rarity: "foo", set: "bad set", price: null }), ["r:none", "p:0"]);
});

test("Rechts-Swipes stärken, Links-Swipes schwächen die Merkmale", () => {
  let p = updatePrefs(null, []);
  for (let i = 0; i < 6; i++) p = updatePrefs(p, [{ dir: "right", lang: "ja", rarity: "sir", set: "ja:SV2a", price: 80 }]);
  for (let i = 0; i < 4; i++) p = updatePrefs(p, [{ dir: "left", lang: "de", rarity: "common", price: 0.2 }]);
  assert.equal(p.swipes, 10);
  assert.equal(p.likes, 6);
  const w = prefWeights(p);
  assert.ok(w["r:sir"] > 1.5, "SIR bevorzugt");
  assert.ok(w["l:ja"] > 1.5, "Japanisch bevorzugt");
  assert.ok(w["r:common"] < 1, "Häufige Karten seltener");
  assert.ok(Object.values(w).every((x) => x >= 0.4 && x <= 3.3));
});

test("Kaltstart: erst ab einigen Swipes wird gewichtet", () => {
  const p = updatePrefs(null, [{ dir: "right", rarity: "sir", lang: "de", price: 50 }]);
  assert.ok(p.swipes < COLD_START_SWIPES);
  assert.deepEqual(prefWeights(p), {});
  assert.equal(prefSummary(p).learning, true);
});

test("Profil-Übergabe im Deck-Aufruf ist verlustfrei und abgesichert", () => {
  let p = updatePrefs(null, []);
  for (let i = 0; i < 7; i++) p = updatePrefs(p, [{ dir: "right", lang: "en", rarity: "ir", set: "en:sv03.5", price: 30 }]);
  const back = parsePrefParam(encodePrefParam(p))!;
  assert.equal(back.swipes, p.swipes);
  assert.deepEqual(back.scores, p.scores);
  const evil = parsePrefParam("r:sir~99,x:'drop~3,s:de:sv08~-2;5;1")!;
  assert.equal(evil.scores["r:sir"], 4);
  assert.equal(evil.scores["x:'drop"], undefined);
  assert.equal(evil.scores["s:de:sv08"], -2);
  assert.equal(parsePrefParam("a".repeat(3000)), null);
});

test("Profile zusammenführen", () => {
  const a = { scores: { "r:sir": 2 }, swipes: 10, likes: 5 };
  const b = { scores: { "r:sir": -2, "l:ja": 1 }, swipes: 10, likes: 2 };
  const m = mergePrefs(a, b);
  assert.equal(m.swipes, 20);
  assert.equal(m.scores["r:sir"], undefined);
  assert.equal(m.scores["l:ja"], 0.5);
});

test("Sammler-Radar: Koordinaten auf ~1-km-Raster", () => {
  const a = radarRound(52.520008, 13.404954)!;
  const b = radarRound(52.5201, 13.4051)!;
  assert.deepEqual(a, b, "Nahe Punkte landen in derselben Zelle");
  const km = (x: { lat: number; lng: number }, y: { lat: number; lng: number }) => {
    const dLat = (x.lat - y.lat) * 111.2, dLng = (x.lng - y.lng) * 111.2 * Math.cos((x.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  assert.ok(km(a, { lat: 52.520008, lng: 13.404954 }) <= 0.75, "höchstens eine halbe Zellen-Diagonale entfernt");
  assert.equal(radarRound("x", 1), null);
  assert.equal(radarRound(95, 1), null);
});

test("Kartennummer aus Deal-Titel", () => {
  assert.deepEqual(parseCardNumber("Glurak ex 199/165 PSA"), { num: "199", total: 165 });
  assert.deepEqual(parseCardNumber("Pikachu 025 / 191"), { num: "25", total: 191 });
  assert.equal(parseCardNumber("Display 36 Booster"), null);
});

test("Scanner-Basis-Index ist vollständig hinterlegt", () => {
  const info = Object.fromEntries(seedInfo().map((s) => [s.lang, s.count]));
  assert.ok(info.de >= 10000, `DE ${info.de}`);
  assert.ok(info.en >= 15000, `EN ${info.en}`);
  assert.ok(info.ja >= 1900, `JA ${info.ja}`);
  const de = seedMap("de");
  assert.equal(de.size, info.de);
  const glurak = de.get("sv03.5-199");
  assert.ok(glurak, "151 Glurak ex 199 im Index");
  assert.match(glurak!.artP, /^[0-9a-f]{16}$/);
  assert.equal(glurak!.path, "de/sv/sv03.5/199");
});

// ---------------------------------------------------------------------------
// Phase 6: echtes Swipe-Trading (Match-Erkennung, Wertvergleich, Tausch-Schritte)
// ---------------------------------------------------------------------------
import {
  orderPair, tradeBalance, suggestCash, parseCash, tradeTransition, bestCounterpart, type TradeState,
} from "../server/trading-logic.ts";

test("Swipe-Match: Paar ist unabhängig von der Reihenfolge", () => {
  assert.deepEqual(orderPair("b", "a"), { userA: "a", userB: "b", swapped: true });
  assert.deepEqual(orderPair("a", "b"), { userA: "a", userB: "b", swapped: false });
});

test("Swipe-Match: gegenseitiger Like schlägt Wunschlisten-Treffer, danach zählt der Wert", () => {
  const best = bestCounterpart([
    { reason: "wishlist", listingId: 1, portfolioItemId: null, valueCents: 90_000 },
    { reason: "like", listingId: 2, portfolioItemId: null, valueCents: 500 },
    { reason: "like", listingId: 3, portfolioItemId: null, valueCents: 2_000 },
  ]);
  assert.equal(best?.listingId, 3);
  assert.equal(bestCounterpart([]), null);
  assert.equal(bestCounterpart([{ reason: "wishlist", listingId: null, portfolioItemId: 7, valueCents: 1 }])?.portfolioItemId, 7);
});

test("Tausch: Marktwert-Vergleich inkl. Wertausgleich", () => {
  const b = tradeBalance([{ valueCents: 4000, quantity: 1 }], [{ valueCents: 5000, quantity: 1 }], 1000, "from");
  assert.equal(b.fromGives, 5000);
  assert.equal(b.toGives, 5000);
  assert.equal(b.verdict, "fair");
  assert.equal(tradeBalance([{ valueCents: 1000, quantity: 2 }], [{ valueCents: 10_000, quantity: 1 }]).verdict, "to_overpays");
  assert.deepEqual(suggestCash(4000, 5000), { cashCents: 1000, payer: "from" });
  assert.deepEqual(suggestCash(5000, 5050), { cashCents: 0, payer: "" });
  assert.deepEqual(parseCash(0, ""), { cashCents: 0, payer: "" });
  assert.ok("error" in parseCash(500, ""));
  assert.ok("error" in parseCash(-1, "from"));
  assert.ok("error" in parseCash(600_000, "from"));
});

const base: TradeState = { status: "pending", hasItems: true, fromConfirmed: false, toConfirmed: false, fromShippedAt: null, toShippedAt: null, fromReceivedAt: null, toReceivedAt: null };

test("Tausch-Schritte: annehmen → beide versenden → beide erhalten → abgeschlossen", () => {
  assert.equal(tradeTransition(base, "sender", { action: "accept" }).ok, false); // nur der Partner nimmt an
  const acc = tradeTransition(base, "receiver", { action: "accept" });
  assert.ok(acc.ok && acc.updates.status === "accepted");
  const t1: TradeState = { ...base, status: "accepted" };
  assert.equal(tradeTransition(t1, "sender", { action: "ship", carrier: "dhl", tracking: "x" }).ok, false); // ungültige Sendungsnummer
  const s1 = tradeTransition(t1, "sender", { action: "ship", carrier: "dhl", tracking: "00340434161094042557" });
  assert.ok(s1.ok && s1.updates.status === "shipping" && s1.updates.fromTracking === "00340434161094042557");
  const t2: TradeState = { ...t1, status: "shipping", fromShippedAt: new Date() };
  assert.equal(tradeTransition(t2, "sender", { action: "cancel" }).ok, false); // nach Versand kein Abbruch
  assert.equal(tradeTransition(t2, "sender", { action: "received" }).ok, false); // Partner hat noch nicht versendet
  const r1 = tradeTransition(t2, "receiver", { action: "received" });
  assert.ok(r1.ok && !r1.completed && r1.updates.fromReceivedAt);
  const t3: TradeState = { ...t2, toShippedAt: new Date(), fromReceivedAt: new Date() };
  const r2 = tradeTransition(t3, "sender", { action: "received" });
  assert.ok(r2.ok && r2.completed && r2.updates.status === "completed");
});

test("Tausch-Schritte: alte Freitext-Tausche behalten die beidseitige Bestätigung", () => {
  const legacy: TradeState = { ...base, status: "accepted", hasItems: false };
  const a = tradeTransition(legacy, "sender", { action: "complete" });
  assert.ok(a.ok && !a.completed);
  const b = tradeTransition({ ...legacy, fromConfirmed: true }, "receiver", { action: "complete" });
  assert.ok(b.ok && b.completed);
  assert.equal(tradeTransition(legacy, "sender", { action: "ship", carrier: "dhl", tracking: "ABC123456" }).ok, false);
  assert.equal(tradeTransition(legacy, "sender", { action: "hack" }).ok, false);
});
