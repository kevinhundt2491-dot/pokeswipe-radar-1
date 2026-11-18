// PokeSwipe & Radar – Dauer-Anmeldung: reine Cookie- & Refresh-Logik (ohne Netz/DB) – getestet in tests/session-stability.test.ts
//
// Warum ein Server-Cookie zusätzlich zu Netlify Identity?
//  • Netlify Identity hält die Sitzung im localStorage („gotrue.user“) und in per JavaScript gesetzten Cookies.
//    Safari (ITP) begrenzt per JavaScript gesetzte Cookies auf 7 Tage und löscht Skript-Speicher nach 7 Tagen
//    ohne Besuch – danach war man trotz „angemeldet bleiben“ abgemeldet.
//  • Vom Server gesetzte Cookies sind davon nicht betroffen. Deshalb legt der Server beim Login ein
//    HttpOnly-Cookie „ps_rt“ (Refresh-Token, 180 Tage, bei jeder Nutzung verlängert) an. Fehlt die Browser-Sitzung,
//    stellt /api/session/restore sie daraus wieder her – ohne erneutes Anmelden.

/** 180 Tage in Sekunden (Max-Age des Sitzungs-Cookies). */
export const SESSION_MAX_AGE = 15_552_000;
/** HttpOnly-Cookie mit dem Refresh-Token – nur für /api/session lesbar. */
export const SESSION_COOKIE = "ps_rt";
/** Nicht geheimer Hinweis „hier war jemand angemeldet“ (damit Gäste keinen unnötigen Wiederherstellungs-Aufruf auslösen). */
export const SESSION_HINT_COOKIE = "ps_auth";
export const SESSION_COOKIE_PATH = "/api/session";

type CookieOpts = { maxAge?: number; httpOnly?: boolean; path?: string; secure?: boolean };

/** Set-Cookie-Zeile bauen (immer SameSite=Lax; Secure außer bei http://localhost). */
export function cookieLine(name: string, value: string, { maxAge = SESSION_MAX_AGE, httpOnly = false, path = "/", secure = true }: CookieOpts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${Math.max(0, Math.floor(maxAge))}`, "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

/** Plausibler GoTrue-Refresh-Token (kurz, nur URL-sichere Zeichen) – alles andere wird nicht gespeichert. */
export function validRefreshToken(t: unknown): t is string {
  return typeof t === "string" && t.length >= 8 && t.length <= 512 && /^[A-Za-z0-9_\-.~]+$/.test(t);
}

/** Plausibles Zugangs-Token (JWT-Form). */
export function validAccessToken(t: unknown): t is string {
  return typeof t === "string" && t.length <= 4096 && /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(t);
}

/**
 * Alle Cookies einer dauerhaften Sitzung (Login, Token-Refresh, Wiederherstellung – jedes Mal neue 180 Tage = gleitender Ablauf).
 *  • ps_rt   – HttpOnly; Secure; SameSite=Lax; Max-Age=15552000, nur an /api/session
 *  • ps_auth – Hinweis-Cookie ohne Geheimnis
 *  • nf_jwt / nf_refresh – von @netlify/identity im Browser gelesen (deshalb nicht HttpOnly), aber vom Server mit
 *    langem Max-Age gesetzt, damit Safari sie nicht nach 7 Tagen verwirft
 */
export function sessionCookieLines({ accessToken = "", refreshToken = "" }: { accessToken?: string; refreshToken?: string }, { secure = true } = {}) {
  const out: string[] = [];
  if (validRefreshToken(refreshToken)) {
    out.push(cookieLine(SESSION_COOKIE, refreshToken, { httpOnly: true, path: SESSION_COOKIE_PATH, secure }));
    out.push(cookieLine("nf_refresh", refreshToken, { secure }));
  }
  if (validAccessToken(accessToken)) out.push(cookieLine("nf_jwt", accessToken, { secure }));
  if (out.length) out.push(cookieLine(SESSION_HINT_COOKIE, "1", { secure }));
  return out;
}

/** Cookies beim aktiven Abmelden löschen (einziger Weg, auf dem der Server die Dauer-Sitzung beendet). */
export function clearSessionCookieLines({ secure = true } = {}) {
  return [
    cookieLine(SESSION_COOKIE, "", { maxAge: 0, httpOnly: true, path: SESSION_COOKIE_PATH, secure }),
    cookieLine(SESSION_HINT_COOKIE, "", { maxAge: 0, secure }),
    cookieLine("nf_jwt", "", { maxAge: 0, secure }),
    cookieLine("nf_refresh", "", { maxAge: 0, secure }),
  ];
}

/**
 * Antwort des Identity-Token-Endpunkts beim Refresh einordnen:
 *  • "ok"          – neue Tokens
 *  • "invalid"     – Refresh-Token eindeutig ungültig/widerrufen (400/401/403) → Sitzung wirklich beendet
 *  • "unavailable" – Netzwerk, Timeout, 5xx, 429 → NICHT abmelden, später erneut versuchen
 */
export function classifyRefresh(status: number | null): "ok" | "invalid" | "unavailable" {
  if (status === null || !Number.isFinite(status)) return "unavailable";
  if (status >= 200 && status < 300) return "ok";
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return "invalid";
  return "unavailable";
}
