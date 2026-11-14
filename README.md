# PokeSwipe & Radar (pokeswipe-radar.de)

Die deutsche Sammler- & Trading-Plattform für Pokémon TCG:

- **PokeSwipe & Arena** – Karten swipen, Booster-Simulator, Live-Kartensuche (TCGdex)
- **Live-Preis-Tracker** – echte Cardmarket-Preise, stündliche Preisalarme, Deal-Alarm bei neuen Inseraten
- **Portfolio** – Sammlung im Konto, Live-Wert, Gewinn/Verlust, täglicher Wertverlauf, Top-Mover
- **Tausch-Hub** – Inserate mit Preis-Check, sichere Tauschanfragen, privater Chat, beidseitige Bestätigung, Bewertungen, Meldungen
- **Community** – Pull-Wall, Live-Chat & Sammler-Radar (Firebase Realtime)
- **Web-Push** – Alarme & Tausch-Nachrichten auch bei geschlossener App (Service Worker `public/sw.js`)
- **KI-Kartenscan** – Foto mit der Handykamera, Erkennung über Netlify AI Gateway (Claude Haiku)
- **Set-Fortschritt** – Karten abhaken, Wert der eigenen Karten und Kosten bis zum kompletten Set
- **Sealed-Tracker** – Displays, ETBs, Top-Trainer-Boxen mit Admin-Referenzpreis + Community-Durchschnitt
- **Grading-Partner** – PSA, CGC, Beckett, TAG mit Klick-Zählung (Affiliate)
- **Händler-Shops** – eigene Shop-Seite `/shop/<name>` für Pro-Trader
- **Empfehlungsprogramm** – geworbene Nutzer: 1. Monat gratis; Werber: Gratismonat, sobald der Geworbene zahlt
- **Wunschliste & Tausch-Matches** – Push, sobald eine gesuchte Karte inseriert wird; Vorschläge für passende Tausch-Partner
- **Öffentliche Kartenseiten** – `/karte/<id>/<name>` mit Preis, Verlauf, Angeboten und Vorschaubild für Google & WhatsApp; `/sitemap.xml`
- **Teilen-Bilder** – Portfolio- und Pull-Bild (Instagram-Format) inkl. Empfehlungscode
- **Grading-Rechner** – „Lohnt sich PSA?“ mit KI-Zustandscheck (Zentrierung, Ecken, Kanten, Oberfläche)
- **Serien-Scan & CSV-Import** – viele Karten auf einmal ins Portfolio (Cardmarket-, Excel- oder Listen-Format)
- **Bindung** – tägliche Serie, 15 Abzeichen, Bestenliste (nur mit Zustimmung), Wochen-Report per Push
- **Kalender** – Set-Releases (Admin) und Community-Events mit Push-Erinnerung
- **Shop-Statistik** – Aufrufe, Anfragen und gefragteste Inserate für Pro-Trader
- **Offline-Modus** – App, Sammlung und Bilder bleiben ohne Netz verfügbar
- **Datenschutz** – Daten-Export (JSON), Konto selbst löschen, Impressum in der Admin-Zentrale pflegbar

## Echte Karten & Preise

Swipe-Arena, Booster-Simulator, Flip-Radar, „Rip or Keep“ und Scanner nutzen einen festen Katalog echter Chase-Karten
(Stürmische Funken, 151, Prismatische Entwicklungen, Zenit der Könige, Obsidianflammen, Mega-Entwicklung, Paradoxrift,
Drachenwandel) mit offiziellen Set-Nummern (`REAL_CARDS` in `public/index.html`). Die Preise sind ein Stand vom 13.11.2026
und werden beim Öffnen der Seite automatisch über `/api/prices` mit aktuellen Cardmarket-Werten (TCGdex) ersetzt.
PSA-10-Preise werden nicht geschätzt, sondern über eBay-„Verkauft“-Links (mit Partner-ID) angezeigt.

Alle eBay-Links tragen die ePN-Campaign-ID 5339244109 und eine `customid` pro Bereich (z. B. `pokeswipe-swipe`,
`pokeswipe-flip`, `pokeswipe-portfolio`), damit im ePN-Bericht sichtbar ist, welcher Bereich wie viel bringt.

## Aufbau

| Teil | Ort |
| --- | --- |
| Oberfläche (statisch) | `public/index.html` + `client/main.js` (wird beim Deploy zu `public/assets/app.js` gebündelt) |
| API (Netlify Server, Hono) | `netlify/server/index.ts` → `server/*.ts`, Pfad `/api/*` |
| Datenbank (Netlify Database, Drizzle) | `db/schema.ts`, Migrationen in `netlify/database/migrations/` |
| Preis-Tracker (stündlich) | `netlify/functions/price-tracker.mts` |
| Erinnerungen & Wochen-Report (stündlich) | `netlify/functions/growth-jobs.mts` |
| Konto löschen | `netlify/functions/delete-account.mts` |
| Tests | `npm test` (`tests/`) |
| Login | Netlify Identity (E-Mail, optional Google) |
| Zahlungen | Stripe Checkout (Abos & Boosts) |
| Firebase-Regeln | `firebase/database.rules.json` |

## Tarife

| | Free | Premium 4,99 €/Monat oder 49 €/Jahr | Pro Trader 9,99 €/Monat oder 99 €/Jahr |
| --- | --- | --- | --- |
| Wunschliste | 20 | 300 | 2000 |
| Portfolio-Karten | 25 | 500 | unbegrenzt |
| KI-Scans pro Tag | 3 | 40 | 250 |
| Verfolgte Sets | 1 | 10 | unbegrenzt |
| Händler-Shop | – | – | ✓ |
| Preisalarme | 3 | 50 | unbegrenzt |
| Aktive Inserate | 5 | 40 | unbegrenzt |
| Wertverlauf | – | ✓ | ✓ |
| Verifiziert-Badge, Platzierung vor anderen | – | – | ✓ |
| Gratis-Boosts pro Monat | – | – | 3 |
| CSV-Export | – | – | ✓ |

Das erste Abo kann 7 Tage gratis getestet werden (mit Empfehlung 30 Tage).
Einzel-Boost: 1,99 € für 7 Tage ganz oben im Tausch-Hub. Alle Limits werden auf dem Server geprüft.
Werte ändern: `server/plans.ts`.

## Einrichtung

1. **Stripe:** Umgebungsvariable `STRIPE_SECRET_KEY` in Netlify setzen. Ohne Schlüssel bleiben die Bezahl-Buttons inaktiv.
   Optional einen Webhook auf `https://pokeswipe-radar.de/api/billing/webhook` anlegen
   (Ereignisse `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`)
   und `STRIPE_WEBHOOK_SECRET` setzen. Ohne Webhook gleicht der Server Abos selbst mit Stripe ab.
2. **Admin-Zugang:** Im Netlify-Dashboard unter Identity beim eigenen Nutzer die Rolle `admin` vergeben
   (wirkt ab dem nächsten Login). Dann erscheint im Konto die „Admin-Zentrale“ mit Umsatz, Nutzern und Meldungen.
3. **Google-Login (optional):** Im Netlify-Dashboard unter Identity → External providers aktivieren.
4. **Grading-Affiliate (optional):** Sobald du Partner-Links hast, als Umgebungsvariablen setzen:
   `AFF_PSA_URL`, `AFF_CGC_URL`, `AFF_BGS_URL`, `AFF_TAG_URL` (vollständige https-Links). Ohne Variable führt der Button
   direkt zur Anbieter-Website. Klicks pro Partner siehst du in der Admin-Zentrale.
5. **Sealed-Preise:** In der Admin-Zentrale unter „Sealed-Referenzpreise“ Preise eintragen (z. B. vom Cardmarket-Trend)
   und neue Produkte anlegen. Jede Änderung landet im Preisverlauf und löst passende Alarme aus.
6. **Web-Push:** Funktioniert ohne Einrichtung – die Schlüssel erzeugt der Server beim ersten Aufruf selbst.
   Auf dem iPhone muss die App dafür zum Home-Bildschirm hinzugefügt werden (iOS 16.4+).
7. **Firebase-Regeln:** Den Inhalt von `firebase/database.rules.json` in der Firebase-Konsole
   (Realtime Database → Regeln) **in die bestehenden Regeln einfügen** – nur den Block `pokeswipe_radar`.
   Die Datenbank wird mit einem anderen Projekt geteilt, dessen Regeln erhalten bleiben müssen.
8. **Impressum:** Ist fest hinterlegt (Fußzeile, Rechtliches-Fenster und Kartenseiten). Änderungen optional in der Admin-Zentrale.
9. **Set-Releases:** Als Admin unter Community → Kalender eintragen (Art „Set-Release“). Nutzer können sich erinnern lassen.
