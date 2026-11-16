import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { PLANS, type PlanId } from "./plans.ts";
import { rewardReferral } from "./viral.ts";

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
  // Nur übernehmen, wenn nicht parallel schon ein Kunde angelegt wurde (zwei Checkouts gleichzeitig)
  const [claimed] = await db.update(profiles).set({ stripeCustomerId: customer.id })
    .where(and(eq(profiles.userId, profile.userId), isNull(profiles.stripeCustomerId))).returning();
  if (claimed) return customer.id;
  await s.customers.del(customer.id).catch(() => {});
  const [p] = await db.select({ id: profiles.stripeCustomerId }).from(profiles).where(eq(profiles.userId, profile.userId)).limit(1);
  if (!p?.id) throw new Error("Stripe-Kunde konnte nicht zugeordnet werden");
  return p.id;
}

// ---------------------------------------------------------------------------
// Phase 6: Checkout mit Stripe Tax (Umsatzsteuer je Land des Kunden, Abo & Boost = Plattform-Umsatz)
// ---------------------------------------------------------------------------
/** Fehler, die nur bedeuten „Stripe Tax ist im Dashboard (noch) nicht eingerichtet“ – dann ohne automatic_tax weiter. */
export function taxNotActivated(e: any): boolean {
  const msg = String(e?.raw?.message || e?.message || "");
  const param = String(e?.raw?.param || e?.param || "");
  if (e?.type && e.type !== "StripeInvalidRequestError") return false;
  return param.startsWith("automatic_tax") || /automatic[_ ]tax|stripe tax|tax (settings|registration)|head office|origin address|not (been )?activated.*tax/i.test(msg);
}

/**
 * Legt eine Checkout-Session mit automatischer Steuerberechnung an. Bestehende Kunden bekommen die im Checkout
 * erfasste Rechnungsadresse gespeichert (Pflicht für Stripe Tax mit `customer`). Ist Stripe Tax nicht aktiviert,
 * wird einmal ohne automatic_tax wiederholt und protokolliert – der Checkout bricht dadurch nie ab.
 */
export async function createTaxedCheckout(s: Stripe, params: Stripe.Checkout.SessionCreateParams) {
  const taxed: Stripe.Checkout.SessionCreateParams = {
    ...params,
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    ...(params.customer ? { customer_update: { ...(params.customer_update || {}), address: "auto" } } : {}),
  };
  try {
    return await s.checkout.sessions.create(taxed);
  } catch (e: any) {
    if (!taxNotActivated(e)) throw e;
    console.warn("Stripe Tax nicht aktiviert – Checkout ohne automatische Steuerberechnung", e?.raw?.message || e?.message);
    return s.checkout.sessions.create(params);
  }
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
    await rewardReferral(updated);
  }
  return updated;
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
