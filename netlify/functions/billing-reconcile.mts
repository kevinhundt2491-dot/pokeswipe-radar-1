// Abo-Abgleich Stripe → App (stündlich): doppelte Abos eines Kunden kündigen (bevor die Testphase in eine
// Abbuchung übergeht), Profile mit ihrem laufenden Stripe-Abo neu verknüpfen und genutzte Testphasen vermerken.
import type { Config } from "@netlify/functions";
import { reconcileSubscriptions, stripe } from "../../server/billing.ts";
import { runJob } from "../../server/resilience.ts";

export default async () => {
  const run = await runJob("billing-reconcile", 25_000, async (job) => {
    if (!stripe()) { job.skip("Stripe nicht eingerichtet"); return null; }
    const result = await reconcileSubscriptions({ deadlineAt: job.at });
    if ("partial" in result && result.partial) job.markPartial("Zeitbudget erreicht – Rest im nächsten Lauf");
    return result;
  });
  return Response.json({ status: run.status, ...(run.result || {}), ...(run.error ? { error: run.error } : {}) });
};

export const config: Config = { schedule: "7 * * * *" };
