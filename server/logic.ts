// Reine Rechen-Logik ohne Datenbank – wird vom Server genutzt und in tests/ geprüft.

export type BadgeStats = {
  portfolioCount: number;
  portfolioValue: number;
  completedTrades: number;
  bestStreak: number;
  scans: number;
  wishlistCount: number;
  referralsRewarded: number;
  reviewsAvg: number;
  reviewsCount: number;
};

export type Badge = { id: string; icon: string; label: string; description: string; test: (s: BadgeStats) => boolean };

export const BADGES: Badge[] = [
  { id: "first-card", icon: "🃏", label: "Erste Karte", description: "Erste Karte im Portfolio", test: (s) => s.portfolioCount >= 1 },
  { id: "collector-50", icon: "📚", label: "Sammler", description: "50 Karten im Portfolio", test: (s) => s.portfolioCount >= 50 },
  { id: "collector-250", icon: "🏛️", label: "Archivar", description: "250 Karten im Portfolio", test: (s) => s.portfolioCount >= 250 },
  { id: "value-100", icon: "💶", label: "Dreistellig", description: "Portfolio über 100 €", test: (s) => s.portfolioValue >= 100 },
  { id: "value-1000", icon: "💰", label: "Tausender-Club", description: "Portfolio über 1.000 €", test: (s) => s.portfolioValue >= 1000 },
  { id: "value-10000", icon: "👑", label: "Schatzkammer", description: "Portfolio über 10.000 €", test: (s) => s.portfolioValue >= 10000 },
  { id: "trade-1", icon: "🤝", label: "Erster Tausch", description: "Ersten Tausch abgeschlossen", test: (s) => s.completedTrades >= 1 },
  { id: "trade-10", icon: "🔁", label: "Tausch-Profi", description: "10 Tausche abgeschlossen", test: (s) => s.completedTrades >= 10 },
  { id: "trusted", icon: "🛡️", label: "Vertrauenswürdig", description: "Mindestens 5 Bewertungen mit Ø 4,5+", test: (s) => s.reviewsCount >= 5 && s.reviewsAvg >= 4.5 },
  { id: "streak-3", icon: "🔥", label: "Am Ball", description: "3 Tage in Folge dabei", test: (s) => s.bestStreak >= 3 },
  { id: "streak-7", icon: "⚡", label: "Wochen-Serie", description: "7 Tage in Folge dabei", test: (s) => s.bestStreak >= 7 },
  { id: "streak-30", icon: "🌟", label: "Monats-Serie", description: "30 Tage in Folge dabei", test: (s) => s.bestStreak >= 30 },
  { id: "scanner", icon: "📷", label: "Scanner", description: "10 Karten gescannt", test: (s) => s.scans >= 10 },
  { id: "wishlist", icon: "❤️", label: "Wunschzettel", description: "5 Karten auf der Wunschliste", test: (s) => s.wishlistCount >= 5 },
  { id: "recruiter", icon: "🎁", label: "Botschafter", description: "Einen Freund geworben, der Premium nutzt", test: (s) => s.referralsRewarded >= 1 },
];

export const earnedBadges = (s: BadgeStats) => BADGES.filter((b) => b.test(s)).map((b) => b.id);

/** Tag als YYYY-MM-DD in deutscher Zeit (damit die Serie um Mitternacht hier umspringt). */
export function berlinDay(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

/** Neue Serie nach einem täglichen Besuch. */
export function nextStreak(last: string | null, streak: number, today: string) {
  if (last === today) return { streak, changed: false };
  if (last && dayDiff(last, today) === 1) return { streak: streak + 1, changed: true };
  return { streak: 1, changed: true };
}

/**
 * Lohnt sich Grading? Erwartungswert aus Wahrscheinlichkeiten für PSA 10 / PSA 9 / schlechter.
 * Bei "schlechter" wird mit dem Rohpreis gerechnet (Slab verkauft sich etwa wie raw).
 */
export function gradingEstimate(i: { raw: number; psa10: number; psa9: number; p10: number; p9: number; fee: number; shipping: number }) {
  const p10 = Math.min(100, Math.max(0, i.p10)) / 100;
  const p9 = Math.min(1 - p10, Math.max(0, i.p9) / 100);
  const rest = Math.max(0, 1 - p10 - p9);
  const expected = p10 * i.psa10 + p9 * i.psa9 + rest * i.raw;
  const cost = i.fee + i.shipping;
  const profit = expected - cost - i.raw;
  const breakEven10 = i.psa10 > i.raw ? Math.max(0, Math.min(100, ((i.raw + cost - p9 * i.psa9 - (1 - p9) * i.raw) / (i.psa10 - i.raw)) * 100)) : null;
  return { expected, cost, profit, worth: profit > 0, breakEven10 };
}

export function weeklySummary(i: { value: number; valueWeekAgo: number | null; top?: { name: string; change: number } | null }) {
  const lines: string[] = [];
  const fmt = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  if (i.valueWeekAgo && i.valueWeekAgo > 0) {
    const diff = i.value - i.valueWeekAgo;
    const pct = (diff / i.valueWeekAgo) * 100;
    lines.push(`Dein Portfolio: ${fmt(i.value)} (${diff >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")} % zur Vorwoche).`);
  } else {
    lines.push(`Dein Portfolio ist ${fmt(i.value)} wert.`);
  }
  if (i.top) lines.push(`Top-Mover: ${i.top.name} ${i.top.change >= 0 ? "+" : ""}${i.top.change.toFixed(1).replace(".", ",")} %.`);
  return lines.join(" ");
}
