// Abo-Abgleich Stripe ↔ App: reine Entscheidungslogik (ohne Stripe/DB, damit testbar)

export const LIVE_SUB_STATUSES = ["active", "trialing", "past_due"] as const;

export type SubLike = {
  id: string;
  status: string;
  created: number;
  metadata?: Record<string, string> | null;
  trial_start?: number | null;
};

export const isLiveSub = (s: Pick<SubLike, "status">) => (LIVE_SUB_STATUSES as readonly string[]).includes(s.status);

const STATUS_RANK: Record<string, number> = { active: 3, past_due: 2, trialing: 1 };
const PLAN_RANK: Record<string, number> = { pro: 2, premium: 1 };

/**
 * Wählt aus mehreren laufenden Abos eines Kunden das eine, das bleibt:
 * 1. bereits bezahlt (active) vor Zahlungsproblem (past_due) vor Testphase (trialing)
 * 2. höherer Tarif (Pro vor Premium)
 * 3. das bereits in der App verknüpfte Abo
 * 4. das zuerst abgeschlossene
 * Alle anderen laufenden Abos sind Duplikate und werden gekündigt.
 */
export function splitDuplicateSubs<T extends SubLike>(subs: T[], linkedId?: string | null): { keep: T | null; duplicates: T[] } {
  const live = subs.filter(isLiveSub);
  if (!live.length) return { keep: null, duplicates: [] };
  const sorted = [...live].sort((a, b) =>
    (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0)
    || (PLAN_RANK[b.metadata?.plan ?? ""] ?? 0) - (PLAN_RANK[a.metadata?.plan ?? ""] ?? 0)
    || Number(b.id === linkedId) - Number(a.id === linkedId)
    || a.created - b.created
    || a.id.localeCompare(b.id));
  return { keep: sorted[0], duplicates: sorted.slice(1) };
}

/** Hatte der Kunde je ein Abo mit Testphase (egal ob noch laufend)? Dann gibt es keine zweite Testphase. */
export const hadTrial = (subs: SubLike[]) => subs.some((s) => Boolean(s.trial_start) || s.status === "trialing");

/** Abos der App (keine fremden Stripe-Abos desselben Kontos): erkennbar an metadata.plan oder metadata.userId. */
export const isAppSub = (s: SubLike) => Boolean(s.metadata?.userId || s.metadata?.plan);
