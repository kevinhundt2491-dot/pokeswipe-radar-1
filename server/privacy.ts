// PokeSwipe & Radar – Datenschutzerklärung (Art. 13/14 DSGVO, § 25 TDDDG) unter /datenschutz.
//
// Reine Funktionen ohne Datenbank- oder Blobs-Zugriff: Die Angaben zum Verantwortlichen stammen aus den Anbieterdaten,
// die der Admin für das Impressum pflegt (server/legal.ts → getOperator) und werden hier nur übergeben.
// Alle Texte werden beim Rendern mit h() escaped.
import { h } from "./growth.ts";
import type { Operator } from "./legal.ts";

export const PRIVACY_VERSION = "2026-11-15";
export const PRIVACY_STAND = "Stand: 15. November 2026";

export type PrivacySection = { id: string; h: string; p: string[]; links?: { href: string; label: string }[]; highlight?: boolean };
export type PrivacyDoc = { title: string; stand: string; sections: PrivacySection[] };

const US = "Die Übermittlung in die USA stützt sich auf den Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework (Art. 45 DSGVO), soweit der Empfänger zertifiziert ist, und ergänzend auf die EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).";
const ART = {
  a: "Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)",
  b: "Art. 6 Abs. 1 lit. b DSGVO (Vertrag bzw. vorvertragliche Maßnahmen)",
  c: "Art. 6 Abs. 1 lit. c DSGVO (rechtliche Verpflichtung)",
  f: "Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse)",
};

/** Anschrift des Verantwortlichen (aus den Impressums-Daten) – ohne Platzhalter. */
function controllerLines(o: Operator, complete: boolean, legacy: string) {
  if (complete) {
    return [
      [
        o.company || o.name,
        o.company && o.representative ? `vertreten durch ${o.representative}` : o.company && o.name ? `Inhaber: ${o.name}` : "",
        o.street, `${o.zip} ${o.city}`, o.country,
      ].filter(Boolean).join("\n"),
      [`E-Mail: ${o.email}`, o.phone ? `Telefon: ${o.phone}` : ""].filter(Boolean).join("\n"),
    ];
  }
  if (legacy) return [legacy];
  return ["Verantwortlich ist der im Impressum (pokeswipe-radar.de/rechtliches#impressum) genannte Betreiber von PokeSwipe & Radar."];
}

export function buildPrivacyPolicy(o: Operator, opts: { complete: boolean; legacy?: string }): PrivacyDoc {
  const complete = opts.complete;
  const legacy = opts.legacy || "";
  const mail = complete && o.email ? o.email : "";
  const contact = mail ? `per E-Mail an ${mail}` : "über die im Impressum genannten Kontaktdaten";
  const seat = complete && o.city && (o.country || "Deutschland") === "Deutschland"
    ? `Zuständig ist insbesondere die Datenschutz-Aufsichtsbehörde des Bundeslandes, in dem wir unseren Sitz haben (${o.zip} ${o.city}).`
    : "Zuständig ist insbesondere die Aufsichtsbehörde an unserem Sitz (siehe Anschrift oben).";

  const sections: PrivacySection[] = [
    { id: "verantwortlicher", h: "1. Verantwortlicher und Kontakt", p: [
      "Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) für die Web-App, die PWA und die nativen Apps von PokeSwipe & Radar (pokeswipe-radar.de) ist:",
      ...controllerLines(o, complete, legacy),
      `Für alle Fragen zum Datenschutz und zur Ausübung deiner Rechte erreichst du uns ${contact}. Bitte gib bei Anfragen zu deinem Konto die E-Mail-Adresse deines Kontos an, damit wir dich zuordnen können.`,
    ] },
    { id: "dsb", h: "2. Datenschutzbeauftragter", p: [
      "Wir haben keinen Datenschutzbeauftragten benannt, da die Voraussetzungen einer Benennungspflicht (Art. 37 DSGVO, § 38 BDSG) nicht vorliegen. Wende dich bei Fragen bitte direkt an den Verantwortlichen.",
    ] },
    { id: "ueberblick", h: "3. Überblick", p: [
      "Du kannst PokeSwipe & Radar ohne Konto nutzen. Dann bleiben Portfolio, Merkliste und Einstellungen lokal in deinem Browser. Mit Konto speichern wir die Daten, die du selbst eingibst, um dir die Funktionen geräteübergreifend bereitzustellen. Wir verkaufen keine Daten, betreiben kein Werbe-Tracking, keine Reichweitenanalyse durch Dritte und setzen keine Werbe- oder Tracking-Cookies.",
      "Im Folgenden erklären wir für jeden Vorgang: welche Daten, zu welchem Zweck, auf welcher Rechtsgrundlage, an welche Empfänger, ob eine Übermittlung in ein Drittland stattfindet und wie lange wir die Daten speichern.",
    ] },
    { id: "hosting", h: "4. Hosting, Datenbank und Server-Logdaten (Netlify)", p: [
      "Anbieter: Netlify, Inc., San Francisco, USA. Netlify stellt Hosting, Content-Delivery-Netz, Serverfunktionen, die Datenbank (Postgres), den Dateispeicher Netlify Blobs (z. B. hochgeladene Inserat- und Pull-Wall-Fotos, Einstellungen), die Bildoptimierung (Netlify Image CDN), die Anmeldung (Netlify Identity) und das Netlify AI Gateway bereit. Netlify verarbeitet die Daten in unserem Auftrag (Auftragsverarbeitungsvertrag nach Art. 28 DSGVO).",
      "Bei jedem Aufruf verarbeitet Netlify technisch notwendige Verbindungsdaten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, übertragene Datenmenge, Statuscode, Referrer-URL sowie Browser- und Betriebssystemangaben. Unsere Serverfunktionen schreiben bei Fehlern technische Protokolle. Zweck: Auslieferung der Seiten, Stabilität, Sicherheit und Abwehr von Missbrauch.",
      `Rechtsgrundlage: ${ART.f}; unser berechtigtes Interesse liegt im sicheren und stabilen Betrieb. Gespeicherte Nutzerdaten (Konto, Inhalte) verarbeitet Netlify auf Grundlage von ${ART.b}.`,
      `Drittland: ${US}`,
      "Speicherdauer: Server-Logdaten werden von Netlify nur für einen begrenzten Zeitraum vorgehalten und danach automatisch gelöscht; Inhalte speichern wir wie in den folgenden Abschnitten beschrieben.",
    ] },
    { id: "endgeraet", h: "5. Speicher im Browser, Service Worker, keine Tracking-Cookies (§ 25 TDDDG)", p: [
      "Wir speichern Informationen in deinem Browser bzw. auf deinem Gerät (LocalStorage, SessionStorage, IndexedDB, Cache des Service Workers) nur, soweit das für die von dir ausdrücklich gewünschten Funktionen unbedingt erforderlich ist (§ 25 Abs. 2 Nr. 2 TDDDG). Eine Einwilligung ist dafür nicht nötig.",
      "Dazu gehören: Login-Token der Anmeldung, deine Einstellungen (z. B. Filter, Sprache, Push-Einstellungen, ob du den Speicher-Hinweis bestätigt hast), Portfolio-, Merklisten- und Wunschlisten-Daten ohne Konto bzw. als Offline-Kopie (wird beim Abmelden gelöscht), Zähler der täglichen Swipes und Booster, ein von einem Einladungslink übernommener Empfehlungscode, der Index für die Kartenerkennung auf dem Gerät sowie zwischengespeicherte App-Dateien und Kartenbilder des Service Workers für die Offline-Nutzung. Für den anonymen Live-Zähler speichert das Firebase-SDK eine zufällige Kennung (siehe Abschnitt 15).",
      "Wir verwenden keine Cookies oder vergleichbaren Technologien zu Werbe-, Analyse- oder Tracking-Zwecken. Du kannst den Browserspeicher jederzeit in den Einstellungen deines Browsers löschen; dann gehen lokal gespeicherte Daten ohne Konto verloren.",
      `Rechtsgrundlage für die anschließende Verarbeitung: ${ART.b} bzw. ${ART.f}.`,
    ] },
    { id: "konto", h: "6. Kundenkonto und Anmeldung (Netlify Identity)", p: [
      "Für das Konto verarbeiten wir E-Mail-Adresse, Passwort (nur als Hash bei Netlify Identity gespeichert), Sammlername sowie Zeitpunkt der Registrierung und Bestätigung. Netlify Identity versendet die Bestätigungs- und Passwort-Zurücksetzen-E-Mails. Bietet die Anmeldemaske „Weiter mit Google“ oder „Weiter mit GitHub“ an und nutzt du das, erhalten wir vom jeweiligen Anbieter (Google Ireland Limited bzw. Google LLC; GitHub, Inc., USA) deine E-Mail-Adresse und deinen Namen; für die Verarbeitung beim Anbieter gelten dessen Datenschutzhinweise.",
      `Zweck: Bereitstellung des Kontos und der kontogebundenen Funktionen. Rechtsgrundlage: ${ART.b}.`,
      `Empfänger: Netlify (Abschnitt 4). Drittland: ${US}`,
      "Speicherdauer: bis zur Löschung deines Kontos. Du kannst dein Konto jederzeit im Konto-Bereich unter „Datenschutz & Konto“ selbst löschen (Abschnitt 23).",
      "Pflicht zur Bereitstellung: Ohne E-Mail-Adresse und Passwort können wir kein Konto anlegen; die App ist dann nur eingeschränkt ohne Konto nutzbar.",
    ] },
    { id: "funktionen", h: "7. App-Funktionen mit Konto, Uploads und Mitteilungen", p: [
      "Mit Konto speichern wir die Inhalte, die du anlegst: Portfolio und Sammlung (inkl. Kaufpreisen), gegradete Karten und Grading-Einreichungen, Wunschliste, Preis-, Set-, Sealed- und Restock-Alarme, Swipe-Vorlieben und Tausch-Interessen, Inserate und Boosts, Tausche mit Versanddaten (Versanddienst, Sendungsnummer) und privaten Tausch-Nachrichten, Bewertungen, Abzeichen, Kalendereinträge, Shop-Angaben, Tarif und Laufzeit sowie Mitteilungen in der App. Hochgeladene Fotos (Inserate, Pull-Wall, Shop-Banner/-Logo) liegen in Netlify Blobs.",
      `Zweck: Bereitstellung der von dir genutzten Funktionen. Rechtsgrundlage: ${ART.b}. Empfänger: Netlify; andere Nutzer nur, soweit Inhalte öffentlich oder für einen Tauschpartner bestimmt sind (Abschnitt 13).`,
      "Speicherdauer: bis du den Eintrag löschst oder dein Konto löschst. Beim Löschen des Kontos werden alle damit verknüpften Datensätze und deine hochgeladenen Fotos entfernt.",
      "Daten-Export: Im Konto unter „Datenschutz & Konto“ kannst du alle zu deinem Konto gespeicherten Daten als Datei herunterladen (Art. 15, 20 DSGVO).",
    ] },
    { id: "push", h: "8. Push-Benachrichtigungen", p: [
      "Web-Push: Wenn du Push-Nachrichten im Browser erlaubst, speichern wir die vom Browser erzeugte Push-Adresse (Endpoint und Schlüssel) zusammen mit deiner Nutzerkennung. Die Nachrichten werden – verschlüsselt und mit unserem VAPID-Schlüssel signiert – über den Push-Dienst deines Browserherstellers zugestellt (z. B. Google Firebase Cloud Messaging für Chrome, Mozilla Push Service für Firefox, Apple Push Notification service für Safari, Microsoft Windows Push Notification Services für Edge). Diese Dienste können dabei ihren Sitz in den USA haben.",
      "Native App: In der iOS- und Android-App speichern wir das Gerätetoken (höchstens zehn pro Konto) und die Plattform. Die Zustellung erfolgt über Firebase Cloud Messaging (Google Ireland Limited / Google LLC), auf iOS weiter über den Apple Push Notification service (Apple Inc., USA).",
      `Rechtsgrundlage: ${ART.a} und § 25 Abs. 1 TDDDG; die Einwilligung erteilst du über die Berechtigungsabfrage deines Browsers bzw. Geräts. Du kannst sie jederzeit in den Browser- bzw. Systemeinstellungen oder in der App widerrufen. Drittland: ${US}`,
      "Speicherdauer: bis zum Widerruf, bis der Push-Dienst die Adresse als ungültig meldet (sie wird dann automatisch gelöscht) oder bis zur Löschung deines Kontos.",
    ] },
    { id: "ki", h: "9. KI-Kartenscan, Zustandscheck und Fake-Check (Anthropic)", p: [
      "Beim KI-Kartenscan, beim KI-Zustandscheck und beim Fake-Check sendest du ein Foto (beim Fake-Check optional zusätzlich die Rückseite) an unseren Server. Wir leiten das Bild über das Netlify AI Gateway an Anthropic PBC, San Francisco, USA, zur Auswertung durch ein KI-Modell weiter. Fotos werden von uns nicht gespeichert; wir speichern nur das Ergebnis (z. B. erkannter Kartenname und Nummer) mit Zeitpunkt, um die Kontingente deines Tarifs zu berechnen. Bitte fotografiere nur die Karte und keine Personen.",
      "Der Live-Kamera-Scanner erkennt Karten dagegen direkt auf deinem Gerät; dabei verlässt kein Kamerabild das Gerät.",
      `Rechtsgrundlage: ${ART.b}. Empfänger: Netlify (AI Gateway) und Anthropic als Auftragsverarbeiter. Drittland: ${US}`,
      "Speicherdauer: Scan-Ergebnisse bis zur Löschung deines Kontos. Die Bereitstellung eines Fotos ist freiwillig; ohne Foto ist die Funktion nicht nutzbar.",
    ] },
    { id: "zahlung", h: "10. Abos und Zahlungen (Stripe)", p: [
      "Für Abos (Premium, Pro Trader) und den Inserat-Boost nutzen wir Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland, sowie für bestimmte Verarbeitungen Stripe, Inc., USA. Auf der Bezahlseite von Stripe gibst du deine Zahlungsdaten direkt bei Stripe ein; wir erhalten keine vollständigen Karten- oder Kontodaten.",
      "Wir übermitteln bzw. speichern: E-Mail-Adresse, Nutzerkennung, Stripe-Kunden- und Abo-Kennung, gewählter Tarif und Laufzeit, Zahlungsstatus sowie als Nachweis Version der Rechtstexte, Zeitpunkt der Zustimmung und das Verlangen des sofortigen Leistungsbeginns. Stripe verarbeitet außerdem Zahlungs-, Rechnungs- und Gerätedaten zur Betrugsprävention, teilweise in eigener Verantwortung. Zur korrekten Berechnung der Umsatzsteuer erfasst Stripe im Checkout deine Rechnungsanschrift und berechnet die Steuer mit Stripe Tax; die Anschrift wird bei deinem Stripe-Kundenkonto gespeichert.",
      `Rechtsgrundlage: ${ART.b}; Aufbewahrung von Zahlungs- und Buchungsbelegen nach ${ART.c} i. V. m. § 147 AO und § 257 HGB; Betrugsprävention nach ${ART.f}.`,
      `Drittland: ${US}`,
      "Speicherdauer: Abo-Daten bis zur Löschung des Kontos; Rechnungen, Zahlungs- und Buchungsbelege bis zu zehn Jahre (§ 147 AO, § 257 HGB), auch bei Stripe. Ohne die Zahlungsangaben ist ein kostenpflichtiger Vertrag nicht möglich.",
    ], links: [{ href: "https://stripe.com/de/privacy", label: "Datenschutzerklärung von Stripe" }] },
    { id: "marktplatz", h: "11. Marktplatz mit Käuferschutz (Stripe Connect, Treuhand)", p: [
      "Verkäufer: Zum Verkaufen mit Käuferschutz legst du über Stripe Connect (Express) ein Verkäuferkonto bei Stripe an. Wir übermitteln dafür deine E-Mail-Adresse. Die Identitätsprüfung (Know Your Customer, z. B. Name, Anschrift, Geburtsdatum, Ausweisdokument, Bankverbindung) führt Stripe in eigener Verantwortung durch, um gesetzliche Pflichten (u. a. Geldwäscheprävention) zu erfüllen. Wir erhalten nur die Stripe-Kontokennung und den Freischaltungsstatus.",
      "Käufer: Bei einem Kauf erfasst Stripe Zahlungs- und Lieferdaten. Den Kaufpreis verwahren wir treuhänderisch auf unserem Stripe-Konto und zahlen ihn nach Erhalt bzw. Fristablauf abzüglich Provision an den Verkäufer aus oder erstatten ihn. Wir speichern die Bestellung (Beteiligte, Artikel, Preise, Status, Versanddienst, Sendungsnummer, Reklamationen, Rückbuchungen). Deine Lieferadresse wird dem Verkäufer erst nach erfolgreicher Zahlung und ausschließlich zur Abwicklung angezeigt.",
      `Rechtsgrundlage: ${ART.b}; Klärung von Reklamationen und Rückbuchungen sowie Betrugsschutz nach ${ART.f}; Aufbewahrung nach ${ART.c} i. V. m. § 147 AO, § 257 HGB.`,
      `Empfänger: Stripe (Abschnitt 10), der jeweilige Vertragspartner. Drittland: ${US}`,
      "Speicherdauer: Bestelldaten bis zur Löschung deines Kontos – solange Käufe oder Verkäufe mit Käuferschutz offen sind, kann das Konto nicht gelöscht werden; buchhaltungsrelevante Belege (Zahlungen, Provisionen, Auszahlungen) bis zu zehn Jahre.",
    ] },
    { id: "dac7", h: "12. Meldepflicht für Plattformbetreiber (DAC7 / PStTG)", p: [
      "Als Betreiber einer Plattform sind wir nach dem Plattformen-Steuertransparenzgesetz (PStTG) verpflichtet, für Verkäufer im Marktplatz die Anzahl der Verkäufe, die erzielten Entgelte je Quartal und die einbehaltenen Gebühren zu erfassen. Erreicht ein Verkäufer in einem Kalenderjahr 30 Verkäufe oder Entgelte von mehr als 2.000 €, müssen wir zusätzlich Art des Verkäufers (Privatperson oder Unternehmen), Name, Anschrift, Geburtsdatum (bei natürlichen Personen), Steuer-Identifikationsnummer, gegebenenfalls Umsatzsteuer-Identifikationsnummer und Handelsregisternummer sowie die Bankverbindung (IBAN) erheben, prüfen und jährlich an das Bundeszentralamt für Steuern melden, das die Daten an die Steuerbehörden anderer EU-Mitgliedstaaten weitergeben kann.",
      `Rechtsgrundlage: ${ART.c} i. V. m. §§ 13 ff. PStTG. Die Angaben sind gesetzlich vorgeschrieben; werden sie trotz zweimaliger Erinnerung nicht gemacht, müssen wir Auszahlungen zurückhalten bzw. das Verkäuferkonto sperren (§ 23 PStTG).`,
      "Speicherdauer: zehn Jahre nach Ablauf des Meldezeitraums (§ 22 PStTG).",
    ] },
    { id: "community", h: "13. Community, öffentliches Profil, Tausch-Hub und Radar", p: [
      "Öffentlich sichtbar sind dein Sammlername, deine Stadt, Inserate, Bewertungen, deine Shop-Seite, eingetragene Events und – für Tausch-Vorschläge – Karten deiner Wunschliste. Ein öffentliches Sammlerprofil (pokeswipe-radar.de/u/…) mit Profiltext, Showcase, doppelten Karten, optional Wunschliste, grober Wertstufe, Abzeichen und eigenen Pull-Wall-Beiträgen ist nur sichtbar, wenn du es aktivierst; in der Bestenliste erscheinst du nur, wenn du das einschaltest. E-Mail-Adresse, Kaufpreise und genaue Sammlungswerte werden nie öffentlich angezeigt.",
      "Pull-Wall, Kommentare, Likes und Live-Chat speichern wir in unserer eigenen Datenbank bei Netlify. Folgen und Blockieren speichern wir als Beziehung zwischen den Konten. Private Tausch-Nachrichten sehen nur die Beteiligten.",
      "Sammler-Radar: Setzt du einen Radar-Pin, übermittelt die App deine GPS-Position (nur nach Freigabe durch dich) oder den Ort, den du eingibst. Der Server speichert nie die genaue Position, sondern nur die Mitte einer ca. 1 km großen Rasterzelle zusammen mit Name, Ort und Karten. Du kannst deinen Pin jederzeit löschen.",
      `Rechtsgrundlage: ${ART.b}; die Standortfreigabe erteilst du freiwillig über die Berechtigungsabfrage deines Geräts. Speicherdauer: bis du die Inhalte löschst, das Profil deaktivierst oder dein Konto löschst.`,
    ] },
    { id: "moderation", h: "13a. Moderation, Vertrauensstufe und Meldungen (Digital Services Act)", p: [
      "Zum Schutz der Community prüft ein automatischer Filter neue Beiträge, Kommentare, Chat-Nachrichten, Inserate und Radar-Pins auf Beleidigungen, Kurz- und Einladungslinks, Telefonnummern und riskante Zahlungsaufforderungen. Schreib-Limits und erlaubte Links richten sich nach einer Vertrauensstufe, die aus Kontoalter, bestätigter E-Mail-Adresse, abgeschlossenen Tauschen und Käufen, Bewertungen und früheren Verstößen berechnet wird. Auffällige Inhalte werden zurückgehalten oder bis zur Prüfung ausgeblendet; Inhalte mit mehreren Meldungen werden ebenfalls ausgeblendet. Moderationsentscheidungen protokollieren wir.",
      "Du kannst Inhalte und Nutzer melden. Dabei verarbeiten wir deine Nutzerkennung, den gemeldeten Inhalt und den Grund. Betroffene informieren wir über Einschränkungen mit Begründung, soweit der Digital Services Act (DSA) dies vorsieht; gegen Entscheidungen kannst du dich an uns wenden.",
      `Rechtsgrundlage: ${ART.f} (Schutz der Nutzer vor Betrug, Spam und rechtswidrigen Inhalten) sowie ${ART.c} i. V. m. Art. 16, 17 und 20 DSA. Speicherdauer: Meldungen und Moderationsprotokolle bis zur Löschung des betroffenen Kontos bzw. solange zur Nachweisführung erforderlich.`,
    ] },
    { id: "karten", h: "14. Kartenansicht und Ortssuche (OpenStreetMap)", p: [
      "Die Kartenansicht (Leaflet) liefern wir selbst aus. Die Kartenkacheln lädt dein Browser direkt von tile.openstreetmap.org (OpenStreetMap Foundation, St John’s Innovation Centre, Cambridge, Vereinigtes Königreich; ausgeliefert über ein Content-Delivery-Netz). Gibst du beim Radar oder im Deals-Radar einen Ort ein, sendet dein Browser diesen an den Geocoding-Dienst Nominatim der OpenStreetMap Foundation, um Koordinaten zu ermitteln. Dabei wird technisch bedingt deine IP-Adresse übermittelt.",
      `Rechtsgrundlage: ${ART.f} (Darstellung von Karten und Ortssuche auf deinen Wunsch). Drittland: Für das Vereinigte Königreich besteht ein Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Speicherdauer: nach den Vorgaben der OpenStreetMap Foundation; wir speichern nichts davon.`,
      "Der Link „In Google Maps öffnen“ führt erst nach deinem Klick zu Google Maps (Google Ireland Limited); vorher werden keine Daten an Google übertragen.",
    ], links: [{ href: "https://osmfoundation.org/wiki/Privacy_Policy", label: "Datenschutzhinweise der OpenStreetMap Foundation" }] },
    { id: "firebase", h: "15. Live-Besucherzähler und Online-Anzeige (Google Firebase)", p: [
      "Für den Live-Bereich (Gesamtzahl der Besuche und aktuell online) nutzen wir die Firebase Realtime Database von Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland (Mutterkonzern Google LLC, USA), mit Speicherort europe-west1 (Belgien). Das Firebase-Skript lädt dein Browser nach dem Seitenaufbau von www.gstatic.com. Firebase vergibt eine zufällige, anonyme Kennung (anonyme Firebase-Anmeldung); gespeichert werden nur ein Zählerstand und ein Online-Eintrag mit Zeitstempel unter dieser Kennung, der beim Verlassen der Seite entfernt wird. Name, E-Mail oder Inhalte werden nicht an Firebase übertragen; Chat, Pull-Wall und Radar-Pins speichern wir ausschließlich in unserer eigenen Datenbank. Technisch bedingt erhält Google deine IP-Adresse.",
      `Rechtsgrundlage: ${ART.f} (Anzeige der Live-Aktivität der Community); Speicherung der Kennung auf deinem Gerät nach § 25 Abs. 2 Nr. 2 TDDDG. Drittland: ${US}`,
      "Speicherdauer: Online-Einträge werden beim Trennen der Verbindung gelöscht und nach spätestens zehn Minuten ohne Lebenszeichen nicht mehr gezählt; die anonyme Kennung bleibt in deinem Browser, bis du den Browserspeicher löschst.",
    ] },
    { id: "kartendaten", h: "16. Kartendaten, Preise und Kartenbilder (TCGdex, Netlify Image CDN)", p: [
      "Kartendaten und Cardmarket-Preise beziehen wir vom Open-Source-Projekt TCGdex. Kartenbilder (von assets.tcgdex.net, images.pokemontcg.io und raw.githubusercontent.com) laden wir überwiegend über das Netlify Image CDN; dabei ruft Netlify die Bilder ab, nicht dein Browser. Bei einzelnen Funktionen (z. B. der Kartensuche) fragt dein Browser die Schnittstelle api.tcgdex.net bzw. Bilder von assets.tcgdex.net direkt ab; dabei werden deine IP-Adresse, Browserangaben und der Suchbegriff an die Server von TCGdex übertragen, die sich auch außerhalb der EU befinden können.",
      `Rechtsgrundlage: ${ART.f} (Bereitstellung aktueller Kartendaten). Wir speichern dabei keine personenbezogenen Daten.`,
    ] },
    { id: "partner", h: "17. Partnerlinks (eBay, Amazon, Cardmarket) und eBay-Schnittstelle", p: [
      "Mit * gekennzeichnete eBay-Links sind Partnerlinks des eBay Partner Network (Campaign-ID 5339244109). Der Link enthält unsere Kennung und den App-Bereich, aus dem du kommst – keine Daten über dich. Erst wenn du klickst, verarbeitet eBay beim Aufruf der eBay-Seite Daten (z. B. Cookies zur Zuordnung der Provision) in eigener Verantwortung.",
      "Bei Links zu Amazon kann unser Partner-Tag angehängt sein. Als Amazon-Partner verdienen wir an qualifizierten Verkäufen. Links zu Cardmarket (Sammelkartenmarkt GmbH & Co. KG, Berlin) können Kampagnenparameter und unser Partnerkürzel enthalten. Klicks auf Grading-Partnerlinks zählen wir mit Partner, Zeitpunkt und – falls du angemeldet bist – deiner Nutzerkennung, um die Partnerabrechnung nachzuvollziehen; ausgewertet wird nur die Zahl der Klicks je Partner. Nach einer Kontolöschung bleibt dort nur die zufällige, keiner Person mehr zuordenbare Kennung zurück.",
      "Für Preisvergleiche und den Flip-Radar fragt unser Server Angebote über die eBay-Browse-API ab; dabei werden keine Daten über dich an eBay übertragen. Öffentlich angezeigte Verkäufernamen aus eBay-Angeboten speichern wir nur mit dem jeweiligen Angebot (Art. 14 DSGVO, Quelle: eBay) und löschen sie, sobald eBay uns über unseren Endpunkt für Kontolöschungen (Marketplace Account Deletion) die Löschung eines eBay-Kontos meldet; beendete Angebote löschen wir nach 30 Tagen.",
      `Rechtsgrundlage: ${ART.f} (Finanzierung des kostenlosen Angebots über Provisionen, Preisvergleich). Die Verarbeitung auf den Partnerseiten richtet sich nach deren Datenschutzerklärungen.`,
    ] },
    { id: "teilen", h: "18. Teilen-Links und Empfehlungen", p: [
      "Wenn du Inhalte teilst, erzeugen wir einen Kurzlink (pokeswipe-radar.de/s/…), der deinem Konto zugeordnet ist. Ruft jemand den Link auf, zählen wir den Besuch – ohne bekannte Bots – mit einem pseudonymen Besucher-Hash: Aus IP-Adresse und Browserkennung (User-Agent) wird zusammen mit einem festen Schlüssel ein SHA-256-Hash gebildet und gekürzt gespeichert, zusammen mit dem Tag des Besuchs. IP-Adresse und User-Agent selbst speichern wir dabei nicht. Damit erkennen wir neue Besucher, zeigen dir Klickzahlen an und schreiben den Teilen-Bonus (zusätzliche KI-Scans) sowie Empfehlungsprämien gut.",
      "Kommst du über einen Einladungslink, speichern wir den Empfehlungscode lokal in deinem Browser und bei der Registrierung in deinem Konto, um die Prämie dem Einladenden gutzuschreiben.",
      `Rechtsgrundlage: ${ART.f} (missbrauchssichere Zählung und Gutschrift von Empfehlungen) bzw. ${ART.b} für die Prämien. Speicherdauer: bis zur Löschung des Kurzlinks bzw. des Kontos des Link-Inhabers.`,
    ] },
    { id: "kuendigung", h: "19. Kündigungsbutton und E-Mail-Bestätigungen (Resend)", p: [
      "Kündigst du über „Verträge hier kündigen“, verarbeiten wir Name, E-Mail-Adresse, optional Vertragsbezeichnung, Kündigungsart, Grund (bei außerordentlicher Kündigung), Wunschtermin, Zeitpunkt des Eingangs, Bearbeitungsstatus und – falls vorhanden – die Zuordnung zu deinem Konto. Die Bestätigung erhältst du auf der Seite, als Mitteilung im Konto und, sofern der E-Mail-Versand eingerichtet ist, per E-Mail über den Dienstleister Resend, Inc., USA (Empfängeradresse und Bestätigungstext). Fälle, die geprüft werden müssen, leiten wir per E-Mail an unser eigenes Postfach weiter.",
      `Rechtsgrundlage: ${ART.c} i. V. m. § 312k BGB und ${ART.b}; Nachweis des Eingangs nach ${ART.f}. Drittland: ${US}`,
      "Speicherdauer: Kündigungsnachweise bewahren wir bis zum Ablauf der regelmäßigen Verjährungsfrist auf (drei Jahre ab Ende des Jahres der Kündigung, §§ 195, 199 BGB), auch wenn das Konto vorher gelöscht wird.",
    ] },
    { id: "sicherheit", h: "20. Missbrauchsschutz (Rate-Limiting) und Fehlerprotokoll", p: [
      "Um Überlastung und Missbrauch zu verhindern, zählen wir Anfragen je IP-Adresse bzw. Nutzerkennung und Funktion in einem kurzen Zeitfenster (im Arbeitsspeicher und in der Datenbanktabelle rate_limits). Die Einträge enthalten nur den Schlüssel, einen Zähler und das Ende des Zeitfensters und werden nach Ablauf des Fensters (höchstens eine Stunde) verworfen.",
      "Technische Fehler protokollieren wir im Fehlerprotokoll unseres Backends (Bereich, Fehlermeldung, technischer Kontext, ggf. Nutzerkennung). Die Einträge werden nach 30 Tagen gelöscht.",
      `Rechtsgrundlage: ${ART.f} (Sicherheit und Stabilität des Dienstes, Art. 32 DSGVO).`,
    ] },
    { id: "admin", h: "21. Interne Werkzeuge ohne Nutzerdaten", p: [
      "Für eigene Werbevideos nutzen wir im Admin-Bereich Make.com (Celonis) zur Weitergabe fertiger Videos an soziale Netzwerke und ElevenLabs für Sprachaufnahmen. Dabei werden ausschließlich von uns erstellte Inhalte und Texte übertragen, keine Daten von Nutzerinnen und Nutzern.",
    ] },
    { id: "drittland", h: "22. Übermittlung in Drittländer – Zusammenfassung", p: [
      "Einige Dienstleister haben ihren Sitz in den USA oder greifen von dort auf Daten zu: Netlify, Inc., Stripe, Inc., Google LLC, Anthropic PBC, Resend, Inc. sowie ggf. Apple Inc., GitHub, Inc., Mozilla und Microsoft bei der Zustellung von Push-Nachrichten bzw. der Anmeldung. " + US + " Kopien der Standardvertragsklauseln kannst du bei uns anfordern.",
    ] },
    { id: "loeschung", h: "23. Speicherdauer und Löschung des Kontos", p: [
      "Wir speichern personenbezogene Daten nur so lange, wie es für den jeweiligen Zweck erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen. Löschst du dein Konto unter „Datenschutz & Konto“, beenden wir ein laufendes Abo sofort, löschen dein Profil mit allen verknüpften Daten (Portfolio, Alarme, Inserate, Beiträge, Nachrichten, Push-Adressen, Teilen-Links usw.) sowie deine hochgeladenen Fotos und entfernen dein Login bei Netlify Identity. Ausgenommen sind Daten, die wir aufgrund gesetzlicher Pflichten aufbewahren müssen (Abschnitte 10–12 und 19); diese sperren wir für jede andere Verwendung und löschen sie nach Fristablauf.",
    ] },
    { id: "pflicht", h: "24. Pflicht zur Bereitstellung", p: [
      "Die Nutzung ohne Konto ist ohne Angabe personenbezogener Daten möglich (abgesehen von den technisch notwendigen Verbindungsdaten). Für ein Konto, kostenpflichtige Abos und den Marktplatz sind die jeweils gekennzeichneten Angaben erforderlich, damit wir den Vertrag erfüllen können; ohne sie ist die Funktion nicht nutzbar. Die DAC7-Angaben (Abschnitt 12) sind gesetzlich vorgeschrieben. Alle übrigen Angaben (z. B. Stadt, Profiltext, Standort für den Radar) sind freiwillig.",
    ] },
    { id: "art22", h: "25. Automatisierte Entscheidungen (Art. 22 DSGVO)", p: [
      "Eine ausschließlich automatisierte Entscheidung, die dir gegenüber rechtliche Wirkung entfaltet oder dich in ähnlicher Weise erheblich beeinträchtigt, findet nicht statt. Die automatische Moderation und die Vertrauensstufe (Abschnitt 13a) steuern lediglich, ob ein Beitrag sofort erscheint oder vorab geprüft wird und wie viele Beiträge bzw. Links du schreiben darfst; endgültige Sperren von Inhalten oder Konten trifft ein Mensch. Automatische Erstattungen im Marktplatz bei ausbleibendem Versand folgen den vereinbarten Fristen der AGB. Du kannst jederzeit eine Überprüfung durch uns verlangen und deinen Standpunkt darlegen.",
    ] },
    { id: "minderjaehrige", h: "26. Kinder und Jugendliche", p: [
      "PokeSwipe & Radar richtet sich an Sammlerinnen und Sammler jeden Alters, wird aber nicht speziell auf Kinder zugeschnitten. Bist du jünger als 16 Jahre, darfst du ein Konto nur mit Zustimmung deiner Erziehungsberechtigten anlegen; Einwilligungen (z. B. für Push-Nachrichten) müssen in diesem Fall deine Erziehungsberechtigten erteilen (Art. 8 DSGVO). Kostenpflichtige Abos und Käufe oder Verkäufe im Marktplatz setzen bei Minderjährigen die Zustimmung der Erziehungsberechtigten voraus (§§ 106 ff. BGB); die Identitätsprüfung von Stripe für Verkäuferkonten kann ein Mindestalter voraussetzen. Erziehungsberechtigte können sich jederzeit an uns wenden, um Daten ihres Kindes löschen zu lassen.",
    ] },
    { id: "rechte", h: "27. Deine Rechte", p: [
      "Du hast gegenüber uns das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21). Die Mitteilungspflicht nach Art. 19 DSGVO erfüllen wir gegenüber den Empfängern deiner Daten.",
      "Widerruf von Einwilligungen: Eine erteilte Einwilligung (Art. 7 Abs. 3 DSGVO) kannst du jederzeit mit Wirkung für die Zukunft widerrufen, z. B. für Push-Nachrichten in den Browser- oder Geräteeinstellungen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt unberührt.",
      `Viele Rechte kannst du direkt im Konto unter „Datenschutz & Konto“ ausüben (Daten herunterladen, Konto löschen, Profil und Bestenliste ein- oder ausschalten). Im Übrigen genügt eine Nachricht ${contact}.`,
    ] },
    { id: "widerspruch", h: "28. Widerspruchsrecht (Art. 21 DSGVO)", highlight: true, p: [
      "Soweit wir Daten auf Grundlage berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO) verarbeiten, hast du das Recht, aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit Widerspruch gegen diese Verarbeitung einzulegen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die deine Interessen, Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.",
      "Eine Verarbeitung zu Zwecken der Direktwerbung findet nicht statt. Sollte sie künftig erfolgen, kannst du ihr jederzeit ohne Angabe von Gründen widersprechen.",
      `Der Widerspruch ist formfrei möglich, am einfachsten ${contact}.`,
    ] },
    { id: "beschwerde", h: "29. Beschwerderecht bei einer Aufsichtsbehörde", p: [
      `Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO), insbesondere in dem Mitgliedstaat deines gewöhnlichen Aufenthalts, deines Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes. ${seat} Die Anschriften aller deutschen Aufsichtsbehörden findest du in der Liste der Bundesbeauftragten für den Datenschutz und die Informationsfreiheit.`,
    ], links: [{ href: "https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html", label: "Liste der Datenschutz-Aufsichtsbehörden" }] },
    { id: "aenderungen", h: "30. Änderungen dieser Datenschutzerklärung", p: [
      "Wir passen diese Datenschutzerklärung an, wenn sich unsere Funktionen, Dienstleister oder die Rechtslage ändern. Es gilt die jeweils hier veröffentlichte Fassung; über wesentliche Änderungen informieren wir angemeldete Nutzer in der App.",
      PRIVACY_STAND,
    ] },
  ];
  return { title: "Datenschutzerklärung", stand: PRIVACY_STAND, sections };
}

/** HTML-Inhalt der Seite /datenschutz (ohne Seitenrahmen); alle Texte werden escaped. */
export function privacyPage(doc: PrivacyDoc) {
  const sec = (s: PrivacySection) => `<section id="${h(s.id)}"${s.highlight ? ' style="border:2px solid #facc15;border-radius:16px;padding:4px 14px 10px;margin-top:20px;background:#1e1b4b"' : ""}>`
    + `<h3>${h(s.h)}</h3>${s.p.map((x) => `<p>${s.highlight ? `<strong>${h(x)}</strong>` : h(x)}</p>`).join("")}`
    + (s.links?.length ? `<p>${s.links.map((l) => `<a href="${h(l.href)}" target="_blank" rel="noopener">${h(l.label)}</a>`).join(" · ")}</p>` : "")
    + "</section>";
  return `<div class="card doc"><h1>${h(doc.title)}</h1><p class="muted">${h(doc.stand)}</p>
    <div class="toc"><a href="/rechtliches#impressum">Impressum</a><a href="/rechtliches#agb">AGB</a><a href="/rechtliches#widerruf">Widerrufsbelehrung</a><a href="#widerspruch">Widerspruchsrecht</a><a href="/kuendigen" style="background:#f43f5e;color:#fff">Verträge hier kündigen</a></div>
    <nav aria-label="Inhalt"><h2>Inhalt</h2><p>${doc.sections.map((s) => `<a href="#${h(s.id)}">${h(s.h)}</a>`).join("<br>")}</p></nav>
    ${doc.sections.map(sec).join("")}</div>`;
}
