import { REFERRAL_TIERS, GROWTH_PLAN } from "./referral-logic.ts";

export type PlanId = "free" | "premium" | "pro";

export const PLANS: Record<PlanId, {
  label: string;
  priceCents: number;
  yearlyPriceCents: number;
  portfolio: number;
  alerts: number;
  wishlist: number;
  listings: number;
  sets: number;
  scansPerDay: number;
  freeBoostsPerMonth: number;
  history: boolean;
  verified: boolean;
  shop: boolean;
  /** Minuten, die Restock-Alarme später ankommen (0 = sofort) */
  restockDelayMin: number;
  /** Restock-Filter nach Shop, Stichwort, Höchstpreis, nur UVP */
  restockFilters: boolean;
  gradedCards: number;
  submissions: number;
  fakeChecksPerMonth: number;
}> = {
  free: { label: "Free", priceCents: 0, yearlyPriceCents: 0, portfolio: 300, alerts: 3, wishlist: 20, listings: 5, sets: 1, scansPerDay: 3, freeBoostsPerMonth: 0, history: false, verified: false, shop: false, restockDelayMin: 15, restockFilters: false, gradedCards: 3, submissions: 1, fakeChecksPerMonth: 1 },
  premium: { label: "Premium", priceCents: 499, yearlyPriceCents: 4900, portfolio: 500, alerts: 50, wishlist: 300, listings: 40, sets: 10, scansPerDay: 40, freeBoostsPerMonth: 0, history: true, verified: false, shop: false, restockDelayMin: 0, restockFilters: false, gradedCards: 200, submissions: 20, fakeChecksPerMonth: 20 },
  pro: { label: "Pro Trader", priceCents: 999, yearlyPriceCents: 9900, portfolio: 5000, alerts: 500, wishlist: 2000, listings: 500, sets: 200, scansPerDay: 250, freeBoostsPerMonth: 3, history: true, verified: true, shop: true, restockDelayMin: 0, restockFilters: true, gradedCards: 5000, submissions: 500, fakeChecksPerMonth: 200 },
};

export const BOOST_PRICE_CENTS = 199;
export const BOOST_DAYS = 7;
export const REFERRAL_TRIAL_DAYS = 30;
/** Gratismonat (Premium) für den Werber, wenn ein geworbener Freund später ein Abo bezahlt – zusätzlich zu den Pro-Tagen pro Freund. */
export const REFERRAL_BONUS_DAYS = 30;
/** Testphase für jedes erste Abo (ohne Empfehlung) */
export const TRIAL_DAYS = 7;
/** Wechsel-Bonus: Premium-Tage für Nutzer, die ihre Sammlung aus einer anderen App importieren (einmalig) */
export const SWITCH_BONUS_DAYS = 30;
/** Mindestzahl importierter Karten mit Live-Preis (liegt unter dem Free-Limit, damit es jeder erreichen kann) */
export const SWITCH_MIN_CARDS = 20;

/**
 * Werber-Meilensteine (gestaffeltes Empfehlungssystem, zählt bestätigte Freunde – siehe referral-logic.ts):
 * 1 Freund „Starter-Werber“, 3 Freunde „Community-Builder“ (+14 Tage), 10 Freunde „VIP-Sammler“ (+30 Tage).
 */
export const REFERRAL_MILESTONES: { count: number; kind: string; plan: "premium" | "pro"; days: number; label: string; icon: string }[] =
  REFERRAL_TIERS.map((t) => ({ count: t.count, kind: t.kind, plan: GROWTH_PLAN, days: t.days, label: `${t.label} – ${t.reward}`, icon: t.icon }));
/** Teilen-Bonus: +1 KI-Scan heute pro neuem Besucher über die eigenen Teilen-Links (max. pro Tag). */
export const SHARE_SCAN_BONUS_MAX = 10;

/** Rangfolge der Tarife (für Bonus-Upgrades). */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, premium: 1, pro: 2 };

/**
 * Bezahlter Tarif gilt, solange das Abo-Ende in der Zukunft liegt (+1 Tag Kulanz).
 * Ein Bonus (Empfehlung, Stufen-Belohnung, Wechsel-Bonus) gilt bis bonusUntil mit bonusPlan (Standard Premium) –
 * liegt der Bonus-Tarif über dem bezahlten (z. B. Pro-Bonus für Premium-Abonnenten), gilt der höhere.
 * bonusUntil ist das „proExpiresAt“ des Empfehlungs-/Promo-Systems: Pro gilt, solange ENTWEDER ein Abo läuft ODER bonusUntil > jetzt;
 * danach fällt der Nutzer automatisch auf den bezahlten Tarif bzw. Free zurück.
 */
export function effectivePlan(
  profile: { plan: string; planUntil: Date | null; bonusUntil?: Date | null; bonusPlan?: string | null } | undefined | null,
): PlanId {
  if (!profile) return "free";
  const plan = (profile.plan in PLANS ? profile.plan : "free") as PlanId;
  const graceMs = 24 * 60 * 60 * 1000;
  const paid: PlanId = plan !== "free" && profile.planUntil && new Date(profile.planUntil).getTime() + graceMs > Date.now() ? plan : "free";
  const bonus: PlanId = profile.bonusUntil && new Date(profile.bonusUntil).getTime() > Date.now()
    ? (profile.bonusPlan === "pro" ? "pro" : "premium") : "free";
  return PLAN_RANK[bonus] > PLAN_RANK[paid] ? bonus : paid;
}

/** Aktive Inserate: Tarif-Limit oder – für Händler mit großem Bestand – das vom Admin freigegebene höhere Limit. */
export function listingLimit(plan: PlanId, override?: number | null): number {
  const base = PLANS[plan]?.listings ?? PLANS.free.listings;
  return override && override > base ? override : base;
}

/** Ablaufdatum des geschenkten Pro-Status (Empfehlung, Promo-Code, Teilen-Test) – null, wenn keiner aktiv ist. */
export function proExpiresAt(profile: { bonusUntil?: Date | null; bonusPlan?: string | null } | null | undefined): Date | null {
  if (!profile?.bonusUntil || profile.bonusPlan !== "pro") return null;
  const d = new Date(profile.bonusUntil);
  return d.getTime() > Date.now() ? d : null;
}

/** Woher der aktuelle Tarif kommt: Abo (stripe/apple), Geschenk (bonus) oder free. */
export function planSource(profile: Parameters<typeof effectivePlan>[0] & { planSource?: string | null }): "subscription" | "bonus" | "free" {
  if (!profile) return "free";
  const eff = effectivePlan(profile);
  if (eff === "free") return "free";
  const paid = effectivePlan({ plan: profile.plan, planUntil: profile.planUntil });
  return paid === eff ? "subscription" : "bonus";
}

