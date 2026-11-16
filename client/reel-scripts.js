// Sprechertexte, Wortlimits und externe Post-Beschreibungen (Captions) für die Live-Reels.
// Reines Daten-/Logik-Modul ohne DOM-Zugriff – wird vom Reel Studio, von Auto-Reels (10x)
// und von den Tests (tests/reel-scripts.test.ts) gemeinsam genutzt.
//
// Jedes Szenario hat genau 4 Sprecher-Sätze (Hook → Live-Aktion 1 → Live-Aktion 2 → Call to Action).
// Jeder Satz gehört zu einem "Beat" der Live-Choreografie auf der echten Website (client/reel-scenarios.js):
// Der Beat startet, sobald die Sprecherin den Satz beginnt (Zeitstempel aus ElevenLabs).

/** Erlaubte Wortanzahl des kompletten Voiceovers je Reel-Länge (Sekunden). */
export const WORD_LIMITS = Object.freeze({ 15: Object.freeze([32, 36]), 30: Object.freeze([65, 72]) });
export const LENGTHS = Object.freeze([15, 30]);

/** Wörter wie die Sprecherin sie spricht: alles mit Buchstabe oder Ziffer zählt als Wort. */
export function countWords(text) {
  const s = Array.isArray(text) ? text.join(" ") : String(text ?? "");
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Prüft ein Skript gegen das Wortlimit. Liefert { ok, words, min, max }. */
export function checkScript(lines, len) {
  const [min, max] = WORD_LIMITS[len] || WORD_LIMITS[30];
  const words = countWords(lines);
  return { ok: words >= min && words <= max, words, min, max };
}

/**
 * Skript auf das Wortlimit bringen: zu lange Skripte werden am Satzende des vorletzten Satzes
 * (nie Hook oder Call to Action) wortweise gekürzt, damit die Stimme entspannt bis zum letzten Wort durchspricht.
 * Zu kurze Skripte bleiben unverändert (checkScript meldet sie).
 */
export function fitScript(lines, len) {
  const [, max] = WORD_LIMITS[len] || WORD_LIMITS[30];
  const out = lines.map((l) => String(l).replace(/\s+/g, " ").trim());
  let over = countWords(out) - max;
  for (let i = out.length - 2; i >= 1 && over > 0; i--) {
    const words = out[i].split(" ");
    const keep = Math.max(4, words.length - over);
    over -= words.length - keep;
    out[i] = words.slice(0, keep).join(" ").replace(/[,;:–-]+$/, "") + (/[.!?]$/.test(words.slice(0, keep).join(" ")) ? "" : ".");
  }
  return out;
}

const CTA15 = "Teste PokeSwipe Radar jetzt kostenlos, der Link ist in der Bio.";
const CTA30 = "Probier PokeSwipe Radar jetzt kostenlos aus und finde deinen nächsten Deal. Den Link findest du direkt in der Bio.";

/** Die 10 Live-Szenarien. tab = Startbereich der echten App, tags = szenariospezifische Hashtags. */
export const SCENARIOS = [
  {
    key: "arena", n: 1, tab: "swipe", label: "Swipe-Arena",
    title: "Swipe-Arena: Karten swipen, Deals finden",
    tags: ["#PokemonSammler", "#TCGDeutschland"],
    vo: {
      15: [
        "Was ist diese Karte gerade wirklich wert?",
        "In der Swipe-Arena wischst du nach links oder rechts.",
        "Rechts merkt sie sich, die Details zeigen den Live-Preis.",
        CTA15,
      ],
      30: [
        "Kennst du den aktuellen Marktwert dieser Karte, ohne lange zu suchen?",
        "In der Swipe-Arena von PokeSwipe Radar wischst du nach links, wenn dich eine Karte nicht interessiert, und nach rechts, wenn du sie willst.",
        "Jeder Rechts-Swipe landet in deiner Merkliste, und ein Tippen auf die Details zeigt dir den echten Cardmarket-Preis samt Verlauf.",
        CTA30,
      ],
    },
  },
  {
    key: "flip", n: 2, tab: "flip", label: "Live Flip-Radar",
    title: "Live Flip-Radar: Schnäppchen unter Marktwert",
    tags: ["#PokemonDeals", "#FlipRadar"],
    vo: {
      15: [
        "Dieses Angebot liegt gerade deutlich unter Marktwert.",
        "Der Flip-Radar listet live echte Deals unter dem Trendpreis.",
        "Ein Tippen öffnet die Preis-Analyse mit echten Verkaufspreisen.",
        CTA15,
      ],
      30: [
        "Genau solche Angebote unter Marktwert verpasst du sonst, weil sie in Minuten weg sind.",
        "Der Flip-Radar von PokeSwipe Radar vergleicht laufend echte Angebote mit dem Cardmarket-Trend und zeigt dir die größten Rabatte zuerst.",
        "Ein Tippen auf die Verkaufspreise öffnet die Preis-Analyse mit echten Verkäufen, damit du sofort siehst, ob sich der Kauf lohnt.",
        CTA30,
      ],
    },
  },
  {
    key: "restock", n: 3, tab: "flip", label: "Restock-Radar",
    title: "Restock-Radar: Displays zur UVP statt Scalper-Preis",
    tags: ["#PokemonRestock", "#UVP"],
    vo: {
      15: [
        "Schon wieder alles ausverkauft, bevor du klicken konntest?",
        "Das Restock-Radar prüft die großen Shops alle zwei Minuten.",
        "Die UVP-Ampel zeigt dir sofort, ob der Preis fair ist.",
        CTA15,
      ],
      30: [
        "Displays und Elite-Trainer-Boxen sind oft in Minuten weg, und danach zahlst du Scalper-Preise.",
        "Das Restock-Radar von PokeSwipe Radar prüft Amazon, Müller, Smyths und weitere Shops alle zwei Minuten und meldet jeden Restock per Push.",
        "Die UVP-Ampel zeigt dir auf einen Blick, ob der Preis fair ist, und die Community bestätigt Funde aus dem Laden.",
        CTA30,
      ],
    },
  },
  {
    key: "portfolio", n: 4, tab: "portfolio", label: "Sammlung & Portfolio",
    title: "Sammlung live: Portfolio-Gesamtwert",
    tags: ["#Sammlungswert", "#PokemonCollection"],
    vo: {
      15: [
        "Was ist deine Sammlung heute wert?",
        "Im Portfolio siehst du den Gesamtwert live mit echten Preisen.",
        "Scroll durch deine Karten und tippe für Details.",
        CTA15,
      ],
      30: [
        "Weißt du eigentlich, wie viel deine komplette Pokémon-Sammlung heute auf dem Markt wert ist?",
        "Im Portfolio von PokeSwipe Radar siehst du den Gesamtwert deiner Sammlung live, berechnet mit aktuellen Cardmarket-Preisen für jede einzelne Karte.",
        "Scroll durch deine Karten, sieh dir Gewinner und Verlierer an und tippe auf jede Karte für den kompletten Preisverlauf.",
        CTA30,
      ],
    },
  },
  {
    key: "scanner", n: 5, tab: "scan", label: "Karten-Scanner & Suche",
    title: "Karten-Scanner: Preis in Sekunden",
    tags: ["#KartenScanner", "#PreisCheck"],
    vo: {
      15: [
        "Du willst den Kartenpreis sofort wissen?",
        "Gib im Scanner den Namen ein oder nutz die Kamera.",
        "Ein Tippen auf den Treffer zeigt dir den Live-Preis.",
        CTA15,
      ],
      30: [
        "Du hältst eine Karte in der Hand und willst sofort wissen, was sie wert ist?",
        "Im Scanner von PokeSwipe Radar gibst du einfach den Namen ein oder hältst die Karte vor die Kamera.",
        "Die Treffer kommen aus der deutschen Kartendatenbank, und ein Tippen zeigt dir den Live-Preis mit dreißig Tagen Verlauf.",
        CTA30,
      ],
    },
  },
  {
    key: "pricecheck", n: 6, tab: "swipe", label: "Preis-Check & Kartendetails",
    title: "Preis-Check: Trend, Tiefstpreis und Verlauf",
    tags: ["#Cardmarket", "#PreisCheck"],
    vo: {
      15: [
        "Zahlst du gerade zu viel für deine Wunschkarte?",
        "Die Profi-Werte zeigen Trend, günstigstes Angebot und Ersparnis.",
        "In den Kartendetails siehst du den kompletten Preisverlauf.",
        CTA15,
      ],
      30: [
        "Bevor du deine nächste Karte kaufst, solltest du genau wissen, ob der Preis gerade fair ist.",
        "Die Profi-Werte in PokeSwipe Radar zeigen dir den Cardmarket-Trend, das günstigste Angebot und wie viel du gegenüber dem Marktwert sparst.",
        "In den Kartendetails findest du außerdem den kompletten Preisverlauf, damit du nie wieder zum falschen Zeitpunkt kaufst.",
        CTA30,
      ],
    },
  },
  {
    key: "graded", n: 7, tab: "portfolio", label: "Graded-Portfolio",
    title: "Graded-Portfolio: Lohnt sich PSA für deine Karte?",
    tags: ["#PSA10", "#PokemonGrading"],
    vo: {
      15: [
        "Lohnt sich PSA für deine Karte wirklich?",
        "Der Grading-Rechner vergleicht Gebühren mit echten Verkaufspreisen.",
        "Und im Graded-Portfolio behältst du alle Slabs im Blick.",
        CTA15,
      ],
      30: [
        "Bevor du Karten zum Grading schickst, solltest du wissen, ob sich die Gebühren überhaupt lohnen.",
        "Der Grading-Rechner von PokeSwipe Radar vergleicht den Rohwert mit echten Verkaufspreisen für PSA acht, neun und zehn.",
        "Im Graded-Portfolio siehst du danach jeden Slab mit Note, Zertifikat und Wert, und der Einsendungs-Tracker erinnert dich an überfällige Rücksendungen.",
        CTA30,
      ],
    },
  },
  {
    key: "market", n: 8, tab: "map", label: "Tausch-Markt",
    title: "Tausch-Markt: Karten von Sammlern in deiner Nähe",
    tags: ["#PokemonTausch", "#TCGDeutschland"],
    vo: {
      15: [
        "Deine Wunschkarte liegt vielleicht schon bei jemandem in der Nähe.",
        "Im Tausch-Markt findest du echte Inserate anderer Sammler.",
        "Ein Tippen startet direkt die Tausch-Anfrage.",
        CTA15,
      ],
      30: [
        "Deine nächste Wunschkarte liegt vielleicht schon im Binder von einem Sammler ganz in deiner Nähe.",
        "Im Tausch-Markt von PokeSwipe Radar findest du echte Inserate anderer Sammler, mit Preis, Stadt und den Karten, die sie selbst suchen.",
        "Passt ein Angebot, startest du mit einem Tippen die Tausch-Anfrage und klärst alles sicher im Chat.",
        CTA30,
      ],
    },
  },
  {
    key: "community", n: 9, tab: "community", label: "Pull-Wall & Community",
    title: "Pull-Wall: die besten Pulls der Community",
    tags: ["#PullWall", "#PokemonCommunity"],
    vo: {
      15: [
        "Welche Hits ziehen andere Sammler gerade?",
        "Auf der Pull-Wall teilt die Community ihre besten Pulls.",
        "Scroll durch den Feed und poste deinen eigenen Hit.",
        CTA15,
      ],
      30: [
        "Hast du dich auch schon gefragt, welche Hits andere Sammler gerade aus ihren Boostern ziehen?",
        "Auf der Pull-Wall von PokeSwipe Radar teilt die Community ihre besten Pulls, direkt mit Foto, Karte und aktuellem Marktwert.",
        "Scroll durch den Feed, lass dich inspirieren und poste deinen eigenen Hit, damit alle sehen, was du gezogen hast.",
        CTA30,
      ],
    },
  },
  {
    key: "tour", n: 10, tab: "swipe", label: "App-Tour",
    title: "App-Tour: Swipe, Flip-Radar und Sammlung",
    tags: ["#PokemonApp", "#TCGApp"],
    vo: {
      15: [
        "Eine App für alles, was Sammler wirklich brauchen.",
        "Karten swipen, Deals im Flip-Radar finden und vergleichen.",
        "Und in der Sammlung siehst du deinen Gesamtwert.",
        CTA15,
      ],
      30: [
        "Eine einzige App für alles, was Pokémon-Sammler in Deutschland wirklich brauchen.",
        "In der Swipe-Arena entdeckst du Karten, und der Flip-Radar zeigt dir live echte Angebote unter dem aktuellen Marktwert.",
        "In deiner Sammlung siehst du jederzeit den Gesamtwert, und das Restock-Radar meldet dir neue Displays zur UVP.",
        CTA30,
      ],
    },
  },
];

export const scenarioByKey = (key) => SCENARIOS.find((s) => s.key === key) || SCENARIOS[0];

/** Sprechertext eines Szenarios in der gewünschten Länge – immer innerhalb des Wortlimits. */
export function scriptFor(sc, len) {
  const lines = sc.vo[len] || sc.vo[30];
  return fitScript(lines, len);
}

// ---------------------------------------------------------------------------
// Externer Post-Beschreibungstext (Caption) – NICHT im Video, sondern als Begleittext
// ---------------------------------------------------------------------------
export const BASE_TAGS = ["#PokemonTCG", "#PokemonKarten", "#PokeSwipeRadar", "#TCGDeals"];
export const CTA_LINE = "Jetzt kostenlos testen auf pokeswipe-radar.de – Link in der Bio 👇";

const clean = (s, max = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "Pikachu-ex (238/191)" → "#Pikachu"; liefert "" für Unbrauchbares. */
export function pokemonTag(title) {
  const first = clean(title).split(/[\s(–-]/)[0] || "";
  const word = first.replace(/[^A-Za-zÄÖÜäöüß0-9]/g, "");
  if (word.length < 3 || /^\d+$/.test(word) || /^(pokemon|karte|booster|display)$/i.test(word)) return "";
  return `#${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** 5–8 eindeutige Hashtags: Basis + Szenario + (falls bekannt) das gezeigte Pokémon. */
export function hashtagsFor(sc, facts = {}) {
  const list = [...BASE_TAGS, ...(sc.tags || [])];
  const poke = pokemonTag(facts.card);
  if (poke) list.push(poke);
  const seen = new Set();
  const out = list.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const fill = ["#PokemonDeutschland", "#TCGCommunity"];
  while (out.length < 5) out.push(fill[out.length % fill.length]);
  return out.slice(0, 8);
}

/** Hook (Zeile 1) passend zur im Video gezeigten Karte bzw. Live-Funktion. */
function hookFor(sc, f) {
  const card = clean(f.card, 60);
  switch (sc.key) {
    case "arena": return card ? `Würdest du ${card} nach rechts swipen? 👀` : "Links oder rechts? So swipst du dich zum nächsten Deal 👀";
    case "flip": return card && f.pct ? `${card} gerade ${f.pct} unter Marktwert 🚨` : "Dieses Angebot liegt gerade unter Marktwert 🚨";
    case "restock": return card ? `${card} wieder da – zur UVP? 🚨` : "Nie wieder Scalper-Preise für Displays 🚨";
    case "portfolio": return f.total ? `Diese Sammlung ist gerade ${f.total} wert 📈` : "Was ist deine Sammlung heute wirklich wert? 📈";
    case "scanner": return card ? `Was ist ${card} gerade wert? Wir haben nachgeschaut 🔎` : "Kartenpreis in Sekunden statt Minuten 🔎";
    case "pricecheck": return card && f.price ? `${card}: ${f.price} – fair oder zu teuer? 💶` : "Zahlst du zu viel für deine Wunschkarte? 💶";
    case "graded": return card ? `${card} als PSA 10 – lohnt sich das? 💎` : "Lohnt sich Grading für deine Karte? 💎";
    case "market": return card ? `${card} sucht ein neues Zuhause – vielleicht bei dir? 🤝` : "Deine Wunschkarte liegt vielleicht schon in deiner Nähe 🤝";
    case "community": return "Diese Pulls feiert die Community gerade 🔥";
    case "tour": return card ? `Von ${card} bis zum Gesamtwert deiner Sammlung – alles in einer App 🚀` : "Eine App für alles, was Sammler brauchen 🚀";
    default: return `${sc.title} 👀`;
  }
}

/** 2–3 kurze Sätze mit echtem Mehrwert (Hauptteil). */
function bodyFor(sc, f) {
  switch (sc.key) {
    case "arena": return ["In der Swipe-Arena wischst du dich durch echte Karten mit Live-Preisen von Cardmarket.", "Rechts merken, links weiter – und mit einem Tippen siehst du alle Details zur Karte."];
    case "flip": return ["Der Flip-Radar vergleicht echte Angebote laufend mit dem Cardmarket-Trend.", `Die Preis-Analyse zeigt dir echte Verkaufspreise, bevor du zuschlägst${f.price ? ` – hier für ${f.price}` : ""}.`];
    case "restock": return ["Das Restock-Radar prüft die großen Shops alle zwei Minuten und meldet jeden Drop per Push.", "Die UVP-Ampel zeigt sofort, ob der Preis fair oder ein Scalper-Preis ist."];
    case "portfolio": return ["Das Portfolio rechnet deine Sammlung live mit aktuellen Cardmarket-Preisen durch.", `Jede Karte mit Preisverlauf${f.count ? ` – hier ${f.count} Karten im Blick` : ""}, damit du weißt, wann sich Verkaufen lohnt.`];
    case "scanner": return ["Namen eintippen oder Karte vor die Kamera halten – PokeSwipe Radar findet sie in der deutschen Kartendatenbank.", "Ein Tippen zeigt dir den Live-Preis inklusive 30-Tage-Verlauf."];
    case "pricecheck": return ["Trend, günstigstes Angebot und Ersparnis auf einen Blick.", "Der Preisverlauf zeigt dir, ob gerade ein guter Zeitpunkt zum Kaufen ist."];
    case "graded": return ["Der Grading-Rechner vergleicht Gebühren mit echten Verkaufspreisen für PSA 8, 9 und 10.", "Im Graded-Portfolio stehen alle Slabs mit Note, Zertifikat und aktuellem Wert."];
    case "market": return ["Im Tausch-Markt findest du echte Inserate von Sammlern – mit Preis, Stadt und Suchliste.", "Tausch-Anfrage mit einem Tippen, alles Weitere sicher im Chat."];
    case "community": return ["Auf der Pull-Wall zeigt die Community ihre besten Hits mit aktuellem Marktwert.", "Scroll dich durch den Feed und poste deinen eigenen Pull."];
    case "tour": return ["Swipe-Arena, Live Flip-Radar, Restock-Radar und Portfolio – alles mit echten Marktpreisen.", "Gemacht für deutsche Sammler, die nie wieder überzahlen wollen."];
    default: return ["Echte Karten, echte Preise, echte Deals."];
  }
}

/**
 * Vollständiger Social-Media-Beschreibungstext für Instagram Reels, TikTok, YouTube Shorts und Facebook.
 * @param {object} sc     Szenario aus SCENARIOS
 * @param {object} facts  Während der Live-Aufnahme von der echten Website gelesene Werte
 *                        (card, price, pct, total, count, value)
 * @returns {{ title: string, hook: string, body: string[], hashtags: string[], caption: string }}
 */
export function buildCaption(sc, facts = {}) {
  const f = facts || {};
  const hook = hookFor(sc, f);
  const body = bodyFor(sc, f).slice(0, 3);
  const hashtags = hashtagsFor(sc, f);
  const card = clean(f.card, 40);
  const title = clean(`${sc.title}${card && !sc.title.includes(card) ? ` – ${card}` : ""} | PokeSwipe Radar`, 100);
  const caption = [hook, "", ...body, CTA_LINE, "", hashtags.join(" ")].join("\n");
  return { title, hook, body, hashtags, caption };
}

/** Inhalt der .txt-Begleitdatei neben dem MP4-Export. */
export function captionFile(sc, cap, extra = {}) {
  return [
    `Titel: ${cap.title}`,
    "",
    "Beschreibung (Instagram Reels · TikTok · YouTube Shorts · Facebook):",
    cap.caption,
    "",
    `Hashtags: ${cap.hashtags.join(" ")}`,
    ...(extra.voiceover ? ["", `Voiceover: ${extra.voiceover}`] : []),
    ...(extra.recorded ? ["", `Live aufgenommen: ${extra.recorded} (${extra.mode || "DOM"})`] : []),
    "",
  ].join("\n");
}
