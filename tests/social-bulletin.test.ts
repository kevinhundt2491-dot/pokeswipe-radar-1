import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCategory, normalizeIntent, cardPinMeta, radarMatch, friendState, parseMeetup, meetupText,
} from "../server/social-logic.ts";
import { writeLimits } from "../server/community-logic.ts";

const viewer = (o: { qty?: Record<string, number>; wish?: string[]; sets?: string[] } = {}) => ({
  qty: new Map(Object.entries(o.qty || {})), wishlist: new Set(o.wish || []), sets: new Set(o.sets || []),
});

test("Schwarzes Brett: Kategorien & Absicht werden normalisiert", () => {
  assert.equal(normalizeCategory("trade"), "trade");
  assert.equal(normalizeCategory("talk"), "talk");
  assert.equal(normalizeCategory("<script>"), "pull");
  assert.equal(normalizeCategory(undefined, "trade"), "trade");
  assert.equal(normalizeIntent("offer"), "offer");
  assert.equal(normalizeIntent("seek"), "seek");
  assert.equal(normalizeIntent("sell"), null);
});

test("Karten-Pin: nur bekannte Felder, sichere Bild-URL, gekürzte Texte", () => {
  const m = cardPinMeta({ name: "x".repeat(300), image: "javascript:alert(1)", portfolioItemId: -3 as any, cardId: "sv03.5-199" });
  assert.equal(m.name.length, 120);
  assert.equal(m.image, "");
  assert.equal(m.portfolioItemId, null);
  assert.equal(m.condition, "NM");
  assert.equal(cardPinMeta({ image: "https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp" }).image.startsWith("https://"), true);
  assert.equal(cardPinMeta({ image: "/api/images/abc" }).image, "/api/images/abc");
});

test("⚡ PokeSwipe-Match: gesuchte Karte doppelt im Binder → „Du hast diese Karte“", () => {
  const pin = { intent: "seek" as const, cardId: "sv03.5-199", setId: "sv03.5" };
  assert.equal(radarMatch(pin, viewer({ qty: { "sv03.5-199": 2 } }))?.kind, "have");
  assert.match(radarMatch(pin, viewer({ qty: { "sv03.5-199": 3 } }))!.label, /3×/);
  // nur einmal vorhanden → kein Match (wird nicht doppelt getauscht)
  assert.equal(radarMatch(pin, viewer({ qty: { "sv03.5-199": 1 } })), null);
});

test("⚡ PokeSwipe-Match: angebotene Karte fehlt im Set bzw. steht auf der Wunschliste → „Du suchst diese Karte“", () => {
  const pin = { intent: "offer" as const, cardId: "sv03.5-199", setId: "sv03.5" };
  assert.equal(radarMatch(pin, viewer({ wish: ["sv03.5-199"] }))?.kind, "seek");
  assert.match(radarMatch(pin, viewer({ sets: ["sv03.5"] }))!.label, /Set/);
  // schon im Binder → kein Match; fremdes Set → kein Match
  assert.equal(radarMatch(pin, viewer({ sets: ["sv03.5"], qty: { "sv03.5-199": 1 } })), null);
  assert.equal(radarMatch(pin, viewer({ sets: ["sv01"] })), null);
});

test("⚡ PokeSwipe-Match: nie für eigene Beiträge, Gäste oder Beiträge ohne Karte", () => {
  const pin = { intent: "seek" as const, cardId: "a-1", setId: "a" };
  assert.equal(radarMatch(pin, viewer({ qty: { "a-1": 5 } }), true), null);
  assert.equal(radarMatch(pin, null), null);
  assert.equal(radarMatch({ intent: null, cardId: "a-1", setId: "a" }, viewer({ qty: { "a-1": 5 } })), null);
});

test("Freundschaften: Status aus Sicht beider Seiten", () => {
  const row = { requesterId: "a", addresseeId: "b", status: "pending" };
  assert.equal(friendState(row, "a"), "pending_out");
  assert.equal(friendState(row, "b"), "pending_in");
  assert.equal(friendState({ ...row, status: "accepted" }, "b"), "friends");
  assert.equal(friendState({ ...row, status: "declined" }, "a"), "none");
  assert.equal(friendState(null, "a"), "none");
});

test("Treffen-Planer: Ort, Datum & Uhrzeit werden geprüft", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const ok = parseMeetup({ place: "Cardshow Köln", kind: "cardshow", date: "2026-11-28", time: "14:30", note: "Halle 2" }, now);
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.status, "proposed");
    assert.equal(meetupText(ok), "🎪 Cardshow: Cardshow Köln am 28.11.2026 um 14:30 Uhr");
  }
  assert.ok("error" in parseMeetup({ place: "x", date: "2026-11-28", time: "14:30" }, now));
  assert.ok("error" in parseMeetup({ place: "Flohmarkt", date: "2026-11-01", time: "14:30" }, now)); // Vergangenheit
  assert.ok("error" in parseMeetup({ place: "Flohmarkt", date: "2026-02-30", time: "14:30" }, now)); // ungültig
  assert.ok("error" in parseMeetup({ place: "Flohmarkt", date: "2028-01-01", time: "14:30" }, now)); // > 12 Monate
  assert.ok("error" in parseMeetup({ place: "Flohmarkt", date: "2026-11-20", time: "25:00" }, now));
  const unknownKind = parseMeetup({ place: "Café am Markt", kind: "evil", date: "2026-11-18", time: "09:05" }, now);
  assert.ok(!("error" in unknownKind) && unknownKind.kind === "local");
});

test("1:1-Chat: eigene Schreib-Limits je Vertrauensstufe", () => {
  assert.deepEqual(writeLimits(0, "dm"), { perMinute: 6, perHour: 60 });
  assert.ok(writeLimits(100, "dm").perHour > writeLimits(0, "dm").perHour);
});
