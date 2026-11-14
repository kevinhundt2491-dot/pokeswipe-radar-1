import { test } from "node:test";
import assert from "node:assert/strict";
import { effectivePlan, PLANS } from "../server/plans.ts";
import { money, str, int } from "../server/util.ts";
import { earnedBadges, nextStreak, gradingEstimate, weeklySummary, berlinDay } from "../server/logic.ts";
// @ts-ignore – Client-Modul ohne Typen
import { csvToRows, parseCsv } from "../client/csv.js";

const day = 86400_000;

test("Tarif: bezahlter Plan gilt bis Laufzeitende plus 1 Tag Kulanz", () => {
  assert.equal(effectivePlan({ plan: "pro", planUntil: new Date(Date.now() + day) }), "pro");
  assert.equal(effectivePlan({ plan: "pro", planUntil: new Date(Date.now() - day / 2) }), "pro");
  assert.equal(effectivePlan({ plan: "pro", planUntil: new Date(Date.now() - 2 * day) }), "free");
  assert.equal(effectivePlan({ plan: "unbekannt", planUntil: new Date(Date.now() + day) }), "free");
  assert.equal(effectivePlan(null), "free");
});

test("Tarif: Gratismonat aus Empfehlung ergibt Premium", () => {
  assert.equal(effectivePlan({ plan: "free", planUntil: null, bonusUntil: new Date(Date.now() + day) }), "premium");
  assert.equal(effectivePlan({ plan: "free", planUntil: null, bonusUntil: new Date(Date.now() - day) }), "free");
});

test("Tarif: Jahresabo ist günstiger als 12 Monate und Limits steigen", () => {
  for (const id of ["premium", "pro"] as const) assert.ok(PLANS[id].yearlyPriceCents < PLANS[id].priceCents * 12);
  assert.ok(PLANS.free.portfolio < PLANS.premium.portfolio && PLANS.premium.portfolio < PLANS.pro.portfolio);
  assert.ok(PLANS.free.wishlist < PLANS.premium.wishlist);
});

test("Eingaben: Geldbeträge, Text und Zahlen werden begrenzt", () => {
  assert.equal(money("12,5"), "12.50");
  assert.equal(money(-1), null);
  assert.equal(money("abc"), null);
  assert.equal(money(200_000), null);
  assert.equal(str("  hallo\u0000welt  ", 5), "hallo");
  assert.equal(int("999999", 1, 999, 1), 999);
  assert.equal(int("x", 1, 999, 7), 7);
});

test("Serie: zählt aufeinanderfolgende Tage, startet sonst neu", () => {
  assert.deepEqual(nextStreak(null, 0, "2026-11-12"), { streak: 1, changed: true });
  assert.deepEqual(nextStreak("2026-11-11", 4, "2026-11-12"), { streak: 5, changed: true });
  assert.deepEqual(nextStreak("2026-11-12", 4, "2026-11-12"), { streak: 4, changed: false });
  assert.deepEqual(nextStreak("2026-11-09", 4, "2026-11-12"), { streak: 1, changed: true });
  assert.deepEqual(nextStreak("2026-12-31", 9, "2027-01-01"), { streak: 10, changed: true });
  assert.match(berlinDay(new Date("2026-11-11T23:30:00Z")), /^2026-11-12$/);
});

test("Abzeichen: werden nach Regeln vergeben", () => {
  const base = { portfolioCount: 0, portfolioValue: 0, completedTrades: 0, bestStreak: 0, scans: 0, wishlistCount: 0, referralsRewarded: 0, reviewsAvg: 0, reviewsCount: 0 };
  assert.deepEqual(earnedBadges(base), []);
  const b = earnedBadges({ ...base, portfolioCount: 60, portfolioValue: 1500, bestStreak: 7, reviewsCount: 6, reviewsAvg: 4.8 });
  for (const id of ["first-card", "collector-50", "value-100", "value-1000", "streak-3", "streak-7", "trusted"]) assert.ok(b.includes(id), id);
  assert.ok(!b.includes("value-10000"));
  assert.ok(!earnedBadges({ ...base, reviewsCount: 6, reviewsAvg: 4.2 }).includes("trusted"));
});

test("Grading-Rechner: Erwartungswert und Gewinnschwelle", () => {
  const r = gradingEstimate({ raw: 50, psa10: 200, psa9: 80, p10: 50, p9: 30, fee: 25, shipping: 5 });
  assert.equal(r.expected.toFixed(2), (0.5 * 200 + 0.3 * 80 + 0.2 * 50).toFixed(2));
  assert.equal(r.cost, 30);
  assert.ok(r.worth);
  // Bei der Gewinnschwelle ist der Gewinn 0
  const be = r.breakEven10!;
  const atBe = gradingEstimate({ raw: 50, psa10: 200, psa9: 80, p10: be, p9: 30, fee: 25, shipping: 5 });
  assert.ok(Math.abs(atBe.profit) < 0.01);
  assert.equal(gradingEstimate({ raw: 50, psa10: 55, psa9: 40, p10: 10, p9: 40, fee: 25, shipping: 5 }).worth, false);
});

test("Wochen-Report: Text mit Veränderung und Top-Mover", () => {
  assert.equal(weeklySummary({ value: 110, valueWeekAgo: 100, top: { name: "Glurak ex", change: 12.34 } }),
    "Dein Portfolio: 110,00 € (+10,0 % zur Vorwoche). Top-Mover: Glurak ex +12,3 %.");
  assert.equal(weeklySummary({ value: 50, valueWeekAgo: null }), "Dein Portfolio ist 50,00 € wert.");
});

test("CSV: Cardmarket-ähnlicher Export mit Semikolon und Komma-Preisen", () => {
  const rows = csvToRows('﻿Name;Expansion;Number;Count;Purchase Price\n"Glurak ex";"151";"199/165";2;"89,90 €"\nPikachu;Basis;58;1;\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: "Glurak ex", number: "199/165", set: "151", quantity: 2, purchasePrice: 89.9 });
  assert.equal(rows[1].purchasePrice, null);
});

test("CSV: Komma-getrennt, Anführungszeichen und deutsche Spalten", () => {
  const rows = csvToRows('Karte,Set,Nr,Anzahl,Einkaufspreis\n"Mew ""Promo""",Promo,151,3,1.234,50\n');
  assert.equal(rows[0].name, 'Mew "Promo"');
  assert.equal(rows[0].quantity, 3);
  assert.equal(parseCsv("a;b\n\n c ; d \n").length, 2);
});

test("CSV: einfache Liste ohne Kopfzeile", () => {
  const rows = csvToRows("Glurak ex 199/165\nMewtu\n");
  assert.deepEqual(rows.map((r: any) => [r.name, r.number]), [["Glurak ex", "199/165"], ["Mewtu", ""]]);
});
