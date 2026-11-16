// Echtes Swipe-Trading (Phase 6) – reine Logik ohne Datenbank:
// • Paar-Normalisierung für trade_matches (user_a < user_b)
// • Wertvergleich eines strukturierten Tauschs inkl. Wertausgleich (Cash)
// • Statusübergänge des Tauschs: pending → accepted → shipping → completed (oder declined / cancelled)
import { CARRIERS, validTracking } from "./market-logic.ts";

export type TradeStatus = "pending" | "accepted" | "shipping" | "completed" | "declined" | "cancelled";
export type TradeRole = "sender" | "receiver"; // sender = from_user (Anfragender), receiver = to_user (Inserent/Partner)
export type CashPayer = "from" | "to" | "";

export const TRADE_MAX_ITEMS_PER_SIDE = 10;
export const TRADE_MAX_CASH_CENTS = 500_000; // 5.000 €
/** Bis zu diesem Wertunterschied (Anteil am größeren Paket) gilt ein Tausch als fair. */
export const TRADE_FAIR_TOLERANCE = 0.15;

/** Sortiertes Nutzerpaar – ein Match zwischen A und B ist dasselbe wie zwischen B und A. */
export function orderPair(x: string, y: string): { userA: string; userB: string; swapped: boolean } {
  return x < y ? { userA: x, userB: y, swapped: false } : { userA: y, userB: x, swapped: true };
}

export type ValuedItem = { valueCents: number; quantity: number };
const sumValue = (items: ValuedItem[]) =>
  items.reduce((s, i) => s + Math.max(0, Math.round(i.valueCents)) * Math.max(1, Math.round(i.quantity)), 0);

/**
 * Wertvergleich: Was gibt der Anfragende (from), was der Partner (to) – inkl. Wertausgleich.
 * diffCents > 0: der Anfragende gibt mehr; < 0: der Partner gibt mehr.
 */
export function tradeBalance(fromItems: ValuedItem[], toItems: ValuedItem[], cashCents = 0, payer: CashPayer = "") {
  const fromValue = sumValue(fromItems);
  const toValue = sumValue(toItems);
  const cash = Math.max(0, Math.round(cashCents));
  const fromGives = fromValue + (payer === "from" ? cash : 0);
  const toGives = toValue + (payer === "to" ? cash : 0);
  const diffCents = fromGives - toGives;
  const larger = Math.max(fromGives, toGives);
  const ratio = larger ? Math.abs(diffCents) / larger : 0;
  const verdict: "fair" | "from_overpays" | "to_overpays" = ratio <= TRADE_FAIR_TOLERANCE ? "fair" : diffCents > 0 ? "from_overpays" : "to_overpays";
  return { fromValue, toValue, fromGives, toGives, diffCents, ratio: Math.round(ratio * 1000) / 1000, verdict };
}

/** Vorschlag für einen Wertausgleich: die Seite mit dem geringeren Kartenwert legt die Differenz drauf (auf 50 ct gerundet). */
export function suggestCash(fromValueCents: number, toValueCents: number): { cashCents: number; payer: CashPayer } {
  const diff = Math.round(toValueCents) - Math.round(fromValueCents);
  if (Math.abs(diff) < 100) return { cashCents: 0, payer: "" };
  const cash = Math.min(TRADE_MAX_CASH_CENTS, Math.round(Math.abs(diff) / 50) * 50);
  return { cashCents: cash, payer: diff > 0 ? "from" : "to" };
}

export function parseCash(rawCents: unknown, rawPayer: unknown): { cashCents: number; payer: CashPayer } | { error: string } {
  const cents = rawCents === undefined || rawCents === null || rawCents === "" ? 0 : Number(rawCents);
  if (!Number.isInteger(cents) || cents < 0 || cents > TRADE_MAX_CASH_CENTS) return { error: "Ungültiger Wertausgleich (0 bis 5.000 €)." };
  const payer = String(rawPayer ?? "");
  if (cents === 0) return { cashCents: 0, payer: "" };
  if (payer !== "from" && payer !== "to") return { error: "Bitte angeben, wer den Wertausgleich zahlt." };
  return { cashCents: cents, payer };
}

export type TradeState = {
  status: TradeStatus;
  hasItems: boolean;
  fromConfirmed: boolean; toConfirmed: boolean;
  fromShippedAt: Date | null; toShippedAt: Date | null;
  fromReceivedAt: Date | null; toReceivedAt: Date | null;
};
export type TradeActionInput = { action: string; carrier?: unknown; tracking?: unknown };
export type TradeTransition =
  | { ok: true; updates: Record<string, unknown>; message: string; completed: boolean }
  | { ok: false; error: string; status: 400 | 403 | 409 };

/**
 * Prüft eine Aktion und liefert die Datenbank-Änderungen.
 * Strukturierte Tausche: beide Seiten versenden (mit Sendungsnummer) und bestätigen den Erhalt des Gegenpakets.
 * Alte Freitext-Tausche ohne Positionen behalten die einfache beidseitige Bestätigung („complete“).
 */
export function tradeTransition(t: TradeState, role: TradeRole, input: TradeActionInput, now = new Date()): TradeTransition {
  const a = String(input.action || "");
  const mine = role === "sender" ? "from" : "to";
  const other = role === "sender" ? "to" : "from";
  const shipped = (side: "from" | "to") => (side === "from" ? t.fromShippedAt : t.toShippedAt);
  const received = (side: "from" | "to") => (side === "from" ? t.fromReceivedAt : t.toReceivedAt);

  if (a === "accept" || a === "decline") {
    if (role !== "receiver") return { ok: false, error: "Nur der Tauschpartner kann annehmen oder ablehnen.", status: 403 };
    if (t.status !== "pending") return { ok: false, error: "Diese Anfrage ist nicht mehr offen.", status: 409 };
    return a === "accept"
      ? { ok: true, updates: { status: "accepted" }, message: "✅ Tausch angenommen – bitte versenden", completed: false }
      : { ok: true, updates: { status: "declined" }, message: "❌ Tausch abgelehnt", completed: false };
  }
  if (a === "cancel") {
    if (!["pending", "accepted"].includes(t.status)) return { ok: false, error: "Nach dem Versand kann der Tausch nicht mehr abgebrochen werden.", status: 409 };
    if (t.fromShippedAt || t.toShippedAt) return { ok: false, error: "Nach dem Versand kann der Tausch nicht mehr abgebrochen werden.", status: 409 };
    return { ok: true, updates: { status: "cancelled" }, message: "🚫 Tausch abgebrochen", completed: false };
  }
  if (a === "ship") {
    if (!t.hasItems) return { ok: false, error: "Für diesen Tausch gibt es keinen Versandschritt.", status: 409 };
    if (!["accepted", "shipping"].includes(t.status)) return { ok: false, error: "Versand ist erst nach der Annahme möglich.", status: 409 };
    if (shipped(mine)) return { ok: false, error: "Du hast deinen Versand schon eingetragen.", status: 409 };
    const carrier = String(input.carrier ?? "");
    const tracking = String(input.tracking ?? "").replace(/\s+/g, "").toUpperCase();
    if (!CARRIERS[carrier]) return { ok: false, error: "Bitte einen Versanddienst wählen.", status: 400 };
    if (carrier !== "post" && carrier !== "other" && !validTracking(tracking)) return { ok: false, error: "Bitte eine gültige Sendungsnummer angeben.", status: 400 };
    return {
      ok: true,
      updates: { status: "shipping", [`${mine}Carrier`]: carrier, [`${mine}Tracking`]: tracking.slice(0, 40), [`${mine}ShippedAt`]: now },
      message: "📦 Partner hat versendet",
      completed: false,
    };
  }
  if (a === "received") {
    if (!t.hasItems) return { ok: false, error: "Bitte „Erhalt bestätigen“ verwenden.", status: 409 };
    if (t.status !== "shipping") return { ok: false, error: "Es ist noch kein Paket unterwegs.", status: 409 };
    if (!shipped(other)) return { ok: false, error: "Dein Partner hat noch nicht versendet.", status: 409 };
    if (received(other)) return { ok: false, error: "Du hast den Erhalt schon bestätigt.", status: 409 };
    // received(other) = Ich habe das Paket der anderen Seite erhalten
    const fromReceived = other === "from" ? now : t.fromReceivedAt;
    const toReceived = other === "to" ? now : t.toReceivedAt;
    const done = Boolean(fromReceived && toReceived);
    return {
      ok: true,
      updates: { [`${other}ReceivedAt`]: now, ...(done ? { status: "completed", fromConfirmed: true, toConfirmed: true } : {}) },
      message: done ? "🏆 Tausch abgeschlossen – bitte bewerten" : "📬 Partner hat dein Paket erhalten",
      completed: done,
    };
  }
  if (a === "complete") {
    if (t.hasItems) return { ok: false, error: "Bitte Versand und Erhalt über die Tausch-Schritte bestätigen.", status: 409 };
    if (t.status !== "accepted") return { ok: false, error: "Diese Aktion ist gerade nicht möglich.", status: 409 };
    const fromConfirmed = t.fromConfirmed || role === "sender";
    const toConfirmed = t.toConfirmed || role === "receiver";
    const done = fromConfirmed && toConfirmed;
    return {
      ok: true,
      updates: { fromConfirmed, toConfirmed, status: done ? "completed" : "accepted" },
      message: done ? "🏆 Tausch abgeschlossen – bitte bewerten" : "📦 Partner hat den Erhalt bestätigt",
      completed: done,
    };
  }
  return { ok: false, error: "Unbekannte Aktion.", status: 400 };
}

export type MatchCandidate = { reason: "like" | "wishlist"; listingId: number | null; portfolioItemId: number | null; valueCents: number };
/** Beste Gegenseite für ein Match: gegenseitige Likes vor Wunschlisten-Treffern, danach höherer Wert. */
export function bestCounterpart(list: MatchCandidate[]): MatchCandidate | null {
  if (!list.length) return null;
  return [...list].sort((x, y) => (x.reason === y.reason ? y.valueCents - x.valueCents : x.reason === "like" ? -1 : 1))[0];
}

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  pending: "Angefragt", accepted: "Angenommen – Versand offen", shipping: "Versand läuft", completed: "Abgeschlossen",
  declined: "Abgelehnt", cancelled: "Abgebrochen",
};
