// Phase 4: Treuhand-Fristen des Marktplatzes alle 15 Minuten prüfen
//  – Auszahlung an Verkäufer 14 Tage nach Versand ohne Reklamation
//  – unbezahlte Bestellungen / unbeantwortete Angebote verfallen
//  – nicht versendete Käufe nach 7 Tagen automatisch erstatten, Versand-Erinnerungen
import type { Config } from "@netlify/functions";
import { runEscrowJobs } from "../../server/market.ts";
import { stripe } from "../../server/billing.ts";

export default async () => {
  if (!stripe()) return new Response("Stripe nicht eingerichtet", { status: 200 });
  const result = await runEscrowJobs();
  console.log("Treuhand-Job", JSON.stringify(result));
  return Response.json(result);
};

export const config: Config = { schedule: "*/15 * * * *" };
