// Creator-Programm – reine Logik ohne Datenbank (geprüft in tests/creator-outreach.test.ts):
// Starter-Liste, Wahrscheinlichkeits-Scoring, Promo-Code-Vorschläge, 4 Anschreiben-Vorlagen, Follow-up- und DM-Texte,
// Versand-Regeln (Tageslimit, Abstand) und der Kontakt-/Impressums-Extraktor.
import { normalizePromoCode, PROMO_RE } from "./referral-logic.ts";

export const CREATOR_PLATFORMS = ["youtube", "tiktok", "instagram", "twitch", "discord"] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];
export const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", twitch: "Twitch", discord: "Discord" };

export const CREATOR_CATEGORIES = ["packopening", "flohmarkt", "micro", "community", "top"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  packopening: "Pack-Opening (YouTube/TikTok)", flohmarkt: "Flohmarkt / Cardshow-Vlogs", micro: "TikTok-/Micro-Creator",
  community: "Discord- / WhatsApp-Community", top: "Top-Creator",
};

/** Gratis-Tage des Community-Codes für Zuschauer */
export const CREATOR_PROMO_DAYS = 30;
/** Versandschutz für die Domain-Reputation */
export const OUTREACH_DAILY_CAP = 15;
export const OUTREACH_MIN_GAP_MS = 3 * 60_000; // mindestens 3 Minuten zwischen zwei Outreach-Mails
export const OUTREACH_QUEUE_GAP_MS = 6 * 60_000; // Warteschlange: alle ~6 Minuten eine Mail
export const FOLLOWUP_AFTER_DAYS = 4;

// ---------------------------------------------------------------------------
// Scoring: je kleiner der Kanal, desto höher die Antwort-Chance
// ---------------------------------------------------------------------------
export type Tier = "micro" | "mid" | "top" | "unknown";
export function tierOf(followers: number): Tier {
  const f = Number(followers) || 0;
  if (f <= 0) return "unknown";
  if (f < 15_000) return "micro";
  if (f < 100_000) return "mid";
  return "top";
}
export const TIER_LABEL: Record<Tier, string> = {
  micro: "Micro-Creator 1k–15k · Sehr hohe Antwort-Chance",
  mid: "Mid-Tier 15k–100k · Mittlere Antwort-Chance",
  top: "Top-Creator 100k+ · Geringe Antwort-Chance",
  unknown: "Follower unbekannt",
};

/** Antwort-Wahrscheinlichkeit 0–100 (Faustregel aus Größe, Kategorie und vorhandenem Kontakt). */
export function responseScore(l: { followers: number; category: string; email?: string; platform?: string }): number {
  const tier = tierOf(l.followers);
  let s = tier === "micro" ? 78 : tier === "mid" ? 52 : tier === "top" ? 22 : 45;
  if ((Number(l.followers) || 0) > 0 && l.followers < 1_000) s -= 10; // sehr kleine Kanäle reagieren oft gar nicht
  if (l.category === "community") s += 8;
  if (l.category === "flohmarkt") s += 4;
  if (l.email) s += 6;
  return Math.max(5, Math.min(95, Math.round(s)));
}

// ---------------------------------------------------------------------------
// Promo-Code-Vorschlag „DARIO30“
// ---------------------------------------------------------------------------
const UMLAUT: Record<string, string> = { ä: "AE", ö: "OE", ü: "UE", Ä: "AE", Ö: "OE", Ü: "UE", ß: "SS" };
export function suggestPromoCode(name: string, suffix = String(CREATOR_PROMO_DAYS)): string {
  const base = String(name || "")
    .replace(/[äöüÄÖÜß]/g, (ch) => UMLAUT[ch] || ch)
    .normalize("NFKD").replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/^THE\s+/, "")
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, Math.max(3, 24 - suffix.length));
  const code = (base.length >= 2 ? base : "CREATOR") + suffix;
  return PROMO_RE.test(code) ? code : `CREATOR${suffix}`;
}
/** Säubert einen Wunsch-Code; leer, wenn unbrauchbar. */
export function cleanWishCode(v: unknown): string {
  const c = normalizePromoCode(v).replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
  return PROMO_RE.test(c) ? c : "";
}

// ---------------------------------------------------------------------------
// Starter-Datenbank (DACH Pokémon-TCG). Bekannte Namen ohne geratene Links/E-Mails –
// Kontakt holt man sich per 1-Klick-Recherche (Kanalinfo / Impressum) bzw. über den Extraktor.
// ---------------------------------------------------------------------------
export type StarterLead = { name: string; category: string; platform: CreatorPlatform; followers: number; placeholder: boolean; notes: string };
export const STARTER_LEADS: StarterLead[] = [
  { name: "Dario", category: "packopening", platform: "youtube", followers: 0, placeholder: false, notes: "Bekannter deutscher Pokémon-TCG-YouTuber – Kanal-Link & Follower über die Recherche-Buttons ergänzen." },
  { name: "The Zero of Time", category: "packopening", platform: "youtube", followers: 0, placeholder: false, notes: "Deutscher Pokémon-TCG-Kanal – Kanalinfo öffnen, geschäftliche E-Mail im Impressum prüfen." },
  { name: "Platzhalter: Pack-Opening-YouTuber (DE)", category: "packopening", platform: "youtube", followers: 0, placeholder: true, notes: "Suche: „Pokemon Booster Opening deutsch“ – Kanäle mit 2k–50k Abos und regelmäßigen Uploads." },
  { name: "Platzhalter: Pack-Opening-TikToker (DE)", category: "packopening", platform: "tiktok", followers: 0, placeholder: true, notes: "Suche: #pokemonkarten #packopening – E-Mail oft im Linktree/Beacons der Bio." },
  { name: "Platzhalter: Flohmarkt-/Cardshow-Vlogger", category: "flohmarkt", platform: "youtube", followers: 0, placeholder: true, notes: "Suche: „Pokemon Flohmarkt“, „Cardshow Vlog deutsch“, „Pokemon Karten Börse“." },
  { name: "Platzhalter: TikTok-Micro-Creator 1k–15k", category: "micro", platform: "tiktok", followers: 5_000, placeholder: true, notes: "Höchste Antwort-Chance: kleine, aktive Kanäle mit vielen Kommentaren pro Video." },
  { name: "Platzhalter: Instagram-Sammler (Reels)", category: "micro", platform: "instagram", followers: 3_000, placeholder: true, notes: "Suche: #pokemontcgdeutschland #pokemonsammlung." },
  { name: "Platzhalter: Discord-Server-Admin (TCG DE)", category: "community", platform: "discord", followers: 2_000, placeholder: true, notes: "Deutsche TCG-/Restock-Discords (disboard.org) – Kontakt über den Server-Inhaber." },
  { name: "Platzhalter: WhatsApp-/Telegram-Restock-Gruppe", category: "community", platform: "discord", followers: 800, placeholder: true, notes: "Admins lokaler Tausch- und Restock-Gruppen." },
];

// ---------------------------------------------------------------------------
// Feste deutsche Pokémon-TCG-Creator (vom Admin vorgegeben) – nur Kanal-Links, KEINE E-Mails.
// Werden beim Öffnen des Creator-Finders einmalig angelegt bzw. in passende leere Platzhalter übernommen.
// ---------------------------------------------------------------------------
export type FeaturedCreator = { name: string; platform: CreatorPlatform; channelUrl: string; category: string };
export const FEATURED_CREATORS: FeaturedCreator[] = [
  { name: "Gigalabastia", platform: "youtube", channelUrl: "https://www.youtube.com/@Gigalabastia", category: "flohmarkt" },
  { name: "ZockerEule", platform: "youtube", channelUrl: "https://www.youtube.com/@ZockerEule", category: "packopening" },
  { name: "FanmadeTim", platform: "youtube", channelUrl: "https://www.youtube.com/@FanmadeTim", category: "packopening" },
  { name: "PokeBazi", platform: "youtube", channelUrl: "https://www.youtube.com/@PokeBazi", category: "packopening" },
  { name: "The Zero of Time", platform: "youtube", channelUrl: "https://www.youtube.com/@TheZeroOfTime", category: "packopening" },
  { name: "Dario", platform: "youtube", channelUrl: "https://www.youtube.com/@DarioPokemon", category: "packopening" },
];

/** 1-Klick-Suchen nach aktiven deutschen TikTok-Creatorn (1k–15k Follower) – öffnen nur die öffentliche TikTok-Suche. */
export const TIKTOK_NICHE_SEARCHES: { label: string; url: string }[] = [
  { label: "TikTok: Pokemon Karten öffnen", url: "https://www.tiktok.com/search/user?q=pokemon%20karten%20oeffnen" },
  { label: "TikTok: Pokemon Pulls deutsch", url: "https://www.tiktok.com/search/user?q=pokemon%20pulls%20deutsch" },
  { label: "TikTok: Pokemon Flohmarkt", url: "https://www.tiktok.com/search/user?q=pokemon%20flohmarkt" },
  { label: "TikTok: Pokemon Masterset", url: "https://www.tiktok.com/search/user?q=pokemon%20masterset" },
];

/** Schnellleiste „🎯 Kleine TikTok Käufer & Verkäufer finden (500–15k Follower)“ – öffentliche TikTok-Nutzersuche. */
export const TIKTOK_BUYER_SELLER_SEARCHES: { label: string; url: string }[] = [
  { label: "TikTok: Pokemon Karten verkaufen", url: "https://www.tiktok.com/search/user?q=pokemon%20karten%20verkaufen" },
  { label: "TikTok: Pokemon Flohmarkt Deals", url: "https://www.tiktok.com/search/user?q=pokemon%20flohmarkt" },
  { label: "TikTok: Pokemon Cardshow / Tausch", url: "https://www.tiktok.com/search/user?q=pokemon%20cardshow%20deutsch" },
  { label: "TikTok: Pokemon Rip & Ship DE", url: "https://www.tiktok.com/search/user?q=pokemon%20rip%20and%20ship%20deutsch" },
  { label: "TikTok: Pokemon Sammlung auflösen", url: "https://www.tiktok.com/search/user?q=pokemon%20sammlung%20verkaufen" },
];

/** Direktlink zum Showcase-Video (Set-Binder + 1-Klick-Inserieren) auf der Creator-Seite. */
export const CREATOR_VIDEO_URL = "https://pokeswipe-radar.de/creator#video";

/** Aus „@handle“, „handle“ oder einem Profil-Link einen TikTok-Profil-Link machen (leer, wenn nicht eindeutig). */
export function tiktokProfileUrl(input: string): string {
  const s = String(input || "").trim();
  const m = s.match(/tiktok\.com\/(@[A-Za-z0-9._]{2,40})/i);
  if (m) return `https://www.tiktok.com/${m[1]}`;
  // Nur ein ausdrückliches @handle wird zum Link – Anzeigenamen werden nicht zu Handles „geraten“
  const h = s.slice(1);
  return s.startsWith("@") && /^[A-Za-z0-9._]{2,24}$/.test(h) ? `https://www.tiktok.com/@${h}` : "";
}

/** Öffentliche Creator-Infoseite, die in jeder Anfrage verlinkt wird. */
export const creatorPage = (site: string) => `${site.replace(/\/$/, "")}/creator`;

/** Kurze, lockere TikTok-DM (für Creator ohne E-Mail-Kontakt). */
export const TIKTOK_DM = "Hey [Kanalname]! 👋 Feier deine Pokémon-Videos richtig. Wir sind PokeSwipe Radar – unser Live-Scanner zeigt beim Opening sofort den Kartenwert. Lust auf Pro dauerhaft gratis + deinen eigenen Code [PromoCode] (30 Tage Pro für deine Community)? Alle Infos: [CreatorPage] 🙌";

// ---------------------------------------------------------------------------
// Recherche-Links (nur öffentliche Seiten, keine API-Abfragen)
// ---------------------------------------------------------------------------
export function researchLinks(l: { name: string; platform: string; channelUrl: string; placeholder?: boolean }) {
  const q = encodeURIComponent(l.placeholder ? "Pokemon Karten Opening deutsch" : `${l.name} Pokemon`);
  let about = `https://www.youtube.com/results?search_query=${q}&sp=EgIQAg%253D%253D`; // Filter „Kanäle“
  try {
    const u = new URL(l.channelUrl);
    if (/(^|\.)youtube\.com$/i.test(u.hostname) && /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(u.pathname)) {
      const base = u.pathname.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/)![0];
      about = `https://www.youtube.com${base}/about`;
    }
  } catch {}
  const tag = encodeURIComponent(l.placeholder ? "pokemonkarten" : l.name);
  return {
    youtubeAbout: about,
    tiktok: `https://www.tiktok.com/search/user?q=${tag}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${tag}`,
    google: `https://www.google.com/search?q=${encodeURIComponent(`${l.placeholder ? "Pokemon TCG Creator deutsch" : l.name} Pokemon Impressum E-Mail`)}`,
  };
}

// ---------------------------------------------------------------------------
// Anschreiben-Vorlagen A–D (Platzhalter [Kanalname], [PromoCode], [CreatorLink])
// ---------------------------------------------------------------------------
export type TemplateId = "A" | "B" | "C" | "D" | "E";
export const TEMPLATE_IDS: TemplateId[] = ["A", "B", "C", "D", "E"];
/** Launch-Vorlage für kleinere TikTok-Käufer & -Verkäufer (Standard für TikTok und den 1-Klick-Massenversand). */
export const LAUNCH_TEMPLATE: TemplateId = "E";
export const TEMPLATES: Record<TemplateId, { label: string; subject: string; body: string; dm: string; comment?: string }> = {
  A: {
    label: "A – Pack-Opening-YouTuber / TikToker",
    subject: "Kooperation: Live-Karten-Scanner für deine Openings + eigener Code für [Kanalname]",
    body: `Hey [Kanalname],

hier ist [Absender] von PokeSwipe Radar (pokeswipe-radar.de) – wir schauen deine Openings echt gern und haben eine Idee, die gut in deine Videos passen könnte.

Unser Live-Karten-Scanner erkennt Pokémon-Karten direkt vor der Kamera und zeigt sofort den aktuellen Cardmarket-Preis – perfekt, um bei einem Pull live zu zeigen, was die Karte gerade wert ist.

Was wir dir anbieten möchten:
• Dauerhaft PokeSwipe Pro gratis (VIP-Creator-Pass) + verifiziertes Creator-Badge in Profil & Marktplatz
• Deinen eigenen Community-Code [PromoCode]: Jeder Zuschauer testet damit 30 Tage Pro kostenlos
• Dein Link: [CreatorLink]
• Alle Infos zum Creator-Programm: [CreatorPage]

Kein Vertrag, keine Pflicht-Posts – nutz es einfach, wenn es dir gefällt. Wir freuen uns über eine kurze Antwort, gern auch mit Feedback.

Viele Grüße
[Signatur]`,
    dm: "Hey [Kanalname]! Hier ist PokeSwipe Radar – unser Live-Scanner zeigt beim Opening sofort den Kartenpreis. Magst du Pro dauerhaft gratis + eigenen Code [PromoCode] (30 Tage Pro für deine Community)? Link: [CreatorLink]",
  },
  B: {
    label: "B – Flohmarkt- / Cardshow-Vlogger",
    subject: "Preis-Check in Sekunden für deine Flohmarkt- & Cardshow-Vlogs, [Kanalname]",
    body: `Hi [Kanalname],

hier ist [Absender] von PokeSwipe Radar. Deine Flohmarkt- und Cardshow-Videos sind genau die Situation, für die wir unsere App gebaut haben.

Mit dem Scanner hast du an jedem Stand in Sekunden den aktuellen Marktpreis – und der Netto-Flip-Rechner zeigt direkt, ob sich ein Deal nach Gebühren und Versand wirklich lohnt. Das sieht vor der Kamera richtig gut aus.

Unser Angebot an dich:
• Dauerhaft PokeSwipe Pro gratis (VIP-Creator-Pass) inkl. verifiziertem Creator-Badge
• Eigener Code [PromoCode] – deine Zuschauer testen 30 Tage Pro kostenlos
• Dein Link: [CreatorLink]
• Alle Infos zum Creator-Programm: [CreatorPage]

Ganz ohne Verpflichtung. Wenn du Lust hast, probier es beim nächsten Dreh einfach aus – wir freuen uns auf deine Rückmeldung!

Beste Grüße
[Signatur]`,
    dm: "Hi [Kanalname]! Für deine Flohmarkt-Vlogs: PokeSwipe Radar scannt Karten am Stand in Sekunden + Netto-Flip-Rechner. Pro dauerhaft gratis + Code [PromoCode] für deine Zuschauer? [CreatorLink]",
  },
  C: {
    label: "C – Micro-Creator (1.000–15.000 Follower)",
    subject: "Frühe Partnerschaft mit PokeSwipe Radar? 🤝 [Kanalname]",
    body: `Hey [Kanalname],

hier ist [Absender] von PokeSwipe Radar – einer deutschen App für Pokémon-Sammler (Scanner, Preise, Set-Binder, Tausch-Hub).

Wir stehen noch relativ am Anfang, genau wie viele Kanäle, die richtig gute Inhalte machen. Deshalb suchen wir ein paar Creator, mit denen wir gemeinsam wachsen können – und du bist mir positiv aufgefallen.

Das bekommst du:
• Dauerhaft PokeSwipe Pro gratis + verifiziertes VIP-Creator-Badge (du gehörst zu den ersten!)
• Eigener Community-Code [PromoCode] – 30 Tage Pro gratis für deine Follower
• Wir teilen deine Videos gern auch auf unseren Kanälen
• Dein Link: [CreatorLink]
• Alle Infos zum Creator-Programm: [CreatorPage]

Kein Vertrag, keine Mindest-Posts. Sag einfach Bescheid, ob du Lust hast – wir freuen uns!

Liebe Grüße
[Signatur]`,
    dm: "Hey [Kanalname]! PokeSwipe Radar hier 👋 Wir suchen ein paar Creator zum gemeinsamen Wachsen: Pro dauerhaft gratis, VIP-Creator-Badge + eigener Code [PromoCode] für deine Follower. Lust? [CreatorLink]",
  },
  D: {
    label: "D – Discord- / WhatsApp-Community-Admins",
    subject: "Kostenlose Restock-Alarme & sicherer Tausch für deine Community, [Kanalname]",
    body: `Hallo [Kanalname],

hier ist [Absender] von PokeSwipe Radar. Wir haben gesehen, dass du eine Pokémon-TCG-Community betreust – das ist genau die Zielgruppe, für die wir einiges gebaut haben:

• Restock-Alarme: automatische Prüfung der Shops, Push bei neuen Displays & ETBs
• Sicherer Tausch-Hub & Marktplatz mit Käuferschutz – weniger Scam-Risiko für deine Mitglieder
• Live-Karten-Scanner mit aktuellen Cardmarket-Preisen

Für dich als Admin: dauerhaft PokeSwipe Pro gratis inkl. Creator-Badge. Für deine Mitglieder: Code [PromoCode] = 30 Tage Pro kostenlos.
Dein Community-Link: [CreatorLink]
Alle Infos zum Creator-Programm: [CreatorPage]

Wenn das für euren Server passt, freuen wir uns über eine kurze Rückmeldung – auch gern mit Wünschen, was eurer Community noch fehlt.

Viele Grüße
[Signatur]`,
    dm: "Hallo [Kanalname]! Für eure Community: kostenlose Restock-Alarme + sicherer Tausch-Hub bei PokeSwipe Radar. Für dich Pro dauerhaft gratis, für deine Mitglieder Code [PromoCode] (30 Tage Pro): [CreatorLink]",
  },
  E: {
    label: "E – TikTok Käufer/Verkäufer (Launch-Offer)",
    subject: "Kurze Idee für deine Pokémon-Deals – 0 % Gebühren + eigener Code ({PROMO_CODE}) für {CREATOR_NAME}",
    body: `Hey {CREATOR_NAME},

wir feiern deine Videos rund ums Kaufen, Verkaufen und Tauschen von Pokémon-Karten auf {PLATTFORM}!

Ganz ehrlich unter Sammlern: Unsere App PokeSwipe Radar (https://pokeswipe-radar.de) ist noch brandneu, hat aber richtig starkes Potenzial und wird von uns gerade jeden Tag weiter ausgebaut – was uns aktuell noch fehlt, ist einfach die Reichweite in der Szene.

Schau dir mal kurz dieses kurze Video von unserem digitalen Set-Binder & dem 1-Klick-Inserieren-Button an:
👉 https://pokeswipe-radar.de/creator#video

Damit kannst du Karten direkt aus deinem Ordner mit einem Klick zum Verkauf einstellen oder gezielt Lücken in Sets schließen. Weil du genau in dem Bereich aktiv bist, wollen wir dich als einen der ersten Creator mit ins Boot holen:

• 0 % Verkaufsgebühren auf dem Marktplatz (du behältst 100 % deiner Verkäufe)
• Dauerhaft PokeSwipe VIP Pro gratis + verifiziertes Creator-/Händler-Badge
• Dein eigener Community-Code "{PROMO_CODE}", mit dem deine Follower 30 Tage PokeSwipe Pro komplett kostenlos testen können

Kein Vertrag, kein Haken – wenn du Bock hast, schau kurz ins Video rein oder teste die App direkt kostenlos. Gib mir gern kurz Bescheid, dann schalten wir dein Creator-Badge sofort live!

Beste Grüße
Kevin von PokeSwipe Radar`,
    dm: "Hey {CREATOR_NAME}! 🙌 Feier deinen Content rund ums Kaufen & Verkaufen von Pokémon-Karten! Ganz ehrlich: Unsere neue Sammler-App PokeSwipe Radar ist noch brandneu, hat aber mega Potenzial und wird ständig weitergebaut – uns fehlt gerade nur noch die Reichweite. Schau mal kurz das Video mit unserem Set-Binder & dem 1-Klick-Inserieren-Button an: https://pokeswipe-radar.de/creator#video 🔥 Als Launch-Partner bekommst du dauerhaft VIP Pro gratis, 0 % Verkaufsgebühren + deinen eigenen Code {PROMO_CODE} (30 Tage Pro gratis für deine Community). Magst du mal reinschauen?",
    comment: "Starke Deals! 🙌 Hab dir als App-Gründer gerade 0 % Verkaufsgebühren + einen eigenen Code ({PROMO_CODE}) für deine Community reserviert – folg kurz zurück, dann schick ich dir das Video dazu!",
  },
};

export const FOLLOWUP_TEMPLATE = {
  subject: "Kurze Nachfrage: PokeSwipe Pro für [Kanalname]",
  body: `Hey [Kanalname],

nur eine kurze, freundliche Nachfrage zu unserer Mail von vor ein paar Tagen – dein Code [PromoCode] ist schon für dich reserviert (30 Tage Pro gratis für deine Community, für dich dauerhaft Pro): [CreatorLink]

Falls es gerade nicht passt, ist das völlig okay – dann melden wir uns nicht wieder.

Viele Grüße
[Signatur]`,
};

/** Passende Vorlage zur Kategorie / Größe – TikTok-Accounts bekommen standardmäßig das Launch-Angebot (E). */
export function chooseTemplate(category: string, followers: number, platform = ""): TemplateId {
  if (platform === "tiktok" && category !== "community") return LAUNCH_TEMPLATE;
  if (category === "community") return "D";
  if (category === "flohmarkt") return "B";
  if (category === "micro" || tierOf(followers) === "micro") return "C";
  return "A";
}

export function fillTemplate(text: string, v: { name: string; code: string; link: string; sender?: string; page?: string; platform?: string }) {
  const sender = String(v.sender || "").trim().slice(0, 60);
  return String(text)
    // Platzhalter der Launch-Vorlage E
    .replace(/\{CREATOR_NAME\}/g, v.name || "du")
    .replace(/\{PROMO_CODE\}/g, v.code || "")
    .replace(/\{PLATTFORM\}/g, PLATFORM_LABEL[String(v.platform || "")] || "TikTok")
    .replace(/\{VIDEO_URL\}/g, CREATOR_VIDEO_URL)
    .replace(/\[Absender\]/g, sender || "das Team")
    .replace(/\[Signatur\]/g, sender ? `${sender}\nPokeSwipe Radar` : "Dein PokeSwipe-Radar-Team")
    .replace(/\[Kanalname\]/g, v.name || "du")
    .replace(/\[PromoCode\]/g, v.code || "")
    .replace(/\[CreatorLink\]/g, v.link || "")
    .replace(/\[CreatorPage\]/g, v.page || "https://pokeswipe-radar.de/creator");
}

/** Personalisierter Link mit Promo-Code und Herkunft. */
export const creatorLink = (site: string, code: string) => `${site.replace(/\/$/, "")}/?promo=${encodeURIComponent(code)}&utm_source=creator&utm_campaign=${encodeURIComponent(code.toLowerCase())}`;

/** Pflicht-Fußzeile: Absender, Impressum, Abmeldung (rechtlich & für die Zustellbarkeit wichtig). */
export function legalFooter(site: string, optoutUrl: string) {
  const s = site.replace(/\/$/, "");
  return `\n\n—\nPokeSwipe Radar · ${s} · Impressum: ${s}/impressum\nDu möchtest keine weiteren Nachrichten von uns? Kurz antworten oder hier abmelden: ${optoutUrl}`;
}

// ---------------------------------------------------------------------------
// Status & Versand-Regeln
// ---------------------------------------------------------------------------
export type LeadStatus = "ready" | "queued" | "sent" | "dm_sent" | "replied" | "active" | "paused" | "optout";
export const LEAD_STATUSES: LeadStatus[] = ["ready", "queued", "sent", "dm_sent", "replied", "active", "paused", "optout"];

/** Anzeige-Status inkl. „Follow-up fällig“ (4 Tage nach Versand ohne Antwort). */
export function displayStatus(l: { status: string; email: string; sentAt: Date | string | null; followupSentAt?: Date | string | null }, now = Date.now()) {
  const sent = l.sentAt ? new Date(l.sentAt).getTime() : 0;
  if (l.status === "sent" && sent && !l.followupSentAt && now - sent >= FOLLOWUP_AFTER_DAYS * 86_400_000) return { key: "followup", label: "Follow-up fällig" };
  if (l.status === "ready" && !l.email) return { key: "no_email", label: "Kein E-Mail-Kontakt – DM nutzen" };
  const labels: Record<string, string> = {
    ready: "Bereit", queued: "In Warteschlange", sent: "E-Mail gesendet", dm_sent: "DM gesendet", replied: "Antwort erhalten", active: "Aktiv", paused: "Pausiert", optout: "Abgemeldet",
  };
  return { key: l.status, label: labels[l.status] || l.status };
}

/** Prüft Tageslimit & Abstand. `sentToday` = erfolgreiche Mails seit Mitternacht (Berlin), `lastSentAt` = letzte Mail. */
export function canSendNow(o: { sentToday: number; lastSentAt: Date | string | null; now?: number; cap?: number; gapMs?: number }) {
  const now = o.now ?? Date.now();
  const cap = o.cap ?? OUTREACH_DAILY_CAP;
  const gap = o.gapMs ?? OUTREACH_MIN_GAP_MS;
  if (o.sentToday >= cap) return { ok: false as const, reason: `Tageslimit erreicht (${cap} Mails/Tag) – morgen geht es weiter.`, waitMs: 0 };
  const last = o.lastSentAt ? new Date(o.lastSentAt).getTime() : 0;
  if (last && now - last < gap) {
    const waitMs = gap - (now - last);
    return { ok: false as const, reason: `Bitte ${Math.ceil(waitMs / 60_000)} Min. warten (Abstand zwischen Mails schützt die Domain-Reputation).`, waitMs };
  }
  return { ok: true as const, reason: "", waitMs: 0 };
}

/** Versandzeitpunkte für „Ausgewählte nacheinander senden“ – gestaffelt, maximal so viele wie heute noch erlaubt. */
export function staggerSchedule(count: number, o: { now?: number; sentToday: number; lastSentAt?: Date | string | null; cap?: number; gapMs?: number }) {
  const now = o.now ?? Date.now();
  const cap = o.cap ?? OUTREACH_DAILY_CAP;
  const gap = o.gapMs ?? OUTREACH_QUEUE_GAP_MS;
  const last = o.lastSentAt ? new Date(o.lastSentAt).getTime() : 0;
  let t = Math.max(now, last ? last + OUTREACH_MIN_GAP_MS : now);
  const slots: Date[] = [];
  let usedToday = o.sentToday;
  let day = berlinDayOf(t);
  for (let i = 0; i < count; i++) {
    if (berlinDayOf(t) !== day) { day = berlinDayOf(t); usedToday = 0; }
    if (usedToday >= cap) {
      // nächster Tag, 9:00 Uhr Berliner Zeit
      t = nextBerlinMorning(t);
      day = berlinDayOf(t);
      usedToday = 0;
    }
    slots.push(new Date(t));
    usedToday++;
    t += gap;
  }
  return slots;
}
export function berlinDayOf(ms: number) {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}
function nextBerlinMorning(ms: number) {
  // Grob: +1 Tag, dann auf 9:00 Berliner Zeit (UTC+1/+2) stellen
  const d = berlinDayOf(ms + 86_400_000);
  for (const off of [1, 2]) {
    const cand = Date.parse(`${d}T${String(9 - off).padStart(2, "0")}:00:00Z`);
    if (berlinDayOf(cand) === d && new Date(cand).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit" }).startsWith("09")) return cand;
  }
  return Date.parse(`${d}T08:00:00Z`);
}

// ---------------------------------------------------------------------------
// Kontakt- & Impressums-Extraktor
// ---------------------------------------------------------------------------
/** Plattformen, deren Seiten wir nicht automatisch abrufen (Nutzungsbedingungen / Login-Wände) – dort öffnet man die Seite selbst. */
const NO_FETCH_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|twitch\.tv|discord\.com|discord\.gg|whatsapp\.com|threads\.net)$/i;
export function isPlatformHost(host: string) { return NO_FETCH_HOSTS.test(host); }

/** Nur öffentliche http(s)-Adressen, keine IP-Literale aus privaten Netzen, keine Ports außer 80/443. */
export function checkFetchUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { return { ok: false, reason: "Ungültige URL." }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: "Nur http(s)-Links." };
  if (u.username || u.password) return { ok: false, reason: "Links mit Zugangsdaten sind nicht erlaubt." };
  if (u.port && !["80", "443"].includes(u.port)) return { ok: false, reason: "Nur Standard-Ports." };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return { ok: false, reason: "Interne Adressen sind nicht erlaubt." };
  if (isPrivateIp(host)) return { ok: false, reason: "Interne Adressen sind nicht erlaubt." };
  return { ok: true, url: u };
}
export function isPrivateIp(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const v4 = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return isPrivateIp(v4[1]);
    return false;
  }
  return false;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const JUNK_EMAIL = /(example\.(com|org|de)|domain\.(com|de)|sentry|wixpress|@2x|\.(png|jpe?g|gif|webp|svg|css|js)$|noreply|no-reply|u003e|yourname|deinname|email@|name@)/i;

function decodeEntities(s: string) {
  return s
    // JSON-Escapes, wie sie Linktree/Beacons (Next.js-Daten) nutzen: \u0040 → @, \u002F → /
    .replace(/\\u00(40|2[eEfF])/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(amp|commat|period|nbsp);/g, (_, n) => ({ amp: "&", commat: "@", period: ".", nbsp: " " } as Record<string, string>)[n]);
}

/** Findet öffentliche Kontakt-E-Mails (mailto:, Klartext, „name [at] domain [dot] de“) und Social-Handles. */
export function extractContacts(html: string, baseUrl = "") {
  const text = decodeEntities(String(html || "")).slice(0, 2_000_000);
  const emails = new Map<string, number>(); // E-Mail → Priorität
  const add = (e: string, prio: number) => {
    const v = e.trim().replace(/^mailto:/i, "").split("?")[0].replace(/[.,;:]+$/, "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/.test(v) || JUNK_EMAIL.test(v) || v.length > 120) return;
    emails.set(v, Math.max(emails.get(v) ?? 0, prio));
  };
  for (const m of text.matchAll(/mailto:([^"'\s>?]+)/gi)) { let v = m[1]; try { v = decodeURIComponent(v); } catch {} add(v, 3); }
  // Verschleierte Schreibweisen
  const deobf = text
    .replace(/\s*(\[|\(|\{)\s*(at|ät|@)\s*(\]|\)|\})\s*/gi, "@")
    .replace(/\s*(\[|\(|\{)\s*(dot|punkt|\.)\s*(\]|\)|\})\s*/gi, ".")
    .replace(/([A-Za-z0-9._%+-]+)\s+(?:at|ät)\s+([A-Za-z0-9-]+)\s+(?:dot|punkt)\s+([A-Za-z]{2,10})\b/gi, "$1@$2.$3");
  for (const m of deobf.matchAll(EMAIL_RE)) {
    const around = deobf.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0)).toLowerCase();
    add(m[0], /(business|geschäft|kooperation|anfragen|kontakt|contact|impressum|e-mail|email)/.test(around) ? 2 : 1);
  }
  const socials = new Set<string>();
  const S: [RegExp, (h: string) => string][] = [
    [/https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[A-Za-z0-9._-]{2,40})/gi, (h) => `https://www.youtube.com/${h}`],
    [/https?:\/\/(?:www\.|m\.)?youtube\.com\/(channel\/[A-Za-z0-9_-]{10,40})/gi, (h) => `https://www.youtube.com/${h}`],
    [/https?:\/\/(?:www\.)?tiktok\.com\/(@[A-Za-z0-9._]{2,40})/gi, (h) => `https://www.tiktok.com/${h}`],
    [/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})(?=[/"'?\s<]|$)/gi, (h) => `https://www.instagram.com/${h}`],
    [/https?:\/\/(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{3,25})/gi, (h) => `https://www.twitch.tv/${h}`],
    [/https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,32})/gi, (h) => `https://discord.gg/${h}`],
    [/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?=[/"'?\s<]|$)/gi, (h) => `https://x.com/${h}`],
  ];
  const skip = /^(p|reel|reels|explore|share|intent|home|watch|results|embed|accounts|about|legal|privacy|terms|tags?)$/i;
  for (const [re, fmt] of S) for (const m of text.matchAll(re)) if (!skip.test(m[1])) socials.add(fmt(m[1]));
  // Link zu einer Impressums-/Kontaktseite (gleiche Domain) für einen zweiten Versuch
  let imprint = "";
  for (const m of text.matchAll(/href\s*=\s*["']([^"']+)["'][^>]*>([^<]{0,60})</gi)) {
    if (/impressum|imprint|kontakt|contact|legal/i.test(`${m[1]} ${m[2]}`)) {
      try {
        const u = new URL(m[1], baseUrl || undefined);
        const base = baseUrl ? new URL(baseUrl) : null;
        if (/^https?:$/.test(u.protocol) && (!base || u.hostname === base.hostname)) { imprint = u.toString(); break; }
      } catch {}
    }
  }
  const sorted = [...emails.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return { emails: sorted.slice(0, 8), socials: [...socials].slice(0, 12), imprint };
}

// ---------------------------------------------------------------------------
// Viral-Hook- & Kommentar-Generator (authentisch, ohne Spam-Muster)
// ---------------------------------------------------------------------------
export const COMMENT_RULES = [
  "Nur kommentieren, wenn du das Video wirklich gesehen hast – auf einen konkreten Moment eingehen.",
  "Keine Links in Kommentaren (wirkt wie Spam und wird oft automatisch ausgeblendet).",
  "Höchstens 1 Kommentar pro Kanal und Woche; nie denselben Text zweimal posten.",
  "Erst Mehrwert (Preis-Info, Tipp, Frage), dann – wenn überhaupt – die App beiläufig erwähnen.",
];

// ---------------------------------------------------------------------------
// Auto-Finder für Geschäfts-E-Mails (netlify/functions/auto-find-creator-emails.mts)
// Regel: Es wird nie eine Adresse „erraten“ – nur, was wörtlich auf einer tatsächlich abgerufenen öffentlichen Seite steht,
// passt zum Creator und hat einen MX-Eintrag (DNS), wird gespeichert.
// ---------------------------------------------------------------------------
/** Mehr Mails pro Tag beim 1-Klick-Massenversand (Resend-Free-Tarif: 100/Tag). Abstand zwischen Mails dort ~500 ms. */
export const OUTREACH_BULK_DAILY_CAP = 100;
export const BULK_SEND_GAP_MS = 500;

/** Link-in-Bio-Dienste: Seite abrufen, E-Mails + verlinkte eigene Website übernehmen – aber dort kein /impressum anhängen. */
const LINK_HUB_HOSTS = /(^|\.)(linktr\.ee|beacons\.ai|beacons\.page|lnk\.bio|carrd\.co|bio\.link|linkin\.bio|campsite\.bio|taplink\.cc|solo\.to|msha\.ke|komi\.io|hoo\.be|allmylinks\.com|link\.me|stan\.store|ko-fi\.com|linkpop\.com)$/i;
export const isLinkHub = (host: string) => LINK_HUB_HOSTS.test(host);
export function linkHubLabel(host: string) {
  const h = host.replace(/^www\./i, "").toLowerCase();
  if (/linktr\.ee$/.test(h)) return "Linktree";
  if (/beacons\./.test(h)) return "Beacons";
  return h;
}

/** Suchtreffer dieser Seiten gehören fast nie dem Creator selbst (Verzeichnisse, Shops, Foren, Wikis) – nicht auswerten. */
const SEARCH_SKIP_HOSTS = /(^|\.)(google\.[a-z.]+|gstatic\.com|wikipedia\.org|wikimedia\.org|fandom\.com|reddit\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|cardmarket\.com|pokemon\.com|pokemon\.de|pokewiki\.de|bulbapedia\.bulbagarden\.net|socialblade\.com|noxinfluencer\.com|hypeauditor\.com|playboard\.co|starngage\.com|influencermarketinghub\.com|linkedin\.com|pinterest\.[a-z.]+|kleinanzeigen\.de|vinted\.[a-z.]+|trustpilot\.com|duckduckgo\.com|bing\.com|pokeswipe-radar\.de)$/i;
export const isSearchSkipHost = (host: string) => SEARCH_SKIP_HOSTS.test(host) || NO_FETCH_HOSTS.test(host);

/** Gezielte Web-Suchanfragen nach dem öffentlichen Impressum / der Kontakt-Adresse. */
export function emailSearchQueries(name: string) {
  const n = String(name || "").replace(/"/g, "").trim().slice(0, 60);
  return [`"${n}" Pokemon Impressum "@"`, `"${n}" Pokemon Kontakt E-Mail`];
}

const squash = (s: string) => String(s || "").toLowerCase()
  .replace(/[äöüß]/g, (ch) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" } as Record<string, string>)[ch])
  .normalize("NFKD").replace(/[^a-z0-9]+/g, "");
const NAME_STOP = new Set(["pokemon", "karten", "official", "offiziell", "channel", "kanal", "cards", "the"]);
/** Aussagekräftige Wörter des Namens (≥ 4 Zeichen) – „The Zero of Time“ → ["zero", "time"]. */
function nameWords(name: string) {
  return String(name || "").split(/[^\p{L}\p{N}]+/u).map(squash).filter((w) => w.length >= 4 && !NAME_STOP.has(w));
}
/** Namens-Tokens: Wörter + zusammengeschriebener Name („zerooftime“). */
export function nameTokens(name: string) {
  const joined = squash(String(name || "").replace(/^the\s+/i, ""));
  return [...new Set([...nameWords(name), ...(joined.length >= 4 ? [joined] : [])])];
}
/** Nennt die Seite den Creator (Name zusammengeschrieben oder alle aussagekräftigen Wörter)? */
export function pageMentions(html: string, name: string) {
  const text = squash(String(html || "").slice(0, 2_000_000).replace(/<[^>]+>/g, " "));
  const joined = squash(String(name || "").replace(/^the\s+/i, ""));
  if (joined.length >= 4 && text.includes(joined)) return true;
  const words = nameWords(name);
  return words.length > 0 && words.every((w) => text.includes(w));
}
/** Enthält die Adresse (lokaler Teil oder Domain) erkennbar den Creator-Namen? */
export function emailMatchesName(email: string, name: string) {
  const e = squash(email);
  return nameTokens(name).some((t) => e.includes(t));
}
/** Impressum-/Kontaktseite? */
export const isImprintUrl = (url: string) => /impressum|imprint|kontakt|contact|legal|about/i.test(String(url || ""));

/** Kandidaten-Seiten für eine eigene Website: Startseite + typische Impressum-/Kontakt-Pfade (gleiche Domain). */
export function imprintCandidates(raw: string): string[] {
  let u: URL;
  try { u = new URL(raw); } catch { return []; }
  const origin = u.origin;
  const list = [u.toString()];
  if (!isLinkHub(u.hostname) && !NO_FETCH_HOSTS.test(u.hostname)) for (const p of ["/impressum", "/kontakt", "/imprint", "/contact"]) list.push(origin + p);
  return [...new Set(list)];
}

/** Verlinkte externe Seiten (z. B. eigene Website aus dem Linktree) – keine Plattformen, keine Link-Hubs, keine Suchmaschinen. */
export function extractExternalLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  let base: URL | null = null;
  try { base = new URL(baseUrl); } catch {}
  for (const m of String(html || "").slice(0, 2_000_000).matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s<>]{4,300})["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"));
      if (base && u.hostname === base.hostname) continue;
      if (isLinkHub(u.hostname) || isSearchSkipHost(u.hostname) || /\.(png|jpe?g|gif|webp|svg|css|js|pdf|mp4)$/i.test(u.pathname)) continue;
      if (/(^|\.)(apple\.com|spotify\.com|paypal\.(com|me)|patreon\.com|throne\.com|streamelements\.com|cloudflare\.com|w3\.org|schema\.org|gravatar\.com)$/i.test(u.hostname)) continue;
      out.add(`${u.origin}${u.pathname === "/" ? "" : u.pathname}`);
    } catch {}
    if (out.size >= 4) break;
  }
  return [...out];
}

/** Aus einem Text (z. B. Antwort der Web-Suche) nur echte http(s)-Links herausziehen – E-Mails im Text werden bewusst ignoriert. */
export function extractUrlsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || "").matchAll(/https?:\/\/[^\s<>"')\]]{4,300}/gi)) out.add(m[0].replace(/[.,;:!?]+$/, ""));
  return [...out].slice(0, 12);
}

/** Quellen-Hinweis fürs Kontakt-Feld. */
export function emailSourceLabel(pageUrl: string, viaSearch: boolean) {
  let host = "", path = "";
  try { const u = new URL(pageUrl); host = u.hostname.replace(/^www\./, ""); path = u.pathname; } catch {}
  const kind = isLinkHub(host) ? linkHubLabel(host) : /impressum|imprint/i.test(path) ? "Impressum" : /kontakt|contact/i.test(path) ? "Kontaktseite" : "Website";
  return `Verifiziert aus ${kind}${viaSearch ? " (Web-Suche)" : ""} · ${host}${path && path !== "/" ? path : ""}`.slice(0, 200);
}

/**
 * Wählt aus den Funden die beste Adresse. Bei Funden aus der Web-Suche muss die Seite den Creator nennen UND
 * (die Adresse den Namen enthalten ODER die Seite ein Impressum/Kontakt sein ODER die Domain den Namen tragen) –
 * so landen keine Adressen fremder Seiten (Presse, Shops) beim Creator.
 */
export type EmailFind = { email: string; pageUrl: string; prio: number; viaSearch: boolean; mentions: boolean };
export function rankEmailFinds(finds: EmailFind[], name: string): EmailFind[] {
  const ok = finds.filter((f) => {
    if (!f.viaSearch) return true;
    if (!f.mentions) return false;
    let host = "";
    try { host = new URL(f.pageUrl).hostname; } catch {}
    return emailMatchesName(f.email, name) || isImprintUrl(f.pageUrl) || nameTokens(name).some((t) => squash(host).includes(t));
  });
  const score = (f: EmailFind) => f.prio * 10 + (isImprintUrl(f.pageUrl) ? 6 : 0) + (emailMatchesName(f.email, name) ? 5 : 0)
    + (/^(business|kooperation|koop|anfragen|collab|partner|contact|kontakt|info|mail|hello|hallo|management)[@.+_-]/i.test(f.email) ? 3 : 0) - (f.viaSearch ? 2 : 0);
  const seen = new Set<string>();
  return ok.sort((a, b) => score(b) - score(a)).filter((f) => (seen.has(f.email) ? false : (seen.add(f.email), true)));
}

// ---------------------------------------------------------------------------
// Schnell-Import „Name - email@domain.de“ / reine E-Mail-Listen
// ---------------------------------------------------------------------------
const GENERIC_LOCAL = /^(info|kontakt|contact|business|mail|email|hello|hallo|hi|anfragen|anfrage|office|team|kooperation|koop|collab|partner|management|presse|press|support|service)$/i;
const FREEMAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|gmx|web|t-online|icloud|me|mail|posteo|freenet|proton|protonmail|aol|arcor|online)$/i;
/** Anzeigename aus einer Adresse ableiten (nur für reine E-Mail-Listen): info@zockereule.de → „Zockereule“, max.mueller@gmail.com → „Max Mueller“. */
export function nameFromEmail(email: string) {
  const [local, domain = ""] = String(email).toLowerCase().split("@");
  const dom = domain.split(".").slice(-2, -1)[0] || domain.split(".")[0] || "";
  const pick = GENERIC_LOCAL.test(local.replace(/[0-9]+$/, "")) && !FREEMAIL.test(dom) ? dom : local;
  const words = pick.replace(/\+.*$/, "").split(/[._-]+/).map((w) => w.replace(/\d+$/, "")).filter((w) => w.length >= 2);
  const nm = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").slice(0, 80);
  return nm.length >= 2 ? nm : "Creator";
}

/** Zerlegt eingefügten Text in { name, email }. Akzeptiert „Name - mail“, „Name: mail“, „Name <mail>“, „mail, Name“, CSV/Tab und reine Adressen. */
export function parseCreatorImport(text: string, max = 200) {
  const out: { name: string; email: string; derived: boolean }[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    // Mehrere Adressen in einer Zeile ohne Namen (z. B. „a@x.de, b@y.de“)
    const all = [...raw.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)].map((m) => m[0]);
    if (!all.length) { invalid.push(raw.slice(0, 120)); continue; }
    const rest = raw.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g, " ").replace(/mailto:/gi, " ")
      .replace(/[<>()\[\]"';,\t|]+/g, " ").replace(/\s+/g, " ").trim().replace(/\s[-–—:]+\s/g, " ").replace(/^[-–—:\s]+|[-–—:\s]+$/g, "");
    const nameGiven = all.length === 1 && rest.length >= 2 ? rest.slice(0, 80) : "";
    for (const e of all) {
      const email = e.toLowerCase().replace(/[.]+$/, "");
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/.test(email) || JUNK_EMAIL.test(email)) { invalid.push(e); continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({ name: nameGiven || nameFromEmail(email), email, derived: !nameGiven });
      if (out.length >= max) return { entries: out, invalid, truncated: true };
    }
  }
  return { entries: out, invalid, truncated: false };
}
