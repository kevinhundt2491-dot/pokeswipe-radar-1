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
import { referenceHashes, wordsToHex, hexToWords, packWords, encodeBase64, WORDS } from "./scan-logic.ts";

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

async function hashOne(t: Todo) {
  const url = lowJpegUrl(t.image);
  try {
    if (!url) throw new Error("Bildadresse nicht unterstützt");
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
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

/** Geplanter Lauf: so viele Karten wie in die Zeit passen (parallel, je Bild ~100 ms). */
export async function runHashIndex({ deadlineMs = 24_000, max = 600, concurrency = 8 } = {}) {
  const started = Date.now();
  const queue = await dueCards(max);
  let ok = 0, failed = 0;
  const worker = async () => {
    while (queue.length && Date.now() - started < deadlineMs - 2500) {
      const t = queue.shift()!;
      if (await hashOne(t)) ok++; else failed++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { hashed: ok, failed, remaining: queue.length, ms: Date.now() - started };
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
  return { lang, count: ids.length, words: WORDS, ids: ids.join("\n"), sets, h: encodeBase64(packWords(words)), builtAt: new Date().toISOString() };
}

type LookupRow = {
  key: string; kind: "card" | "print"; id: string; lang: string; name: string; altName: string; setName: string; setCode: string;
  number: string; image: string; rarity: string; price: number | null; priceSource: string; psa10: number | null; psa10Source: string;
  baseCardId: string | null;
};

/** Name, Bild, Marktpreis und PSA-10-Wert für erkannte Karten (ein Aufruf für alle Sprachvarianten). */
export async function lookup(keys: string[]): Promise<LookupRow[]> {
  const cardIds = keys.filter((k) => k.startsWith("card:")).map((k) => k.slice(5));
  const printIds = keys.filter((k) => k.startsWith("print:")).map((k) => k.slice(6));
  const out: LookupRow[] = [];
  const psa = async (kind: string, id: string) => {
    const [g] = rows(await db.execute(sql`SELECT median_90::float AS med, ask_low::float AS ask FROM grade_values WHERE target_kind = ${kind} AND target_id = ${id} AND grade_key = 'psa10' LIMIT 1`));
    if (g?.med) return { v: Number(g.med), src: "sold" };
    if (g?.ask) return { v: Number(g.ask), src: "ask" };
    return { v: null, src: "" };
  };
  if (cardIds.length) {
    const list = rows(await db.execute(sql`
      SELECT c.id, c.name, c.set_name, COALESCE(NULLIF(s.abbreviation, ''), c.set_id, '') AS set_code, c.local_id, s.card_count_official AS total,
        c.image, c.rarity, COALESCE(c.trend, c.avg, c.low)::float AS price
      FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id WHERE c.id IN (${sql.join(cardIds.map((i) => sql`${i}`), sql`, `)})`));
    for (const r of list) {
      const p = await psa("card", r.id);
      out.push({
        key: `card:${r.id}`, kind: "card", id: String(r.id), lang: "de", name: String(r.name), altName: "", setName: String(r.set_name || ""),
        setCode: String(r.set_code || ""), number: r.local_id && /^\d+$/.test(r.local_id) && Number(r.total) > 0 ? `${r.local_id}/${r.total}` : String(r.local_id || ""),
        image: String(r.image || ""), rarity: String(r.rarity || ""), price: r.price ?? null, priceSource: "cardmarket", psa10: p.v, psa10Source: p.src, baseCardId: String(r.id),
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
        baseCardId: r.base_card_id ? String(r.base_card_id) : null,
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
    if (!rateLimit(`scanidx:${clientIp(c)}`, 20, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const idx = await buildIndex(lang as Lang);
    c.header("Cache-Control", "public, max-age=3600");
    c.header("Netlify-CDN-Cache-Control", "public, durable, s-maxage=3600, stale-while-revalidate=86400");
    return c.json(idx);
  });

  app.get("/api/scan/status", async (c: any) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(await scanIndexStatus());
  });

  // Details zu erkannten Karten: ?keys=card:sv03.5-199,print:en:sv03.5-199 (max. 8)
  app.get("/api/scan/lookup", async (c: any) => {
    if (!rateLimit(`scanlook:${clientIp(c)}`, 120, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const keys = [...new Set(str(c.req.query("keys"), 600).split(",").map((k) => k.trim()).filter((k) => KEY_RE.test(k)))].slice(0, 8);
    if (!keys.length) return c.json({ error: "Keine gültige Karte" }, 400);
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ items: await lookup(keys) });
  });

  app.post("/api/admin/scan-index/run", auth, adminOnly, async (c: any) => {
    const result = await runHashIndex({ deadlineMs: 20_000, max: 400 });
    return c.json({ result, status: await scanIndexStatus() });
  });
}
