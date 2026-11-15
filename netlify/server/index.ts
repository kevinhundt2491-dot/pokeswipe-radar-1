import app from "../../server/app.ts";

// Der Server beantwortet API-Anfragen, die öffentlichen Karten- und Set-Seiten, die Rechtsseiten,
// den Kündigungsbutton (/kuendigen) und die Sitemaps;
// die App selbst ist die statische Seite in /public.
export const config = {
  path: ["/api/*", "/karte/*", "/sitemap.xml", "/sitemaps/*", "/sets", "/set/*", "/rechtliches", "/impressum", "/agb", "/widerruf", "/kuendigen"],
};

export default app;
