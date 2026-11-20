// Pro-Video-Vorlagen für den Auto-Reels-Generator: 5 Szenen statt einer durchgehenden Bildschirmaufnahme.
// Reines Daten-/Logik-Modul ohne DOM-Zugriff (wird vom Generator, vom Compositor und von den Tests genutzt).
//
// Szenen (Zeiten ergeben sich aus den Satz-Zeitstempeln der Sprecherin, Ziel 20–30 s):
//   1 Cover/Hook (≈ 0–2 s)  · 2 Fokus-Zoom auf die echte App (≈ 2–9 s) · 3 Nutzen mit Feature-Badges (≈ 9–17 s)
//   4 Vertrauen & Praxis-Mehrwert (≈ 17–23 s) · 5 Call-to-Action-Endscreen (≈ 23–26 s)
// Jede Vorlage hat genau 5 Sprecher-Sätze – einen pro Szene. "say" wird gesprochen, "show" als Untertitel gezeigt.

import { countWords } from "./reel-scripts.js";

export const PRO_SCENES = ["cover", "focus", "benefit", "trust", "cta"];
/** Wortlimit des kompletten Voiceovers (≈ 2,4–2,8 Wörter/s → 20–30 s). Server erlaubt höchstens 72. */
export const PRO_WORDS = Object.freeze([52, 72]);
export const PRO_MIN_S = 20, PRO_MAX_S = 30;
/** Make.com Core: 100 MB pro Datei – wir bleiben garantiert darunter. */
export const SAFE_MB = 95;
export const MB = 1024 * 1024;
export const PRO_BITRATES = [14, 15, 16];
export const PRO_FPS = [30, 60];
export const AUDIO_KBPS = 192;
export const DOMAIN = "pokeswipe-radar.de";
export const CTA_TEXT = "Jetzt kostenlos testen auf pokeswipe-radar.de";
/** Vorlauf vor dem ersten Wort und sanftes Ausblenden nach dem letzten Wort (s). */
export const PRO_LEAD = 0.35, END_FADE = 0.8;
/** Gesamtpolster um die reine Sprechzeit. */
export const PRO_PAD = PRO_LEAD + END_FADE;

const CTA_LINE = { say: "Jetzt kostenlos testen auf PokeSwipe Radar Punkt de!", show: "Jetzt kostenlos testen auf pokeswipe-radar.de!" };

// Alleinstellungsmerkmale gegenüber klassischen Preis-Apps (aus den echten Funktionen der App)
export const USP = Object.freeze([
  "Cardmarket (EUR) + TCGplayer (USD) live",
  "55.000+ Karten DE · EN · JP + Sealed",
  "Swipe-Entdecker statt Preislisten",
  "Marktplatz mit Käuferschutz",
  "Portfolio, Wunschliste & Release-Kalender",
]);

// ---------------------------------------------------------------------------------------------------------------
// Hook-Presets (format "hook4"): 4 Szenen, 15–17 s, 8 Mbit/s – gebaut auf Watchtime, Kommentare und App-Besuche.
//   0–3 s  hook   Kontrast-Banner + konkrete Euro-Zahl, Sprecherin startet sofort (kein Logo-Intro)
//   3–8 s  proof  echte App-Oberfläche im Smartphone + animierte UI-Overlays (Flip-Radar / Scanner / Swipe)
//   8–13 s usp    Abgrenzung zu Preis-Tracker-Apps: kein Download, aktives Deals-Finden & Tauschen
//   13–17 s ask   Domain groß + echte Sammler-Frage als Kommentar-Trigger (kein „Like & Abo“)
// Szenen folgen den echten Satz-Zeitstempeln der Sprecherin (Bild und Wort bleiben synchron); SEGMENTS ist der
// Soll-Zeitplan, gegen den jede Aufnahme geprüft und im Metadaten-Feld segments_json protokolliert wird.
// ---------------------------------------------------------------------------------------------------------------
export const HOOK4_SCENES = ["hook", "proof", "usp", "ask"];
/** Soll-Grenzen der 4 Szenen in Sekunden (Ende von hook, proof, usp, ask). */
export const HOOK4_SEGMENTS = Object.freeze([3, 8, 13, 17]);
/** Nischen-Hashtags (max. 3, keine Spam-Tags wie #fyp/#viral/#foryou). */
export const HOOK4_HASHTAGS = Object.freeze(["#pokemontcgdeutsch", "#pokemonkarten", "#pokémonsammler"]);
export const SPAM_TAGS = Object.freeze(["#fyp", "#foryou", "#foryoupage", "#viral", "#fy", "#trending", "#explore", "#fürdich", "#fyp"]);
/** Höchstes ElevenLabs-Tempo (API erlaubt 0,7–1,2) – nur die kurzen Hook-Presets nutzen mehr als 1,12. */
export const SPEED_CAP = 1.2;
const SAY_DOMAIN = "PokeSwipe Radar Punkt de";

function HOOK4_TEMPLATES() {
  const base = { format: "hook4", seconds: [15, 17], mbit: 8, cbr: true, maxSpeed: SPEED_CAP, segments: HOOK4_SEGMENTS, hashtags: HOOK4_HASHTAGS };
  return [
    {
      ...base,
      key: "fomo", label: "Hook · Schnäppchen-FOMO (Live Flip-Radar)", choreo: "flipdeal", tab: "flip", visual: "flip",
      title: "Hör auf, zu viel für Pokémon-Karten zu zahlen – Live Flip-Radar",
      accent: "#34d399",
      hooks: [{ badge: "LIVE FLIP-RADAR", cover: "HÖR AUF ZU VIEL ZU ZAHLEN 🛑" }],
      hookBadge: { label: "Marktwert", from: "65 €", to: "29 €", tag: "Deal" },
      lines: [
        { say: "Hör auf, Pokémon-Karten zum vollen Preis zu kaufen – andere snipen sie gerade für die Hälfte." },
        { say: "Der Live-Flip-Radar auf PokeSwipe Radar scannt Angebote in Echtzeit und zeigt dir sofort, wo Karten massiv unter Marktwert gelistet sind." },
        { say: "Ein Klick und du sicherst dir das Schnäppchen, bevor es andere überhaupt sehen." },
        { say: `Kostenlos testen auf ${SAY_DOMAIN} – welche Karte soll ich als Nächstes für euch im Radar checken? Schreib’s in die Kommentare!`,
          show: "Kostenlos testen auf pokeswipe-radar.de – welche Karte soll ich als Nächstes für euch im Radar checken? Schreib’s in die Kommentare!" },
      ],
      proof: { title: "📡 Live Flip-Radar", deals: [
        ["Pikachu ex", "Stürmische Funken", 65, 29], ["Mega-Gardevoir ex", "Mega-Entwicklung", 48, 27], ["Latias ex", "Stürmische Funken", 39, 22],
      ] },
      usp: { title: "⚡ 1 Klick – Deal gesichert", badge: "✅ Kostenlos im Browser – Kein Download" },
      question: "Welche Karte soll ich als Nächstes checken? 👇",
      body: ["Der Live Flip-Radar zeigt dir in Echtzeit, wo Pokémon-Karten massiv unter Marktwert gelistet sind – 65 € Marktwert, 29 € Deal.",
        "Kein App-Store-Download: läuft sofort kostenlos im Browser."],
    },
    {
      ...base,
      key: "flea", label: "Hook · Flohmarkt- & Tausch-Schutz (Browser-Scanner)", choreo: "fleascan", tab: "scan", visual: "scan",
      title: "Flohmarkt-Falle vermeiden: Pokémon-Karten im Browser scannen",
      accent: "#fbbf24",
      hooks: [{ badge: "FLOHMARKT-CHECK", cover: "FLOHMARKT-FALLE VERMEIDEN ⚠️" }],
      hookBadge: { label: "Verkäufer", from: "45 €", to: "14 €", tag: "Echt" },
      lines: [
        { say: "Wenn du auf dem Flohmarkt oder beim Tauschen ohne dieses Tool stehst, wirst du abgezogen." },
        { say: "Einfach Kamera draufhalten, Karte direkt im Browser scannen und in einer Sekunde den echten Marktwert sehen." },
        { say: "Kein nerviger App-Store-Download, keine Wartezeit – funktioniert sofort auf jedem Handy." },
        { say: `Speicher dir ${SAY_DOMAIN} jetzt aufs Handy – was war dein bester Flohmarkt-Fund bisher?`,
          show: "Speicher dir pokeswipe-radar.de jetzt aufs Handy – was war dein bester Flohmarkt-Fund bisher?" },
      ],
      proof: { title: "📸 Live-Kartenscanner", popup: "Echter Marktwert", fallbackPrice: "14,00 €" },
      usp: { title: "🌐 Läuft direkt im Browser", badge: "🚫 Kein Download nötig" },
      question: "Dein bester Flohmarkt-Fund? 👇",
      body: ["Kamera draufhalten, Karte direkt im Browser scannen und in einer Sekunde den echten Marktwert sehen – bevor du auf dem Flohmarkt oder beim Tauschen zu viel zahlst.",
        "Kein App-Store-Download, keine Wartezeit: funktioniert sofort auf jedem Handy."],
    },
    {
      ...base,
      key: "chase", label: "Hook · Tinder für Sammler (Swipe, Tausch-Hub & Sammler-Radar)", choreo: "chase", tab: "swipe", visual: "swipe",
      title: "So sucht man heute Chase-Karten: Swipen, Tauschen, Sammler in deiner Nähe",
      accent: "#f472b6",
      hooks: [{ badge: "SWIPE-MODUS", cover: "SO SUCHT MAN HEUTE CHASE-KARTEN 🔥" }],
      hookBadge: null,
      lines: [
        { say: "Warum sucht eigentlich noch niemand so nach seinen fehlenden Chase-Karten?" },
        { say: "Auf PokeSwipe Radar swipest du einfach durch Karten, likest die krassesten Pulls der Community und markierst, was dir noch fehlt." },
        { say: "Über den Tausch-Hub und das Sammler-Radar findest du direkt Leute in deiner Nähe, die genau deine Chase-Karte abgeben." },
        { say: `Kostenlos starten auf ${SAY_DOMAIN} – welche eine Karte fehlt dir gerade am dringendsten im Binder?`,
          show: "Kostenlos starten auf pokeswipe-radar.de – welche eine Karte fehlt dir gerade am dringendsten im Binder?" },
      ],
      proof: { title: "👆 PokeSwipe-Modus" },
      usp: { title: "🤝 Tausch-Hub & 📍 Sammler-Radar", pins: [["Lena", "1,2 km", "Glurak ex"], ["Mo", "2,8 km", "Pikachu ex"], ["Jonas", "4,5 km", "Mew ex"]] },
      question: "Welche Karte fehlt dir im Binder? 👇",
      body: ["Swipe durch Karten, like die krassesten Pulls der Community und markiere, was dir noch fehlt.",
        "Über den Tausch-Hub und das Sammler-Radar findest du Sammler in deiner Nähe, die genau deine Chase-Karte abgeben – kostenlos im Browser, ohne Download."],
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 15-s-Feature-Vorlagen (Hook-Format, 4 Szenen hook → proof → usp → ask) für die neuen Hauptfunktionen:
// Digitaler Set-Binder & Scan · Lücken sehen & 1-Klick-Kauf · Doppelte mit 1 Klick verkaufen · All-in-One.
// Gesprochen wird exakt das Briefing-Skript (aufgeteilt auf 4 Szenen); die Domain wird als „PokeSwipe Radar Punkt de“
// gesprochen und als pokeswipe-radar.de eingeblendet. Eigene Liste – nicht Teil der Rotation der Admin-Zentrale.
// ---------------------------------------------------------------------------------------------------------------
export const FEATURE15_WORDS = Object.freeze([20, 72]);
function FEATURE15() {
  const base = { format: "hook4", feature15: true, seconds: [15, 17], words: FEATURE15_WORDS, mbit: 8, cbr: true, maxSpeed: SPEED_CAP, segments: HOOK4_SEGMENTS, hashtags: HOOK4_HASHTAGS, visual: "binder", tab: "portfolio" };
  return [
    {
      ...base,
      key: "f15binder", label: "15 s · Digitaler Set-Binder & Scan", choreo: "f15binder", tab: "scan",
      title: "Digitaler Set-Binder: Karte scannen, automatisch einsortiert – mit Live-Preis",
      accent: "#a78bfa",
      hooks: [{ badge: "DIGITALER SET-BINDER", cover: "WELCHE KARTEN FEHLEN DIR NOCH? 📒" }],
      hookBadge: null,
      lines: [
        { say: "Keinen Überblick mehr, welche Pokémon-Karten dir im Set noch fehlen?" },
        { say: "Auf PokeSwipe Radar scannst du deine Karte ein und sie sortiert sich automatisch inklusive Live-Preis in deinen digitalen Set-Binder ein,",
          show: "Auf PokeSwipe Radar scannst du deine Karte ein und sie sortiert sich automatisch inklusive Live-Preis in deinen digitalen Set-Binder ein –" },
        { say: "mit realistischer Blättern-Funktion wie im echten Sammelalbum!" },
        { say: `Jetzt kostenlos testen auf ${SAY_DOMAIN}!`, show: "Jetzt kostenlos testen auf pokeswipe-radar.de!" },
      ],
      proof: { title: "📸 Scannen → automatisch einsortiert", points: [["✓", "Karte erkannt", "inklusive Live-Preis"], ["📒", "Im Set-Binder einsortiert", "automatisch an der richtigen Stelle"]] },
      usp: { title: "📖 Blättern wie im echten Album", badge: "📒 Digitaler Set-Binder – kostenlos im Browser", points: [["📖", "Realistisches Blättern", "wie im echten Sammelalbum"], ["💶", "Live-Preis je Karte", "immer aktuell"]] },
      question: "Wie viele Karten fehlen dir im Set? 👇",
      body: ["Karte scannen – sie sortiert sich automatisch inklusive Live-Preis in deinen digitalen Set-Binder ein, mit realistischer Blättern-Funktion wie im echten Sammelalbum.",
        "Kostenlos im Browser, kein App-Store-Download nötig."],
    },
    {
      ...base,
      key: "f15gaps", label: "15 s · Lücken sehen & 1-Klick-Kauf", choreo: "f15gaps",
      title: "Fehlende Karten im Set-Binder sehen und mit einem Klick kaufen",
      accent: "#38bdf8",
      hooks: [{ badge: "LÜCKEN-RADAR", cover: "JEDE FEHLENDE KARTE AUF EINEN BLICK 👀" }],
      hookBadge: null,
      lines: [
        { say: "Im neuen digitalen Set-Binder auf PokeSwipe Radar siehst du auf einen Blick jede fehlende Karte als grauen Platzhalter." },
        { say: "Ein Tipp auf die Lücke genügt,", show: "Ein Tipp auf die Lücke genügt –" },
        { say: "und du kannst die Karte direkt mit einem Klick auf unserem Marktplatz, bei eBay oder auf Cardmarket kaufen!" },
        { say: `Alles von einer Seite aus auf ${SAY_DOMAIN}!`, show: "Alles von einer Seite aus auf pokeswipe-radar.de!" },
      ],
      proof: { title: "⬜ Lücke antippen", points: [["⬜", "Fehlende Karte", "als grauer Platzhalter"]] },
      usp: { title: "🛒 1 Klick – Karte kaufen", badge: "🛒 Marktplatz · eBay · Cardmarket – alles auf einer Seite", points: [["🏪", "PokeSwipe Marktplatz", "direkt von Sammlern"], ["🔗", "eBay & Cardmarket", "mit einem Klick verlinkt"]] },
      question: "Welche Lücke willst du als Erstes schließen? 👇",
      body: ["Im digitalen Set-Binder siehst du jede fehlende Karte als grauen Platzhalter – ein Tipp auf die Lücke genügt und du kaufst sie mit einem Klick auf unserem Marktplatz, bei eBay oder auf Cardmarket.",
        "Alles von einer Seite aus – kostenlos im Browser."],
    },
    {
      ...base,
      key: "f15dupes", label: "15 s · Doppelte mit 1 Klick verkaufen", choreo: "f15dupes",
      title: "Doppelte Pokémon-Karten mit einem Klick aus dem Set-Binder verkaufen",
      accent: "#34d399",
      hooks: [{ badge: "DOPPELTE ZU GELD", cover: "DOPPELTE VERSTAUBEN IN DER BOX? 📦" }],
      hookBadge: { label: "Cardmarket", from: "12,90 €", to: "11,60 €", tag: "Blitzverkauf" },
      lines: [
        { say: "Doppelte Pokémon-Karten verstauben nur in der Box?" },
        { say: "Auf PokeSwipe Radar stellst du Doppelte direkt aus dem digitalen Set-Binder mit einem Klick online,",
          show: "Auf PokeSwipe Radar stellst du Doppelte direkt aus dem digitalen Set-Binder mit einem Klick online –" },
        { say: "zum aktuellen Cardmarket-Preis oder direkt 5 bis 10 Prozent günstiger für den Blitzverkauf!" },
        { say: `Jetzt ausprobieren auf ${SAY_DOMAIN}!`, show: "Jetzt ausprobieren auf pokeswipe-radar.de!" },
      ],
      proof: { title: "2× Doppelte erkannt", points: [["2×", "Doppelte im Set-Binder", "automatisch gezählt"], ["⚡", "1 Klick", "direkt online gestellt"]] },
      usp: { title: "🏷️ Dein Preis, dein Tempo", badge: "🏷️ Cardmarket-Preis oder −5 bis −10 % Blitzverkauf", points: [["💶", "Cardmarket-Preis", "aktueller Marktwert"], ["−10 %", "Blitzverkauf", "5–10 % günstiger, schneller weg"]] },
      question: "Wie viele Doppelte liegen bei dir rum? 👇",
      body: ["Doppelte Karten stellst du direkt aus dem digitalen Set-Binder mit einem Klick online – zum aktuellen Cardmarket-Preis oder 5 bis 10 Prozent günstiger für den Blitzverkauf.",
        "Kostenlos im Browser, kein Download nötig."],
    },
    {
      ...base,
      key: "f15all", label: "15 s · All-in-One: Set-Binder & Sammler-Radar", choreo: "f15all", tab: "scan", seconds: [12, 17],
      title: "Scannen, Set-Fortschritt, 1-Klick-Kauf & Verkauf – alles in einer App im Browser",
      accent: "#fbbf24",
      hooks: [{ badge: "ALL-IN-ONE", cover: "ALLES FÜR SAMMLER IN 1 APP ⚡" }],
      hookBadge: null,
      lines: [
        { say: "Karten scannen, Set-Fortschritt checken," },
        { say: "fehlende Hits mit einem Klick kaufen" },
        { say: "und doppelte Karten sofort zu Geld machen.", show: "und doppelte Karten sofort zu Geld machen:" },
        { say: `Hol dir jetzt den digitalen Set-Binder und das Live-Sammler-Radar kostenlos im Browser auf ${SAY_DOMAIN}!`,
          show: "Hol dir jetzt den digitalen Set-Binder und das Live-Sammler-Radar kostenlos im Browser auf pokeswipe-radar.de!" },
      ],
      proof: { title: "🛒 Fehlende Hits kaufen", points: [["📸", "Scannen", "Set-Fortschritt live"], ["🛒", "1-Klick-Kauf", "fehlende Hits"]] },
      usp: { title: "💶 Doppelte zu Geld machen", badge: "✅ Set-Binder + Live-Sammler-Radar – kostenlos im Browser", points: [["💶", "Doppelte verkaufen", "sofort online"], ["📍", "Live-Sammler-Radar", "Sammler in deiner Nähe"]] },
      question: "Welches Feature testest du zuerst? 👇",
      body: ["Karten scannen, Set-Fortschritt checken, fehlende Hits mit einem Klick kaufen und doppelte Karten sofort zu Geld machen.",
        "Digitaler Set-Binder und Live-Sammler-Radar – kostenlos im Browser, ohne Download."],
    },
  ];
}
export const FEATURE15_TEMPLATES = FEATURE15();
export const isFeature15 = (tpl) => !!tpl?.feature15;

// ---------------------------------------------------------------------------------------------------------------
// 🔥 Pro-Videos: Set-Binder & Marktplatz (Aktuell) – die 4 aktuellen Pro-Videos des Generators (Haupt-Ordner).
// Hook-Format (4 Szenen hook → proof → usp → ask), 9:16 · 1080×1920, eigene geklonte ElevenLabs-Stimme, Untertitel
// Wort für Wort aus den Zeitstempeln der Stimme. Gesprochen und eingeblendet wird exakt das Briefing-Skript (die Domain
// wird als „PokeSwipe Radar Punkt de“ gesprochen und als pokeswipe-radar.de eingeblendet). Live-Ablauf in der echten
// App: Scanner → digitaler Set-Binder mit Switch-Funktion (Blättern) → Lücken-Kauf → 1-Klick-Verkauf mit −5 % / −10 %.
// Eigene Liste – nicht Teil der Rotation der Admin-Zentrale; alle bisherigen Vorlagen liegen im Archiv-Ordner.
// ---------------------------------------------------------------------------------------------------------------
/** Ordner-Namen im Generator. */
export const PRO4_FOLDER = "🔥 Pro-Videos: Set-Binder & Marktplatz (Aktuell)";
export const ARCHIVE_FOLDER = "📁 Archiv / Bisherige Vorlagen";
/** Standard-Zielordner in Google Drive (geht als Feld drive_folder an Make.com). */
export const DRIVE_FOLDER = "werbe videos pokeswipe";
/** Wortlimit der aktuellen Pro-Videos (Video 4 ≈ 145 gesprochene Wörter). Server: Format „pro4“. */
export const PRO4_WORDS = Object.freeze([40, 160]);
/** Preis-Beispiel für den 1-Klick-Verkauf (Cardmarket-Preis und −5 % / −10 %). */
export const PRO4_SELL_PRICE = 12.9;
const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
/** Verkaufs-Optionen: Cardmarket-Preis, −5 %, −10 % (Blitzverkauf). */
export function sellOptions(price = PRO4_SELL_PRICE) {
  return [["💶 Cardmarket-Preis", eur(price)], ["−5 %", eur(price * 0.95)], ["⚡ −10 % Blitzverkauf", eur(price * 0.9)]];
}
const SELL = { title: "🏷️ Doppelte inserieren – 1 Klick", options: sellOptions(), pick: 2, done: "✓ Inserat ist live – Blitzverkauf" };
const BUY = { title: "🛒 Fehlende Karte kaufen – 1 Klick", options: [["🏪 PokeSwipe Marktplatz", "6,50 €"], ["🔗 eBay", "ab 7,20 €"], ["🔗 Cardmarket", "ab 6,90 €"]], pick: 0, done: "✓ Karte gesichert – mit 1 Klick" };

/** Video 4: Ziellänge und harte Obergrenze (Sekunden, inkl. Vorlauf und Ausblenden). */
export const PRO4_TARGET_S = 38;
export const PRO4_HARD_MAX_S = 39.5;
/** Fest hinterlegte ElevenLabs-Stimme für alle 4 Pro-Videos – und für alle übrigen Vorlagen (siehe ALL_TEMPLATES). */
export const PRO4_VOICE_ID = "UYUpESc8AS2NKE3IBY1W";

function PRO4() {
  const base = {
    format: "hook4", pro4: true, voiceId: PRO4_VOICE_ID, voiceFormat: "pro4", words: PRO4_WORDS, mbit: 10, cbr: true, maxSpeed: SPEED_CAP,
    hashtags: HOOK4_HASHTAGS, visual: "binder", tab: "portfolio", hookBadge: null, fitVoice: { maxStretch: 1.08 },
  };
  return [
    {
      ...base, n: 1,
      key: "p4binder", label: "Video 1 · Digitaler Set-Binder & Switch-Funktion (ca. 20 s)", choreo: "p4binder", tab: "scan",
      seconds: [18, 24], segments: Object.freeze([3, 8, 18, 22]),
      title: "Digitaler Set-Binder: Karte scannen, automatisch einsortiert, blättern wie im echten Album",
      accent: "#a78bfa",
      hooks: [{ badge: "📒 DIGITALER SET-BINDER", cover: "SCHLUSS MIT ZETTELWIRTSCHAFT! 📒" }],
      lines: [
        { say: "Schluss mit unsortierten Kartenstapeln und Zettelwirtschaft!" },
        { say: "Auf PokeSwipe Radar scannst du deine Pokémon-Karte einfach ein,", show: "Auf PokeSwipe Radar scannst du deine Pokémon-Karte einfach ein –" },
        { say: "und sie sortiert sich vollautomatisch inklusive aktuellem Cardmarket-Preis an ihren exakten Platz in deinem digitalen Set-Binder ein. Du blätterst mit der realistischen Switch-Funktion wie in einem echten Sammelalbum durch deine Seiten und siehst sofort deinen Fortschritt." },
        { say: `Jetzt kostenlos testen auf ${SAY_DOMAIN}!`, show: "Jetzt kostenlos testen auf pokeswipe-radar.de!" },
      ],
      proof: { title: "📸 Karte scannen", points: [["✓", "Karte erkannt", "inkl. aktuellem Cardmarket-Preis"], ["📒", "Exakter Platz im Set-Binder", "vollautomatisch einsortiert"]] },
      usp: { title: "📖 Switch-Funktion", badge: "📖 Blättern wie im echten Sammelalbum", points: [["📖", "Switch-Funktion", "Seite für Seite durchblättern"], ["📈", "Set-Fortschritt", "sofort auf einen Blick"]] },
      question: "Wie viele Karten fehlen dir noch im Set? 👇",
      body: ["Karte scannen – sie sortiert sich vollautomatisch inklusive aktuellem Cardmarket-Preis an ihren exakten Platz in deinem digitalen Set-Binder ein.",
        "Mit der realistischen Switch-Funktion blätterst du wie in einem echten Sammelalbum und siehst sofort deinen Fortschritt."],
    },
    {
      ...base, n: 2,
      key: "p4gaps", label: "Video 2 · Lücken auf einen Blick & 1-Klick-Kauf (ca. 20 s)", choreo: "p4gaps",
      seconds: [18, 24], segments: Object.freeze([5, 12, 18, 22]),
      title: "Fehlende Karten im Set-Binder sehen und mit einem Klick kaufen – Marktplatz, eBay, Cardmarket",
      accent: "#38bdf8",
      hooks: [{ badge: "⬜ LÜCKEN-RADAR", cover: "WELCHE KARTEN FEHLEN DIR NOCH? 👀" }],
      lines: [
        { say: "Du willst dein Pokémon-Set endlich voll bekommen, weißt aber nie genau, welche Karten noch fehlen?" },
        { say: "Im digitalen Set-Binder auf PokeSwipe Radar siehst du jede fehlende Karte sofort als grauen Platzhalter." },
        { say: "Ein Tipp auf die Lücke genügt – und du kaufst die Karte mit einem einzigen Klick direkt auf unserem Marktplatz, bei eBay oder Cardmarket." },
        { say: `Alles von einer Seite aus auf ${SAY_DOMAIN}!`, show: "Alles von einer Seite aus auf pokeswipe-radar.de!" },
      ],
      proof: { title: "⬜ Fehlende Karten", points: [["⬜", "Grauer Platzhalter", "jede fehlende Karte sofort sichtbar"], ["📒", "Digitaler Set-Binder", "dein Set auf einen Blick"]] },
      usp: { title: "🛒 1-Klick-Kauf", badge: "🛒 Marktplatz · eBay · Cardmarket – von einer Seite aus", choice: BUY },
      question: "Welche Karte fehlt dir am dringendsten? 👇",
      body: ["Im digitalen Set-Binder siehst du jede fehlende Karte sofort als grauen Platzhalter.",
        "Ein Tipp auf die Lücke genügt – und du kaufst die Karte mit einem Klick auf unserem Marktplatz, bei eBay oder Cardmarket."],
    },
    {
      ...base, n: 3,
      key: "p4dupes", label: "Video 3 · Doppelte mit 1 Klick inserieren & Blitz-Rabatt (ca. 20 s)", choreo: "p4dupes",
      seconds: [18, 24], segments: Object.freeze([5, 11, 17, 22]),
      title: "Doppelte Pokémon-Karten mit 1 Klick inserieren – Cardmarket-Preis oder −5 % / −10 % Blitzverkauf",
      accent: "#34d399",
      hooks: [{ badge: "💶 DOPPELTE ZU GELD", cover: "DOPPELTE LIEGEN NUR RUM? 📦" }],
      lines: [
        { say: "Doppelte Pokémon-Karten liegen bei dir nur in der Box rum? Mach sie in Sekunden zu Geld!" },
        { say: "Auf PokeSwipe Radar stellst du Doppelte direkt aus deinem digitalen Binder mit einem Klick auf den Marktplatz,", show: "Auf PokeSwipe Radar stellst du Doppelte direkt aus deinem digitalen Binder mit einem Klick auf den Marktplatz –" },
        { say: "entweder zum normalen Cardmarket-Preis oder direkt 5 bis 10 Prozent günstiger für den Blitzverkauf." },
        { say: `Lokal per Safe-Trade in deiner Nähe oder deutschlandweit mit Käuferschutz auf ${SAY_DOMAIN}!`,
          show: "Lokal per Safe-Trade in deiner Nähe oder deutschlandweit mit Käuferschutz auf pokeswipe-radar.de!" },
      ],
      proof: { title: "2× Doppelte im Binder", points: [["2×", "Doppelte erkannt", "direkt im digitalen Binder"], ["⚡", "1 Klick", "auf den Marktplatz"]] },
      usp: { title: "⚡ Blitzverkauf", badge: "🏷️ Cardmarket-Preis oder −5 % / −10 % Blitzverkauf", choice: SELL },
      question: "Wie viele Doppelte liegen bei dir rum? 👇",
      body: ["Doppelte stellst du direkt aus deinem digitalen Binder mit einem Klick auf den Marktplatz – zum normalen Cardmarket-Preis oder 5 bis 10 Prozent günstiger für den Blitzverkauf.",
        "Lokal per Safe-Trade in deiner Nähe oder deutschlandweit mit Käuferschutz."],
    },
    {
      ...base, n: 4,
      key: "p4all", label: "Video 4 · All-in-One-Erklärvideo für Sammler, Käufer & Verkäufer (ca. 36–39 s)", choreo: "p4all", tab: "scan",
      // Ziel 38 s (36–39 s, sicher unter 40 s): Höchsttempo 1,2 → Sprechpausen auf 0,1 s kürzen → tonhöhenneutral
      // höchstens 15 % raffen. Nur falls die Stimme dann noch länger als 39,5 s wäre, greift eine Notbremse (max. 22 %).
      seconds: [36, 39], segments: Object.freeze([7, 22, 33, 38.5]), mbit: 9, startSpeed: SPEED_CAP,
      fitVoice: Object.freeze({ maxStretch: 1.15, target: PRO4_TARGET_S, hardMax: PRO4_HARD_MAX_S, hardStretch: 1.22, minPause: 0.2, keep: 0.1 }),
      title: "Warum PokeSwipe Radar: Scanner, Set-Binder, 1-Klick-Kauf & -Verkauf, Sammler-Radar – alles an einem Ort",
      accent: "#fbbf24",
      hooks: [{ badge: "⚡ ALL-IN-ONE", cover: "WARUM GAB ES DAS NOCH NICHT? 🤯" }],
      lines: [
        { say: "Warum gibt es eigentlich keine App, die für Pokémon-Sammler, Käufer und Verkäufer alles an einem Ort vereint? Genau dafür haben wir PokeSwipe Radar gebaut!" },
        { say: "Egal ob du deine Sammlung im Blick behalten willst oder gezielt nach guten Deals suchst: Du scannst deine Karten ein, sie sortieren sich automatisch mit Live-Preisen in deinen digitalen Set-Binder ein und du blätterst durch deine Sets wie in einem echten Album. Jede fehlende Karte siehst du auf einen Blick und holst sie dir mit einem Klick über unseren Marktplatz, eBay oder Cardmarket." },
        { say: "Und wenn du Doppelte hast? Ein Klick im Binder reicht – und dein Inserat ist blitzschnell live, auf Wunsch direkt 5 oder 10 Prozent unter Marktpreis für einen sofortigen Verkauf! Dazu kommen das Live-Sammler-Radar auf Google Maps für sichere Tausch-Deals vor Ort und der Echtzeit-Preiswächter." },
        { say: `Komplett kostenlos im Browser – probier es jetzt aus auf ${SAY_DOMAIN}!`, show: "Komplett kostenlos im Browser – probier es jetzt aus auf pokeswipe-radar.de!" },
      ],
      proof: { title: "📸 Scannen · 📒 Binder · 🛒 Kaufen", points: [["📸", "Scannen & einsortieren", "mit Live-Preisen im Set-Binder"], ["🛒", "Lücken mit 1 Klick kaufen", "Marktplatz · eBay · Cardmarket"]] },
      usp: { title: "💶 Verkaufen · 📍 Radar", badge: "💶 1 Klick: Inserat live – auf Wunsch −5 % / −10 %", choice: { ...SELL, until: 0.55 },
        points: [["📍", "Live-Sammler-Radar", "sichere Tausch-Deals vor Ort"], ["🔔", "Echtzeit-Preiswächter", "kein Deal mehr verpasst"]] },
      question: "Sammler, Käufer oder Verkäufer – was bist du? 👇",
      body: ["Scannen, automatisch im digitalen Set-Binder einsortieren, blättern wie im echten Album – und fehlende Karten mit einem Klick über Marktplatz, eBay oder Cardmarket holen.",
        "Doppelte mit einem Klick inserieren, auf Wunsch 5 oder 10 Prozent unter Marktpreis. Dazu Live-Sammler-Radar auf Google Maps und Echtzeit-Preiswächter – komplett kostenlos im Browser."],
    },
  ];
}
export const PRO4_TEMPLATES = PRO4();
export const isPro4 = (tpl) => !!tpl?.pro4;

/**
 * Vorlagen. choreo = Live-Choreografie aus reel-scenarios.js, tab = Startbereich der echten App.
 * hooks: Cover-Schlagzeile + gesprochener Einstieg (rotieren je Durchlauf).
 */
export const PRO_TEMPLATES = [
  {
    key: "overview", label: "Komplett-Überblick", choreo: "tour", tab: "swipe",
    title: "Warum PokeSwipe Radar die beste All-in-One-App für Pokémon-Sammler ist",
    accent: "#ffcb05",
    hooks: [
      { badge: "FUNKTIONS-CHECK", cover: "ALL-IN-ONE: Diese App verändert Pokémon-TCG!", say: "Diese App verändert Pokémon-TCG für immer!" },
      { badge: "SAMMLER-TIPP", cover: "Zahlst du noch zu viel für Pokémon-Karten?", say: "Zahlst du noch zu viel für Pokémon-Karten?" },
    ],
    lines: [
      { say: "PokeSwipe Radar zeigt dir Live-Preise von Cardmarket und TCGplayer für über fünfundfünfzigtausend Karten, auf Deutsch, Englisch und Japanisch.",
        show: "PokeSwipe Radar zeigt dir Live-Preise von Cardmarket und TCGplayer für über 55.000 Karten, auf Deutsch, Englisch und Japanisch." },
      { say: "Swipen, Deals finden, Sammlung tracken und sicher handeln, alles in einer einzigen App statt in fünf verschiedenen." },
      { say: "Das spart dir jeden Tag Zeit, schützt dich vor überteuerten Preisen und verbindet dich mit echten Sammlern." },
    ],
    stats: [["55.000+", "Karten"], ["EUR + USD", "Live-Preise"], ["DE · EN · JP", "Sprachen"]],
    badges: ["📡 Live-Preis-Radar", "👆 Swipe-Entdecker", "🛡️ Sicherer Marktplatz", "📈 Portfolio-Tracker"],
    trust: ["⏱️ Spart täglich Zeit", "💶 Faire Preise statt Abzocke", "🔒 Käuferschutz", "🤝 Echte Community"],
    tags: ["#PokemonApp", "#PokemonSammler", "#TCGDeutschland"],
    body: ["Live-Preise von Cardmarket (EUR) und TCGplayer (USD) für über 55.000 deutsche, englische und japanische Karten plus Sealed-Produkte.",
      "Swipe-Entdecker, Flip-Radar, Marktplatz mit Käuferschutz, Portfolio und Release-Kalender – alles in einer App statt in fünf."],
  },
  {
    key: "radar", label: "Live-Preis-Radar", choreo: "pricecheck", tab: "swipe",
    title: "Live-Preis-Radar: Cardmarket & TCGplayer in Echtzeit",
    accent: "#22d3ee",
    hooks: [
      { badge: "PREIS-ANALYSE", cover: "PREIS-RADAR: So erkennst du echte Schnäppchen!", say: "So erkennst du echte Schnäppchen, bevor es alle anderen tun!" },
      { badge: "LIVE-VERGLEICH", cover: "CARDMARKET vs. TCGPLAYER: Live-Vergleich", say: "Cardmarket oder TCGplayer, wo ist deine Karte gerade günstiger?" },
    ],
    lines: [
      { say: "Das Live-Preis-Radar holt Echtzeit-Preise von Cardmarket in Euro und TCGplayer in Dollar, inklusive Sealed-Produkten und Preisverlauf." },
      { say: "So siehst du sofort, ob ein Angebot fair ist, und erkennst Preissprünge, bevor alle anderen es merken." },
      { say: "Kein Tab-Chaos, keine Umrechnung, über fünfundfünfzigtausend deutsche, englische und japanische Karten an einem Ort.",
        show: "Kein Tab-Chaos, keine Umrechnung, über 55.000 deutsche, englische und japanische Karten an einem Ort." },
    ],
    stats: [["€", "Cardmarket"], ["$", "TCGplayer"], ["📦", "Sealed"]],
    badges: ["📡 Echtzeit-Preise", "📊 Preisverlauf", "🔔 Preisalarm", "📦 Sealed-Produkte"],
    trust: ["⏱️ Ein Blick statt fünf Tabs", "💶 Nie wieder überzahlen", "🌍 DE · EN · JP", "📈 Trends früh erkennen"],
    tags: ["#Cardmarket", "#TCGplayer", "#PokemonPreise"],
    body: ["Echtzeit-Preise von Cardmarket in EUR und TCGplayer in USD – mit Preisverlauf, Tiefstpreis und Sealed-Produkten.",
      "Über 55.000 deutsche, englische und japanische Karten an einem Ort, ohne Tab-Chaos und ohne Umrechnen."],
  },
  {
    key: "swipe", label: "PokeSwipe Entdecker-Modus", choreo: "arena", tab: "swipe",
    title: "PokeSwipe Entdecker-Modus: Karten swipen, Preis-Chancen finden",
    accent: "#f472b6",
    hooks: [
      { badge: "NEUE FUNKTION", cover: "NEU: Karten swipen & sammeln in Sekunden", say: "Neu: Karten swipen und sammeln in Sekunden!" },
      { badge: "SAMMLER-TIPP", cover: "SWIPE-TRICK: Versteckte Preis-Chancen finden", say: "Mit diesem Swipe-Trick findest du versteckte Preis-Chancen!" },
    ],
    lines: [
      { say: "Im PokeSwipe Entdecker-Modus wischst du blitzschnell durch echte Karten, rechts zum Merken, links zum Weiterwischen." },
      { say: "Jede Karte zeigt dir sofort den Live-Preis, so findest du versteckte Preis-Chancen in Sekunden statt in Stunden." },
      { say: "Deine Favoriten landen automatisch auf der Wunschliste, und der Preisalarm meldet dir den perfekten Moment." },
    ],
    stats: [["👈", "Weiter"], ["👉", "Merken"], ["€", "Live-Preis"]],
    badges: ["👆 Blitzschnell swipen", "⭐ Karten bewerten", "💎 Versteckte Chancen", "❤️ Wunschliste"],
    trust: ["⏱️ Sekunden statt Stunden", "🎯 Nur Karten, die dich interessieren", "🔔 Preisalarm", "🤝 Für Sammler & Verkäufer"],
    tags: ["#PokeSwipe", "#PokemonDeals", "#PokemonSammler"],
    body: ["Rechts merken, links weiter: Im Entdecker-Modus swipst du durch echte Karten mit Live-Preis.",
      "So findest du versteckte Preis-Chancen in Sekunden – Favoriten landen automatisch auf deiner Wunschliste."],
  },
  {
    key: "market", label: "Sicherer P2P-Marktplatz", choreo: "market", tab: "map",
    title: "Sicherer P2P-Marktplatz: Kaufen & verkaufen mit Käuferschutz",
    accent: "#34d399",
    hooks: [
      { badge: "MARKTPLATZ-GUIDE", cover: "MARKTPLATZ: Sicher verkaufen mit Käuferschutz", say: "So verkaufst du deine Karten sicher mit Käuferschutz!" },
      { badge: "SICHER HANDELN", cover: "Karten kaufen ohne Betrug? So geht's!", say: "Sicher Pokémon-Karten kaufen, ganz ohne Betrug?" },
    ],
    lines: [
      { say: "Im Marktplatz von PokeSwipe Radar kaufst und verkaufst du direkt von Sammler zu Sammler, mit echten Inseraten und fairen Preisen." },
      { say: "Der Käuferschutz hält das Geld zurück, bis die Karte ankommt, und Verkäufer bekommen ihre Auszahlung sicher über Stripe." },
      { say: "Dazu kommt die integrierte DHL-Sendungsverfolgung, damit du jederzeit weißt, wo dein Paket ist." },
    ],
    stats: [["🔒", "Käuferschutz"], ["💳", "Stripe-Auszahlung"], ["📦", "DHL-Tracking"]],
    badges: ["🤝 Direkt von Sammlern", "🔒 Käuferschutz", "💳 Sichere Auszahlung", "📦 DHL-Sendungsverfolgung"],
    trust: ["🛡️ Geld erst nach Erhalt", "💶 Faire Marktpreise", "📦 Paket immer im Blick", "🤝 Geprüfte Community"],
    tags: ["#PokemonMarktplatz", "#PokemonKaufen", "#TCGDeutschland"],
    body: ["Direkt von Sammler zu Sammler kaufen und verkaufen – mit Käuferschutz: Das Geld wird erst nach Erhalt ausgezahlt.",
      "Sichere Auszahlung über Stripe und integrierte DHL-Sendungsverfolgung für jedes Paket."],
  },
  {
    key: "portfolio", label: "Sammlung, Portfolio & Release-Kalender", choreo: "portfolio", tab: "portfolio",
    title: "Sammlungs- & Portfolio-Tracker mit Release-Kalender",
    accent: "#a78bfa",
    hooks: [
      { badge: "SAMMLUNGS-CHECK", cover: "PORTFOLIO: Was ist deine Sammlung heute wert?", say: "Was ist deine Pokémon-Sammlung heute wert?" },
      { badge: "RELEASE-KALENDER", cover: "RELEASE-KALENDER: Kein neues Set mehr verpassen", say: "Verpasst du immer noch neue Pokémon-Sets?" },
    ],
    lines: [
      { say: "Der Sammlungs-Tracker rechnet dein komplettes Portfolio live mit aktuellen Marktpreisen durch, Karte für Karte." },
      { say: "Du siehst Gewinner, Verlierer und Gesamtwert auf einen Blick, und der Release-Kalender erinnert dich an jedes neue Set." },
      { say: "So triffst du bessere Entscheidungen beim Kaufen, Halten und Verkaufen, ganz ohne Excel-Tabellen." },
    ],
    stats: [["📈", "Gesamtwert"], ["🏆", "Top-Gewinner"], ["📅", "Releases"]],
    badges: ["📈 Live-Portfoliowert", "🏆 Gewinner & Verlierer", "📅 Release-Kalender", "🔔 Erinnerungen"],
    trust: ["⏱️ Kein Excel mehr", "💶 Echte Marktpreise", "🧠 Bessere Entscheidungen", "📅 Kein Release verpasst"],
    tags: ["#PokemonSammlung", "#Sammlungswert", "#PokemonCollection"],
    body: ["Dein komplettes Portfolio live mit aktuellen Marktpreisen – Gewinner, Verlierer und Gesamtwert auf einen Blick.",
      "Der Release-Kalender erinnert dich an jedes neue Set, damit du keinen Drop mehr verpasst."],
  },
  {
    // Verkäufer-Video: Karte scannen → fairer Marktpreis → mit 1 Klick live (Käuferschutz + DHL-Label) → Promo-CTA.
    // Kürzer (Ziel 15–20 s) und mit eigener Bitrate (8 Mbit/s), eigenem Endscreen und Promo-Link START30.
    key: "scansell", label: "Karten scannen & in Sekunden verkaufen", choreo: "scansell", tab: "scan",
    title: "Pokémon-Karten scannen & in Sekunden verkaufen",
    accent: "#34d399",
    seconds: [15, 20], mbit: 8,
    hooks: [
      { badge: "VERKÄUFER-HACK", cover: "Pokémon-Karten verkaufen in 10 Sekunden?! 🤯⚡", say: "Pokémon-Karten verkaufen war noch nie so schnell!" },
      { badge: "SCAN & VERKAUF", cover: "Scannen, Preis, live: Verkauft in 10 Sekunden ⚡", say: "Pokémon-Karten verkaufen war noch nie so schnell!" },
    ],
    lines: [
      { say: "Auf PokeSwipe Radar hältst du einfach deine Kamera drauf, die App erkennt deine Karte sofort und schlägt dir direkt den fairen Marktpreis vor." },
      { say: "Und mit einem Klick ist dein Inserat live!" },
      { say: "Mit Käuferschutz und automatischem DHL-Etikett." },
    ],
    cta: {
      say: "Hol dir jetzt deinen kostenlosen Pro-Testmonat über den Link, und lade deine Freunde ein für noch mehr Gratis-Wochen!",
      show: "Jetzt 1 Monat Pro GRATIS testen & Freunde einladen! 👇🔗 pokeswipe-radar.de",
      button: "1 Monat Pro GRATIS testen",
      tagline: "Jetzt 1 Monat Pro GRATIS & Freunde einladen! 👇",
      link: "pokeswipe-radar.de/?promo=START30",
      sub: "🤝 Jeder eingeladene Freund = extra Gratis-Wochen Pro",
    },
    link: "https://pokeswipe-radar.de/?promo=START30",
    highlight: "1. Karte scannen 📸 • 2. Fairer Marktpreis sofort da 💰",
    headings: { benefit: "3. Mit 1 Klick inserieren 🚀", trust: "Inkl. Käuferschutz & DHL-Label 📦" },
    stats: [["📸", "Scannen"], ["💰", "Fairer Preis"], ["🚀", "1 Klick live"]],
    badges: ["📸 Erkennung direkt auf dem Handy", "💰 Fairer Marktpreis, sofort editierbar", "🚀 Mit 1 Klick live", "🃏 Sofort im Swipe-Radar"],
    trust: ["🔒 Stripe-Käuferschutz", "📦 DHL-Etikett per Klick aus der Bestellung", "💶 Geld sicher nach Erhalt", "🇩🇪 Deutscher Sammler-Marktplatz"],
    tags: ["#PokemonVerkaufen", "#PokemonKartenVerkaufen", "#TCGDeutschland", "#PokemonSammler"],
    body: ["📸 Karte scannen – die App erkennt sie sofort direkt auf dem Handy.",
      "💰 Fairer Marktpreis ist schon eingetragen (Cardmarket + echte Verkäufe) und lässt sich mit einem Tipp ändern.",
      "🚀 Mit 1 Klick live im deutschen Marktplatz – inklusive Stripe-Käuferschutz und automatischem DHL-Versandetikett 📦"],
    captionCta: [
      "🎁 1 Monat PokeSwipe Pro GRATIS: https://pokeswipe-radar.de/?promo=START30",
      "🤝 Freunde einladen = für jeden Freund extra Gratis-Wochen Pro obendrauf!",
    ],
  },
  {
    // Inserier-Video: zeigt, wie schnell und unkompliziert Scannen → fairer Preis → Inserat live geht.
    // Gleiche Live-Choreografie wie „scansell“ (echter Live-Scanner + Schnell-Inserieren im Demo-Modus),
    // aber Story und Endscreen ganz auf Tempo & Einfachheit ausgelegt (Ziel 20–30 s, Standard-Endscreen).
    key: "quicklist", label: "Scannen & direkt inserieren (schnell & unkompliziert)", choreo: "scansell", tab: "scan",
    title: "Pokémon-Karten scannen & direkt inserieren – in Sekunden",
    accent: "#fb923c",
    hooks: [
      { badge: "NEUE FUNKTION", cover: "Scannen & inserieren in unter 10 Sekunden ⚡", say: "Pokémon-Karten inserieren in unter zehn Sekunden? So einfach geht's!" },
      { badge: "SO EINFACH GEHT'S", cover: "Kein Abtippen mehr: 1 Scan = 1 Inserat 📸", say: "Schluss mit Abtippen: Ein Scan, ein Inserat!" },
    ],
    lines: [
      { say: "Kamera drauf, fertig: Die App erkennt deine Karte in Sekunden und trägt den fairen Marktpreis direkt für dich ein." },
      { say: "Kein Abtippen, keine Extra-Fotos, kein langes Formular, ein Tipp und dein Inserat ist live." },
      { say: "Zustand, Versand und Stadt merkt sich die App, und Käufer sehen sofort dein echtes Scan-Foto." },
    ],
    highlight: "⚡ Scannen → Preis steht → Inserat live",
    headings: { benefit: "Ein Tipp – Inserat live 🚀", trust: "Unkompliziert bis zum Schluss 🧠" },
    stats: [["📸", "1 Scan"], ["💰", "Preis steht"], ["⚡", "1 Tipp live"]],
    badges: ["📸 Karte in Sekunden erkannt", "💰 Fairer Preis schon eingetragen", "✍️ Kein Abtippen, kein Formular", "🚀 Mit 1 Tipp live"],
    trust: ["🧠 Merkt sich Zustand, Versand & Stadt", "📷 Echtes Scan-Foto im Inserat", "🔒 Käuferschutz inklusive", "🃏 Sofort im Swipe-Radar sichtbar"],
    tags: ["#PokemonVerkaufen", "#PokemonKartenVerkaufen", "#PokemonSammler", "#TCGDeutschland"],
    body: ["📸 Kamera drauf – PokeSwipe Radar erkennt deine Karte in Sekunden und trägt den fairen Marktpreis direkt ein.",
      "✍️ Kein Abtippen, keine Extra-Fotos, kein langes Formular: Ein Tipp und dein Inserat ist live.",
      "🧠 Zustand, Versand und Stadt merkt sich die App – das nächste Inserat geht noch schneller."],
  },
  ...HOOK4_TEMPLATES(),
];

/**
 * Farb- und Layout-Rotation der Startbilder: 6 Neon-Akzente × 3 Layouts. Aufeinanderfolgende Videos
 * unterscheiden sich immer in Farbe UND Layout – im 3er-Raster sieht jedes Cover eigenständig aus.
 */
export const LOOK_COLORS = Object.freeze([
  ["cyan", "#22d3ee"], ["gold", "#ffcb05"], ["smaragd", "#34d399"], ["magenta", "#d946ef"], ["koralle", "#fb7185"], ["orange", "#fb923c"],
]);
export const LOOK_LAYOUTS = Object.freeze(["left", "right", "tilt"]);
export function lookFor(i) {
  const n = Math.max(0, Math.trunc(Number(i) || 0));
  const [name, accent] = LOOK_COLORS[n % LOOK_COLORS.length];
  return { index: n, color: name, accent, layout: LOOK_LAYOUTS[n % LOOK_LAYOUTS.length] };
}

/** Kartenbild-URL (TCGdex liefert Basis-URLs ohne Endung) in hoher Auflösung. */
export function cardImageUrl(img) {
  const s = String(img || "").trim();
  if (!s) return "";
  return /\.(webp|png|jpe?g)$/i.test(s) ? s.replace(/\/low\.(webp|png|jpe?g)$/i, "/high.$1") : `${s}/high.webp`;
}

/** Nächste Karte für ein Cover: zuletzt benutzte Karten werden übersprungen (kein Motiv doppelt). */
export function pickCoverCard(cards, recent = []) {
  const used = new Set(recent);
  return cards.find((c) => !used.has(c.id)) || cards[0] || null;
}

export const templateByKey = (k) => PRO_TEMPLATES.find((t) => t.key === k) || SHOWCASE_TEMPLATES.find((t) => t.key === k) || MASTER_TEMPLATES.find((t) => t.key === k) || SHORT_TEMPLATES.find((t) => t.key === k) || FEATURE15_TEMPLATES.find((t) => t.key === k) || PRO4_TEMPLATES.find((t) => t.key === k) || null;

export const isHook4 = (tpl) => tpl?.format === "hook4";
/** Szenen-Schlüssel einer Vorlage (5 Standard-Szenen bzw. 4 Hook-Szenen). */
export const scenesFor = (tpl) => (isHook4(tpl) ? HOOK4_SCENES : tpl?.format === "showcase" ? SHOWCASE_SCENES : PRO_SCENES);

/** Die Sätze einer Vorlage (5 Standard / 4 Hook-Presets). variant wählt die Hook-Schlagzeile (rotiert). */
export function proScript(tpl, variant = 0) {
  const hook = tpl.hooks[Math.abs(variant) % tpl.hooks.length];
  // Hook-Presets: der erste Satz IST der Hook (Sprecherin startet sofort), kein angehängter Standard-CTA
  const src = isHook4(tpl) || tpl?.format === "showcase" ? tpl.lines : [{ say: hook.say, show: hook.say }, ...tpl.lines, tpl.cta || CTA_LINE];
  const all = src.map((l) => ({ say: l.say, show: l.show || l.say }));
  return { cover: hook.cover, badge: hook.badge, say: all.map((l) => l.say), show: all.map((l) => l.show) };
}

export function checkProScript(lines) {
  const words = countWords(lines);
  return { ok: words >= PRO_WORDS[0] && words <= PRO_WORDS[1], words, min: PRO_WORDS[0], max: PRO_WORDS[1] };
}

/**
 * Szenengrenzen aus den Satz-Zeitstempeln: Szene i beginnt kurz vor Satz i (Bild vor dem Wort), aber nie,
 * bevor Satz i−1 zu Ende gesprochen ist (Grenze liegt dann in der Sprechpause). So spricht die Sprecherin
 * in jeder Szene genau das, was gerade im Bild passiert. Liefert [{ key, start, end }].
 */
export function sceneTimes(marks, D, keys = PRO_SCENES) {
  const PRE = 0.2, MIN = 1.0, n = keys.length, L = n - 1;
  // ohne Sprecherin: Hook-Presets nutzen den Soll-Zeitplan 0–3 / 3–8 / 8–13 / 13–17 s (auf D skaliert)
  const plan = keys === HOOK4_SCENES ? [0, ...HOOK4_SEGMENTS.slice(0, L)].map((x) => (x * D) / HOOK4_SEGMENTS[L]) : null;
  const s = [0];
  for (let i = 1; i < n; i++) {
    const m = marks[i], prev = marks[i - 1];
    let b = m ? m.start - PRE : plan ? plan[i] : (D * i) / n;
    if (m && prev) b = Math.max(b, Math.min(m.start, (prev.end + m.start) / 2));
    s.push(Math.max(0, b));
  }
  s[1] = Math.max(1.2, s[1]); // Cover/Hook steht mindestens 1,2 s
  for (let i = 2; i < s.length; i++) s[i] = Math.max(s[i], s[i - 1] + MIN);
  s[L] = Math.min(s[L], Math.max(s[L - 1] + MIN, D - 1.5)); // Endscreen mindestens 1,5 s
  return keys.map((key, i) => ({ key, start: s[i], end: i < L ? s[i + 1] : D }));
}

/**
 * Soll/Ist-Vergleich der Hook-Szenen: je Szene Soll-Fenster (0–3 / 3–8 / 8–13 / 13–17 s), gemessene Zeiten und
 * Abweichung. ok = Hook liegt in den ersten 3 s (±0,5 s) und das Video ist 15–17 s lang (Toleranz tol für die übrigen Grenzen).
 */
export function segmentReport(scenes, segments = HOOK4_SEGMENTS, tol = 1.5) {
  const D = scenes[scenes.length - 1]?.end || 0;
  const rows = scenes.map((sc, i) => {
    const want = [i ? segments[i - 1] : 0, segments[i]];
    const dev = Math.max(Math.abs(sc.start - want[0]), Math.abs(sc.end - want[1]));
    return { key: sc.key, want, start: +sc.start.toFixed(2), end: +sc.end.toFixed(2), dev: +dev.toFixed(2) };
  });
  const hookOk = rows[0] && rows[0].end <= segments[0] + 0.5 && rows[0].end >= 1.2;
  const lenOk = D >= segments[segments.length - 1] - 2 && D <= segments[segments.length - 1] + 0.05;
  const ok = !!hookOk && lenOk && rows.every((r) => r.dev <= tol);
  return { ok, duration: +D.toFixed(2), rows };
}

/**
 * Exakte Sprechdauer aus den dekodierten PCM-Samples: Position (s) des letzten hörbaren Samples
 * (über ≈ −50 dBFS) plus 40 ms Ausklang. channels = Float32Array je Kanal.
 */
export function audibleEnd(channels, sampleRate, threshold = 0.0032) {
  const len = channels[0]?.length || 0;
  for (let i = len - 1; i >= 0; i--) {
    for (const ch of channels) if (Math.abs(ch[i]) > threshold) return Math.min(len, i + Math.round(sampleRate * 0.04)) / sampleRate;
  }
  return len / sampleRate;
}

/** Videolänge exakt auf das Frame-Raster runden: N Frames → D = N / fps (Ton wird auf dieselbe Länge gerendert). */
export function frameGrid(seconds, fps) {
  const frames = Math.max(1, Math.ceil(seconds * fps - 1e-6));
  return { frames, duration: frames / fps };
}

/**
 * Zeitpunkte für die 4 Beats der Live-Choreografie: Beat 1+2 in Szene 2 (Fokus-Zoom),
 * Beat 3 in Szene 3, Beat 4 in Szene 4. Cover und Endscreen zeigen keine Live-Aktion.
 */
export function choreoMarks(scenes) {
  if (scenes[0]?.key === "hook") {
    // Hook-Presets: Beat 1 im Hook, Beat 2+3 im UI-Beweis, Beat 4 im USP (Endscreen ohne Live-Aktion)
    const [h, p, u] = scenes;
    return [
      { start: h.start, end: h.end },
      { start: p.start, end: p.start + (p.end - p.start) * 0.5 },
      { start: p.start + (p.end - p.start) * 0.5, end: p.end },
      { start: u.start, end: u.end },
    ];
  }
  const [, f, b, t] = scenes;
  return [
    { start: f.start, end: f.start + (f.end - f.start) * 0.4 },
    { start: f.start + (f.end - f.start) * 0.4, end: f.end },
    { start: b.start, end: b.end },
    { start: t.start, end: t.end },
  ];
}

/**
 * Video-Bitrate (Mbit/s), damit die Datei sicher unter maxMb bleibt.
 * MB ≈ (Video + Audio) × Sekunden ÷ 8 · Reserve 12 % für VBR-Spitzen und MP4-Container.
 */
export function bitrateFor(seconds, wantMbit, maxMb = SAFE_MB) {
  const budget = (maxMb * MB * 8) / 1e6 / Math.max(1, seconds + 1) / 1.12 - AUDIO_KBPS / 1000;
  return Math.max(4, Math.min(wantMbit, Math.floor(budget * 10) / 10));
}
/** Neue Bitrate nach einer zu großen Datei (sizeBytes > maxMb): proportional + 10 % Abschlag. */
export function shrinkBitrate(mbit, sizeBytes, maxMb = SAFE_MB) {
  return Math.max(3, Math.floor(mbit * ((maxMb * MB) / Math.max(1, sizeBytes)) * 0.9 * 10) / 10);
}
export const estimateMb = (seconds, mbit) => ((mbit + AUDIO_KBPS / 1000) * seconds) / 8 * 1.05 * (1e6 / MB);

/** Ziellänge einer Vorlage in Sekunden [min, max] (Standard 20–30 s, z. B. „scansell“ 15–20 s). */
export function secondsFor(tpl) {
  const s = Array.isArray(tpl?.seconds) ? tpl.seconds : null;
  // exakte Länge (z. B. Showcase 29–29 s) ist erlaubt
  return s && s[0] > 0 && s[1] >= s[0] ? [s[0], s[1]] : [PRO_MIN_S, PRO_MAX_S];
}

/** Sprechtempo für die Ziellänge: Dauer bei Tempo 1 → Tempo im erlaubten Bereich (0,9–1,12). */
export function speedFor(duration, speed, [min, max] = [PRO_MIN_S, PRO_MAX_S], cap = 1.12) {
  const total = duration + PRO_PAD; // Vorlauf + Ausblenden
  if (total > max) return Math.min(cap, Math.round(speed * (total / (max - 0.5)) * 100) / 100);
  if (total < min) return Math.max(0.9, Math.round(speed * (total / (min + 0.5)) * 100) / 100);
  return speed;
}

/**
 * Untertitel: Wörter jedes Satzes zeitlich nach Zeichenlänge auf dessen Zeitspanne verteilen und in
 * gut lesbare Häppchen (max. 4 Wörter / 26 Zeichen) gruppieren. Liefert [{ start, end, words:[{w,start,end}] }].
 */
export function captionChunks(show, marks, wordMarks = null) {
  const out = [];
  show.forEach((line, i) => {
    const m = marks[i]; if (!m) return;
    // Reine Satzzeichen-Tokens (z. B. Gedankenstrich „–“) hängen am vorherigen Wort – gesprochen werden sie nicht,
    // so passt die Wortanzahl zu den echten Wort-Zeitstempeln der Sprecherin.
    const words = String(line).split(/\s+/).filter(Boolean).reduce((acc, w) => {
      if (acc.length && !/[\p{L}\p{N}]/u.test(w)) acc[acc.length - 1] += ` ${w}`; else acc.push(w);
      return acc;
    }, []);
    // Echte Wort-Zeitstempel der Sprecherin, wenn Untertitel und gesprochener Text gleich viele Wörter haben
    const real = wordMarks?.[i];
    let timed;
    if (Array.isArray(real) && real.length === words.length && real.every((x) => x && x.end >= x.start)) {
      timed = words.map((w, k) => ({ w, start: real[k].start, end: real[k].end }));
    } else {
      const weight = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 2);
      const total = weight.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      timed = words.map((w, k) => {
        const start = m.start + (acc / total) * (m.end - m.start);
        acc += weight[k];
        return { w, start, end: m.start + (acc / total) * (m.end - m.start) };
      });
    }
    let cur = [];
    const flush = () => { if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; };
    for (const t of timed) {
      const len = cur.reduce((a, x) => a + x.w.length + 1, 0) + t.w.length;
      if (cur.length >= 4 || (cur.length && len > 26)) flush();
      cur.push(t);
      if (/[.!?,;:]$/.test(t.w) && cur.length >= 2) flush();
    }
    flush();
  });
  // Lücken schließen, damit der Untertitel nicht flackert
  for (let i = 0; i < out.length - 1; i++) if (out[i + 1].start - out[i].end < 0.35) out[i].end = out[i + 1].start;
  return out;
}

const HASH_BASE = ["#PokemonTCG", "#PokemonKarten", "#PokeSwipeRadar", "#Pokemon"];
/** Deutscher Social-Media-Text für Make.com: starker Einstieg, Nutzen, CTA zu pokeswipe-radar.de, Hashtags. */
export function proCaption(tpl, variant = 0, facts = {}) {
  if (isHook4(tpl)) return hookCaption(tpl, variant);
  if (tpl?.format === "showcase") return showcaseCaption(tpl, variant, facts);
  const { cover } = proScript(tpl, variant);
  const emoji = { overview: "🚀", radar: "📡", swipe: "👆", market: "🛡️", portfolio: "📈", scansell: "", quicklist: "⚡" }[tpl.key] ?? "🔥";
  const hook = emoji ? `${cover} ${emoji}` : cover;
  const card = String(facts?.card || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const body = [...tpl.body, ...(card ? [`Im Video live dabei: ${card}.`] : [])];
  const seen = new Set();
  const hashtags = [...HASH_BASE, ...tpl.tags, "#TCGDeals", "#PokemonDeutschland"]
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  const cta = tpl.captionCta?.length ? tpl.captionCta : [`👉 ${CTA_TEXT} – Link in der Bio!`];
  const title = `${tpl.title} | PokeSwipe Radar`.slice(0, 100);
  const caption = [hook, "", ...body, "", ...cta, "", hashtags.join(" ")].join("\n");
  return { title, hook, body, hashtags, caption };
}

/** Kommentar-Frage ohne Pfeil-Emoji (für Caption und Metadaten). */
export const questionText = (tpl) => String(tpl?.question || "").replace(/\s*👇\s*$/u, "").trim();

/**
 * Post-Caption der Hook-Presets: Hook, 2 Nutzen-Sätze, USP (Browser, kein Download), die Kommentar-Frage und
 * genau die 3 Nischen-Hashtags. Kein „Like & Abo“, keine Spam-Tags (#fyp, #viral, #foryou …).
 */
export function hookCaption(tpl, variant = 0) {
  const { cover } = proScript(tpl, variant);
  const q = questionText(tpl);
  const hashtags = [...(tpl.hashtags || HOOK4_HASHTAGS)].filter((t) => !SPAM_TAGS.includes(t.toLowerCase())).slice(0, 3);
  const body = [...tpl.body];
  const cta = [`👉 Kostenlos im Browser: ${DOMAIN} – kein App-Store-Download nötig.`];
  const title = `${tpl.title} | PokeSwipe Radar`.slice(0, 100);
  const caption = [cover, "", ...body, "", ...cta, "", `💬 ${q} Schreib’s in die Kommentare!`, "", hashtags.join(" ")].join("\n");
  return { title, hook: cover, body, hashtags, caption, question: q };
}

// ---------------------------------------------------------------------------------------------------------------
// High-End-Showcase (format "showcase"): „Pro-Showcase: Volle App- & Pro-Abo-Power“
//   exakt 29 s · 9:16 · 1080×1920 · 60 FPS · 11 Mbit/s (10–12) · 4 Szenen mit festem Regie-Zeitplan:
//   0–6 s   scan     Blitz-Scanner (Karte in Schutzhülle, 1,4×-Zoom, Near-Mint-Preis, Tipp auf „Binder“)
//   6–15 s  binder   Set-Ordner 3×3 durchblättern, Lücke leuchtet „Auf Marktplatz: 29,90 €“, Tipp → Angebot
//   15–23 s market   2-Spalten-Marktplatz, Swipe-Tausch, Live-Chat, danach Pro-Abo-/Pro-Pass-Highlights
//   23–29 s finale   Startseite ohne Login-Zwang + App-Icon + „pokeswipe-radar.de – Kostenlos starten, kein Download“
// Eigene Liste (SHOWCASE_TEMPLATES), damit die bestehenden 20–30-s-Vorlagen und ihre Grenzen unverändert bleiben.
// ---------------------------------------------------------------------------------------------------------------
export const SHOWCASE_SCENES = ["scan", "binder", "market", "finale"];
/** Regie-Zeitplan in Sekunden: Start von scan, binder, market, finale und Videoende. */
export const SHOWCASE_PLAN = Object.freeze([0, 6, 15, 23, 29]);
export const SHOWCASE_SECONDS = 29;
export const SHOWCASE_FPS = 60;
export const SHOWCASE_MBIT = 11;
export const SHOWCASE_MBIT_RANGE = Object.freeze([10, 12]);
/** Wortlimit des Showcase-Voiceovers (29 s bei ruhigem, souveränem Tempo ≈ 2,8 Wörter/s). */
export const SHOWCASE_WORDS = Object.freeze([60, 84]);
/** Zeitpunkt, ab dem in Szene 3 die Pro-Abo-Highlights eingeblendet werden. */
export const SHOWCASE_PRO_AT = 19;

/** Exaktes Voiceover aus dem Briefing (Untertitel = Briefing-Text, gesprochen wird die Domain ausgeschrieben). */
const SHOWCASE_LINES = [
  { say: "So sieht moderner Kartenhandel heute aus: Karte vor die Handykamera halten – der Live-Scanner erkennt sie sofort mit aktuellem Preis und sortiert sie direkt in deinen digitalen Set-Ordner." },
  { say: "Beim Durchblättern siehst du sofort, welche Karten dir noch fehlen – und sobald ein anderer Sammler sie anbietet, leuchtet der Preis direkt auf der Lücke auf." },
  { say: "Ein Tipp zum Kaufen, Tauschen oder eigenen Verkaufen." },
  { say: "Und mit dem Pro-Abo sicherst du dir zusätzlich sofortige Preis-Alarme und Top-Boosts." },
  { say: `Jetzt kostenlos testen auf ${SAY_DOMAIN}.`, show: "Jetzt kostenlos testen auf pokeswipe-radar.de." },
];

export const SHOWCASE_TEMPLATES = [
  {
    key: "showcase", format: "showcase", label: "Pro-Showcase: Volle App- & Pro-Abo-Power",
    choreo: "showcase", tab: "scan", visual: "showcase",
    title: "Pro-Showcase: Scanner, Set-Binder, Marktplatz & Pro-Abo – alles im Browser",
    accent: "#22d3ee", gold: "#fbbf24",
    seconds: [SHOWCASE_SECONDS, SHOWCASE_SECONDS], exact: SHOWCASE_SECONDS, fps: SHOWCASE_FPS, mbit: SHOWCASE_MBIT, cbr: true,
    tone: "calm", maxSpeed: SPEED_CAP, words: SHOWCASE_WORDS, plan: SHOWCASE_PLAN,
    binderSet: "sv03.5", binderSetName: "Karmesin & Purpur – 151", marketBadge: 29.9,
    hooks: [
      { badge: "PRO-SHOWCASE", cover: "Dein kompletter Karten-Manager im Browser" },
      { badge: "PRO-PASS", cover: "Scanner, Binder, Marktplatz & Pro – in 29 s" },
    ],
    lines: SHOWCASE_LINES,
    overlays: {
      scan: "Dein kompletter Karten-Manager im Browser",
      binder: "Fehlende Karten im Ordner? Sofort finden, tauschen oder kaufen",
      market: "Mit Pro-Abo: Sofortige Preis-Alarme & Top-Boosts für deine Karten",
      finale: "pokeswipe-radar.de – Kostenlos starten, kein Download",
    },
    pro: [
      ["⚡", "Sofortige Preis-Radar-Alarme", "Push, sobald ein Schnäppchen live geht"],
      ["🚀", "Top-Boosts für deine Inserate", "Ganz oben im Marktplatz & Swipe-Tausch"],
      ["📊", "Unbegrenzte Sammlungs-Analysen", "Wert, Gewinner & Set-Fortschritt live"],
    ],
    finale: { domain: DOMAIN, sub: "Kostenlos starten, kein Download", chips: ["✅ Ohne Login-Zwang", "🌐 Läuft im Browser", "⚡ Pro-Abo optional"] },
    stats: [["📸", "Blitz-Scanner"], ["📒", "Set-Binder"], ["⚡", "Pro-Alarme"]],
    badges: ["📸 Live-Scanner mit 1,4×-Zoom", "📒 Set-Ordner mit Lücken-Radar", "🛒 Kaufen, Verkaufen & Swipe-Tausch", "⚡ Pro: Preis-Alarme & Top-Boosts"],
    trust: ["✅ Ohne Login-Zwang", "🌐 Kein Download", "💬 Aktiver Live-Chat", "🔒 Käuferschutz"],
    tags: ["#PokemonSammler", "#PokemonScanner", "#TCGDeutschland", "#PokemonBinder"],
    body: ["📸 Karte vor die Handykamera halten – der Live-Scanner erkennt sie sofort mit aktuellem Preis und sortiert sie direkt in deinen digitalen Set-Ordner.",
      "📒 Beim Durchblättern siehst du sofort, welche Karten dir fehlen – bietet ein Sammler sie an, leuchtet der Preis direkt auf der Lücke auf.",
      "⚡ Mit dem Pro-Abo: sofortige Preis-Radar-Alarme, Top-Boosts für deine Inserate und unbegrenzte Sammlungs-Analysen."],
    captionCta: ["👉 Jetzt kostenlos testen auf pokeswipe-radar.de – kein Download, kein Login-Zwang."],
  },
];
/** Alle Vorlagen des Generators (Standard + Hook-Presets + Showcase). */
export const ALL_TEMPLATES = [...PRO_TEMPLATES, ...SHOWCASE_TEMPLATES];
export const isShowcase = (tpl) => tpl?.format === "showcase";
export const findTemplate = (k) => ALL_TEMPLATES.find((t) => t.key === k) || null;

/** Sätze der Showcase-Vorlage (exakt das Briefing, ohne angehängten Hook/CTA). */
export function showcaseScript(tpl, variant = 0) {
  const hook = tpl.hooks[Math.abs(variant) % tpl.hooks.length];
  const all = tpl.lines.map((l) => ({ say: l.say, show: l.show || l.say }));
  return { cover: hook.cover, badge: hook.badge, say: all.map((l) => l.say), show: all.map((l) => l.show) };
}

/** Wortprüfung mit dem Limit der Vorlage (Showcase 60–84, sonst Standard 52–72). */
export function checkTemplateScript(tpl, lines) {
  if (!isShowcase(tpl) && !tpl?.words) return checkProScript(lines);
  const words = countWords(lines), [min, max] = tpl.words || SHOWCASE_WORDS;
  return { ok: words >= min && words <= max, words, min, max };
}

/** Fester Regie-Zeitplan (auf die tatsächliche Länge D skaliert, falls sie von 29 s abweicht). */
export function showcaseScenes(D = SHOWCASE_SECONDS, plan = SHOWCASE_PLAN) {
  const k = D / plan[plan.length - 1];
  return SHOWCASE_SCENES.map((key, i) => ({ key, start: plan[i] * k, end: plan[i + 1] * k }));
}

/** Beat-Starts der Live-Choreografie = Szenenstarts (Beat i läuft in Szene i). */
export const showcaseMarks = (scenes) => scenes.map((s) => ({ start: s.start, end: s.end }));

/**
 * Regie-Zeitplan der Live-Aktionen (Videozeit in s). Die Choreografie wartet auf diese Zeitpunkte, die Tonspur
 * legt die passenden Mikro-Soundeffekte exakt darauf (Tonspur wird VOR der Aufnahme offline gerendert).
 */
export const SHOWCASE_TIMELINE = Object.freeze({
  scanStart: 0.75, scanMs: 1100, condTap: 2.45, condPick: 3.35, binderTap: 4.4, navCollection: 5.45,
  binderOpen: 6.05, flip1: 7.3, flip2: 8.7, flipBack: 10.0, badgeOn: 11.1, missingTap: 12.9,
  marketPan: 15.05, buyTap: 16.3, priceGlow: 16.75, swipeTab: 17.45, chatTab: 18.35, homeTap: 22.35,
});
/** Zeit vom Start einer Tap-Bewegung bis zum Drücken (LiveStage.tap: Finger fährt 380 ms). */
export const TAP_LEAD = 0.38;

/** Mikro-Sounddesign: [Zeit, Effekt] – Scanner-Beep, Blättern, Erfolgs-Pling, Taps, Übergänge. */
export function showcaseCues(scenes, tl = SHOWCASE_TIMELINE) {
  const [, binder, market, finale] = scenes;
  const D = scenes[scenes.length - 1].end || SHOWCASE_SECONDS;
  const k = D / SHOWCASE_SECONDS;
  const at = (s) => +(s * k).toFixed(3);
  const tap = (s) => [at(s + TAP_LEAD), "tap"];
  const swipe = (s) => [at(s + 0.3 + 0.28), "page"]; // Finger 300 ms hin, dann Blättern zur Hälfte des Wischs
  return [
    [0.02, "softhit"],
    [at(tl.scanStart + 0.05), "scanhum"], [at(tl.scanStart + tl.scanMs / 1000), "beep"],
    tap(tl.condTap), tap(tl.condPick), tap(tl.binderTap), [at(tl.binderTap + TAP_LEAD + 0.12), "drop"], tap(tl.navCollection),
    [binder.start, "whoosh"], swipe(tl.flip1), swipe(tl.flip2), swipe(tl.flipBack), [at(tl.badgeOn), "pling"], tap(tl.missingTap),
    [market.start, "whoosh"], tap(tl.buyTap), [at(tl.priceGlow), "pling"], tap(tl.swipeTab), tap(tl.chatTab),
    [at(SHOWCASE_PRO_AT), "shimmer"], [at(SHOWCASE_PRO_AT + 0.45), "tick"], [at(SHOWCASE_PRO_AT + 0.85), "tick"], [at(SHOWCASE_PRO_AT + 1.25), "tick"],
    tap(tl.homeTap), [finale.start, "whoosh"], [finale.start + 0.9, "chime"],
  ].filter(([t]) => t >= 0 && t <= D).sort((a, b) => a[0] - b[0]);
}

/** Prüfbericht der Showcase-Spezifikation (für Metadaten und Tests). */
export function showcaseSpec(tpl, { duration, fps, mbit, width = 1080, height = 1920 } = {}) {
  if (tpl?.short) return shortSpec(tpl, { duration, fps, mbit, width, height });
  const [lo, hi] = SHOWCASE_MBIT_RANGE;
  const checks = {
    duration: Math.abs(Number(duration) - (tpl.exact || SHOWCASE_SECONDS)) < 0.5 / (fps || SHOWCASE_FPS) + 1e-6,
    fps: Number(fps) === SHOWCASE_FPS, bitrate: Number(mbit) >= lo && Number(mbit) <= hi, size: width === 1080 && height === 1920,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

/** Social-Media-Text des Showcase (Hook, 3 Nutzen-Sätze, CTA, 6–10 Hashtags). */
export function showcaseCaption(tpl, variant = 0, facts = {}) {
  const { cover } = showcaseScript(tpl, variant);
  const hook = `${cover} ⚡`;
  const card = String(facts?.card || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const body = [...tpl.body, ...(card ? [`Im Video live gescannt: ${card}.`] : [])];
  const seen = new Set();
  const hashtags = ["#PokemonTCG", "#PokemonKarten", "#PokeSwipeRadar", ...tpl.tags, "#Pokemon", "#TCGDeals"]
    .filter((t) => { const x = t.toLowerCase(); if (seen.has(x)) return false; seen.add(x); return true; }).slice(0, 10);
  const title = `${tpl.title} | PokeSwipe Radar`.slice(0, 100);
  const caption = [hook, "", ...body, "", ...tpl.captionCta, "", hashtags.join(" ")].join("\n");
  return { title, hook, body, hashtags, caption };
}

// ---------------------------------------------------------------------------------------------------------------
// Master-Vorlage „Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power“ (key "autobinder", Showcase-Familie)
//   exakt 29 s · 9:16 · 1080×1920 · 60 FPS · 11 Mbit/s (10–12) · ElevenLabs-Sprecherin · Mikro-SFX · mittige Untertitel
//   0–6 s   scan     Live-Scanner: Glurak ex in Schutzhülle, Panel mit Bild/Name/NM/Cardmarket-Wert, „📒 Im Set-Ordner
//                    einsortiert“, Tipp auf „🏷️ Als Inserat einstellen“ → Bestätigung
//   6–14 s  binder   Sammlung → Mein Binder (Set „151“): 3×3-Seiten wischen, Holo-Reflex, „2x“ auf Glurak ex,
//                    Umschalter „Doppelte im Gesamtwert mitzählen“ → Wert ändert sich live
//   14–22 s market   Marktplatz → Meine Inserate: „🏷️ Alle Doppelten inserieren (12)“ → Bestätigung → Lade-Animation,
//                    zurück im Ordner: graue Lücke „Auf Marktplatz: 4,50 €“ + eigenes Inserat „Im Verkauf: 12,90 €“
//   22–29 s finale   Community-Live-Chat → Startseite, Abschluss „Kostenlos direkt im Browser – Kein Download nötig“
// Eigene Liste (MASTER_TEMPLATES): Bestehende Vorlagen, Zeitpläne und Grenzen bleiben unverändert.
// Alle Beschriftungen im Bild sind die echten Texte der App.
// ---------------------------------------------------------------------------------------------------------------
export const AUTOBINDER_PLAN = Object.freeze([0, 6, 14, 22, 29]);
/** Wortlimit (exaktes Briefing-Skript ≈ 105 gesprochene Wörter, Sprecherin bei Höchsttempo + Feinanpassung). */
export const AUTOBINDER_WORDS = Object.freeze([95, 110]);
/** Höchste zusätzliche Zeitraffung der Sprecherin (Tonhöhe bleibt), falls Tempo 1,2 für exakt 29 s nicht reicht. */
export const AUTOBINDER_MAX_STRETCH = 1.1;
/** Demo-Ordner: Lücke „Bisaflor ex“ (Nr. 003) mit Marktplatz-Angebot, eigenes Inserat auf Nr. 009, gescannte Karte Nr. 006. */
export const AUTOBINDER_BADGES = Object.freeze({ gap: 4.5, listed: 12.9 });

/** Regie-Zeitplan der Live-Aktionen (Videozeit in s) – Choreografie und Sound-FX nutzen exakt diese Werte. */
export const AUTOBINDER_TIMELINE = Object.freeze({
  scanStart: 0.7, scanMs: 1100, filed: 2.3, sellTap: 3.3, navCollection: 5.2,
  binderOpen: 6.05, flip1: 6.9, flipBack: 8.05, toggleOff: 9.3, toggleOn: 11.0, dupeSpot: 12.5,
  mineOpen: 14.05, bulkTap: 15.15, confirmTap: 16.55, listMs: 1500, binderBack: 19.2, reveal: 19.95, listedSpot: 20.9,
  chatTab: 22.05, homeTap: 25.0, lockup: 25.6,
});

// Kamera (Zeit auf 29 s normiert): Smartphone etwas kleiner und höher – darunter stehen die mittigen Untertitel
const AB_CAMERA = Object.freeze([
  [0, { cx: 505, cy: 800, s: 0.9, rot: -0.03 }], [1.1, { cx: 505, cy: 790, s: 0.9, rot: -0.012 }], [5.5, { cx: 505, cy: 784, s: 0.9, rot: 0 }],
  [6.5, { cx: 505, cy: 780, s: 0.92, rot: 0.01 }], [13.6, { cx: 505, cy: 776, s: 0.94, rot: 0.004 }],
  [14.5, { cx: 505, cy: 782, s: 0.9, rot: -0.008 }], [21.6, { cx: 505, cy: 780, s: 0.92, rot: 0.006 }],
  [22.5, { cx: 505, cy: 784, s: 0.9, rot: 0 }], [24.9, { cx: 505, cy: 784, s: 0.9, rot: 0 }],
  [25.9, { cx: 505, cy: 640, s: 0.66, rot: 0 }], [29, { cx: 505, cy: 634, s: 0.68, rot: 0 }],
]);
// Bildschirm-Zoom [von, bis, Zoom] – 1,0 zeigt die ganze App inkl. 5-Reiter-Navigation
const AB_ZOOM = Object.freeze([
  [0.25, 2.1, 1.38], [2.1, 4.6, 1.24], [4.6, 6.5, 1.0], [6.5, 9.0, 1.08], [9.0, 12.2, 1.22], [12.2, 14.3, 1.1],
  [14.3, 15.0, 1.0], [15.0, 18.9, 1.16], [18.9, 19.8, 1.0], [19.8, 21.9, 1.14], [21.9, 29, 1.0],
]);

/** Exaktes Voiceover aus dem Briefing – ein Satz(-paar) je Sinnabschnitt; gesprochen wird die Domain ausgeschrieben. */
const AUTOBINDER_LINES = [
  { say: "Karten sammeln und verkaufen war noch nie so einfach: Sobald du deine Karte scannst, landet sie automatisch in deinem digitalen Set-Binder!" },
  { say: "Und willst du sie zu Geld machen? Ein Klick genügt, und sie steht auf dem Marktplatz." },
  { say: "Im Ordner behältst du den vollen Überblick: Doppelte werden extra gezählt und du entscheidest, ob sie in die Gesamtsumme einfließen." },
  { say: "Das Beste: Mit nur einem Klick inserierst du alle deine Doppelten auf einmal, während immer eine für deine Sammlung gesichert bleibt!" },
  { say: "Fehlende Karten werden grau angezeigt – und sobald jemand sie anbietet, kannst du sie direkt aus der Lücke kaufen." },
  { say: `Ohne Download kostenlos im Browser: ${SAY_DOMAIN}!`, show: "Ohne Download kostenlos im Browser: pokeswipe-radar.de!" },
];

export const MASTER_TEMPLATES = [
  {
    key: "autobinder", format: "showcase", voiceFormat: "autobinder", master: true,
    label: "Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power",
    choreo: "autobinder", tab: "scan", visual: "showcase",
    title: "Automatischer Set-Binder & 1-Klick-Bulk-Inserate – scannen, sammeln, verkaufen",
    accent: "#38bdf8", gold: "#fbbf24",
    seconds: [SHOWCASE_SECONDS, SHOWCASE_SECONDS], exact: SHOWCASE_SECONDS, fps: SHOWCASE_FPS, mbit: SHOWCASE_MBIT, cbr: true,
    tone: "energetic", maxSpeed: SPEED_CAP, startSpeed: SPEED_CAP, fitVoice: { maxStretch: AUTOBINDER_MAX_STRETCH },
    words: AUTOBINDER_WORDS, plan: AUTOBINDER_PLAN, timeline: AUTOBINDER_TIMELINE,
    binderSet: "sv03.5", binderSetName: "Karmesin & Purpur – 151", badgePrices: AUTOBINDER_BADGES,
    scanKeys: ["card:sv03.5-006", "card:sv03.5-199", "card:sv03.5-025", "card:sv03.5-003"],
    hooks: [
      { badge: "AUTO-BINDER", cover: "Scannen = automatisch im Set-Binder 📒" },
      { badge: "BULK-INSERATE", cover: "Alle Doppelten mit 1 Klick inserieren ⚡" },
    ],
    lines: AUTOBINDER_LINES,
    overlays: {
      scan: "Karten scannen: Automatisch im Set-Binder & sofort im Marktplatz!",
      binder: "Dein digitaler Ordner zählt doppelte Karten automatisch mit!",
      market: "Alle Doppelten mit 1 Klick inserieren – Lücken direkt aus dem Ordner kaufen!",
      finale: "Kostenlos direkt im Browser – Kein Download nötig: pokeswipe-radar.de",
    },
    // Compositor: eigene Kamera, keine Pro-Abo-Einblendung, Untertitel mittig unter dem Smartphone, Abschluss-Lockup ab 25,6 s
    camera: AB_CAMERA, zoomPlan: AB_ZOOM, proAt: null, captionY: 1290, lockupAt: AUTOBINDER_TIMELINE.lockup,
    finaleHeadline: { text: "Kostenlos direkt im Browser – Kein Download nötig: pokeswipe-radar.de", lines: 2, size: 52, y: 300 },
    finale: { domain: DOMAIN, sub: "Jetzt kostenlos loslegen", chips: ["📒 Auto-Binder", "⚡ Bulk-Inserate", "🌐 Läuft im Browser"] },
    stats: [["📸", "Live-Scanner"], ["📒", "Auto-Binder"], ["⚡", "Bulk-Inserate"]],
    badges: ["📸 Scannen → automatisch im Set-Ordner", "🏷️ 1 Tipp: Als Inserat einstellen", "📒 Doppelte zählen & Gesamtwert", "⚡ Alle Doppelten mit 1 Klick inserieren"],
    trust: ["✅ Je 1 Exemplar bleibt im Binder", "🌐 Kein Download", "💬 Aktiver Live-Chat", "🔒 Käuferschutz"],
    tags: ["#PokemonSammler", "#PokemonBinder", "#PokemonVerkaufen", "#TCGDeutschland"],
    body: ["📸 Karte scannen – sie landet automatisch im passenden Set-Ordner deines digitalen Binders. Ein Tipp auf „Als Inserat einstellen“ und sie steht auf dem Marktplatz.",
      "📒 Im Ordner siehst du doppelte Karten mit Zähler und entscheidest per Schalter, ob sie in den Gesamtwert einfließen.",
      "⚡ „Alle Doppelten inserieren“: alle überzähligen Exemplare mit 1 Klick zum Live-Preis online – je 1 Karte bleibt in deiner Sammlung. Fehlende Karten kaufst du direkt aus der Lücke."],
    captionCta: ["👉 Kostenlos direkt im Browser: pokeswipe-radar.de – kein Download nötig."],
  },
];
ALL_TEMPLATES.push(...MASTER_TEMPLATES);
export const isMaster = (tpl) => !!tpl?.master;

/** Mikro-Sounddesign der Master-Vorlage: Scanner-Beep, Ablage, Blättern, Schalter-Ticks, Inserier-Ticks, Erfolgs-Plings. */
export function autobinderCues(scenes, tl = AUTOBINDER_TIMELINE) {
  const [, binder, market, finale] = scenes;
  const D = scenes[scenes.length - 1].end || SHOWCASE_SECONDS;
  const k = D / SHOWCASE_SECONDS;
  const at = (s) => +(s * k).toFixed(3);
  const tap = (s) => [at(s + TAP_LEAD), "tap"];
  const swipe = (s) => [at(s + 0.3 + 0.28), "page"];
  const listTicks = Array.from({ length: 6 }, (_, i) => [at(tl.confirmTap + TAP_LEAD + 0.25 + (i * tl.listMs) / 6000), "tick"]);
  return [
    [0.02, "softhit"],
    [at(tl.scanStart + 0.05), "scanhum"], [at(tl.scanStart + tl.scanMs / 1000), "beep"], [at(tl.filed), "drop"],
    tap(tl.sellTap), [at(tl.sellTap + TAP_LEAD + 0.18), "pling"], tap(tl.navCollection),
    [binder.start, "whoosh"], swipe(tl.flip1), swipe(tl.flipBack),
    tap(tl.toggleOff), [at(tl.toggleOff + TAP_LEAD + 0.1), "tick"], tap(tl.toggleOn), [at(tl.toggleOn + TAP_LEAD + 0.1), "tick"], [at(tl.dupeSpot), "pop"],
    [market.start, "whoosh"], tap(tl.bulkTap), tap(tl.confirmTap), ...listTicks,
    [at(tl.confirmTap + TAP_LEAD + 0.25 + tl.listMs / 1000), "pling"],
    [at(tl.binderBack), "whoosh"], [at(tl.reveal), "pling"], [at(tl.listedSpot), "tick"],
    [finale.start, "whoosh"], tap(tl.chatTab), tap(tl.homeTap), [at(tl.lockup + 0.9), "chime"],
  ].filter(([t]) => t >= 0 && t <= D).sort((a, b) => a[0] - b[0]);
}

/** Sound-Cues einer Showcase-Familien-Vorlage (Pro-Showcase oder Master-Vorlage). */
export const templateCues = (tpl, scenes) => (tpl?.short ? shortCues(tpl, scenes) : tpl?.key === "autobinder" ? autobinderCues(scenes) : showcaseCues(scenes));

// ---------------------------------------------------------------------------------------------------------------
// Kurz-Reels (High-Retention, format "showcase" + short): 8–9 s · 9:16 · 1080×1920 · 60 FPS · 11 Mbit/s
//   • Frame 0 zeigt sofort Action in der echten App (kein Logo-Intro, kein schwarzes Bild, kein Stempel-Badge)
//   • großer Hook-Text ab Frame 0 in der oberen sicheren Zone (y ≈ 250–420, nie hinter TikTok-Buttons/Beschreibung)
//   • alle 1,5–2 s ein visueller Wechsel (Scan, Preis-Pop-up, Blättern, Hochschieben, Zoom)
//   • Standard OHNE KI-Stimme: nur knackige UI-Soundeffekte (Scanner-Ping, Blättern, Klick) – Trending-Sound passt darüber.
//     Voiceover optional per Schalter im Generator (Standard AUS).
//   • Kein Ausblenden ins Schwarze: das letzte Bild (End-Tag) loopt sauber in Frame 0
// Alle Oberflächen sind die echte Live-Website in der 9:16-Stage (Live-Scanner, 3D-Set-Binder, 16er Marktplatz-Binder,
// 👆 Hochschieben, 📦 Pokémon-Artikel-Verkaufsseite). Eigene Liste: bestehende Vorlagen bleiben unverändert.
// ---------------------------------------------------------------------------------------------------------------
export const SHORT_FPS = 60;
export const SHORT_MBIT = 11;
/** Erlaubte Länge der Kurz-Reels (s). */
export const SHORT_RANGE = Object.freeze([7, 10]);
/** Wortlimit des optionalen Voiceovers (≈ 2,6 Wörter/s). */
export const SHORT_WORDS = Object.freeze([10, 26]);
/** Obere sichere Zone für den Hook-Text (Mitte y). */
export const SHORT_HOOK_Y = 350;

/** Regie-Zeitpläne (Videozeit in s) – Choreografie, Kamera und Mikro-SFX nutzen exakt diese Werte. */
export const SHORT_TIMELINES = Object.freeze({
  shortscan: Object.freeze({ scanStart: 0.05, scanMs: 850, pricePop: 0.95, filed: 1.75, binderOpen: 2.15, scannedSpot: 2.75,
    scanner2: 3.6, scan2Start: 3.75, scan2Ms: 650, instantTap: 4.55, marketOpen: 5.5, sheetOpen: 5.95, lockup: 6.5 }),
  shortbinder: Object.freeze({ flip1: 0.0, flip2: 1.15, tagSpot: 2.1, reveal: 2.85, gapTap: 3.55, sheetOpen: 4.35, buyTap: 5.35,
    binderBack: 6.5, pan: 6.75, lockup: 7.4 }),
  shortmarket: Object.freeze({ turn1: 0.0, dealSpot: 1.25, dealTap: 2.0, sheetSpot: 2.75, closeTap: 3.4, swipeMode: 3.85,
    up1: 4.45, up2: 5.45, buyTap: 6.55, lockup: 7.3 }),
  shortitems: Object.freeze({ up1: 0.05, up2: 1.05, up3: 2.0, sellOpen: 2.9, photo: 3.25, fields: 3.7, condTap: 4.3, catTap: 4.95,
    submitTap: 5.45, marketAll: 6.0, turn: 6.2, lockup: 6.7 }),
});

const shortCamera = (lockup, D) => Object.freeze([
  [0, { cx: 505, cy: 962, s: 0.96, rot: -0.02 }], [1.2, { cx: 505, cy: 958, s: 0.96, rot: -0.006 }],
  [lockup - 0.6, { cx: 505, cy: 956, s: 0.97, rot: 0.004 }], [lockup + 0.45, { cx: 505, cy: 700, s: 0.64, rot: 0 }], [D, { cx: 505, cy: 694, s: 0.66, rot: 0 }],
]);

const SHORT_BASE = {
  format: "showcase", short: true, visual: "showcase", gold: "#fbbf24",
  fps: SHORT_FPS, mbit: SHORT_MBIT, cbr: true, tone: "energetic", maxSpeed: SPEED_CAP, startSpeed: SPEED_CAP, words: SHORT_WORDS,
  proAt: null, noFade: true, sfxOnly: true, captionY: 1290, binderSet: "sv03.5", binderSetName: "Karmesin & Purpur – 151",
  tags: ["#PokemonKarten", "#PokemonSammler", "#TCGDeutschland"],
};

export const SHORT_TEMPLATES = [
  {
    ...SHORT_BASE, key: "shortscan", label: "Kurz-Reel 1: Verbesserter Live-Scanner & Preisschild (8 s)",
    choreo: "shortscan", tab: "scan", accent: "#22d3ee",
    title: "Live-Scanner: Karte scannen, Preis sofort, automatisch im Binder, Schnell-Inserieren",
    seconds: [8, 8], exact: 8, plan: Object.freeze([0, 1.8, 3.6, 5.5, 8]), timeline: SHORT_TIMELINES.shortscan,
    scanKeys: ["card:sv03.5-199", "card:sv03.5-205", "card:sv03.5-006", "card:sv03.5-025"], nextKeys: ["card:sv03.5-025", "card:sv03.5-006"],
    hooks: [{ badge: "", cover: "Dein Handy scannt Pokémon-Karten jetzt schneller als du blinzeln kannst 👀⚡" }],
    lines: [{ say: "Karte vors Handy, Preis steht sofort, sie landet automatisch im Binder – und mit einem Tipp ist sie auf dem Marktplatz." }],
    overlays: {
      scan: "Dein Handy scannt Pokémon-Karten jetzt schneller als du blinzeln kannst 👀⚡",
      binder: "📒 Landet automatisch im richtigen Set",
      market: "⚡ Nächste Karte – Schnell-Inserieren",
      finale: "🛒 Live auf dem Marktplatz – unter Cardmarket-Preis",
    },
    finaleHeadline: { text: "🛒 Live auf dem Marktplatz – unter Cardmarket-Preis", lines: 2, size: 50, y: 300 },
    finale: { domain: DOMAIN, sub: "Kostenlos testen", chips: [] },
    zoomPlan: Object.freeze([[0, 1.7, 1.32], [1.7, 2.2, 1.0], [2.2, 3.5, 1.12], [3.5, 3.8, 1.0], [3.8, 5.4, 1.22], [5.4, 8, 1.04]]),
    body: ["📸 Karte frei vors Handy halten – der Live-Scanner erkennt sie in Sekundenbruchteilen und zeigt sofort das Preisschild.",
      "📒 Sie landet automatisch im richtigen Set-Ordner. ⚡ Schnell-Inserieren: 1 Tipp und sie steht unter Cardmarket-Preis auf dem Marktplatz."],
    captionCta: ["👉 pokeswipe-radar.de – kostenlos testen, kein Download."],
  },
  {
    ...SHORT_BASE, key: "shortbinder", label: "Kurz-Reel 2: Echtes 3D-Binder-Blättern & Preisetiketten (9 s)",
    choreo: "shortbinder", tab: "portfolio", accent: "#fbbf24", gold: "#22d3ee",
    title: "Digitaler Pokémon-Ordner mit echtem 3D-Blättern, Preisetiketten und Marktplatz-Lücken",
    seconds: [9, 9], exact: 9, plan: Object.freeze([0, 2.0, 4.3, 6.5, 9]), timeline: SHORT_TIMELINES.shortbinder, gapPrice: 6.5,
    hooks: [{ badge: "", cover: "Endlich ein digitaler Pokémon-Ordner, der sich anfühlt wie echt 🔥📖" }],
    lines: [{ say: "Blättern wie im echten Ordner – mit Preis an jeder Karte, und fehlende Karten kaufst du direkt aus der Lücke." }],
    overlays: {
      scan: "Endlich ein digitaler Pokémon-Ordner, der sich anfühlt wie echt 🔥📖",
      binder: "💶 Live-Preis an jeder Karte",
      market: "🛒 Fehlt? 1 Tipp – direkt zum Angebot",
      finale: "📖 Dein ganzes Set auf einen Blick",
    },
    finaleHeadline: { text: "📖 Dein ganzes Set auf einen Blick", lines: 1, size: 52, y: 300 },
    finale: { domain: DOMAIN, sub: "Kostenlos testen", chips: [] },
    zoomPlan: Object.freeze([[0, 2.0, 1.06], [2.0, 4.2, 1.2], [4.2, 6.4, 1.08], [6.4, 9, 1.0]]),
    body: ["📖 Dein Set-Ordner blättert sich wie echt – mit Falz-Schatten, Folien-Glanz und Live-Preis an jeder Karte.",
      "🛒 An fehlenden Karten steht direkt der günstigste Marktplatz-Preis (oder eBay) – 1 Tipp öffnet das Angebot."],
    captionCta: ["👉 pokeswipe-radar.de – kostenlos, direkt im Browser."],
  },
  {
    ...SHORT_BASE, key: "shortmarket", label: "Kurz-Reel 3: 16er Marktplatz-Binder & Echtes Hochschieben (9 s)",
    choreo: "shortmarket", tab: "map", accent: "#34d399",
    title: "16 Sammler-Deals auf einer Ordnerseite + Hochschieben wie bei Reels",
    seconds: [9, 9], exact: 9, plan: Object.freeze([0, 2.0, 4.4, 6.5, 9]), timeline: SHORT_TIMELINES.shortmarket,
    hooks: [{ badge: "", cover: "16 echte Sammler-Deals auf einer Seite – einfach spontan mitnehmen 🤯" }],
    lines: [{ say: "Sechzehn Deals auf einer Ordnerseite, ein Tipp für Details – oder einfach hochschieben und spontan mitnehmen." }],
    overlays: {
      scan: "16 echte Sammler-Deals auf einer Seite – einfach spontan mitnehmen 🤯",
      binder: "👆 1 Tipp – Deal-Details",
      market: "👆 Hochschieben wie bei Reels",
      finale: "⚡ Spontan mitnehmen – mit Käuferschutz",
    },
    finaleHeadline: { text: "⚡ Spontan mitnehmen – mit Käuferschutz", lines: 1, size: 50, y: 300 },
    finale: { domain: DOMAIN, sub: "0 % Gebühren zum Start", chips: [] },
    zoomPlan: Object.freeze([[0, 2.0, 1.04], [2.0, 3.8, 1.08], [3.8, 6.4, 1.06], [6.4, 9, 1.0]]),
    body: ["📖 Der 16er Marktplatz-Binder zeigt 16 echte Inserate auf einer Ordnerseite – Deals unter Cardmarket sind grün markiert.",
      "👆 Oder hochschieben wie bei Reels: Karte für Karte, mit „⚡ Spontan mitnehmen“ immer griffbereit."],
    captionCta: ["👉 pokeswipe-radar.de – 0 % Gebühren zum Start."],
  },
  {
    ...SHORT_BASE, key: "shortitems", label: "Kurz-Reel 4: NEU – Pokémon-Artikel verkaufen & entdecken (8 s)",
    choreo: "shortitems", tab: "map", accent: "#a78bfa",
    title: "Nicht nur Karten: Displays, ETBs, Ordner & Zubehör verkaufen und entdecken",
    seconds: [8, 8], exact: 8, plan: Object.freeze([0, 2.0, 4.0, 6.0, 8]), timeline: SHORT_TIMELINES.shortitems,
    hooks: [{ badge: "", cover: "Nicht nur Karten – verkaufe jetzt auch Displays, ETBs & Zubehör ohne Gebühren 📦⚡" }],
    lines: [{ say: "Displays, Top-Trainer-Boxen, Ordner und Zubehör: Foto, Zustand, Preis – fertig. Karten und Artikel in einer App." }],
    overlays: {
      scan: "Nicht nur Karten – verkaufe jetzt auch Displays, ETBs & Zubehör ohne Gebühren 📦⚡",
      binder: "📦 Displays · ETBs · Ordner & Zubehör",
      market: "📷 Foto · Zustand · Preis – fertig",
      finale: "🃏 Karten + 📦 Artikel in einer App",
    },
    finaleHeadline: { text: "🃏 Karten + 📦 Artikel in einer App", lines: 1, size: 52, y: 300 },
    finale: { domain: DOMAIN, sub: "Kostenlos testen", chips: [] },
    zoomPlan: Object.freeze([[0, 2.9, 1.04], [2.9, 6.0, 1.12], [6.0, 8, 1.0]]),
    body: ["📦 Neu: Pokémon-Artikel verkaufen – Booster & Displays, ETBs & Kollektionen, Ordner & Zubehör, Plüsch & Sammlungen.",
      "📷 Foto hochladen, Zustand wählen (z. B. Neu & OVP), Preis eintragen – fertig. Karten und Artikel in einer App."],
    captionCta: ["👉 pokeswipe-radar.de – kostenlos inserieren."],
  },
].map((t) => ({ ...t, camera: shortCamera(t.timeline.lockup, t.exact), lockupAt: t.timeline.lockup }));
ALL_TEMPLATES.push(...SHORT_TEMPLATES);
// Jede Vorlage – aktueller Haupt-Ordner und Archiv – spricht mit derselben fest hinterlegten ElevenLabs-Stimme.
for (const t of new Set([...PRO4_TEMPLATES, ...PRO_TEMPLATES, ...SHOWCASE_TEMPLATES, ...MASTER_TEMPLATES, ...FEATURE15_TEMPLATES, ...SHORT_TEMPLATES])) t.voiceId = PRO4_VOICE_ID;
export const isShort = (tpl) => !!tpl?.short;

/** Mikro-Sounddesign der Kurz-Reels: Scanner-Ping, Blättern, Klicks, Erfolgs-Plings – exakt auf den Regie-Zeitplan. */
export function shortCues(tpl, scenes) {
  const tl = tpl?.timeline || {};
  const D = scenes[scenes.length - 1]?.end || tpl?.exact || 8;
  const k = D / (tpl?.exact || D);
  const at = (s) => +(s * k).toFixed(3);
  const tap = (s) => [at(s + TAP_LEAD), "tap"];
  const page = (s) => [at(s + 0.3 + 0.28), "page"];
  const up = (s) => [at(s + 0.26 + 0.3), "swipe"];
  const cues = { // Frame 0 startet mit einem weichen Akzent – sofort hörbar, ohne Intro
    shortscan: [[0.02, "softhit"], [at(tl.scanStart + 0.02), "scanhum"], [at(tl.scanStart + tl.scanMs / 1000), "beep"], [at(tl.pricePop + 0.05), "coin"],
      [at(tl.filed), "drop"], [at(tl.binderOpen), "whoosh"], [at(tl.scannedSpot), "pop"], [at(tl.scanner2), "whoosh"],
      [at(tl.scan2Start + 0.02), "scanhum"], [at(tl.scan2Start + tl.scan2Ms / 1000), "beep"], tap(tl.instantTap), [at(tl.instantTap + TAP_LEAD + 0.2), "pling"],
      [at(tl.marketOpen), "whoosh"], [at(tl.sheetOpen), "pop"], [at(tl.lockup + 0.5), "chime"]],
    shortbinder: [[0.02, "softhit"], page(tl.flip1), page(tl.flip2), [at(tl.tagSpot), "tick"], [at(tl.reveal), "pling"], tap(tl.gapTap),
      [at(tl.sheetOpen), "whoosh"], tap(tl.buyTap), [at(tl.binderBack), "whoosh"], page(tl.pan), [at(tl.lockup + 0.5), "chime"]],
    shortmarket: [[0.02, "softhit"], page(tl.turn1), [at(tl.dealSpot), "pling"], tap(tl.dealTap), [at(tl.dealTap + TAP_LEAD + 0.1), "pop"],
      tap(tl.closeTap), tap(tl.swipeMode), up(tl.up1), up(tl.up2), [at(tl.up2 + 0.9), "shimmer"], tap(tl.buyTap), [at(tl.buyTap + TAP_LEAD + 0.15), "coin"], [at(tl.lockup + 0.5), "chime"]],
    shortitems: [[0.02, "softhit"], up(tl.up1), up(tl.up2), up(tl.up3), [at(tl.sellOpen), "whoosh"], [at(tl.photo), "drop"], [at(tl.fields), "tick"],
      tap(tl.condTap), tap(tl.catTap), tap(tl.submitTap), [at(tl.submitTap + TAP_LEAD + 0.15), "pling"], [at(tl.marketAll), "whoosh"], page(tl.turn), [at(tl.lockup + 0.5), "chime"]],
  }[tpl?.key] || [[0.02, "softhit"]];
  return cues.filter(([t]) => t >= 0 && t <= D).sort((a, b) => a[0] - b[0]);
}

/** Prüfbericht der Kurz-Reel-Spezifikation (7–10 s, 60 FPS, 10–12 Mbit/s, 1080×1920). */
export function shortSpec(tpl, { duration, fps, mbit, width = 1080, height = 1920 } = {}) {
  const [lo, hi] = SHOWCASE_MBIT_RANGE, [smin, smax] = SHORT_RANGE;
  const d = Number(duration);
  const checks = {
    duration: d >= smin - 1e-6 && d <= smax + 1e-6 && Math.abs(d - (tpl?.exact || d)) < 0.5 / (fps || SHORT_FPS) + 1e-6,
    fps: Number(fps) === SHORT_FPS, bitrate: Number(mbit) >= lo && Number(mbit) <= hi, size: width === 1080 && height === 1920,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
