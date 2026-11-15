// PokeSwipe & Radar – Phase 5: reine Logik (ohne Datenbank) für
//   1. die Preference-Learning-Engine der Swipe-Arena (lernt aus Rechts-/Links-Swipes, gewichtet den Stapel) und
//   2. den Set-Booster-Simulator (Slot-Aufbau mit realistischen Zieh-Raten, Erwartungswert, Pack-Bilanz).
// Wird im Browser (client/arena.js, client/booster.js) und auf dem Server (server/arena.ts) gleich verwendet.

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

// ---------------------------------------------------------------------------
// Set-Booster-Simulator
// ---------------------------------------------------------------------------
export type BoosterBucket = "sir" | "ir" | "hyper" | "ultra" | "rare" | "common";
export type BoosterCard = { id: string; name: string; number: string; image: string; rarity: string; bucket: BoosterBucket; price: number | null };
export type SlotOption = { bucket: BoosterBucket; p: number };
export type Slot = { label: string; count: number; options: SlotOption[]; fallback: BoosterBucket; reverse?: boolean };
export type PackLayout = { id: string; label: string; cards: number; packPrice: number; slots: Slot[] };

/**
 * Slot-Aufbau nach den öffentlich dokumentierten Ziehquoten der Karmesin-&-Purpur-Ära (Mittelwerte vieler Sets):
 * Deutsch/Englisch 10 Karten (7 Häufig/Nicht so häufig, 1 Reverse, 1 Reverse-/Hit-Slot, 1 Selten-Slot),
 * Japanisch 5 Karten (3 Häufig, 1 Reverse-/AR-Slot, 1 Selten-Slot) mit höheren Hit-Raten.
 */
export const PACK_LAYOUTS: Record<"intl" | "ja", PackLayout> = {
  intl: {
    id: "intl", label: "Booster (10 Karten)", cards: 10, packPrice: 5.49,
    slots: [
      { label: "Häufig / Nicht so häufig", count: 7, options: [], fallback: "common" },
      { label: "Reverse Holo", count: 1, options: [], fallback: "common", reverse: true },
      { label: "Reverse / Illustration-Hit", count: 1, options: [{ bucket: "sir", p: 1 / 55 }, { bucket: "hyper", p: 1 / 110 }, { bucket: "ir", p: 1 / 12 }], fallback: "rare", reverse: true },
      { label: "Selten-Slot", count: 1, options: [{ bucket: "ultra", p: 1 / 5 }], fallback: "rare" },
    ],
  },
  ja: {
    id: "ja", label: "Japanischer Booster (5 Karten)", cards: 5, packPrice: 2.2,
    slots: [
      { label: "Häufig / Nicht so häufig", count: 3, options: [], fallback: "common" },
      { label: "Reverse / AR-Hit", count: 1, options: [{ bucket: "sir", p: 1 / 32 }, { bucket: "hyper", p: 1 / 60 }, { bucket: "ir", p: 1 / 6 }], fallback: "common", reverse: true },
      { label: "Selten-Slot", count: 1, options: [{ bucket: "ultra", p: 1 / 3.5 }], fallback: "rare" },
    ],
  },
};

/** Ersatzwerte, wenn eine Karte (noch) keinen Marktpreis hat. */
export const FALLBACK_PRICE: Record<BoosterBucket, number> = { common: 0.05, rare: 0.25, ultra: 1.5, ir: 4, sir: 25, hyper: 12 };

/** Seltenheits-Gruppe für den Simulator: ohne Angabe zählt die Karte nach Preis (≥ 2 € = Selten, sonst Häufig). */
export function boosterBucket(bucket: string | null | undefined, price: number | null): BoosterBucket {
  if (bucket && ["sir", "ir", "hyper", "ultra", "rare", "common"].includes(bucket)) return bucket as BoosterBucket;
  return Number(price) >= 2 ? "rare" : "common";
}

export type Pool = Record<BoosterBucket, BoosterCard[]>;

export function buildPool(list: BoosterCard[]): Pool {
  const pool: Pool = { sir: [], ir: [], hyper: [], ultra: [], rare: [], common: [] };
  for (const c of list) pool[c.bucket].push(c);
  // Sets ohne eigene Häufig-/Selten-Karten im Katalog (z. B. Spezial-Sets): auf die nächstliegende Gruppe ausweichen
  if (!pool.common.length) pool.common = pool.rare.length ? pool.rare : [...pool.ultra];
  if (!pool.rare.length) pool.rare = pool.common.length ? pool.common : [...pool.ultra];
  return pool;
}

const value = (c: BoosterCard) => (Number(c.price) > 0 ? Number(c.price) : FALLBACK_PRICE[c.bucket]);
const avg = (list: BoosterCard[]) => (list.length ? list.reduce((s, c) => s + value(c), 0) / list.length : 0);

/** Wahrscheinlichkeiten eines Slots für dieses Set (Gruppen ohne Karten entfallen, ihre Quote geht an den Rückfall). */
export function slotOdds(slot: Slot, pool: Pool): SlotOption[] {
  const active = slot.options.filter((o) => pool[o.bucket]?.length);
  const rest = Math.max(0, 1 - active.reduce((s, o) => s + o.p, 0));
  return [...active, { bucket: slot.fallback, p: rest }];
}

/** Erwartungswert eines Boosters (Summe der Slot-Erwartungswerte) und Anteil der Hits. */
export function expectedValue(pool: Pool, layout: PackLayout) {
  let ev = 0, hitChance = 1;
  for (const slot of layout.slots) {
    const odds = slotOdds(slot, pool);
    const slotEv = odds.reduce((s, o) => s + o.p * avg(pool[o.bucket] || []), 0);
    ev += slotEv * slot.count;
    const hitP = odds.filter((o) => ["sir", "hyper", "ir"].includes(o.bucket)).reduce((s, o) => s + o.p, 0);
    hitChance *= Math.pow(1 - hitP, slot.count);
  }
  return { ev: round2(ev), hitChance: round2((1 - hitChance) * 100) / 100 };
}

export type PulledCard = BoosterCard & { slot: string; reverse: boolean; value: number; hit: boolean };

/** Öffnet einen Booster mit gegebener Zufallsquelle (0 ≤ rng() < 1). Doppelte Karten pro Pack werden vermieden. */
export function openPack(pool: Pool, layout: PackLayout, rng: () => number): PulledCard[] {
  const out: PulledCard[] = [];
  const used = new Set<string>();
  for (const slot of layout.slots) {
    const odds = slotOdds(slot, pool);
    for (let i = 0; i < slot.count; i++) {
      let r = rng(), bucket = slot.fallback;
      for (const o of odds) {
        if (r < o.p) { bucket = o.bucket; break; }
        r -= o.p;
      }
      const list = pool[bucket]?.length ? pool[bucket] : pool[slot.fallback];
      if (!list?.length) continue;
      let card = list[Math.floor(rng() * list.length)];
      for (let tries = 0; tries < 4 && used.has(card.id) && list.length > 1; tries++) card = list[Math.floor(rng() * list.length)];
      used.add(card.id);
      out.push({ ...card, slot: slot.label, reverse: Boolean(slot.reverse) && ["common", "rare"].includes(card.bucket), value: round2(value(card)), hit: ["sir", "hyper", "ir", "ultra"].includes(card.bucket) });
    }
  }
  return out;
}

/** Bilanz eines oder mehrerer geöffneter Packs gegen den Kaufpreis. */
export function packBalance(packs: PulledCard[][], packPrice: number) {
  const value = round2(packs.flat().reduce((s, c) => s + c.value, 0));
  const cost = round2(packs.length * packPrice);
  const best = packs.flat().sort((a, b) => b.value - a.value)[0] || null;
  return { packs: packs.length, value, cost, profit: round2(value - cost), roi: cost ? Math.round((value / cost) * 100) : 0, best };
}
