# PokeSwipe Radar – Komplettanalyse & Wettbewerbsvergleich

**Stand:** 17.11.2026, nach dem Security-/DAC7-Upgrade und dem Mobile-First-Umbau
**Gilt für:** pokeswipe-radar.de (Web-App/PWA, native Hülle über Capacitor)
**Ersetzt:** alle früheren Analyseberichte. Der interne PDF-Bericht in der Admin-Zentrale bleibt davon unberührt.

> Hinweis: Das Repository ist öffentlich. Dieser Bericht enthält deshalb keine Umsätze, Nutzerzahlen, Schlüssel oder
> persönlichen Daten. Die Angaben zu Collectr, TCGplayer und Cardmarket beruhen auf öffentlich bekannten
> Produktmerkmalen (Wissensstand 2026). Preise und Funktionen der Konkurrenz ändern sich laufend. Vor einer
> Veröffentlichung, etwa in Marketing-Material, bitte gegenprüfen.

---

## 1. Kurzfazit

PokeSwipe Radar ist die einzige der vier verglichenen Lösungen, die **Scanner, Sammlung, Live-Preise, Restock-Radar,
Netto-Flip-Radar, P2P-Tausch und Direktkauf mit Treuhand** in einer deutschsprachigen Smartphone-App verbindet.
Die heutigen Änderungen härten vor allem die Punkte, die vor einer Marketingwelle rechtlich und vom Vertrauen her
kritisch sind:

| Bereich | Vorher | Jetzt |
|---|---|---|
| Steuerdaten der Verkäufer (DAC7) | Klartext in der Datenbank, im Export teilweise maskiert | **AES-256-GCM-verschlüsselt**, überall maskiert. Klartext gibt es nur im protokollierten BZSt-Export und für den Verkäufer selbst |
| DAC7-Schwelle | `≥ 2.000 €` | **`> 2.000 €`** oder `≥ 30` Verkäufe (§ 4 Abs. 5 PStTG) |
| Treuhand-Auszahlung | 14 Tage nach *Eintragen* der Sendungsnummer | **erst ab DHL-Zustellung** (+ 3 Tage Prüffrist); ohne Versandnachweis keine automatische Auszahlung |
| DHL-Etikett | Verkäufer musste danach manuell „versendet“ melden | **automatisch „versendet“** mit Sendungsnummer, Zeitstempel und Mitteilung an den Käufer |
| Flip-Radar | Brutto-Ersparnis (Marktpreis − Einkauf) | **Netto-Gewinn, Netto-Marge und ROI** nach Verkaufsgebühren und Porto, wählbar je Verkaufskanal |
| Persönliche Daten im Code | Impressums-Fallback mit Name, Anschrift, Telefon und E-Mail im Client | **entfernt**. Die Angaben kommen nur aus der Admin-Zentrale bzw. aus `OPERATOR_*`-Variablen |
| eBay-Löschendpunkt | bestätigte jede POST-Anfrage | **ECDSA-Signaturprüfung** von `X-EBAY-SIGNATURE`, Fälschungen → 401/412 |
| CI | keine automatische Prüfung | **CI-Workflow fertig** (TypeScript, Tests, Build). Muss einmalig auf GitHub aktiviert werden, siehe Kapitel 5 |
| Navigation | 5 Reiter, davon Sammlung und Scanner getrennt, Profil nur als Dialog, voller Header | **5 klare Bereiche** (Entdecken · Scanner · Marktplatz · Radar · Profil), Bottom-Navigation mit Safe-Area, Seitenköpfe mit Zurück |

---

## 2. Funktions- & Systemanalyse je Modul

Jedes Modul folgt demselben Aufbau: **(A)** was es dem Nutzer bringt, **(B)** wie es technisch funktioniert,
**(C)** was heute ergänzt oder gehärtet wurde.

### 2.1 Karten-Katalog, Scanner & Portfolio („Scanner“ → Scanner | Meine Sammlung)

**(A) Nutzen**
- Karte vor die Kamera halten. Name, Nummer, Sprache (DE/EN/JA) und Marktpreis erscheinen in unter einer Sekunde.
- Danach direkt **„🏷️ Verkaufen“** oder **„⚡ 1-Tap live“**: Der faire Preis ist vorausgefüllt und lässt sich an derselben Stelle ändern. Serien-Scan mit „Alle inserieren“ ist ebenfalls möglich.
- Die Sammlung zeigt Live-Gesamtwert, Gewinn/Verlust, Wertverlauf, Top-Mover, Binder/Sets (Master-Set-Tracker), Graded-Slabs, Duplikat-Radar und CSV-Import/-Export.

**(B) Technik**
- Katalog: deutsche Sets und Karten aus TCGdex (Import alle 10 Minuten), EN/JA-Drucke als eigene Einträge (`card_prints`), Preis-Feeds Cardmarket (EUR) und TCGplayer (USD → EUR über EZB-Kurse).
- Live-Scanner auf dem Gerät: Perceptual-Hash-Index im Web-Worker (`client/scanner/scan-worker.js`), lernende Scans. Die KI (Netlify AI Gateway) wird nur bei Unsicherheit gefragt.
- Schnell-Inserieren: Preisvorschläge über eine Batch-Route für bis zu 60 Karten. Grundlage sind Cardmarket-Referenz, echte eBay- und PokeSwipe-Verkäufe, Zustand/Variante und Konkurrenz-Inserate.

**(C) Heute**
- Scanner und Sammlung bilden jetzt **einen Hauptbereich** mit Umschalter „📷 Scanner | 💼 Meine Sammlung“, eigener Überschrift und Zurück-Knopf. Vorher waren es zwei getrennte Reiter.
- Das Pro-Video-Szenario für die Sammlung wurde an die neue Navigation angepasst.

### 2.2 Live-Preisvergleich & Netto-Flip-Radar („Radar“ → Netto-Flip-Radar)

**(A) Nutzen**
- eBay-Sofortkäufe und bald endende Auktionen deutlich unter dem Marktpreis, Sniper-Deals ab 25 % für Abonnenten.
- **Neu:** Jeder Deal zeigt den **echten Netto-Gewinn** nach Verkaufsgebühren und Porto, dazu **Netto-Marge** und **ROI**. Eine aufklappbare Rechnung zeigt jeden Posten. Wer über eBay statt Cardmarket weiterverkauft, sieht den Gewinn sofort für diesen Kanal.

**(B) Technik**
- `server/flip-logic.ts → netFlip()` / `netFlipAll()`:
  `Netto = Verkaufspreis − Verkaufsgebühr − Porto − Einkauf (− Einkaufsporto bei Cardmarket-„ab“-Preisen)`
- Verkaufskanäle (öffentliche Standardgebühren, bewusst konservativ):

  | Kanal | Gebühr |
  |---|---|
  | Cardmarket | 5 % |
  | eBay (gewerblich) | ≈ 11 % + 0,35 € |
  | PokeSwipe-Marktplatz | 6,5 % (Pro-Pass 3 %), mind. 0,49 € |

- Porto-Richtwerte inklusive Versandmaterial:

  | Sendung | Porto |
  |---|---|
  | Einzelkarte unter 25 € (Standardbrief) | 1,35 € |
  | Einzelkarte 25–99 € (mit Nachverfolgung) | 3,70 € |
  | ab 100 €, Slabs, Sealed (versichertes Paket) | 6,99 € |

- Die API liefert die Rechnung für alle Kanäle (`net`) und `netProfit` (Cardmarket). Neu sind die Sortierung `sort=net` und der Filter `netOnly=1`. Beides wird in SQL mit derselben Formel berechnet.

**(C) Heute**
- Netto-Formel mit 8 Testfällen, darunter ein „Brutto-Deal, der netto Verlust macht“.
- Neue Filter: Kanal-Auswahl, „💶 Größter Netto-Gewinn“ und „Nur Deals mit echtem Netto-Gewinn“. Die übrigen Filter liegen jetzt in einem einklappbaren Bereich, damit die Ansicht auf dem Handy ruhiger ist.
- Der **bestehende Cardmarket-Preisabruf ist unverändert**. Die Cardmarket-Partner-ID wird bewusst erst später gesetzt.

### 2.3 Restock-Radar („Radar“ → Restock-Radar)

**(A) Nutzen**
- Displays, ETBs und Kollektionen zur UVP: Push für Premium/Pro sofort, für Free 15 Minuten später. Dazu Vorbestell-Preisvergleich, UVP-Ampel und Community-Meldungen mit zwei Bestätigungen.

**(B) Technik**
- `netlify/functions/restock-radar.mts` prüft beobachtete Shop-Seiten alle 2 Minuten (schema.org-Verfügbarkeit). Health-Stufen (ok/degraded/paused) mit Backoff, Amazon-Partner-Tag und Klickzählung.

**(C) Heute**
- Restock-Radar ist jetzt der **erste Unter-Reiter** im Bereich „Radar“, gefolgt von Netto-Flip-Radar, Preisalarmen und Sealed-Analyse.
- Schnellzugriff auf der Startseite: Kachel „🚨 Restock-Radar“.

### 2.4 Marktplatz, Tausch, Stripe Connect, DHL-Treuhand & DAC7 („Marktplatz“ und „Profil“)

**(A) Nutzen**
- **Marktplatz:** Sofort-Kauf mit Käuferschutz. Das Geld liegt in der Treuhand, Versand mit DHL-Etikett direkt aus der Bestellung.
- **Tausch-Hub:** alle Inserate mit Preis-Check, Tauschanfragen, Chat und Bewertungen.
- **Meine Verkäufe:** Bestellungen, Tausche, Verkäuferkonto, Warenkorb, Händler-Bereich und eigene Inserate an einem Ort.
- Verkäufer-Onboarding mit Stripe Connect Express. Der DAC7-Status ist im Profil auf einen Blick sichtbar.

**(B) Technik**
- Stripe „separate charges and transfers“: Zahlung auf das Plattform-Konto, Auszahlung per Transfer abzüglich Provision.
- **Treuhand-Härtung** (`server/escrow-tracking-logic.ts`, `server/tracking.ts`):
  1. **DHL-Etikett erzeugt → Status „versendet“** mit Sendungsnummer und Zeitstempel (`label_shipped_at`). Der Käufer bekommt eine Mitteilung.
  2. Das Etikett lässt sich stornieren oder ersetzen, solange DHL noch nichts gescannt hat. Die Bestellung geht dann zurück auf „bezahlt“.
  3. Der Treuhand-Job (alle 15 Minuten) fragt die **DHL Shipment Tracking – Unified API** ab: anfangs stündlich, nach 6 Prüfungen alle 3 Stunden, nach 20 Prüfungen alle 6 Stunden.
  4. **Zustell-Scan → Auszahlung 3 Tage später**, falls der Käufer nicht reklamiert. Bestätigt er den Erhalt, wird sofort ausgezahlt.
  5. **Sicherer Fallback:** Kommt kein Zustell-Scan, aber ein Transport-Scan liegt vor, wird frühestens 21 Tage nach Versand ausgezahlt. **Ohne jeden Carrier-Scan gibt es keine automatische Auszahlung.** Die Admins werden einmalig benachrichtigt, der Verkäufer erfährt warum.
  6. Andere Paketdienste, Sandbox-Etiketten oder DHL ohne Tracking-Schlüssel behalten die bisherige Regel (14 Tage nach Versand).
- **DAC7-Verschlüsselung** (`server/vault.ts`, `server/vault-logic.ts`):
  - Format `enc:v1:<kid>:<iv>:<tag>:<daten>`. AES-256-GCM mit zufälligem IV pro Wert und Bindung an den Feldnamen (AAD). Eine verschlüsselte IBAN lässt sich deshalb nicht als Steuer-ID ausgeben.
  - Der Hauptschlüssel kommt aus `DATA_ENCRYPTION_KEY` (64 Hex-Zeichen, Base64 oder Passphrase ab 32 Zeichen).
  - **Fallback:** Fehlt der Schlüssel, wird mit einem zufälligen Notfall-Schlüssel aus Netlify Blobs verschlüsselt. Es wird also nie Klartext gespeichert.
  - **Alt-Einträge** (Klartext oder Notfall-Schlüssel) werden beim Lesen, im Treuhand-Job (25 je Lauf) oder per Admin-Knopf „🔐 Alt-Einträge verschlüsseln“ umgeschlüsselt.
  - Das Geburtsdatum liegt jetzt verschlüsselt in `birth_date_enc`. Die alte Datumsspalte wird beim Umschlüsseln geleert.
- **Maskierung** überall außer im BZSt-Export:

  | Feld | Anzeige |
  |---|---|
  | IBAN | `DE89 •••• •••• 3000` |
  | Steuer-ID | `•••• •••• 123` |
  | Geburtsdatum | `••.••.1990` |

  Das gilt für die Admin-Übersicht, „Alle Verkäufer“- und „Meldepflichtige (maskiert)“-CSV, den DSGVO-Datenexport und das Steuerdaten-Formular. Im Formular bedeutet ein leeres Feld „gespeicherten Wert behalten“, und „👁️ Anzeigen“ lädt den Klartext nur für den Verkäufer selbst.
- **Klartext** gibt es nur über `export.csv?purpose=bzst`: mit Bestätigungsdialog, nur für meldepflichtige Verkäufer und protokolliert als `dac7_export_bzst`.
- **Schwelle** (`server/dac7-logic.ts`): meldepflichtig bei `transactions ≥ 30 || netto > 200 000 Cent`. Eine Migration korrigiert gespeicherte `reporting_required`-Markierungen, die Hinweistexte sprechen von „mehr als 2.000 €“.

**(C) Heute**
- Alle oben genannten Härtungen sowie die neuen Statuszeilen im Bestell-Dialog („🛰️ DHL-Status: Unterwegs / Zugestellt am …“, „Auszahlung erst nach Zustellung“, „Auszahlung in Prüfung“).
- AGB § 8a Abs. 3 wurde an die Freigabe ab Zustellung angepasst. Die **AGB-Version ist jetzt 2026-11-17** und wird mit neuen Bestellungen gespeichert.
- Die Admin-Zentrale zeigt unter „Integrationen“, ob `DATA_ENCRYPTION_KEY`, die DHL-Sendungsverfolgung und die eBay-Signaturprüfung aktiv sind.

### 2.5 PokeSwipe Pro & Pro-Video-Pipeline

**(A) Nutzen**
- Premium und Pro Trader (Monat/Jahr, 7 Tage gratis testen): Sniper-Deals, sofortige Restock-Pushs, niedrigere Provision (Pro 3 %), Händler-Shop, mehr Scans und Alarme.
- Admins erzeugen Auto-Reels und Pro-Videos direkt aus der echten App (9:16-Live-Stage, Voiceover, MP4).

**(B) Technik**
- Stripe Checkout bzw. In-App-Kauf (RevenueCat in der iOS-Hülle), Kündigungsbutton nach § 312k BGB.
- Die Reel-Pipeline (`client/reel-*.js`, `client/live-stage.js`) steuert die App per Szenario, nimmt sie per DOM-Capture auf und baut daraus ein MP4.

**(C) Heute**
- Der Pro-Pass hat im Profil einen eigenen Block mit Tarif, Vorteilen, Rechnungsportal und Kündigungslink.
- Das Reel-Szenario „Sammlung“ tippt jetzt über Scanner → „Meine Sammlung“. Die Pipeline funktioniert also weiter mit der neuen Navigation.

### 2.6 Betriebs-Wächter & Mobile-First-UI

**(A) Nutzen**
- Die App wirkt auf dem Handy wie eine native App. Eine feste untere Leiste führt in fünf Bereiche, jede Seite hat eine klare Überschrift und einen Zurück-Knopf. Der Header ist aufgeräumt: Logo, Suche, Push, Sprache.
- Die Zurück-Taste von Browser oder Android wechselt zwischen den Bereichen, statt die App zu verlassen.

**(B) Technik**
- `client/app-nav.js`: Seitenköpfe, Segment-Umschalter, Marktplatz-Tabs (Marktplatz | Tausch-Hub | Meine Verkäufe), Profil-Bereich mit Accordions, History-State und `aria-current`.
- Bottom-Navigation `#ps-bottom-nav` mit `env(safe-area-inset-bottom)` sowie links und rechts mit Safe-Area. Tippflächen sind mindestens 48 px hoch. `overflow-x: hidden` auf `html` und `body`.
- Hero, Schnellzugriff-Kacheln und Quickstart erscheinen nur auf „Entdecken“. Die anderen Bereiche beginnen direkt mit ihrem Inhalt.
- Betriebs-Wächter (`ops-watchdog`): Job-Läufe, Circuit-Breaker, Fehlerprotokoll, Admin-Alarme. `/api/health` liefert `{ ok: true }`.

**(C) Heute**
- **Neue Struktur der Hauptbereiche:**

  | Bereich | Inhalt |
  |---|---|
  | Entdecken | Swipe, Deals, Kartensuche, Community; Kacheln Scanner, Restock-Radar, Marktplatz, Sammlung |
  | Scanner | Scanner und Sammlung |
  | Marktplatz | 3 Tabs |
  | Radar | Restock-Radar, Netto-Flip-Radar, Preisalarme, Sealed-Analyse |
  | Profil | Konto, Pro-Pass, Verkaufen (Stripe & DAC7), App-Einstellungen, Admin-Zentrale (nur Admins), Rechtliches |

- **Aufgeräumt:** Der doppelte „📲 App“-Knopf im Header ist entfernt (Installieren geht über die Pokédex-Linse und das Profil). Der überflüssige Umschalter „Markt & Tausch | Community“ und die zugehörige, nicht mehr genutzte Funktion sind ebenfalls weg. Konto, PRO und Einsteiger/Profi-Umschalter sind auf dem Handy in den Bereich Profil umgezogen. Auf dem Desktop bleiben sie im Header.
- Keine fachliche Funktion wurde entfernt.

---

## 3. Vergleich mit den Top-3-TCG-Apps

### 3.1 Vergleichstabelle

Legende: ✅ vorhanden · 🟡 eingeschränkt oder nur teilweise · ❌ nicht vorhanden

| Merkmal | **PokeSwipe Radar** | Collectr | TCGplayer | Cardmarket |
|---|---|---|---|---|
| Fokus / Markt | 🇩🇪 Pokémon, DACH | weltweit, Schwerpunkt USA | USA | Europa (EU-Marktführer) |
| Kamera-Scanner | ✅ auf dem Gerät + KI-Fallback | ✅ | ✅ | 🟡 |
| Portfolio mit Live-Wert & Verlauf | ✅ | ✅ (Kernfunktion) | 🟡 | 🟡 (Sammlungsliste) |
| Preise in EUR, DE/EN/JA-Drucke | ✅ Cardmarket + TCGplayer (umgerechnet) | 🟡 vorwiegend USD | ❌ USD | ✅ EUR |
| Scan → Inserat in 1–2 Taps | ✅ mit fairem Preisvorschlag | 🟡 | 🟡 (Seller-Tools) | 🟡 (Seller-Tools) |
| Restock-/UVP-Radar mit Push | ✅ | ❌ | ❌ | ❌ |
| Flip-Radar (eBay unter Marktwert) | ✅ **netto** nach Gebühren & Porto | ❌ | ❌ | ❌ |
| P2P-Tausch mit Matching | ✅ | ❌ | ❌ | ❌ |
| Direktkauf mit Treuhand | ✅ Stripe Connect, **Auszahlung erst ab DHL-Zustellung** | 🟡 | ✅ TCGplayer-Käuferschutz | ✅ Treuhand-System |
| Versandetikett aus der Bestellung | ✅ DHL, **setzt automatisch „versendet“** | ❌ | ✅ (US-Porto) | 🟡 |
| Swipe-Erlebnis / Gamification | ✅ Swipe-Arena, Abzeichen, Serie | 🟡 | ❌ | ❌ |
| Community / Pull-Wall / Chat | ✅ moderiert, Trust-Score | 🟡 | 🟡 | 🟡 (Foren) |
| DAC7-Meldung mit Verschlüsselung | ✅ AES-256-GCM, maskierte Exporte | – (kein EU-Marktplatz) | – | ✅ (gesetzliche Pflicht) |
| Deutsch, deutsches Recht (Impressum, Widerruf, § 312k) | ✅ | ❌ | ❌ | ✅ |
| Verkaufsgebühr | 6,5 % / 5 % / **3 % (Pro)** | – | ≈ 10–13 % + Zahlungsgebühr | ≈ 5 % |

### 3.2 Ehrliche Bewertung

**Wo PokeSwipe heute klar vorn liegt**
1. **Netto-Flip-Formel:** Keine der drei Apps rechnet aus, was nach Gebühren und Porto wirklich bleibt. Das ist ein klares Verkaufsargument für Flipper und Händler.
2. **Gehärtete DHL-Treuhand:** Ausgezahlt wird erst ab bestätigter Zustellung, ohne Versandnachweis gar nicht automatisch. Das ist strenger als viele P2P-Lösungen und schützt Käufer vor „Etikett erstellt, nie verschickt“.
3. **DSGVO-Steuerdaten-Verschlüsselung:** Feldverschlüsselung mit getrenntem Schlüssel, maskierte Exporte und ein protokollierter Klartext-Export. Das ist ein Vertrauenssignal gegenüber Verkäufern und für Prüfungen.
4. **Alles in einer App:** Scanner, Sammlung, Restock, Flip, Tausch und Kauf. Collectr ist stark beim Portfolio, TCGplayer und Cardmarket sind stark als Marktplätze. Keiner verbindet alles.
5. **Mobile-First-Navigation:** 5 klare Bereiche statt überladener Seiten. Das Gefühl einer nativen App senkt die Einstiegshürde für Marketing-Traffic.

**Wo die Konkurrenz stärker ist**
1. **Angebotsmenge und Liquidität:** Cardmarket (EU) und TCGplayer (US) haben ein Vielfaches an Verkäufern und Angeboten. Ein neuer Marktplatz muss das erst über Tausch, Restock-Traffic und günstige Gebühren aufbauen.
2. **Preisdatenbasis:** Cardmarket hat die eigenen Verkaufsdaten, TCGplayer den US-Markt. PokeSwipe nutzt deren Referenzpreise plus eigene Verkäufe. Die Cardmarket-Partner-ID fehlt noch (wird nachgetragen).
3. **Markenbekanntheit und App-Store-Präsenz:** Collectr hat eine große, aktive Sammler-Community. Die native PokeSwipe-App ist vorbereitet (Capacitor), aber noch nicht in den Stores etabliert.
4. **Mehrere TCGs:** Die Konkurrenz deckt viele Spiele ab, PokeSwipe konzentriert sich auf Pokémon. Das ist Stärke und Begrenzung zugleich.

**Gesamturteil:** Für deutschsprachige Pokémon-Sammler und Flipper ist PokeSwipe Radar funktional die vollständigste
Lösung. Die heutigen Upgrades schließen die wichtigsten Vertrauens- und Rechtslücken vor einer Marketingwelle. Der
größte offene Hebel ist nicht mehr die Technik, sondern Reichweite und Angebotsmenge im Marktplatz.

---

## 4. Technische Änderungs- & Setup-Checkliste

### 4.1 Geänderte und neue Dateien

**Neu**

| Datei | Zweck |
|---|---|
| `server/vault-logic.ts`, `server/vault.ts` | Feldverschlüsselung, Schlüsselverwaltung, Maskierung |
| `server/escrow-tracking-logic.ts`, `server/tracking.ts` | Freigabe ab Zustellung, DHL-Tracking, automatischer Versandstatus |
| `server/ebay-signature-logic.ts` | ECDSA-Signaturprüfung |
| `netlify/functions/ebay-account-deletion.mts` | ersetzt `.js`, jetzt mit Signaturprüfung, gleiche URL |
| `client/app-nav.js` | Mobile-First-Navigation, Marktplatz-Tabs, Profil-Bereich |
| `netlify/database/migrations/20261117154058_harden_escrow_tracking_encrypt_tax/` | Tracking-Spalten, `birth_date_enc`, Korrektur der DAC7-Markierung |
| `docs/github-workflow-ci.yml` | CI-Vorlage |
| `tests/security-upgrade.test.ts` | Tests für Verschlüsselung, Maskierung, Treuhand, Netto-Flip, eBay-Signatur, DAC7 |
| `docs/KOMPLETTANALYSE-UND-WETTBEWERBSVERGLEICH.md` | dieser Bericht |

**Geändert (Server)**

| Datei | Änderung |
|---|---|
| `server/dac7.ts`, `server/dac7-logic.ts` | Verschlüsselung, Maskierung, BZSt-Export, Schwelle `>` |
| `server/market.ts`, `server/shipping.ts`, `server/cart.ts` | Treuhand/DHL, Texte |
| `server/flip.ts`, `server/flip-logic.ts` | Netto-Flip |
| `server/legal.ts` | `OPERATOR_*`-Fallback, Verantwortlicher, AGB 2026-11-17 |
| `server/push.ts` | VAPID-Kontakt ohne hartcodierte E-Mail |
| `server/growth.ts` | maskierte Steuerdaten im DSGVO-Export |
| `server/integrations.ts` | Security-Status |
| `server/ebay.ts` | Anwendungs-Token |
| `db/schema.ts` | Schema-Erweiterungen |

**Geändert (Client und Projekt)**

| Datei | Änderung |
|---|---|
| `public/index.html`, `public/theme.css`, `public/js/legacy-app.js` | Header, Kacheln, Navigation, Profil-Bereich, CSS |
| `client/main.js`, `client/features.js`, `client/shell.js` | Navigation und Marktplatz-Filter |
| `client/market.js` | DHL-Status, Auto-Versand |
| `client/flip.js` | Netto-Anzeige, Filter |
| `client/compliance.js` | Steuerdaten-Formular, Admin-Export |
| `client/growth.js` | neutraler Impressums-Fallback, Security-Status |
| `client/reel-scenarios.js` | Pro-Video-Szenario |
| `client/i18n-en-1/3/4/6.js` | Texte und Übersetzungen |
| `tests/*` | Schwellen- und Flip-Filter-Tests angepasst, Anbieter-Fallback-Tests |
| `tests/e2e/app.spec.ts` | neue Navigation |
| `package.json` | Skript `typecheck` |
| `README.md` | Einrichtung |

### 4.2 Neue bzw. relevante Umgebungsvariablen (Netlify → Project configuration → Environment variables)

| Variable | Pflicht? | Zweck |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | **dringend empfohlen** | Hauptschlüssel für Steuer-ID, IBAN und Geburtsdatum (z. B. `openssl rand -hex 32`, als Secret markieren). **Danach nie ändern oder löschen.** |
| `DHL_TRACKING_API_KEY` | empfohlen | DHL „Shipment Tracking – Unified“. Ohne ihn gilt die alte 14-Tage-Regel. Fällt auf `DHL_API_KEY` zurück |
| `OPERATOR_NAME`, `OPERATOR_COMPANY`, `OPERATOR_STREET`, `OPERATOR_ZIP`, `OPERATOR_CITY`, `OPERATOR_COUNTRY`, `OPERATOR_EMAIL`, `OPERATOR_PHONE`, `OPERATOR_VAT_ID`, `OPERATOR_REGISTER`, `OPERATOR_RESPONSIBLE`, `OPERATOR_SMALL_BUSINESS` | optional | Anbieterangaben, falls die Admin-Zentrale leer ist (Admin-Einstellungen haben Vorrang) |
| `VAPID_SUBJECT` | optional | Kontakt für Web-Push (`mailto:…`), sonst `OPERATOR_EMAIL` bzw. die Website-Adresse |
| `EBAY_VERIFICATION_TOKEN`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | bestehend | werden jetzt auch für die Signaturprüfung des Löschendpunkts gebraucht |

### 4.3 Nach dem Deploy einmalig erledigen

1. `DATA_ENCRYPTION_KEY` setzen, neu deployen, dann in der Admin-Zentrale unter DAC7 „🔐 Alt-Einträge verschlüsseln“ ausführen.
2. Optional `DHL_TRACKING_API_KEY` setzen. Unter „Integrationen“ prüfen, ob „DHL-Sendungsverfolgung aktiv“ grün ist.
3. CI aktivieren: Inhalt von `docs/github-workflow-ci.yml` auf github.com als `.github/workflows/ci.yml` anlegen. Netlify darf keine Workflow-Dateien hochladen, GitHub verlangt dafür eine zusätzliche Berechtigung.
4. In der Deploy-Vorschau auf dem Handy durchklicken: alle 5 Bereiche, Zurück-Taste, Marktplatz-Tabs, Profil inkl. Steuerdaten-Dialog, Flip-Radar mit Netto-Anzeige, Etikett erstellen → Bestellung „versendet“.

### 4.4 Offene Erinnerungen für später

- [ ] **(1) Cardmarket-Partner-ID nachträglich hinterlegen** (`CARDMARKET_PARTNER_ID`). Der Preisabruf ist bewusst unverändert, die Admin-Zentrale zeigt den Status unter „Integrationen“.
- [ ] **(2) Externen Uptime-Monitor für `/api/health` einrichten**, z. B. mit Prüfintervall 1–5 Minuten und Alarm per E-Mail/Push. Der Endpunkt antwortet mit `200 {"ok":true}`.

### 4.5 Prüfstand dieses Laufs

| Prüfung | Ergebnis |
|---|---|
| `npm test` | 225 Tests, alle grün (davon 10 neu) |
| TypeScript (`tsc -p .`, neu auch `npm run typecheck`) | fehlerfrei |
| Produktions-Bundle (esbuild App + Scan-Worker, Tailwind) | baut fehlerfrei |
| eBay-Löschendpunkt lokal | ohne Signatur **401**, mit gefälschter Signatur **412** |
| `/api/health` lokal | `200` |

- Den eigentlichen Deploy-Build führt Netlify aus.
- Nicht lokal prüfbar: echte DHL-Tracking-Antworten, echte Datenbank-Abfragen (die lokale Datenbank ist nicht verfügbar) und die Oberfläche im Browser. Diese Punkte bitte in der Deploy-Vorschau testen.
