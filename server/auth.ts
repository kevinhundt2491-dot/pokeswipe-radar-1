import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { sanitizeAvatarUrl } from "./profile-prefs-logic.ts";

/**
 * Fester Origin der Identity-API. Bewusst NICHT aus Request-Headern (Origin, Host, X-Forwarded-Host)
 * abgeleitet: sonst könnte ein Angreifer die Token-Prüfung auf einen eigenen Server umleiten, der
 * beliebige Nutzer (auch Admins) "bestätigt". Netlify setzt URL auf die Produktions-Adresse; die
 * Identity-Instanz ist für alle Deploys (auch Previews) dieselbe.
 */
function identityOrigin(c: Context): string {
  const env = process.env.URL || "";
  try {
    if (env) return new URL(env).origin;
  } catch {}
  return new URL(c.req.url).origin;
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  /** E-Mail-Adresse wurde in Netlify Identity bestätigt */
  confirmed: boolean;
  /** Profilbild aus Google/Facebook (user_metadata.avatar_url), nur zur Übernahme ins Profil */
  avatar?: string;
};

/**
 * Token-Prüfung (Phase 6)
 * Netlify Identity signiert Zugangs-Tokens mit HS256 und einem nicht öffentlichen Schlüssel der Instanz – einen
 * JWKS-Endpunkt gibt es nicht (/.netlify/identity/.well-known/jwks.json → 404). Eine rein lokale Signaturprüfung ist
 * deshalb nicht möglich, ohne den Schlüssel preiszugeben. Stattdessen:
 * 1. Lokale Vorprüfung ohne Netzwerk: Format, Algorithmus (HS256), Ablaufzeit (exp), Nutzer-ID (sub) – abgelaufene oder
 *    manipulierte Tokens werden sofort abgelehnt (kein Identity-Aufruf, schützt vor Last durch Müll-Tokens).
 * 2. Einmalige Bestätigung bei der Identity-API je Token; das Ergebnis wird je Instanz bis zu 5 Minuten (höchstens bis
 *    exp) unter dem SHA-256 des Tokens gehalten. Damit verursacht eine Sitzung höchstens einen Aufruf alle 5 Minuten
 *    statt einen pro Anfrage. Die bestätigte sub muss zur Antwort der Identity-API passen.
 * 3. Begrenzter Cache (LRU, 10.000 Einträge) statt komplettem Leeren bei Überlauf.
 */
type CacheEntry = { user: AuthUser | null; expires: number };
const tokenCache = new Map<string, CacheEntry>();
const TOKEN_CACHE_MAX = 10_000;
const VERIFIED_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 10_000;

function b64urlJson(part: string): any {
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { return null; }
}

/** Lokale Prüfung der Token-Struktur. Liefert die Claims oder null (dann ist das Token sicher ungültig). */
export function inspectToken(token: string, nowMs = Date.now()): { sub: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!header || header.alg !== "HS256" || !claims || typeof claims !== "object") return null;
  const exp = Number(claims.exp);
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs || !sub || sub.length > 80) return null;
  return { sub, exp };
}

function remember(key: string, entry: CacheEntry) {
  tokenCache.delete(key);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, entry);
}

/** Entfernt alle zwischengespeicherten Sitzungen eines Nutzers (z. B. nach Sperre). */
export function forgetUserSessions(userId: string) {
  for (const [k, v] of tokenCache) if (v.user?.id === userId) tokenCache.delete(k);
}

/**
 * Prüft das Netlify-Identity-JWT (Cookie nf_jwt oder Bearer-Header). Gefälschte oder abgelaufene Tokens werden abgelehnt.
 */
export async function verifyIdentityToken(c: Context): Promise<AuthUser | null> {
  const header = c.req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : getCookie(c, "nf_jwt");
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token)) return null;
  const claims = inspectToken(token);
  if (!claims) return null;

  const key = createHash("sha256").update(token).digest("base64url");
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.expires > now) return cached.user;

  let user: AuthUser | null = null;
  try {
    const origin = identityOrigin(c);
    const res = await fetch(`${origin}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data?.id && data?.email && String(data.id) === claims.sub) {
        user = {
          id: String(data.id),
          email: String(data.email).toLowerCase(),
          name: String(data.user_metadata?.full_name || data.user_metadata?.name || "").slice(0, 30),
          roles: Array.isArray(data.app_metadata?.roles) ? data.app_metadata.roles.map(String) : [],
          confirmed: Boolean(data.confirmed_at || data.email_confirmed_at),
          avatar: sanitizeAvatarUrl(data.user_metadata?.avatar_url || data.user_metadata?.picture || ""),
        };
      }
    }
  } catch {
    // Identity kurz nicht erreichbar: nicht zwischenspeichern, damit der nächste Versuch neu prüft
    return null;
  }
  remember(key, { user, expires: user ? Math.min(now + VERIFIED_TTL_MS, claims.exp * 1000) : now + NEGATIVE_TTL_MS });
  return user;
}

function baseName(user: AuthUser) {
  const raw = (user.name || user.email.split("@")[0] || "Sammler").replace(/[^\p{L}\p{N}_.-]/gu, "");
  return ("@" + (raw || "Sammler")).slice(0, 24);
}

/** Legt beim ersten Login ein Profil an und liefert es zurück. */
export async function ensureProfile(user: AuthUser) {
  const existing = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  if (existing[0]) {
    // Einmalig: Profilbild von Google/Facebook übernehmen, solange der Nutzer noch keinen eigenen Avatar hat
    if (!existing[0].avatarUrl && user.avatar) {
      try {
        await db.update(profiles).set({ avatarUrl: user.avatar }).where(eq(profiles.userId, user.id));
        return { ...existing[0], avatarUrl: user.avatar };
      } catch {}
    }
    return existing[0];
  }

  let name = baseName(user);
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(sql`lower(${profiles.displayName}) = lower(${name})`)
      .limit(1);
    if (!taken[0]) break;
    name = `${baseName(user).slice(0, 19)}${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const [created] = await db
    .insert(profiles)
    .values({ userId: user.id, email: user.email, displayName: name, avatarUrl: user.avatar || "" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const again = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  if (again[0]) return again[0];
  const [fallback] = await db
    .insert(profiles)
    .values({ userId: user.id, email: user.email, displayName: `@Sammler${Date.now().toString(36)}` })
    .onConflictDoNothing()
    .returning();
  return fallback ?? (await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1))[0];
}

/**
 * Admin = Rolle "admin" in Netlify Identity ODER die (von Identity verifizierte) E-Mail steht
 * in der Umgebungsvariable ADMIN_EMAILS (kommagetrennt). So bleibt der Admin-Zugang erhalten,
 * auch wenn die Identity-Rolle verloren geht. Per E-Mail nur, wenn die Adresse bestätigt ist – sonst
 * könnte sich jemand mit einer noch nicht registrierten Admin-Adresse anmelden und Admin werden.
 */
function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || "";
  return new Set(raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export const isAdmin = (user: AuthUser | null | undefined) =>
  !!user && (user.roles.includes("admin") || (user.confirmed && adminEmails().has(user.email.toLowerCase())));
