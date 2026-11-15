import type { Config } from "@netlify/functions";
import { runIntlCatalogImport } from "../../server/intl-catalog.ts";

// Mehrsprachiger Katalog: lädt alle 10 Minuten (versetzt zum deutschen Import) die EZB-Wechselkurse,
// gleicht die englischen und japanischen Set-Listen ab, importiert neue Sets mit allen Karten und frischt
// die Preise der ältesten Drucke auf – Cardmarket (EUR) und TCGplayer (USD) getrennt.
export default async () => {
  try {
    const result = await runIntlCatalogImport({ deadlineMs: 22_000, maxSetsPerLang: 4, maxPrices: 60 });
    console.log("Katalog-Import (en/ja)", JSON.stringify(result));
  } catch (e) {
    console.error("Katalog-Import (en/ja) fehlgeschlagen", e);
  }
};

export const config: Config = {
  schedule: "5-59/10 * * * *",
};
