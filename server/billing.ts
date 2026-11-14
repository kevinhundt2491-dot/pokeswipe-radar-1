import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { PLANS, REFERRAL_BONUS_DAYS, effectivePlan, type PlanId } from "./plans.ts";
import { notify } from "./prices.ts";

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

type Profile = typeof profiles.$inferSelect;

export async function getOrCreateCustomer(s: Stripe, profile: Profile) {
  if (profile.stripeCustomerId) return profile.stripeCustomerId;
  const customer = await s.customers.create({
    email: profile.email,
    name: profile.displayName,
    metadata: { userId: profile.userId },
  });
  await db.update(profiles).set({ stripeCustomerId: customer.id }).where(eq(profiles.userId, profile.userId));
  return customer.id;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const raw = (sub as any).current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

/** Überträgt den echten Abo-Status von Stripe in das Profil. */
export async function applySubscription(userId: string, sub: Stripe.Subscription) {
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  const plan = (sub.metadata?.plan in PLANS ? sub.metadata.plan : "premium") as PlanId;
  const values = live
    ? { plan, planUntil: periodEnd(sub), planInterval: sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month", stripeSubscriptionId: sub.id, cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end), planCheckedAt: new Date() }
    : { plan: "free", planUntil: null, stripeSubscriptionId: null, cancelAtPeriodEnd: false, planCheckedAt: new Date() };
  const [updated] = await db.update(profiles).set(values).where(eq(profiles.userId, userId)).returning();
  if (updated && sub.status === "active" && updated.referredBy && !updated.referralRewarded) {
    await rewardReferrer(updated);
  }
  return updated;
}

/**
 * Empfehlungs-Belohnung: erst wenn der geworbene Nutzer wirklich zahlt (Abo "active", nicht nur Testphase).
 * Zahlende Werber bekommen eine Gutschrift in Höhe eines Monats, alle anderen einen Gratismonat Premium.
 */
async function rewardReferrer(referred: Profile) {
  const [claimed] = await db.update(profiles).set({ referralRewarded: true })
    .where(and(eq(profiles.userId, referred.userId), eq(profiles.referralRewarded, false))).returning();
  if (!claimed || !referred.referredBy) return;
  const [referrer] = await db.select().from(profiles).where(eq(profiles.userId, referred.referredBy)).limit(1);
  if (!referrer || referrer.banned) return;
  const plan = effectivePlan({ plan: referrer.plan, planUntil: referrer.planUntil });
  const s = stripe();
  if (s && plan !== "free" && referrer.stripeCustomerId && referrer.stripeSubscriptionId && !referrer.cancelAtPeriodEnd) {
    await s.customers.createBalanceTransaction(referrer.stripeCustomerId, {
      amount: -PLANS[plan].priceCents, // Gutschrift = ein Monatsbeitrag (auch bei Jahresabo)
      currency: "eur",
      description: `Gratismonat: Empfehlung von ${referred.displayName}`,
    });
    await notify(referrer.userId, "🎁 Gratismonat verdient!", `${referred.displayName} ist dank dir dabei – deine nächste Abo-Rechnung ist gratis.`);
  } else {
    const base = referrer.bonusUntil && referrer.bonusUntil.getTime() > Date.now() ? referrer.bonusUntil.getTime() : Date.now();
    await db.update(profiles).set({ bonusUntil: new Date(base + REFERRAL_BONUS_DAYS * 86400_000) })
      .where(eq(profiles.userId, referrer.userId));
    await notify(referrer.userId, "🎁 Gratismonat Premium aktiv!", `${referred.displayName} ist dank dir dabei – du hast jetzt ${REFERRAL_BONUS_DAYS} Tage Premium geschenkt.`);
  }
}

/** Gleicht das Abo höchstens alle 6 Stunden mit Stripe ab (Verlängerung, Kündigung, Zahlungsausfall). */
export async function syncProfilePlan(profile: Profile): Promise<Profile> {
  const s = stripe();
  if (!s || !profile.stripeSubscriptionId) return profile;
  const fresh = profile.planCheckedAt && Date.now() - profile.planCheckedAt.getTime() < 6 * 3600_000;
  const expired = profile.planUntil && profile.planUntil.getTime() < Date.now();
  if (fresh && !expired) return profile;
  try {
    const sub = await s.subscriptions.retrieve(profile.stripeSubscriptionId);
    return (await applySubscription(profile.userId, sub)) ?? profile;
  } catch (e) {
    console.warn("Stripe-Abgleich fehlgeschlagen", e);
    return profile;
  }
}
