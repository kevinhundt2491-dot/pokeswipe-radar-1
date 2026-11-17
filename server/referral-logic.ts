// Reine Logik (ohne Datenbank) für das gestaffelte Freunde-Empfehlungssystem (?ref=CODE),
// Werber-Meilensteine, „App teilen & testen“ und Video-Promo-Codes (?promo=CODE). Geprüft in tests/referral-promo.test.ts.

/** Tarif, den Empfehlungs-, Teilen- und Promo-Tage freischalten („PokeSwipe Pro“ = Pro-Pass). */
export const GROWTH_PLAN = "pro" as const;
/** 1. geworbener Freund: Werber + Freund je 30 Tage Pro. */
export const REFERRAL_FIRST_DAYS = 30;
/** Ab dem 2. Freund: Werber + Freund je 14 Tage Pro. */
export const REFERRAL_NEXT_DAYS = 14;
/** „App teilen & 14 Tage Pro testen“ (einmalig, nur ohne bisherigen Gratis-Test). */
export const SHARE_TRIAL_DAYS = 14;
/** Promo-Codes: erlaubte Spanne der Gratis-Tage. */
export const PROMO_MIN_DAYS = 1;
export const PROMO_MAX_DAYS = 365;
/** Höchstens so viele Freundes-Gutschriften pro Werber und Tag (Schutz vor Massen-Fake-Konten). */
export const REFERRAL_DAILY_CAP = 20;

export type ReferralMilestone = { count: number; kind: string; badge: string; label: string; icon: string; days: number; reward: string };

/** Meilensteine für den Werber (zählen bestätigte Freunde). Bonus-Tage kommen zusätzlich zu den Tagen pro Freund. */
export const REFERRAL_TIERS: ReferralMilestone[] = [
  { count: 1, kind: "ms_starter", badge: "ref-starter", label: "Starter-Werber", icon: "🌱", days: 0, reward: "30 Tage Pro" },
  { count: 3, kind: "ms_community", badge: "ref-community", label: "Community-Builder", icon: "🏗️", days: 14, reward: "Badge + 14 Extra-Bonus-Tage" },
  { count: 10, kind: "ms_vip", badge: "ref-vip", label: "VIP-Sammler", icon: "💎", days: 30, reward: "Badge + 30 Extra-Bonus-Tage" },
];

/** Pro-Tage für Werber und Freund, abhängig davon, der wievielte bestätigte Freund es ist (1-basiert). */
export function tierRewardDays(ordinal: number): { referrer: number; friend: number } {
  const d = ordinal <= 1 ? REFERRAL_FIRST_DAYS : REFERRAL_NEXT_DAYS;
  return { referrer: d, friend: d };
}

/** Meilensteine, die mit `count` bestätigten Freunden erreicht sind. */
export const milestonesReached = (count: number) => REFERRAL_TIERS.filter((m) => count >= m.count);

/** Nächster Meilenstein mit Badge (für „Noch Y Freunde bis zum nächsten Bonus-Badge“). */
export function nextMilestone(count: number) {
  const m = REFERRAL_TIERS.find((t) => count < t.count);
  return m ? { ...m, missing: m.count - count } : null;
}

/** Bonus-Tage, die bis `count` Freunde insgesamt verdient sind (Freundes-Tage + Meilenstein-Tage) – für Erklärtexte. */
export function totalDaysEarned(count: number) {
  let days = 0;
  for (let i = 1; i <= count; i++) days += tierRewardDays(i).referrer;
  return days + milestonesReached(count).reduce((s, m) => s + m.days, 0);
}

/**
 * E-Mail-Adresse zum Vergleich normalisieren: Kleinschreibung, „+tag“ entfernen,
 * bei Gmail zusätzlich Punkte im Namen (max.mustermann@ = maxmustermann@) und googlemail.com = gmail.com.
 */
export function normalizeEmail(email: string) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at).split("+")[0];
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Selbst-Einladung: gleicher Account oder (normalisiert) gleiche E-Mail. */
export function isSelfReferral(referrer: { userId: string; email: string }, friend: { userId: string; email: string }) {
  return referrer.userId === friend.userId || normalizeEmail(referrer.email) === normalizeEmail(friend.email);
}

/** Bestätigt ist ein geworbener Freund, wenn seine E-Mail verifiziert ist oder er eine erste aktive Aktion ausgeführt hat. */
export const referralQualifies = (s: { emailConfirmed: boolean; activeAction: boolean }) => s.emailConfirmed || s.activeAction;

/** Aktionen, die als „erste aktive Aktion“ gelten (Scannen, Sammlung, Wunschliste) – POST-Pfade der API. */
const ACTIVE_ACTION_RE = /^\/api\/(?:scan(?:\/condition)?|portfolio(?:\/import|\/import-rows|\/by-card\/[^/]+)?|wishlist|graded)$/;
export const isActiveActionPath = (method: string, path: string) => (method === "POST" || method === "PUT") && ACTIVE_ACTION_RE.test(path);

/** Ablaufdatum um `days` verlängern – auf ein noch laufendes Datum aufaddiert, sonst ab jetzt. */
export function extendExpiry(current: Date | null | undefined, days: number, now = Date.now()) {
  const base = current && current.getTime() > now ? current.getTime() : now;
  return new Date(base + days * 86400_000);
}

// ---------------------------------------------------------------------------
// Promo-Codes
// ---------------------------------------------------------------------------
export const PROMO_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
export const normalizePromoCode = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");

export type PromoInput = { code: string; label: string; days: number; maxRedemptions: number | null; active: boolean };

/** Prüft/säubert die Admin-Eingabe für einen Promo-Code. */
export function validatePromoInput(b: Record<string, any>, opts: { partial?: boolean } = {}): { value: Partial<PromoInput>; error: string | null } {
  const v: Partial<PromoInput> = {};
  if (!opts.partial || b.code !== undefined) {
    const code = normalizePromoCode(b.code);
    if (!PROMO_RE.test(code)) return { value: v, error: "Code: 3–24 Zeichen, nur A–Z, 0–9, - und _." };
    v.code = code;
  }
  if (b.label !== undefined) v.label = String(b.label ?? "").trim().slice(0, 80);
  if (!opts.partial || b.days !== undefined) {
    const days = Number(b.days);
    if (!Number.isInteger(days) || days < PROMO_MIN_DAYS || days > PROMO_MAX_DAYS) return { value: v, error: `Gratis-Tage: ganze Zahl von ${PROMO_MIN_DAYS} bis ${PROMO_MAX_DAYS}.` };
    v.days = days;
  }
  if (b.maxRedemptions !== undefined) {
    if (b.maxRedemptions === null || b.maxRedemptions === "" || Number(b.maxRedemptions) === 0) v.maxRedemptions = null;
    else {
      const n = Number(b.maxRedemptions);
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return { value: v, error: "Max. Einlösungen: leer (unbegrenzt) oder 1–1.000.000." };
      v.maxRedemptions = n;
    }
  }
  if (b.active !== undefined) v.active = Boolean(b.active);
  return { value: v, error: null };
}

/** Kann der Code (noch) eingelöst werden? */
export function promoAvailable(p: { active: boolean; maxRedemptions: number | null; redemptions: number } | null | undefined) {
  if (!p) return { ok: false, reason: "Dieser Promo-Code existiert nicht." };
  if (!p.active) return { ok: false, reason: "Dieser Promo-Code ist nicht mehr aktiv." };
  if (p.maxRedemptions != null && p.redemptions >= p.maxRedemptions) return { ok: false, reason: "Dieser Promo-Code ist bereits ausgeschöpft." };
  return { ok: true, reason: "" };
}

/** Einladungs-/Kampagnen-Link bauen. */
export const referralLink = (site: string, code: string) => `${site.replace(/\/$/, "")}/?ref=${encodeURIComponent(code)}`;
export const promoLink = (site: string, code: string) => `${site.replace(/\/$/, "")}/?promo=${encodeURIComponent(code)}`;
