// Gestaffeltes Empfehlungssystem, Anti-Fake-Regeln, Promo-Codes und nahtlose Pro-Prüfung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tierRewardDays, milestonesReached, nextMilestone, totalDaysEarned, normalizeEmail, isSelfReferral, referralQualifies,
  isActiveActionPath, extendExpiry, validatePromoInput, promoAvailable, normalizePromoCode, referralLink, promoLink, REFERRAL_TIERS,
} from "../server/referral-logic.ts";
import { effectivePlan, proExpiresAt, planSource, REFERRAL_MILESTONES } from "../server/plans.ts";
import { earnedBadges } from "../server/logic.ts";

const day = 86400_000;

test("Empfehlung: 1. Freund je 30 Tage, ab dem 2. Freund je 14 Tage (stapelbar)", () => {
  assert.deepEqual(tierRewardDays(1), { referrer: 30, friend: 30 });
  assert.deepEqual(tierRewardDays(2), { referrer: 14, friend: 14 });
  assert.deepEqual(tierRewardDays(9), { referrer: 14, friend: 14 });
  // 3 Freunde: 30 + 14 + 14 + 14 (Community-Builder) = 72 Tage
  assert.equal(totalDaysEarned(3), 72);
  // 10 Freunde: 30 + 9·14 + 14 + 30 = 200 Tage
  assert.equal(totalDaysEarned(10), 200);
});

test("Meilensteine: Starter-Werber (1), Community-Builder (3), VIP-Sammler (10)", () => {
  assert.deepEqual(REFERRAL_TIERS.map((t) => [t.count, t.label, t.days]), [[1, "Starter-Werber", 0], [3, "Community-Builder", 14], [10, "VIP-Sammler", 30]]);
  assert.deepEqual(milestonesReached(0), []);
  assert.deepEqual(milestonesReached(3).map((m) => m.badge), ["ref-starter", "ref-community"]);
  assert.deepEqual(nextMilestone(0)?.missing, 1);
  assert.equal(nextMilestone(1)?.label, "Community-Builder");
  assert.equal(nextMilestone(1)?.missing, 2);
  assert.equal(nextMilestone(4)?.missing, 6);
  assert.equal(nextMilestone(10), null);
  assert.deepEqual(REFERRAL_MILESTONES.map((m) => m.count), [1, 3, 10]);
  assert.ok(REFERRAL_MILESTONES.every((m) => m.plan === "pro"));
});

test("Badges für bestätigte Freunde", () => {
  const base = { portfolioCount: 0, portfolioValue: 0, completedTrades: 0, bestStreak: 0, scans: 0, wishlistCount: 0, referralsRewarded: 0, reviewsAvg: 0, reviewsCount: 0 };
  assert.deepEqual(earnedBadges({ ...base, referralsQualified: 2 }).filter((b) => b.startsWith("ref-")), ["ref-starter"]);
  assert.deepEqual(earnedBadges({ ...base, referralsQualified: 10 }).filter((b) => b.startsWith("ref-")), ["ref-starter", "ref-community", "ref-vip"]);
});

test("Anti-Fake: Selbst-Einladung per Account oder (normalisierter) E-Mail wird erkannt", () => {
  assert.equal(normalizeEmail(" Max.Muster+pokeswipe@GoogleMail.com "), "maxmuster@gmail.com");
  assert.equal(normalizeEmail("a.b+x@web.de"), "a.b@web.de");
  const a = { userId: "u1", email: "max.muster@gmail.com" };
  assert.equal(isSelfReferral(a, { userId: "u1", email: "other@web.de" }), true);
  assert.equal(isSelfReferral(a, { userId: "u2", email: "maxmuster+2@gmail.com" }), true);
  assert.equal(isSelfReferral(a, { userId: "u2", email: "freund@gmail.com" }), false);
});

test("Freischaltung erst nach E-Mail-Bestätigung oder erster aktiver Aktion", () => {
  assert.equal(referralQualifies({ emailConfirmed: false, activeAction: false }), false);
  assert.equal(referralQualifies({ emailConfirmed: true, activeAction: false }), true);
  assert.equal(referralQualifies({ emailConfirmed: false, activeAction: true }), true);
  for (const p of ["/api/scan", "/api/scan/condition", "/api/portfolio", "/api/portfolio/import", "/api/portfolio/import-rows", "/api/wishlist", "/api/graded"]) {
    assert.equal(isActiveActionPath("POST", p), true, p);
  }
  assert.equal(isActiveActionPath("PUT", "/api/portfolio/by-card/sv08-238"), true);
  assert.equal(isActiveActionPath("GET", "/api/portfolio"), false);
  for (const p of ["/api/me/preferences", "/api/daily/checkin", "/api/referral/claim", "/api/share", "/api/scan/learn"]) {
    assert.equal(isActiveActionPath("POST", p), false, p);
  }
});

test("Pro-Tage werden auf ein laufendes Ablaufdatum aufaddiert, sonst ab jetzt", () => {
  const now = Date.UTC(2026, 10, 17);
  assert.equal(extendExpiry(null, 30, now).getTime(), now + 30 * day);
  assert.equal(extendExpiry(new Date(now + 10 * day), 14, now).getTime(), now + 24 * day);
  assert.equal(extendExpiry(new Date(now - 5 * day), 14, now).getTime(), now + 14 * day);
});

test("Promo-Codes: Admin-Eingabe wird geprüft", () => {
  assert.equal(normalizePromoCode(" start 30 "), "START30");
  const ok = validatePromoInput({ code: "dario30", label: "TikTok Dario", days: 30, maxRedemptions: "", active: true });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.value, { code: "DARIO30", label: "TikTok Dario", days: 30, maxRedemptions: null, active: true });
  assert.ok(validatePromoInput({ code: "ab", days: 30 }).error);
  assert.ok(validatePromoInput({ code: "BAD CODE!", days: 30 }).error);
  assert.ok(validatePromoInput({ code: "OK30", days: 0 }).error);
  assert.ok(validatePromoInput({ code: "OK30", days: 400 }).error);
  assert.ok(validatePromoInput({ code: "OK30", days: 14, maxRedemptions: -1 }).error);
  assert.deepEqual(validatePromoInput({ active: false }, { partial: true }), { value: { active: false }, error: null });
});

test("Promo-Codes: aktiv, Kontingent und Links", () => {
  assert.equal(promoAvailable(null).ok, false);
  assert.equal(promoAvailable({ active: false, maxRedemptions: null, redemptions: 0 }).ok, false);
  assert.equal(promoAvailable({ active: true, maxRedemptions: 10, redemptions: 10 }).ok, false);
  assert.equal(promoAvailable({ active: true, maxRedemptions: 10, redemptions: 9 }).ok, true);
  assert.equal(promoAvailable({ active: true, maxRedemptions: null, redemptions: 99999 }).ok, true);
  assert.equal(promoLink("https://pokeswipe-radar.de/", "START30"), "https://pokeswipe-radar.de/?promo=START30");
  assert.equal(referralLink("https://pokeswipe-radar.de", "ABCD2345"), "https://pokeswipe-radar.de/?ref=ABCD2345");
});

test("Pro-Status: aktives Abo ODER proExpiresAt > jetzt, danach sauber Free", () => {
  const future = new Date(Date.now() + 5 * day), past = new Date(Date.now() - 2 * day);
  // nur Geschenk-Pro
  const gifted = { plan: "free", planUntil: null, bonusUntil: future, bonusPlan: "pro" };
  assert.equal(effectivePlan(gifted), "pro");
  assert.equal(proExpiresAt(gifted)?.getTime(), future.getTime());
  assert.equal(planSource(gifted), "bonus");
  // abgelaufen → Free
  const expired = { plan: "free", planUntil: null, bonusUntil: past, bonusPlan: "pro" };
  assert.equal(effectivePlan(expired), "free");
  assert.equal(proExpiresAt(expired), null);
  assert.equal(planSource(expired), "free");
  // Abo läuft, Geschenk abgelaufen → Abo bleibt
  const sub = { plan: "premium", planUntil: future, bonusUntil: past, bonusPlan: "pro" };
  assert.equal(effectivePlan(sub), "premium");
  assert.equal(planSource(sub), "subscription");
  // Abo abgelaufen, Geschenk aktiv → Pro über Geschenk
  assert.equal(effectivePlan({ plan: "premium", planUntil: past, bonusUntil: future, bonusPlan: "pro" }), "pro");
});

test("Migration legt Promo-Tabellen an und START30 als Start-Kampagne", () => {
  const sql = readFileSync("netlify/database/migrations/20261117161252_add_tiered_referrals_promo_codes/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "promo_codes"/);
  assert.match(sql, /CREATE UNIQUE INDEX "promo_redemptions_unique"/);
  assert.match(sql, /'START30'.*30/);
  assert.match(sql, /referral_qualified_at/);
});
