import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { eq, sql } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { siteOrigin } from "./util.ts";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
};

type CacheEntry = { user: AuthUser | null; expires: number };
const tokenCache = new Map<string, CacheEntry>();

/**
 * Prüft das Netlify-Identity-JWT (Cookie nf_jwt oder Bearer-Header) direkt bei der
 * Identity-API dieser Website. Gefälschte oder abgelaufene Tokens werden abgelehnt.
 */
export async function verifyIdentityToken(c: Context): Promise<AuthUser | null> {
  const header = c.req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : getCookie(c, "nf_jwt");
  if (!token || token.length > 4096) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;

  let user: AuthUser | null = null;
  try {
    const origin = siteOrigin(c);
    const res = await fetch(`${origin}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data?.id && data?.email) {
        user = {
          id: String(data.id),
          email: String(data.email).toLowerCase(),
          name: String(data.user_metadata?.full_name || data.user_metadata?.name || "").slice(0, 30),
          roles: Array.isArray(data.app_metadata?.roles) ? data.app_metadata.roles.map(String) : [],
        };
      }
    }
  } catch {
    user = null;
  }

  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(token, { user, expires: Date.now() + (user ? 60_000 : 10_000) });
  return user;
}

function baseName(user: AuthUser) {
  const raw = (user.name || user.email.split("@")[0] || "Sammler").replace(/[^\p{L}\p{N}_.-]/gu, "");
  return ("@" + (raw || "Sammler")).slice(0, 24);
}

/** Legt beim ersten Login ein Profil an und liefert es zurück. */
export async function ensureProfile(user: AuthUser) {
  const existing = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  if (existing[0]) return existing[0];

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
    .values({ userId: user.id, email: user.email, displayName: name })
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

export const isAdmin = (user: AuthUser) => user.roles.includes("admin");
