import type { Config } from "@netlify/functions";
import { runFlipSync } from "../../server/flip.ts";
import { ebayConfigured } from "../../server/ebay.ts";
import { runJob } from "../../server/resilience.ts";

// Live Flip-Radar: fragt alle 10 Minuten reihum Karten bei der eBay Browse API ab (Wunschliste/Sammlung zuerst),
// gleicht echte Sofort-Kaufen- und Auktionsangebote gegen den Referenz-Marktpreis ab, speichert Deals (≥ 20 % unter Wert)
// mit direktem ePN-Partner-Link aufs Einzelangebot, übernimmt beendete Auktionen als Verkaufsdaten und schickt Wunschlisten-Push.
// Ohne EBAY_CLIENT_ID/EBAY_CLIENT_SECRET protokolliert der Lauf nur den Demo-Modus.
export default async () => {
  await runJob("flip-radar-sync", 25_000, async (job) => {
    const result = await runFlipSync({ deadlineMs: Math.min(22_000, job.remaining() - 2500), maxTargets: 20, concurrency: 3 });
    if (!ebayConfigured()) job.skip("Demo-Modus: eBay-Schlüssel fehlen");
    return result;
  });
};

export const config: Config = {
  // versetzt zu den Katalog-Importen (0/10/… und 5/15/…)
  schedule: "2-59/10 * * * *",
};
