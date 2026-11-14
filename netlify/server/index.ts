import app from "../../server/app.ts";

// Der Server beantwortet API-Anfragen, die öffentlichen Kartenseiten (/karte/…) und die Sitemap;
// die App selbst ist die statische Seite in /public.
export const config = {
  path: ["/api/*", "/karte/*", "/sitemap.xml"],
};

export default app;
