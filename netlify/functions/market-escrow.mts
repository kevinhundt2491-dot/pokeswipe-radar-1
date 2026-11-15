// Phase 4: Treuhand-Fristen des Marktplatzes alle 15 Minuten prüfen
//  – Auszahlung an Verkäufer 14 Tage nach Versand ohne Reklamation
//  – unbezahlte Bestellungen / unbeantwortete Angebote verfallen
//  – nicht versendete Käufe nach 7 Tagen automatisch erstatten, Versand-Erinnerungen
import type { Config } from "@netlify/functions";
import { runEscrowJobs } from "../../server/market.ts";
import { stripe } from "../../server/billing.ts";
import { runJob } from "../../server/resilience.ts";

// Zeitbudget 25 s: Auszahlungen/Erstattungen beginnen nur, solange noch mindestens 6 s übrig sind (siehe runEscrowJobs).
export default async () => {
  const run = await runJob("market-escrow", 25_000, async (job) => {
    if (!stripe()) { job.skip("Stripe nicht eingerichtet"); return null; }
    return runEscrowJobs();
  });
  return Response.json({ status: run.status, ...(run.result || {}), ...(run.error ? { error: run.error } : {}) });
};

export const config: Config = { schedule: "*/15 * * * *" };
