import type { Config } from "@netlify/functions";
import { runHashIndex } from "../../server/scan-index.ts";

// On-Device-Scanner: berechnet alle 10 Minuten die Bild-Fingerabdrücke (pHash/dHash) weiterer Karten aus den kleinen
// TCGdex-Bildern – wertvolle und neue Karten zuerst. Daraus entsteht der Index, mit dem der Browser Karten selbst erkennt.
export default async () => {
  try {
    const result = await runHashIndex({ deadlineMs: 24_000, max: 600, concurrency: 8 });
    console.log("Scanner-Index", JSON.stringify(result));
  } catch (e) {
    console.error("Scanner-Index fehlgeschlagen", e);
  }
};

export const config: Config = {
  // versetzt zu den anderen Jobs (0/10…, 2/12…, 5/15…)
  schedule: "7-59/10 * * * *",
};
