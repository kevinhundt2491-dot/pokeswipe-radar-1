// Abo-Abgleich Stripe ↔ App: welches Abo bleibt, welche Duplikate werden gekündigt, Testphase genutzt?
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDuplicateSubs, hadTrial, isAppSub, isLiveSub } from "../server/billing-logic.ts";
import { JOB_INTERVAL_MIN } from "../server/alerts-logic.ts";
import { SCHEDULED_JOBS } from "../server/ops.ts";

const sub = (id: string, status: string, created: number, plan = "pro", extra: any = {}) =>
  ({ id, status, created, metadata: { plan, userId: "u1" }, ...extra });

test("Vier parallele Pro-Testabos: genau eines bleibt, drei werden gekündigt", () => {
  const subs = [sub("sub_b", "trialing", 200), sub("sub_a", "trialing", 100), sub("sub_d", "trialing", 400), sub("sub_c", "trialing", 300)];
  const { keep, duplicates } = splitDuplicateSubs(subs);
  assert.equal(keep?.id, "sub_a"); // das zuerst abgeschlossene
  assert.deepEqual(duplicates.map((d) => d.id).sort(), ["sub_b", "sub_c", "sub_d"]);
});

test("Bereits verknüpftes Abo bleibt bevorzugt, bezahlte und höhere Tarife vor Testphase", () => {
  const subs = [sub("sub_a", "trialing", 100), sub("sub_b", "trialing", 200)];
  assert.equal(splitDuplicateSubs(subs, "sub_b").keep?.id, "sub_b");
  assert.equal(splitDuplicateSubs([...subs, sub("sub_paid", "active", 500)], "sub_b").keep?.id, "sub_paid");
  assert.equal(splitDuplicateSubs([sub("p", "trialing", 1, "premium"), sub("x", "trialing", 9, "pro")]).keep?.id, "x");
});

test("Beendete Abos zählen nicht als laufend und werden nie gekündigt", () => {
  const { keep, duplicates } = splitDuplicateSubs([sub("old", "canceled", 1), sub("new", "trialing", 2)]);
  assert.equal(keep?.id, "new");
  assert.equal(duplicates.length, 0);
  assert.deepEqual(splitDuplicateSubs([sub("old", "canceled", 1)]), { keep: null, duplicates: [] });
  assert.equal(isLiveSub({ status: "past_due" }), true);
  assert.equal(isLiveSub({ status: "incomplete_expired" }), false);
});

test("Testphase gilt als genutzt, auch wenn das Abo schon gekündigt ist", () => {
  assert.equal(hadTrial([sub("a", "canceled", 1, "pro", { trial_start: 123 })]), true);
  assert.equal(hadTrial([sub("a", "trialing", 1)]), true);
  assert.equal(hadTrial([sub("a", "active", 1, "pro", { trial_start: null })]), false);
});

test("Nur App-Abos werden abgeglichen, der Job ist im Wächter registriert", () => {
  assert.equal(isAppSub({ id: "x", status: "active", created: 1, metadata: {} }), false);
  assert.equal(isAppSub(sub("y", "active", 1)), true);
  assert.equal(JOB_INTERVAL_MIN["billing-reconcile"], 60);
  assert.ok((SCHEDULED_JOBS as readonly string[]).includes("billing-reconcile"));
});
