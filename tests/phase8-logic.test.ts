// Phase 8: Preise nach Zustand & Sold Comps, Warenkorb-Optimierer, DHL-Versandetiketten, Fehler-Alarm
import { test } from "node:test";
import assert from "node:assert/strict";
import { marketCondition, atLeastCondition, summarizeCondition, conditionTable, observedDiscount, compsFromOrder } from "../server/condition-logic.ts";
import { optimizeCart, assignmentCost, offerMatches, type OptNeed, type OptOffer } from "../server/cart-logic.ts";
import {
  splitStreet, validateShippingAccount, billingNumber, consigneeFromAddress, chooseProduct, buildShipmentRequest, parseShipmentResponse,
} from "../server/shipping-logic.ts";
import { spikeAlerts, staleJobAlerts, webhookAlert, alertDue, cleanClientError, thresholdFor } from "../server/alerts-logic.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400_000);

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
test("Zustand: Normalisierung und Rangfolge", () => {
  assert.equal(marketCondition("NM"), "nm");
  assert.equal(marketCondition("Near Mint"), "nm");
  assert.equal(marketCondition("light_played"), "lp");
  assert.equal(marketCondition("graded"), null);
  assert.equal(marketCondition(""), null);
  assert.ok(atLeastCondition("mint", "nm"));
  assert.ok(atLeastCondition("nm", "nm"));
  assert.ok(!atLeastCondition("lp", "ex"));
});

test("Zustandswert: Referenz ohne Verkäufe, Mischung bei wenigen, Median ab 3 Verkäufen", () => {
  const ref = summarizeCondition("ex", [], [], 100, NOW);
  assert.equal(ref.value, 85); assert.equal(ref.valueSource, "reference");
  const one = summarizeCondition("ex", [{ price: 70, soldAt: daysAgo(3) }], [], 100, NOW);
  assert.equal(one.valueSource, "blend");
  assert.equal(one.value, Math.round((70 / 3 + 85 * 2 / 3) * 100) / 100);
  const many = summarizeCondition("ex", [70, 72, 74].map((p, i) => ({ price: p, soldAt: daysAgo(i + 1) })), [{ price: 90 }, { price: 80 }], 100, NOW);
  assert.equal(many.valueSource, "sales"); assert.equal(many.value, 72);
  assert.equal(many.lastSoldPrice, 70); assert.equal(many.askLow, 80); assert.equal(many.askCount, 2);
  // Verkäufe älter als 90 Tage zählen nicht
  const old = summarizeCondition("nm", [{ price: 50, soldAt: daysAgo(120) }], [], null, NOW);
  assert.equal(old.soldCount90, 0); assert.equal(old.valueSource, "none");
});

test("Zustandstabelle und beobachteter Abschlag", () => {
  const sales = [
    ...[100, 102, 98].map((p) => ({ price: p, soldAt: daysAgo(2), condition: "nm" })),
    ...[60, 62, 58].map((p) => ({ price: p, soldAt: daysAgo(2), condition: "LP" })),
  ];
  const t = conditionTable(sales, [], 100, NOW);
  assert.ok(t.find((r) => r.condition === "nm"));
  assert.equal(t.find((r) => r.condition === "lp")!.value, 60);
  assert.deepEqual(observedDiscount(t), { lp: 0.6 });
  // ohne Referenz und Daten bleibt nur die NM-Zeile
  assert.deepEqual(conditionTable([], [], null, NOW).map((r) => r.condition), ["nm"]);
});

test("Sold Comps aus einer Bestellung: Versand anteilig, Slabs übersprungen, Ziel nach Art", () => {
  const comps = compsFromOrder({ id: 7, shippingCents: 300, releasedAt: NOW }, [
    { itemKey: "1", cardId: "sv03.5-199", title: "Glurak", variant: "normal", condition: "nm", lang: "de", quantity: 2, unitCents: 1000 },
    { itemKey: "2", cardId: "base1-4", title: "Slab", variant: "holo", condition: "graded", lang: "en", quantity: 1, unitCents: 50000 },
    { itemKey: "3", cardId: null, printId: "ja:SV2a-201", title: "JP", variant: "rh", condition: "EX", lang: "ja", quantity: 1, unitCents: 2000 },
  ], "https://x.de");
  assert.equal(comps.length, 2);
  assert.equal(comps[0].price, "10.75"); // 10 € + 300 ct / 4 Stück der Sendung
  assert.equal(comps[0].targetKind, "card"); assert.equal(comps[0].externalId, "ps:7:1"); assert.equal(comps[0].url, "https://x.de/karte/sv03.5-199");
  assert.equal(comps[1].targetKind, "print"); assert.equal(comps[1].variant, "reverse_holo"); assert.equal(comps[1].condition, "ex");
});

// ---------------------------------------------------------------------------
// Warenkorb-Optimierer
// ---------------------------------------------------------------------------
const offer = (o: Partial<OptOffer>): OptOffer => ({
  listingId: 1, sellerId: "a", sellerName: "A", cardId: "c1", variant: "normal", lang: "de", condition: "nm", unitCents: 1000, shippingCents: 150, available: 1, ...o,
});
const need = (o: Partial<OptNeed>): OptNeed => ({ key: "1", cardId: "c1", variant: "normal", lang: "de", minCondition: "nm", quantity: 1, currentListingId: 1, title: "K", ...o });

test("Optimierer: Bündeln bei einem Verkäufer spart Versand", () => {
  const offers = [
    offer({ listingId: 1, sellerId: "a", cardId: "c1", unitCents: 1000, shippingCents: 400 }),
    offer({ listingId: 2, sellerId: "b", cardId: "c2", unitCents: 1000, shippingCents: 400 }),
    offer({ listingId: 3, sellerId: "b", cardId: "c1", unitCents: 1050, shippingCents: 400 }),
  ];
  const needs = [need({ key: "1", cardId: "c1", currentListingId: 1 }), need({ key: "2", cardId: "c2", currentListingId: 2 })];
  const r = optimizeCart(needs, offers);
  assert.equal(r.current!.totalCents, 2800);
  assert.equal(r.best!.totalCents, 2450);
  assert.equal(r.savingsCents, 350);
  assert.deepEqual(r.changed, ["1"]);
  assert.deepEqual(r.assignment["1"], [{ listingId: 3, quantity: 1 }]);
});

test("Optimierer: nie teurer als der aktuelle Warenkorb, Zustand und Variante werden respektiert", () => {
  const offers = [
    offer({ listingId: 1, unitCents: 1000 }),
    offer({ listingId: 2, sellerId: "b", unitCents: 100, condition: "lp" }),
    offer({ listingId: 3, sellerId: "c", unitCents: 100, variant: "reverse_holo" }),
    offer({ listingId: 4, sellerId: "d", unitCents: 100, lang: "en" }),
  ];
  const r = optimizeCart([need({})], offers);
  assert.equal(r.savingsCents, 0);
  assert.deepEqual(r.changed, []);
  // besserer Zustand ist erlaubt, mit sameCondition nicht
  const better = [offer({ listingId: 1, unitCents: 1000 }), offer({ listingId: 5, sellerId: "e", unitCents: 500, condition: "mint" })];
  assert.equal(optimizeCart([need({})], better).savingsCents, 500);
  assert.equal(optimizeCart([need({})], better, { sameCondition: true }).savingsCents, 0);
  assert.ok(!offerMatches(need({ minCondition: "graded" }), offer({ listingId: 9, condition: "graded" })));
});

test("Optimierer: Mengen werden über mehrere Angebote verteilt, Bestand wird eingehalten", () => {
  const offers = [
    offer({ listingId: 1, sellerId: "a", unitCents: 1000, available: 3, shippingCents: 0 }),
    offer({ listingId: 2, sellerId: "b", unitCents: 500, available: 2, shippingCents: 0 }),
  ];
  const r = optimizeCart([need({ quantity: 3 })], offers);
  assert.equal(r.best!.totalCents, 2000);
  const cost = assignmentCost([need({ quantity: 3 })], new Map(offers.map((o) => [o.listingId, o])), { "1": [{ listingId: 2, quantity: 3 }] });
  assert.equal(cost, null);
});

// ---------------------------------------------------------------------------
// DHL
// ---------------------------------------------------------------------------
test("DHL: Straße/Hausnummer trennen", () => {
  assert.deepEqual(splitStreet("Musterstraße 12a"), { street: "Musterstraße", house: "12a" });
  assert.deepEqual(splitStreet("Am Ring 3-5"), { street: "Am Ring", house: "3-5" });
  assert.deepEqual(splitStreet("12 rue de la Paix"), { street: "rue de la Paix", house: "12" });
  assert.deepEqual(splitStreet("Postfach"), { street: "Postfach", house: "" });
});

test("DHL: Zugangsdaten prüfen", () => {
  const base = { username: "u", password: "p", ekp: "1234567890", senderName: "Max", senderStreet: "Weg", senderZip: "50667", senderCity: "Köln" };
  assert.ok(validateShippingAccount(base, true).ok);
  assert.ok(!validateShippingAccount({ ...base, ekp: "123" }, true).ok);
  assert.ok(!validateShippingAccount({ ...base, password: "" }, true).ok);
  const keep = validateShippingAccount({ ...base, password: "" }, false);
  assert.ok(keep.ok && keep.value.password === null);
  assert.ok(!validateShippingAccount({ ...base, senderZip: "1234" }, true).ok);
  assert.equal(billingNumber("1234567890", "V62KP", { V62KP: "02" }), "12345678906202");
});

test("DHL: Empfänger, Produktwahl, Anfrage und Antwort", () => {
  const c = consigneeFromAddress(JSON.stringify({ name: "Eva", line1: "Hauptstr. 5", postal_code: "10115", city: "Berlin", country: "DE" }));
  assert.ok(c.ok && c.value.country === "DEU" && c.value.addressHouse === "5");
  assert.ok(!consigneeFromAddress(null).ok);
  assert.ok(!consigneeFromAddress(JSON.stringify({ name: "X", line1: "a 1", postal_code: "1", city: "y", country: "US" })).ok);
  assert.deepEqual(chooseProduct(undefined, "DEU", 300), { ok: true, product: "V62KP" });
  assert.deepEqual(chooseProduct(undefined, "DEU", 2000), { ok: true, product: "V01PAK" });
  assert.deepEqual(chooseProduct(undefined, "FRA", 300), { ok: true, product: "V66WPI" });
  assert.ok(!chooseProduct("V62KP", "FRA", 300).ok);
  assert.ok(!chooseProduct("V62KP", "DEU", 5000).ok);
  assert.ok(!chooseProduct(undefined, "CHE", 300).ok);
  const req = buildShipmentRequest({ product: "V62KP", billingNumber: "12345678906201", refNo: "PS-1", weightG: 300,
    shipper: { name: "M", street: "W", house: "1", zip: "50667", city: "K", country: "DEU" }, consignee: (c as any).value });
  assert.equal(req.shipments[0].refNo.length >= 8, true);
  assert.equal(req.shipments[0].details.weight.value, 300);
  const ok = parseShipmentResponse(200, { items: [{ shipmentNo: "00340434161094000000", sstatus: { statusCode: 200 }, label: { b64: "JVBERi0=" } }] });
  assert.ok(ok.ok && ok.shipmentNo === "00340434161094000000");
  const bad = parseShipmentResponse(400, { items: [{ sstatus: { statusCode: 400 }, validationMessages: [{ property: "consignee.postalCode", validationMessage: "ungültig" }] }] });
  assert.ok(!bad.ok && bad.error.includes("postalCode"));
  const auth = parseShipmentResponse(401, {});
  assert.ok(!auth.ok && auth.status === 401);
});

// ---------------------------------------------------------------------------
// Fehler-Alarm
// ---------------------------------------------------------------------------
test("Alarm: Schwellen, Spitzen, kritische Bereiche", () => {
  assert.equal(thresholdFor("stripe-webhook"), 1);
  assert.equal(thresholdFor("client"), 25);
  assert.equal(thresholdFor("search"), 10);
  const a = spikeAlerts([
    { scope: "market", count: 1, lastMessage: "x" }, { scope: "search", count: 3, lastMessage: "y" },
    { scope: "job:price-tracker", count: 50, lastMessage: "z" }, { scope: "alert:foo", count: 9, lastMessage: "" },
  ]);
  assert.deepEqual(a.map((x) => x.key), ["spike:market"]);
  assert.equal(a[0].severity, "critical");
});

test("Alarm: überfällige Jobs, Webhook-Fehler, Ruhezeit", () => {
  const now = NOW.getTime();
  const s = staleJobAlerts([
    { name: "market-escrow", lastRunAt: new Date(now - 60 * 60_000), lastStatus: "ok" },
    { name: "price-tracker", lastRunAt: new Date(now - 90 * 60_000), lastStatus: "ok" },
    { name: "unbekannt", lastRunAt: new Date(0), lastStatus: "ok" },
  ], now);
  assert.deepEqual(s.map((x) => x.key), ["stale:market-escrow"]);
  assert.ok(webhookAlert({ lastEventAt: daysAgo(1).toISOString(), lastErrorAt: new Date(now - 3600_000).toISOString(), lastError: "500" }, now));
  assert.equal(webhookAlert({ lastEventAt: new Date(now - 60_000).toISOString(), lastErrorAt: new Date(now - 3600_000).toISOString(), lastError: "500" }, now), null);
  assert.equal(webhookAlert(null, now), null);
  assert.ok(alertDue(null, 1000, now));
  assert.ok(!alertDue(new Date(now - 500), 1000, now));
});

test("Alarm: Browser-Fehler bereinigen (Rauschen, Query-Parameter)", () => {
  assert.equal(cleanClientError({ message: "ResizeObserver loop limit exceeded" }), null);
  assert.equal(cleanClientError({ message: "x", stack: "at chrome-extension://abc" }), null);
  const e = cleanClientError({ message: "TypeError: a is undefined", url: "https://pokeswipe-radar.de/?token=geheim&x=1", line: "12", kind: "foo" });
  assert.equal(e!.url, "https://pokeswipe-radar.de/");
  assert.equal(e!.line, 12); assert.equal(e!.kind, "error");
});
