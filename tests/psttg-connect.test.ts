import { test } from "node:test";
import assert from "node:assert/strict";
import { psttgStage, psttgWarningReached, dac7Reportable, PSTTG_WARN_TX, PSTTG_WARN_GROSS_CENTS } from "../server/dac7-logic.ts";
import { escrowPhase } from "../server/market-logic.ts";
import { WEBHOOK_EVENTS, CONNECT_WEBHOOK_EVENTS } from "../server/integrations.ts";

test("PStTG: Vorwarnung ab 25 Verkäufen oder 1.700 €", () => {
  assert.equal(PSTTG_WARN_TX, 25);
  assert.equal(PSTTG_WARN_GROSS_CENTS, 170_000);
  assert.equal(psttgStage({ transactions: 24, grossCents: 169_999, refundedCents: 0 }), "none");
  assert.equal(psttgStage({ transactions: 25, grossCents: 0, refundedCents: 0 }), "warning");
  assert.equal(psttgStage({ transactions: 1, grossCents: 170_000, refundedCents: 0 }), "warning");
  // Erstattungen zählen nicht zum Umsatz
  assert.equal(psttgWarningReached({ transactions: 1, grossCents: 180_000, refundedCents: 20_000 }), false);
});

test("PStTG: Meldepflicht ab 30 Verkäufen oder 2.000 €", () => {
  assert.equal(psttgStage({ transactions: 30, grossCents: 0, refundedCents: 0 }), "reporting");
  assert.equal(psttgStage({ transactions: 3, grossCents: 200_000, refundedCents: 0 }), "reporting");
  assert.equal(psttgStage({ transactions: 29, grossCents: 199_999, refundedCents: 0 }), "warning");
  assert.equal(dac7Reportable({ transactions: 29, grossCents: 210_000, refundedCents: 20_000 }), false);
});

test("Treuhand-Phasen des Direktkaufs", () => {
  assert.equal(escrowPhase("awaiting_payment"), "pending_payment");
  assert.equal(escrowPhase("offered"), "pending_payment");
  assert.equal(escrowPhase("paid"), "paid_in_escrow");
  assert.equal(escrowPhase("shipped"), "shipped");
  assert.equal(escrowPhase("releasing"), "delivered");
  assert.equal(escrowPhase("released"), "released_to_seller");
  assert.equal(escrowPhase("disputed"), "disputed");
  assert.equal(escrowPhase("chargeback"), "disputed");
  assert.equal(escrowPhase("refunded"), "refunded");
  assert.equal(escrowPhase("cancelled"), "cancelled");
});

test("Webhook-Ereignisse für Direktkauf und Connect", () => {
  for (const e of ["checkout.session.completed", "payment_intent.succeeded", "account.updated", "charge.refunded"]) {
    assert.ok((WEBHOOK_EVENTS as readonly string[]).includes(e), e);
  }
  assert.deepEqual([...CONNECT_WEBHOOK_EVENTS], ["account.updated"]);
});
