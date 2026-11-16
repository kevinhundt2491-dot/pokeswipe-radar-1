import type { Config } from "@netlify/functions";
import { runHashIndex } from "../../server/scan-index.ts";
import { runJob } from "../../server/resilience.ts";

// On-Device-Scanner: berechnet alle 10 Minuten die Bild-Fingerabdrücke (pHash/dHash) weiterer Karten aus den kleinen
// TCGdex-Bildern – wertvolle und neue Karten zuerst. Daraus entsteht der Index, mit dem der Browser Karten selbst erkennt.
export default async () => {
  await runJob("scan-hash-index", 25_000, (job) =>
    runHashIndex({ deadlineMs: Math.min(22_000, job.remaining() - 2500), max: 600, concurrency: 8 }));
};

export const config: Config = {
  // versetzt zu den anderen Jobs (0/10…, 2/12…, 5/15…)
  schedule: "7-59/10 * * * *",
};
