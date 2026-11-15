import type { Config } from "@netlify/functions";
import { runSealedPrices } from "../../server/flip.ts";

// Automatische Sealed-Preise: aktualisiert alle 3 Stunden Booster-Displays, Top-Trainer-Boxen, Tins und Kollektionen
// aus eBay-Verkäufen, beendeten Auktionen, Sofort-Kaufen-Angeboten und Community-Inseraten, schreibt den Preisverlauf
// und prüft Sealed-Preisalarme. Produkte mit Admin-Override (CSV/Formular) behalten ihren Preis.
export default async () => {
  try {
    const result = await runSealedPrices({ deadlineMs: 24_000, max: 25 });
    console.log("Sealed-Preise", JSON.stringify(result));
  } catch (e) {
    console.error("Sealed-Preise fehlgeschlagen", e);
  }
};

export const config: Config = {
  schedule: "17 */3 * * *",
};
