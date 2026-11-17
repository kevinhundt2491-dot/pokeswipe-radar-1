import Stripe from "stripe";
import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { PLANS, type PlanId } from "./plans.ts";
import { rewardReferral } from "./viral.ts";
import { log } from "./log.ts";
import { splitDuplicateSubs, hadTrial, isAppSub, isLiveSub, LIVE_SUB_STATUSES } from "./billing-logic.ts";

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
  // Ein aktives Apple-Abo (In-App-Kauf in der iOS-App) darf durch ein beendetes Stripe-Abo nicht gelöscht werden
  const [current] = live ? [] : await db.select({ planSource: profiles.planSource, planUntil: profiles.planUntil }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const appleActive = current?.planSource === "apple" && current.planUntil && current.planUntil.getTime() > Date.now();
  const values = live
    ? { plan, planUntil: periodEnd(sub), planInterval: sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month", stripeSubscriptionId: sub.id, cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end), planCheckedAt: new Date(), planSource: "stripe" }
    : appleActive
      ? { stripeSubscriptionId: null, planCheckedAt: new Date() }
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

// ---------------------------------------------------------------------------
// Abo-Abgleich Stripe → App (Duplikate kündigen, Profile neu verknüpfen, Testphase markieren)
// ---------------------------------------------------------------------------
const customerOf = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer?.id) || "";

async function profileForCustomer(customerId: string, subs: Stripe.Subscription[]): Promise<Profile | null> {
  for (const sub of subs) {
    const userId = sub.metadata?.userId;
    if (!userId) continue;
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (p) return p;
  }
  const [p] = await db.select().from(profiles).where(eq(profiles.stripeCustomerId, customerId)).limit(1);
  return p ?? null;
}

export type CustomerReconcile = {
  customer: string;
  userId: string | null;
  kept: string | null;
  canceled: string[];
  relinked: boolean;
  trialMarked: boolean;
};

/**
 * Gleicht alle Abos eines Stripe-Kunden mit der App ab: höchstens ein laufendes App-Abo bleibt bestehen
 * (die übrigen werden sofort gekündigt, damit niemand mehrfach zahlt), das Profil bekommt Kunde, Abo und Tarif,
 * und eine bereits genutzte Testphase wird vermerkt.
 * `allSubs` = sämtliche Abos des Kunden (auch beendete), sonst werden sie hier geladen.
 */
export async function reconcileCustomer(s: Stripe, customerId: string, opts: { dryRun?: boolean; allSubs?: Stripe.Subscription[] } = {}): Promise<CustomerReconcile> {
  const all = (opts.allSubs ?? (await s.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data).filter(isAppSub);
  const profile = await profileForCustomer(customerId, all);
  const { keep, duplicates } = splitDuplicateSubs(all, profile?.stripeSubscriptionId);
  const result: CustomerReconcile = { customer: customerId, userId: profile?.userId ?? null, kept: keep?.id ?? null, canceled: [], relinked: false, trialMarked: false };

  // Erst das bleibende Abo verknüpfen, dann Duplikate kündigen – deren Webhooks werden danach ignoriert
  const cancelDuplicates = async () => {
    for (const dup of duplicates) {
      result.canceled.push(dup.id);
      if (opts.dryRun) continue;
      // Testphase: kündigen ohne Abrechnung. Bereits bezahlt: kündigen und zur manuellen Erstattung melden.
      await s.subscriptions.cancel(dup.id, { prorate: dup.status !== "trialing", invoice_now: false });
      const msg = dup.status === "trialing"
        ? "Doppeltes Abo in der Testphase gekündigt (keine Abbuchung)"
        : "Doppeltes bezahltes Abo gekündigt – bitte im Stripe-Dashboard prüfen, ob eine Erstattung nötig ist";
      (dup.status === "trialing" ? log.warn : log.error)("billing-reconcile", msg, { customer: customerId, subscription: dup.id, kept: keep?.id, userId: profile?.userId });
    }
  };

  if (!profile) {
    await cancelDuplicates();
    if (keep) log.warn("billing-reconcile", "Stripe-Abo ohne zugehöriges App-Profil", { customer: customerId, subscription: keep.id });
    return result;
  }
  if (opts.dryRun) {
    result.relinked = Boolean(keep && (profile.stripeSubscriptionId !== keep.id || profile.plan !== (keep.metadata?.plan || "premium")));
    result.trialMarked = !profile.usedTrial && hadTrial(all);
    await cancelDuplicates();
    return result;
  }

  if (!profile.stripeCustomerId) {
    await db.update(profiles).set({ stripeCustomerId: customerId }).where(and(eq(profiles.userId, profile.userId), isNull(profiles.stripeCustomerId)));
  }
  if (!profile.usedTrial && hadTrial(all)) {
    await db.update(profiles).set({ usedTrial: true }).where(eq(profiles.userId, profile.userId));
    result.trialMarked = true;
  }
  if (keep) {
    const keepPlan = keep.metadata?.plan in PLANS ? keep.metadata.plan : "premium";
    if (profile.stripeSubscriptionId !== keep.id || profile.plan !== keepPlan) result.relinked = true;
    await applySubscription(profile.userId, keep);
    if (result.relinked) log.info("billing-reconcile", "Profil mit Stripe-Abo neu verknüpft", { userId: profile.userId, subscription: keep.id, status: keep.status });
  } else if (profile.stripeSubscriptionId) {
    // Verknüpftes Abo läuft nicht mehr (oder gehört zu einem anderen Kunden) → echten Status übernehmen
    try {
      await applySubscription(profile.userId, await s.subscriptions.retrieve(profile.stripeSubscriptionId));
    } catch (e) {
      log.warn("billing-reconcile", "Verknüpftes Abo nicht abrufbar", { userId: profile.userId, err: e });
    }
  }
  await cancelDuplicates();
  return result;
}

/**
 * Vollständiger Abgleich: alle laufenden Stripe-Abos (aktiv, Testphase, Zahlungsproblem) je Kunde prüfen
 * und anschließend Profile, die noch auf ein nicht mehr laufendes Abo zeigen, auf den echten Status setzen.
 */
export async function reconcileSubscriptions(opts: { dryRun?: boolean; deadlineAt?: number } = {}) {
  const s = stripe();
  if (!s) return { skipped: "Stripe nicht eingerichtet" as const };
  const outOfTime = () => opts.deadlineAt !== undefined && Date.now() > opts.deadlineAt - 4000;
  const byCustomer = new Map<string, Stripe.Subscription[]>();
  for (const status of LIVE_SUB_STATUSES) {
    for await (const sub of s.subscriptions.list({ status, limit: 100 })) {
      const c = customerOf(sub);
      if (!c) continue;
      byCustomer.set(c, [...(byCustomer.get(c) || []), sub]);
      if (outOfTime()) break;
    }
  }
  const results: CustomerReconcile[] = [];
  const liveIds: string[] = [];
  let partial = false, errors = 0;
  for (const [customer, subs] of byCustomer) {
    if (outOfTime()) { partial = true; break; }
    liveIds.push(...subs.map((x) => x.id));
    try {
      // Mehrere Abos oder fehlende Verknüpfung → mit vollständiger Abo-Historie abgleichen
      results.push(await reconcileCustomer(s, customer, { dryRun: opts.dryRun, allSubs: subs.filter(isAppSub).length > 1 ? undefined : subs }));
    } catch (e) {
      errors++;
      log.error("billing-reconcile", "Abgleich für Kunden fehlgeschlagen", { customer, err: e });
    }
  }
  // Profile mit verknüpftem, aber nicht mehr laufendem Abo (gekündigt, ausgelaufen)
  let stale = 0;
  if (!partial && !opts.dryRun) {
    const where = liveIds.length
      ? and(isNotNull(profiles.stripeSubscriptionId), notInArray(profiles.stripeSubscriptionId, liveIds))
      : isNotNull(profiles.stripeSubscriptionId);
    const rows = await db.select().from(profiles).where(where).limit(200);
    for (const p of rows) {
      if (outOfTime()) { partial = true; break; }
      try {
        const sub = await s.subscriptions.retrieve(p.stripeSubscriptionId!);
        if (!isLiveSub(sub)) { await applySubscription(p.userId, sub); stale++; }
      } catch (e) {
        errors++;
        log.warn("billing-reconcile", "Verknüpftes Abo nicht abrufbar", { userId: p.userId, err: e });
      }
    }
  }
  const changed = results.filter((r) => r.canceled.length || r.relinked || r.trialMarked);
  return {
    dryRun: Boolean(opts.dryRun),
    customers: results.length,
    canceled: results.reduce((n, r) => n + r.canceled.length, 0),
    relinked: results.filter((r) => r.relinked).length,
    trialMarked: results.filter((r) => r.trialMarked).length,
    orphans: results.filter((r) => !r.userId).length,
    staleUnlinked: stale,
    partial, errors,
    changes: changed.map((r) => ({ userId: r.userId, kept: r.kept, canceled: r.canceled, relinked: r.relinked, trialMarked: r.trialMarked })),
  };
}

/** Laufende App-Abos eines Stripe-Kunden (Sperre vor einem neuen Checkout). */
export async function customerSubscriptions(s: Stripe, customerId: string) {
  const all = (await s.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data.filter(isAppSub);
  return { all, live: all.filter(isLiveSub) };
}
