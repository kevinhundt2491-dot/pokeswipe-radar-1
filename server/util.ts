import type { Context, MiddlewareHandler } from "hono";

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

/** Einfache Bremse gegen Spam pro Instanz (zusätzlich zu den Datenbank-Limits). */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    if (buckets.size > 20_000) buckets.clear();
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
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
    new URL(c.req.url).host, c.req.header("host") || "", c.req.header("x-forwarded-host") || "",
    hostOf(process.env.URL), hostOf(process.env.DEPLOY_URL), hostOf(process.env.DEPLOY_PRIME_URL),
  ].filter(Boolean));
  const site = process.env.SITE_NAME;
  const siteHosts = site && (host === `${site}.netlify.app` || host.endsWith(`--${site}.netlify.app`));
  const prodHost = hostOf(process.env.URL);
  const wwwVariant = prodHost && (host === `www.${prodHost}` || `www.${host}` === prodHost);
  const local = process.env.NETLIFY_DEV === "true" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return allowed.has(host) || siteHosts || wwwVariant || local ? origin : null;
}

/** Basis-URL der Website für serverseitige Aufrufe (Identity-API). */
export function siteOrigin(c: Context): string {
  return trustedOrigin(c) || process.env.URL || new URL(c.req.url).origin;
}

/**
 * Schutz gegen Cross-Site-Request-Forgery: schreibende Anfragen müssen von der eigenen
 * Website kommen und JSON senden.
 */
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  if (c.req.path === "/api/billing/webhook") return next();
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
