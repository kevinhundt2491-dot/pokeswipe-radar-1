import type { Config } from "@netlify/functions";
import { runFlipSync } from "../../server/flip.ts";

// Live Flip-Radar: fragt alle 10 Minuten reihum Karten bei der eBay Browse API ab (Wunschliste/Sammlung zuerst),
// gleicht echte Sofort-Kaufen- und Auktionsangebote gegen den Referenz-Marktpreis ab, speichert Deals (≥ 20 % unter Wert)
// mit direktem ePN-Partner-Link aufs Einzelangebot, übernimmt beendete Auktionen als Verkaufsdaten und schickt Wunschlisten-Push.
// Ohne EBAY_CLIENT_ID/EBAY_CLIENT_SECRET protokolliert der Lauf nur den Demo-Modus.
export default async () => {
  try {
    const result = await runFlipSync({ deadlineMs: 24_000, maxTargets: 20, concurrency: 3 });
    console.log("Flip-Radar-Sync", JSON.stringify(result));
  } catch (e) {
    console.error("Flip-Radar-Sync fehlgeschlagen", e);
  }
};

export const config: Config = {
  // versetzt zu den Katalog-Importen (0/10/… und 5/15/…)
  schedule: "2-59/10 * * * *",
};
