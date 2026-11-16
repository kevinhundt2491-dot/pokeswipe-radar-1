// PokeSwipe & Radar – Phase 5: Preference-Learning der Swipe-Arena (Server).
//
// • /api/swipe/feedback  (Login)  Swipe-Ereignisse übernehmen → gelernte Vorlieben in swipe_preferences
// • /api/swipe/prefs     (Login)  Zusammenfassung „Dein Geschmack“ abrufen / zurücksetzen
// • Deck-Gewichtung: prefFactorSql() multipliziert in /api/swipe/deck das Zufallsgewicht jeder Karte mit den gelernten Faktoren
import { sql } from "drizzle-orm";
import { db, swipePreferences } from "../db/index.ts";
import { rows, rateLimit, int } from "./util.ts";
import { RARITY_SQL } from "./intl-logic.ts";
import {
  updatePrefs, prefWeights, prefSummary, sanitizeScores, mergePrefs, parsePrefParam, PRICE_BANDS, type PrefProfile, type SwipeEvent,
} from "./arena-logic.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
const SET_RE = /^(de|en|ja):([A-Za-z0-9.\-_]{1,40})$/;

// ---------------------------------------------------------------------------
// Vorlieben speichern & laden
// ---------------------------------------------------------------------------
export async function loadPrefs(userId: string): Promise<PrefProfile | null> {
  const [r] = rows(await db.execute(sql`SELECT scores, swipes, likes FROM swipe_preferences WHERE user_id = ${userId} LIMIT 1`));
  if (!r) return null;
  return { scores: sanitizeScores(typeof r.scores === "string" ? JSON.parse(r.scores) : r.scores), swipes: Number(r.swipes) || 0, likes: Number(r.likes) || 0 };
}

async function savePrefs(userId: string, p: PrefProfile) {
  await db.insert(swipePreferences).values({ userId, scores: p.scores, swipes: p.swipes, likes: p.likes, updatedAt: new Date() })
    .onConflictDoUpdate({ target: swipePreferences.userId, set: { scores: p.scores, swipes: p.swipes, likes: p.likes, updatedAt: new Date() } });
}

/** Profil für den Deck-Aufruf: mit Konto aus der Datenbank, sonst aus dem übergebenen Geräte-Profil (?pw=…). */
export async function deckPrefs(userId: string | null, pw: unknown): Promise<PrefProfile | null> {
  if (userId) {
    const stored = await loadPrefs(userId).catch(() => null);
    if (stored?.swipes) return stored;
  }
  return parsePrefParam(pw);
}

const esc = (v: number) => sql.raw(String(Math.round(v * 100) / 100));

/** SQL-Ausdruck der Seltenheits-Gruppe (gleiche Reihenfolge wie rarityBucket()). */
function bucketSql(col: any) {
  const order = ["sir", "ir", "hyper", "ultra", "common", "rare"] as const;
  const whens = order.map((b) => {
    const { include, exclude } = RARITY_SQL[b];
    return sql`WHEN ${col} ~* ${include ?? "."}${exclude ? sql` AND ${col} !~* ${exclude}` : sql``} THEN ${b}`;
  });
  return sql`(CASE WHEN ${col} IS NULL OR ${col} = '' THEN 'none' ${sql.join(whens, sql` `)} ELSE 'none' END)`;
}

/**
 * Gewichtungsfaktor (SQL) einer Karte im Deck aus den gelernten Vorlieben: Produkt der Faktoren für Seltenheit,
 * Sprache, Set und Preisband, begrenzt auf 0,25 … 6. Ohne gelernte Werte: 1.
 */
export function prefFactorSql(profile: PrefProfile | null, cols = { rarity: sql`x.rarity`, lang: sql`x.lang`, set: sql`x.set_id`, price: sql`x.price` }) {
  const w = prefWeights(profile);
  const keys = Object.keys(w);
  if (!keys.length) return sql`1`;
  const parts: any[] = [];
  const rar = keys.filter((k) => k.startsWith("r:"));
  if (rar.length) parts.push(sql`(CASE ${bucketSql(cols.rarity)} ${sql.join(rar.map((k) => sql`WHEN ${k.slice(2)} THEN ${esc(w[k])}`), sql` `)} ELSE 1 END)`);
  const lang = keys.filter((k) => k.startsWith("l:"));
  if (lang.length) parts.push(sql`(CASE ${cols.lang} ${sql.join(lang.map((k) => sql`WHEN ${k.slice(2)} THEN ${esc(w[k])}`), sql` `)} ELSE 1 END)`);
  const sets = keys.filter((k) => k.startsWith("s:"));
  if (sets.length) parts.push(sql`(CASE (${cols.lang} || ':' || COALESCE(${cols.set}, '')) ${sql.join(sets.map((k) => sql`WHEN ${k.slice(2)} THEN ${esc(w[k])}`), sql` `)} ELSE 1 END)`);
  const bands = keys.filter((k) => k.startsWith("p:"));
  if (bands.length) {
    const band = sql`(${sql.join(PRICE_BANDS.map((b) => sql`(CASE WHEN COALESCE(${cols.price}, 0) >= ${esc(b)} THEN 1 ELSE 0 END)`), sql` + `)})`;
    parts.push(sql`(CASE ${band} ${sql.join(bands.map((k) => sql`WHEN ${sql.raw(String(Number(k.slice(2))))} THEN ${esc(w[k])}`), sql` `)} ELSE 1 END)`);
  }
  return sql`LEAST(6, GREATEST(0.25, ${sql.join(parts, sql` * `)}))`;
}

const validEvent = (e: any): SwipeEvent | null => {
  if (!e || typeof e !== "object" || !["right", "left", "detail"].includes(e.dir)) return null;
  const price = Number(e.price);
  return {
    dir: e.dir,
    lang: ["de", "en", "ja"].includes(e.lang) ? e.lang : null,
    rarity: typeof e.rarity === "string" ? e.rarity.slice(0, 10) : null,
    set: typeof e.set === "string" && SET_RE.test(e.set) ? e.set : null,
    price: Number.isFinite(price) && price >= 0 ? Math.min(price, 1_000_000) : null,
  };
};

// ---------------------------------------------------------------------------
// Booster-Simulator: Karten-Pools je Set (30 Minuten im Speicher)
// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerArena(app: any, { auth, body }: Hlp) {
  app.post("/api/swipe/feedback", auth, async (c: any) => {
    const userId = c.get("user").id;
    if (!(await rateLimit(`swfb:${userId}`, 30, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const b = await body(c);
    const events = (Array.isArray(b.events) ? b.events : []).slice(0, 50).map(validEvent).filter(Boolean) as SwipeEvent[];
    let current = await loadPrefs(userId);
    // Erstes Speichern nach dem Login: bisher auf dem Gerät gelernte Vorlieben übernehmen
    const device = b.device && typeof b.device === "object" ? { scores: sanitizeScores(b.device.scores), swipes: int(b.device.swipes, 0, 100000, 0), likes: int(b.device.likes, 0, 100000, 0) } : null;
    if (!current?.swipes && device?.swipes) current = mergePrefs(null, device);
    const next = updatePrefs(current, events);
    await savePrefs(userId, next);
    return c.json({ summary: prefSummary(next), profile: next });
  });

  app.get("/api/swipe/prefs", auth, async (c: any) => {
    const p = await loadPrefs(c.get("user").id);
    return c.json({ summary: prefSummary(p), profile: p || { scores: {}, swipes: 0, likes: 0 } });
  });

  app.delete("/api/swipe/prefs", auth, async (c: any) => {
    await db.delete(swipePreferences).where(sql`${swipePreferences.userId} = ${c.get("user").id}`);
    return c.json({ ok: true });
  });
}

