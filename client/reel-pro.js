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

/** Die 5 Sätze einer Vorlage. variant wählt die Hook-Schlagzeile (rotiert). */
export function proScript(tpl, variant = 0) {
  const hook = tpl.hooks[Math.abs(variant) % tpl.hooks.length];
  const all = [{ say: hook.say, show: hook.say }, ...tpl.lines, CTA_LINE].map((l) => ({ say: l.say, show: l.show || l.say }));
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
export function sceneTimes(marks, D) {
  const PRE = 0.2, MIN = 1.0;
  const s = [0];
  for (let i = 1; i < PRO_SCENES.length; i++) {
    const m = marks[i], prev = marks[i - 1];
    let b = m ? m.start - PRE : (D * i) / PRO_SCENES.length;
    if (m && prev) b = Math.max(b, Math.min(m.start, (prev.end + m.start) / 2));
    s.push(Math.max(0, b));
  }
  s[1] = Math.max(1.2, s[1]); // Cover steht mindestens 1,2 s
  for (let i = 2; i < s.length; i++) s[i] = Math.max(s[i], s[i - 1] + MIN);
  s[4] = Math.min(s[4], Math.max(s[3] + MIN, D - 1.5)); // Endscreen mindestens 1,5 s
  return PRO_SCENES.map((key, i) => ({ key, start: s[i], end: i < 4 ? s[i + 1] : D }));
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

/** Sprechtempo für die Ziellänge: Dauer bei Tempo 1 → Tempo im erlaubten Bereich (0,9–1,12). */
export function speedFor(duration, speed) {
  const total = duration + PRO_PAD; // Vorlauf + Ausblenden
  if (total > PRO_MAX_S) return Math.min(1.12, Math.round(speed * (total / (PRO_MAX_S - 0.5)) * 100) / 100);
  if (total < PRO_MIN_S) return Math.max(0.9, Math.round(speed * (total / (PRO_MIN_S + 0.5)) * 100) / 100);
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
  const { cover } = proScript(tpl, variant);
  const emoji = { overview: "🚀", radar: "📡", swipe: "👆", market: "🛡️", portfolio: "📈" }[tpl.key] || "🔥";
  const hook = `${cover} ${emoji}`;
  const card = String(facts?.card || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const body = [...tpl.body, ...(card ? [`Im Video live dabei: ${card}.`] : [])];
  const seen = new Set();
  const hashtags = [...HASH_BASE, ...tpl.tags, "#TCGDeals", "#PokemonDeutschland"]
    .filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  const cta = `👉 ${CTA_TEXT} – Link in der Bio!`;
  const title = `${tpl.title} | PokeSwipe Radar`.slice(0, 100);
  const caption = [hook, "", ...body, "", cta, "", hashtags.join(" ")].join("\n");
  return { title, hook, body, hashtags, caption };
}
