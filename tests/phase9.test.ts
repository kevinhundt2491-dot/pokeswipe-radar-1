import { test } from "node:test";
import assert from "node:assert/strict";
import { computeValuation, tierOfCondition, trendFor, pctChange, freshnessLabel, isStale, TIER_FACTORS } from "../server/valuation-logic.ts";
import {
  extractJsonLd, extractMeta, extractSelectors, extractProduct, nextHealth, confirmTransition, reportPlausibility,
  blockBackoffMs, userAgentFor, USER_AGENTS, PAUSE_AFTER_FAILURES,
} from "../server/drops-logic.ts";
import { appleUpdateFromEvent, iosPaymentMode, iosProducts, DEFAULT_IOS_PRODUCTS } from "../server/apple-billing-logic.ts";
import { normalizeContrast, glareRatio, colorDistance, colorPenalty, colorSignature, hexDistance, isColorSig } from "../server/scan-logic.ts";

const NOW = Date.UTC(2026, 10, 16, 12);
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();
const empty = { ebayRaw: [], ebayGraded: {}, pokeswipe: [], gradeValues: {} };

// ---------------------------------------------------------------------------
// Preis-Pipeline
// ---------------------------------------------------------------------------
test("Bewertung: nur Cardmarket-Referenz → alle Rohstufen mit Abschlag, Graded bleibt leer", () => {
  const v = computeValuation({ reference: 100, referenceAt: daysAgo(0), ...empty }, NOW);
  const by = Object.fromEntries(v.map((t) => [t.tier, t]));
  assert.equal(by.nm.value, 100);
  assert.equal(by.lp.value, 100 * TIER_FACTORS.lp);
  assert.equal(by.dmg.value, 100 * TIER_FACTORS.dmg);
  assert.equal(by.nm.basis, "reference");
  assert.ok(by.nm.confidence > 0 && by.nm.confidence <= 55);
  // PSA-Preise werden nie aus dem Rohpreis geschätzt
  for (const g of ["psa8", "psa9", "psa10"]) { assert.equal(by[g].value, null); assert.equal(by[g].basis, "none"); }
});

test("Bewertung: viele PokeSwipe-Verkäufe dominieren, Ausreißer zählen kaum", () => {
  const sales = Array.from({ length: 10 }, (_, i) => ({ price: 80 + (i % 3), soldAt: daysAgo(i + 1), condition: "NM" }));
  const v = computeValuation({ reference: 100, referenceAt: daysAgo(0), ...empty, pokeswipe: sales }, NOW);
  const nm = v.find((t) => t.tier === "nm")!;
  assert.ok(nm.value! < 90 && nm.value! > 80, `NM ${nm.value}`);
  assert.ok(nm.sources.pokeswipe! > nm.sources.cardmarket!);
  assert.equal(nm.sampleSize, 10);
  // unplausibel (Faktor > 3) → Referenz bleibt bestimmend
  const crazy = computeValuation({ reference: 10, ...empty, pokeswipe: sales }, NOW).find((t) => t.tier === "nm")!;
  assert.ok(crazy.value! < 30, `Ausreißer ${crazy.value}`); // Verkäufe zählen nur mit 10 % Gewicht
});

test("Bewertung: Zustände aus Cardmarket-Kürzeln, ohne Referenz aus NM abgeleitet", () => {
  assert.equal(tierOfCondition("EX"), "lp");
  assert.equal(tierOfCondition("GD"), "mp");
  assert.equal(tierOfCondition("PL"), "hp");
  assert.equal(tierOfCondition("PO"), "dmg");
  assert.equal(tierOfCondition("M"), "nm");
  const ebay = Array.from({ length: 6 }, (_, i) => ({ price: 50, soldAt: daysAgo(i) }));
  const v = computeValuation({ reference: null, ...empty, ebayRaw: ebay }, NOW);
  const nm = v.find((t) => t.tier === "nm")!, mp = v.find((t) => t.tier === "mp")!;
  assert.equal(nm.value, 47.5); // eBay „Raw“ mit 5 % Abschlag
  assert.equal(mp.value, Math.round(47.5 * TIER_FACTORS.mp * 100) / 100);
  assert.equal(mp.sources.derived, 1);
});

test("Bewertung: Graded aus eBay-Verkäufen, sonst Angebot mit niedriger Konfidenz", () => {
  const v = computeValuation({
    reference: 20, ...empty,
    ebayGraded: { psa10: [{ price: 200, soldAt: daysAgo(3) }, { price: 220, soldAt: daysAgo(5) }, { price: 210, soldAt: daysAgo(9) }] },
    gradeValues: { psa9: { median90: null, sample90: 0, askLow: 90 } },
  }, NOW);
  const p10 = v.find((t) => t.tier === "psa10")!, p9 = v.find((t) => t.tier === "psa9")!, p8 = v.find((t) => t.tier === "psa8")!;
  assert.equal(p10.value, 210);
  assert.equal(p10.basis, "sales");
  assert.equal(p9.value, 90);
  assert.equal(p9.basis, "ask");
  assert.equal(p9.confidence, 20);
  assert.equal(p8.value, null);
});

test("Bewertung: alte Verkäufe (> 90 Tage) zählen nicht", () => {
  const v = computeValuation({ reference: 30, ...empty, pokeswipe: [{ price: 5, soldAt: daysAgo(120), condition: "NM" }] }, NOW);
  assert.equal(v.find((t) => t.tier === "nm")!.sampleSize, 0);
});

test("Trend & Aktualität: eigener Verlauf vor Cardmarket-Mittelwerten", () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(null, 100), null);
  const hist = [{ day: new Date(NOW - 7 * 86400_000).toISOString().slice(0, 10), value: 100 }];
  assert.equal(trendFor(120, hist, { avg7: 50 }, NOW).trend7, 20);
  assert.equal(trendFor(120, [], { avg7: 100, avg30: 60 }, NOW).trend30, 100);
  assert.equal(freshnessLabel(new Date(NOW - 30 * 60_000), NOW), "vor 30 Min.");
  assert.equal(isStale(new Date(NOW - 40 * 3600_000), NOW), true);
  assert.equal(isStale(new Date(NOW - 3600_000), NOW), false);
});

// ---------------------------------------------------------------------------
// Restock-Radar: gestaffelte Extraktoren & Health-Monitor
// ---------------------------------------------------------------------------
test("Extraktor 1: JSON-LD mit @graph, AggregateOffer und Preis-Formaten", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
    {"@type":"Product","name":"151 Display","offers":{"@type":"AggregateOffer","lowPrice":"1.299,99","offers":[{"@type":"Offer","availability":"https://schema.org/PreOrder","price":"179.64"}]}}]}</script>`;
  assert.deepEqual(extractJsonLd(html), { status: "preorder", price: 179.64 });
  assert.equal(extractJsonLd(`<script type="application/ld+json">{kaputt</script>`), null);
});

test("Extraktor 2: OpenGraph-/Meta-Tags in beiden Attribut-Reihenfolgen", () => {
  assert.deepEqual(extractMeta(`<meta property="product:availability" content="instock"><meta content="54,99" property="product:price:amount">`), { status: "in_stock", price: 54.99 });
  assert.deepEqual(extractMeta(`<link itemprop="availability" href="https://schema.org/OutOfStock">`), { status: "out_of_stock", price: null });
});

test("Extraktor 3: Shop-Muster (Amazon) und vorsichtiger Rückfall für unbekannte Shops", () => {
  const amazon = `<div id="availability"><span>Derzeit nicht verfügbar.</span></div><span class="a-price-whole">179<span>,</span></span><span class="a-price-fraction">64</span>`;
  assert.equal(extractSelectors(amazon, "amazon")?.status, "out_of_stock");
  // Unbekannter Shop: „In den Warenkorb“ allein reicht nie für „lieferbar“
  assert.equal(extractSelectors(`<button>In den Warenkorb</button>`, "other"), null);
  const r = extractProduct(`<div id="availability">Auf Lager.</div>`, "amazon");
  assert.equal(r.status, "in_stock");
  assert.equal(r.layer, "selector");
  assert.equal(r.confident, false);
});

test("Health-Monitor: 3 Fehlschläge in Folge → pausiert, Erfolg setzt zurück", () => {
  let fails = 0, last: any;
  for (let i = 0; i < PAUSE_AFTER_FAILURES; i++) { last = nextHealth(fails, { kind: "unreadable" }); fails = last.failCount; }
  assert.equal(last.health, "paused");
  assert.match(last.reason, /Selektor-Update nötig/);
  assert.equal(nextHealth(1, { kind: "blocked", status: 403 }).health, "degraded");
  const ok = nextHealth(2, { kind: "ok", extraction: { status: "in_stock", price: 10, layer: "jsonld", confident: true } });
  assert.deepEqual([ok.failCount, ok.health], [0, "ok"]);
  assert.equal(nextHealth(0, { kind: "ok", extraction: { status: "in_stock", price: 10, layer: "selector", confident: false } }).health, "degraded");
});

test("Unsichere Shop-Muster brauchen eine zweite Bestätigung, strukturierte Daten nicht", () => {
  const sel = { status: "in_stock" as const, price: 50, layer: "selector" as const, confident: false };
  assert.deepEqual(confirmTransition("out_of_stock", sel, null), { fire: false, pending: "in_stock" });
  assert.deepEqual(confirmTransition("out_of_stock", sel, "in_stock"), { fire: true, pending: null });
  assert.deepEqual(confirmTransition("out_of_stock", { ...sel, layer: "jsonld", confident: true }, null), { fire: true, pending: null });
  assert.equal(confirmTransition("in_stock", sel, null).fire, false);
});

test("Backoff & Browser-Kennungen bei Sperren", () => {
  assert.equal(blockBackoffMs(1), 15 * 60_000);
  assert.equal(blockBackoffMs(3), 60 * 60_000);
  assert.equal(blockBackoffMs(20), 6 * 3600_000);
  assert.equal(blockBackoffMs(1, 60_000), 5 * 60_000);
  assert.notEqual(userAgentFor(7, 0), userAgentFor(7, 1));
  assert.ok(USER_AGENTS.every((ua) => ua.startsWith("Mozilla/5.0")));
});

test("Community-Meldung: Plausibilität und Sofort-Freigabe", () => {
  const base = { url: "https://www.amazon.de/dp/B0TEST", watchShop: "amazon", price: 54.99, uvp: 54.99, trustScore: 10, admin: false };
  assert.deepEqual(reportPlausibility(base), { ok: true, instant: false, reasons: [] });
  assert.equal(reportPlausibility({ ...base, trustScore: 70 }).instant, true);
  assert.equal(reportPlausibility({ ...base, pageConfirms: true }).instant, true);
  assert.equal(reportPlausibility({ ...base, price: 9 }).ok, false); // Fake-Shop-Preis
  assert.equal(reportPlausibility({ ...base, url: "https://www.otto.de/p/x" }).ok, false); // anderer Shop
});

// ---------------------------------------------------------------------------
// Apple In-App-Kauf (RevenueCat-Webhook)
// ---------------------------------------------------------------------------
test("Apple-Abo: Kauf, Kündigung, Ablauf, fremde Stores", () => {
  const until = NOW + 30 * 86400_000;
  const buy = appleUpdateFromEvent({ type: "INITIAL_PURCHASE", store: "APP_STORE", product_id: "de.pokeswiperadar.pro.monthly", expiration_at_ms: until, original_transaction_id: "1000" }, DEFAULT_IOS_PRODUCTS, NOW);
  assert.equal(buy.kind, "active");
  if (buy.kind === "active") { assert.equal(buy.plan, "pro"); assert.equal(buy.interval, "month"); assert.equal(buy.originalTxId, "1000"); }
  assert.equal(appleUpdateFromEvent({ type: "CANCELLATION", store: "APP_STORE", expiration_at_ms: until }, DEFAULT_IOS_PRODUCTS, NOW).kind, "cancel_at_period_end");
  assert.equal(appleUpdateFromEvent({ type: "EXPIRATION", store: "APP_STORE" }, DEFAULT_IOS_PRODUCTS, NOW).kind, "expired");
  assert.equal(appleUpdateFromEvent({ type: "INITIAL_PURCHASE", store: "PLAY_STORE" }, DEFAULT_IOS_PRODUCTS, NOW).kind, "ignore");
  assert.equal(appleUpdateFromEvent({ type: "INITIAL_PURCHASE", store: "APP_STORE", product_id: "fremd", expiration_at_ms: until }, DEFAULT_IOS_PRODUCTS, NOW).kind, "ignore");
  assert.equal(appleUpdateFromEvent({ type: "RENEWAL", store: "APP_STORE", product_id: "de.pokeswiperadar.premium.yearly", expiration_at_ms: NOW - 1 }, DEFAULT_IOS_PRODUCTS, NOW).kind, "expired");
});

test("Zahlungs-Weiche iOS: In-App-Kauf nur mit RevenueCat-Schlüssel, EU-Extern nur mit Freigabe", () => {
  assert.equal(iosPaymentMode({}), "none");
  assert.equal(iosPaymentMode({ IOS_EXTERNAL_PURCHASE_EU: "1" }), "external");
  assert.equal(iosPaymentMode({ REVENUECAT_IOS_API_KEY: "appl_abcdefghijklmnop" }), "iap");
  assert.equal(iosPaymentMode({ REVENUECAT_IOS_API_KEY: "sk_secret" }), "none");
  assert.deepEqual(Object.keys(iosProducts('{"x.pro.m":{"plan":"pro","interval":"month"},"bad id!":{"plan":"pro"}}')), ["x.pro.m"]);
  assert.equal(Object.keys(iosProducts("kein json")).length, 4);
});

// ---------------------------------------------------------------------------
// Hybrid-Scanner: Vorverarbeitung & Farb-Signatur
// ---------------------------------------------------------------------------
test("Scanner: Kontrast-Normalisierung, Spiegelungs-Anteil, Hamming-Abstand", () => {
  const d = new Float32Array(100);
  for (let i = 0; i < 100; i++) d[i] = 100 + (i % 20); // flaues Bild 100…119
  const n = normalizeContrast({ w: 10, h: 10, d });
  assert.ok(Math.max(...n.d) >= 250 && Math.min(...n.d) <= 5);
  const glare = new Float32Array(100).fill(120); glare.fill(255, 0, 10);
  assert.equal(glareRatio({ w: 10, h: 10, d: glare }), 0.1);
  assert.equal(hexDistance("0000000000000000", "000000000000000f"), 4);
  assert.equal(hexDistance("xyz", "0000000000000000"), null);
});

test("Scanner: Farb-Signatur unterscheidet Motive, gleiche Farben ohne Zuschlag", () => {
  const W = 63, H = 88;
  const paint = (r: number, g: number, b: number) => { const a = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) a.set([r, g, b, 255], i * 4); return a; };
  const corners: [number, number][] = [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]];
  const red = colorSignature(paint(220, 30, 30), W, H, corners), red2 = colorSignature(paint(210, 40, 35), W, H, corners);
  const blue = colorSignature(paint(30, 40, 220), W, H, corners);
  assert.ok(isColorSig(red));
  assert.equal(colorPenalty(colorDistance(red, red2)), 0);
  assert.ok(colorPenalty(colorDistance(red, blue)) > 0);
  assert.equal(colorDistance(red, "ungueltig"), 0);
});
