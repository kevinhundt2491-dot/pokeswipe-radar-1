// Phase 9: Abos aus dem Apple App Store (In-App-Kauf über RevenueCat) – reine Logik ohne Datenbank.
//
// Zahlungs-Weiche:
//   • Web & Android  → Stripe Checkout (unverändert, inkl. § 312k-Kündigungsbutton, Widerruf, AGB)
//   • iOS-App        → Apple In-App-Kauf (StoreKit über das RevenueCat-Plugin); der Kauf wird per RevenueCat-Webhook
//                      serverseitig bestätigt und im Profil als plan_source = "apple" gespeichert
//   • iOS-App EU     → optional externer Kauf nach EU-DMA (nur mit Apple-Berechtigung „StoreKit External Purchase“,
//                      IOS_EXTERNAL_PURCHASE_EU=1): Hinweis-Seite → System-Browser, niemals ein Stripe-Webview in der App
//   • sonst          → neutraler Hinweis ohne Kauf-Link (Apple-Regel 3.1.1/3.1.3: kein „Steering“)
import type { PlanId } from "./plans.ts";

/** Standard-Produkt-IDs in App Store Connect (per IOS_PRODUCT_IDS als JSON überschreibbar). */
export const DEFAULT_IOS_PRODUCTS: Record<string, { plan: Exclude<PlanId, "free">; interval: "month" | "year" }> = {
  "de.pokeswiperadar.premium.monthly": { plan: "premium", interval: "month" },
  "de.pokeswiperadar.premium.yearly": { plan: "premium", interval: "year" },
  "de.pokeswiperadar.pro.monthly": { plan: "pro", interval: "month" },
  "de.pokeswiperadar.pro.yearly": { plan: "pro", interval: "year" },
};

export function iosProducts(raw = process.env.IOS_PRODUCT_IDS): Record<string, { plan: Exclude<PlanId, "free">; interval: "month" | "year" }> {
  if (!raw) return DEFAULT_IOS_PRODUCTS;
  try {
    const parsed = JSON.parse(raw);
    const out: Record<string, { plan: Exclude<PlanId, "free">; interval: "month" | "year" }> = {};
    for (const [id, v] of Object.entries<any>(parsed)) {
      if (/^[A-Za-z0-9._-]{3,100}$/.test(id) && (v?.plan === "premium" || v?.plan === "pro")) out[id] = { plan: v.plan, interval: v.interval === "year" ? "year" : "month" };
    }
    return Object.keys(out).length ? out : DEFAULT_IOS_PRODUCTS;
  } catch { return DEFAULT_IOS_PRODUCTS; }
}

export type IosPaymentMode = "iap" | "external" | "none";

/** Welche Zahlungsart die iOS-App anbietet (nur Konfiguration, keine Geheimnisse). */
export function iosPaymentMode(env: Record<string, string | undefined> = process.env): IosPaymentMode {
  if (/^appl_[A-Za-z0-9]{10,}$/.test(String(env.REVENUECAT_IOS_API_KEY || "").trim())) return "iap";
  if (env.IOS_EXTERNAL_PURCHASE_EU === "1") return "external";
  return "none";
}

/** Ereignisse, nach denen das Abo aktiv ist (Ablauf = expiration_at_ms). */
const ACTIVE_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"]);

export type ApplePlanUpdate =
  | { kind: "active"; plan: Exclude<PlanId, "free">; interval: "month" | "year"; until: Date; cancelAtPeriodEnd: boolean; originalTxId: string | null }
  | { kind: "cancel_at_period_end"; until: Date | null }
  | { kind: "expired" }
  | { kind: "ignore"; reason: string };

/**
 * RevenueCat-Webhook-Ereignis → Änderung am Profil.
 * https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */
export function appleUpdateFromEvent(event: any, products = iosProducts(), now = Date.now()): ApplePlanUpdate {
  if (!event || typeof event !== "object") return { kind: "ignore", reason: "kein Ereignis" };
  if (event.store && event.store !== "APP_STORE") return { kind: "ignore", reason: `Store ${event.store}` };
  if (event.environment === "SANDBOX" && process.env.REVENUECAT_ALLOW_SANDBOX !== "1") return { kind: "ignore", reason: "Sandbox" };
  const type = String(event.type || "");
  const productId = String(event.new_product_id || event.product_id || "");
  const until = Number(event.expiration_at_ms) > 0 ? new Date(Number(event.expiration_at_ms)) : null;
  if (type === "TEST") return { kind: "ignore", reason: "Test-Ereignis" };
  if (type === "EXPIRATION") return { kind: "expired" };
  if (type === "CANCELLATION") {
    // Erstattung durch Apple (cancel_reason CUSTOMER_SUPPORT) beendet sofort, normale Kündigung zum Laufzeitende
    if (event.cancel_reason === "CUSTOMER_SUPPORT" && (!until || until.getTime() <= now)) return { kind: "expired" };
    return { kind: "cancel_at_period_end", until };
  }
  if (type === "BILLING_ISSUE") return until && until.getTime() > now ? { kind: "cancel_at_period_end", until } : { kind: "expired" };
  if (!ACTIVE_EVENTS.has(type)) return { kind: "ignore", reason: `Ereignis ${type}` };
  const p = products[productId];
  if (!p) return { kind: "ignore", reason: `unbekanntes Produkt ${productId}` };
  if (!until || until.getTime() <= now) return { kind: "expired" };
  return {
    kind: "active", plan: p.plan, interval: p.interval, until, cancelAtPeriodEnd: false,
    originalTxId: event.original_transaction_id ? String(event.original_transaction_id).slice(0, 80) : null,
  };
}
