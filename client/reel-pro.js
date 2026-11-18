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

export const templateByKey = (k) => PRO_TEMPLATES.find((t) => t.key === k) || null;

export const isHook4 = (tpl) => tpl?.format === "hook4";
/** Szenen-Schlüssel einer Vorlage (5 Standard-Szenen bzw. 4 Hook-Szenen). */
export const scenesFor = (tpl) => (isHook4(tpl) ? HOOK4_SCENES : PRO_SCENES);

/** Die Sätze einer Vorlage (5 Standard / 4 Hook-Presets). variant wählt die Hook-Schlagzeile (rotiert). */
export function proScript(tpl, variant = 0) {
  const hook = tpl.hooks[Math.abs(variant) % tpl.hooks.length];
  // Hook-Presets: der erste Satz IST der Hook (Sprecherin startet sofort), kein angehängter Standard-CTA
  const src = isHook4(tpl) ? tpl.lines : [{ say: hook.say, show: hook.say }, ...tpl.lines, tpl.cta || CTA_LINE];
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
  return s && s[0] > 0 && s[1] > s[0] ? [s[0], s[1]] : [PRO_MIN_S, PRO_MAX_S];
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
    const words = String(line).split(/\s+/).filter(Boolean);
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
