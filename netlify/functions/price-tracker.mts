import type { Config } from "@netlify/functions";
import { runTracker } from "../../server/prices.ts";

// Echtzeit-Preis-Tracker: holt stündlich die Cardmarket-Preise aller beobachteten Karten,
// prüft Preisalarme und speichert den täglichen Portfolio-Wert.
export default async () => {
  const result = await runTracker({ maxCards: 150 });
  console.log("Preis-Tracker", result);
};

export const config: Config = {
  schedule: "@hourly",
};
