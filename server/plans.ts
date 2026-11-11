export type PlanId = "free" | "premium" | "pro";

export const PLANS: Record<PlanId, {
  label: string;
  priceCents: number;
  portfolio: number;
  alerts: number;
  listings: number;
  sets: number;
  scansPerDay: number;
  freeBoostsPerMonth: number;
  history: boolean;
  verified: boolean;
  shop: boolean;
}> = {
  free: { label: "Free", priceCents: 0, portfolio: 25, alerts: 3, listings: 5, sets: 1, scansPerDay: 3, freeBoostsPerMonth: 0, history: false, verified: false, shop: false },
  premium: { label: "Premium", priceCents: 499, portfolio: 500, alerts: 50, listings: 40, sets: 10, scansPerDay: 40, freeBoostsPerMonth: 0, history: true, verified: false, shop: false },
  pro: { label: "Pro Trader", priceCents: 999, portfolio: 5000, alerts: 500, listings: 500, sets: 200, scansPerDay: 250, freeBoostsPerMonth: 3, history: true, verified: true, shop: true },
};

export const BOOST_PRICE_CENTS = 199;
export const BOOST_DAYS = 7;
export const REFERRAL_TRIAL_DAYS = 30;
export const REFERRAL_BONUS_DAYS = 30;

/**
 * Bezahlter Tarif gilt, solange das Abo-Ende in der Zukunft liegt (+1 Tag Kulanz).
 * Danach greift ein ggf. vorhandener Gratismonat aus dem Empfehlungsprogramm (Premium).
 */
export function effectivePlan(
  profile: { plan: string; planUntil: Date | null; bonusUntil?: Date | null } | undefined | null,
): PlanId {
  if (!profile) return "free";
  const plan = (profile.plan in PLANS ? profile.plan : "free") as PlanId;
  const graceMs = 24 * 60 * 60 * 1000;
  if (plan !== "free" && profile.planUntil && new Date(profile.planUntil).getTime() + graceMs > Date.now()) return plan;
  if (profile.bonusUntil && new Date(profile.bonusUntil).getTime() > Date.now()) return "premium";
  return "free";
}
