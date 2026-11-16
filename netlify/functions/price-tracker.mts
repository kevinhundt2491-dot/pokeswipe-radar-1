import type { Config } from "@netlify/functions";
import { runTracker } from "../../server/prices.ts";
import { runJob } from "../../server/resilience.ts";

// Echtzeit-Preis-Tracker: holt stündlich die Cardmarket-Preise aller beobachteten Karten,
// prüft Preisalarme und speichert den täglichen Portfolio-Wert.
// Nicht geschaffte Karten bleiben veraltet und kommen im nächsten Lauf zuerst dran (Status „partial“).
export default async () => {
  await runJob("price-tracker", 25_000, (job) => runTracker({ maxCards: 150, deadlineMs: job.remaining() - 2500 }));
};

export const config: Config = {
  schedule: "@hourly",
};
