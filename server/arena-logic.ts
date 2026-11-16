// PokeSwipe & Radar – Phase 5: reine Logik (ohne Datenbank) für
//   1. die Preference-Learning-Engine der Swipe-Arena (lernt aus Rechts-/Links-Swipes, gewichtet den Stapel) und
//   2. den Set-Booster-Simulator (Slot-Aufbau mit realistischen Zieh-Raten, Erwartungswert, Pack-Bilanz).
// Wird im Browser (client/arena.js) und auf dem Server (server/arena.ts) gleich verwendet.

export const PREF_LANGS = ["de", "en", "ja"] as const;
export const PREF_RARITIES = ["sir", "ir", "hyper", "ultra", "rare", "common", "none"] as const;
export type PrefLang = (typeof PREF_LANGS)[number];
export type PrefRarity = (typeof PREF_RARITIES)[number];

/** Preisbänder in Euro: 0: < 5 €, 1: 5–20 €, 2: 20–50 €, 3: 50–150 €, 4: 150–500 €, 5: ab 500 € */
export const PRICE_BANDS = [5, 20, 50, 150, 500] as const;
export const PRICE_BAND_LABEL = ["unter 5 €", "5–20 €", "20–50 €", "50–150 €", "150–500 €", "ab 500 €"];

export const priceBand = (price: unknown): number => {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 0;
  let band = 0;
  for (const limit of PRICE_BANDS) if (p >= limit) band++;
  return band;
};

export type SwipeDir = "right" | "left" | "detail";
export type SwipeEvent = { dir: SwipeDir; lang?: string | null; rarity?: string | null; set?: string | null; price?: number | null };
export type PrefScores = Record<string, number>;
export type PrefProfile = { scores: PrefScores; swipes: number; likes: number };

const SET_KEY_RE = /^(de|en|ja):[A-Za-z0-9.\-_]{1,40}$/;
const KEY_RE = /^(r:(sir|ir|hyper|ultra|rare|common|none)|l:(de|en|ja)|p:[0-5]|s:(de|en|ja):[A-Za-z0-9.\-_]{1,40})$/;
export const SCORE_LIMIT = 4;
const LEARNING_RATE = 0.6;
const DECAY = 0.985;
const MAX_SET_KEYS = 40;
/** Erst nach so vielen Swipes wird der Stapel gewichtet (vorher zu wenig Signal). */
export const COLD_START_SWIPES = 5;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export const isPrefKey = (k: string) => KEY_RE.test(k);

/** Merkmale einer Karte für das Lernen: Seltenheit, Sprache, Set, Preisband. */
export function featureKeys(e: { lang?: string | null; rarity?: string | null; set?: string | null; price?: number | null }): string[] {
  const keys: string[] = [];
  const rarity = (PREF_RARITIES as readonly string[]).includes(String(e.rarity ?? "")) ? String(e.rarity) : "none";
  keys.push(`r:${rarity}`);
  if ((PREF_LANGS as readonly string[]).includes(String(e.lang ?? ""))) keys.push(`l:${e.lang}`);
  if (e.set && SET_KEY_RE.test(String(e.set))) keys.push(`s:${e.set}`);
  keys.push(`p:${priceBand(e.price)}`);
  return keys;
}

const emptyProfile = (): PrefProfile => ({ scores: {}, swipes: 0, likes: 0 });

/** Bereinigt einen gespeicherten/übertragenen Punktestand (nur bekannte Schlüssel, Werte begrenzt). */
export function sanitizeScores(raw: unknown): PrefScores {
  const out: PrefScores = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    const n = Number(v);
    if (isPrefKey(k) && Number.isFinite(n) && n !== 0) out[k] = round2(clamp(n, -SCORE_LIMIT, SCORE_LIMIT));
  }
  return pruneSets(out);
}

function pruneSets(scores: PrefScores): PrefScores {
  const sets = Object.keys(scores).filter((k) => k.startsWith("s:"));
  if (sets.length <= MAX_SET_KEYS) return scores;
  sets.sort((a, b) => Math.abs(scores[b]) - Math.abs(scores[a]));
  for (const k of sets.slice(MAX_SET_KEYS)) delete scores[k];
  return scores;
}

/**
 * Lernschritt: Rechts-Swipe (+1) und Detailansicht (+0,4) stärken alle Merkmale der Karte, Links-Swipe (−0,5) schwächt sie.
 * Ältere Signale verblassen langsam (Abklingfaktor je Swipe), damit sich der Geschmack mitbewegen kann.
 */
export function updatePrefs(profile: PrefProfile | null | undefined, events: SwipeEvent[]): PrefProfile {
  const p: PrefProfile = profile ? { scores: { ...sanitizeScores(profile.scores) }, swipes: Math.max(0, Number(profile.swipes) || 0), likes: Math.max(0, Number(profile.likes) || 0) } : emptyProfile();
  for (const e of events.slice(0, 50)) {
    const delta = e.dir === "right" ? 1 : e.dir === "left" ? -0.5 : e.dir === "detail" ? 0.4 : 0;
    if (!delta) continue;
    if (e.dir !== "detail") {
      for (const k of Object.keys(p.scores)) {
        p.scores[k] = p.scores[k] * DECAY;
        if (Math.abs(p.scores[k]) < 0.02) delete p.scores[k];
      }
      p.swipes++;
      if (e.dir === "right") p.likes++;
    }
    for (const k of featureKeys(e)) {
      p.scores[k] = clamp((p.scores[k] || 0) + delta * LEARNING_RATE, -SCORE_LIMIT, SCORE_LIMIT);
    }
  }
  for (const k of Object.keys(p.scores)) p.scores[k] = round2(p.scores[k]);
  pruneSets(p.scores);
  return p;
}

/** Punktwert → Gewichtungsfaktor für die Zufallsauswahl (0,4 … 3,3). */
export const scoreWeight = (score: number) => round2(clamp(Math.exp(0.3 * (Number(score) || 0)), 0.4, 3.3));

/** Gewichte aller gelernten Merkmale (leer, solange noch zu wenig geswipt wurde). */
export function prefWeights(profile: PrefProfile | null | undefined): Record<string, number> {
  if (!profile || profile.swipes < COLD_START_SWIPES) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sanitizeScores(profile.scores))) {
    const w = scoreWeight(v);
    if (w !== 1) out[k] = w;
  }
  return out;
}

/** Kompakte Übergabe im Deck-Aufruf ohne Konto: "r:sir~1.8,l:ja~-0.6,…;12;5" (Punkte; Swipes; Merken). */
export function encodePrefParam(profile: PrefProfile): string {
  const entries = Object.entries(sanitizeScores(profile.scores))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 40)
    .map(([k, v]) => `${k}~${v}`);
  return `${entries.join(",")};${Math.min(100000, profile.swipes)};${Math.min(100000, profile.likes)}`;
}

export function parsePrefParam(raw: unknown): PrefProfile | null {
  const s = String(raw ?? "");
  if (!s || s.length > 2000) return null;
  const [list = "", swipes = "0", likes = "0"] = s.split(";");
  const scores: PrefScores = {};
  for (const part of list.split(",").slice(0, 60)) {
    const i = part.lastIndexOf("~");
    if (i <= 0) continue;
    scores[part.slice(0, i)] = Number(part.slice(i + 1));
  }
  const n = Number.parseInt(swipes, 10), l = Number.parseInt(likes, 10);
  return { scores: sanitizeScores(scores), swipes: Number.isFinite(n) ? clamp(n, 0, 100000) : 0, likes: Number.isFinite(l) ? clamp(l, 0, 100000) : 0 };
}

const RARITY_LABEL: Record<string, string> = {
  sir: "Special Illustration Rares", ir: "Illustration Rares", hyper: "Hyper/Gold-Karten", ultra: "ex/Ultra Rares",
  rare: "Holo-Rares", common: "Häufige Karten", none: "Karten ohne Seltenheit",
};
const LANG_LABEL: Record<string, string> = { de: "🇩🇪 Deutsch", en: "🇬🇧 Englisch", ja: "🇯🇵 Japanisch" };

/** Lesbare Zusammenfassung: die stärksten Vorlieben und Abneigungen. */
export function prefSummary(profile: PrefProfile | null | undefined, setNames: Record<string, string> = {}) {
  const scores = sanitizeScores(profile?.scores);
  const label = (k: string) => {
    if (k.startsWith("r:")) return RARITY_LABEL[k.slice(2)] || k;
    if (k.startsWith("l:")) return LANG_LABEL[k.slice(2)] || k;
    if (k.startsWith("p:")) return PRICE_BAND_LABEL[Number(k.slice(2))] || k;
    return setNames[k.slice(2)] || k.slice(2).replace(/^(de|en|ja):/, "").toUpperCase();
  };
  const list = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return {
    learning: !profile || profile.swipes < COLD_START_SWIPES,
    swipes: profile?.swipes || 0,
    likes: profile?.likes || 0,
    likesTop: list.filter(([, v]) => v >= 0.6).slice(0, 4).map(([k, v]) => ({ key: k, label: label(k), weight: scoreWeight(v) })),
    dislikes: list.filter(([, v]) => v <= -0.6).reverse().slice(0, 3).map(([k, v]) => ({ key: k, label: label(k), weight: scoreWeight(v) })),
  };
}

/** Führt zwei Profile zusammen (z. B. Gerät ohne Konto → Konto nach dem Login): Punkte gemittelt nach Swipe-Anzahl. */
export function mergePrefs(a: PrefProfile | null | undefined, b: PrefProfile | null | undefined): PrefProfile {
  if (!a?.swipes) return b ? { scores: sanitizeScores(b.scores), swipes: b.swipes || 0, likes: b.likes || 0 } : emptyProfile();
  if (!b?.swipes) return { scores: sanitizeScores(a.scores), swipes: a.swipes, likes: a.likes || 0 };
  const sa = sanitizeScores(a.scores), sb = sanitizeScores(b.scores);
  const wa = a.swipes / (a.swipes + b.swipes);
  const scores: PrefScores = {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) scores[k] = round2((sa[k] || 0) * wa + (sb[k] || 0) * (1 - wa));
  return { scores: sanitizeScores(scores), swipes: a.swipes + b.swipes, likes: (a.likes || 0) + (b.likes || 0) };
}
