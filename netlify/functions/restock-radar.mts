import type { Config } from "@netlify/functions";
import { runRestockJobs } from "../../server/drops.ts";
import { runJob } from "../../server/resilience.ts";

// Alle 2 Minuten: beobachtete Produktseiten prüfen (Restock & Vorbestellungen) und Alarme verschicken –
// bezahlte Tarife sofort, Free mit Verzögerung.
// Jeder Shop hat einen eigenen Circuit („shop:<host>“) – ein ausgefallener Shop bremst die übrigen nicht aus.
export default async () => {
  await runJob("restock-radar", 25_000, (job) => runRestockJobs({ deadlineMs: Math.min(22_000, job.remaining() - 2500) }));
};

export const config: Config = {
  schedule: "*/2 * * * *",
};
