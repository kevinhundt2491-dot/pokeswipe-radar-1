import { test } from "node:test";
import assert from "node:assert/strict";
import {
  updatePrefs, prefWeights, encodePrefParam, parsePrefParam, featureKeys, priceBand, mergePrefs, prefSummary, COLD_START_SWIPES,
  buildPool, openPack, expectedValue, packBalance, slotOdds, PACK_LAYOUTS, boosterBucket, type BoosterCard,
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

const card = (id: string, bucket: BoosterCard["bucket"], price: number | null): BoosterCard => ({ id, name: id, number: "", image: "", rarity: bucket, bucket, price });
function samplePool() {
  const list: BoosterCard[] = [];
  for (let i = 0; i < 60; i++) list.push(card(`c${i}`, "common", 0.05));
  for (let i = 0; i < 20; i++) list.push(card(`r${i}`, "rare", 0.3));
  for (let i = 0; i < 10; i++) list.push(card(`u${i}`, "ultra", 3));
  for (let i = 0; i < 12; i++) list.push(card(`i${i}`, "ir", 8));
  for (let i = 0; i < 6; i++) list.push(card(`s${i}`, "sir", 60));
  for (let i = 0; i < 3; i++) list.push(card(`h${i}`, "hyper", 25));
  return buildPool(list);
}

test("Booster: Slot-Quoten summieren sich zu 100 %", () => {
  const pool = samplePool();
  for (const layout of Object.values(PACK_LAYOUTS)) {
    for (const slot of layout.slots) {
      const sum = slotOdds(slot, pool).reduce((s, o) => s + o.p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
    }
  }
});

test("Booster: Kartenzahl, keine Doppelten, realistische Hit-Häufigkeit", () => {
  const pool = samplePool();
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  let sir = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const pack = openPack(pool, PACK_LAYOUTS.intl, rng);
    assert.equal(pack.length, 10);
    assert.equal(new Set(pack.map((c) => c.id)).size, 10);
    sir += pack.filter((c) => c.bucket === "sir").length;
  }
  const rate = sir / N;
  assert.ok(rate > 1 / 75 && rate < 1 / 40, `SIR-Rate ${rate}`);
});

test("Booster: Erwartungswert und Bilanz", () => {
  const pool = samplePool();
  const { ev, hitChance } = expectedValue(pool, PACK_LAYOUTS.intl);
  assert.ok(ev > 1 && ev < 6, `EV ${ev}`);
  assert.ok(hitChance > 0.05 && hitChance < 0.25);
  const b = packBalance([[{ ...card("x", "sir", 60), slot: "", reverse: false, value: 60, hit: true }]], 5.49);
  assert.equal(b.profit, 54.51);
  assert.equal(b.best?.id, "x");
});

test("Booster: Gruppe ohne Seltenheit nach Preis", () => {
  assert.equal(boosterBucket(null, 3), "rare");
  assert.equal(boosterBucket(null, 0.1), "common");
  assert.equal(boosterBucket("sir", 0.1), "sir");
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
