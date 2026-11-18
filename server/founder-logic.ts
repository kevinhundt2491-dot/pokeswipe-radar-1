// Reine Logik (ohne Datenbank) für die „Freunde einladen & Karten hochladen“-Belohnung („Gründer-Sammler“).
// Wer ENTWEDER 5 eigene Karten/Bilder im Binder oder Marktplatz hochlädt ODER mindestens 1 neuen Sammler über
// seinen Einladungslink zur Anmeldung bringt, schaltet automatisch dauerhaft frei:
//   • verifiziertes „Gründer-Sammler“-Badge im Live-Chat & Marktplatz
//   • kostenlose Top-Platzierung (Gratis-Boosts) für eigene Inserate
//   • erweiterte Preis-Alarme
// Geprüft in tests/founder-binder.test.ts.

/** Ziel 1: eigene Karten-Uploads (Binder-Einträge + Karten-Inserate). */
export const FOUNDER_UPLOAD_GOAL = 5;
/** Ziel 2: erfolgreiche Anmeldungen über den eigenen Einladungslink. */
export const FOUNDER_SIGNUP_GOAL = 1;
/** Zusätzliche Gratis-Boosts pro Monat für Gründer-Sammler. */
export const FOUNDER_FREE_BOOSTS = 3;
/** Zusätzliche Preis-Alarme für Gründer-Sammler. */
export const FOUNDER_EXTRA_ALERTS = 15;
/** Badge-Schlüssel in user_badges. */
export const FOUNDER_BADGE = "founder";
export const FOUNDER_LABEL = "Gründer-Sammler";
export const FOUNDER_ICON = "🏅";

export const FOUNDER_PERKS = [
  { icon: "🏅", title: "Verifiziertes Gründer-Sammler-Badge", text: "im Live-Chat und an deinen Marktplatz-Inseraten" },
  { icon: "🚀", title: `${FOUNDER_FREE_BOOSTS} Gratis-Boosts jeden Monat`, text: "Top-Platzierung für deine Inserate – kostenlos" },
  { icon: "🔔", title: `+${FOUNDER_EXTRA_ALERTS} Preis-Alarme`, text: "erweitertes Preis-Radar für deine Wunschkarten" },
] as const;

export type FounderInput = { uploads: number; signups: number; founderAt?: Date | string | null };
export type FounderStatus = {
  unlocked: boolean;
  uploads: number; uploadGoal: number; uploadPct: number; uploadsMissing: number;
  signups: number; signupGoal: number; signupPct: number; signupsMissing: number;
  /** Fortschritt des „näheren“ Ziels in Prozent (0–100) – für die eine große Fortschrittsanzeige. */
  pct: number;
  /** Kurzer, motivierender Status-Satz. */
  headline: string;
  unlockedVia: "uploads" | "signup" | "";
};

const clampCount = (n: unknown) => Math.max(0, Math.min(1_000_000, Math.floor(Number(n) || 0)));
const pctOf = (n: number, goal: number) => Math.min(100, Math.round((n / goal) * 100));

/** Ist die Belohnung (jetzt) verdient? 5 Uploads ODER 1 geworbene Anmeldung. */
export const founderQualifies = (uploads: number, signups: number) =>
  clampCount(uploads) >= FOUNDER_UPLOAD_GOAL || clampCount(signups) >= FOUNDER_SIGNUP_GOAL;

/** Zähler im Profil sind monoton: gelöschte Karten nehmen eine einmal erreichte Zahl nicht wieder weg. */
export const monotonic = (stored: unknown, computed: unknown) => Math.max(clampCount(stored), clampCount(computed));

export function founderStatus(i: FounderInput): FounderStatus {
  const uploads = clampCount(i.uploads), signups = clampCount(i.signups);
  const unlocked = Boolean(i.founderAt) || founderQualifies(uploads, signups);
  const uploadPct = pctOf(uploads, FOUNDER_UPLOAD_GOAL), signupPct = pctOf(signups, FOUNDER_SIGNUP_GOAL);
  const uploadsMissing = Math.max(0, FOUNDER_UPLOAD_GOAL - uploads), signupsMissing = Math.max(0, FOUNDER_SIGNUP_GOAL - signups);
  const pct = unlocked ? 100 : Math.max(uploadPct, signupPct);
  const headline = unlocked
    ? `${FOUNDER_ICON} ${FOUNDER_LABEL} freigeschaltet – deine Gratis-Boosts & Sammler-Vorteile sind aktiv!`
    : `Noch ${uploadsMissing} Karte${uploadsMissing === 1 ? "" : "n"} hochladen ODER 1 Sammler-Kumpel einladen – dann sind deine Gratis-Boosts freigeschaltet.`;
  const unlockedVia = !unlocked ? "" : signups >= FOUNDER_SIGNUP_GOAL ? "signup" : uploads >= FOUNDER_UPLOAD_GOAL ? "uploads" : "";
  return {
    unlocked, uploads, uploadGoal: FOUNDER_UPLOAD_GOAL, uploadPct, uploadsMissing,
    signups, signupGoal: FOUNDER_SIGNUP_GOAL, signupPct, signupsMissing, pct, headline, unlockedVia,
  };
}

/** Gratis-Boosts pro Monat: Tarif-Kontingent + Gründer-Bonus. */
export const boostAllowance = (planBoosts: number, founder: boolean) => Math.max(0, Number(planBoosts) || 0) + (founder ? FOUNDER_FREE_BOOSTS : 0);
/** Preis-Alarm-Limit: Tarif-Limit + Gründer-Bonus. */
export const alertAllowance = (planAlerts: number, founder: boolean) => Math.max(0, Number(planAlerts) || 0) + (founder ? FOUNDER_EXTRA_ALERTS : 0);

/** Pfade, nach denen der Upload-Zähler neu berechnet wird (Binder-Einträge, Importe, Inserate). */
const UPLOAD_PATH_RE = /^\/api\/(?:portfolio(?:\/import|\/import-rows|\/by-card\/[^/]+)?|listings)$/;
export const isUploadPath = (method: string, path: string) => (method === "POST" || method === "PUT") && UPLOAD_PATH_RE.test(path);

/** Einladungstext für 1-Tap-Teilen (WhatsApp, TikTok, Instagram …) mit persönlichem Link. */
export function inviteShareText(link: string, name = "") {
  const who = String(name || "").replace(/^@/, "").trim();
  return `🔥 ${who ? `${who} lädt dich ein: ` : ""}Scanne deine Pokémon-Karten in Sekunden, sieh live ihren Cardmarket-Wert und tausch/verkauf direkt mit anderen Sammlern – auf PokeSwipe Radar. Gemeinsam wird der Marktplatz voll! Hol dir mit meinem Link Pro-Tage geschenkt 👉 ${link}`;
}

/** Werbetext oberhalb der Fortschrittsanzeige. */
export const INVITE_CALL =
  "Gemeinsam wird der Marktplatz voll: Lade 5 Karten hoch oder hol einen Sammler-Kumpel rein – schalte sofort Gratis-Boosts & Sammler-Vorteile frei!";
