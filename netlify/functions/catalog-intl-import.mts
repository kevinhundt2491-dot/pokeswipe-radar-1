import type { Config } from "@netlify/functions";
import { runIntlCatalogImport } from "../../server/intl-catalog.ts";
import { runJob } from "../../server/resilience.ts";

// Mehrsprachiger Katalog: lädt alle 10 Minuten (versetzt zum deutschen Import) die EZB-Wechselkurse,
// gleicht die englischen und japanischen Set-Listen ab, importiert neue Sets mit allen Karten und frischt
// die Preise der ältesten Drucke auf – Cardmarket (EUR) und TCGplayer (USD) getrennt.
export default async () => {
  await runJob("catalog-intl-import", 25_000, (job) =>
    runIntlCatalogImport({ deadlineMs: Math.min(22_000, job.remaining() - 2500), maxSetsPerLang: 4, maxPrices: 60 }));
};

export const config: Config = {
  schedule: "5-59/10 * * * *",
};
