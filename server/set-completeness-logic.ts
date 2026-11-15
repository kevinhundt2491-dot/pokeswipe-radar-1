// Set-Vollständigkeit (Phase 6) – reine Logik: importierte Karten eines Sets gegen die offiziellen TCGdex-Zahlen abgleichen.
// • card_count_official = Karten der regulären Nummerierung (1 … official)
// • card_count_total    = inklusive Secret Rares (Nummern über official) und Sonderdrucke (z. B. „TG01“, „GG12“, „SV001“)
// Fehlende Nummern werden nur für die numerische Hauptreihe (1 … official) und die Secret-Reihe (official+1 … total)
// konkret ausgewiesen; Sonderreihen mit Buchstaben-Präfix zählen in die Gesamtsumme.

export type SetCounts = { official: number; total: number };
export type Completeness = {
  imported: number; official: number; total: number;
  mainImported: number; secretImported: number; specialImported: number;
  missingMain: string[]; missingSecret: string[]; missingCount: number;
  status: "complete" | "incomplete" | "unknown";
  pct: number;
};

const MAX_LISTED = 60;

/** localIds der importierten Karten → Abgleich. Promo-Sets ohne offizielle Zahl: status "unknown". */
export function setCompleteness(localIds: Array<string | null | undefined>, counts: SetCounts): Completeness {
  const official = Math.max(0, Math.round(Number(counts.official) || 0));
  const total = Math.max(official, Math.round(Number(counts.total) || 0));
  const numeric = new Set<number>();
  let special = 0;
  const seen = new Set<string>();
  for (const raw of localIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    if (/^\d+$/.test(id)) numeric.add(Number(id));
    else special++;
  }
  const imported = seen.size;
  const mainImported = [...numeric].filter((n) => n >= 1 && n <= official).length;
  const secretImported = [...numeric].filter((n) => n > official).length;
  const missingMain: string[] = [], missingSecret: string[] = [];
  if (official > 0) for (let n = 1; n <= official; n++) if (!numeric.has(n)) missingMain.push(String(n));
  // Secret-Reihe nur ausweisen, wenn die Gesamtzahl nicht durch Sonderreihen erklärt wird
  const secretExpected = Math.max(0, total - official - special);
  if (secretExpected > 0) for (let n = official + 1; n <= official + secretExpected; n++) if (!numeric.has(n)) missingSecret.push(String(n));
  const missingCount = total > 0 ? Math.max(0, total - imported) : 0;
  const status = !total ? "unknown" : missingCount === 0 ? "complete" : "incomplete";
  return {
    imported, official, total, mainImported, secretImported, specialImported: special,
    missingMain: missingMain.slice(0, MAX_LISTED), missingSecret: missingSecret.slice(0, MAX_LISTED), missingCount, status,
    pct: total ? Math.min(100, Math.round((imported / total) * 1000) / 10) : 0,
  };
}
