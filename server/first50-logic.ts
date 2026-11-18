// Reine Logik (ohne Datenbank) für die Gründer-Aktion „Die ersten 50 Sammler“.
// Die ersten 50 angemeldeten Konten bekommen automatisch und einmalig:
//   • dauerhaft das „Gründer-Sammler“-Badge
//   • 60 Tage PokeSwipe Pro gratis – in dieser Zeit 0 % Marktplatz-Provision, unbegrenzte Scans & Preisalarme
// Geprüft in tests/first50.test.ts.

export const FIRST50_LIMIT = 50;
export const FIRST50_DAYS = 60;
/** Praktisch „unbegrenzt“ für Scans pro Tag und Preisalarme während des Gründer-Pakets. */
export const FIRST50_UNLIMITED = 100_000;
export const FIRST50_BADGE = "first50";

/** Ist das 60-Tage-Gründer-Paket (0 % Gebühren, unbegrenzt) gerade aktiv? */
export const first50Active = (p: { first50Until?: Date | string | null } | null | undefined, now = Date.now()) =>
  Boolean(p?.first50Until && new Date(p.first50Until).getTime() > now);

/** Freie Plätze (nie negativ, nie über dem Limit). */
export const first50Left = (taken: unknown) => Math.max(0, FIRST50_LIMIT - Math.max(0, Math.min(FIRST50_LIMIT, Math.floor(Number(taken) || 0))));

/** Kurzer Status-Satz für die Fortschrittsbox. */
export function first50Headline(taken: unknown) {
  const left = first50Left(taken);
  if (left <= 0) return `Alle ${FIRST50_LIMIT} Gründer-Plätze sind vergeben – danke an unsere ersten Sammler!`;
  return `Noch ${left} von ${FIRST50_LIMIT} Gründer-Plätzen frei – jetzt kostenlos Konto sichern!`;
}

/** Fortschritt in Prozent (vergebene Plätze). */
export const first50Pct = (taken: unknown) => Math.round(((FIRST50_LIMIT - first50Left(taken)) / FIRST50_LIMIT) * 100);

/** Scan-Tageslimit / Alarm-Limit mit Gründer-Paket. */
export const withFirst50 = (base: number, active: boolean) => (active ? Math.max(Number(base) || 0, FIRST50_UNLIMITED) : Math.max(0, Number(base) || 0));
