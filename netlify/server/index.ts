import app from "../../server/app.ts";

// Der Server beantwortet API-Anfragen, die öffentlichen Karten-, Set-, Pokémon-, Sealed- und Trend-Seiten,
// die Rechtsseiten inkl. Kündigungsbutton (/kuendigen), die Sitemaps, Teilen-Kurzlinks (/s/…), Einladungsseiten,
// öffentliche Sammler-Profile (/u/…), Pull-Wall-Beiträge (/p/…), Händler-Shops (/shop/…) und die App-Link-Dateien
// unter /.well-known; die App selbst ist die statische Seite in /public.
// WICHTIG: Diese Liste muss mit dem [server]-Abschnitt in netlify.toml übereinstimmen – fehlt hier ein Pfad,
// landet er auf der statischen 404-Seite.
export const config = {
  path: [
    "/api/*",
    "/karte/*",
    "/sitemap.xml",
    "/sitemaps/*",
    "/sets",
    "/set/*",
    "/rechtliches",
    "/impressum",
    "/agb",
    "/widerruf",
    "/datenschutz",
    "/kuendigen",
    "/pokemon",
    "/pokemon/*",
    "/sealed",
    "/sealed/*",
    "/trends",
    "/s/*",
    "/einladung/*",
    "/u/*",
    "/p/*",
    "/shop/*",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ],
};

export default app;
