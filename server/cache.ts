// PokeSwipe & Radar – zentrale CDN-Cache-Regeln für öffentliche, NICHT personalisierte Antworten.
// Browser fragen immer neu nach (max-age=0, must-revalidate), das Netlify-CDN hält die Antwort dagegen
// dauerhaft (durable) vor und liefert sie während der Aktualisierung weiter aus (stale-while-revalidate).
// Nur für Antworten verwenden, die weder Cookies noch Login (Authorization) auswerten!
import type { Context } from "hono";

export type CacheKind = "page" | "sitemap" | "og" | "data" | "static";

/** CDN-Lebensdauer (s-maxage) und Weiterauslieferung während der Aktualisierung in Sekunden. */
export const CACHE_PROFILES: Record<CacheKind, { sMaxAge: number; swr: number }> = {
  page: { sMaxAge: 600, swr: 86_400 }, // SEO-Seiten (/pokemon, /sealed, /trends, /karte/…, /sets, /set/…, /shop/…, /u/…)
  sitemap: { sMaxAge: 3600, swr: 86_400 }, // /sitemap.xml und /sitemaps/*.xml
  og: { sMaxAge: 86_400, swr: 604_800 }, // Vorschaubilder (Open Graph)
  data: { sMaxAge: 300, swr: 3600 }, // öffentliches JSON (Karten-/Preis-Abfragen ohne Nutzerbezug)
  static: { sMaxAge: 86_400, swr: 604_800 }, // selten geänderte Konfiguration
};

export type PublicCacheOpts = {
  /** Abfrageparameter sind Teil des Cache-Schlüssels: true = alle, Liste = nur diese Parameter */
  varyQuery?: boolean | string[];
  /** Abweichende CDN-Lebensdauer in Sekunden */
  sMaxAge?: number;
  swr?: number;
};

/** Setzt die Cache-Header für eine öffentliche Antwort. */
export function publicCache(c: Context | any, kind: CacheKind, opts: PublicCacheOpts = {}) {
  const p = CACHE_PROFILES[kind];
  const sMaxAge = Math.max(0, Math.round(opts.sMaxAge ?? p.sMaxAge));
  const swr = Math.max(0, Math.round(opts.swr ?? p.swr));
  c.header("Cache-Control", "public, max-age=0, must-revalidate");
  c.header("Netlify-CDN-Cache-Control", `public, durable, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
  if (opts.varyQuery === true) c.header("Netlify-Vary", "query");
  else if (Array.isArray(opts.varyQuery) && opts.varyQuery.length) {
    c.header("Netlify-Vary", `query=${opts.varyQuery.filter((q) => /^[A-Za-z0-9_-]+$/.test(q)).join("|")}`);
  }
}

/** Verhindert jedes Caching (z. B. für Fehlerseiten oder personalisierte Antworten auf öffentlichen Pfaden). */
export function noStore(c: Context | any) {
  c.header("Cache-Control", "private, no-store");
  c.header("Netlify-CDN-Cache-Control", "no-store");
}
