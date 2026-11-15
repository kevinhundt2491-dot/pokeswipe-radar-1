import type { Config } from "@netlify/functions";
import { runSealedPrices } from "../../server/flip.ts";
import { runJob } from "../../server/resilience.ts";

// Automatische Sealed-Preise: aktualisiert alle 3 Stunden Booster-Displays, Top-Trainer-Boxen, Tins und Kollektionen
// aus eBay-Verkäufen, beendeten Auktionen, Sofort-Kaufen-Angeboten und Community-Inseraten, schreibt den Preisverlauf
// und prüft Sealed-Preisalarme. Produkte mit Admin-Override (CSV/Formular) behalten ihren Preis.
export default async () => {
  await runJob("update-sealed-prices", 25_000, (job) =>
    runSealedPrices({ deadlineMs: Math.min(22_000, job.remaining() - 2500), max: 25 }));
};

export const config: Config = {
  schedule: "17 */3 * * *",
};
