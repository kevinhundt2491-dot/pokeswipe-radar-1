// Phase 4: reine Regeln des Treuhand-Marktplatzes (ohne Stripe/Datenbank – in tests/market-logic.test.ts geprüft)
import type { PlanId } from "./plans.ts";

/** Plattform-Provision in Basispunkten (1 % = 100) je Tarif des VERKÄUFERS – Pro-Pass-Inhaber zahlen am wenigsten. */
export const MARKET_FEE_BPS: Record<PlanId, number> = { free: 650, premium: 500, pro: 300 };
/** Mindestprovision (deckt die Stripe-Gebühren auch bei Kleinbeträgen) */
export const MARKET_MIN_FEE_CENTS = 49;
export const MARKET_MIN_PRICE_CENTS = 100;
export const MARKET_MAX_PRICE_CENTS = 1_000_000; // 10.000 €
export const MARKET_MAX_SHIPPING_CENTS = 2_500;
/** Käufer hat nach Annahme eines Angebots so lange Zeit zum Bezahlen */
export const PAY_WINDOW_HOURS = 48;
/** Verkäufer muss nach Zahlung innerhalb dieser Frist versenden, sonst automatische Erstattung */
export const SHIP_WINDOW_DAYS = 7;
/** Ohne Reklamation wird der Betrag so viele Tage nach Versand automatisch an den Verkäufer ausgezahlt */
export const AUTO_RELEASE_DAYS = 14;
/** Unbeantwortete Angebote verfallen nach */
export const OFFER_TTL_HOURS = 72;
/** Länder für den Versand (Adresse wird in Stripe Checkout erfasst) */
export const SHIP_COUNTRIES = ["DE", "AT", "CH", "NL", "BE", "LU", "FR", "IT", "ES", "PL", "DK", "CZ"] as const;
export const CONDITIONS: Record<string, string> = {
  mint: "Mint", nm: "Near Mint", ex: "Excellent", gd: "Good", lp: "Light Played", pl: "Played", po: "Poor", graded: "Gegradet (Slab)", sealed: "Sealed / OVP",
};
export const CARRIERS: Record<string, string> = { dhl: "DHL", dpd: "DPD", hermes: "Hermes", gls: "GLS", ups: "UPS", post: "Deutsche Post (Warensendung/Brief)", other: "Andere" };

export function feeFor(plan: PlanId, priceCents: number, shippingCents = 0) {
  const bps = MARKET_FEE_BPS[plan] ?? MARKET_FEE_BPS.free;
  const gross = Math.max(0, Math.round(priceCents)) + Math.max(0, Math.round(shippingCents));
  const fee = Math.min(gross, Math.max(MARKET_MIN_FEE_CENTS, Math.round((Math.max(0, priceCents) * bps) / 10_000)));
  return { bps, feeCents: fee, totalCents: gross, payoutCents: gross - fee };
}

export type OrderStatus = "offered" | "awaiting_payment" | "paid" | "shipped" | "disputed" | "releasing" | "released" | "refunded" | "cancelled" | "declined";
export type OrderRole = "buyer" | "seller" | "admin" | "system";
export type OrderAction = "accept" | "decline" | "pay" | "cancel" | "ship" | "confirm" | "dispute" | "refund" | "release" | "expire";

/** Erlaubte Zustandsübergänge: [Rolle, Aktion, von] → nach */
const TRANSITIONS: [OrderRole, OrderAction, OrderStatus[], OrderStatus][] = [
  ["seller", "accept", ["offered"], "awaiting_payment"],
  ["seller", "decline", ["offered"], "declined"],
  ["buyer", "cancel", ["offered", "awaiting_payment"], "cancelled"],
  ["seller", "cancel", ["awaiting_payment"], "cancelled"],
  ["seller", "refund", ["paid", "shipped", "disputed"], "refunded"], // Verkäufer storniert nach Zahlung → volle Erstattung
  ["seller", "ship", ["paid"], "shipped"],
  ["buyer", "confirm", ["paid", "shipped"], "released"],
  ["buyer", "dispute", ["paid", "shipped"], "disputed"],
  ["admin", "refund", ["paid", "shipped", "disputed"], "refunded"],
  ["admin", "release", ["paid", "shipped", "disputed"], "released"],
  ["system", "expire", ["offered", "awaiting_payment"], "cancelled"],
  ["system", "release", ["shipped"], "released"],
  ["system", "refund", ["paid"], "refunded"],
];

export function nextStatus(role: OrderRole, action: OrderAction, from: OrderStatus): OrderStatus | null {
  const t = TRANSITIONS.find(([r, a, f]) => r === role && a === action && f.includes(from));
  return t ? t[3] : null;
}

/** Ein Angebot muss mindestens 50 % des Inseratspreises betragen (gegen Spam-Angebote). */
export function validOffer(listingCents: number, offerCents: number) {
  return Number.isInteger(offerCents) && offerCents >= MARKET_MIN_PRICE_CENTS && offerCents <= listingCents && offerCents >= Math.ceil(listingCents * 0.5);
}

/** Sendungsnummer: 6–40 Zeichen, nur Buchstaben/Ziffern/Bindestrich. */
export const validTracking = (s: string) => /^[A-Za-z0-9-]{6,40}$/.test(s);

/** Link zur Sendungsverfolgung beim Versanddienst. */
export function trackingUrl(carrier: string, number: string): string {
  const n = encodeURIComponent(number);
  switch (carrier) {
    case "dhl": case "post": return `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`;
    case "dpd": return `https://tracking.dpd.de/status/de_DE/parcel/${n}`;
    case "hermes": return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${n}`;
    case "gls": return `https://gls-group.com/DE/de/paketverfolgung?match=${n}`;
    case "ups": return `https://www.ups.com/track?loc=de_DE&tracknum=${n}`;
    default: return "";
  }
}
