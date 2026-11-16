// PokeSwipe & Radar – Rechtliches: Impressum (§ 5 DDG), AGB, Widerrufsbelehrung inkl. digitaler Leistungen,
// Muster-Widerrufsformular und Kündigungsbutton nach § 312k BGB (mit Bestätigungsseite und Eingangsnachweis).
//
// Anbieterangaben: Der Admin pflegt sie in der Admin-Zentrale unter „Rechtliches“ (gespeichert in Netlify Blobs).
// Alternativ greift die Umgebungsvariable IMPRESSUM_TEXT (Freitext). Personenbezogene Anbieterdaten stehen
// bewusst nicht im Quellcode (öffentliches Repository).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db, profiles, cancellations } from "../db/index.ts";
import { verifyIdentityToken } from "./auth.ts";
import { stripe, applySubscription } from "./billing.ts";
import { notify } from "./prices.ts";
import { PLANS, BOOST_DAYS, BOOST_PRICE_CENTS } from "./plans.ts";
import { SITE, h, pageShell } from "./growth.ts";
import { str, rows, rateLimit, clientIp, euro } from "./util.ts";
import { log } from "./log.ts";
import { buildPrivacyPolicy, privacyPage } from "./privacy.ts";

/** Stand der Rechtstexte – wird bei jeder Bestellung als Nachweis in Stripe gespeichert. */
export const LEGAL_VERSION = "2026-11-16";
const BRAND = "PokeSwipe & Radar";

export type Operator = {
  name: string; company: string; representative: string; street: string; zip: string; city: string; country: string;
  email: string; phone: string; vatId: string; register: string; responsible: string; smallBusiness: boolean;
};
type Saved = { operator?: Partial<Operator>; impressum?: string; updatedAt?: string | null };
type Section = { h?: string; p: string[] };
export type LegalDoc = { id: string; title: string; sections: Section[] };

const EMPTY: Operator = {
  name: "", company: "", representative: "", street: "", zip: "", city: "", country: "Deutschland",
  email: "", phone: "", vatId: "", register: "", responsible: "", smallBusiness: false,
};
const FIELD_MAX: Record<keyof Operator, number> = {
  name: 120, company: 160, representative: 160, street: 160, zip: 12, city: 100, country: 60,
  email: 160, phone: 60, vatId: 30, register: 200, responsible: 200, smallBusiness: 0,
};

export function cleanOperator(raw: any): Operator {
  const o: any = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Operator)[]) {
    if (k === "smallBusiness") o.smallBusiness = raw?.smallBusiness === true;
    else if (raw?.[k] !== undefined) o[k] = str(raw[k], FIELD_MAX[k]);
  }
  if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) o.email = "";
  if (!o.country) o.country = "Deutschland";
  return o as Operator;
}

/** Pflichtangaben vollständig? (Name/Firma, ladungsfähige Anschrift, E-Mail) */
export const operatorComplete = (o: Operator) => Boolean((o.name || o.company) && o.street && o.zip && o.city && o.email);

async function loadSaved(): Promise<Saved> {
  try { return ((await getStore("app-config").get("legal", { type: "json" })) as Saved) || {}; } catch { return {}; }
}

export async function getOperator() {
  const saved = await loadSaved();
  const own = cleanOperator(saved.operator || {});
  const legacy = str(saved.impressum, 4000) || str(process.env.IMPRESSUM_TEXT, 4000);
  // Anbieterangaben kommen ausschließlich aus der Admin-Konfiguration (keine personenbezogenen Daten im Quellcode).
  // Unvollständige Angaben meldet die Admin-Zentrale unter „Integrationen“ (operatorComplete).
  if (!operatorComplete(own) && !legacy) log.warn("legal", "Anbieterangaben unvollständig – bitte in der Admin-Zentrale unter „Rechtliches“ ergänzen.");
  return { operator: own, legacy, updatedAt: saved.updatedAt || null };
}

const STREIT = "Verbraucherstreitbeilegung: Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.";

/** Anbieter in einer Zeile (für AGB und Widerrufsbelehrung). */
function providerLine(o: Operator) {
  if (!operatorComplete(o)) return "den im Impressum genannten Anbieter";
  return [o.company || o.name, o.company && o.representative ? `vertreten durch ${o.representative}` : "", o.street, `${o.zip} ${o.city}`, o.country !== "Deutschland" ? o.country : "", `E-Mail: ${o.email}`]
    .filter(Boolean).join(", ");
}

export function impressumText(o: Operator, legacy = "") {
  if (!operatorComplete(o)) return legacy ? (legacy.includes("Streitbeilegung") ? legacy : `${legacy}\n\n${STREIT}`) : "";
  const lines = [
    o.company || o.name,
    o.company && o.representative ? `Vertreten durch: ${o.representative}` : o.company && o.name ? `Inhaber: ${o.name}` : null,
    o.street, `${o.zip} ${o.city}`, o.country,
    "",
    "Kontakt:",
    `E-Mail: ${o.email}`,
    o.phone ? `Telefon: ${o.phone}` : "",
    o.vatId ? `\nUmsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${o.vatId}` : o.smallBusiness ? "\nKleinunternehmer gemäß § 19 UStG – es wird keine Umsatzsteuer berechnet." : "",
    o.register ? `\nRegistereintrag: ${o.register}` : "",
    "",
    `Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: ${o.responsible || `${o.representative || o.name || o.company}, Anschrift wie oben`}`,
    "",
    STREIT,
  ];
  return lines.filter((l) => l !== null && l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildDocuments(input: Operator, legacy = ""): LegalDoc[] {
  const o = input;
  const prov = providerLine(o);
  const mail = o.email || "der im Impressum genannten E-Mail-Adresse";
  const vat = o.smallBusiness ? "Als Kleinunternehmer im Sinne von § 19 UStG berechnen wir keine Umsatzsteuer; alle Preise sind Endpreise." : "Alle Preise sind Endpreise in Euro inklusive der gesetzlichen Umsatzsteuer.";
  const p = PLANS;
  const impressum = impressumText(o, legacy);
  return [
    {
      id: "impressum", title: "Impressum",
      sections: [{ h: "Angaben gemäß § 5 DDG", p: impressum.split(/\n{2,}/) },
        { h: "Rolle beim Marktplatz (Plattform- und Zahlungsvermittlung)", p: [
          `Beim Marktplatz mit Käuferschutz (Direktkauf, Warenkorb) betreiben wir eine Online-Plattform, über die Nutzer Kaufverträge unmittelbar miteinander schließen. Verkäufer der angebotenen Karten ist der jeweilige Nutzer – nicht ${BRAND}. Gewerbliche Händler werden als solche gekennzeichnet; ihre Anbieterangaben (Name/Firma, Anschrift, E-Mail, ggf. USt-IdNr. und Register) werden vor dem Kauf und in der Bestellung angezeigt.`,
          "Die Zahlungsabwicklung übernimmt Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland, ein von der Central Bank of Ireland beaufsichtigtes E-Geld-Institut. Verkäufer erhalten Auszahlungen über ein eigenes, von Stripe verifiziertes Konto (Stripe Connect Express). Kaufpreise werden bis zur Freigabe bei Stripe verwahrt; an uns fließt ausschließlich die Plattform-Provision.",
          "Als Plattformbetreiber im Sinne des Plattformen-Steuertransparenzgesetzes (PStTG) erheben wir die gesetzlich vorgeschriebenen Angaben meldepflichtiger Verkäufer und übermitteln sie an das Bundeszentralamt für Steuern.",
        ] },
        { h: "Hinweis", p: [`${BRAND} ist ein unabhängiges, inoffizielles Fanprojekt und steht in keiner Verbindung zu Nintendo, Creatures Inc., GAME FREAK inc. oder The Pokémon Company. Pokémon und alle Kartennamen sind Marken ihrer jeweiligen Inhaber.`] }],
    },
    {
      id: "datenschutz", title: "Datenschutzerklärung",
      sections: [
        { h: "1. Verantwortlicher", p: [
          `Verantwortlich für die Datenverarbeitung auf pokeswipe-radar.de und in der App ${BRAND} ist: ${prov}${o.phone ? `, Telefon: ${o.phone}` : ""}.`,
          "Ein Datenschutzbeauftragter ist nicht bestellt, da die gesetzlichen Voraussetzungen dafür nicht vorliegen. Bei Fragen zum Datenschutz wende dich direkt an die oben genannte E-Mail-Adresse.",
        ] },
        { h: "2. Aufruf der Website (Server-Logfiles)", p: [
          "Beim Aufruf der Seite verarbeitet unser Hosting-Anbieter technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Referrer, Browser und Betriebssystem. Das dient der sicheren und stabilen Auslieferung (Art. 6 Abs. 1 lit. f DSGVO). Die Protokolle werden nach kurzer Zeit automatisch gelöscht.",
        ] },
        { h: "3. Hosting, Datenbank und Login – Netlify", p: [
          "Website, Server-Funktionen, Datenbank, Dateispeicher, Bild-Optimierung und Login (Netlify Identity) betreibt Netlify, Inc. (USA). Gespeichert werden dort bei einem Konto: E-Mail-Adresse, Passwort (nur als Hash), Sammlername, Portfolio, Wunschliste, Preisalarme, Inserate, Tausche und Nachrichten, Bewertungen, Community-Beiträge, Abo-Status und Kündigungen. Rechtsgrundlage ist die Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).",
          "Netlify ist unter dem EU-US Data Privacy Framework zertifiziert; zusätzlich bestehen EU-Standardvertragsklauseln (Art. 45, 46 DSGVO). Mit Netlify besteht ein Vertrag zur Auftragsverarbeitung. Datenschutzhinweise: netlify.com/privacy",
        ] },
        { h: "4. Zahlungen – Stripe", p: [
          "Kostenpflichtige Abos (Premium, Pro Trader), Boosts und Käufe mit Käuferschutz wickeln wir über Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irland, ab. Stripe verarbeitet Name, E-Mail-Adresse, Zahlungsdaten, Rechnungsadresse und die Transaktion, prüft Zahlungen auf Betrug und sendet die Bestellbestätigung. Wir selbst sehen keine vollständigen Karten- oder Kontodaten, sondern nur Kunden- und Abo-Kennungen, Betrag und Zahlungsstatus.",
          "Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) sowie gesetzliche Aufbewahrungspflichten (Art. 6 Abs. 1 lit. c DSGVO; § 147 AO, § 257 HGB – Buchungsbelege 8 bzw. 10 Jahre). Datenübermittlungen an Stripe, Inc. (USA) erfolgen auf Grundlage des EU-US Data Privacy Framework bzw. von Standardvertragsklauseln. Datenschutzhinweise: stripe.com/de/privacy",
        ] },
        { h: "5. Besucherzähler und Online-Anzeige – Google Firebase", p: [
          "Für den anonymen Besucherzähler und die Online-Anzeige nutzen wir die Firebase Realtime Database (Rechenzentrum europe-west1, Belgien) und Firebase Authentication der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Dafür lädt die Seite das Firebase-Skript von gstatic.com, vergibt eine zufällige, anonyme Kennung und überträgt technisch bedingt deine IP-Adresse. Es werden keine Namen, E-Mail-Adressen oder Inhalte in Firebase gespeichert.",
          "Rechtsgrundlage ist unser berechtigtes Interesse an einer Reichweitenanzeige und einer funktionierenden Live-Anzeige (Art. 6 Abs. 1 lit. f DSGVO). Eine Übermittlung an Google LLC (USA) ist nicht auszuschließen und erfolgt auf Grundlage des EU-US Data Privacy Framework. Datenschutzhinweise: firebase.google.com/support/privacy",
        ] },
        { h: "6. Affiliate-Links – eBay Partner Network, Cardmarket, Amazon", p: [
          "Mit * gekennzeichnete Links zu eBay, Cardmarket oder Amazon sind Partnerlinks. Wir nehmen am eBay Partner Network teil. Klickst du einen solchen Link, setzt erst der jeweilige Anbieter auf seiner Seite eine Kennung, um einen Kauf unserer Empfehlung zuzuordnen; wir erhalten keine personenbezogenen Daten von dir, sondern nur eine Provisionsabrechnung. Auf pokeswipe-radar.de selbst werden dafür keine Cookies gesetzt.",
          "Für die Deal-Suche fragen wir über die eBay-Schnittstelle öffentliche Angebote ab; dabei werden keine Daten von dir an eBay übermittelt. Verantwortlich für Vorgänge auf den Partnerseiten sind die Anbieter selbst, z. B. eBay GmbH, Albert-Einstein-Ring 2–6, 14532 Kleinmachnow. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Finanzierung des Dienstes).",
        ] },
        { h: "7. Weitere Dienstleister", p: [
          "KI-Kartenscan und Zustandscheck: Fotos werden über das Netlify AI Gateway an Anthropic PBC (USA) zur Auswertung gesendet und von uns nicht gespeichert (Art. 6 Abs. 1 lit. b DSGVO). Kartendaten und Preise: TCGdex/Cardmarket (es werden keine Nutzerdaten übertragen). Kartenansicht: Kartenkacheln von OpenStreetMap; beim Suchen eines Orts wird die Eingabe an OpenStreetMap Nominatim gesendet (IP-Adresse technisch bedingt). Push-Nachrichten: Zustellung über die Push-Dienste von Google, Apple, Mozilla bzw. Microsoft, nur wenn du Push aktivierst (Art. 6 Abs. 1 lit. a DSGVO). E-Mail-Bestätigungen (z. B. für Kündigungen) können über den Versanddienst Resend zugestellt werden (Empfängeradresse und Text).",
        ] },
        { h: "8. Speicher im Browser", p: [
          "Wir setzen keine Werbe- oder Tracking-Cookies. Im Browser (LocalStorage, IndexedDB, Service Worker) speichern wir nur technisch notwendige Daten: Login-Token, Einstellungen und eine Offline-Kopie deiner Sammlung (§ 25 Abs. 2 Nr. 2 TDDDG). Beim Abmelden werden kontobezogene Daten gelöscht.",
        ] },
        { h: "9. Speicherdauer", p: [
          "Kontodaten speichern wir, bis du dein Konto löschst. Du kannst es jederzeit im Konto unter „Datenschutz & Konto“ selbst löschen; die Daten werden dann entfernt, soweit keine gesetzlichen Aufbewahrungspflichten (z. B. für Rechnungen und Kündigungsnachweise) entgegenstehen. Öffentliche Inhalte wie Inserate oder Beiträge kannst du jederzeit selbst entfernen.",
        ] },
        { h: "10. Deine Rechte", p: [
          "Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (Art. 7 Abs. 3). Im Konto kannst du alle Daten als Datei herunterladen.",
          "Widerspruchsrecht: Verarbeiten wir Daten auf Grundlage berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO), kannst du aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen (Art. 21 DSGVO). Eine formlose Nachricht an " + mail + " genügt.",
          "Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, z. B. bei der für uns zuständigen Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, Kavalleriestraße 2–4, 40213 Düsseldorf.",
          "Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO statt. Die Bereitstellung von Daten ist für ein Konto bzw. ein Abo erforderlich; ohne Konto ist die App eingeschränkt nutzbar.",
          `Stand: ${new Date(LEGAL_VERSION).toLocaleDateString("de-DE")}`,
        ] },
      ],
    },
    {
      id: "agb", title: "Allgemeine Geschäftsbedingungen (AGB)",
      sections: [
        { h: "§ 1 Geltungsbereich und Anbieter", p: [
          `(1) Diese AGB gelten für alle Verträge über die Nutzung der Web-App ${BRAND} unter pokeswipe-radar.de (im Folgenden „Dienst“) zwischen ${prov} (im Folgenden „wir“) und den Nutzerinnen und Nutzern (im Folgenden „du“).`,
          "(2) Verbraucher ist jede natürliche Person, die ein Rechtsgeschäft zu Zwecken abschließt, die überwiegend weder ihrer gewerblichen noch ihrer selbständigen beruflichen Tätigkeit zugerechnet werden können (§ 13 BGB). Abweichende Bedingungen der Nutzer gelten nicht.",
        ] },
        { h: "§ 2 Leistungen", p: [
          "(1) Der Dienst bietet u. a. Kartensuche, Preisinformationen (Cardmarket-Daten über TCGdex), Portfolio, Preis- und Restock-Alarme, KI-Kartenscan, Tausch-Hub, Community-Funktionen und Händler-Shops. Der kostenlose Tarif „Free“ ist dauerhaft ohne Zahlung nutzbar.",
          `(2) Kostenpflichtig sind die Abos „Premium“ (${euro(p.premium.priceCents / 100)} pro Monat oder ${euro(p.premium.yearlyPriceCents / 100)} pro Jahr) und „Pro Trader“ (${euro(p.pro.priceCents / 100)} pro Monat oder ${euro(p.pro.yearlyPriceCents / 100)} pro Jahr) mit den bei der Bestellung beschriebenen Zusatzfunktionen und Kontingenten sowie der einmalige Inserat-Boost (${euro(BOOST_PRICE_CENTS / 100)} für ${BOOST_DAYS} Tage Platzierung oben im Tausch-Hub).`,
          "(3) Preis-, Verfügbarkeits- und Restock-Angaben stammen aus Quellen Dritter oder von der Community und werden automatisiert verarbeitet. Wir übernehmen keine Gewähr für Richtigkeit, Vollständigkeit und Aktualität; maßgeblich ist stets das Angebot des jeweiligen Händlers. KI-Auswertungen (Kartenscan, Zustands- und Fake-Check) sind unverbindliche Einschätzungen und ersetzen keine professionelle Begutachtung.",
          "(4) Tausch- und Kaufgeschäfte im Tausch-Hub kommen ausschließlich zwischen den beteiligten Nutzern zustande. Wir sind nicht Vertragspartei, prüfen Angebote nicht vorab und haften nicht für deren Erfüllung.",
        ] },
        { h: "§ 3 Konto", p: [
          "(1) Für viele Funktionen ist ein kostenloses Konto nötig. Deine Angaben müssen wahr sein; Zugangsdaten sind geheim zu halten. Pro Person ist ein Konto erlaubt.",
          "(2) Du kannst dein Konto jederzeit im Konto-Bereich unter „Datenschutz & Konto“ selbst löschen. Ein laufendes Abo wird dabei beendet.",
        ] },
        { h: "§ 4 Vertragsschluss", p: [
          "(1) Die Darstellung der Tarife im Dienst ist kein bindendes Angebot. Durch Auswahl eines Tarifs, Bestätigung der Hinweise und Klick auf den Bestell-Button auf der Bezahlseite unseres Zahlungsdienstleisters Stripe gibst du ein verbindliches Angebot ab. Der Vertrag kommt zustande, sobald die Zahlung bzw. der Start der Testphase bestätigt und die Leistung freigeschaltet wird.",
          "(2) Vertragssprache ist Deutsch. Der Vertragstext wird von uns nicht gesondert gespeichert; diese AGB sind jederzeit unter pokeswipe-radar.de/rechtliches abrufbar und können dort gespeichert oder ausgedruckt werden. Die Bestellbestätigung erhältst du per E-Mail von Stripe.",
        ] },
        { h: "§ 5 Preise und Zahlung", p: [
          `(1) ${vat}`,
          "(2) Die Zahlung erfolgt über Stripe (z. B. Kreditkarte, Apple Pay, Google Pay, Klarna, SEPA – je nach Angebot auf der Bezahlseite). Abo-Entgelte werden jeweils zu Beginn eines Abrechnungszeitraums im Voraus fällig, der Boost sofort.",
          "(3) Gerät die Zahlung in Verzug oder wird sie zurückgebucht, können wir die kostenpflichtigen Funktionen bis zum Ausgleich sperren.",
        ] },
        { h: "§ 6 Kostenlose Testphase", p: [
          "(1) Das erste Abo kann einmalig 7 Tage kostenlos getestet werden (mit Einladungscode bis zu 30 Tage). Die Dauer wird vor der Bestellung angezeigt.",
          "(2) Kündigst du nicht vor Ablauf der Testphase, geht sie automatisch in das gewählte kostenpflichtige Abo über. Eine Kündigung während der Testphase ist jederzeit möglich; es entstehen dann keine Kosten.",
        ] },
        { h: "§ 7 Laufzeit und Kündigung", p: [
          "(1) Monatsabos laufen einen Monat und verlängern sich jeweils um einen weiteren Monat, wenn sie nicht bis zum Ende des laufenden Monats gekündigt werden.",
          "(2) Jahresabos laufen zunächst zwölf Monate. Werden sie nicht bis zum Ende dieser Laufzeit gekündigt, verlängern sie sich auf unbestimmte Zeit und können danach jederzeit mit einer Frist von einem Monat gekündigt werden; zu viel gezahlte Entgelte erstatten wir anteilig.",
          "(3) Die Kündigung ist jederzeit ohne Angabe von Gründen möglich – im Konto über „Abo kündigen“, über den stets erreichbaren Button „Verträge hier kündigen“ (pokeswipe-radar.de/kuendigen) oder in Textform (z. B. E-Mail an " + mail + "). Du erhältst eine Bestätigung mit Datum und Uhrzeit des Eingangs.",
          "(4) Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt für beide Seiten unberührt. Ein wichtiger Grund liegt für uns insbesondere bei schweren oder wiederholten Verstößen gegen § 8 vor.",
          "(5) Nach Vertragsende wird dein Konto automatisch auf den kostenlosen Tarif „Free“ umgestellt; deine Daten bleiben erhalten (Inhalte über den Free-Kontingenten werden nur noch angezeigt).",
        ] },
        { h: "§ 8 Pflichten der Nutzer, Community-Regeln", p: [
          "(1) Untersagt sind insbesondere: rechtswidrige, beleidigende, diskriminierende oder irreführende Inhalte; das Anbieten gefälschter Karten; Spam; Umgehung von Limits oder Sicherheitsmaßnahmen; automatisiertes Auslesen des Dienstes ohne unsere Zustimmung.",
          "(2) Für Inhalte, die du einstellst (Inserate, Beiträge, Bilder, Bewertungen), bist du selbst verantwortlich. Du räumst uns das einfache, auf die Dauer der Veröffentlichung beschränkte Recht ein, sie im Dienst anzuzeigen.",
          "(3) Bei Verstößen können wir Inhalte entfernen, Funktionen einschränken oder das Konto sperren. Wir berücksichtigen dabei deine berechtigten Interessen und informieren dich, soweit gesetzlich vorgesehen (Digital Services Act).",
          "(4) Schreiben in der Community (Pull-Wall, Kommentare, Live-Chat) setzt ein Konto mit bestätigter E-Mail-Adresse voraus. Ein automatischer Filter hält Beleidigungen, Kurz- und Einladungslinks, Telefonnummern und Zahlungsaufforderungen ohne Käuferschutz zurück; Inhalte mit mehreren Meldungen werden bis zur Prüfung ausgeblendet. Schreib-Limits und erlaubte Links richten sich nach einer Vertrauensstufe, die sich aus Kontoalter, bestätigter E-Mail, abgeschlossenen Tauschen/Käufen, Bewertungen und früheren Verstößen ergibt. Du kannst Inhalte melden und andere Nutzer blockieren.",
          "(5) Öffentliche Profile (pokeswipe-radar.de/u/…) sind nur sichtbar, wenn du sie in den Einstellungen aktivierst. Angezeigt werden Sammlername, Stadt, Profiltext, Karten-Showcase, Inserate, doppelte Karten, optional Wunschliste und eine grobe Wertstufe, Abzeichen, Bewertungen und eigene Pull-Wall-Beiträge – nie E-Mail-Adresse, Kaufpreise oder genaue Sammlungswerte.",
        ] },
        { h: "§ 8a Marktplatz mit Käuferschutz (Treuhand)", p: [
          "(1) Über den Marktplatz schließen Käufer und Verkäufer einen Kaufvertrag unmittelbar miteinander. Wir sind nicht Vertragspartei des Kaufvertrags, sondern stellen die Plattform und die treuhänderische Zahlungsabwicklung über unseren Zahlungsdienstleister Stripe Payments Europe, Ltd. bereit. Verkäufer, die Privatpersonen sind, verkaufen in der Regel ohne Widerrufsrecht und unter Ausschluss der Sachmängelhaftung, soweit gesetzlich zulässig; gewerbliche Verkäufer müssen sich als solche kennzeichnen und die Verbraucherrechte erfüllen.",
          "(2) Verkaufen mit Käuferschutz setzt ein verifiziertes Verkäuferkonto bei Stripe (Stripe Connect Express, inkl. Identitätsprüfung) voraus. Verkäufer beschreiben Karten wahrheitsgemäß (Zustand, Sprache, Echtheit) und versenden innerhalb von 7 Tagen nach Zahlungseingang mit Sendungsnummer.",
          "(3) Der Käufer zahlt Kaufpreis und Versand an uns. Wir verwahren den Betrag und zahlen ihn abzüglich der Provision an den Verkäufer aus, sobald der Käufer den Erhalt bestätigt oder 14 Tage nach Eintragen der Sendungsnummer keine Reklamation eingegangen ist. Wird nicht innerhalb von 7 Tagen versendet, erstatten wir den Betrag automatisch.",
          "(4) Bei einer Reklamation (z. B. nicht angekommen, falsche oder gefälschte Karte, erheblich schlechterer Zustand) wird die Auszahlung angehalten. Wir prüfen den Fall anhand der Angaben beider Seiten und der Sendungsverfolgung und entscheiden über Erstattung an den Käufer oder Auszahlung an den Verkäufer. Gesetzliche Ansprüche der Parteien untereinander bleiben unberührt.",
          "(5) Die Provision trägt der Verkäufer; sie beträgt im Tarif Free 6,5 %, Premium 5 % und Pro Trader (Pro-Pass) 3 % des Kaufpreises, mindestens 0,49 €, und fällt nur bei erfolgreichem Verkauf an. Für Käufer entstehen keine Gebühren. Ein verbindliches Preisangebot muss mindestens 50 % des Inseratspreises betragen; nimmt der Verkäufer es an, ist innerhalb von 48 Stunden zu zahlen.",
          "(6) Die Lieferadresse des Käufers wird dem Verkäufer erst nach erfolgreicher Zahlung und nur für die Abwicklung angezeigt. Zahlungen außerhalb des Käuferschutzes (z. B. PayPal Freunde & Familie, Vorkasse per Überweisung) sind auf eigenes Risiko und dürfen in der Community nicht beworben werden.",
          "(7) Warenkorb: Artikel mehrerer Verkäufer können in einer Zahlung gekauft werden. Dabei kommt mit jedem Verkäufer ein eigener Kaufvertrag zustande; je Verkäufer gibt es eine eigene Bestellung mit eigenem Versand, eigener Auszahlung und eigenem Käuferschutz. Mit Beginn der Zahlung werden die Artikel bis zu 80 Minuten reserviert. Ist ein Artikel bei Abschluss der Zahlung nicht mehr verfügbar, wird der Anteil dieses Verkäufers automatisch erstattet.",
          "(8) Kennzeichnung der Verkäufer: Vor dem Kauf wird angezeigt, ob ein Verkäufer als Privatperson oder als gewerblicher Händler (Unternehmer im Sinne des § 14 BGB) verkauft. Gewerbliche Händler hinterlegen ihre Anbieterangaben (Name/Firma, Anschrift, E-Mail, ggf. USt-IdNr. und Register), die Käufern angezeigt werden. Bei Käufen von gewerblichen Händlern steht Verbrauchern das gesetzliche Widerrufsrecht von 14 Tagen ab Erhalt der Ware zu; der Widerruf kann in der Bestellübersicht erklärt werden, die Erstattung erfolgt über den Käuferschutz nach Eingang der Rücksendung beim Händler. Bei Privatverkäufen besteht kein gesetzliches Widerrufsrecht.",
          "(9) Rolle als Plattform- und Zahlungsvermittler: Der Verkäufer ermächtigt uns, den Kaufpreis einschließlich Versand über unseren Zahlungsdienstleister Stripe vom Käufer einzuziehen, bis zur Freigabe treuhänderisch verwahren zu lassen und ihn abzüglich der Provision an sein Stripe-Connect-Konto weiterzuleiten. Mit erfolgreicher Zahlung über die Plattform erfüllt der Käufer seine Zahlungspflicht gegenüber dem Verkäufer. Wir übernehmen keine Gewähr für Beschaffenheit, Echtheit oder Lieferung der Ware; diese Pflichten treffen allein den Verkäufer. Unsere Leistung besteht im Bereitstellen der Plattform, der Zahlungsabwicklung über Stripe und dem Käuferschutz nach diesem Paragrafen.",
          "(10) Käuferschutz im Überblick: (a) Die Auszahlung an den Verkäufer erfolgt erst, wenn der Käufer den Erhalt in der App bestätigt, oder automatisch, wenn nach Eintragen der Sendungsnummer die Käuferschutz-Frist (Absatz 3) ohne gemeldetes Problem abgelaufen ist. (b) Über „Problem melden“ in der Bestellung kann der Käufer bis zur Auszahlung jederzeit eine Reklamation einreichen; die automatische Auszahlung wird dadurch sofort angehalten, bis wir nach Absatz 4 entschieden haben. (c) Wird eine Zahlung außerhalb der App erstattet oder bei der Bank zurückgebucht, wird die Auszahlung ebenfalls angehalten bzw. zurückgeholt. (d) Der Käuferschutz gilt nur für Zahlungen über die Plattform.",
        ] },
        { h: "§ 8b Melde- und Abhilfeverfahren (Digital Services Act)", p: [
          `(1) Zentrale Kontaktstelle für Nutzer und Behörden (Art. 11, 12 DSA) ist ${mail}; Kommunikation auf Deutsch oder Englisch. Wir antworten nicht automatisiert.`,
          "(2) Meldung rechtswidriger Inhalte (Art. 16 DSA): Jeder – auch ohne Konto per E-Mail – kann Inhalte (Beiträge, Kommentare, Chat-Nachrichten, Inserate, Profile, Deals, Radar-Pins) melden. In der App geht das über „Melden“ direkt am Inhalt. Die Meldung soll begründen, warum der Inhalt rechtswidrig ist oder gegen diese AGB verstößt, die genaue Fundstelle (Link oder Bezeichnung) enthalten sowie – außer bei Meldungen zu Straftaten gegen die sexuelle Selbstbestimmung von Kindern – Name und E-Mail-Adresse und die Erklärung, dass die Angaben nach bestem Wissen richtig und vollständig sind. Wir bestätigen den Eingang und teilen dir unsere Entscheidung mit.",
          "(3) Prüfung und Maßnahmen: Wir prüfen Meldungen zeitnah, sorgfältig und objektiv. Mögliche Maßnahmen sind Ausblenden, Entfernen, Einschränken der Sichtbarkeit, vorübergehendes Stummschalten, Entfernen von Inseraten, Sperre von Marktplatz-Funktionen oder des Kontos. Ab drei Meldungen verschiedener Nutzer wird ein Inhalt bis zur menschlichen Prüfung automatisch ausgeblendet; ein Wortfilter hält offensichtliche Verstöße bereits beim Absenden zurück. Endgültige Entscheidungen trifft ein Mensch.",
          "(4) Begründung (Art. 17 DSA): Wer von einer Maßnahme betroffen ist, erhält eine Mitteilung in der App (und per Push) mit der Entscheidung, den Tatsachen und Gründen, der Angabe, ob automatisierte Mittel beteiligt waren, der vertraglichen oder gesetzlichen Grundlage sowie den Rechtsbehelfen. Ausgenommen sind Fälle, in denen eine Benachrichtigung Ermittlungen gefährden würde oder es sich um irreführende kommerzielle Massen-Inhalte handelt.",
          `(5) Internes Beschwerdemanagement (Art. 20 DSA): Gegen eine Entscheidung – auch gegen die Ablehnung einer Meldung – kannst du innerhalb von sechs Monaten nach der Mitteilung kostenlos Widerspruch einlegen, formlos per E-Mail an ${mail} unter Angabe der Mitteilung. Der Fall wird von einer Person, die nicht an der ersten Entscheidung beteiligt war, erneut geprüft; ist der Widerspruch begründet, machen wir die Maßnahme unverzüglich rückgängig. Wir teilen dir das Ergebnis mit Begründung mit.`,
          "(6) Außergerichtliche Streitbeilegung (Art. 21 DSA): Du kannst dich zusätzlich an eine von einem Koordinator für digitale Dienste zertifizierte außergerichtliche Streitbeilegungsstelle wenden (Verzeichnis bei der Bundesnetzagentur bzw. der EU-Kommission). Wir beteiligen uns nach Treu und Glauben an solchen Verfahren; die Entscheidungen der Stelle sind nicht bindend. Der Rechtsweg zu den ordentlichen Gerichten bleibt unberührt. Die Verbraucherschlichtung nach § 14 Abs. 2 bleibt davon getrennt.",
          "(7) Missbrauch (Art. 23 DSA): Wer häufig offensichtlich rechtswidrige Inhalte einstellt oder häufig offensichtlich unbegründete Meldungen oder Beschwerden einreicht, kann nach vorheriger Warnung für einen angemessenen Zeitraum gesperrt bzw. von der Bearbeitung seiner Meldungen ausgeschlossen werden.",
          "(8) Betrugsschutz im Marktplatz: Käufe und Sofort-Kauf-Inserate mit Käuferschutz sind abhängig von der Vertrauensstufe auf Höchstbeträge begrenzt (Neu: 150 € Kauf / 250 € Inserat, Bekannt: 500 € / 750 €, Vertrauenswürdig: 2.000 € / 2.500 €, Top-Sammler: 5.000 € / 5.000 €). Bucht ein Käufer eine Zahlung bei seiner Bank zurück (Chargeback), wird die Bestellung eingefroren, eine bereits erfolgte Auszahlung bis zur Entscheidung der Bank vom Verkäuferkonto zurückgeholt und das Käuferkonto bis zur Prüfung für Treuhand-Käufe und -Verkäufe gesperrt. Entscheidet die Bank zugunsten des Verkäufers, zahlen wir den Betrag erneut aus.",
          `(9) Steuerliche Meldepflicht (DAC7): Nach dem Plattformen-Steuertransparenzgesetz melden wir Verkäufer, die in einem Kalenderjahr mindestens 30 Verkäufe abschließen oder mehr als 2.000 € erlösen, mit Name, Anschrift, Geburtsdatum, Steuer-Identifikationsnummer, ggf. USt-IdNr., IBAN sowie Umsätzen, Gebühren und Anzahl der Verkäufe je Quartal an das Bundeszentralamt für Steuern. Ab 25 Verkäufen oder 1.700 € Umsatz im Kalenderjahr weisen wir in der App rechtzeitig darauf hin, Steuer-ID und Anschrift zu hinterlegen. Wir fordern diese Angaben an und erinnern bis zu zweimal; werden sie danach nicht innerhalb von 7 Tagen nachgereicht, sind neue Verkäufe mit Käuferschutz bis zur Nachreichung gesperrt (§ 25 PStTG).`,
        ] },
        { h: "§ 9 Verfügbarkeit und Änderungen", p: [
          "(1) Wir bemühen uns um eine hohe Verfügbarkeit, können aber Unterbrechungen durch Wartung, Weiterentwicklung oder Störungen bei Dritten (z. B. Datenquellen, Hosting) nicht ausschließen.",
          "(2) Wir dürfen den Dienst weiterentwickeln, sofern die vertraglich zugesagten Kernfunktionen deines Tarifs erhalten bleiben (§ 327r BGB). Über erhebliche Änderungen informieren wir dich rechtzeitig; Preiserhöhungen für laufende Abos werden nur mit deiner Zustimmung wirksam.",
        ] },
        { h: "§ 10 Haftung", p: [
          "(1) Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz sowie im Umfang einer übernommenen Garantie.",
          "(2) Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten (Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf deren Einhaltung du regelmäßig vertrauen darfst) ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt. Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.",
          "(3) Insbesondere haften wir nicht für Entscheidungen, die du auf Grundlage von Preis-, Restock- oder KI-Angaben triffst, soweit nicht Absatz 1 greift.",
        ] },
        { h: "§ 11 Gewährleistung", p: ["Es gelten die gesetzlichen Vorschriften über digitale Produkte (§§ 327 ff. BGB)."] },
        { h: "§ 12 Widerrufsrecht", p: ["Verbrauchern steht ein gesetzliches Widerrufsrecht zu. Einzelheiten findest du in der Widerrufsbelehrung unten."] },
        { h: "§ 13 Datenschutz", p: ["Informationen zur Verarbeitung personenbezogener Daten findest du in der Datenschutzerklärung unter pokeswipe-radar.de/rechtliches#datenschutz."] },
        { h: "§ 14 Schlussbestimmungen", p: [
          "(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Bei Verbrauchern gilt diese Rechtswahl nur, soweit dadurch nicht der Schutz durch zwingende Bestimmungen des Rechts des Staates ihres gewöhnlichen Aufenthalts entzogen wird.",
          "(2) " + STREIT,
          "(3) Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen unberührt; es gelten dann die gesetzlichen Vorschriften.",
          `Stand: ${new Date(LEGAL_VERSION).toLocaleDateString("de-DE")}`,
        ] },
      ],
    },
    {
      id: "widerruf", title: "Widerrufsbelehrung",
      sections: [
        { h: "Widerrufsrecht", p: [
          "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.",
          "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.",
          `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${prov}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`,
          "Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.",
        ] },
        { h: "Folgen des Widerrufs", p: [
          "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.",
          "Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.",
        ] },
        { h: "Besondere Hinweise zu digitalen Leistungen (Abos, Boost, digitale Inhalte)", p: [
          "Abos (Premium, Pro Trader) und der Inserat-Boost sind digitale Dienstleistungen. Sie starten auf Ihren ausdrücklichen Wunsch sofort nach der Bestellung – also vor Ablauf der Widerrufsfrist. Diesen Wunsch und Ihre Kenntnis der folgenden Hinweise bestätigen Sie vor der Bestellung.",
          "Erlöschen bei Dienstleistungen: Das Widerrufsrecht erlischt bei einem Vertrag über die Erbringung von Dienstleistungen, die zur Zahlung eines Preises verpflichten, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung der Dienstleistung erst begonnen haben, nachdem Sie dazu Ihre ausdrückliche Zustimmung gegeben haben und gleichzeitig Ihre Kenntnis davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei vollständiger Vertragserfüllung durch uns verlieren (§ 356 Abs. 4 BGB). Beispiel: ein Boost, dessen Laufzeit vollständig abgelaufen ist.",
          "Erlöschen bei digitalen Inhalten: Bei einem Vertrag über die Bereitstellung von nicht auf einem körperlichen Datenträger befindlichen digitalen Inhalten erlischt das Widerrufsrecht, wenn wir mit der Vertragserfüllung begonnen haben, nachdem Sie ausdrücklich zugestimmt haben, dass wir mit der Vertragserfüllung vor Ablauf der Widerrufsfrist beginnen, Sie Ihre Kenntnis davon bestätigt haben, dass durch Ihre Zustimmung mit Beginn der Vertragserfüllung Ihr Widerrufsrecht erlischt, und wir Ihnen eine Bestätigung gemäß § 312f BGB zur Verfügung gestellt haben (§ 356 Abs. 5 BGB).",
          "Wertersatz bei Abos: Widerrufen Sie ein bereits laufendes Abo innerhalb der Widerrufsfrist, erstatten wir den Betrag abzüglich des Anteils für die bereits genutzte Zeit. Während einer kostenlosen Testphase fallen keine Kosten an.",
        ] },
      ],
    },
    {
      id: "formular", title: "Muster-Widerrufsformular",
      sections: [{ p: [
        "(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)",
        `An: ${prov}`,
        "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)",
        "– Bestellt am (*)/erhalten am (*)",
        "– Name des/der Verbraucher(s)",
        "– Anschrift des/der Verbraucher(s)",
        "– Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)",
        "– Datum",
        "(*) Unzutreffendes streichen.",
      ] }],
    },
  ];
}

export async function getLegalPayload() {
  const { operator, legacy, updatedAt } = await getOperator();
  const documents = withPrivacyPointer(buildDocuments(operator, legacy));
  return {
    impressum: impressumText(operator, legacy),
    operatorComplete: operatorComplete(operator) || Boolean(legacy),
    version: LEGAL_VERSION,
    updatedAt,
    documents,
    links: { all: "/rechtliches", cancel: "/kuendigen", privacy: "/datenschutz" },
  };
}

/**
 * Es gibt genau EINE verbindliche Datenschutzerklärung: die vollständige Fassung unter /datenschutz (server/privacy.ts).
 * Auf /rechtliches (Anker #datenschutz) steht deshalb nur ein Verweis darauf – zwei unterschiedlich ausführliche Texte
 * könnten sich widersprechen.
 */
export function withPrivacyPointer(docs: LegalDoc[]): LegalDoc[] {
  return docs.map((d) => d.id !== "datenschutz" ? d : {
    ...d,
    sections: [{ h: "", p: [
      `Die vollständige Datenschutzerklärung nach Art. 13 und 14 DSGVO (Verantwortlicher, alle Dienstleister mit Sitz, Rechtsgrundlagen, Drittlandübermittlung, Speicherdauer und deine Rechte) findest du unter ${SITE()}/datenschutz.`,
    ] }],
  });
}

// ---------------------------------------------------------------------------
// E-Mail-Bestätigung (optional): Resend-API, aktiv sobald RESEND_API_KEY und MAIL_FROM gesetzt sind
// ---------------------------------------------------------------------------
export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && /@/.test(String(process.env.MAIL_FROM || "")));
}
export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject: subject.slice(0, 200), text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    console.warn("E-Mail nicht gesendet", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Kündigung (§ 312k BGB)
// ---------------------------------------------------------------------------
const fmtDateTime = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "medium" });
const fmtDay = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long" });

function confirmationText(r: { reference: string; createdAt: Date; name: string; email: string; contractRef: string; kind: string; reason: string; timing: string; requestedDate: string | null; effectiveAt: Date | null; statusText: string }) {
  return [
    `Kündigungsbestätigung – ${BRAND}`,
    "",
    `Kündigungsnummer: ${r.reference}`,
    `Eingegangen am: ${fmtDateTime(r.createdAt)} Uhr (deutsche Zeit)`,
    "",
    `Name: ${r.name}`,
    `E-Mail: ${r.email}`,
    r.contractRef ? `Vertrag/Kundennummer: ${r.contractRef}` : "",
    `Art der Kündigung: ${r.kind === "ausserordentlich" ? "außerordentlich (aus wichtigem Grund)" : "ordentlich"}`,
    r.kind === "ausserordentlich" && r.reason ? `Kündigungsgrund: ${r.reason}` : "",
    `Gewünschter Zeitpunkt: ${r.timing === "date" && r.requestedDate ? `zum ${fmtDay(new Date(r.requestedDate))} bzw. zum nächstmöglichen Zeitpunkt danach` : "zum nächstmöglichen Zeitpunkt"}`,
    r.effectiveAt ? `Vertragsende: ${fmtDay(r.effectiveAt)}` : "",
    "",
    r.statusText,
    "",
    "Bitte bewahre diese Bestätigung auf.",
    `${SITE()}/kuendigen`,
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Wendet die Kündigung auf das Stripe-Abo an; Jahresabos in der Verlängerung enden mit Monatsfrist. */
async function applyCancellation(profile: typeof profiles.$inferSelect, kind: string) {
  const s = stripe();
  if (!s || !profile.stripeSubscriptionId) return { applied: false, effectiveAt: profile.planUntil, note: "" };
  let sub = await s.subscriptions.retrieve(profile.stripeSubscriptionId);
  if (!["active", "trialing", "past_due"].includes(sub.status)) return { applied: false, effectiveAt: null, note: "" };
  const item: any = sub.items?.data?.[0];
  const periodEndTs = Number((sub as any).current_period_end ?? item?.current_period_end ?? 0);
  const periodStartTs = Number((sub as any).current_period_start ?? item?.current_period_start ?? 0);
  const yearly = item?.price?.recurring?.interval === "year";
  // Jahresabo nach der ersten Laufzeit (§ 309 Nr. 9 BGB): Ende spätestens einen Monat nach Zugang der Kündigung
  const inRenewal = yearly && sub.start_date && periodStartTs - Number(sub.start_date) > 300 * 86400;
  const monthFromNow = Math.floor(Date.now() / 1000) + 30 * 86400;
  let note = "";
  if (inRenewal && periodEndTs > monthFromNow) {
    sub = await s.subscriptions.update(sub.id, { cancel_at: monthFromNow, proration_behavior: "none" } as any);
    note = "Jahresabo in der Verlängerung: endet mit Monatsfrist – anteilige Erstattung des Restzeitraums erforderlich.";
  } else {
    sub = await s.subscriptions.update(sub.id, { cancel_at_period_end: true });
  }
  await applySubscription(profile.userId, sub);
  const cancelAt = Number((sub as any).cancel_at || periodEndTs);
  return { applied: true, effectiveAt: cancelAt ? new Date(cancelAt * 1000) : profile.planUntil, note: kind === "ausserordentlich" ? `${note} Außerordentliche Kündigung – Grund prüfen.`.trim() : note };
}

const CONFIRM_TTL_MS = 30 * 86400_000;
const UNVERIFIED_STATUS_TEXT = "Deine Kündigung ist eingegangen. Besteht zu dieser E-Mail-Adresse ein Abo, senden wir an die im Konto hinterlegte Adresse einen Link, mit dem du die Kündigung bestätigst – danach endet das Abo zum nächstmöglichen Zeitpunkt. Schneller geht es, wenn du dich anmeldest und hier erneut kündigst. Hast du ein Abo mit einer anderen Adresse abgeschlossen, wiederhole die Kündigung bitte mit dieser Adresse oder antworte uns per E-Mail – wir ordnen sie dann manuell zu.";
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Wendet die Kündigung bei Stripe an und übersetzt das Ergebnis in den gespeicherten Status. */
async function applyCancellationSafely(profile: typeof profiles.$inferSelect, kind: string) {
  let status = "no_contract", effectiveAt: Date | null = null, adminNote = "";
  try {
    const r = await applyCancellation(profile, kind);
    if (r.applied) { status = kind === "ausserordentlich" || r.note ? "review" : "applied"; effectiveAt = r.effectiveAt ? new Date(r.effectiveAt) : null; adminNote = r.note; }
    else if (profile.planUntil && profile.planUntil.getTime() > Date.now() && profile.plan !== "free") { status = "review"; effectiveAt = profile.planUntil; }
  } catch (e) {
    log.error("legal", "Kündigung konnte nicht automatisch angewendet werden", { err: e });
    status = "review"; adminNote = "Automatische Kündigung bei Stripe fehlgeschlagen – bitte manuell prüfen.";
  }
  return { status, effectiveAt, adminNote };
}

const newReference = () => `K-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

// ---------------------------------------------------------------------------
// Öffentliche Seiten: /rechtliches und /kuendigen
// ---------------------------------------------------------------------------
const LEGAL_CSS = `<style>.doc h2{margin-top:28px}.doc h3{font-size:14px;margin:18px 0 6px;font-weight:900}.doc p{font-size:13px;color:#cbd5e1;margin:6px 0;white-space:pre-line}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.toc a{background:#1e293b;border-radius:12px;padding:6px 10px;font-size:12px;font-weight:800;text-decoration:none}
.cancel-cta{display:inline-block;background:#f43f5e;color:#fff;font-weight:900;border-radius:14px;padding:12px 18px;text-decoration:none;font-size:14px}
label{display:block;font-size:12px;font-weight:800;margin:12px 0 4px;color:#e2e8f0}input,select,textarea{width:100%;background:#0b1220;border:1px solid #334155;border-radius:12px;padding:10px 12px;color:#fff;font:inherit;font-size:14px}
.radio{display:flex;gap:8px;align-items:flex-start;font-weight:600;font-size:13px;margin:6px 0}.radio input{width:auto;margin-top:3px}
button.go{margin-top:18px;width:100%;background:#f43f5e;color:#fff;border:0;border-radius:14px;padding:14px;font-weight:900;font-size:15px;cursor:pointer}
button.go:disabled{opacity:.6}.err{color:#fda4af;font-size:13px;min-height:18px;margin-top:8px}.ok{background:#052e1a;border:2px solid #10b981;border-radius:18px;padding:16px;white-space:pre-line;font-size:13px}</style>`;

export function legalPage(docs: LegalDoc[]) {
  return `${LEGAL_CSS}<div class="card doc"><h1>Rechtliches</h1>
    <div class="toc">${docs.map((d) => `<a href="#${d.id}">${h(d.title)}</a>`).join("")}<a href="/kuendigen" style="background:#f43f5e;color:#fff">Verträge hier kündigen</a></div>
    ${docs.map((d) => `<section id="${d.id}"><h2>${h(d.title)}</h2>${d.sections.map((s) => `${s.h ? `<h3>${h(s.h)}</h3>` : ""}${s.p.map((x) => `<p>${h(x)}</p>`).join("")}`).join("")}</section>`).join("")}
    <p style="margin-top:24px"><a class="cancel-cta" href="/kuendigen">Verträge hier kündigen</a></p></div>`;
}

function cancelPage() {
  return `${LEGAL_CSS}<div class="card"><h1>Verträge hier kündigen</h1>
  <p class="muted">Kündige dein Abo (Premium oder Pro Trader) – ohne Anmeldung, ohne Angabe von Gründen. Du erhältst sofort eine Bestätigung mit Datum und Uhrzeit des Eingangs.</p>
  <form id="kf" novalidate>
    <label>Art der Kündigung</label>
    <div class="radio"><input type="radio" name="kind" value="ordentlich" id="k1" checked><label for="k1" style="margin:0;font-weight:600">Ordentliche Kündigung</label></div>
    <div class="radio"><input type="radio" name="kind" value="ausserordentlich" id="k2"><label for="k2" style="margin:0;font-weight:600">Außerordentliche Kündigung (aus wichtigem Grund)</label></div>
    <div id="reasonBox" hidden><label for="reason">Kündigungsgrund</label><textarea id="reason" rows="3" maxlength="1000"></textarea></div>
    <label for="name">Vor- und Nachname</label><input id="name" autocomplete="name" maxlength="120" required>
    <label for="email">E-Mail-Adresse deines Kontos</label><input id="email" type="email" autocomplete="email" maxlength="160" required>
    <label for="contract">Vertrag / Kundennummer (optional)</label><input id="contract" maxlength="120" placeholder="z. B. „Premium Monatsabo“ oder Rechnungsnummer">
    <label>Kündigungszeitpunkt</label>
    <div class="radio"><input type="radio" name="timing" value="next" id="t1" checked><label for="t1" style="margin:0;font-weight:600">Zum nächstmöglichen Zeitpunkt</label></div>
    <div class="radio"><input type="radio" name="timing" value="date" id="t2"><label for="t2" style="margin:0;font-weight:600">Zu einem bestimmten Datum</label></div>
    <div id="dateBox" hidden><input id="date" type="date"></div>
    <label for="confirmEmail">E-Mail für die Bestätigung (falls abweichend, optional)</label><input id="confirmEmail" type="email" maxlength="160">
    <button class="go" type="submit" id="go">Jetzt kündigen</button>
    <p class="err" id="err" role="alert"></p>
  </form>
  <div id="done" hidden></div>
  <p class="muted" style="margin-top:16px">Alternativ: im Konto unter „Abo kündigen“ oder per E-Mail an die im <a href="/rechtliches#impressum">Impressum</a> genannte Adresse. <a href="/rechtliches#agb">AGB</a> · <a href="/rechtliches#widerruf">Widerrufsbelehrung</a></p>
  </div>
<script src="/js/kuendigen.js" defer></script>`;
}

export function registerLegal(app: any, hlp: { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> }) {
  const { auth, adminOnly, body } = hlp;

  app.get("/api/legal", async (c: any) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(await getLegalPayload());
  });

  app.get("/api/admin/legal", auth, adminOnly, async (c: any) => {
    const { operator, legacy, updatedAt } = await getOperator();
    return c.json({ operator, legacy, updatedAt, complete: operatorComplete(operator), mail: mailConfigured() });
  });

  app.put("/api/admin/legal", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const prev = await loadSaved();
    const operator = b.operator ? cleanOperator(b.operator) : cleanOperator(prev.operator || {});
    const impressum = b.impressum !== undefined ? str(b.impressum, 4000) : str(prev.impressum, 4000);
    const saved = { operator, impressum, updatedAt: new Date().toISOString() };
    await getStore("app-config").setJSON("legal", saved);
    return c.json({ ...saved, complete: operatorComplete(operator) });
  });

  // Datenschutzerklärung (Art. 13/14 DSGVO) – Verantwortlicher aus den Impressums-Daten des Admins.
  // Muss VOR den Kurz-Weiterleitungen (/impressum, /agb, … /datenschutz → /rechtliches#…) stehen: die erste passende Route gewinnt.
  app.get("/datenschutz", async (c: any) => {
    const { operator, legacy } = await getOperator();
    const doc = buildPrivacyPolicy(operator, { complete: operatorComplete(operator), legacy });
    c.header("Cache-Control", "public, max-age=300");
    return c.html(pageShell({
      title: `Datenschutzerklärung | ${BRAND}`,
      description: `Datenschutzerklärung von ${BRAND}: welche Daten wir verarbeiten, Dienstleister, Speicherdauer und deine Rechte nach der DSGVO.`,
      canonical: `${SITE()}/datenschutz`, body: `${LEGAL_CSS}${privacyPage(doc)}`,
    }));
  });

  app.get("/rechtliches", async (c: any) => {
    const p = await getLegalPayload();
    c.header("Cache-Control", "public, max-age=300");
    return c.html(pageShell({
      title: `Impressum, Datenschutz, AGB & Widerrufsbelehrung | ${BRAND}`,
      description: `Impressum, Datenschutzerklärung, Allgemeine Geschäftsbedingungen, Widerrufsbelehrung und Muster-Widerrufsformular von ${BRAND}.`,
      canonical: `${SITE()}/rechtliches`, body: legalPage(p.documents),
    }));
  });
  for (const [path, anchor] of [["/impressum", "impressum"], ["/agb", "agb"], ["/widerruf", "widerruf"], ["/datenschutz", "datenschutz"]]) {
    app.get(path, (c: any) => c.redirect(`/rechtliches#${anchor}`, 301));
  }

  app.get("/kuendigen", (c: any) => {
    c.header("Cache-Control", "public, max-age=600");
    return c.html(pageShell({
      title: `Verträge hier kündigen | ${BRAND}`,
      description: `Abo von ${BRAND} online kündigen – ohne Anmeldung, mit sofortiger Eingangsbestätigung.`,
      canonical: `${SITE()}/kuendigen`, body: cancelPage(),
    }));
  });

  // Kündigungserklärung: wird immer angenommen und bestätigt; Zuordnung zum Konto über Login oder E-Mail-Adresse
  app.post("/api/legal/cancel", async (c: any) => {
    if (!(await rateLimit(`cancel:${clientIp(c)}`, 6, 3600_000))) return c.json({ error: "Zu viele Versuche – bitte in einer Stunde erneut oder per E-Mail kündigen." }, 429);
    const b = await body(c);
    const name = str(b.name, 120), email = str(b.email, 160).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Bitte Name und eine gültige E-Mail-Adresse angeben." }, 400);
    const kind = b.kind === "ausserordentlich" ? "ausserordentlich" : "ordentlich";
    const reason = str(b.reason, 1000);
    if (kind === "ausserordentlich" && !reason) return c.json({ error: "Bitte gib für die außerordentliche Kündigung den Grund an." }, 400);
    const timing = b.timing === "date" ? "date" : "next";
    const requestedDate = timing === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(b.requestedDate || "")) ? String(b.requestedDate) : null;
    const contractRef = str(b.contractRef, 120);
    const confirmEmail = str(b.confirmEmail, 160).toLowerCase();

    const viewer = await verifyIdentityToken(c).catch(() => null);
    let [profile] = viewer ? await db.select().from(profiles).where(eq(profiles.userId, viewer.id)).limit(1) : [];
    const verified = Boolean(profile);
    // Ohne Anmeldung nur Zuordnung über die E-Mail – angewendet wird erst nach Klick auf den Bestätigungslink an die
    // Konto-Adresse. So kann niemand fremde Abos kündigen, nur weil er die E-Mail-Adresse kennt.
    if (!profile) [profile] = await db.select().from(profiles).where(sql`lower(${profiles.email}) = ${email}`).limit(1);

    let status = "no_contract", effectiveAt: Date | null = null, adminNote = "";
    let confirmToken: string | null = null;
    if (profile && verified) {
      const r = await applyCancellationSafely(profile, kind);
      status = r.status; effectiveAt = r.effectiveAt; adminNote = r.adminNote;
    } else if (profile) {
      status = "pending_confirmation";
      confirmToken = randomBytes(24).toString("hex");
    }
    if (requestedDate && effectiveAt && new Date(requestedDate).getTime() > effectiveAt.getTime()) {
      // Wunschtermin nach dem nächstmöglichen Ende: Abo endet trotzdem zum Laufzeitende (früher ist für dich günstiger)
      adminNote = `${adminNote} Wunschtermin ${requestedDate} liegt nach dem Laufzeitende.`.trim();
    }

    const reference = newReference();
    const [row] = await db.insert(cancellations).values({
      reference, userId: profile?.userId ?? null, name, email, contractRef, kind, reason: [reason, adminNote].filter(Boolean).join(" | ").slice(0, 1500),
      timing, requestedDate, status, effectiveAt, verified, confirmTokenHash: confirmToken ? tokenHash(confirmToken) : null,
    }).returning();

    // Ohne Anmeldung verrät die Antwort nicht, ob zu der Adresse ein Abo besteht (gleicher Text für alle Fälle)
    const statusText = verified
      ? (status === "applied"
        ? `Deine Kündigung ist wirksam. Dein Abo endet am ${effectiveAt ? fmtDay(effectiveAt) : "Ende des bezahlten Zeitraums"}; bis dahin bleiben alle Vorteile aktiv. Danach wird nichts mehr abgebucht.`
        : status === "review"
          ? `Deine Kündigung ist eingegangen und wurde vorgemerkt${effectiveAt ? ` (Vertragsende spätestens ${fmtDay(effectiveAt)})` : ""}. Wir prüfen sie und melden uns, falls etwas fehlt.`
          : "Deine Kündigung ist eingegangen. Zu deinem Konto haben wir kein laufendes Abo gefunden – es wird nichts abgebucht.")
      : UNVERIFIED_STATUS_TEXT;
    const confirmation = confirmationText({ reference, createdAt: row.createdAt, name, email, contractRef, kind, reason, timing, requestedDate, effectiveAt: verified ? effectiveAt : null, statusText });

    // Bestätigung in Textform (Eingangsnachweis): E-Mail (falls eingerichtet) + Mitteilung im Konto
    if (!mailConfigured()) console.info(`Kündigung ${reference} (${status}) gespeichert – E-Mail-Versand nicht eingerichtet (RESEND_API_KEY/MAIL_FROM fehlen); Bestätigung auf der Seite und im Konto.`);
    const mailed = await sendMail(confirmEmail || email, `Kündigungsbestätigung ${reference} – ${BRAND}`, confirmation);
    if (confirmEmail && confirmEmail !== email) await sendMail(email, `Kündigungsbestätigung ${reference} – ${BRAND}`, confirmation);
    if (profile && verified) {
      await notify(profile.userId, "📄 Kündigung eingegangen", `Nr. ${reference}. ${statusText}`.slice(0, 400), "/").catch(() => {});
    } else if (profile && confirmToken) {
      // Bestätigungslink geht ausschließlich an die im Konto hinterlegte Adresse und in die Mitteilungen des Kontos
      const link = `${SITE()}/api/legal/cancel/confirm?ref=${encodeURIComponent(reference)}&token=${confirmToken}`;
      await sendMail(profile.email, `Kündigung ${reference} bestätigen – ${BRAND}`,
        `Hallo ${profile.displayName},\n\nüber „Verträge hier kündigen“ wurde am ${fmtDateTime(row.createdAt)} eine Kündigung deines Abos eingereicht (Nr. ${reference}).\n\nWarst du das? Dann bestätige die Kündigung hier:\n${link}\n\nDer Link ist 30 Tage gültig. Warst du das nicht, musst du nichts tun – dein Abo läuft unverändert weiter.\n\n${BRAND}`).catch(() => false);
      await notify(profile.userId, "📄 Kündigung bestätigen?", `Über „Verträge hier kündigen“ wurde eine Kündigung deines Abos eingereicht (Nr. ${reference}). Tippe hier, um sie zu bestätigen. Warst du das nicht, musst du nichts tun.`, link.replace(SITE(), "")).catch(() => {});
    }
    const { operator } = await getOperator();
    if (operator.email && (status !== "applied" || kind === "ausserordentlich")) {
      await sendMail(operator.email, `Kündigung ${reference} prüfen (${status})`, `${confirmation}\n\nInterner Status: ${status}${verified ? "" : " (ohne Anmeldung – wird nach Bestätigung über den Link an die Konto-E-Mail angewendet; sonst bitte manuell prüfen)"}\nHinweis: ${adminNote || "-"}`);
    }
    return c.json({ ok: true, reference, status: verified ? status : "received", effectiveAt: verified ? effectiveAt : null, confirmation, mailed });
  });

  // Bestätigungslink aus der E-Mail: GET zeigt nur eine Seite mit Button (E-Mail-Scanner öffnen Links automatisch),
  // erst der POST wendet die Kündigung an.
  app.get("/api/legal/cancel/confirm", async (c: any) => {
    const ref = str(c.req.query("ref"), 40), token = str(c.req.query("token"), 100);
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    const valid = /^K-\d{8}-[0-9A-F]{6}$/.test(ref) && /^[0-9a-f]{48}$/.test(token);
    return c.html(pageShell({
      title: `Kündigung bestätigen | ${BRAND}`, description: "Kündigung bestätigen", canonical: `${SITE()}/kuendigen`,
      body: `${LEGAL_CSS}<div class="card"><h1>Kündigung bestätigen</h1>${valid
        ? `<p>Kündigung Nr. <strong>${h(ref)}</strong>. Mit dem Klick wird dein Abo zum nächstmöglichen Zeitpunkt beendet; bis dahin bleiben alle Vorteile aktiv.</p>
          <form id="cc" data-ref="${h(ref)}" data-token="${h(token)}"><button class="go" type="submit" id="go">Kündigung jetzt bestätigen</button><p class="err" id="err" role="alert"></p></form><div id="done" hidden></div>`
        : `<p class="err">Dieser Link ist ungültig. Bitte nutze den vollständigen Link aus der E-Mail oder kündige über <a href="/kuendigen">Verträge hier kündigen</a>.</p>`}</div>
        <script src="/js/kuendigen-bestaetigen.js" defer></script>`,
    }));
  });

  app.post("/api/legal/cancel/confirm", async (c: any) => {
    if (!(await rateLimit(`cancel-confirm:${clientIp(c)}`, 20, 3600_000))) return c.json({ error: "Zu viele Versuche – bitte später erneut." }, 429);
    const b = await body(c);
    const ref = str(b.ref, 40), token = str(b.token, 100);
    if (!/^K-\d{8}-[0-9A-F]{6}$/.test(ref) || !/^[0-9a-f]{48}$/.test(token)) return c.json({ error: "Ungültiger Link." }, 400);
    const [row] = await db.select().from(cancellations).where(eq(cancellations.reference, ref)).limit(1);
    if (!row || !row.confirmTokenHash || !row.userId || !sameHash(row.confirmTokenHash, tokenHash(token))) return c.json({ error: "Ungültiger oder abgelaufener Link." }, 404);
    if (row.confirmedAt || row.status !== "pending_confirmation") return c.json({ ok: true, alreadyConfirmed: true, status: row.status, message: "Diese Kündigung wurde bereits bestätigt." });
    if (Date.now() - new Date(row.createdAt).getTime() > CONFIRM_TTL_MS) return c.json({ error: "Der Link ist abgelaufen. Bitte kündige erneut über „Verträge hier kündigen“." }, 410);
    // Genau einmal anwenden (Doppelklick)
    const [claimed] = await db.update(cancellations).set({ confirmedAt: new Date(), status: "review" })
      .where(and(eq(cancellations.id, row.id), eq(cancellations.status, "pending_confirmation"))).returning();
    if (!claimed) return c.json({ ok: true, alreadyConfirmed: true, message: "Diese Kündigung wurde bereits bestätigt." });
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, row.userId)).limit(1);
    const r = profile ? await applyCancellationSafely(profile, row.kind) : { status: "no_contract", effectiveAt: null as Date | null, adminNote: "" };
    await db.update(cancellations).set({ status: r.status, effectiveAt: r.effectiveAt, verified: true, reason: [row.reason, r.adminNote].filter(Boolean).join(" | ").slice(0, 1500) })
      .where(eq(cancellations.id, row.id));
    const message = r.status === "applied"
      ? `Deine Kündigung ist wirksam. Dein Abo endet am ${r.effectiveAt ? fmtDay(r.effectiveAt) : "Ende des bezahlten Zeitraums"}; bis dahin bleiben alle Vorteile aktiv.`
      : r.status === "review" ? "Deine Kündigung ist bestätigt und vorgemerkt. Wir prüfen sie und melden uns, falls etwas fehlt."
        : "Deine Kündigung ist bestätigt. Zu deinem Konto haben wir kein laufendes Abo gefunden – es wird nichts abgebucht.";
    if (profile) {
      await notify(profile.userId, "📄 Kündigung bestätigt", `Nr. ${ref}. ${message}`.slice(0, 400), "/").catch(() => {});
      await sendMail(profile.email, `Kündigung ${ref} bestätigt – ${BRAND}`, `${message}\n\nKündigungsnummer: ${ref}\nBestätigt am: ${fmtDateTime(new Date())}\n\n${BRAND}`).catch(() => false);
    }
    return c.json({ ok: true, status: r.status, effectiveAt: r.effectiveAt, message });
  });

  app.get("/api/admin/cancellations", auth, adminOnly, async (c: any) => {
    const list = await db.select().from(cancellations).orderBy(desc(cancellations.createdAt)).limit(200);
    const [r] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'review' OR (status = 'pending_confirmation' AND created_at < now() - interval '3 days'))::int AS review FROM cancellations`));
    return c.json({ cancellations: list, review: Number(r?.review ?? 0) });
  });

  app.patch("/api/admin/cancellations/:id", auth, adminOnly, async (c: any) => {
    const id = Number(c.req.param("id"));
    const b = await body(c);
    const status = ["received", "applied", "no_contract", "review", "pending_confirmation"].includes(b.status) ? b.status : null;
    if (!Number.isInteger(id) || !status) return c.json({ error: "Ungültig" }, 400);
    const [before] = await db.select().from(cancellations).where(eq(cancellations.id, id)).limit(1);
    if (!before) return c.json({ error: "Nicht gefunden" }, 404);
    // Admin bestätigt eine nicht angemeldete Kündigung nach eigener Prüfung → jetzt bei Stripe anwenden
    if (b.apply === true && before.userId && ["pending_confirmation", "review"].includes(before.status)) {
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, before.userId)).limit(1);
      const r = profile ? await applyCancellationSafely(profile, before.kind) : { status: "no_contract", effectiveAt: null as Date | null, adminNote: "" };
      const [row] = await db.update(cancellations).set({ status: r.status, effectiveAt: r.effectiveAt, confirmedAt: before.confirmedAt ?? new Date() }).where(eq(cancellations.id, id)).returning();
      if (profile) await notify(profile.userId, "📄 Kündigung bearbeitet", `Nr. ${before.reference}: ${r.status === "applied" ? `Dein Abo endet am ${r.effectiveAt ? fmtDay(r.effectiveAt) : "Ende des bezahlten Zeitraums"}.` : "Wir haben deine Kündigung geprüft."}`, "/").catch(() => {});
      return c.json(row);
    }
    const [row] = await db.update(cancellations).set({ status }).where(eq(cancellations.id, id)).returning();
    return row ? c.json(row) : c.json({ error: "Nicht gefunden" }, 404);
  });
}
