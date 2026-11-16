import type { Context, MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";

/** Begrenzt Text auf eine Länge und entfernt Steuerzeichen. */
export function str(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

/** Geldbetrag in Euro (0–100.000), sonst null. */
export function money(v: unknown): string | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null;
  return n.toFixed(2);
}

export function int(v: unknown, min: number, max: number, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const rows = <T = any>(result: any): T[] => (Array.isArray(result) ? result : result?.rows ?? []);

/**
 * Verteiltes Rate-Limiting (Phase 6): gilt instanzübergreifend über die Tabelle rate_limits (atomarer Upsert je Schlüssel).
 * • Ein kleiner lokaler Vorfilter weist Anfragen, die schon auf dieser Instanz über dem Limit liegen, ohne DB-Zugriff ab.
 * • Ist die Datenbank kurz nicht erreichbar, greift das lokale Limit (fail-safe statt fail-open ohne Grenze).
 * • Abgelaufene Zeilen räumt der stündliche Job (netlify/functions/growth-jobs.mts) auf.
 * Schlüssel enthalten Nutzer-ID oder IP; sie werden vor dem Speichern gehasht (keine Klar-IPs in der Datenbank).
 */
type Bucket = { count: number; reset: number };
const LOCAL_MAX = 20_000;
const buckets = new Map<string, Bucket>();

function localHit(key: string, windowMs: number, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size >= LOCAL_MAX) {
      // abgelaufene Einträge entfernen; reicht das nicht, die ältesten 10 % verdrängen (nie alles auf einmal)
      for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
      if (buckets.size >= LOCAL_MAX) {
        let drop = Math.ceil(LOCAL_MAX / 10);
        for (const k of buckets.keys()) { if (drop-- <= 0) break; buckets.delete(k); }
      }
    }
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b;
}

/** Nur lokal, synchron – für Hot-Paths ohne Missbrauchsrisiko (z. B. Zählwerke). */
export function rateLimitLocal(key: string, max: number, windowMs: number) {
  return localHit(key, windowMs, Date.now()).count <= max;
}

let dbModule: Promise<typeof import("../db/index.ts")> | null = null;
const loadDb = () => (dbModule ??= import("../db/index.ts"));
const keyHash = (key: string) => createHash("sha256").update(key).digest("base64url").slice(0, 32);

/** true = Anfrage erlaubt. max Anfragen je windowMs, instanzübergreifend. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const local = localHit(key, windowMs, now);
  if (local.count > max) return false;
  try {
    const { db } = await loadDb();
    const { sql } = await import("drizzle-orm");
    const k = `${key.split(":")[0]}:${keyHash(key)}`;
    const reset = new Date(now + windowMs);
    const res: any = await db.execute(sql`
      INSERT INTO rate_limits (key, count, reset_at) VALUES (${k}, 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
      RETURNING count`);
    const count = Number(rows(res)[0]?.count ?? 1);
    // lokalen Zähler angleichen, damit weitere Anfragen auf dieser Instanz ohne DB abgewiesen werden
    if (count > local.count) local.count = count;
    return count <= max;
  } catch {
    return local.count <= max;
  }
}

export function clientIp(c: Context) {
  return c.req.header("x-nf-client-connection-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const hostOf = (u?: string) => {
  try { return u ? new URL(u).host : ""; } catch { return ""; }
};

/** Liefert den Origin der Anfrage, wenn er zu dieser Website gehört (eigene Domain, Netlify-Adressen, Previews). */
export function trustedOrigin(c: Context): string | null {
  const origin = c.req.header("origin") || "";
  const host = hostOf(origin);
  if (!host) return null;
  const allowed = new Set([
    new URL(c.req.url).host, c.req.header("host") || "",
    hostOf(process.env.URL), hostOf(process.env.DEPLOY_URL), hostOf(process.env.DEPLOY_PRIME_URL),
  ].filter(Boolean));
  const site = process.env.SITE_NAME;
  const siteHosts = site && (host === `${site}.netlify.app` || host.endsWith(`--${site}.netlify.app`));
  const prodHost = hostOf(process.env.URL);
  const wwwVariant = prodHost && (host === `www.${prodHost}` || `www.${host}` === prodHost);
  const local = process.env.NETLIFY_DEV === "true" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return allowed.has(host) || siteHosts || wwwVariant || local ? origin : null;
}

/** Basis-URL der Website (z. B. für Links in Antworten). Für die Token-Prüfung siehe identityOrigin in auth.ts. */
export function siteOrigin(c: Context): string {
  return trustedOrigin(c) || process.env.URL || new URL(c.req.url).origin;
}

/**
 * Schutz gegen Cross-Site-Request-Forgery: schreibende Anfragen müssen von der eigenen
 * Website kommen und JSON senden.
 */
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  // Webhooks von Zahlungsanbietern prüfen ihre Signatur bzw. ihr Geheimnis selbst
  if (c.req.path === "/api/billing/webhook" || c.req.path === "/api/stripe/webhook" || c.req.path === "/api/billing/revenuecat/webhook") return next();
  if (!trustedOrigin(c)) {
    return c.json({ error: "Anfrage von fremder Herkunft blockiert." }, 403);
  }
  const type = c.req.header("content-type") || "";
  if (!type.includes("application/json")) {
    return c.json({ error: "Nur JSON-Anfragen erlaubt." }, 415);
  }
  return next();
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
};

export const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

const EURO_EN = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Euro-Betrag je Sprache: "de" wie euro() („12,34 €“), "en" im englischen Format („€12.34“, mit Tausenderkomma). */
export const euroIn = (n: number, lang: "de" | "en" = "de") => (lang === "en" ? EURO_EN.format(n) : euro(n));
