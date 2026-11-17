// PokeSwipe & Radar – Phase 3: Referenz-Index für den On-Device-Scanner.
//
// Job scan-hash-index (alle 10 Minuten): lädt die kleinen TCGdex-Kartenbilder (low.jpg, ~20 KB) für deutsche Karten und
// englische/japanische Drucke, berechnet je Karte drei Fingerabdrücke (pHash/dHash des Artworks, pHash der ganzen Karte)
// und speichert sie. Der Browser lädt daraus einen kompakten Index je Sprache und erkennt Karten komplett auf dem Gerät –
// ohne Foto-Upload und ohne Server-KI pro Bild. /api/scan/lookup liefert danach Name, Marktpreis und PSA-10-Wert.
import { sql } from "drizzle-orm";
import jpeg from "jpeg-js";
import { db } from "../db/index.ts";
import { rows, rateLimit, clientIp, str } from "./util.ts";
import { publicCache } from "./cache.ts";
import { resilientFetch, markPartial, CircuitOpenError } from "./resilience.ts";
import { log } from "./log.ts";
import { gunzipSync } from "node:zlib";
import { referenceHashes, wordsToHex, hexToWords, packWords, encodeBase64, hexDistance, isColorSig, WORDS } from "./scan-logic.ts";
import * as seedDe from "./scan-seed/de.ts";
import * as seedEn from "./scan-seed/en.ts";
import * as seedJa from "./scan-seed/ja.ts";

const LANGS = ["de", "en", "ja"] as const;
type Lang = (typeof LANGS)[number];
const IMAGE_RE = /^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9/._\-]{3,250}\/high\.webp$/;
const KEY_RE = /^(card:[a-zA-Z0-9.\-_]{2,40}|print:(en|ja):[A-Za-z0-9.\-_]{2,40})$/;
const MAX_ATTEMPTS = 3;

/** TCGdex-Bild (…/high.webp) → kleines JPEG (…/low.jpg, 245 × 337). */
export const lowJpegUrl = (image: string) => (IMAGE_RE.test(image) ? image.replace(/\/high\.webp$/, "/low.jpg") : "");

type Todo = { key: string; kind: "card" | "print"; id: string; lang: Lang; image: string; attempts: number };

/** Fällige Karten: noch ohne Fingerabdruck, Bild geändert oder Fehlversuch älter als 1 Tag – wertvolle und neue zuerst. */
async function dueCards(limit: number): Promise<Todo[]> {
  return rows(await db.execute(sql`
    SELECT x.key, x.kind, x.id, x.lang, x.image, COALESCE(h.attempts, 0) AS attempts FROM (
      SELECT 'card:' || c.id AS key, 'card'::text AS kind, c.id, 'de'::text AS lang, c.image, COALESCE(c.trend, c.avg, c.low, 0)::float AS price
      FROM cards c WHERE c.image <> ''
      UNION ALL
      SELECT 'print:' || p.id, 'print', p.id, p.lang, p.image, COALESCE(p.price_eur, 0)::float
      FROM card_prints p WHERE p.image <> ''
    ) x LEFT JOIN card_hashes h ON h.id = x.key
    WHERE h.id IS NULL OR h.source_image <> x.image
      OR (h.art_p IS NULL AND h.attempts < ${MAX_ATTEMPTS} AND h.computed_at < now() - interval '1 day')
    ORDER BY (h.id IS NULL) DESC, (x.price > 0) DESC, x.price DESC
    LIMIT ${limit}`)).map((r: any) => ({ key: String(r.key), kind: r.kind, id: String(r.id), lang: r.lang, image: String(r.image), attempts: Number(r.attempts) || 0 }));
}

async function hashOne(t: Todo): Promise<boolean | "circuit"> {
  const url = lowJpegUrl(t.image);
  try {
    if (!url) throw new Error("Bildadresse nicht unterstützt");
    let res: Response;
    try {
      res = await resilientFetch("tcgdex-assets", url, {}, { timeoutMs: 7000, attempts: 2 });
    } catch (e) {
      // Bild-CDN gesperrt (Circuit offen): keinen Fehlversuch für die Karte verbuchen
      if (e instanceof CircuitOpenError) return "circuit";
      throw e;
    }
    if (!res.ok) throw new Error(`Bild ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 1_500_000) throw new Error("Bild zu groß");
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    if (!(img.width > 50 && img.height > 70)) throw new Error("Bild zu klein");
    const h = referenceHashes(img.data, img.width, img.height, 4);
    const values = { artP: wordsToHex(h[0], h[1]), artD: wordsToHex(h[2], h[3]), fullP: wordsToHex(h[4], h[5]), sourceImage: t.image, computedAt: new Date(), attempts: t.attempts + 1, error: null };
    await db.execute(sql`
      INSERT INTO card_hashes (id, target_kind, target_id, lang, art_p, art_d, full_p, source_image, computed_at, attempts, error)
      VALUES (${t.key}, ${t.kind}, ${t.id}, ${t.lang}, ${values.artP}, ${values.artD}, ${values.fullP}, ${t.image}, now(), ${values.attempts}, NULL)
      ON CONFLICT (id) DO UPDATE SET art_p = EXCLUDED.art_p, art_d = EXCLUDED.art_d, full_p = EXCLUDED.full_p,
        source_image = EXCLUDED.source_image, computed_at = now(), attempts = EXCLUDED.attempts, error = NULL`);
    return true;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    await db.execute(sql`
      INSERT INTO card_hashes (id, target_kind, target_id, lang, source_image, computed_at, attempts, error)
      VALUES (${t.key}, ${t.kind}, ${t.id}, ${t.lang}, ${t.image}, now(), ${t.attempts + 1}, ${msg})
      ON CONFLICT (id) DO UPDATE SET art_p = NULL, art_d = NULL, full_p = NULL, source_image = EXCLUDED.source_image,
        computed_at = now(), attempts = card_hashes.attempts + 1, error = EXCLUDED.error`).catch(() => {});
    return false;
  }
}

// ---------------------------------------------------------------------------
// Vorberechneter Basis-Index (scripts/build-scan-seed.ts): Fingerabdrücke aller TCGdex-Karten DE/EN/JA mit Bild.
// Wird für jede Katalogkarte ohne Fingerabdruck übernommen, wenn das Bild identisch ist – der Scanner kennt so
// sofort den ganzen Katalog, statt erst über viele Job-Läufe aufzubauen. Neue Karten rechnet der Job wie bisher selbst.
// ---------------------------------------------------------------------------
type SeedEntry = { path: string; artP: string; artD: string; fullP: string };
const SEEDS: Record<Lang, { PARTS: string[]; COUNT: number; BUILT_AT: string }> = { de: seedDe, en: seedEn, ja: seedJa };
const seedCache = new Map<Lang, Map<string, SeedEntry>>();
const HEX16 = /^[0-9a-f]{16}$/;

export function seedMap(lang: Lang): Map<string, SeedEntry> {
  const hit = seedCache.get(lang);
  if (hit) return hit;
  const map = new Map<string, SeedEntry>();
  try {
    for (const part of SEEDS[lang].PARTS) {
      const text = gunzipSync(Buffer.from(part, "base64")).toString("utf8");
      for (const line of text.split("\n")) {
        const [id, path, artP, artD, fullP] = line.split("\t");
        if (id && path && HEX16.test(artP) && HEX16.test(artD) && HEX16.test(fullP)) map.set(id, { path, artP, artD, fullP });
      }
    }
  } catch (e) {
    log.error("scan-index", "Scanner-Basis-Index konnte nicht gelesen werden", { lang, err: e });
  }
  seedCache.set(lang, map);
  return map;
}

export const seedInfo = () => LANGS.map((l) => ({ lang: l, count: SEEDS[l].COUNT, builtAt: SEEDS[l].BUILT_AT }));

/** Bildpfad aus der gespeicherten Adresse: https://assets.tcgdex.net/<pfad>/high.webp → <pfad> */
const imagePath = (image: string) => (IMAGE_RE.test(image) ? image.slice("https://assets.tcgdex.net/".length, -"/high.webp".length) : "");

let seedDoneAt = 0;
/** Übernimmt Basis-Fingerabdrücke für alle Karten ohne Eintrag (höchstens alle 5 Minuten, in Blöcken zu 500). */
export async function applySeedIndex({ force = false, deadlineMs = 15_000 } = {}) {
  if (!force && Date.now() - seedDoneAt < 5 * 60_000) return { seeded: 0, skipped: true };
  const started = Date.now();
  const todo = rows(await db.execute(sql`
    SELECT x.key, x.kind, x.id, x.lang, x.image FROM (
      SELECT 'card:' || c.id AS key, 'card'::text AS kind, c.id, 'de'::text AS lang, c.image FROM cards c WHERE c.image <> ''
      UNION ALL
      SELECT 'print:' || p.id, 'print', p.id, p.lang, p.image FROM card_prints p WHERE p.image <> ''
    ) x LEFT JOIN card_hashes h ON h.id = x.key
    WHERE h.id IS NULL OR (h.art_p IS NULL AND h.source_image = x.image)
    LIMIT 60000`));
  const values: any[] = [];
  for (const r of todo) {
    const lang = String(r.lang) as Lang;
    if (!(LANGS as readonly string[]).includes(lang)) continue;
    const tcgdexId = r.kind === "print" ? String(r.id).replace(/^(en|ja):/, "") : String(r.id);
    const hit = seedMap(lang).get(tcgdexId);
    if (!hit || hit.path !== imagePath(String(r.image))) continue;
    values.push(sql`(${String(r.key)}, ${String(r.kind)}, ${String(r.id)}, ${lang}, ${hit.artP}, ${hit.artD}, ${hit.fullP}, ${String(r.image)}, now(), 1, NULL)`);
  }
  let seeded = 0;
  for (let i = 0; i < values.length && Date.now() - started < deadlineMs; i += 500) {
    const chunk = values.slice(i, i + 500);
    await db.execute(sql`
      INSERT INTO card_hashes (id, target_kind, target_id, lang, art_p, art_d, full_p, source_image, computed_at, attempts, error)
      VALUES ${sql.join(chunk, sql`, `)}
      ON CONFLICT (id) DO UPDATE SET art_p = EXCLUDED.art_p, art_d = EXCLUDED.art_d, full_p = EXCLUDED.full_p,
        source_image = EXCLUDED.source_image, computed_at = now(), error = NULL`);
    seeded += chunk.length;
  }
  if (seeded === values.length) seedDoneAt = Date.now();
  return { seeded, candidates: values.length, skipped: false };
}

/** Geplanter Lauf: erst den Basis-Index übernehmen, dann so viele Karten wie in die Zeit passen (parallel, je Bild ~100 ms). */
export async function runHashIndex({ deadlineMs = 24_000, max = 600, concurrency = 8, forceSeed = false } = {}) {
  const started = Date.now();
  const seed = await applySeedIndex({ force: forceSeed, deadlineMs: Math.min(15_000, deadlineMs / 2) }).catch((e) => {
    log.error("scan-index", "Scanner-Basis-Index", { err: e });
    return { seeded: 0, skipped: false, error: String(e?.message || e) };
  });
  const queue = await dueCards(max);
  let ok = 0, failed = 0, circuitOpen = false;
  const worker = async () => {
    while (queue.length && !circuitOpen && Date.now() - started < deadlineMs - 2500) {
      const t = queue.shift()!;
      const r = await hashOne(t);
      if (r === "circuit") { circuitOpen = true; queue.unshift(t); break; }
      if (r) ok++; else failed++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (queue.length && !circuitOpen) markPartial(`Zeitbudget: ${queue.length} Karten im nächsten Lauf`);
  return { hashed: ok, failed, seeded: seed.seeded || 0, remaining: queue.length, ms: Date.now() - started };
}

export async function scanIndexStatus() {
  const list = rows(await db.execute(sql`
    SELECT 'de' AS lang, (SELECT count(*)::int FROM cards WHERE image <> '') AS total,
      (SELECT count(*)::int FROM card_hashes WHERE lang = 'de' AND art_p IS NOT NULL) AS hashed,
      (SELECT count(*)::int FROM card_hashes WHERE lang = 'de' AND art_p IS NULL) AS failed
    UNION ALL
    SELECT l.lang, (SELECT count(*)::int FROM card_prints p WHERE p.lang = l.lang AND p.image <> ''),
      (SELECT count(*)::int FROM card_hashes h WHERE h.lang = l.lang AND h.art_p IS NOT NULL),
      (SELECT count(*)::int FROM card_hashes h WHERE h.lang = l.lang AND h.art_p IS NULL)
    FROM (VALUES ('en'), ('ja')) AS l(lang)`));
  const [last] = rows(await db.execute(sql`SELECT max(computed_at) AS at FROM card_hashes WHERE art_p IS NOT NULL`));
  return {
    langs: LANGS.map((l) => {
      const r: any = list.find((x: any) => x.lang === l) || {};
      return { lang: l, total: Number(r.total) || 0, hashed: Number(r.hashed) || 0, failed: Number(r.failed) || 0 };
    }),
    lastHashedAt: last?.at ?? null,
    seed: seedInfo(),
  };
}

/**
 * Kompakter Index einer Sprache: ids (Zeilen), Gesamtzahlen je Set (für die Nummernprüfung „199/165“) und
 * alle Fingerabdrücke als Base64 (6 × Uint32 Big-Endian je Karte, ~24 Byte).
 */
export async function buildIndex(lang: Lang) {
  const list = lang === "de"
    ? rows(await db.execute(sql`
        SELECT h.target_id AS id, h.art_p, h.art_d, h.full_p, c.set_id, COALESCE(s.card_count_official, 0) AS total
        FROM card_hashes h JOIN cards c ON c.id = h.target_id LEFT JOIN card_sets s ON s.id = c.set_id
        WHERE h.lang = 'de' AND h.target_kind = 'card' AND h.art_p IS NOT NULL ORDER BY h.target_id`))
    : rows(await db.execute(sql`
        SELECT h.target_id AS id, h.art_p, h.art_d, h.full_p, p.set_id, COALESCE(ps.card_count_official, 0) AS total
        FROM card_hashes h JOIN card_prints p ON p.id = h.target_id LEFT JOIN print_sets ps ON ps.lang = p.lang AND ps.id = p.set_id
        WHERE h.lang = ${lang} AND h.target_kind = 'print' AND h.art_p IS NOT NULL ORDER BY h.target_id`));
  const ids: string[] = [];
  const words: number[] = [];
  const sets: Record<string, number> = {};
  for (const r of list) {
    const a = hexToWords(r.art_p), b = hexToWords(r.art_d), c = hexToWords(r.full_p);
    if (!a || !b || !c) continue;
    ids.push(String(r.id));
    words.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    if (r.set_id && Number(r.total) > 0) sets[String(r.set_id)] = Number(r.total);
  }
  // Phase 9: gelernte Kamera-Fingerabdrücke (bestätigte Nutzer-Scans) als zusätzliche Zeilen derselben Karte anhängen.
  // Sie stammen aus echten Kamerabildern (Licht, Sleeves, Toploader) und treffen daher oft besser als das Referenzbild.
  const learnedStart = ids.length;
  const colors: string[] = [];
  const learned = rows(await db.execute(sql`
    SELECT target_key, art_p, art_d, full_p, color FROM scan_learned_hashes
    WHERE lang = ${lang} AND active ORDER BY confirmations DESC, hits DESC LIMIT 20000`));
  for (const r of learned) {
    const a = hexToWords(r.art_p), b = hexToWords(r.art_d), c = hexToWords(r.full_p);
    if (!a || !b || !c) continue;
    ids.push(String(r.target_key).replace(/^(card|print):/, ""));
    words.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    colors.push(isColorSig(r.color) ? r.color : "");
  }
  return {
    lang, count: ids.length, words: WORDS, ids: ids.join("\n"), sets, h: encodeBase64(packWords(words)),
    learnedStart, learned: ids.length - learnedStart, colors: colors.join("\n"), builtAt: new Date().toISOString(),
  };
}

/**
 * Text-Index einer Sprache für die Erkennung ohne KI (Name + Sammlernummer, alle Katalogkarten – auch ohne
 * Fingerabdruck). Zeilen „key⇥name⇥localId⇥total⇥setCode“; der Worker sucht darin unscharf nach dem gelesenen Namen
 * und exakt nach der Nummer („199/165“, „TG12“, „SVP 085“).
 */
export async function buildTextIndexPayload(lang: Lang) {
  const list = lang === "de"
    ? rows(await db.execute(sql`
        SELECT 'card:' || c.id AS key, c.name, COALESCE(c.local_id, '') AS local_id, COALESCE(s.card_count_official, 0) AS total,
          COALESCE(NULLIF(s.abbreviation, ''), c.set_id, '') AS code
        FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id ORDER BY c.id`))
    : rows(await db.execute(sql`
        SELECT 'print:' || p.id AS key, p.name, p.local_id, COALESCE(ps.card_count_official, 0) AS total,
          COALESCE(NULLIF(p.set_code, ''), p.set_id, '') AS code
        FROM card_prints p LEFT JOIN print_sets ps ON ps.lang = p.lang AND ps.id = p.set_id
        WHERE p.lang = ${lang} ORDER BY p.id`));
  const clean = (v: unknown) => String(v ?? "").replace(/[\t\n\r]+/g, " ").trim();
  const t = list.map((r: any) => [clean(r.key), clean(r.name), clean(r.local_id), Number(r.total) || 0, clean(r.code)].join("\t")).join("\n");
  return { lang, count: list.length, t, builtAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Phase 9: Selbstlernender Index (Stufe 2 des Hybrid-Scanners)
// ---------------------------------------------------------------------------
const HASH_HEX = /^[0-9a-f]{16}$/;
/** Kamera-Fingerabdruck gilt als plausibel, wenn sein Artwork-pHash so nah am Referenzbild liegt (von 64 Bit). */
export const LEARN_PLAUSIBLE_ART = 24;
/** So nah an einer schon gelernten Zeile → nur Zähler erhöhen statt neue Zeile */
export const LEARN_DUPLICATE = 10;
/** Höchstens so viele gelernte Zeilen je Karte (Index bleibt klein) */
export const LEARN_MAX_PER_CARD = 12;

export type LearnInput = { key: string; artP: string; artD: string; fullP: string; color?: string | null; source: "confirm" | "ai" | "admin"; userId: string };

/**
 * Speichert einen bestätigten Kamera-Fingerabdruck. Schutz gegen falsche oder böswillige Zuordnungen:
 * • plausibel zum Referenzbild (Artwork-Abstand ≤ 24 Bit) → sofort aktiv
 * • kein Referenzbild: aktiv nach KI-Erkennung + Nutzerbestätigung oder ab 2 verschiedenen Konten
 * • weicht stark vom Referenzbild ab → nur mit zweiter Bestätigung durch ein anderes Konto (z. B. Sleeve, starke Spiegelung)
 */
export async function learnScan(i: LearnInput) {
  if (!KEY_RE.test(i.key) || ![i.artP, i.artD, i.fullP].every((h) => HASH_HEX.test(h))) return { ok: false, reason: "invalid" };
  const kind = i.key.startsWith("card:") ? "card" : "print";
  const targetId = i.key.slice(kind.length + 1);
  const lang = kind === "card" ? "de" : targetId.slice(0, 2);
  const [ref] = rows(await db.execute(sql`
    SELECT art_p FROM card_hashes WHERE target_kind = ${kind} AND target_id = ${targetId} AND art_p IS NOT NULL LIMIT 1`));
  const refDist = ref ? hexDistance(i.artP, String(ref.art_p)) : null;
  const plausible = refDist !== null && refDist <= LEARN_PLAUSIBLE_ART;
  const existing = rows(await db.execute(sql`
    SELECT id, art_p, art_d, full_p, confirmations, active, first_user_id FROM scan_learned_hashes WHERE target_key = ${i.key} LIMIT 50`));
  for (const e of existing) {
    const d = (hexDistance(i.artP, e.art_p) ?? 64) + 0.75 * (hexDistance(i.artD, e.art_d) ?? 64) + 0.75 * (hexDistance(i.fullP, e.full_p) ?? 64);
    if (d > LEARN_DUPLICATE) continue;
    const vote = rows(await db.execute(sql`INSERT INTO scan_learn_votes (hash_id, user_id) VALUES (${e.id}, ${i.userId}) ON CONFLICT DO NOTHING RETURNING hash_id`));
    const confirmations = Number(e.confirmations) + (vote.length ? 1 : 0);
    const active = Boolean(e.active) || confirmations >= 2;
    await db.execute(sql`UPDATE scan_learned_hashes SET hits = hits + 1, confirmations = ${confirmations}, active = ${active},
      color = COALESCE(color, ${isColorSig(i.color) ? i.color : null}), last_seen_at = now() WHERE id = ${e.id}`);
    return { ok: true, merged: true, active };
  }
  if (existing.length >= LEARN_MAX_PER_CARD) return { ok: true, skipped: "full" };
  // Starke Abweichung vom Referenzbild ohne KI: nicht speichern (häufigster Fall: falsche Karte übernommen)
  if (refDist !== null && !plausible && i.source === "confirm") return { ok: true, skipped: "implausible" };
  const active = plausible || i.source === "admin" || (refDist === null && i.source === "ai");
  const [row] = rows(await db.execute(sql`
    INSERT INTO scan_learned_hashes (target_key, lang, art_p, art_d, full_p, color, source, active, first_user_id)
    VALUES (${i.key}, ${lang}, ${i.artP}, ${i.artD}, ${i.fullP}, ${isColorSig(i.color) ? i.color : null}, ${i.source}, ${active}, ${i.userId})
    RETURNING id`));
  if (row) await db.execute(sql`INSERT INTO scan_learn_votes (hash_id, user_id) VALUES (${row.id}, ${i.userId}) ON CONFLICT DO NOTHING`);
  return { ok: true, created: true, active };
}

export async function learnedStats() {
  const [r] = rows(await db.execute(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active, coalesce(sum(hits), 0)::int AS hits,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week FROM scan_learned_hashes`));
  return { total: Number(r?.total ?? 0), active: Number(r?.active ?? 0), hits: Number(r?.hits ?? 0), week: Number(r?.week ?? 0) };
}

type LookupRow = {
  key: string; kind: "card" | "print"; id: string; lang: string; name: string; altName: string; setName: string; setCode: string;
  number: string; image: string; rarity: string; price: number | null; priceSource: string; psa10: number | null; psa10Source: string;
  baseCardId: string | null;
  /** Scanner-Upgrade: Reverse-Holo-Preis (Cardmarket, nur deutsche Karten) und eBay-Spanne (Verkäufe der letzten 90 Tage, roh) */
  reversePrice?: number | null; ebayLow?: number | null; ebayHigh?: number | null; ebayMedian?: number | null; ebaySales?: number;
};

/** Name, Bild, Marktpreis und PSA-10-Wert für erkannte Karten (ein Aufruf für alle Sprachvarianten). */
export async function lookup(keys: string[]): Promise<LookupRow[]> {
  const cardIds = keys.filter((k) => k.startsWith("card:")).map((k) => k.slice(5));
  const printIds = keys.filter((k) => k.startsWith("print:")).map((k) => k.slice(6));
  const out: LookupRow[] = [];
  const psa = async (kind: string, id: string) => {
    // PSA 10 und Rohkarten-Verkäufe (eBay-Spanne) in einer Abfrage
    const list = rows(await db.execute(sql`SELECT grade_key, median_90::float AS med, ask_low::float AS ask, low_90::float AS low, high_90::float AS high, sample_90 AS n
      FROM grade_values WHERE target_kind = ${kind} AND target_id = ${id} AND grade_key IN ('psa10', 'raw') LIMIT 2`));
    const g = list.find((r: any) => r.grade_key === "psa10"), raw = list.find((r: any) => r.grade_key === "raw");
    const ebay = raw && Number(raw.n) > 0 ? { ebayLow: raw.low ?? null, ebayHigh: raw.high ?? null, ebayMedian: raw.med ?? null, ebaySales: Number(raw.n) || 0 } : {};
    if (g?.med) return { v: Number(g.med), src: "sold", ebay };
    if (g?.ask) return { v: Number(g.ask), src: "ask", ebay };
    return { v: null, src: "", ebay };
  };
  if (cardIds.length) {
    const list = rows(await db.execute(sql`
      SELECT c.id, c.name, c.set_name, COALESCE(NULLIF(s.abbreviation, ''), c.set_id, '') AS set_code, c.local_id, s.card_count_official AS total,
        c.image, c.rarity, COALESCE(c.trend, c.avg, c.low)::float AS price, COALESCE(c.reverse_trend, c.reverse_avg)::float AS reverse_price
      FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id WHERE c.id IN (${sql.join(cardIds.map((i) => sql`${i}`), sql`, `)})`));
    for (const r of list) {
      const p = await psa("card", r.id);
      out.push({
        key: `card:${r.id}`, kind: "card", id: String(r.id), lang: "de", name: String(r.name), altName: "", setName: String(r.set_name || ""),
        setCode: String(r.set_code || ""), number: r.local_id && /^\d+$/.test(r.local_id) && Number(r.total) > 0 ? `${r.local_id}/${r.total}` : String(r.local_id || ""),
        image: String(r.image || ""), rarity: String(r.rarity || ""), price: r.price ?? null, priceSource: "cardmarket", psa10: p.v, psa10Source: p.src, baseCardId: String(r.id),
        reversePrice: r.reverse_price ?? null, ...p.ebay,
      });
    }
  }
  if (printIds.length) {
    const list = rows(await db.execute(sql`
      SELECT p.id, p.lang, p.name, p.set_name, p.set_code, p.number, p.image, p.rarity, p.price_eur::float AS price, p.price_source, p.base_card_id,
        CASE WHEN p.lang = 'ja' THEN ps.name_de ELSE NULL END AS alt_name
      FROM card_prints p LEFT JOIN pokemon_species ps ON ps.dex_id = p.dex_id WHERE p.id IN (${sql.join(printIds.map((i) => sql`${i}`), sql`, `)})`));
    for (const r of list) {
      const p = await psa("print", r.id);
      out.push({
        key: `print:${r.id}`, kind: "print", id: String(r.id), lang: String(r.lang), name: String(r.name), altName: String(r.alt_name || ""),
        setName: String(r.set_name || ""), setCode: String(r.set_code || ""), number: String(r.number || ""), image: String(r.image || ""),
        rarity: String(r.rarity || ""), price: r.price ?? null, priceSource: String(r.price_source || ""), psa10: p.v, psa10Source: p.src,
        baseCardId: r.base_card_id ? String(r.base_card_id) : null, ...p.ebay,
      });
    }
  }
  return keys.map((k) => out.find((o) => o.key === k)).filter(Boolean) as LookupRow[];
}

export function registerScanIndex(app: any, { auth, adminOnly }: { auth: any; adminOnly: any }) {
  // Index je Sprache – vom Netlify-CDN zwischengespeichert, im Browser vom Service Worker für den Offline-Scan gehalten
  app.get("/api/scan/index", async (c: any) => {
    const lang = String(c.req.query("lang") || "de");
    if (!(LANGS as readonly string[]).includes(lang)) return c.json({ error: "Unbekannte Sprache" }, 400);
    if (!(await rateLimit(`scanidx:${clientIp(c)}`, 20, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const idx = await buildIndex(lang as Lang);
    publicCache(c, "data", { sMaxAge: 3600, swr: 86_400, varyQuery: ["lang"] });
    return c.json(idx);
  });

  // Text-Index (Name + Sammlernummer) für die Live-Erkennung ohne KI – vom CDN und offline vom Service Worker gehalten
  app.get("/api/scan/text-index", async (c: any) => {
    const lang = String(c.req.query("lang") || "de");
    if (!(LANGS as readonly string[]).includes(lang)) return c.json({ error: "Unbekannte Sprache" }, 400);
    if (!(await rateLimit(`scantxt:${clientIp(c)}`, 20, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const idx = await buildTextIndexPayload(lang as Lang);
    publicCache(c, "data", { sMaxAge: 3600, swr: 86_400, varyQuery: ["lang"] });
    return c.json(idx);
  });

  app.get("/api/scan/status", async (c: any) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ ...(await scanIndexStatus()), learned: await learnedStats().catch(() => null) });
  });

  // Details zu erkannten Karten: ?keys=card:sv03.5-199,print:en:sv03.5-199 (max. 8)
  app.get("/api/scan/lookup", async (c: any) => {
    if (!(await rateLimit(`scanlook:${clientIp(c)}`, 120, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const keys = [...new Set(str(c.req.query("keys"), 600).split(",").map((k) => k.trim()).filter((k) => KEY_RE.test(k)))].slice(0, 8);
    if (!keys.length) return c.json({ error: "Keine gültige Karte" }, 400);
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ items: await lookup(keys) });
  });

  // Stufe 2: bestätigten Scan lernen (Nutzer hat die erkannte Karte übernommen oder die KI hat sie erkannt)
  app.post("/api/scan/learn", auth, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`scanlearn:${user.id}`, 150, 86_400_000))) return c.json({ ok: true, skipped: "limit" });
    let b: any = {};
    try { b = await c.req.json(); } catch {}
    const source = b.source === "ai" ? "ai" : "confirm";
    const r = await learnScan({
      key: str(b.key, 80), artP: str(b.artP, 16).toLowerCase(), artD: str(b.artD, 16).toLowerCase(), fullP: str(b.fullP, 16).toLowerCase(),
      color: b.color ? str(b.color, 16).toLowerCase() : null, source, userId: user.id,
    });
    if (!r.ok) return c.json({ error: "Ungültiger Fingerabdruck." }, 400);
    return c.json(r);
  });

  app.post("/api/admin/scan-index/run", auth, adminOnly, async (c: any) => {
    const result = await runHashIndex({ deadlineMs: 20_000, max: 400, forceSeed: true });
    return c.json({ result, status: await scanIndexStatus() });
  });
}
