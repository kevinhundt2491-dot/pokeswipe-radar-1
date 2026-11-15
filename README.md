# PokeSwipe & Radar (pokeswipe-radar.de)

Die deutsche Sammler- & Trading-Plattform für Pokémon TCG – bewusst schlank, mit vier Bereichen:

1. **Swipe & Preise** – Karten swipen (rechts = merken, links = weiter). Jede Karte zeigt live den Cardmarket-Trend,
   das günstigste Angebot, Ø 30 Tage, die 30-Tage-Veränderung und einen 90-Tage-Verlauf. Darunter direkt die passenden
   Angebote aus dem Tausch-Hub, „Im Chat verhandeln“ und „Selbst inserieren“.
2. **Tausch-Hub** – Inserate mit Preis-Check, Filter (unter Marktwert, meine Stadt), private Verhandlung mit
   Schnellantworten, beidseitige Bestätigung, Bewertungen, Meldungen.
3. **Live-Chat** – öffentlicher Echtzeit-Chat (Firebase Realtime). Karten (`[karte:<id>]`) und Inserate (`[inserat:<id>]`)
   lassen sich anhängen und erscheinen als anklickbare Vorschau mit Preis bzw. „Verhandeln“-Knopf. Dazu die Pull-Wall.
4. **Sammlung** – Portfolio mit Live-Wert, Preisalarme, Wunschliste mit Tausch-Matches, KI-Kartenscan, Duplikat-Radar, CSV-Import.

Freemium: Besucher 15, registrierte Nutzer 30 Swipes pro Tag, Premium/Pro unbegrenzt (Stripe Checkout).
Web-Push, Offline-Modus, öffentliche Kartenseiten (`/karte/<id>/<name>`), Händler-Shops (`/shop/<name>`) und das
Empfehlungsprogramm laufen weiter. Die Admin-Werkzeuge (Reel-Studio, Auto-Reels) werden nur für Admins nachgeladen.

Die Server-Endpunkte für ältere Zusatzfunktionen (Restock-Radar, Sealed, Sets, Graded, Fake-Check, Kalender, Bestenliste)
bestehen weiter, sind aber nicht mehr in der Oberfläche eingebunden.

## Echte Karten & Preise

Swipe-Arena und Scanner nutzen einen festen Katalog echter Chase-Karten
(Stürmische Funken, 151, Prismatische Entwicklungen, Zenit der Könige, Obsidianflammen, Mega-Entwicklung, Paradoxrift,
Drachenwandel) mit offiziellen Set-Nummern (`REAL_CARDS` in `public/index.html`). Die Preise sind ein Stand vom 13.11.2026
und werden beim Öffnen der Seite automatisch über `/api/prices` mit aktuellen Cardmarket-Werten (TCGdex) ersetzt.
PSA-10-Preise werden nicht geschätzt, sondern über eBay-„Verkauft“-Links (mit Partner-ID) angezeigt.

Alle eBay-Links tragen die ePN-Campaign-ID 5339244109 und eine `customid` pro Bereich (z. B. `pokeswipe-swipe`,
`pokeswipe-flip`, `pokeswipe-portfolio`, `pokeswipe-masterset`), damit im ePN-Bericht sichtbar ist, welcher Bereich wie viel bringt.

Partner-IDs stehen zentral im `CONFIG`-Objekt ganz oben im Skript von `public/index.html`. Alle Cardmarket-Links bekommen
automatisch `utm_source=pokeswipe_radar`; sobald `CARDMARKET_PARTNER_ID` gefüllt ist, wird es als `referrer` angehängt.

## Aufbau

| Teil | Ort |
| --- | --- |
| Oberfläche (statisch) | `public/index.html` + `client/main.js` (wird beim Deploy zu `public/assets/app.js` gebündelt) |
| API (Netlify Server, Hono) | `netlify/server/index.ts` → `server/*.ts`, Pfad `/api/*` |
| Datenbank (Netlify Database, Drizzle) | `db/schema.ts`, Migrationen in `netlify/database/migrations/` |
| Preis-Tracker (stündlich) | `netlify/functions/price-tracker.mts` |
| Restock-Radar (alle 2 Minuten) | `netlify/functions/restock-radar.mts` → `server/drops.ts` |
| Erinnerungen & Wochen-Report (stündlich) | `netlify/functions/growth-jobs.mts` |
| Konto löschen | `netlify/functions/delete-account.mts` |
| Styles (Tailwind, beim Deploy kompiliert) | `client/tailwind.css` + `tailwind.config.js` → `public/assets/tailwind.css` |
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
| Restock-Alarm | 15 Min. verzögert | sofort | sofort + Filter |
| KI-Fake-Checks pro Monat | 1 | 20 | 200 |
| Graded-Karten (Slabs) | 3 | 200 | 5000 |
| Offene Grading-Einsendungen | 1 | 20 | 500 |

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
8. **Impressum:** Wird bewusst nicht im Code gespeichert. In der Admin-Zentrale eintragen (oder Umgebungsvariable
   `IMPRESSUM_TEXT`); es erscheint dann im Fenster „Impressum & Datenschutz“.
9. **Set-Releases:** Als Admin unter Community → Kalender eintragen (Art „Set-Release“). Nutzer können sich erinnern lassen.

## Auto-Reels & Make.com

Der Auto-Reels-Generator (nur Admins) schickt fertige MP4s per POST an Make.com. Ziel und Token kommen aus den
Netlify-Umgebungsvariablen und werden nur an Admins ausgeliefert:

| Variable | Zweck |
| --- | --- |
| `MAKE_WEBHOOK_URL` | Make.com-Webhook (https). Ohne Variable greift das bisherige Szenario als Rückfall. |
| `MAKE_WEBHOOK_TOKEN` | Optional: gemeinsamer Token für den Filter `token = …` im Make-Szenario (gilt für alle Admin-Browser). |
| `ELEVENLABS_API_KEY` | Sprecherstimme für die Auto-Reels (fest: ElevenLabs „Matilda“). Ohne Schlüssel startet der Generator mit Voiceover nicht. |

Jedes Reel ist fest 30 Sekunden lang. Das Skript einer Episode wird in einem durchgehenden Take gesprochen
(`/api/admin/voiceover/narration`, mit Zeitstempeln pro Satz); die Szenenwechsel folgen diesen Zeitstempeln.

Eine im Generator eingetragene URL bzw. ein eigener Token überschreibt die Vorgabe nur in diesem Browser.
