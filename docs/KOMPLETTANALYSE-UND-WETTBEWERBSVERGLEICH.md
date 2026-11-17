# PokeSwipe Radar – Abschlussanalyse & Wettbewerbsvergleich

**Stand:** 17.11.2026, 18:45 UTC. Abschlussprüfung aller Funktionen gegen die Live-Produktion (pokeswipe-radar.de), die Datenbank und die angebundenen Dienste.
**Ersetzt:** alle früheren Analyseberichte (auch die Fassung nach dem Security-/DAC7-Upgrade vom selben Tag).

> Das Repository ist öffentlich. Dieser Bericht enthält deshalb keine Umsätze, Nutzerzahlen, Kunden-IDs oder Schlüssel.
> Die Angaben zur Konkurrenz beruhen auf öffentlich bekannten Produktmerkmalen (Wissensstand 2026) und sollten vor
> einer Verwendung im Marketing gegengeprüft werden.

---

## 1. Ergebnis auf einen Blick

| Bereich | Status | Kurzbefund |
|---|---|---|
| Code-Qualität | ✅ | 249 von 249 automatischen Tests grün, TypeScript fehlerfrei |
| Website & Rechtsseiten | ✅ | Startseite, Sets, Trends, Sealed, Datenschutz, Kündigungsbutton (§ 312k), Sitemap, robots, Manifest, Service-Worker antworten in 0,1–0,3 s |
| API-Sicherheit | ✅ | Alle 268 API-Routen live geprüft: Schreibzugriffe von fremden Seiten → 403, ohne Anmeldung → 401. Nur öffentliche Lesedaten antworten ohne Login |
| **Zahlung (Stripe)** | 🟠 | Technik einwandfrei (Live-Modus, Webhooks mit Signatur, 0 fehlgeschlagene Zustellungen, Kundenportal funktioniert). **Aber: Abo-Daten in Stripe und App passen nicht zusammen, siehe 2.1** |
| Anmeldung (Netlify Identity) | ✅ | E-Mail-Registrierung mit Bestätigungsmail aktiv. Social-Login ist nicht eingeschaltet |
| Datenbank (Netlify Database) | ✅ | 20.532 DE-Karten, 34.586 EN/JA-Drucke, rund 29.500 Bewertungen, 38.845 Scan-Fingerabdrücke |
| Hintergrund-Jobs | ✅ | 10 Jobs, über 1.600 Läufe in 24 h, **0 Fehler**. Teil-Läufe nur durch kurze TCGdex-Ausfälle (HTTP 503), danach selbst erholt |
| Firebase | ✅ | Regeln dicht: Lesen und Schreiben ohne Login gesperrt. Öffentlich lesbar sind nur Besucherzähler und Online-Status |
| E-Mail (Resend) | ✅ | Absender-Domain verifiziert (EU-Region) |
| KI (Scanner-Fallback) | ✅ | Alle genutzten Modelle sind im Netlify AI Gateway verfügbar |
| Push (Web) | ✅ | Schlüssel vorhanden, Push-Anmeldung funktioniert |
| Voiceover (Pro-Videos) | 🔴 | ElevenLabs-Kontingent aufgebraucht, 36 Fehler heute |
| Native Apps (iOS/Android) | 🟡 | Vorbereitet, aber In-App-Kauf (RevenueCat) und native Push (FCM) sind noch nicht konfiguriert |
| Marktplatz | 🟡 | Technisch fertig, aber **noch keine Inserate und Bestellungen**. Stripe-Connect-Verkäuferkonten: noch keine |

**Gesamturteil:** Die Technik läuft stabil und sicher. Kein Job fällt aus, kein Endpunkt ist offen, und Zahlungen werden korrekt verifiziert.
Vor dem 22.11.2026 muss aber unbedingt der Abo-Befund in Kapitel 2.1 erledigt werden.

---

## 2. Befunde mit Handlungsbedarf (nach Dringlichkeit)

### 2.1 🔴 Abo-Daten: Stripe und App stimmen nicht überein (bis 22.11. erledigen)

- In Stripe laufen mehrere **Live-Testabos für „Pro“** (9,99 €/Monat). Die Testphase endet am **22.11.2026**, danach wird abgebucht.
- **Ein Kundenkonto hat vier parallele Pro-Abos.** Sie wurden innerhalb weniger Minuten am 15.11. abgeschlossen, offensichtlich Testkäufe. Ohne Eingriff wird dieses Konto am 22.11. viermal belastet.
- In der App-Datenbank stehen **alle Profile auf „Free“**: kein Abo verknüpft, keine Zahlung protokolliert, Testphase als nicht genutzt markiert. Die Nutzer sehen ihre Pro-Vorteile also nicht. Weil die Testphase nicht als genutzt markiert ist, kann dieselbe Person erneut eine Testphase starten.
- Der Code selbst ist korrekt: Nach dem Checkout wird die Zahlung genau einmal gebucht, das Abo verknüpft und die Testphase markiert. Bei einem Tarifwechsel wird das alte Abo automatisch gekündigt. Am wahrscheinlichsten wurden die Datenbankeinträge nachträglich zurückgesetzt, etwa bei Tests oder einem Daten-Reset. Am 22.11. würde die erste bezahlte Rechnung das Profil wieder verknüpfen, aber die überzähligen Abos würden trotzdem abgebucht.

**Behoben im Code (17.11.2026):** Ein neuer stündlicher Job „billing-reconcile“ gleicht alle laufenden Stripe-Abos mit der App ab:
Pro Kunde bleibt genau ein Abo (bezahlt vor Testphase, höherer Tarif, bereits verknüpftes, sonst das älteste), alle weiteren werden
sofort gekündigt, in der Testphase ohne Abbuchung. Das Profil wird mit Kunde, Abo und Tarif neu verknüpft, und die Testphase wird als genutzt markiert.
Der Checkout fragt jetzt vor jedem Kauf direkt bei Stripe nach laufenden Abos, verknüpft sie und blockiert ein zweites gleiches Abo und eine zweite Testphase.
Manuell lässt sich der Abgleich als Admin über `POST /api/admin/billing/reconcile` starten (`?dryRun=1` zeigt nur die geplanten Änderungen).
Damit der Abgleich vor dem 22.11. greift, muss die Änderung bis dahin live gehen.

**Ursprünglich empfohlen (Stripe-Dashboard → Kunden → Abonnements), nach dem Deploy nur noch zur Kontrolle:**
1. Die überzähligen Pro-Testabos sofort kündigen. Pro Kunde darf höchstens eines übrig bleiben. Echte Testkäufe am besten alle kündigen.
2. Danach in der App einmal ab- und wieder anmelden und prüfen, ob der Tarif stimmt.
3. Empfehlung für später: eine zusätzliche Sperre im Checkout, die vor dem Kauf bei Stripe nachsieht, ob der Kunde schon ein laufendes Abo hat. Bisher prüft die Sperre nur die App-Datenbank.

### 2.2 🟠 Fehlende Umgebungsvariablen

| Variable | Folge, solange sie fehlt | Dringlichkeit |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | Steuerdaten (DAC7) werden mit einem automatisch erzeugten Notfall-Schlüssel aus Netlify Blobs verschlüsselt. Das ist sicher, aber der Schlüssel liegt bei den Daten statt getrennt davon | hoch, **vor dem ersten Verkäufer** setzen (`openssl rand -hex 32`, als Secret, danach nie ändern) |
| `DHL_TRACKING_API_KEY` | Die Treuhand zahlt nach der alten Regel 14 Tage nach Versand aus statt erst ab DHL-Zustellung | mittel, vor den ersten Marktplatz-Bestellungen |
| `REVENUECAT_IOS_API_KEY`, `REVENUECAT_WEBHOOK_AUTH` | Kein In-App-Kauf in der iOS-App. Apple lässt digitale Abos ohne In-App-Kauf nicht zu | Pflicht vor dem App-Store-Start |
| `FCM_SERVICE_ACCOUNT` | Keine nativen Push-Nachrichten in den Store-Apps (Web-Push funktioniert) | vor dem Store-Start |
| `OPERATOR_*` | Nur Reserve. Das Impressum kommt aus der Admin-Zentrale | optional |
| `CARDMARKET_PARTNER_ID` | Cardmarket-Links ohne Partner-Provision | geplant |

### 2.3 🟠 Voiceover für Pro-Videos ausgefallen

Das ElevenLabs-Konto hat sein Kontingent aufgebraucht (36 Fehler heute, Fehlerhäufungs-Alarm). Auto-Reels ohne Stimme funktionieren weiter.
**Zu tun:** Credits im ElevenLabs-Konto aufladen oder den Tarif erhöhen.

### 2.4 🟡 Stripe-Webhooks doppelt angelegt

In Stripe gibt es drei Endpunkte. `/api/billing/webhook` und `/api/stripe/webhook` empfangen dieselben 14 bis 15 Ereignisse, dazu kommt ein Connect-Endpunkt.
Die Verarbeitung ist idempotent, deshalb wird nichts doppelt gebucht. Trotzdem verdoppelt das die Last und die Fehlermeldungen.
**Zu tun:** einen der beiden Plattform-Endpunkte in Stripe deaktivieren. Den Connect-Endpunkt behalten.

**Hinweis zum Stripe-Alarm:** Der Alarm „Stripe-Webhook schlägt fehl“ (zuletzt 13:18 UTC) kam von Anfragen mit ungültiger Signatur, nicht von Stripe selbst. Stripe meldet null fehlgeschlagene Zustellungen. Auch diese Prüfung hat zwei solche Testanfragen ohne Signatur geschickt (≈ 18:40 UTC). Ein dadurch ausgelöster Alarm erlischt mit dem nächsten echten Stripe-Ereignis.

### 2.5 🟡 Anmeldung: nur E-Mail

Google-Login (und andere Anbieter) sind in Netlify Identity ausgeschaltet. Alle großen Konkurrenz-Apps bieten Login mit Google oder Apple an.
Für Marketing-Traffic auf dem Handy senkt das die Hürde spürbar. Für die iOS-App verlangt Apple bei Social-Login zusätzlich „Mit Apple anmelden“.

---

## 3. Was einwandfrei funktioniert (geprüft)

### 3.1 Zahlung
- Stripe läuft im **Live-Modus**. Zahlungen und Auszahlungen sind auf dem Konto freigeschaltet (DE).
- Webhooks werden mit dem **Original-Request-Body und Signaturprüfung** verifiziert. Gefälschte Aufrufe werden mit 400 abgelehnt (live getestet).
- Stripe meldet **0 fehlgeschlagene Webhook-Zustellungen** und keine offenen Zustellungen in den letzten 100 Ereignissen.
- Der Checkout wird **genau einmal** gebucht (eindeutiger Zahlungseintrag), auch wenn Webhook und Bestätigung im Browser gleichzeitig ankommen.
- Das **Kundenportal** öffnet sich (live getestet). Auf der **Kündigungsseite nach § 312k BGB** antworten sowohl die Seite als auch die Bestätigung.
- Erstattungen und Rückbuchungen aus dem Stripe-Dashboard setzen Treuhand-Bestellungen automatisch auf „geschlossen“ bzw. „pausiert“.
- Der Treuhand-Job läuft alle 15 Minuten ohne Fehler (95 Läufe in 24 h).

### 3.2 Anmeldung & Zugriffsschutz
- Netlify Identity mit E-Mail und Bestätigungsmail. Admins werden über `ADMIN_EMAILS` erkannt.
- **Live-Prüfung aller 268 API-Routen:** 151 schreibende Routen blockieren fremde Herkunft (CSRF-Schutz, 403), 62 verlangen eine Anmeldung (401). Die 33 frei erreichbaren Routen liefern nur öffentliche Daten (Katalog, Deals, Restock, Rechtliches, Gesundheit).
- Sicherheits-Header gesetzt: CSP, HSTS, X-Frame-Options und weitere.

### 3.3 Datenbank & Daten
| Bestand | Anzahl |
|---|---|
| Deutsche Karten | 20.532 |
| EN/JA-Drucke | 34.586 |
| Karten mit Marktpreis (swipebar) | 13.707 DE · 8.047 EN · 3.707 JA |
| Preis-Bewertungen | ≈ 29.500 |
| Scan-Fingerabdrücke | 38.845 (99,9 % der Bilder indexiert) |
| Preisverlauf-Einträge | 14.770 |

Die Preise sind aktuell: Die letzte Kartenaktualisierung war um 18:30 UTC, die letzte Bewertung um 18:01 UTC, und der Preisdienst meldet „nicht beeinträchtigt“.

### 3.4 Hintergrund-Jobs (letzte 24 h)
| Job | Läufe | Fehler |
|---|---|---|
| Restock-Radar (alle 2 Min.) | 715 | 0 |
| Flip-Radar-Sync (eBay) | 166 | 0 |
| Katalog-Import DE / EN-JA | 141 / 142 | 0 (je ≈ 20 Teil-Läufe bei TCGdex-503) |
| Scan-Index | 143 | 0 |
| Betriebs-Wächter | 142 | 0 |
| Treuhand | 95 | 0 |
| Preis-Tracker | 51 | 0 |
| Wachstums-Jobs / Sealed-Preise | 24 / 12 | 0 |

Alle Circuit-Breaker (TCGdex, TCGdex-Bilder, eBay, EZB-Kurse) sind geschlossen, die Dienste also erreichbar.

### 3.5 Firebase (Realtime Database)
- Firebase wird nur für den Besucherzähler und den Online-Status genutzt, nicht für Karten, Chat oder Zahlungen.
- Die Regeln sind dicht. Ohne Anmeldung sind die Wurzel, der Chat und alle anderen Zweige gesperrt (401). **Schreiben ohne Login ist ebenfalls gesperrt** (live getestet). Den Zähler kann man nur um +1 erhöhen, den Online-Status nur für sich selbst setzen.

### 3.6 Weitere Dienste
- **Resend:** Absender-Domain verifiziert.
- **eBay:** Der Flip-Radar liefert Live-Deals. Der Löschendpunkt prüft die eBay-Signatur.
- **KI-Scanner:** Die genutzten Modelle (Claude Haiku 5.5, Claude Sonnet 5.5, Gemini 3.5 Flash) sind verfügbar. Die KI wird nur bei unsicheren Scans gefragt.
- **Amazon-Partner-Tag:** gesetzt.

---

## 4. Funktionsumfang (alle Erweiterungen)

| Bereich | Funktionen |
|---|---|
| **Entdecken** | Swipe-Radar über den mehrsprachigen Live-Katalog (DE/EN/JA), „Nur Deals“ (nur echte, verifizierte Angebote ≥ 15 % unter Markt), Kartensuche mit Tippfehler-Toleranz, Community-Feed und Pull-Wall, Swipe-Arena, Abzeichen, Serien, Release-Kalender |
| **Scanner & Sammlung** | Kamera-Scanner auf dem Gerät mit KI-Rückfall, Serien-Scan, Zustand und Varianten, Graded-Slabs, 1-Tap-Inserat mit fairem Preis, Portfolio mit Live-Wert und Verlauf, Master-Set-Tracker, Duplikat-Radar, CSV-Import aus anderen Apps (Wechsel-Bonus) und Export |
| **Marktplatz** | Sofortkauf mit Warenkorb und Reservierung, Treuhand über Stripe Connect, DHL-Etikett mit automatischem „versendet“, Auszahlung ab Zustellung, Tausch-Hub mit Matching und Chat, Bewertungen und Trust-Score, Händler-Shops mit eigener Seite, Verkäufer-Import |
| **Radar** | Restock-Radar mit Push und UVP-Ampel, Netto-Flip-Radar (Gewinn nach Gebühren und Porto je Kanal), Preisalarme, Sealed-Analyse, Deals-Radar |
| **Pro / Premium** | Abos über Stripe mit 7 Tagen gratis, Sniper-Deals, sofortige Restock-Pushs, 3 % Provision, mehr Scans und Alarme, Promo-Codes, gestufte Empfehlungsprämien |
| **Recht & Vertrauen** | Impressum, AGB, Widerruf, Datenschutz, Kündigungsbutton, DSGVO-Export und -Löschung, DAC7-Meldung mit verschlüsselten Steuerdaten, Moderation |
| **Betrieb** | Betriebs-Wächter mit Job-Protokoll, Circuit-Breakern, Fehlerprotokoll und Admin-Alarmen. Admin-Zentrale mit PDF-Bericht, Integrationsstatus, Auto-Reels und Pro-Videos |
| **SEO & Wachstum** | Öffentliche Karten-, Set-, Pokémon-, Sealed- und Trendseiten, englische Seiten, Sitemaps, Teilen-Kurzlinks mit Vorschaubild, öffentliche Sammlerprofile |

---

## 5. Direkter Vergleich mit den Top-Apps

Legende: ✅ vorhanden · 🟡 eingeschränkt · ❌ nicht vorhanden

| Merkmal | **PokeSwipe Radar** | Collectr | TCGplayer | Cardmarket | Dragon Shield Card Manager |
|---|---|---|---|---|---|
| Markt / Fokus | 🇩🇪 Pokémon, DACH | weltweit, Schwerpunkt USA | USA | Europa, Marktführer | weltweit, Sammlung |
| Kamera-Scanner | ✅ auf dem Gerät + KI | ✅ | ✅ | 🟡 | ✅ |
| Portfolio mit Live-Wert | ✅ | ✅ Kernfunktion | 🟡 | 🟡 | ✅ |
| EUR-Preise, DE/EN/JA-Drucke | ✅ | 🟡 vorwiegend USD | ❌ USD | ✅ | 🟡 |
| Echte Deals statt Schein-Rabatte | ✅ nur verifizierte Live-Angebote | ❌ | ❌ | ❌ | ❌ |
| Restock-Radar mit Push | ✅ | ❌ | ❌ | ❌ | ❌ |
| Netto-Flip-Radar | ✅ | ❌ | ❌ | ❌ | ❌ |
| P2P-Tausch mit Matching | ✅ | ❌ | ❌ | ❌ | ❌ |
| Kauf mit Treuhand | ✅ Auszahlung ab Zustellung | 🟡 | ✅ | ✅ | ❌ |
| Versandetikett aus der Bestellung | ✅ DHL | ❌ | ✅ US | 🟡 | ❌ |
| Gamification (Swipe, Arena, Abzeichen) | ✅ | 🟡 | ❌ | ❌ | ❌ |
| Deutsches Recht, DSGVO, DAC7 | ✅ | ❌ | ❌ | ✅ | 🟡 |
| Verkaufsgebühr | 6,5 % / **3 % Pro** | – | ≈ 10–13 % + Zahlung | ≈ 5 % | – |
| Login mit Google/Apple | ❌ (nur E-Mail) | ✅ | ✅ | 🟡 | ✅ |
| Native App im Store | 🟡 vorbereitet | ✅ | ✅ | ✅ | ✅ |
| Mehrere Sammelkartenspiele | ❌ nur Pokémon | ✅ | ✅ | ✅ | ✅ |
| Angebotsmenge im Marktplatz | 🔴 noch leer | – | ✅ sehr groß | ✅ sehr groß | – |

### Stärken gegenüber der Konkurrenz
1. **Alles in einer App:** Scanner, Sammlung, Restock, Flip, Tausch und Kauf. Kein Konkurrent verbindet das.
2. **Ehrliche Preise:** Rabatte erscheinen nur bei verifizierten, günstigeren Live-Angeboten. Das ist ein echtes Vertrauensmerkmal.
3. **Restock- und Netto-Flip-Radar** gibt es bei keiner der großen Apps.
4. **Strenge Treuhand** mit Auszahlung erst ab Zustellung und **verschlüsselte Steuerdaten**.
5. **Deutschsprachig und rechtssicher** für den DACH-Markt, mit niedriger Pro-Provision (3 %).

### Schwächen gegenüber der Konkurrenz
1. **Liquidität:** Der Marktplatz hat noch keine Angebote. Cardmarket und TCGplayer haben Millionen davon. Das ist der größte Hebel.
2. **Store-Präsenz:** Die native App ist noch nicht in den Stores. Dafür fehlen In-App-Kauf und nativer Push.
3. **Login-Komfort:** Es gibt nur E-Mail-Login.
4. **Ein einziges Spiel:** Die Konzentration auf Pokémon ist Stärke und Begrenzung zugleich.

**Fazit:** Technisch und funktional ist PokeSwipe Radar für deutschsprachige Pokémon-Sammler die vollständigste Lösung am Markt, und der Betrieb läuft stabil.
Offen sind keine Technikfehler mehr, sondern Betrieb und Wachstum: Abo-Abgleich vor dem 22.11., Schlüssel setzen, Store-Start und das Füllen des Marktplatzes.

---

## 6. Abschluss-Checkliste

- [ ] **Bis 22.11.:** überzählige Pro-Testabos in Stripe kündigen (Kapitel 2.1)
- [ ] `DATA_ENCRYPTION_KEY` setzen, neu deployen, in der Admin-Zentrale „🔐 Alt-Einträge verschlüsseln“ ausführen
- [ ] `DHL_TRACKING_API_KEY` setzen, bevor die ersten Marktplatz-Bestellungen kommen
- [ ] ElevenLabs-Credits aufladen
- [ ] Doppelten Stripe-Webhook-Endpunkt deaktivieren
- [ ] Google-Login in Netlify Identity aktivieren (Project configuration → Identity → External providers)
- [ ] Für den Store-Start: RevenueCat- und FCM-Schlüssel hinterlegen
- [ ] Cardmarket-Partner-ID nachtragen
- [ ] Externen Uptime-Monitor auf `/api/health` einrichten
- [ ] CI-Workflow aus `docs/github-workflow-ci.yml` auf GitHub aktivieren

## 7. Prüfprotokoll

| Prüfung | Ergebnis |
|---|---|
| `npm test` | 249 / 249 grün |
| TypeScript (`npm run typecheck`) | fehlerfrei |
| Live-Seiten (16 Pfade) | alle erreichbar. `/impressum` und `/agb` leiten weiter (301), unbekannte Karten liefern korrekt 404 |
| Live-API (268 Routen ohne Login) | 0 ungeschützte Schreib- oder Privat-Endpunkte |
| Stripe-API | Live-Modus, Webhooks aktiv, 0 Zustellfehler, Kundenportal OK |
| Firebase-Regeln (live) | Lesen und Schreiben ohne Login gesperrt |
| Datenbank, Job-Protokoll, Fehlerprotokoll | wie in Kapitel 3 |
| Resend, AI Gateway, Web-Push | OK |
| Nicht prüfbar | echte DHL-Tracking-Antworten, Kamera-Scanner auf dem Gerät, native Apps |
