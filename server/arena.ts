// PokeSwipe & Radar – Phase 5: Preference-Learning der Swipe-Arena und Set-Booster-Simulator (Server).
//
// • /api/swipe/feedback  (Login)  Swipe-Ereignisse übernehmen → gelernte Vorlieben in swipe_preferences
// • /api/swipe/prefs     (Login)  Zusammenfassung „Dein Geschmack“ abrufen / zurücksetzen
// • Deck-Gewichtung: prefFactorSql() multipliziert in /api/swipe/deck das Zufallsgewicht jeder Karte mit den gelernten Faktoren
// • /api/booster/open    Booster eines echten Sets (DE/EN/JA) mit Slot-Aufbau und Zieh-Raten öffnen, Pack-Wert-Bilanz
// • /api/booster/ev      Erwartungswert je Booster/Display („Rip or Keep“)
// Karten-Pools je Set liegen 30 Minuten im Speicher (serverseitiger Cache), das CDN cached den Erwartungswert.
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, swipePreferences } from "../db/index.ts";
import { rows, rateLimit, clientIp, int } from "./util.ts";
import { RARITY_SQL, rarityBucket } from "./intl-logic.ts";
import {
  updatePrefs, prefWeights, prefSummary, sanitizeScores, mergePrefs, parsePrefParam, PRICE_BANDS, PACK_LAYOUTS,
  buildPool, openPack, expectedValue, packBalance, boosterBucket, slotOdds, type PrefProfile, type SwipeEvent, type BoosterCard, type Pool,
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
type SetPool = { pool: Pool; setName: string; lang: "de" | "en" | "ja"; total: number; at: number };
const poolCache = new Map<string, SetPool>();
const POOL_TTL = 30 * 60_000;

async function loadPool(lang: "de" | "en" | "ja", setId: string): Promise<SetPool | null> {
  const key = `${lang}:${setId}`;
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL) return hit;
  const list = lang === "de"
    ? rows(await db.execute(sql`
        SELECT c.id, c.name, c.local_id, s.card_count_official AS official, c.image, c.rarity, COALESCE(c.trend, c.avg, c.low)::float AS price, c.set_name
        FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id WHERE c.set_id = ${setId} AND c.image <> '' LIMIT 600`))
    : rows(await db.execute(sql`
        SELECT p.id, p.name, p.local_id, p.number, p.image, p.rarity, p.price_eur::float AS price, p.set_name
        FROM card_prints p WHERE p.lang = ${lang} AND p.set_id = ${setId} AND p.image <> '' LIMIT 600`));
  if (list.length < 8) return null;
  const cards: BoosterCard[] = list.map((r: any) => {
    const price = r.price === null || r.price === undefined ? null : Number(r.price);
    return {
      id: String(r.id), name: String(r.name), image: String(r.image || ""), rarity: String(r.rarity || ""),
      number: r.number ? String(r.number) : r.local_id && Number(r.official) > 0 && /^\d+$/.test(r.local_id) ? `${r.local_id}/${r.official}` : String(r.local_id || ""),
      bucket: boosterBucket(rarityBucket(r.rarity), price), price,
    };
  });
  const entry: SetPool = { pool: buildPool(cards), setName: String(list[0].set_name || setId), lang, total: cards.length, at: Date.now() };
  if (poolCache.size > 300) poolCache.clear();
  poolCache.set(key, entry);
  return entry;
}

const rng = () => randomInt(0, 2 ** 32 - 1) / 2 ** 32;

function parseSet(raw: unknown) {
  const m = SET_RE.exec(String(raw ?? ""));
  return m ? { lang: m[1] as "de" | "en" | "ja", id: m[2] } : null;
}

const layoutFor = (lang: string) => (lang === "ja" ? PACK_LAYOUTS.ja : PACK_LAYOUTS.intl);

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerArena(app: any, { auth, body }: Hlp) {
  app.post("/api/swipe/feedback", auth, async (c: any) => {
    const userId = c.get("user").id;
    if (!rateLimit(`swfb:${userId}`, 30, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
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

  // Öffnet 1–36 Booster eines Sets (36 = ganzes Display). Kein Schreibzugriff – die Bilanz führt der Browser.
  app.get("/api/booster/open", async (c: any) => {
    if (!rateLimit(`boost:${clientIp(c)}`, 40, 60_000)) return c.json({ error: "Bitte kurz warten – zu viele Booster auf einmal." }, 429);
    const set = parseSet(c.req.query("set"));
    if (!set) return c.json({ error: "Unbekanntes Set" }, 400);
    const count = int(c.req.query("packs"), 1, 36, 1);
    const entry = await loadPool(set.lang, set.id);
    if (!entry) return c.json({ error: "Für dieses Set sind noch nicht genug Karten im Katalog." }, 404);
    const layout = layoutFor(set.lang);
    const packs = Array.from({ length: count }, () => openPack(entry.pool, layout, rng));
    const ev = expectedValue(entry.pool, layout);
    c.header("Cache-Control", "no-store");
    return c.json({
      set: { key: `${set.lang}:${set.id}`, lang: set.lang, id: set.id, name: entry.setName, cards: entry.total },
      layout: { label: layout.label, cards: layout.cards, packPrice: layout.packPrice },
      packs, balance: packBalance(packs, layout.packPrice), ev,
    });
  });

  // Erwartungswert je Booster und Display mit den Zieh-Quoten je Slot (für „Rip or Keep“ und die Simulator-Anzeige)
  app.get("/api/booster/ev", async (c: any) => {
    if (!rateLimit(`boostev:${clientIp(c)}`, 60, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const set = parseSet(c.req.query("set"));
    if (!set) return c.json({ error: "Unbekanntes Set" }, 400);
    const entry = await loadPool(set.lang, set.id);
    if (!entry) return c.json({ error: "Für dieses Set sind noch nicht genug Karten im Katalog." }, 404);
    const layout = layoutFor(set.lang);
    const ev = expectedValue(entry.pool, layout);
    const top = Object.values(entry.pool).flat().filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i)
      .sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)).slice(0, 5);
    const odds = layout.slots.map((s) => ({ slot: s.label, count: s.count, odds: slotOdds(s, entry.pool).map((o) => ({ bucket: o.bucket, pct: Math.round(o.p * 10000) / 100, cards: entry.pool[o.bucket]?.length || 0 })) }));
    c.header("Cache-Control", "public, max-age=900");
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    return c.json({
      set: { key: `${set.lang}:${set.id}`, lang: set.lang, name: entry.setName, cards: entry.total },
      layout: { label: layout.label, cards: layout.cards, packPrice: layout.packPrice },
      ev: ev.ev, hitChance: ev.hitChance, displayEv: Math.round(ev.ev * (set.lang === "ja" ? 30 : 36) * 100) / 100,
      displayPacks: set.lang === "ja" ? 30 : 36, odds, top,
    });
  });
}

