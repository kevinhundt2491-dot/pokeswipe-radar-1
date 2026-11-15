// Phase 6: Trust-Grenzen für Treuhand-Käufe, DAC7-Schwellen & Steuerdaten, Stripe-Webhook-Ereignisse, Stripe Tax
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEscrowLimit, ESCROW_LIMITS } from "../server/community-logic.ts";
import {
  dac7Reportable, commercialReasons, dac7ReminderDue, dac7Blocked, validGermanTin, validIban, validateTaxInfo, taxInfoComplete, csvCell,
  DAC7_TX_THRESHOLD, DAC7_GROSS_THRESHOLD_CENTS,
} from "../server/dac7-logic.ts";
import { nextStatus } from "../server/market-logic.ts";
import { WEBHOOK_EVENTS } from "../server/integrations.ts";
import { taxNotActivated } from "../server/billing.ts";

test("Trust-Grenzen: neue Konten dürfen nur kleine Beträge per Treuhand bezahlen", () => {
  assert.equal(checkEscrowLimit("buy", 0, false, ESCROW_LIMITS.new.buyCents).ok, true);
  const tooMuch = checkEscrowLimit("buy", 0, false, ESCROW_LIMITS.new.buyCents + 1);
  assert.equal(tooMuch.ok, false);
  assert.ok(!tooMuch.ok && /150/.test(tooMuch.error));
  assert.equal(checkEscrowLimit("sell", 100, false, 400_000).ok, true);
  const flagged = checkEscrowLimit("buy", 100, true, 100);
  assert.equal(flagged.ok, false);
});

test("DAC7: Meldeschwellen 30 Verkäufe oder 2.000 €", () => {
  const s = (transactions: number, grossCents: number, refundedCents = 0) => ({ transactions, grossCents, refundedCents, feeCents: 0 } as any);
  assert.equal(dac7Reportable(s(DAC7_TX_THRESHOLD - 1, DAC7_GROSS_THRESHOLD_CENTS - 1)), false);
  assert.equal(dac7Reportable(s(DAC7_TX_THRESHOLD, 0)), true);
  assert.equal(dac7Reportable(s(1, DAC7_GROSS_THRESHOLD_CENTS)), true);
  assert.ok(commercialReasons({ ...s(45, 100_000) }).length > 0);
  assert.equal(commercialReasons(s(3, 1_000)).length, 0);
});

test("DAC7: Erinnerungen und Sperre ohne Steuerdaten", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  assert.equal(dac7ReminderDue({ reportable: true, hasTaxInfo: false, remindersSent: 0, lastReminderAt: null }, now), true);
  assert.equal(dac7ReminderDue({ reportable: true, hasTaxInfo: true, remindersSent: 0, lastReminderAt: null }, now), false);
  assert.equal(dac7Blocked({ reportable: true, hasTaxInfo: false, remindersSent: 0, lastReminderAt: null }, now), false);
  assert.equal(dac7Blocked({ reportable: true, hasTaxInfo: false, remindersSent: 2, lastReminderAt: new Date("2026-10-01T00:00:00Z") }, now), true);
});

test("DAC7: Steuer-ID, IBAN und Pflichtangaben", () => {
  assert.equal(validGermanTin("86095742719"), true);
  assert.equal(validGermanTin("12345678901"), false);
  assert.equal(validIban("DE89 3704 0044 0532 0130 00"), true);
  assert.equal(validIban("DE89370400440532013001"), false);
  const ok = validateTaxInfo({ sellerType: "individual", legalName: "Max Muster", street: "Hauptstr. 1", postalCode: "50667", city: "Köln", country: "DE", birthDate: "1990-05-01", taxId: "86095742719", iban: "DE89370400440532013000" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(taxInfoComplete(ok.value), true);
  const noBirth = validateTaxInfo({ sellerType: "individual", legalName: "Max Muster", street: "Hauptstr. 1", postalCode: "50667", city: "Köln", country: "DE", taxId: "86095742719" });
  assert.equal(noBirth.ok, false);
  assert.ok(!csvCell("=HYPERLINK(1)").startsWith("="));
});

test("Stripe-Webhook: Rückbuchungen sind abonniert, eingefrorene Bestellungen haben keine Übergänge", () => {
  for (const e of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "checkout.session.completed", "customer.subscription.deleted", "invoice.payment_failed"]) {
    assert.ok((WEBHOOK_EVENTS as readonly string[]).includes(e), e);
  }
  for (const action of ["release", "refund", "confirm", "ship", "dispute"] as const) {
    assert.equal(nextStatus("admin", action, "chargeback"), null);
    assert.equal(nextStatus("buyer", action, "chargeback_lost"), null);
  }
});

test("Stripe Tax: fehlende Steuer-Einrichtung wird erkannt (Checkout fällt dann ohne Steuer zurück)", () => {
  assert.equal(taxNotActivated({ type: "StripeInvalidRequestError", param: "automatic_tax[enabled]", message: "x" }), true);
  assert.equal(taxNotActivated({ type: "StripeInvalidRequestError", message: "Stripe Tax has not been activated on your account." }), true);
  assert.equal(taxNotActivated({ type: "StripeCardError", message: "declined" }), false);
});
