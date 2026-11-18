// Phase 7: Direktkauf – reine Regeln für Warenkorb, Checkout über mehrere Verkäufer, Widerruf und Händlerangaben
// (ohne Stripe/Datenbank – in tests/cart-logic.test.ts geprüft)
import { feeFor, MARKET_MIN_PRICE_CENTS, MARKET_MAX_PRICE_CENTS } from "./market-logic.ts";
import type { PlanId } from "./plans.ts";
import { atLeastCondition, marketCondition } from "./condition-logic.ts";

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
  /** Gründer-Paket („Die ersten 50 Sammler“) aktiv → 0 % Provision */
  sellerFeeFree?: boolean;
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
    const fee = feeFor(ls[0].sellerPlan, itemsCents, shippingCents, Boolean(ls[0].sellerFeeFree));
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

// ---------------------------------------------------------------------------
// Phase 8: Warenkorb-Optimierer – günstigste Kombination von Verkäufern inkl. Versand
// ---------------------------------------------------------------------------
// Für jede Position im Warenkorb (Karte + Variante + Sprache, Zustand mindestens wie gewählt) werden alle passenden
// Angebote betrachtet. Gesucht ist die Zuordnung mit dem kleinsten Gesamtpreis = Warenwert + Versand je Verkäufer
// (eine Sendung je Verkäufer, höchster Versandpreis zählt – wie shippingForSeller). Das ist ein Standort-Problem
// (NP-schwer); bei Warenkorbgrößen bis 50 Positionen liefert eine lokale Suche mit mehreren Startlösungen in
// Millisekunden sehr gute Ergebnisse. Die aktuelle Zusammenstellung ist immer eine der Startlösungen – das Ergebnis
// ist also nie teurer als der jetzige Warenkorb.

export type OptNeed = {
  key: string; // z. B. cart_item_id
  cardId: string | null;
  variant: string;
  lang: string;
  minCondition: string;
  quantity: number;
  /** Aktuelles Inserat (Startlösung) */
  currentListingId: number;
  title: string;
};

export type OptOffer = {
  listingId: number;
  sellerId: string;
  sellerName: string;
  cardId: string | null;
  variant: string;
  lang: string;
  condition: string;
  unitCents: number;
  shippingCents: number;
  available: number;
};

export type OptAlloc = { listingId: number; quantity: number };
export type OptAssignment = Record<string, OptAlloc[]>; // need.key → Zuteilung

export type OptOptions = { maxSellers?: number; sameCondition?: boolean; maxIterations?: number };

/** Passt ein Angebot zu einer Position? Gleiche Karte, Variante und Sprache; Zustand mindestens wie gewünscht. */
export function offerMatches(need: OptNeed, offer: OptOffer, opts: OptOptions = {}) {
  if (offer.listingId === need.currentListingId) return true;
  if (!need.cardId || offer.cardId !== need.cardId) return false;
  if (offer.variant !== need.variant || offer.lang !== need.lang) return false;
  // Gegradete, versiegelte oder unbekannte Zustände sind nicht vergleichbar → nur das ursprüngliche Inserat
  if (!marketCondition(need.minCondition) || !marketCondition(offer.condition)) return false;
  if (opts.sameCondition) return String(offer.condition).toLowerCase() === String(need.minCondition).toLowerCase();
  return atLeastCondition(offer.condition, need.minCondition);
}

/** Gesamtkosten einer Zuordnung (Warenwert + Versand je Verkäufer). null = unzulässig (Bestand, Menge, Verkäuferzahl). */
export function assignmentCost(needs: OptNeed[], offers: Map<number, OptOffer>, a: OptAssignment, maxSellers = CHECKOUT_MAX_SELLERS) {
  const used = new Map<number, number>();
  const shipBySeller = new Map<string, number>();
  let items = 0;
  for (const n of needs) {
    const allocs = a[n.key] || [];
    if (allocs.reduce((s, x) => s + x.quantity, 0) !== n.quantity) return null;
    for (const x of allocs) {
      const o = offers.get(x.listingId);
      if (!o || x.quantity <= 0) return null;
      const u = (used.get(o.listingId) || 0) + x.quantity;
      if (u > o.available) return null;
      used.set(o.listingId, u);
      items += o.unitCents * x.quantity;
      shipBySeller.set(o.sellerId, Math.max(shipBySeller.get(o.sellerId) || 0, Math.max(0, o.shippingCents)));
    }
  }
  if (shipBySeller.size > maxSellers) return null;
  const shipping = [...shipBySeller.values()].reduce((s, v) => s + v, 0);
  return { itemsCents: items, shippingCents: shipping, totalCents: items + shipping, sellers: shipBySeller.size };
}

/** Ordnet eine Position neu zu – billigste Angebote nach Stückpreis + zusätzlichem Versand bei gegebener Restzuordnung. */
function bestResponse(need: OptNeed, cands: OptOffer[], offers: Map<number, OptOffer>, rest: OptAssignment, needs: OptNeed[]): OptAlloc[] | null {
  const used = new Map<number, number>();
  const ship = new Map<string, number>();
  for (const n of needs) {
    if (n.key === need.key) continue;
    for (const x of rest[n.key] || []) {
      const o = offers.get(x.listingId)!;
      used.set(o.listingId, (used.get(o.listingId) || 0) + x.quantity);
      ship.set(o.sellerId, Math.max(ship.get(o.sellerId) || 0, o.shippingCents));
    }
  }
  let left = need.quantity;
  const out: OptAlloc[] = [];
  const openShip = new Map(ship);
  while (left > 0) {
    let best: { o: OptOffer; take: number; score: number } | null = null;
    for (const o of cands) {
      const free = o.available - (used.get(o.listingId) || 0) - (out.find((x) => x.listingId === o.listingId)?.quantity || 0);
      if (free <= 0) continue;
      const take = Math.min(free, left);
      const extraShip = Math.max(0, o.shippingCents - (openShip.get(o.sellerId) ?? 0));
      const score = (o.unitCents * take + extraShip) / take;
      if (!best || score < best.score || (score === best.score && o.listingId === need.currentListingId)) best = { o, take, score };
    }
    if (!best) return null;
    const ex = out.find((x) => x.listingId === best!.o.listingId);
    if (ex) ex.quantity += best.take; else out.push({ listingId: best.o.listingId, quantity: best.take });
    openShip.set(best.o.sellerId, Math.max(openShip.get(best.o.sellerId) || 0, best.o.shippingCents));
    left -= best.take;
  }
  return out;
}

/**
 * Sucht die günstigste Zusammenstellung. offers enthält alle Kandidaten (inkl. der aktuellen Inserate).
 * Gibt die beste Zuordnung samt Kosten zurück sowie die Kosten der aktuellen Zusammenstellung.
 */
export function optimizeCart(needs: OptNeed[], offerList: OptOffer[], opts: OptOptions = {}) {
  const maxSellers = opts.maxSellers ?? CHECKOUT_MAX_SELLERS;
  const offers = new Map(offerList.map((o) => [o.listingId, o]));
  const cands = new Map(needs.map((n) => [n.key, offerList.filter((o) => offerMatches(n, o, opts)).sort((a, b) => a.unitCents - b.unitCents)]));
  const current: OptAssignment = Object.fromEntries(needs.map((n) => [n.key, [{ listingId: n.currentListingId, quantity: n.quantity }]]));
  const currentCost = assignmentCost(needs, offers, current, Number.MAX_SAFE_INTEGER);

  const improve = (start: OptAssignment) => {
    let a: OptAssignment = JSON.parse(JSON.stringify(start));
    let cost = assignmentCost(needs, offers, a, maxSellers);
    for (let it = 0; it < (opts.maxIterations ?? 30); it++) {
      let changed = false;
      // 1. Jede Position einzeln bestmöglich neu zuordnen
      for (const n of needs) {
        const alloc = bestResponse(n, cands.get(n.key) || [], offers, a, needs);
        if (!alloc) continue;
        const next = { ...a, [n.key]: alloc };
        const c = assignmentCost(needs, offers, next, maxSellers);
        if (c && (!cost || c.totalCents < cost.totalCents)) { a = next; cost = c; changed = true; }
      }
      // 2. Einen Verkäufer komplett schließen und seine Positionen auf andere verteilen (spart dessen Versand)
      const sellers = new Set(needs.flatMap((n) => (a[n.key] || []).map((x) => offers.get(x.listingId)!.sellerId)));
      for (const sid of sellers) {
        let next: OptAssignment = { ...a };
        let ok = true;
        for (const n of needs) {
          if (!(next[n.key] || []).some((x) => offers.get(x.listingId)!.sellerId === sid)) continue;
          const alloc = bestResponse(n, (cands.get(n.key) || []).filter((o) => o.sellerId !== sid), offers, next, needs);
          if (!alloc) { ok = false; break; }
          next = { ...next, [n.key]: alloc };
        }
        if (!ok) continue;
        const c = assignmentCost(needs, offers, next, maxSellers);
        if (c && (!cost || c.totalCents < cost.totalCents)) { a = next; cost = c; changed = true; }
      }
      if (!changed) break;
    }
    return cost ? { a, cost } : null;
  };

  // Startlösungen: aktueller Warenkorb, billigster Stückpreis ohne Versand, und je Verkäufer „möglichst viel bei ihm“
  const starts: OptAssignment[] = [current];
  const cheapest: OptAssignment = {};
  let cheapOk = true;
  for (const n of needs) {
    const alloc = bestResponse(n, cands.get(n.key) || [], offers, cheapest, needs.filter((x) => x.key in cheapest));
    if (!alloc) { cheapOk = false; break; }
    cheapest[n.key] = alloc;
  }
  if (cheapOk) starts.push(cheapest);
  const sellerIds = [...new Set(offerList.map((o) => o.sellerId))].slice(0, 25);
  for (const sid of sellerIds) {
    const s: OptAssignment = { ...current };
    for (const n of needs) {
      const own = (cands.get(n.key) || []).filter((o) => o.sellerId === sid && o.available >= n.quantity);
      if (own.length) s[n.key] = [{ listingId: own[0].listingId, quantity: n.quantity }];
    }
    starts.push(s);
  }

  let best: { a: OptAssignment; cost: NonNullable<ReturnType<typeof assignmentCost>> } | null = null;
  for (const s of starts) {
    if (!assignmentCost(needs, offers, s, Number.MAX_SAFE_INTEGER)) continue;
    const r = improve(s);
    if (r && (!best || r.cost.totalCents < best.cost.totalCents)) best = r;
  }
  if (!best || (currentCost && best.cost.totalCents >= currentCost.totalCents)) {
    return { current: currentCost, best: currentCost, assignment: current, savingsCents: 0, changed: [] as string[] };
  }
  const changed = needs.filter((n) => JSON.stringify(best!.a[n.key]) !== JSON.stringify(current[n.key])).map((n) => n.key);
  return {
    current: currentCost, best: best.cost, assignment: best.a,
    savingsCents: currentCost ? currentCost.totalCents - best.cost.totalCents : 0, changed,
  };
}
