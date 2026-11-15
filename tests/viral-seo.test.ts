import { test } from "node:test";
import assert from "node:assert/strict";
import { effectivePlan, REFERRAL_MILESTONES } from "../server/plans.ts";
import { baseSpeciesName, validShareTarget, earnedBadges } from "../server/logic.ts";

const day = 86400_000;

test("Bonus: Pro-Bonus hebt Premium-Abonnenten auf Pro, Premium-Bonus senkt Pro nicht", () => {
  const until = new Date(Date.now() + 10 * day);
  assert.equal(effectivePlan({ plan: "premium", planUntil: until, bonusUntil: until, bonusPlan: "pro" }), "pro");
  assert.equal(effectivePlan({ plan: "pro", planUntil: until, bonusUntil: until, bonusPlan: "premium" }), "pro");
  assert.equal(effectivePlan({ plan: "free", planUntil: null, bonusUntil: until }), "premium");
  assert.equal(effectivePlan({ plan: "free", planUntil: null, bonusUntil: new Date(Date.now() - day), bonusPlan: "pro" }), "free");
});

test("Empfehlungs-Stufen sind aufsteigend und eindeutig", () => {
  const counts = REFERRAL_MILESTONES.map((m) => m.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.equal(new Set(REFERRAL_MILESTONES.map((m) => m.kind)).size, REFERRAL_MILESTONES.length);
});

test("Pokémon-Grundname aus Kartennamen", () => {
  assert.equal(baseSpeciesName("Glurak-ex"), "Glurak");
  assert.equal(baseSpeciesName("Mega-Glurak X ex"), "Glurak");
  assert.equal(baseSpeciesName("Pikachu VMAX"), "Pikachu");
  assert.equal(baseSpeciesName("Alola-Vulpix"), "Vulpix");
  assert.equal(baseSpeciesName("Mewtu"), "Mewtu");
});

test("Teilen-Ziele: nur eigene öffentliche Pfade", () => {
  assert.ok(validShareTarget("/karte/sv03.5-199/glurak-ex"));
  assert.ok(validShareTarget("/einladung/ABCD1234"));
  assert.ok(validShareTarget("/trends"));
  assert.ok(!validShareTarget("https://evil.example"));
  assert.ok(!validShareTarget("//evil.example/x"));
  assert.ok(!validShareTarget("/karte/../api/admin"));
  assert.ok(!validShareTarget("/api/me"));
});

test("Botschafter-Abzeichen ab 5 und 25 zahlenden Empfehlungen", () => {
  const base = { portfolioCount: 0, portfolioValue: 0, completedTrades: 0, bestStreak: 0, scans: 0, wishlistCount: 0, reviewsAvg: 0, reviewsCount: 0 };
  assert.ok(earnedBadges({ ...base, referralsRewarded: 5 }).includes("recruiter-5"));
  assert.ok(!earnedBadges({ ...base, referralsRewarded: 4 }).includes("recruiter-5"));
  assert.ok(earnedBadges({ ...base, referralsRewarded: 25 }).includes("recruiter-25"));
});
