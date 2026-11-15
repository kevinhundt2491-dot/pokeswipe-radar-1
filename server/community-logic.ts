// Phase 4: reine Logik für die Community-Moderation (ohne Datenbank – in tests/community-logic.test.ts geprüft)
// Wort-/Link-Filter, Spam-Erkennung, Trust-Score und Schreib-Limits je Vertrauensstufe.

/** Normalisiert Text für den Wortfilter: Kleinbuchstaben, Umlaute, typische Ersatzzeichen (1/|→i, 0→o, 3→e, 4→a, 5→s, @→a, $→s). */
export function normalizeForFilter(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[1|]/g, "i").replace(/0/g, "o").replace(/3/g, "e").replace(/4/g, "a").replace(/[5$]/g, "s").replace(/@/g, "a").replace(/7/g, "t")
    .replace(/(.)\1{2,}/g, "$1$1"); // "duuuumm" → "duumm"
}

/**
 * Begriffe, die sofort blockiert werden (Beleidigungen, Hetze, Betrugsmaschen). Bewusst als Wortanfänge,
 * damit Beugungen erfasst werden ("hurensohn", "hurens0hne"). Kurze Wörter nur als ganzes Wort.
 */
const BLOCK_STEMS = [
  "hurensohn", "hurenkind", "wichser", "fotze", "missgeburt", "spast", "schwuchtel", "kanake", "neger", "nigger", "nigga",
  "judensau", "sieg heil", "heil hitler", "kill yourself", "kys", "bring dich um", "fick dich", "fickdich", "verpiss dich",
  "motherfucker", "faggot", "retard", "cunt",
];
const BLOCK_WHOLE = ["nazi", "fuck you", "hure"];

/** Typische Betrugs- und Spam-Muster im Sammler-Umfeld (Bezahlung außerhalb des Käuferschutzes, Fake-Gewinnspiele). */
const SCAM_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(paypal|pp)\s*(f(&|und|n)f|freunde|friends|family)\b/, reason: "PayPal Freunde & Familie (kein Käuferschutz)" },
  { re: /\b(nur|only)\s*(vorkasse|uberweisung|western\s*union|moneygram|crypto|bitcoin|btc|usdt)\b/, reason: "Bezahlung ohne Käuferschutz" },
  { re: /\b(western\s*union|moneygram|amazon\s*gutschein|paysafe(card)?|steam\s*karte|apple\s*gift)\b/, reason: "Riskante Zahlungsart" },
  { re: /\b(gewinnspiel|giveaway)\b.*\b(dm|schreib|klick|link|whatsapp|telegram)\b/, reason: "Gewinnspiel-Masche" },
  { re: /\b(whatsapp|telegram|signal|snap(chat)?)\b.*\+?\d[\d\s/-]{7,}/, reason: "Telefonnummer / Messenger-Kontakt" },
  { re: /\+?\b(49|43|41)\s?\(?0?\)?\s?1[5-7]\d[\d\s/-]{6,}\b/, reason: "Telefonnummer" },
];

/** Erlaubte Link-Ziele für alle Nutzer (eigene Seite und bekannte Karten-Datenbanken). */
const SAFE_LINK_HOSTS = ["pokeswipe-radar.de", "pokeswipe-radar.netlify.app", "tcgdex.net", "pokemon.com", "pokemon.de", "cardmarket.com", "pkmncards.com", "limitlesstcg.com", "psacard.com"];
/** Link-Kürzer und Einladungs-Links, die nie erlaubt sind (verschleiern das Ziel). */
const BLOCKED_LINK_HOSTS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "cutt.ly", "rebrand.ly", "shorturl.at", "t.me", "chat.whatsapp.com", "wa.me", "discord.gg", "grabify.link", "iplogger.org"];

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|io|me|gg|ly|co|at|ch|shop|store|xyz|ru|cn|info|link|app)(?:\/[^\s<>"']*)?)/gi;

export function extractLinks(text: string): string[] {
  return (String(text || "").match(URL_RE) || []).map((s) => s.replace(/[),.;!?]+$/, ""));
}

function hostOf(link: string): string {
  try { return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
const hostMatches = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith("." + h));

export type FilterVerdict = {
  /** block = nicht speichern; review = speichern, aber ausblenden bis ein Admin prüft; ok = veröffentlichen */
  action: "ok" | "review" | "block";
  reason: string;
};

export type FilterContext = {
  trust: number;
  /** Letzte eigene Texte (für Doppel-Posts) */
  recent?: string[];
};

/** Prüft einen Community-Text (Chat, Pull-Wall, Kommentar). */
export function moderateText(text: string, ctx: FilterContext): FilterVerdict {
  const raw = String(text || "");
  const norm = normalizeForFilter(raw);
  const compact = norm.replace(/[^a-z0-9 ]/g, "");
  const squeezed = compact.replace(/\s+/g, "");

  for (const stem of BLOCK_STEMS) {
    const s = stem.replace(/\s+/g, "");
    if (s.length <= 4 ? new RegExp(`\\b${stem}\\b`).test(compact) : squeezed.includes(s)) {
      return { action: "block", reason: "Beleidigung oder Hetze" };
    }
  }
  for (const w of BLOCK_WHOLE) if (new RegExp(`\\b${w}\\b`).test(compact)) return { action: "block", reason: "Beleidigung" };

  const links = extractLinks(raw);
  for (const l of links) {
    const host = hostOf(l);
    if (!host) continue;
    if (hostMatches(host, BLOCKED_LINK_HOSTS)) return { action: "block", reason: "Kurz- oder Einladungslinks sind nicht erlaubt" };
  }
  const foreign = links.filter((l) => { const h = hostOf(l); return h && !hostMatches(h, SAFE_LINK_HOSTS); });
  if (foreign.length) {
    // Neue Konten dürfen keine fremden Links posten, vertrauenswürdige landen in der Prüfung, Top-Sammler direkt
    if (ctx.trust < 40) return { action: "block", reason: "Links zu fremden Seiten sind erst ab Vertrauensstufe „Bekannt“ erlaubt" };
    if (ctx.trust < 80 || foreign.length > 2) return { action: "review", reason: "Externer Link – wird geprüft" };
  }

  // Betrugsmuster auf einfach normalisiertem Text (Ziffern bleiben erhalten – wichtig für Telefonnummern)
  const plain = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
  for (const p of SCAM_PATTERNS) if (p.re.test(plain) || p.re.test(norm)) return { action: ctx.trust >= 80 ? "review" : "block", reason: p.reason };

  const letters = raw.replace(/[^A-Za-zÄÖÜäöü]/g, "");
  if (letters.length >= 16 && letters.replace(/[^A-ZÄÖÜ]/g, "").length / letters.length > 0.8) {
    return { action: "block", reason: "Bitte nicht in Großbuchstaben schreien" };
  }
  if (/(.)\1{9,}/.test(raw) || /(\b\S+\b)(\s+\1){5,}/i.test(raw)) return { action: "block", reason: "Spam (Wiederholungen)" };
  const emojis = raw.match(/\p{Extended_Pictographic}/gu) || [];
  if (emojis.length > 25) return { action: "block", reason: "Zu viele Emojis" };

  if (ctx.recent?.length) {
    const key = squeezed.slice(0, 200);
    if (key.length >= 6 && ctx.recent.some((r) => normalizeForFilter(r).replace(/[^a-z0-9]/g, "").slice(0, 200) === key)) {
      return { action: "block", reason: "Diese Nachricht hast du gerade schon gesendet" };
    }
  }
  return { action: "ok", reason: "" };
}

// ---------------------------------------------------------------------------
// Trust-Score (0–100): Vertrauen aus Kontoalter, bestätigter E-Mail, Tauschen, Bewertungen, Abo, Verkäuferkonto
// ---------------------------------------------------------------------------
export type TrustInput = {
  confirmed: boolean;
  accountAgeDays: number;
  completedDeals: number; // abgeschlossene Tausche + Treuhand-Käufe/-Verkäufe
  ratingAvg: number;
  ratingCount: number;
  paidPlan: boolean;
  verifiedSeller: boolean; // Stripe-Connect-Konto verifiziert
  upheldReports: number; // berechtigte Meldungen gegen den Nutzer (Inhalte entfernt)
  mutes: number;
  banned?: boolean;
};

export function trustScore(i: TrustInput): number {
  if (i.banned) return 0;
  let s = 0;
  if (i.confirmed) s += 20;
  s += Math.min(20, Math.floor(Math.max(0, i.accountAgeDays) / 9)); // volle 20 nach ~6 Monaten
  s += Math.min(25, Math.max(0, i.completedDeals) * 3);
  if (i.ratingCount >= 3) s += i.ratingAvg >= 4.7 ? 15 : i.ratingAvg >= 4.2 ? 10 : i.ratingAvg >= 3.5 ? 4 : -10;
  else if (i.ratingCount > 0 && i.ratingAvg >= 4.5) s += 4;
  if (i.paidPlan) s += 10;
  if (i.verifiedSeller) s += 10;
  s -= Math.max(0, i.upheldReports) * 15;
  s -= Math.max(0, i.mutes) * 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export type TrustLevel = { key: "new" | "known" | "trusted" | "top"; label: string; icon: string };
export function trustLevel(score: number): TrustLevel {
  if (score >= 80) return { key: "top", label: "Top-Sammler", icon: "🏅" };
  if (score >= 60) return { key: "trusted", label: "Vertrauenswürdig", icon: "🛡️" };
  if (score >= 30) return { key: "known", label: "Bekannt", icon: "✅" };
  return { key: "new", label: "Neu", icon: "🌱" };
}

/** Schreib-Limits je Vertrauensstufe (pro Minute / pro Stunde) – serverseitig über die Datenbank gezählt. */
export function writeLimits(score: number, kind: "chat" | "post" | "comment") {
  const lvl = trustLevel(score).key;
  const table = {
    chat: { new: [4, 40], known: [8, 120], trusted: [12, 240], top: [20, 400] },
    post: { new: [1, 3], known: [2, 10], trusted: [3, 20], top: [5, 40] },
    comment: { new: [3, 20], known: [6, 60], trusted: [10, 120], top: [15, 200] },
  } as const;
  const [perMinute, perHour] = table[kind][lvl];
  return { perMinute, perHour };
}

/** Ab so vielen Meldungen verschiedener Nutzer wird ein Inhalt automatisch ausgeblendet (bis ein Admin entscheidet). */
export const AUTO_HIDE_REPORTS = 3;

/** Öffentlicher Profil-Name aus dem Sammlernamen: "@GlurakKing" → "glurakking" (für /u/<name>). */
export function profileSlug(displayName: string): string {
  return String(displayName || "").replace(/^@/, "").toLowerCase();
}

/** Sammlungswert als grobe Stufe statt Euro-Betrag (keine sensiblen Vermögensdaten im öffentlichen Profil). */
export function valueTier(value: number): { label: string; icon: string } | null {
  const steps: [number, string, string][] = [
    [25_000, "25.000 €+", "👑"], [10_000, "10.000 €+", "💎"], [5_000, "5.000 €+", "💠"], [1_000, "1.000 €+", "🔷"],
    [250, "250 €+", "🔹"], [50, "50 €+", "▫️"],
  ];
  for (const [min, label, icon] of steps) if (value >= min) return { label, icon };
  return null;
}
