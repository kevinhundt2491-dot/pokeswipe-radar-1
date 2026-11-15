import { test } from "node:test";
import assert from "node:assert/strict";
import { moderateText, trustScore, trustLevel, writeLimits, profileSlug, valueTier, extractLinks } from "../server/community-logic.ts";
import { feeFor, nextStatus, validOffer, validTracking, trackingUrl, MARKET_MIN_FEE_CENTS } from "../server/market-logic.ts";
import { composeCardFan, encodeJpeg, decodeJpeg, OG_W, OG_H } from "../server/og-image.ts";

test("Wortfilter blockiert Beleidigungen auch mit Ersatzzeichen", () => {
  assert.equal(moderateText("du hurens0hn", { trust: 90 }).action, "block");
  assert.equal(moderateText("F1ck dich", { trust: 90 }).action, "block");
  assert.equal(moderateText("Was für ein Glurak-Pull! 🔥", { trust: 0 }).action, "ok");
  // kein Fehlalarm bei normalen Wörtern
  assert.equal(moderateText("Die Opferanode im Aquarium und Mongolei-Urlaub", { trust: 0 }).action, "ok");
});

test("Link-Filter: Kurzlinks immer gesperrt, fremde Links abhängig vom Vertrauen", () => {
  assert.equal(moderateText("schau hier bit.ly/abc", { trust: 100 }).action, "block");
  assert.equal(moderateText("join t.me/fakeshop", { trust: 100 }).action, "block");
  assert.equal(moderateText("https://example.com/shop", { trust: 10 }).action, "block");
  assert.equal(moderateText("https://example.com/shop", { trust: 50 }).action, "review");
  assert.equal(moderateText("https://example.com/shop", { trust: 85 }).action, "ok");
  assert.equal(moderateText("Preis auf https://www.cardmarket.com/de/Pokemon", { trust: 0 }).action, "ok");
  assert.deepEqual(extractLinks("siehe pokeswipe-radar.de/karte/x."), ["pokeswipe-radar.de/karte/x"]);
});

test("Betrugsmuster und Spam", () => {
  assert.equal(moderateText("Zahlung nur per PayPal Freunde und Familie", { trust: 20 }).action, "block");
  assert.equal(moderateText("schreib mir auf whatsapp 0176 12345678", { trust: 20 }).action, "block");
  assert.equal(moderateText("DAS IST DER BESTE PULL ALLER ZEITEN", { trust: 50 }).action, "block");
  assert.equal(moderateText("aaaaaaaaaaaaaaaa", { trust: 50 }).action, "block");
  assert.equal(moderateText("Hallo zusammen", { trust: 50, recent: ["hallo zusammen!"] }).action, "block");
});

test("Trust-Score und Stufen", () => {
  const fresh = trustScore({ confirmed: false, accountAgeDays: 0, completedDeals: 0, ratingAvg: 0, ratingCount: 0, paidPlan: false, verifiedSeller: false, upheldReports: 0, mutes: 0 });
  assert.equal(fresh, 0);
  assert.equal(trustLevel(fresh).key, "new");
  const veteran = trustScore({ confirmed: true, accountAgeDays: 400, completedDeals: 20, ratingAvg: 4.9, ratingCount: 12, paidPlan: true, verifiedSeller: true, upheldReports: 0, mutes: 0 });
  assert.equal(veteran, 100);
  assert.equal(trustLevel(veteran).key, "top");
  const troll = trustScore({ confirmed: true, accountAgeDays: 400, completedDeals: 20, ratingAvg: 4.9, ratingCount: 12, paidPlan: true, verifiedSeller: true, upheldReports: 4, mutes: 2 });
  assert.ok(troll < 30);
  assert.equal(trustScore({ confirmed: true, accountAgeDays: 400, completedDeals: 9, ratingAvg: 5, ratingCount: 9, paidPlan: true, verifiedSeller: true, upheldReports: 0, mutes: 0, banned: true }), 0);
  assert.ok(writeLimits(0, "chat").perMinute < writeLimits(90, "chat").perMinute);
});

test("Profil-Slug und Wert-Stufe", () => {
  assert.equal(profileSlug("@GlurakKing"), "glurakking");
  assert.equal(valueTier(30), null);
  assert.equal(valueTier(1200)?.label, "1.000 €+");
});

test("Provision: Pro-Pass zahlt weniger, Mindestgebühr greift", () => {
  const free = feeFor("free", 10_000, 500), pro = feeFor("pro", 10_000, 500);
  assert.equal(free.feeCents, 650);
  assert.equal(pro.feeCents, 300);
  assert.equal(pro.totalCents, 10_500);
  assert.equal(pro.payoutCents, 10_200);
  assert.equal(feeFor("pro", 200).feeCents, MARKET_MIN_FEE_CENTS);
});

test("Treuhand-Zustände", () => {
  assert.equal(nextStatus("seller", "accept", "offered"), "awaiting_payment");
  assert.equal(nextStatus("buyer", "accept", "offered"), null);
  assert.equal(nextStatus("seller", "ship", "paid"), "shipped");
  assert.equal(nextStatus("buyer", "confirm", "shipped"), "released");
  assert.equal(nextStatus("buyer", "dispute", "released"), null);
  assert.equal(nextStatus("system", "release", "disputed"), null); // Reklamation stoppt die automatische Auszahlung
  assert.equal(nextStatus("admin", "refund", "disputed"), "refunded");
  assert.equal(nextStatus("buyer", "cancel", "paid"), null); // nach Zahlung nur über Reklamation
  assert.ok(validOffer(10_000, 6_000));
  assert.ok(!validOffer(10_000, 4_000));
  assert.ok(!validOffer(10_000, 12_000));
  assert.ok(validTracking("00340434161094015902"));
  assert.ok(!validTracking("12 3"));
  assert.match(trackingUrl("dhl", "123456"), /dhl\.de/);
});

test("Vorschaubild: Kartenfächer wird als JPEG 1200×630 erzeugt", () => {
  const card = { width: 40, height: 56, data: new Uint8Array(40 * 56 * 4).fill(200) };
  const rgba = composeCardFan([card, card, card]);
  assert.equal(rgba.length, OG_W * OG_H * 4);
  // Bildmitte ist von einer Karte bedeckt (hell), Ecke bleibt dunkler Hintergrund
  const mid = (Math.round(OG_H / 2) * OG_W + OG_W / 2) * 4;
  assert.ok(rgba[mid] > 150);
  assert.ok(rgba[0] < 60);
  const jpg = encodeJpeg(rgba);
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  const back = decodeJpeg(jpg);
  assert.equal(back?.width, OG_W);
  assert.equal(encodeJpeg(composeCardFan([])).length > 1000, true);
});
