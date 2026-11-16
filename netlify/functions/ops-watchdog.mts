// Phase 8: Betriebs-Wächter alle 10 Minuten – meldet Fehler-Spitzen, zahlungskritische Fehler, überfällige Jobs und
// Probleme mit dem Stripe-Webhook an die Admins (Mitteilung/Push, E-Mail, optional Webhook). Regeln: server/alerts-logic.ts
import type { Config } from "@netlify/functions";
import { runJob } from "../../server/resilience.ts";
import { runWatchdog } from "../../server/alerts.ts";

export default async () => {
  const run = await runJob("ops-watchdog", 20_000, async () => runWatchdog());
  return Response.json({ status: run.status, ...(run.result || {}), ...(run.error ? { error: run.error } : {}) });
};

export const config: Config = { schedule: "*/10 * * * *" };
