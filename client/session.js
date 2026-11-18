// PokeSwipe & Radar – dauerhafte Anmeldung, Profil-Cache und Gast-Daten-Übernahme (Browser-Teil).
// Reine Logik: client/session-logic.js (getestet). Konten laufen über Netlify Identity (Google, Facebook, E-Mail);
// Firebase wird nur anonym für Live-Zähler genutzt und ist in public/js/legacy-app.js auf dauerhafte Persistenz gestellt.
// Gleiche gotrue-js-Instanz wie in @netlify/identity (eine Kopie im Bundle) – für den abgesicherten Token-Refresh
import { User as GoTrueUser } from "gotrue-js";
import {
  GOTRUE_KEY, PROFILE_CACHE_KEY, parseStoredSession, sessionBootAction, authCookieStrings, needsRefresh,
  profileCacheFrom, readProfileCache, nameToSync, guestMigrationPlan, detectInAppBrowser, isGeneratedName,
  isDefinitiveAuthFailure, tokenFingerprint, shouldSyncSession, hasCookie,
} from "./session-logic.js";

const secure = () => location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

export const storedSession = () => parseStoredSession(ls.get(GOTRUE_KEY));

/** Anmelde-Cookies dauerhaft setzen (statt nur für die aktuelle Browser-Sitzung). */
export function persistSessionCookies(session = storedSession()) {
  if (!session?.accessToken) return false;
  for (const c of authCookieStrings(session, { secure: secure() })) document.cookie = c;
  return true;
}

/**
 * VOR getUser() aufrufen: fehlt das Cookie (Browser geschlossen, In-App-Browser hat aufgeräumt), wird es aus der
 * gespeicherten Sitzung wiederhergestellt – sonst würde @netlify/identity die Sitzung verwerfen.
 */
export function restoreSession() {
  const s = storedSession();
  if (sessionBootAction(s, document.cookie) === "restore-cookie") {
    persistSessionCookies(s);
    return true;
  }
  if (s) persistSessionCookies(s); // vorhandene Sitzungs-Cookies in dauerhafte umwandeln
  return false;
}

// ---------------------------------------------------------------------------
// Abgesicherter Token-Refresh (Hauptursache der ungewollten Abmeldungen)
// ---------------------------------------------------------------------------
// gotrue-js (von @netlify/identity genutzt) ruft bei JEDEM Refresh-Fehler clearSession() auf – also auch bei
// Netzwerk-Hängern, Timeouts, 502/503 (Kaltstart) oder wenn ein anderer Tab den Refresh-Token schon rotiert hat.
// Das löschte „gotrue.user“ und meldete den Nutzer in allen Tabs ab. Ersatz mit identischem Verhalten,
// außer: Abmeldung nur noch bei eindeutiger Ablehnung (400/401/403) des Refresh-Tokens.
let lastOutcome = "none"; // "ok" | "invalid" | "transient" | "none"
export const lastRefreshOutcome = () => lastOutcome;

export function hardenTokenRefresh() {
  const proto = GoTrueUser?.prototype;
  if (!proto || proto.__psHardened) return false;
  const inflight = {};
  proto._refreshToken = function psRefreshToken(refreshToken) {
    if (inflight[refreshToken]) return inflight[refreshToken];
    const request = this.api.request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Token refresh timeout")), 30_000);
    });
    const promise = Promise.race([request, timeout]).then((response) => {
      this._processTokenResponse(response);
      this._refreshSavedSession();
      if (!this.token) throw new Error("Gotrue-js: Token not set after refresh");
      lastOutcome = "ok";
      return this.token.access_token;
    }).catch((error) => {
      // Ein anderer Tab hat bereits erneuert (Refresh-Token rotiert) → dessen gespeicherte Tokens übernehmen
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(GOTRUE_KEY) || "null")?.token || null; } catch {}
      if (stored?.access_token && stored.refresh_token && stored.refresh_token !== refreshToken) {
        this._processTokenResponse({ ...stored });
        lastOutcome = "ok";
        return this.token.access_token;
      }
      if (isDefinitiveAuthFailure(error)) {
        lastOutcome = "invalid";
        this.clearSession(); // Refresh-Token wirklich ungültig/widerrufen
      } else {
        lastOutcome = "transient"; // Netz/Server kurz weg: Sitzung bleibt, nächster Versuch klappt
      }
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      delete inflight[refreshToken];
    });
    inflight[refreshToken] = promise;
    return promise;
  };
  proto.__psHardened = true;
  return true;
}

let refreshing = null;
/**
 * Zugangs-Token rechtzeitig erneuern (z. B. nach Tagen ohne Besuch), damit API-Aufrufe nicht mit 401 scheitern.
 * `force: true` erneuert auch ein noch gültiges Token (z. B. wenn der Server es abgelehnt hat).
 * @returns {Promise<boolean>} true = neues Token liegt vor; Grund eines Fehlschlags: lastRefreshOutcome()
 */
export async function ensureFreshToken({ force = false } = {}) {
  const s = storedSession();
  if (!s?.refreshToken) return false;
  if (!force && !needsRefresh(s.expiresAt)) return false;
  if (!refreshing) {
    refreshing = (async () => {
      lastOutcome = "none";
      try {
        const user = GoTrueUser.recoverSession();
        if (!user) return false;
        const jwt = await user.jwt(true);
        if (!jwt) return false;
        persistSessionCookies();
        syncServerSession({ force: true }).catch(() => {});
        return true;
      } catch {
        if (lastOutcome === "none" || lastOutcome === "ok") lastOutcome = "transient";
        return false;
      } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

// ---------------------------------------------------------------------------
// Dauerhaftes Server-Sitzungs-Cookie (HttpOnly, 180 Tage, gleitend) – server/session.ts
// ---------------------------------------------------------------------------
const SYNC_KEY = "ps_session_sync";
let syncing = null;

/** Sitzung beim Server hinterlegen bzw. verlängern (nach Login, Token-Refresh, spätestens alle 12 h bei Nutzung). */
export async function syncServerSession({ force = false } = {}) {
  const s = storedSession();
  if (!s?.accessToken || !s.refreshToken) return false;
  const fingerprint = tokenFingerprint(s.refreshToken);
  let last = null;
  try { last = JSON.parse(ls.get(SYNC_KEY) || "null"); } catch {}
  if (!shouldSyncSession({ last, fingerprint, force })) return false;
  if (syncing) return syncing;
  syncing = fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.accessToken}` },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  }).then((r) => {
    if (r.ok) ls.set(SYNC_KEY, JSON.stringify({ at: Date.now(), h: fingerprint }));
    return r.ok;
  }).catch(() => false).finally(() => { syncing = null; });
  return syncing;
}

/**
 * VOR getUser(): Ist die Browser-Sitzung weg (Safari löscht Skript-Speicher nach 7 Tagen, In-App-Browser räumen auf),
 * das dauerhafte Server-Cookie aber noch da, holt der Server neue Tokens und setzt die Cookies – getUser() übernimmt sie.
 * Bei Netz-/Serverproblemen wird kurz erneut versucht; niemals wird dabei etwas gelöscht.
 */
export async function restoreServerSession() {
  if (storedSession()) return false;
  if (!hasCookie(document.cookie, "ps_auth")) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("/api/session/restore", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
      });
      if (r.ok) { const d = await r.json().catch(() => ({})); return Boolean(d?.restored); }
      if (r.status < 500 && r.status !== 429) return false;
    } catch {}
    await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
  }
  return false;
}

/** NUR beim aktiven Klick auf „Abmelden“: dauerhafte Server-Sitzung beenden. */
export async function endServerSession() {
  ls.del(SYNC_KEY);
  try {
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
  } catch {}
}

// ---------------------------------------------------------------------------
// Profil-Cache (Name, Avatar, Einstellungen) – sofort sichtbar beim nächsten Start
// ---------------------------------------------------------------------------
export function cachedProfile(userId) {
  return readProfileCache(ls.get(PROFILE_CACHE_KEY), userId);
}
export function saveProfileCache(me, userId) {
  const c = profileCacheFrom(me, userId);
  if (c) ls.set(PROFILE_CACHE_KEY, JSON.stringify(c));
  // Gast-/Chat-Name aller Altbereiche = Kontoname – aber nie mit einem Platzhalter einen selbst gewählten Gast-Namen überschreiben
  if (me?.displayName && !isGeneratedName(me.displayName)) ls.set("pokeswipe_user", me.displayName);
}
export function clearProfileCache() { ls.del(PROFILE_CACHE_KEY); }

/**
 * Nach dem Login: Name & Avatar dauerhaft im Konto sichern (nur wenn dort noch ein Platzhalter steht),
 * App-Einstellungen dieses Geräts (Sprache, Ansicht) übernehmen bzw. aus dem Konto wiederherstellen.
 * @returns {Promise<boolean>} true, wenn das Profil geändert wurde (→ /api/me neu laden)
 */
export async function syncProfileAfterLogin({ me, user, api }) {
  if (!me || !user) return false;
  const body = {};
  const name = nameToSync({ serverName: me.displayName, guestName: ls.get("pokeswipe_user") || "", providerName: user.name || "" });
  if (name) body.displayName = name;
  if (!me.avatarUrl && user.pictureUrl) body.avatarUrl = user.pictureUrl;
  // Einstellungen: Konto hat Vorrang (gleiches Erlebnis auf allen Geräten), fehlende Werte kommen von diesem Gerät
  const local = { lang: ls.get("ps_lang") || undefined, uiMode: ls.get("ps_ui_mode") || undefined, marketMode: ls.get("ps_market_mode") || undefined };
  const prefs = me.prefs || {};
  const missing = Object.fromEntries(Object.entries(local).filter(([k, v]) => v && prefs[k] === undefined));
  if (Object.keys(missing).length) body.prefs = missing;
  if (prefs.uiMode && prefs.uiMode !== ls.get("ps_ui_mode")) { ls.set("ps_ui_mode", prefs.uiMode); try { window.PS?.setUiMode?.(prefs.uiMode); } catch {} }
  if (prefs.marketMode) ls.set("ps_market_mode", prefs.marketMode);
  if (prefs.marketFilter) ls.set("ps_market_chip", prefs.marketFilter);
  if (prefs.communityPanel) ls.set("ps_community_panel", prefs.communityPanel);
  if (!Object.keys(body).length) return false;
  try {
    await api("/api/me", { method: "PUT", body });
    return true;
  } catch (e) {
    // Name vergeben o. Ä.: ohne Name erneut (Avatar/Einstellungen trotzdem sichern)
    if (body.displayName && e?.status === 409) {
      delete body.displayName;
      if (Object.keys(body).length) { try { await api("/api/me", { method: "PUT", body }); return true; } catch {} }
    }
    return false;
  }
}

/** Einstellung im Konto sichern (im Hintergrund, nur wenn angemeldet) – lokal speichern die Bereiche selbst. */
export function savePref(key, value, { api, loggedIn }) {
  if (!loggedIn) return;
  api("/api/me", { method: "PUT", body: { prefs: { [key]: value } } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Gast-Daten (Sammlung) → Konto
// ---------------------------------------------------------------------------
export async function migrateGuestData({ userId, api, toast }) {
  if (!userId) return 0;
  const doneKey = `ps_guest_done_${userId}`;
  // Gast-Sammlung liegt in localStorage (public/js/legacy-app.js: „pokeswipe_portfolio_clean“)
  let local = [];
  try { local = JSON.parse(ls.get("pokeswipe_portfolio_clean") || "[]"); } catch {}
  if (!Array.isArray(local) || !local.length) local = Array.isArray(window.portfolio) ? window.portfolio : [];
  let done = [];
  try { done = JSON.parse(ls.get(doneKey) || "[]"); } catch {}
  // Frühere Übernahme (alte Markierung): alles, was damals lokal lag, gilt als übernommen → keine Doppelten
  if (ls.get(`ps_migrated_${userId}`) && !ls.get(doneKey)) {
    done = guestMigrationPlan({ portfolio: local }).portfolioKeys;
    ls.set(doneKey, JSON.stringify(done));
    return 0;
  }
  const plan = guestMigrationPlan({ portfolio: local, done });
  if (!plan.portfolio.length) { ls.set(`ps_migrated_${userId}`, "1"); return 0; }
  try {
    const r = await api("/api/portfolio/import", { method: "POST", body: { items: plan.portfolio.slice(0, 300) } });
    // Nur wirklich übernommene Karten abhaken (Tarif-Limit → Rest beim nächsten Login bzw. nach Upgrade)
    ls.set(doneKey, JSON.stringify([...done, ...plan.portfolioKeys.slice(0, Number(r?.imported) || 0)].slice(-2000)));
    ls.set(`ps_migrated_${userId}`, "1");
    if (r?.imported) toast?.("💼 Gast-Sammlung übernommen", `${r.imported} Karten sind jetzt sicher in deinem Konto gespeichert – auf allen Geräten.`);
    return Number(r?.imported) || 0;
  } catch {
    return 0; // nächster Login versucht es erneut
  }
}

export const inAppEnv = () => detectInAppBrowser(navigator.userAgent || "");
