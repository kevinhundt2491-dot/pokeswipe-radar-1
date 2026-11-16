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
- **Empfehlungsprogramm mit Stufen** – geworbene Nutzer: 1. Monat gratis; Werber: Gratismonat pro zahlendem Freund,
  zusätzlich Stufen-Belohnungen (3 → 1 Monat Pro, 5 → 2 Monate Pro + Abzeichen, 10 → 6 Monate Pro, 25 → 1 Jahr Pro).
  Zahlende Werber bekommen eine Stripe-Gutschrift, alle anderen Bonus-Tage (`bonus_until`/`bonus_plan`); jede Belohnung
  steht genau einmal in `referral_rewards`. Persönliche Einladungsseite `/einladung/<code>` mit WhatsApp-Vorschau,
  Werber-Bestenliste (nur mit Zustimmung) und Dashboard im Konto (🎁 im Kopfbereich)
- **Verfolgte Teilen-Links** – `/s/<code>` zählt Besucher (gehashte IP + Browser, ohne Bots) und leitet mit Empfehlungscode
  weiter; jeder neue Besucher bringt dem Teilenden +1 KI-Scan am selben Tag (max. 10). Share-Sheet mit WhatsApp,
  Telegram, X, Facebook und nativem Teilen
- **Wunschliste & Tausch-Matches** – Push, sobald eine gesuchte Karte inseriert wird; Vorschläge für passende Tausch-Partner
- **Öffentliche Kartenseiten** – `/karte/<id>/<name>` mit Preis, Verlauf, Angeboten und Vorschaubild für Google & WhatsApp; `/sitemap.xml`
- **Teilen-Bilder** – Portfolio- und Pull-Bild (Instagram-Format) inkl. Empfehlungscode
- **Grading-Rechner** – „Lohnt sich PSA?“ mit KI-Zustandscheck (Zentrierung, Ecken, Kanten, Oberfläche)
- **Serien-Scan & CSV-Import** – viele Karten auf einmal ins Portfolio (Cardmarket-, Excel- oder Listen-Format)
- **Bindung** – tägliche Serie, 15 Abzeichen, Bestenliste (nur mit Zustimmung), Wochen-Report per Push
- **Kalender** – Set-Releases (Admin) und Community-Events mit Push-Erinnerung
- **Shop-Statistik** – Aufrufe, Anfragen und gefragteste Inserate für Pro-Trader
- **Offline-Modus** – App, Sammlung und Bilder bleiben ohne Netz verfügbar
- **Master-Set-Tracker** – genaue Stückzahl pro Karte (0x, 1x, 2x, 5x …), Live-Fortschritt mit Restkosten,
  „Set vervollständigen“-Modus mit Cardmarket- und eBay-Links je fehlender Karte und Wants-Listen-Export
- **Duplikat-Radar** – Überschuss-Badges ab 2x, 1-Klick-Inserat im Tausch-Hub, Cardmarket-Verkaufs-Assistent und
  CSV-Bulk-Export für den Cardmarket-Bestands-Import
- **Restock- & Vorbestell-Radar** – automatische Prüfung beobachteter Shop-Produktseiten alle 2 Minuten (schema.org-Verfügbarkeit),
  Community-Meldungen mit 2 Bestätigungen, UVP-Ampel, Vorbestell-Preisvergleich je Shop. Push für Premium/Pro sofort, Free 15 Min. später;
  Pro mit Filtern (Shop, Stichwort, Höchstpreis, nur UVP). Shop-Links mit Amazon-Partner-Tag (`AMAZON_PARTNER_TAG`) und Klick-Zählung
- **Graded-Portfolio** – Slabs mit Firma, Note, Zertifikat-Link, Wert, Gewinn und eBay-„Verkauft“-Link; **Grading-Einsendungs-Tracker**
  mit Status und Push-Erinnerung bei Überfälligkeit
- **KI-Fake-Check** – Vorder- und Rückseite, Prüfung auf typische Fälschungsmerkmale (Claude Sonnet über Netlify AI Gateway)
- **Datenschutz** – Daten-Export (JSON), Konto selbst löschen, Impressum in der Admin-Zentrale pflegbar
- **Rechtliches** – `/rechtliches` mit Impressum (§ 5 DDG), AGB, Widerrufsbelehrung inkl. digitaler Leistungen und
  Muster-Widerrufsformular; Anbieterdaten pflegt der Admin (Netlify Blobs). Vor jeder Bestellung bestätigen Kunden
  AGB und sofortigen Leistungsbeginn (Nachweis mit AGB-Version in den Stripe-Metadaten)
- **Kündigungsbutton (§ 312k BGB)** – `/kuendigen` ohne Login, mit Bestätigungsseite, Eingangsnachweis (Tabelle
  `cancellations`), Bestätigung zum Speichern/Drucken, Mitteilung im Konto und optional per E-Mail
- **Deutscher Kartenkatalog** – alle Sets und Einzelkarten werden automatisch aus TCGdex importiert
  (`netlify/functions/catalog-import.mts`, alle 10 Min.), öffentliche Set-Seiten `/sets` und `/set/<id>/<name>`,
  Sitemap-Index `/sitemap.xml` mit Teil-Sitemaps, Sealed-Preis-Import per CSV in der Admin-Zentrale
  (optional mit Inhalt, Booster-Anzahl und Beschreibung). Beim Preisabruf werden Pokédex-Nr., KP, Typ, Phase, Varianten
  und Regulation-Mark gespeichert; daraus entstehen die Pokémon-Arten (`pokemon_species`, inkl. englischem Namen).
  Jeder Import-Lauf wird in `catalog_import_runs` protokolliert (30 Tage, sichtbar in der Admin-Zentrale)
- **SEO-Seiten** – `/pokemon` (A–Z) und `/pokemon/<name>` („Glurak Karten Wert“ mit FAQ), `/sealed` und `/sealed/<name>`
  (Marktpreis vs. UVP, Preis pro Booster, Verlauf), `/trends` (Gewinner/Verlierer 30 Tage, meistgesuchte Karten);
  alle mit strukturierten Daten und eigenen Teil-Sitemaps

- **Navigation mit 5 Kernbereichen** – Entdecken (Swipe-Arena), Live-Scanner, Flip-Radar, Meine Sammlung, Community & Markt.
  Einfache und Profi-Ansicht (Profi-Werte wie Margen, PSA-Links, Grading-Tools, Tausch-Rechner nur in „Profi“ oder einzeln
  aufklappbar), 3-Schritte-Onboarding beim ersten Besuch (Ziel: Sammeln / Tauschen / Deals snipen, Sprachen, Ansicht) mit
  Demo-Modus ohne Anmeldung. Wiederkehrende Nutzer behalten die volle Ansicht (`client/shell.js`)
- **Mehrsprachiger Katalog (DE/EN/JA)** – englische und japanische Drucke als eigene Einträge (`card_prints`, `print_sets`)
  mit eigenen Set-Codes, Nummern und Bildern; Preis-Feeds getrennt: Cardmarket (EUR, bei Japanisch eigene Produkte) und
  TCGplayer (USD, über EZB-Kurse `fx_rates` umgerechnet). Widersprechen sich die Feeds um mehr als Faktor 4, gilt TCGplayer.
  Import alle 10 Minuten (`netlify/functions/catalog-intl-import.mts`), Detailansicht `/api/prints/<lang>:<id>`.
  Sammlungs-Einträge speichern Sprache und Druck (`portfolio_items.lang`, `print_id`)
- **Dynamische Swipe-Arena** – der Stapel kommt live aus dem Katalog aller Sprachen und aus Tausch-Inseraten (`/api/swipe/deck`),
  gewichtet nach Wert; Filter nach Sprache, Set, Seltenheit, Preisspanne, Wunschliste und „Nur Unter-Marktwert“ (ab 15 %,
  Marktwert ab 3 €). Rechts wischen merkt die Karte und setzt sie mit Konto auf die Wunschliste (`client/arena.js`).
  Ohne Verbindung bleibt der feste Chase-Katalog aktiv
- **Authentifizierte Community (Phase 4)** – Pull-Wall, Kommentare und Live-Chat laufen über die eigene API mit Login-Pflicht
  (Netlify Identity, bestätigte E-Mail) statt anonym über Firebase (`server/community.ts`, `client/community.js`).
  Trust-Score 0–100 (Kontoalter, E-Mail, Tausche/Käufe, Bewertungen, Abo, verifizierter Verkäufer, Verstöße) mit Stufen
  🌱 Neu · ✅ Bekannt · 🛡️ Vertrauenswürdig · 🏅 Top-Sammler. Schreib-Limits je Stufe (datenbankgestützt), Wort-/Link-Filter
  (Beleidigungen auch mit Ersatzzeichen, Kurz-/Einladungslinks, Telefonnummern, „PayPal Freunde“, Schreien, Spam, Doppel-Posts;
  fremde Links erst ab „Bekannt“, bis „Top“ mit Prüfung) – Regeln in `server/community-logic.ts`. Melden, Blockieren (beidseitig,
  auch für Tausch- und Kaufanfragen), automatisches Ausblenden ab 3 Meldungen, Admin-Moderation (entfernen, wiederherstellen,
  stummschalten, sperren/entsperren, Protokoll)
- **Öffentliche Sammler-Profile & Social Feed** – `/u/<name>` (nur mit Zustimmung) mit Showcase, Tausch-Ordner (Inserate +
  doppelte Karten), Wunschliste, Abzeichen, Wert-Stufe statt Euro-Betrag, Bewertungen, Follower und letzten Pulls; Folgen,
  Feed „⭐ Gefolgt“, teilbare Beiträge `/p/<id>`, dynamische OpenGraph-Bilder (JPEG-Kartenfächer, `/api/og/…`) für WhatsApp & Co.,
  Teil-Sitemap `/sitemaps/profiles.xml` (`server/profiles.ts`, `server/og-image.ts`, `client/profile.js`)
- **Marktplatz mit Käuferschutz (Treuhand)** – Stripe Connect Express für Verkäufer, Sofort-Kauf und verbindliche Preisangebote
  (ab 50 %), Zahlung an die Plattform, Lieferadresse erst nach Zahlung, Auszahlung nach Erhalt-Bestätigung oder automatisch
  14 Tage nach Versand, Erstattung bei fehlendem Versand nach 7 Tagen, Reklamationen mit Admin-Entscheidung, Bewertungen.
  Provision des Verkäufers: Free 6,5 %, Premium 5 %, Pro-Pass 3 % (min. 0,49 €). Fristen-Job `market-escrow` alle 15 Min.
  (`server/market.ts`, `server/market-logic.ts`, `client/market.js`)
- **PWA Deluxe & native App** – Manifest mit PNG-/Maskable-Icons und Shortcuts, Installations-Hinweis (Android-Dialog bzw.
  iPhone-Anleitung „Zum Home-Bildschirm“), Offline-Katalog im Service Worker. Capacitor-Konfiguration (`capacitor.config.ts`,
  `npm run cap:add|cap:sync|cap:ios|cap:android`, Berechtigungs-Skript `scripts/cap-native-setup.mjs`), Push in der App über
  Firebase Cloud Messaging, Universal/App Links – Anleitung in `native/README.md`

- **Phase 5 – Abschluss-Ausbau**
  - *Preference-Learning in der Swipe-Arena* – jeder Rechts-/Links-Swipe (und das Öffnen der Details) verändert Gewichte für
    Seltenheit, Sprache, Set und Preisband; ab 5 Swipes wird der Stapel serverseitig danach gewichtet (`server/arena-logic.ts`,
    `server/arena.ts`, Tabelle `swipe_preferences`; ohne Konto bleibt das Profil auf dem Gerät und geht als `?pw=` mit)
  - *Set-Booster-Simulator* – Booster aller Sets aus dem Live-Katalog (🇩🇪/🇬🇧/🇯🇵) mit Slot-Aufbau und Zieh-Raten der
    Karmesin-&-Purpur-Ära, 1/10/36 Packs, Pack-Wert-Bilanz und Sitzungs-Bilanz je Set; „Rip or Keep“ zeigt den Erwartungswert
    des ganzen Displays (`/api/booster/open`, `/api/booster/ev`, `client/booster.js`, Karten-Pools 30 Min. im Server-Cache)
  - *Geteilte Community-Deals* im Flip-Radar (`/api/flip/community-deals`, Tabellen `community_deals`, `community_deal_votes`):
    für alle sichtbar, 72 Std. aktiv, Marktwert-Abgleich über die Kartennummer, Abstimmung „noch da / weg“, Melden & Blockieren
  - *Sammler-Radar mit Login-Pflicht* (`/api/radar`, Tabelle `radar_pins`): ein Pin pro Konto, Koordinaten serverseitig auf ein
    ~1-km-Raster gerundet, Filter, Limits, Melden, Blockieren, Admin-Moderation (`server/deals-radar.ts`, `client/deals-radar.js`)
  - *Händler-Shops* – öffentliche Seite `/shop/<name>` (Server-Rendering, OpenGraph-Bild `/api/og/shop/<name>.jpg`, JSON-LD) mit
    Banner, Logo, Akzentfarbe, ✔-Badge, Antwortzeit, Bewertungen, Kennzahlen und 🇩🇪/🇬🇧/🇯🇵-Filter; Inventar im App-Dialog
    alle 30 Sek. live (`server/shops.ts`). Inserate speichern die Sprache (`listings.lang`)
  - *Scanner-Basis-Index* – vorberechnete Fingerabdrücke aller TCGdex-Karten mit Bild (`server/scan-seed/*.ts`, in Teilen à ~90 KB, erzeugt mit
    `node scripts/build-scan-seed.ts`); der Job `scan-hash-index` übernimmt sie beim ersten Lauf für jede Katalogkarte mit
    identischem Bild, „Index jetzt erweitern“ stößt das sofort an

## Echte Karten & Preise

Swipe-Arena, Booster-Simulator, Flip-Radar, „Rip or Keep“ und Scanner nutzen einen festen Katalog echter Chase-Karten
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
| Kartenkatalog-Import (alle 10 Minuten) | `netlify/functions/catalog-import.mts` → `server/catalog.ts` + `server/seo.ts` |
| Pokémon-, Sealed- & Trend-Seiten | `server/seo.ts` |
| Mehrsprachiger Katalog (EN/JA), Swipe-Deck-API | `server/intl-catalog.ts` + `server/intl-logic.ts`, Import `netlify/functions/catalog-intl-import.mts` |
| Navigation, Onboarding, Einfach/Profi-Ansicht | `client/shell.js` |
| Dynamische Swipe-Arena (Filter, Nachladen, Druck-Details) | `client/arena.js` |
| Teilen-Links, Einladungsseite, Empfehlungs-Stufen | `server/viral.ts` + `client/viral.js`, Stufen in `server/plans.ts` |
| Rechtstexte & Kündigungsbutton | `server/legal.ts` (`/rechtliches`, `/kuendigen`, `/api/legal`) |
| Integrations-Check & Stripe-Webhook-Einrichtung | `server/integrations.ts` (Admin-Zentrale) |
| Styles (Tailwind, beim Deploy kompiliert) | `client/tailwind.css` + `tailwind.config.js` → `public/assets/tailwind.css` |
| Tests | `npm test` (`tests/`) |
| Login | Netlify Identity (E-Mail, optional Google) |
| Zahlungen | Stripe Checkout (Abos & Boosts) |
| Firebase-Regeln | `firebase/database.rules.json` |

## Live-Scanner (auf dem Gerät)

Der Bereich **Live-Scanner → ⚡ Live-Scan** erkennt Karten direkt im Browser, ohne Foto-Upload und ohne Server-KI pro Bild:

- `client/scanner/live-scanner.js`: Rückkamera (`getUserMedia`), Rahmenführung, Taschenlampe, Live-HUD mit Name, Sprache, Marktpreis,
  PSA-10-Wert und den Knöpfen *Zur Sammlung*, *Auf Wishlist*, *Flip-Check*, außerdem eine Liste der in der Sitzung gescannten Karten.
- `client/scanner/scan-worker.js` (wird zu `public/assets/scan-worker.js` gebündelt): Kantenerkennung, Perspektivkorrektur,
  pHash/dHash, Suche im lokalen Index, Kartennummer per Texterkennung bzw. Ziffern-Vorlagen – ca. 5–20 ms pro Bild.
- `server/scan-logic.ts`: gemeinsame Bildverarbeitung für Browser, Server und Tests.
- Job `scan-hash-index` (alle 10 Minuten): berechnet die Referenz-Fingerabdrücke aus den TCGdex-Bildern (wertvolle Karten zuerst).
  `/api/scan/index?lang=de|en|ja` liefert den Index (CDN-gecacht, offline über den Service Worker), `/api/scan/lookup` die Details.
- Kennt der Index eine Karte noch nicht, bleibt der bisherige KI-Foto-Scan als Rückfall erhalten.

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
   **Webhook:** In der Admin-Zentrale auf „Stripe-Webhook automatisch einrichten“ klicken – der Server legt den Webhook
   auf `/api/billing/webhook` an und speichert das Signatur-Geheimnis selbst (Netlify Blobs). Alternativ manuell anlegen
   (Ereignisse `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*`,
   `invoice.paid`, `invoice.payment_failed`) und `STRIPE_WEBHOOK_SECRET` setzen. Ohne Webhook gleicht der Server Abos
   alle 6 Stunden selbst mit Stripe ab. Status und letztes Ereignis zeigt die Admin-Zentrale.
   **Partner-IDs:** `AMAZON_PARTNER_TAG` (z. B. `name-21`) und `CARDMARKET_PARTNER_ID` setzen – beide greifen in Server
   und App (die Cardmarket-ID kommt über `/api/public-config` in den Browser).
2. **Admin-Zugang:** Im Netlify-Dashboard unter Identity beim eigenen Nutzer die Rolle `admin` vergeben
   (wirkt ab dem nächsten Login). Dann erscheint im Konto die „Admin-Zentrale“ mit Umsatz, Nutzern und Meldungen.
3. **Google-Login (optional):** Im Netlify-Dashboard unter Identity → External providers aktivieren.
4. **Grading-Affiliate (optional):** Sobald du Partner-Links hast, als Umgebungsvariablen setzen:
   `AFF_PSA_URL`, `AFF_CGC_URL`, `AFF_BGS_URL`, `AFF_TAG_URL` (vollständige https-Links). Ohne Variable führt der Button
   direkt zur Anbieter-Website. Klicks pro Partner siehst du in der Admin-Zentrale.
5. **Sealed-Preise:** Laufen automatisch (Job `update-sealed-prices`, alle 3 Stunden): echte eBay-Verkäufe → beendete
   Auktionen → unteres Quartil der Sofort-Kaufen-Angebote → Community-Inserate. Ein Preis aus der Admin-Zentrale oder dem
   CSV-Import gilt als manueller Override und wird gesperrt; im Flip-Radar (Admin-Bereich) lässt er sich wieder freigeben.
   Jede Änderung landet im Preisverlauf und löst passende Alarme aus.
5a. **Live Flip-Radar (eBay):** `EBAY_CLIENT_ID` und `EBAY_CLIENT_SECRET` (Production-Keyset einer App auf
   developer.ebay.com) als Netlify-Variablen setzen. Dann fragt der Job `flip-radar-sync` alle 10 Minuten die eBay Browse API ab,
   speichert echte Einzelangebote mit ePN-Partner-Link (Campaign-ID 5339244109) und berechnet Deals ab 20 % unter Marktwert.
   Echte Verkaufsdaten (Marketplace Insights API) nutzt der Server automatisch, sobald eBay die App dafür freischaltet;
   bis dahin zählen beendete Auktionen mit Geboten als Verkäufe. Ohne Schlüssel läuft der Radar im gekennzeichneten
   Demo-Modus mit echten Cardmarket-Tiefstpreisen.
5b. **eBay-Kontolöschungs-Webhook (Pflicht für Production-Keys):** Einen eigenen Token (32–80 Zeichen: A–Z, a–z, 0–9, `_`, `-`)
   als `EBAY_VERIFICATION_TOKEN` in Netlify setzen und neu deployen. Im eBay-Developer-Portal unter „Alerts & Notifications →
   Marketplace account deletion“ denselben Token und die URL `https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion`
   eintragen (bei anderer URL zusätzlich `EBAY_ENDPOINT_URL` setzen). Ohne Token antwortet der Endpoint mit 503.
6. **Web-Push:** Funktioniert ohne Einrichtung – die Schlüssel erzeugt der Server beim ersten Aufruf selbst.
   Auf dem iPhone muss die App dafür zum Home-Bildschirm hinzugefügt werden (iOS 16.4+).
7. **Firebase-Regeln:** Den Inhalt von `firebase/database.rules.json` in der Firebase-Konsole
   (Realtime Database → Regeln) **in die bestehenden Regeln einfügen** – nur den Block `pokeswipe_radar`.
   Die Datenbank wird mit einem anderen Projekt geteilt, dessen Regeln erhalten bleiben müssen.
   **Strenge Stufe (empfohlen):** In der Firebase-Konsole unter Authentication → Anmeldemethode „Anonym“ aktivieren,
   den Web-API-Schlüssel (Projekteinstellungen → Allgemein, kein Geheimnis) als Netlify-Variable `FIREBASE_WEB_API_KEY`
   setzen, neu deployen und danach den Block aus `firebase/database.rules.strict.json` verwenden. Dann darf nur noch
   schreiben, wer anonym angemeldet ist; jeder Eintrag ist an die eigene UID gebunden, Chat/Pull-Wall/Kommentare sind
   serverseitig auf einen Beitrag alle 3 Sekunden pro Person gebremst und jede Person kann einen Beitrag nur einmal liken.
8. **Impressum:** Wird bewusst nicht im Code gespeichert. In der Admin-Zentrale die Felder (Name/Firma, Anschrift,
   E-Mail, ggf. Telefon/USt-IdNr.) ausfüllen – daraus entstehen Impressum, Anbieterangaben in AGB/Widerrufsbelehrung und
   das Muster-Widerrufsformular. Rückfall: Freitext oder Umgebungsvariable `IMPRESSUM_TEXT`.
   **Kündigungsbestätigung per E-Mail (optional):** `RESEND_API_KEY` und `MAIL_FROM` (z. B. `PokeSwipe <kontakt@pokeswipe-radar.de>`)
   setzen. Ohne diese Variablen wird die Bestätigung auf der Seite angezeigt, als Datei angeboten und im Konto hinterlegt.
9. **Set-Releases:** Als Admin unter Community → Kalender eintragen (Art „Set-Release“). Nutzer können sich erinnern lassen.
10. **Marktplatz mit Käuferschutz:** Im Stripe-Dashboard **Connect** aktivieren (Plattform-Profil: „Marktplatz“, Verkäufer als
   Express-Konten, Land Deutschland). Weitere Schlüssel sind nicht nötig – der bestehende `STRIPE_SECRET_KEY` und Webhook genügen.
   Reklamationen und Treuhand-Summen stehen in der Admin-Zentrale unter „⚖️ Marktplatz & Reklamationen“.
11. **Community:** Läuft ohne Einrichtung. Chat, Pull-Wall, Community-Deals und Sammler-Radar nutzen Firebase nicht mehr –
   die aktualisierten Regeln aus `firebase/database.rules.json` (alles außer Besucherzähler/Online-Anzeige gesperrt,
   Schreiben nur mit Firebase-Anmeldung) in der Firebase-Konsole übernehmen.
12. **Native App (optional):** siehe `native/README.md` – Push über `FCM_SERVICE_ACCOUNT`, App-Links über `APPLE_TEAM_ID`
   und `ANDROID_CERT_SHA256`.

## Auto-Reels & Make.com

Der Auto-Reels-Generator (nur Admins) schickt fertige MP4s per POST an Make.com. Ziel und Token kommen aus den
Netlify-Umgebungsvariablen und werden nur an Admins ausgeliefert:

| Variable | Zweck |
| --- | --- |
| `MAKE_WEBHOOK_URL` | Make.com-Webhook (https). Ohne Variable greift das bisherige Szenario als Rückfall. |
| `MAKE_WEBHOOK_TOKEN` | Optional: gemeinsamer Token für den Filter `token = …` im Make-Szenario (gilt für alle Admin-Browser). |
| `FIREBASE_WEB_API_KEY` | Optional: Firebase-Web-API-Schlüssel für die anonyme Anmeldung (strenge Firebase-Regeln). |
| `ELEVENLABS_API_KEY` | Sprecherstimme für die Auto-Reels (fest: ElevenLabs „Matilda“). Ohne Schlüssel startet der Generator mit Voiceover nicht. |

Reel Studio und Auto-Reels (10x) erzeugen **ausschließlich echte Live-Aufnahmen der Website**: Die App läuft
in einer 9:16-Live-Stage (iframe `/?reel=1`, 414×736 CSS-px → 1080×1920), darauf laufen echte Swipes, Taps und
Scrolls (`client/reel-scenarios.js`). Aufnahme-Modi: Live-DOM-to-Canvas über SVG `foreignObject`
(`client/dom-capture.js`, bis 30 FPS, Standard für Auto-Reels) oder native Tab-Aufnahme per `getDisplayMedia`
(`preferCurrentTab`, 60 FPS, Reel Studio). Ablauf (`client/reel-recorder.js`): Sprecherin komplett erzeugen und
dekodieren → Live-Seite inkl. API-Daten und Bilder fertig laden → Frame 0 zeichnen → `MediaRecorder.start()` →
Stopp beim `onended` der Stimme + 0,5 s. Skripte (`client/reel-scripts.js`) haben 32–36 Wörter (15 s) bzw.
65–72 Wörter (30 s); der Server nimmt höchstens 72 Wörter an. Zu jedem Video entsteht eine separate
Post-Beschreibung (Hook, Mehrwert, CTA, 5–8 Hashtags) – mit Kopier-Button, als `.txt` neben dem MP4 und als
Make-Felder `caption`, `title`, `hashtags`, `hashtags_json`, `meta` und `caption_file`.
Dafür erlauben `X-Frame-Options: SAMEORIGIN` und `frame-ancestors 'self'` das Einbetten nur vom eigenen Ursprung.

Eine im Generator eingetragene URL bzw. ein eigener Token überschreibt die Vorgabe nur in diesem Browser.

## Phase 6 – Varianten, echtes Swipe-Trading, Suche, Plattform-Pflichten, Härtung

- **Varianten-Ebene** – Normal, Reverse Holo, Holo, 1st Edition, Shadowless, Promo als eigene Einheit in Portfolio, Inseraten,
  Wunschliste, CSV-Import und Tausch. Reverse-Holo-Preise von Cardmarket getrennt gespeichert (`cards.reverse_*`, `price_history.reverse_*`),
  TCGplayer-Variantenpreise je Druck (`card_prints.variant_prices`), Zustandsfaktoren (EX 85 %, GD 70 %, LP 60 %, PL 45 %, PO 30 %).
  Logik: `server/variant-logic.ts`
- **Echtes Swipe-Trading** – Rechts-Swipe auf ein Inserat = `swipe_likes`; gegenseitiges Interesse (Like oder Wunschliste) erzeugt
  sofort ein `trade_matches`-Match mit Push und vorausgefülltem Tauschvorschlag. Tausche bestehen aus `trade_items` (Karten aus der Sammlung)
  plus optionalem Wertausgleich und laufen über Annahme → Versand je Seite (Sendungsnummer) → Erhalt je Seite → Abschluss (Karten wechseln
  die Sammlung). `server/trading.ts`, `server/trading-logic.ts`, `client/trading.js`
- **Kartensuche** – `GET /api/search` über den eigenen Katalog (DE + EN/JA), `pg_trgm`-Indizes, Nummern („4/102“), Set-Kürzel, Sprache,
  Variante, Seltenheit, Preis; CDN-gecacht. Eine zentrale Client-Funktion (`client/search.js`)
- **Stripe** – Kundenportal (`POST /api/billing/portal`), Stripe Tax im Abo-Checkout (fällt ohne Einrichtung automatisch zurück),
  Rückbuchungen (`charge.dispute.*`): Bestellung einfrieren, Auszahlung zurückholen, Konto markieren
- **Betrugsschutz & Pflichten** – Treuhand-Wertgrenzen je Vertrauensstufe, DAC7-Zähler, Steuerdaten-Formular, Admin-Auswertung und
  BZSt-Export (`server/dac7.ts`), DSA-Melde- und Abhilfeverfahren (AGB § 8b) mit Begründung bei jeder Moderationsentscheidung,
  Set-Vollständigkeits-Report, vollständige Kontolöschung (Stripe-Kunde, Connect-Konto, Firebase-Präsenz, Blobs)
- **Datenschutzerklärung** – eigenständig unter `/datenschutz` (`server/privacy.ts`)
- **Härtung** – verteiltes Rate-Limiting (`rate_limits`), Token-Vorprüfung + Cache, strukturiertes Logging (`server/log.ts`, `error_log`),
  Circuit-Breaker/Backoff/Zeitbudget für alle geplanten Jobs (`server/resilience.ts`, `job_runs`, `job_circuits`), CDN-Cache für öffentliche
  Seiten (`server/cache.ts`), strikte CSP ohne `'unsafe-inline'` in `script-src` (Inline-Skripte ausgelagert nach `public/js/`,
  on…-Attribute über `public/js/csp-handlers.js`), Code-Splitting (Reel-Studio, Auto-Reels, Live-Scanner, Booster als eigene Chunks)
