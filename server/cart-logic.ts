// Phase 7: Direktkauf – reine Regeln für Warenkorb, Checkout über mehrere Verkäufer, Widerruf und Händlerangaben
// (ohne Stripe/Datenbank – in tests/cart-logic.test.ts geprüft)
import { feeFor, MARKET_MIN_PRICE_CENTS, MARKET_MAX_PRICE_CENTS } from "./market-logic.ts";
import type { PlanId } from "./plans.ts";

/** Höchstzahl verschiedener Inserate im Warenkorb und Stück je Position */
export const CART_MAX_LINES = 50;
export const CART_MAX_QTY = 99;
/** Höchstzahl Verkäufer je Checkout (je Verkäufer eine Teilbestellung mit eigenem Versand und eigener Auszahlung) */
export const CHECKOUT_MAX_SELLERS = 10;
/** Stripe-Checkout-Sitzung läuft so lange; Reservierungen werden danach (mit Puffer) freigegeben */
export const CHECKOUT_TTL_MIN = 60;
export const RESERVATION_GRACE_MIN = 20;
/** Gesetzliches Widerrufsrecht (§ 355 Abs. 2 BGB) bei Käufen von gewerblichen Händlern */
export const WITHDRAWAL_DAYS = 14;

export type CartLine = {
  cartItemId: number;
  listingId: number;
  sellerId: string;
  sellerName: string;
  sellerType: "private" | "business";
  sellerPlan: PlanId;
  title: string;
  image: string;
  variant: string;
  condition: string;
  lang: string;
  cardId: string | null;
  unitCents: number;
  priceCentsAtAdd: number;
  shippingCents: number;
  quantity: number;
  available: number; // quantity - reserved des Inserats
  buyable: boolean; // aktiv, Sofort-Kauf, Verkäufer verifiziert, nicht gesperrt
};

export type SellerGroup = {
  sellerId: string;
  sellerName: string;
  sellerType: "private" | "business";
  lines: CartLine[];
  itemsCents: number;
  shippingCents: number;
  feeCents: number;
  feeBps: number;
  payoutCents: number;
  totalCents: number;
  itemCount: number;
};

export type LineProblem = { listingId: number; title: string; problem: "unavailable" | "not_buyable" | "quantity" | "price_changed" };

/**
 * Versand je Verkäufer: eine Sendung pro Verkäufer – es gilt der höchste Versandpreis der Positionen
 * (eine Einzelkarte als Brief, ein Display als Paket → Paketpreis). So zahlt man bei 20 Karten eines Händlers nur einmal Versand.
 */
export function shippingForSeller(lines: Pick<CartLine, "shippingCents">[]): number {
  return lines.reduce((m, l) => Math.max(m, Math.max(0, Math.round(l.shippingCents) || 0)), 0);
}

/** Prüft die Positionen und gruppiert sie nach Verkäufer (Reihenfolge: Verkäufer mit höchstem Warenwert zuerst). */
export function groupCart(lines: CartLine[]): { groups: SellerGroup[]; problems: LineProblem[]; itemsCents: number; shippingCents: number; totalCents: number } {
  const problems: LineProblem[] = [];
  const ok: CartLine[] = [];
  for (const l of lines) {
    if (!l.buyable) { problems.push({ listingId: l.listingId, title: l.title, problem: "not_buyable" }); continue; }
    if (l.available <= 0) { problems.push({ listingId: l.listingId, title: l.title, problem: "unavailable" }); continue; }
    if (l.quantity > l.available) { problems.push({ listingId: l.listingId, title: l.title, problem: "quantity" }); continue; }
    if (l.unitCents !== l.priceCentsAtAdd) problems.push({ listingId: l.listingId, title: l.title, problem: "price_changed" });
    ok.push(l);
  }
  const bySeller = new Map<string, CartLine[]>();
  for (const l of ok) bySeller.set(l.sellerId, [...(bySeller.get(l.sellerId) || []), l]);
  const groups: SellerGroup[] = [...bySeller.values()].map((ls) => {
    const itemsCents = ls.reduce((s, l) => s + l.unitCents * l.quantity, 0);
    const shippingCents = shippingForSeller(ls);
    const fee = feeFor(ls[0].sellerPlan, itemsCents, shippingCents);
    return {
      sellerId: ls[0].sellerId, sellerName: ls[0].sellerName, sellerType: ls[0].sellerType, lines: ls,
      itemsCents, shippingCents, feeCents: fee.feeCents, feeBps: fee.bps, payoutCents: fee.payoutCents,
      totalCents: itemsCents + shippingCents, itemCount: ls.reduce((s, l) => s + l.quantity, 0),
    };
  }).sort((a, b) => b.itemsCents - a.itemsCents);
  const itemsCents = groups.reduce((s, g) => s + g.itemsCents, 0);
  const shippingCents = groups.reduce((s, g) => s + g.shippingCents, 0);
  return { groups, problems, itemsCents, shippingCents, totalCents: itemsCents + shippingCents };
}

/** Nur Probleme, die einen Checkout verhindern (Preisänderungen werden angezeigt, blockieren aber nicht nach Bestätigung). */
export const blockingProblems = (problems: LineProblem[]) => problems.filter((p) => p.problem !== "price_changed");

/** Titel einer Teilbestellung für Mitteilungen und die Bestellübersicht. */
export function sellerOrderTitle(lines: Pick<CartLine, "title" | "quantity">[]): string {
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const first = lines[0]?.title || "Karte";
  if (count <= 1) return first.slice(0, 160);
  return `${count} Artikel: ${first}${lines.length > 1 ? ` + ${lines.length - 1} weitere` : ` (${count}×)`}`.slice(0, 160);
}

/** Einzelpreis prüfen (1 € bis 10.000 € wie beim Einzelkauf). */
export const validUnitPrice = (cents: number) => Number.isInteger(cents) && cents >= MARKET_MIN_PRICE_CENTS && cents <= MARKET_MAX_PRICE_CENTS;

// ---------------------------------------------------------------------------
// Widerruf (nur gewerbliche Händler → Verbraucher)
// ---------------------------------------------------------------------------
type WithdrawalOrder = { sellerType: string; status: string; withdrawalUntil: Date | string | null; frozen?: boolean };

/** Darf der Käufer jetzt widerrufen? (gewerblicher Händler, versendet oder abgeschlossen, Frist läuft, nicht eingefroren) */
export function withdrawalOpen(o: WithdrawalOrder, now = new Date()): boolean {
  if (o.sellerType !== "business" || o.frozen) return false;
  if (!["shipped", "released"].includes(o.status)) return false;
  if (!o.withdrawalUntil) return false;
  return new Date(o.withdrawalUntil).getTime() >= now.getTime();
}

/**
 * Ende der Widerrufsfrist. Die Frist beginnt mit Erhalt der Ware (§ 356 Abs. 2 BGB). Beim Versand ist der Erhalt
 * noch nicht bekannt → großzügig bis Ende der Treuhand-Prüffrist + 14 Tage; bestätigt der Käufer den Erhalt,
 * gilt ab dann 14 Tage (aber nie kürzer als eine bereits zugesagte Frist).
 */
export function withdrawalDeadline(event: "shipped" | "received", at: Date, autoReleaseDays: number, current?: Date | string | null): Date {
  const days = event === "shipped" ? autoReleaseDays + WITHDRAWAL_DAYS : WITHDRAWAL_DAYS;
  const next = new Date(at.getTime() + days * 86400_000);
  if (event === "received" && current) {
    const cur = new Date(current);
    // Bestätigung des Erhalts darf die Frist nicht verkürzen, wenn sie schon länger läuft
    return cur.getTime() > next.getTime() ? cur : next;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Anbieterangaben gewerblicher Verkäufer (Art. 246d § 1 Nr. 4 EGBGB / § 5 DDG)
// ---------------------------------------------------------------------------
export type BusinessInput = { sellerType?: unknown; businessName?: unknown; businessAddress?: unknown; businessEmail?: unknown; businessPhone?: unknown; businessVatId?: unknown; businessRegister?: unknown };
export type BusinessProfile = { sellerType: "private" | "business"; businessName: string; businessAddress: string; businessEmail: string; businessPhone: string; businessVatId: string; businessRegister: string };

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function validateBusinessProfile(input: BusinessInput): { ok: true; value: BusinessProfile } | { ok: false; error: string } {
  const sellerType = input.sellerType === "business" ? "business" : "private";
  const value: BusinessProfile = {
    sellerType,
    businessName: clip(input.businessName, 120),
    businessAddress: clip(input.businessAddress, 240),
    businessEmail: clip(input.businessEmail, 160).toLowerCase(),
    businessPhone: clip(input.businessPhone, 40),
    businessVatId: clip(input.businessVatId, 20).toUpperCase().replace(/\s/g, ""),
    businessRegister: clip(input.businessRegister, 120),
  };
  if (sellerType === "private") return { ok: true, value: { ...value, businessName: "", businessAddress: "", businessEmail: "", businessPhone: "", businessVatId: "", businessRegister: "" } };
  if (value.businessName.length < 2) return { ok: false, error: "Bitte den Namen bzw. die Firma angeben." };
  if (value.businessAddress.length < 10 || !/\d{4,5}/.test(value.businessAddress)) return { ok: false, error: "Bitte die vollständige Anschrift (Straße, PLZ, Ort) angeben." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.businessEmail)) return { ok: false, error: "Bitte eine gültige geschäftliche E-Mail-Adresse angeben." };
  if (value.businessVatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(value.businessVatId)) return { ok: false, error: "Die USt-IdNr. hat ein ungültiges Format (z. B. DE123456789)." };
  if (value.businessPhone && !/^[+0-9][0-9 ()/-]{5,}$/.test(value.businessPhone)) return { ok: false, error: "Die Telefonnummer hat ein ungültiges Format." };
  return { ok: true, value };
}
