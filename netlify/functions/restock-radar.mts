import type { Config } from "@netlify/functions";
import { runRestockJobs } from "../../server/drops.ts";

// Alle 2 Minuten: beobachtete Produktseiten prüfen (Restock & Vorbestellungen) und Alarme verschicken –
// bezahlte Tarife sofort, Free mit Verzögerung.
export default async () => {
  try {
    const result = await runRestockJobs({ deadlineMs: 22_000 });
    console.log("Restock-Radar", result);
  } catch (e) {
    console.error("Restock-Radar fehlgeschlagen", e);
  }
};

export const config: Config = {
  schedule: "*/2 * * * *",
};
