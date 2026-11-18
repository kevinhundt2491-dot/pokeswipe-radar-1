// PokeSwipe & Radar – Sitzungs- & Profil-Logik (reine Funktionen, ohne DOM) – getestet in tests/session-profile.test.ts
//
// Hintergrund (Analyse der Abmeldungen):
//  • Netlify Identity speichert die Sitzung dauerhaft in localStorage („gotrue.user“ mit Refresh-Token),
//    setzt das Cookie „nf_jwt“ aber nur als Sitzungs-Cookie (ohne Ablaufdatum).
//  • Schließt man den Browser (oder räumt ein In-App-Browser von TikTok/Instagram seine Cookies auf), ist das Cookie weg.
//    getUser() sieht dann zwar den gespeicherten Nutzer, findet aber kein Cookie und LÖSCHT die Sitzung → ungewollter Rauswurf.
//  • Lösung: Cookies vor getUser() aus der gespeicherten Sitzung wiederherstellen und dauerhaft (max-age) setzen;
//    abgelaufene Zugangs-Tokens werden danach über den Refresh-Token automatisch erneuert.

export const NF_JWT = "nf_jwt";
export const NF_REFRESH = "nf_refresh";
export const GOTRUE_KEY = "gotrue.user";
export const PROFILE_CACHE_KEY = "ps_profile_v1";
/** Wie lange die Anmelde-Cookies mindestens erhalten bleiben (Refresh-Token erneuert sie laufend). */
export const SESSION_COOKIE_DAYS = 180;
/** Erneuerung so viele Sekunden vor Ablauf des Zugangs-Tokens (wie @netlify/identity). */
export const REFRESH_MARGIN_S = 60;

const b64urlDecode = (s) => {
  const norm = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm + "===".slice((norm.length + 3) % 4);
  if (typeof atob === "function") return decodeURIComponent(escape(atob(pad)));
  // Node (Tests)
  return Buffer.from(pad, "base64").toString("utf8");
};

/** Nutzlast eines JWT lesen (ohne Signaturprüfung – nur für Ablaufzeit/Anzeige, nie für Rechte). */
export function decodeJwt(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const obj = JSON.parse(b64urlDecode(part));
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

/** Sekunden-Zeitstempel normalisieren (GoTrue speichert expires_at teils in Millisekunden). */
export function toSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Gespeicherte GoTrue-Sitzung (localStorage „gotrue.user“) auslesen.
 * @returns {{ id: string, email: string, name: string, avatar: string, accessToken: string, refreshToken: string, expiresAt: number } | null}
 */
export function parseStoredSession(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const token = obj.token || {};
  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
  if (!accessToken && !refreshToken) return null;
  const claims = decodeJwt(accessToken) || {};
  const meta = obj.user_metadata || claims.user_metadata || {};
  return {
    id: String(obj.id || claims.sub || ""),
    email: String(obj.email || claims.email || ""),
    name: String(meta.full_name || meta.name || ""),
    avatar: String(meta.avatar_url || meta.picture || ""),
    accessToken,
    refreshToken,
    expiresAt: toSeconds(token.expires_at) || toSeconds(claims.exp),
  };
}

/** Muss das Zugangs-Token erneuert werden? (abgelaufen oder läuft in weniger als `margin` Sekunden ab) */
export function needsRefresh(expiresAt, nowS = Math.floor(Date.now() / 1000), margin = REFRESH_MARGIN_S) {
  const exp = toSeconds(expiresAt);
  if (!exp) return false; // unbekannt → die Bibliothek entscheidet selbst
  return exp - nowS <= margin;
}

/** Ist ein Cookie mit Wert im Cookie-String vorhanden? */
export function hasCookie(cookieString, name) {
  return String(cookieString || "").split(/;\s*/).some((c) => {
    const i = c.indexOf("=");
    return i > 0 && c.slice(0, i) === name && c.slice(i + 1) !== "";
  });
}

/**
 * Dauerhafte Anmelde-Cookies (statt Sitzungs-Cookies) bauen.
 * @param {{ accessToken?: string, refreshToken?: string }} tokens
 * @param {{ secure?: boolean, days?: number }} opts
 */
export function authCookieStrings({ accessToken = "", refreshToken = "" } = {}, { secure = true, days = SESSION_COOKIE_DAYS } = {}) {
  const maxAge = Math.max(60, Math.round(days * 86400));
  const attrs = `; path=/; max-age=${maxAge}; samesite=lax${secure ? "; secure" : ""}`;
  const out = [];
  if (accessToken) out.push(`${NF_JWT}=${encodeURIComponent(accessToken)}${attrs}`);
  if (refreshToken) out.push(`${NF_REFRESH}=${encodeURIComponent(refreshToken)}${attrs}`);
  return out;
}

/**
 * Was beim Start zu tun ist, damit niemand ungewollt abgemeldet wird.
 * @returns {"none" | "restore-cookie"} – „restore-cookie“: Cookie fehlt, gespeicherte Sitzung existiert → wiederherstellen
 */
export function sessionBootAction(session, cookieString) {
  if (!session || !session.accessToken) return "none";
  if (hasCookie(cookieString, NF_JWT)) return "none";
  return "restore-cookie";
}

// ---------------------------------------------------------------------------
// In-App-Browser (TikTok, Instagram, Facebook, …)
// ---------------------------------------------------------------------------
const IN_APP = [
  ["tiktok", /\b(musical_ly|TikTok|BytedanceWebview|ByteLocale|trill)\b/i],
  ["instagram", /\bInstagram\b/i],
  ["facebook", /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A)\b/],
  ["messenger", /\bMessenger(ForiOS|LiteForiOS)?\b|\bOrca-Android\b/i],
  ["snapchat", /\bSnapchat\b/i],
  ["line", /\bLine\/\d/i],
  ["twitter", /\bTwitter(Android)?\b/i],
  ["linkedin", /\bLinkedInApp\b/i],
  ["pinterest", /\bPinterest\b/i],
  ["telegram", /\bTelegram(-Android)?\b/i],
];

/**
 * In-App-Browser erkennen. Google blockiert die Anmeldung in eingebetteten WebViews („disallowed_useragent“),
 * Pop-ups werden dort oft unterdrückt – deshalb braucht es einen sauberen Ausweg.
 * @returns {{ inApp: boolean, app: string, os: "ios" | "android" | "other" }}
 */
export function detectInAppBrowser(ua = "") {
  const s = String(ua || "");
  const os = /iPhone|iPad|iPod/i.test(s) ? "ios" : /Android/i.test(s) ? "android" : "other";
  for (const [app, re] of IN_APP) if (re.test(s)) return { inApp: true, app, os };
  // Generische Android-WebView („; wv)“) – aber nicht die eigene native App (Capacitor meldet sich separat)
  if (os === "android" && /; wv\)/.test(s) && !/PokeSwipe/i.test(s)) return { inApp: true, app: "webview", os };
  return { inApp: false, app: "", os };
}

export const IN_APP_LABEL = {
  tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", messenger: "Messenger", snapchat: "Snapchat",
  line: "LINE", twitter: "X/Twitter", linkedin: "LinkedIn", pinterest: "Pinterest", telegram: "Telegram", webview: "dieser App",
};

/**
 * Wie die 1-Klick-Anmeldung je Anbieter ablaufen soll.
 *  • "redirect": ganz normale Weiterleitung (kein Pop-up → kann nicht blockiert werden)
 *  • "external": im Standard-Browser öffnen (Google verbietet Logins in eingebetteten WebViews)
 */
export function oauthStrategy(provider, env) {
  if (!env?.inApp) return "redirect";
  if (provider === "google") return "external";
  // Facebook-Login funktioniert in den Meta-Apps (Facebook, Instagram, Messenger) per Weiterleitung, sonst lieber extern
  if (provider === "facebook") return ["facebook", "instagram", "messenger"].includes(env.app) ? "redirect" : "external";
  return "redirect";
}

/**
 * Link, der die aktuelle Seite im Standard-Browser öffnet.
 * Android: intent://…#Intent;scheme=https;… (öffnet Chrome bzw. den Standard-Browser), iOS: x-safari-https:// (ab iOS 17).
 * Ohne passende Plattform: die normale https-Adresse (Nutzer kopiert sie).
 */
export function externalBrowserUrl(href, os) {
  let u;
  try { u = new URL(href); } catch { return ""; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  if (os === "android") {
    const fallback = encodeURIComponent(u.toString());
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};S.browser_fallback_url=${fallback};end`;
  }
  if (os === "ios" && u.protocol === "https:") return `x-safari-https://${u.host}${u.pathname}${u.search}${u.hash}`;
  return u.toString();
}

// ---------------------------------------------------------------------------
// Name & Profil
// ---------------------------------------------------------------------------
/** Sammlername bereinigen (wie der Server: Buchstaben, Ziffern, _ . - @, max. 24 Zeichen, mit @ davor). */
export function cleanDisplayName(raw) {
  let name = String(raw ?? "").trim().replace(/\s+/g, "").replace(/[^\p{L}\p{N}_.\-@]/gu, "");
  if (!name) return "";
  name = name.replace(/^@+/, "");
  if (!name) return "";
  return ("@" + name).slice(0, 24);
}

/** Automatisch vergebene Platzhalter-Namen (vom Server beim ersten Login, falls nichts Besseres da war). */
export function isGeneratedName(name) {
  const s = String(name || "");
  return !s || /^@Sammler[a-z0-9]{0,12}$/i.test(s) || /^Sammler$/i.test(s);
}

/**
 * Einmal gewählter Name bleibt: Server-Name gewinnt; nur wenn dort ein Platzhalter steht, wird ein besserer Name
 * (Gast-Name dieses Geräts, Google/Facebook-Name) übernommen. Gibt den zu speichernden Namen zurück oder "" (nichts tun).
 */
export function nameToSync({ serverName = "", guestName = "", providerName = "" } = {}) {
  if (!isGeneratedName(serverName)) return "";
  for (const cand of [guestName, providerName]) {
    const c = cleanDisplayName(cand);
    if (c.length >= 4 && !isGeneratedName(c) && c.toLowerCase() !== String(serverName).toLowerCase()) return c;
  }
  return "";
}

/** Anzuzeigender Name ohne Netz: Profil-Cache → Server → Gast-Name → Google/Facebook → „Sammler“. */
export function displayNameFor({ me = null, cache = null, guestName = "", providerName = "", email = "" } = {}) {
  const fromEmail = String(email || "").split("@")[0];
  return String(me?.displayName || cache?.displayName || guestName || providerName || fromEmail || "Sammler").slice(0, 30);
}

/** Initiale für den Avatar-Platzhalter. */
export function initialOf(name) {
  const s = String(name || "").replace(/^@/, "").trim();
  return (Array.from(s)[0] || "?").toUpperCase();
}

/**
 * Profil-Cache für den nächsten Start (sofortige Anzeige von Name & Avatar, auch offline).
 * Speichert bewusst KEINE Tarif- oder Rechte-Angaben – die kommen immer frisch vom Server.
 */
export function profileCacheFrom(me, userId, now = Date.now()) {
  if (!me || !userId) return null;
  return {
    userId: String(userId),
    displayName: String(me.displayName || "").slice(0, 30),
    avatarUrl: String(me.avatarUrl || "").slice(0, 600),
    city: String(me.city || "").slice(0, 60),
    prefs: me.prefs && typeof me.prefs === "object" && !Array.isArray(me.prefs) ? me.prefs : {},
    savedAt: now,
  };
}

/** Cache nur verwenden, wenn er zum angemeldeten Nutzer gehört. */
export function readProfileCache(raw, userId) {
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || !userId || obj.userId !== String(userId)) return null;
  return obj;
}

// ---------------------------------------------------------------------------
// Gast-Daten → Konto (Daten-Migration nach Anmeldung)
// ---------------------------------------------------------------------------
const safeArr = (raw) => {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/**
 * Welche Gast-Daten dieses Geräts noch ins Konto übernommen werden müssen.
 * Ein Gast-Eintrag gilt als übernommen, sobald sein Schlüssel in `done` steht – so werden auch Karten,
 * die nach einer früheren Übernahme noch als Gast gespeichert wurden, beim nächsten Login nachgezogen (ohne Doppelte).
 */
export function guestMigrationPlan({ portfolio = [], wishlist = [], done = [] } = {}) {
  const seen = new Set(safeArr(done).map(String));
  const keyOf = (item) => {
    const name = String(item?.name || item?.card || item?.title || "").trim().toLowerCase();
    const num = String(item?.number || item?.cardNumber || item?.localId || "").trim().toLowerCase();
    const id = String(item?.cardId || item?.card_id || item?.id || "").trim().toLowerCase();
    return name || num || id ? `${id}|${name}|${num}` : "";
  };
  // Gleiche Karte mehrfach als Gast gespeichert (z. B. 2× Glurak) → laufende Nummer, damit beide übernommen werden
  const keyed = (list) => {
    const count = new Map();
    return safeArr(list).map((i) => {
      const base = keyOf(i);
      if (!base) return ["", i];
      const n = (count.get(base) || 0) + 1;
      count.set(base, n);
      return [`${base}#${n}`, i];
    });
  };
  const pf = keyed(portfolio).filter(([k]) => k && !seen.has(`pf:${k}`));
  const wl = keyed(wishlist).filter(([k]) => k && !seen.has(`wl:${k}`));
  return {
    portfolio: pf.map(([, i]) => i),
    portfolioKeys: pf.map(([k]) => `pf:${k}`),
    wishlist: wl.map(([, i]) => i),
    wishlistKeys: wl.map(([k]) => `wl:${k}`),
    total: pf.length + wl.length,
  };
}

// ---------------------------------------------------------------------------
// Kein ungewollter Rauswurf (Analyse & Absicherung, getestet in tests/session-stability.test.ts)
// ---------------------------------------------------------------------------
//  • gotrue-js löscht beim Token-Refresh bei JEDEM Fehler die gespeicherte Sitzung – auch bei Netzwerk-Hängern,
//    Timeouts oder 502/503 beim Kaltstart. Nach dem Aufwachen des Handys im Funkloch war man so abgemeldet.
//    → Nur noch eindeutige Ablehnungen (400/401/403) beenden die Sitzung (session.js: hardenTokenRefresh).
//  • Mehrere Tabs: Tab A erneuert (Refresh-Token rotiert), Tab B versucht es mit dem alten → 400 → Abmeldung überall.
//    → Vor dem Löschen prüfen, ob ein anderer Tab bereits neue Tokens gespeichert hat, und diese übernehmen.
//  • Der Server antwortete bei kurzem Identity-Ausfall mit 401 → jetzt 503 (server/auth.ts: authenticate).

/** HTTP-Status, die beim Token-Refresh eindeutig „Sitzung ungültig“ bedeuten (alles andere = vorübergehend). */
export const DEFINITIVE_AUTH_STATUS = [400, 401, 403];

/** Ist ein Refresh-Fehler eine eindeutige Ablehnung (→ abmelden) statt eines vorübergehenden Problems (→ angemeldet bleiben)? */
export function isDefinitiveAuthFailure(error) {
  const status = Number(error?.status);
  return Number.isFinite(status) && DEFINITIVE_AUTH_STATUS.includes(status);
}

/**
 * Wie ein 401 einer API-Antwort zu werten ist.
 * @param {{ hadToken: boolean, retried: boolean, refreshOutcome: "ok"|"invalid"|"transient"|"none", sessionStillStored: boolean }} p
 * @returns {"retry" | "transient" | "unauthorized"}
 *  • "retry"        – Token wurde gerade erneuert → Anfrage einmal wiederholen
 *  • "transient"    – Erneuerung scheiterte nur am Netz/Server → NICHT abmelden (wie 503 behandeln)
 *  • "unauthorized" – eindeutig nicht (mehr) angemeldet
 */
export function classifyUnauthorized({ hadToken = false, retried = false, refreshOutcome = "none", sessionStillStored = false } = {}) {
  if (!hadToken) return "unauthorized";
  if (retried) return "unauthorized"; // auch mit frischem Token abgelehnt
  if (refreshOutcome === "ok") return "retry";
  if (refreshOutcome === "transient" && sessionStillStored) return "transient";
  return "unauthorized";
}

/** Kurzer, nicht umkehrbarer Fingerabdruck eines Tokens (nur zum Erkennen „hat sich geändert“). */
export function tokenFingerprint(token) {
  let h = 2166136261;
  const s = String(token || "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Server-Sitzungs-Cookie mindestens so oft verlängern (gleitender Ablauf, 180 Tage ab letzter Nutzung). */
export const SESSION_SYNC_EVERY_MS = 12 * 3600_000;

/** Muss das HttpOnly-Sitzungs-Cookie (neu) gesetzt bzw. verlängert werden? */
export function shouldSyncSession({ last = null, fingerprint = "", now = Date.now(), force = false, every = SESSION_SYNC_EVERY_MS } = {}) {
  if (!fingerprint) return false;
  if (force) return true;
  if (!last || typeof last !== "object") return true;
  if (last.h !== fingerprint) return true; // Refresh-Token rotiert → Cookie muss den neuen kennen
  const at = Number(last.at) || 0;
  return now - at >= every || at > now + 60_000;
}

// ---------------------------------------------------------------------------
// Tab & Unterbereich in der URL (bleibt beim Neuladen / App-Wechsel stehen)
// ---------------------------------------------------------------------------
export const URL_TABS = ["home", "swipe", "scan", "flip", "community", "map", "portfolio", "profile", "admin", "trades"];

/**
 * Neue Adresse mit gesetzten/entfernten Parametern – alle übrigen Parameter (z. B. ?ref=, ?post=) bleiben erhalten.
 * `null`/`""` entfernt einen Parameter; „home“ als Reiter wird weggelassen (saubere Startadresse).
 * @returns {string} Pfad + Suche + Hash
 */
export function withUrlParams(href, params = {}) {
  let u;
  try { u = new URL(href, "https://x.invalid"); } catch { return ""; }
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || (k === "tab" && v === "home")) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  return u.pathname + u.search + u.hash;
}

/** Reiter aus der Adresse (nur bekannte Werte). */
export function tabFromUrl(href) {
  try {
    const t = new URL(href, "https://x.invalid").searchParams.get("tab") || "";
    return URL_TABS.includes(t) ? t : "";
  } catch { return ""; }
}
