import type { Config } from "@netlify/functions";
import { runCatalogImport } from "../../server/catalog.ts";

// Deutscher Kartenkatalog: gleicht alle 10 Minuten die Set-Liste ab, importiert neue/alte Sets mit allen
// Einzelkarten und frischt die Cardmarket-Preise der ältesten Katalogkarten auf (Grundlage für /sets, /set/… und /karte/…).
// Nach dem ersten Deploy ist der komplette Katalog nach wenigen Stunden importiert; Preise folgen schrittweise.
export default async () => {
  try {
    const result = await runCatalogImport({ deadlineMs: 24_000, maxSets: 3, maxPrices: 60 });
    console.log("Katalog-Import", JSON.stringify(result));
  } catch (e) {
    console.error("Katalog-Import fehlgeschlagen", e);
  }
};

export const config: Config = {
  schedule: "*/10 * * * *",
};
