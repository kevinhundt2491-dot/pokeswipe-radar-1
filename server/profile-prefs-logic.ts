// Profil-Upgrade: reine Logik (ohne Datenbank) für Avatar und geräteübergreifende App-Einstellungen.
// Wird von /api/me (GET/PUT) und beim ersten Login (ensureProfile) genutzt und ist in tests/session-profile.test.ts abgedeckt.

/** Bekannte, sichere Avatar-Quellen: Google-/Facebook-Profilbilder, Gravatar und eigene Bilder (/api/images/…). */
const AVATAR_HOSTS = [
  /^lh\d?\.googleusercontent\.com$/,
  /^[a-z0-9-]+\.googleusercontent\.com$/,
  /^platform-lookaside\.fbsbx\.com$/,
  /^graph\.facebook\.com$/,
  /^scontent[a-z0-9.-]*\.fbcdn\.net$/,
  /^(www\.|secure\.)?gravatar\.com$/,
  /^avatars\.githubusercontent\.com$/,
];

/**
 * Avatar-URL prüfen: nur https von bekannten Profilbild-Diensten oder eigene Bild-Pfade. Alles andere ergibt "".
 * Ein leerer String ist ausdrücklich erlaubt (= Avatar entfernen, Initiale anzeigen).
 */
export function sanitizeAvatarUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 600) return "";
  if (/^\/api\/images\/[A-Za-z0-9_\-./]{1,200}$/.test(s) && !s.includes("..")) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    return AVATAR_HOSTS.some((re) => re.test(u.hostname.toLowerCase())) ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Erlaubte Einstellungen mit Prüf-Funktion – unbekannte Schlüssel werden verworfen. */
const PREF_RULES: Record<string, (v: unknown) => unknown> = {
  lang: (v) => (v === "de" || v === "en" ? v : undefined),
  uiMode: (v) => (v === "simple" || v === "pro" ? v : undefined),
  marketMode: (v) => (v === "buy" || v === "trade" || v === "mine" ? v : undefined),
  marketFilter: (v) => (typeof v === "string" && ["all", "trade", "sale", "nm", "price_asc"].includes(v) ? v : undefined),
  communityPanel: (v) => (v === "chat" || v === "wall" ? v : undefined),
  pushSound: (v) => (typeof v === "boolean" ? v : undefined),
  homeTips: (v) => (typeof v === "boolean" ? v : undefined),
  // "" = kein Emoji (Profilbild bzw. Initiale anzeigen)
  avatarEmoji: (v) => (v === "" || (typeof v === "string" && /^[\p{Extended_Pictographic}\u200d\ufe0f]{1,8}$/u.test(v)) ? v : undefined),
};

export const PREF_KEYS = Object.keys(PREF_RULES);

/** Einstellungen aus einer Anfrage bereinigen (nur bekannte Schlüssel und Werte, flach, klein). */
export function sanitizePrefs(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, rule] of Object.entries(PREF_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const v = rule((raw as Record<string, unknown>)[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Gespeicherte und neue Einstellungen zusammenführen (neue Werte gewinnen, ungültige alte fallen weg). */
export function mergePrefs(stored: unknown, incoming: unknown): Record<string, unknown> {
  return { ...sanitizePrefs(stored), ...sanitizePrefs(incoming) };
}
