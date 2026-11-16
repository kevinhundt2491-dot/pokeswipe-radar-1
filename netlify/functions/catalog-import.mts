import type { Config } from "@netlify/functions";
import { runCatalogImport } from "../../server/catalog.ts";
import { runJob } from "../../server/resilience.ts";

// Deutscher Kartenkatalog: gleicht alle 10 Minuten die Set-Liste ab, importiert neue/alte Sets mit allen
// Einzelkarten und frischt die Cardmarket-Preise der ältesten Katalogkarten auf (Grundlage für /sets, /set/… und /karte/…).
// Nach dem ersten Deploy ist der komplette Katalog nach wenigen Stunden importiert; Preise folgen schrittweise.
// Zeitbudget 25 s (Plattform-Limit 30 s); der Import selbst endet 2,5 s vorher, damit das Protokoll noch gespeichert wird.
export default async () => {
  await runJob("catalog-import", 25_000, (job) =>
    runCatalogImport({ deadlineMs: Math.min(22_000, job.remaining() - 2500), maxSets: 3, maxPrices: 60 }));
};

export const config: Config = {
  schedule: "*/10 * * * *",
};
