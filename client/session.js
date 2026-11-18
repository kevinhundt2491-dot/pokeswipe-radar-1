// PokeSwipe & Radar – dauerhafte Anmeldung, Profil-Cache und Gast-Daten-Übernahme (Browser-Teil).
// Reine Logik: client/session-logic.js (getestet). Konten laufen über Netlify Identity (Google, Facebook, E-Mail);
// Firebase wird nur anonym für Live-Zähler genutzt und ist in public/js/legacy-app.js auf dauerhafte Persistenz gestellt.
import { refreshSession } from "@netlify/identity";
import {
  GOTRUE_KEY, PROFILE_CACHE_KEY, parseStoredSession, sessionBootAction, authCookieStrings, needsRefresh,
  profileCacheFrom, readProfileCache, nameToSync, guestMigrationPlan, detectInAppBrowser, isGeneratedName,
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

let refreshing = null;
/** Zugangs-Token rechtzeitig erneuern (z. B. nach Tagen ohne Besuch), damit API-Aufrufe nicht mit 401 scheitern. */
export async function ensureFreshToken({ force = false } = {}) {
  const s = storedSession();
  if (!s?.refreshToken) return false;
  if (!force && !needsRefresh(s.expiresAt)) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const jwt = await refreshSession();
        if (jwt) persistSessionCookies();
        return Boolean(jwt);
      } catch { return false; }
      finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
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
    const r = await api("/api/portfolio/import", { method: "POST", body: { items: plan.portfolio.slice(0, 200) } });
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
