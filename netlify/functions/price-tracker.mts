import type { Config } from "@netlify/functions";
import { runTracker } from "../../server/prices.ts";

// Echtzeit-Preis-Tracker: holt stündlich die Cardmarket-Preise aller beobachteten Karten,
// prüft Preisalarme und speichert den täglichen Portfolio-Wert.
export default async () => {
  try {
    const result = await runTracker({ maxCards: 150 });
    console.log("Preis-Tracker", result);
  } catch (e) {
    console.error("Preis-Tracker fehlgeschlagen", e);
  }
};

export const config: Config = {
  schedule: "@hourly",
};
