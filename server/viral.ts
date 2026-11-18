// PokeSwipe & Radar – virales Wachstum: verfolgte Teilen-Links (/s/<code>), Einladungsseite (/einladung/<code>),
// Empfehlungs-Stufen mit Belohnungen, Teilen-Bonus (Extra-KI-Scans) und Werber-Bestenliste.
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, profiles, shareLinks, shareVisits, referralRewards, userBadges, promoCodes, promoRedemptions } from "../db/index.ts";
import { PLANS, PLAN_RANK, REFERRAL_BONUS_DAYS, REFERRAL_TRIAL_DAYS, SHARE_SCAN_BONUS_MAX, effectivePlan, proExpiresAt, type PlanId } from "./plans.ts";
import {
  GROWTH_PLAN, REFERRAL_TIERS, REFERRAL_DAILY_CAP, SHARE_TRIAL_DAYS, tierRewardDays, milestonesReached, nextMilestone,
  isSelfReferral, referralLink, promoLink, normalizePromoCode, PROMO_RE, promoAvailable, validatePromoInput,
} from "./referral-logic.ts";
import { log } from "./log.ts";
import { first50Active, withFirst50 } from "./first50-logic.ts";
import { stripe } from "./billing.ts";
import { notify } from "./prices.ts";
import { berlinDay, validShareTarget } from "./logic.ts";
import { SITE, h, pageShell } from "./growth.ts";
import { str, rows, rateLimit, clientIp } from "./util.ts";

type Profile = typeof profiles.$inferSelect;

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const shortCode = () => Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const SHARE_KINDS = ["invite", "card", "set", "pokemon", "sealed", "portfolio", "pull", "trends", "shop"];
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|skype|linkedin|embedly|quora|pinterest|vkshare|headless/i;


function visitorHash(c: any) {
  const salt = process.env.SITE_ID || "pokeswipe-radar";
  return createHash("sha256").update(`${salt}|${clientIp(c)}|${c.req.header("user-agent") || ""}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Teilen-Bonus: +1 KI-Scan heute pro neuem Besucher über eigene Links (gedeckelt)
// ---------------------------------------------------------------------------
export async function shareBonusToday(userId: string) {
  const [r] = rows(await db.execute(sql`
    SELECT count(DISTINCT visitor_hash)::int AS n FROM share_visits WHERE owner_id = ${userId} AND day = ${berlinDay()}::date
  `));
  return Math.min(SHARE_SCAN_BONUS_MAX, Number(r?.n ?? 0));
}

/** Tageslimit für KI-Scans inkl. Teilen-Bonus. */
export async function scanLimit(userId: string, plan: PlanId) {
  // „Die ersten 50 Sammler“: während der 60 Gründer-Tage praktisch unbegrenzte Scans
  const [p] = await db.select({ first50Until: profiles.first50Until }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return withFirst50(PLANS[plan].scansPerDay + (await shareBonusToday(userId)), first50Active(p));
}

// ---------------------------------------------------------------------------
// Belohnungen
// ---------------------------------------------------------------------------
/**
 * Schreibt eine Belohnung gut – genau einmal pro (Nutzer, Art, Referenz).
 * Zahlende Abonnenten mit mindestens gleichwertigem Tarif bekommen eine Stripe-Gutschrift (nächste Rechnung günstiger),
 * alle anderen Bonus-Tage im belohnten Tarif (bonusUntil/bonusPlan).
 */
export async function grantReward(userId: string, r: { kind: string; reference?: string; plan: "premium" | "pro"; days: number; title: string; text: string }) {
  const [entry] = await db.insert(referralRewards).values({ userId, kind: r.kind, reference: r.reference ?? "", plan: r.plan, days: r.days })
    .onConflictDoNothing().returning();
  if (!entry) return false;
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p || p.banned) return false;
  const paid = effectivePlan({ plan: p.plan, planUntil: p.planUntil });
  const s = stripe();
  if (s && paid !== "free" && PLAN_RANK[paid] >= PLAN_RANK[r.plan] && p.stripeCustomerId && p.stripeSubscriptionId && !p.cancelAtPeriodEnd) {
    const credit = Math.round((r.days / 30) * PLANS[paid].priceCents);
    try {
      await s.customers.createBalanceTransaction(p.stripeCustomerId, { amount: -credit, currency: "eur", description: `PokeSwipe Empfehlung: ${r.title}`.slice(0, 200) });
      await db.update(referralRewards).set({ creditCents: credit }).where(eq(referralRewards.id, entry.id));
      await notify(userId, `🎁 ${r.title}`, `${r.text} Wir haben dir ${(credit / 100).toFixed(2).replace(".", ",")} € auf die nächsten Abo-Rechnungen gutgeschrieben.`, "/?tab=account&sub=invite");
      return true;
    } catch (e) {
      console.warn("Stripe-Gutschrift fehlgeschlagen – vergebe Bonus-Tage", e);
    }
  }
  const active = p.bonusUntil && p.bonusUntil.getTime() > Date.now();
  const base = active ? p.bonusUntil!.getTime() : Date.now();
  const currentBonus = active ? (p.bonusPlan === "pro" ? "pro" : "premium") : "premium";
  const bonusPlan = PLAN_RANK[r.plan] > PLAN_RANK[currentBonus as PlanId] ? r.plan : currentBonus;
  const bonusUntil = new Date(base + r.days * 86400_000);
  await db.update(profiles).set({ bonusUntil, bonusPlan }).where(eq(profiles.userId, userId));
  await notify(userId, `🎁 ${r.title}`, `${r.text} ${PLANS[bonusPlan as PlanId].label} ist jetzt aktiv bis ${bonusUntil.toLocaleDateString("de-DE")}.`, "/?tab=account&sub=invite");
  return true;
}

/** Wird aufgerufen, sobald ein geworbener Nutzer wirklich zahlt (Abo "active", nicht nur Testphase). */
export async function rewardReferral(referred: Profile) {
  const [claimed] = await db.update(profiles).set({ referralRewarded: true })
    .where(and(eq(profiles.userId, referred.userId), eq(profiles.referralRewarded, false))).returning();
  if (!claimed || !referred.referredBy) return;
  const referrerId = referred.referredBy;
  await grantReward(referrerId, {
    kind: "paid_referral", reference: referred.userId, plan: "premium", days: REFERRAL_BONUS_DAYS,
    title: "Gratismonat verdient!", text: `${referred.displayName} hat dank dir ein Abo abgeschlossen.`,
  });
  // Die Werber-Meilensteine zählen seit dem gestaffelten Empfehlungssystem bestätigte Freunde (qualifyReferral) –
  // der Gratismonat für zahlende Freunde bleibt als Extra-Belohnung erhalten.
}

/** Ordnet eine Anmeldung einem Teilen-Link zu (zählt nur, wenn der Link dem Werber gehört). */
export async function attributeSignup(profileId: string, referrerId: string, via: string) {
  if (!/^[a-z0-9]{5,10}$/.test(via)) return;
  const [link] = await db.select({ id: shareLinks.id, userId: shareLinks.userId }).from(shareLinks).where(eq(shareLinks.code, via)).limit(1);
  if (!link || link.userId !== referrerId) return;
  await db.update(profiles).set({ referredVia: link.id }).where(eq(profiles.userId, profileId));
  await db.update(shareLinks).set({ signups: sql`${shareLinks.signups} + 1` }).where(eq(shareLinks.id, link.id));
}

// ---------------------------------------------------------------------------
// Gestaffeltes Empfehlungssystem: Freischaltung erst nach E-Mail-Bestätigung oder erster Aktion
// ---------------------------------------------------------------------------
/** Bestätigte Freunde eines Werbers. */
async function qualifiedCount(referrerId: string) {
  const [r] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM profiles WHERE referred_by = ${referrerId} AND referral_qualified_at IS NOT NULL`));
  return Number(r?.n ?? 0);
}

/**
 * Schaltet die Empfehlung eines geworbenen Freundes frei (genau einmal, atomar):
 * 1. Freund → Werber und Freund je +30 Tage Pro, ab dem 2. Freund je +14 Tage – auf ein laufendes Ablaufdatum aufaddiert.
 * Danach Meilensteine (1 / 3 / 10 Freunde) mit Badge und Extra-Bonus-Tagen. Doppelte Gutschriften verhindert referral_rewards (unique).
 */
export async function qualifyReferral(friendId: string, reason: "email" | "action") {
  const now = new Date();
  const [f] = await db.update(profiles).set({ referralQualifiedAt: now })
    .where(and(eq(profiles.userId, friendId), isNotNull(profiles.referredBy), isNull(profiles.referralQualifiedAt))).returning();
  if (!f?.referredBy) return null;
  const [referrer] = await db.select().from(profiles).where(eq(profiles.userId, f.referredBy)).limit(1);
  if (!referrer || referrer.banned || f.banned || isSelfReferral(referrer, f)) {
    // Kein gültiger Werber mehr → Empfehlung lösen, damit sie nicht als bestätigter Freund zählt
    await db.update(profiles).set({ referredBy: null, referralQualifiedAt: null }).where(eq(profiles.userId, friendId));
    return null;
  }
  // Schutz vor Massen-Fake-Konten: höchstens REFERRAL_DAILY_CAP Freundes-Gutschriften pro Werber und Tag – sonst später erneut
  const [cap] = rows(await db.execute(sql`
    SELECT count(*)::int AS n FROM referral_rewards WHERE user_id = ${referrer.userId} AND kind = 'friend_referral' AND created_at > now() - interval '1 day'
  `));
  if (Number(cap?.n ?? 0) >= REFERRAL_DAILY_CAP) {
    await db.update(profiles).set({ referralQualifiedAt: null }).where(eq(profiles.userId, friendId));
    log.warn("viral", "Empfehlungs-Tageslimit erreicht – Freischaltung vertagt", { referrer: referrer.userId });
    return null;
  }
  // Position dieses Freundes (deterministisch nach Freischaltzeit, dann ID)
  const [pos] = rows(await db.execute(sql`
    SELECT count(*)::int AS n FROM profiles WHERE referred_by = ${referrer.userId} AND referral_qualified_at IS NOT NULL
      AND (referral_qualified_at < ${now} OR (referral_qualified_at = ${now} AND user_id <= ${friendId}))
  `));
  const ordinal = Math.max(1, Number(pos?.n ?? 1));
  const days = tierRewardDays(ordinal);
  await grantReward(referrer.userId, {
    kind: "friend_referral", reference: f.userId, plan: GROWTH_PLAN, days: days.referrer,
    title: ordinal === 1 ? `+${days.referrer} Tage Pro – dein erster Freund ist dabei!` : `+${days.referrer} Tage Pro für Freund Nr. ${ordinal}`,
    text: `${f.displayName} ist jetzt aktiv auf PokeSwipe.`,
  });
  await grantReward(f.userId, {
    kind: "invited_bonus", reference: referrer.userId, plan: GROWTH_PLAN, days: days.friend,
    title: `+${days.friend} Tage PokeSwipe Pro geschenkt`, text: `Danke, dass du über die Einladung von ${referrer.displayName} dabei bist.`,
  });
  const total = await qualifiedCount(referrer.userId);
  for (const m of milestonesReached(total)) {
    await db.insert(userBadges).values({ userId: referrer.userId, badge: m.badge }).onConflictDoNothing();
    if (m.days > 0) {
      await grantReward(referrer.userId, {
        kind: m.kind, plan: GROWTH_PLAN, days: m.days,
        title: `${m.icon} Meilenstein „${m.label}“ erreicht: +${m.days} Extra-Bonus-Tage`,
        text: `${m.count} Freunde sind dank dir dabei – dein Badge ist jetzt im Profil und Marktplatz sichtbar.`,
      });
    } else {
      const [entry] = await db.insert(referralRewards).values({ userId: referrer.userId, kind: m.kind, reference: "", plan: GROWTH_PLAN, days: 0 })
        .onConflictDoNothing().returning();
      if (entry) await notify(referrer.userId, `${m.icon} Badge „${m.label}“ freigeschaltet`, "Dein erster Freund ist dabei – lade weitere ein für Community-Builder & VIP-Sammler.", "/?tab=profile");
    }
  }
  log.info("viral", "Empfehlung freigeschaltet", { reason, ordinal });
  return { ordinal, days, total };
}

/**
 * Hat das Konto schon einmal Gratis-Pro bekommen bzw. ein Abo/Testphase genutzt?
 * („App teilen & 14 Tage Pro testen“ gibt es nur ohne bisherigen Gratis-Test.)
 */
export async function hadFreeTrial(p: Profile) {
  if (p.shareTrialAt || p.switchBonusAt || p.usedTrial || p.stripeSubscriptionId || p.appStoreOriginalTxId) return true;
  if (effectivePlan({ plan: p.plan, planUntil: p.planUntil }) !== "free") return true;
  const [r] = rows(await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM referral_rewards WHERE user_id = ${p.userId} AND kind IN ('invited_bonus', 'promo', 'share_trial'))
      OR EXISTS (SELECT 1 FROM promo_redemptions WHERE user_id = ${p.userId}) AS had
  `));
  return Boolean(r?.had);
}

/** Kurzinfo für /api/me: Fortschritt, nächster Badge, Pro-Ablauf. */
export async function referralSummary(p: Profile) {
  const [r] = rows(await db.execute(sql`
    SELECT count(*)::int AS invited, count(*) FILTER (WHERE referral_qualified_at IS NOT NULL)::int AS confirmed
    FROM profiles WHERE referred_by = ${p.userId}
  `));
  const confirmed = Number(r?.confirmed ?? 0), invited = Number(r?.invited ?? 0);
  const next = nextMilestone(confirmed);
  return {
    invited, confirmed, pending: Math.max(0, invited - confirmed),
    next: next ? { count: next.count, label: next.label, icon: next.icon, missing: next.missing, reward: next.reward } : null,
    badges: milestonesReached(confirmed).map((m) => ({ id: m.badge, label: m.label, icon: m.icon })),
    proExpiresAt: proExpiresAt(p),
    shareTrialAvailable: !(await hadFreeTrial(p)),
    shareTrialDays: SHARE_TRIAL_DAYS,
    friendPending: Boolean(p.referredBy && !p.referralQualifiedAt),
  };
}

// ---------------------------------------------------------------------------
// Dashboard & Bestenliste
// ---------------------------------------------------------------------------
async function leaderboard(limit = 10) {
  return rows(await db.execute(sql`
    WITH paid AS (
      SELECT user_id, count(*)::int AS n FROM referral_rewards
      WHERE kind = 'paid_referral' AND created_at >= date_trunc('month', now()) GROUP BY user_id
    ), joined AS (
      SELECT referred_by AS user_id, count(*)::int AS n FROM profiles
      WHERE referred_by IS NOT NULL AND created_at >= date_trunc('month', now()) GROUP BY referred_by
    )
    SELECT p.user_id, p.display_name, COALESCE(paid.n, 0) AS paid, COALESCE(joined.n, 0) AS joined,
      (COALESCE(paid.n, 0) * 10 + COALESCE(joined.n, 0))::int AS score
    FROM profiles p LEFT JOIN paid ON paid.user_id = p.user_id LEFT JOIN joined ON joined.user_id = p.user_id
    WHERE (paid.n IS NOT NULL OR joined.n IS NOT NULL) AND p.leaderboard_opt_in AND NOT p.banned
    ORDER BY score DESC, p.display_name LIMIT ${limit}
  `));
}

export async function referralDashboard(profile: Profile, code: string) {
  const [share] = rows(await db.execute(sql`
    SELECT COALESCE(sum(clicks), 0)::int AS clicks, COALESCE(sum(unique_visitors), 0)::int AS visitors, COALESCE(sum(signups), 0)::int AS signups
    FROM share_links WHERE user_id = ${profile.userId}
  `));
  const [paidRow] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM profiles WHERE referred_by = ${profile.userId} AND referral_rewarded`));
  const top = await db.select({ code: shareLinks.code, kind: shareLinks.kind, title: shareLinks.title, target: shareLinks.target,
    uniqueVisitors: shareLinks.uniqueVisitors, signups: shareLinks.signups })
    .from(shareLinks).where(eq(shareLinks.userId, profile.userId)).orderBy(desc(shareLinks.uniqueVisitors)).limit(5);
  const rewards = await db.select({ kind: referralRewards.kind, plan: referralRewards.plan, days: referralRewards.days, creditCents: referralRewards.creditCents, createdAt: referralRewards.createdAt })
    .from(referralRewards).where(eq(referralRewards.userId, profile.userId)).orderBy(desc(referralRewards.createdAt)).limit(20);
  // Geworbene Freunde mit Status (nur öffentlicher Sammlername, keine E-Mail)
  const friends = rows(await db.execute(sql`
    SELECT p.display_name, p.created_at, p.referral_qualified_at, rr.days
    FROM profiles p LEFT JOIN referral_rewards rr ON rr.user_id = ${profile.userId} AND rr.kind = 'friend_referral' AND rr.reference = p.user_id
    WHERE p.referred_by = ${profile.userId} ORDER BY p.created_at DESC LIMIT 50
  `)).map((f: any) => ({ name: String(f.display_name), joinedAt: f.created_at, status: f.referral_qualified_at ? "confirmed" : "pending", days: f.days != null ? Number(f.days) : null }));
  const sum = await referralSummary(profile);
  const board = await leaderboard(10);
  return {
    code,
    link: referralLink(SITE(), code),
    invitePage: `${SITE()}/einladung/${code}`,
    invited: sum.invited, confirmed: sum.confirmed, pending: sum.pending, paid: Number(paidRow?.n ?? 0),
    friends,
    proExpiresAt: sum.proExpiresAt,
    tiers: { firstDays: tierRewardDays(1).referrer, nextDays: tierRewardDays(2).referrer },
    trialDays: REFERRAL_TRIAL_DAYS, rewardDays: REFERRAL_BONUS_DAYS,
    milestones: REFERRAL_TIERS.map((m) => ({ count: m.count, label: m.label, icon: m.icon, reward: m.reward, reached: sum.confirmed >= m.count })),
    next: sum.next,
    share: { clicks: Number(share?.clicks ?? 0), visitors: Number(share?.visitors ?? 0), signups: Number(share?.signups ?? 0), top },
    shareBonus: { today: await shareBonusToday(profile.userId), max: SHARE_SCAN_BONUS_MAX },
    shareTrialAvailable: sum.shareTrialAvailable, shareTrialDays: SHARE_TRIAL_DAYS,
    rewards,
    leaderboard: board.map((b: any, i: number) => ({ rank: i + 1, name: b.display_name, paid: Number(b.paid), joined: Number(b.joined), me: b.user_id === profile.userId })),
    leaderboardOptIn: profile.leaderboardOptIn,
  };
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerViral(app: any, hlp: { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>>; ensureCode: (p: Profile) => Promise<string> }) {
  const { auth, adminOnly, body, ensureCode } = hlp;

  // ------------------------------------------------------------------------
  // Video-Promo-Links (?promo=CODE)
  // ------------------------------------------------------------------------
  /** Öffentliche Prüfung für das Bonus-Banner (ohne interne Bezeichnung). */
  app.get("/api/promo/:code", async (c: any) => {
    const code = normalizePromoCode(c.req.param("code"));
    if (!(await rateLimit(`promo-check:${clientIp(c)}`, 30, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    c.header("Cache-Control", "no-store");
    if (!PROMO_RE.test(code)) return c.json({ valid: false, reason: "Ungültiger Code" });
    const [p] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
    const a = promoAvailable(p);
    return c.json({ valid: a.ok, code, days: a.ok ? p!.days : 0, reason: a.reason });
  });

  /** Promo-Code einlösen – einmal pro Konto und Code, Gutschrift von Pro-Tagen. */
  app.post("/api/promo/redeem", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    if (!(await rateLimit(`promo:${profile.userId}`, 10, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const code = normalizePromoCode((await body(c)).code);
    if (!PROMO_RE.test(code)) return c.json({ error: "Ungültiger Promo-Code." }, 400);
    const [p] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
    const a = promoAvailable(p);
    if (!a.ok || !p) return c.json({ error: a.reason }, p ? 409 : 404);
    const [redemption] = await db.insert(promoRedemptions).values({ promoId: p.id, userId: profile.userId, days: p.days }).onConflictDoNothing().returning();
    if (!redemption) return c.json({ ok: true, already: true, error: "Diesen Code hast du schon eingelöst." }, 409);
    // Kontingent atomar belegen – bei Überbuchung Einlösung zurücknehmen
    const [counted] = await db.update(promoCodes).set({ redemptions: sql`${promoCodes.redemptions} + 1` })
      .where(and(eq(promoCodes.id, p.id), eq(promoCodes.active, true), sql`(${promoCodes.maxRedemptions} IS NULL OR ${promoCodes.redemptions} < ${promoCodes.maxRedemptions})`))
      .returning({ id: promoCodes.id });
    if (!counted) {
      await db.delete(promoRedemptions).where(eq(promoRedemptions.id, redemption.id));
      return c.json({ error: "Dieser Promo-Code ist bereits ausgeschöpft." }, 409);
    }
    await grantReward(profile.userId, {
      kind: "promo", reference: String(p.id), plan: GROWTH_PLAN, days: p.days,
      title: `🎬 Promo-Code ${code}: ${p.days} Tage PokeSwipe Pro`, text: "Viel Spaß mit allen Pro-Funktionen!",
    });
    const [fresh] = await db.select().from(profiles).where(eq(profiles.userId, profile.userId)).limit(1);
    return c.json({ ok: true, days: p.days, proExpiresAt: proExpiresAt(fresh) });
  });

  // Admin: Promo-Link-Generator
  app.get("/api/admin/promo-codes", auth, adminOnly, async (c: any) => {
    const list = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(200);
    return c.json({ codes: list.map((p) => ({ ...p, link: promoLink(SITE(), p.code) })) });
  });
  app.post("/api/admin/promo-codes", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const { value, error } = validatePromoInput({ maxRedemptions: null, active: true, ...b });
    if (error) return c.json({ error }, 400);
    const [created] = await db.insert(promoCodes).values({
      code: value.code!, label: value.label ?? "", days: value.days!, maxRedemptions: value.maxRedemptions ?? null,
      active: value.active ?? true, createdBy: c.get("user").email || "",
    }).onConflictDoNothing().returning();
    if (!created) return c.json({ error: "Diesen Code gibt es schon." }, 409);
    return c.json({ code: { ...created, link: promoLink(SITE(), created.code) } });
  });
  app.patch("/api/admin/promo-codes/:id", auth, adminOnly, async (c: any) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "Ungültige ID" }, 400);
    const b = await body(c);
    const { value, error } = validatePromoInput({ label: b.label, days: b.days, maxRedemptions: b.maxRedemptions, active: b.active }, { partial: true });
    if (error) return c.json({ error }, 400);
    delete value.code; // Code bleibt fest (Links in Videos sollen gültig bleiben)
    if (!Object.keys(value).length) return c.json({ error: "Keine Änderungen" }, 400);
    const [u] = await db.update(promoCodes).set(value).where(eq(promoCodes.id, id)).returning();
    if (!u) return c.json({ error: "Nicht gefunden" }, 404);
    return c.json({ code: { ...u, link: promoLink(SITE(), u.code) } });
  });

  // ------------------------------------------------------------------------
  // „App teilen & 14 Tage Pro testen“ (einmalig, nur ohne bisherigen Gratis-Test)
  // ------------------------------------------------------------------------
  app.post("/api/growth/share-trial", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    if (await hadFreeTrial(profile)) return c.json({ error: "Den Gratis-Test hast du schon genutzt – lade Freunde ein für mehr Pro-Tage." }, 409);
    // Nachweis: ein eigener Teilen-Link muss existieren (wird beim Teilen angelegt)
    const [link] = await db.select({ id: shareLinks.id }).from(shareLinks).where(eq(shareLinks.userId, profile.userId)).limit(1);
    if (!link) return c.json({ error: "Bitte teile zuerst deinen Einladungslink." }, 409);
    const [claimed] = await db.update(profiles).set({ shareTrialAt: new Date() })
      .where(and(eq(profiles.userId, profile.userId), isNull(profiles.shareTrialAt))).returning({ id: profiles.userId });
    if (!claimed) return c.json({ error: "Den Gratis-Test hast du schon genutzt." }, 409);
    await grantReward(profile.userId, {
      kind: "share_trial", plan: GROWTH_PLAN, days: SHARE_TRIAL_DAYS,
      title: `📲 Danke fürs Teilen: ${SHARE_TRIAL_DAYS} Tage Pro gratis`, text: "Teste alle Pro-Funktionen – ganz ohne Abo.",
    });
    const [fresh] = await db.select().from(profiles).where(eq(profiles.userId, profile.userId)).limit(1);
    return c.json({ ok: true, days: SHARE_TRIAL_DAYS, proExpiresAt: proExpiresAt(fresh) });
  });

  /** Verfolgten Kurzlink für eine eigene Seite anlegen (oder vorhandenen zurückgeben). */
  app.post("/api/share", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    if (!(await rateLimit(`share:${profile.userId}`, 30, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const b = await body(c);
    const target = str(b.target, 200).split("?")[0].split("#")[0];
    if (!validShareTarget(target)) return c.json({ error: "Dieses Ziel kann nicht geteilt werden." }, 400);
    const kind = SHARE_KINDS.includes(String(b.kind)) ? String(b.kind) : "invite";
    const title = str(b.title, 120);
    const [existing] = await db.select().from(shareLinks).where(and(eq(shareLinks.userId, profile.userId), eq(shareLinks.target, target))).limit(1);
    let link = existing;
    if (!link) {
      const [cnt] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM share_links WHERE user_id = ${profile.userId}`));
      if (Number(cnt?.n ?? 0) >= 2000) return c.json({ error: "Zu viele Teilen-Links." }, 409);
      for (let i = 0; i < 5 && !link; i++) {
        [link] = await db.insert(shareLinks).values({ userId: profile.userId, code: shortCode(), kind, target, title }).onConflictDoNothing().returning();
        if (!link) [link] = await db.select().from(shareLinks).where(and(eq(shareLinks.userId, profile.userId), eq(shareLinks.target, target))).limit(1);
      }
      if (!link) return c.json({ error: "Link konnte nicht erstellt werden." }, 500);
    }
    await ensureCode(profile);
    return c.json({ code: link.code, url: `${SITE()}/s/${link.code}` });
  });

  /** Kurzlink: zählt den Besuch (ohne Bots, gehashter Besucher) und leitet mit Empfehlungscode weiter. */
  app.get("/s/:code", async (c: any) => {
    const code = String(c.req.param("code") || "");
    c.header("Cache-Control", "no-store");
    if (!/^[a-z0-9]{5,10}$/.test(code)) return c.redirect("/", 302);
    const [link] = await db.select({ id: shareLinks.id, userId: shareLinks.userId, target: shareLinks.target, refCode: profiles.referralCode, banned: profiles.banned })
      .from(shareLinks).innerJoin(profiles, eq(profiles.userId, shareLinks.userId)).where(eq(shareLinks.code, code)).limit(1);
    if (!link || !validShareTarget(link.target)) return c.redirect("/", 302);
    const ua = c.req.header("user-agent") || "";
    if (!link.banned && !BOT_RE.test(ua) && (await rateLimit(`svisit:${clientIp(c)}`, 30, 60_000))) {
      try {
        const [visit] = await db.insert(shareVisits).values({ shareId: link.id, ownerId: link.userId, visitorHash: visitorHash(c), day: berlinDay() })
          .onConflictDoNothing().returning({ id: shareVisits.id });
        await db.update(shareLinks).set({
          clicks: sql`${shareLinks.clicks} + 1`,
          ...(visit ? { uniqueVisitors: sql`${shareLinks.uniqueVisitors} + 1` } : {}),
        }).where(eq(shareLinks.id, link.id));
      } catch (e) { console.warn("Teilen-Besuch nicht gezählt", e); }
    }
    const u = new URL(link.target, SITE());
    if (link.refCode && !link.banned) u.searchParams.set("ref", link.refCode);
    u.searchParams.set("via", code);
    return c.redirect(`${u.pathname}${u.search}`, 302);
  });

  /** Persönliche Einladungsseite mit Vorschau für WhatsApp, Instagram & Co. */
  app.get("/einladung/:code", async (c: any) => {
    const code = String(c.req.param("code") || "").toUpperCase();
    if (!(await rateLimit(`invite:${clientIp(c)}`, 60, 60_000))) return c.text("Zu viele Anfragen", 429);
    const [p] = /^[A-Z0-9]{6,10}$/.test(code)
      ? await db.select({ name: profiles.displayName, banned: profiles.banned, code: profiles.referralCode }).from(profiles).where(eq(profiles.referralCode, code)).limit(1)
      : [];
    const valid = p && !p.banned;
    const who = valid ? p.name : "Ein Sammler";
    const appLink = valid ? `/?ref=${encodeURIComponent(code)}${c.req.query("via") ? `&via=${encodeURIComponent(String(c.req.query("via")).slice(0, 10))}` : ""}` : "/";
    const title = `${who} schenkt dir ${REFERRAL_TRIAL_DAYS} Tage PokeSwipe Premium`;
    const description = `Live-Preise für alle deutschen Pokémon-Karten, Portfolio-Wert, Restock-Alarm für Displays zum UVP, KI-Kartenscan und Tausch-Hub. Mit Einladung ist dein erster Monat gratis.`;
    const perks = [
      ["📈", "Live-Cardmarket-Preise", "für über 20.000 deutsche Karten – mit Preisalarm aufs Handy"],
      ["💼", "Portfolio-Wert", "deine Sammlung mit Gewinn/Verlust und täglichem Verlauf"],
      ["🚨", "Restock-Radar", "Push, sobald Displays & ETBs zum UVP wieder da sind"],
      ["📷", "KI-Kartenscan & Fake-Check", "Karte fotografieren, Preis sofort sehen"],
      ["🤝", "Tausch-Hub", "sicher tauschen mit Preis-Check und Bewertungen"],
    ];
    const body = `<div class="card" style="text-align:center">
      <p style="font-size:44px;margin:0">🎁</p>
      <h1>${h(title)}</h1>
      <p class="muted">${valid ? `${h(who)} nutzt PokeSwipe &amp; Radar und lädt dich ein.` : "Diese Einladung ist nicht mehr gültig – die App kannst du trotzdem kostenlos nutzen."} Kein Risiko: in der Testphase wird nichts abgebucht, jederzeit kündbar.</p>
      <div class="btns" style="justify-content:center"><a class="btn y" href="${h(appLink)}">Einladung annehmen &amp; loslegen</a></div>
      ${valid ? `<p class="muted" style="margin-top:10px">Dein Einladungscode: <b style="color:#ffcb05">${h(code)}</b></p>` : ""}
    </div>
    <h2>Das bekommst du</h2>
    <div class="list">${perks.map(([i, t, d]) => `<div class="row"><span>${i} <b>${h(t)}</b> <span class="muted">– ${h(d)}</span></span></div>`).join("")}</div>
    <h2>So funktioniert's</h2>
    <div class="list">
      <div class="row"><span>1️⃣ Einladung annehmen und kostenlos registrieren</span></div>
      <div class="row"><span>2️⃣ Premium oder Pro ${REFERRAL_TRIAL_DAYS} Tage gratis testen</span></div>
      <div class="row"><span>3️⃣ Selbst Freunde einladen – für jeden zahlenden Freund gibt's einen Gratismonat, ab 3 Freunden sogar Pro Trader</span></div>
    </div>`;
    c.header("Cache-Control", "public, max-age=300");
    return c.html(pageShell({ title: `${title} | PokeSwipe & Radar`, description, canonical: `${SITE()}/einladung/${encodeURIComponent(code)}`, body, robots: "noindex, follow" }));
  });

  app.get("/api/referral/dashboard", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    return c.json(await referralDashboard(profile, await ensureCode(profile)));
  });

  app.get("/api/referral/leaderboard", async (c: any) => {
    c.header("Cache-Control", "public, max-age=300");
    const board = await leaderboard(20);
    return c.json({ leaderboard: board.map((b: any, i: number) => ({ rank: i + 1, name: b.display_name, paid: Number(b.paid), joined: Number(b.joined) })) });
  });
}
