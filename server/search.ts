// Serverseitige Hochgeschwindigkeits-Suche über den eigenen Katalog (Phase 6)
// GET /api/search?q=Glurak 4/102&lang=de,en,ja&set=&variant=&rarity=&min=&max=&limit=&offset=
// • Deutsche Karten (cards) + englische/japanische Drucke (card_prints) in EINER Abfrage
// • Tippfehlertolerant über pg_trgm (GIN-Indizes aus Migration add_trgm_search_indexes): LIKE + word_similarity (<%, Schwelle 0,6)
// • Kartennummer („4/102“, „#199“), Set-Kürzel, Sprache, Variante, Seltenheit, Preisspanne
// • Öffentlich und nicht personalisiert → CDN-Cache (Netlify-Vary: query) + kurzer Speicher-Cache je Instanz
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.ts";
import { rows, rateLimit, clientIp } from "./util.ts";
import { publicCache } from "./cache.ts";
import { RARITY_SQL, rarityBucket } from "./intl-logic.ts";
import { parseSearchQuery, parseSearchFilters, searchCacheKey, type ParsedQuery, type SearchFilters } from "./search-logic.ts";
import { availableVariants, VARIANT_LABELS } from "./variant-logic.ts";

const memo = new Map<string, { at: number; data: unknown }>();
const MEMO_MS = 60_000;
const MEMO_MAX = 2000;

function rememberResult(key: string, data: unknown) {
  if (memo.size >= MEMO_MAX) {
    // ältesten Eintrag verdrängen (Map behält die Einfüge-Reihenfolge)
    const first = memo.keys().next().value;
    if (first !== undefined) memo.delete(first);
  }
  memo.set(key, { at: Date.now(), data });
}

const rarityFilter = (f: SearchFilters, col: SQL): SQL => {
  if (!f.rarity) return sql``;
  const { include, exclude } = RARITY_SQL[f.rarity];
  return sql`${include ? sql` AND ${col} ~* ${include}` : sql``}${exclude ? sql` AND (${col} IS NULL OR ${col} !~* ${exclude})` : sql``}`;
};

const VARIANT_FIELD: Record<string, string> = { normal: "normal", reverse_holo: "reverse", holo: "holo", first_edition: "firstEdition", promo: "wPromo" };

export async function searchCatalog(q: ParsedQuery, f: SearchFilters) {
  const langs = q.langHint && f.langs.includes(q.langHint) ? [q.langHint] : f.langs;
  const text = q.text;
  const like = `%${text}%`;
  const hasText = text.length >= 2;
  if (!hasText && !q.number && !q.cardId && !f.set && !q.setCode) return { items: [], total: 0 };

  const nameMatch = (col: SQL) => hasText
    ? sql` AND (lower(${col}) LIKE ${like} OR ${text} <% lower(${col}))`
    : sql``;
  const score = (col: SQL) => hasText
    ? sql`(CASE WHEN lower(${col}) = ${text} THEN 3 WHEN lower(${col}) LIKE ${text + "%"} THEN 2 ELSE 0 END + word_similarity(${text}, lower(${col})))`
    : sql`0`;
  const minPrice = f.min !== null ? f.min : null, maxPrice = f.max !== null ? f.max : null;

  const parts: SQL[] = [];
  if (langs.includes("de")) {
    // Variante: nur Karten, die es in dieser Ausführung gibt (TCGdex-Varianten); Shadowless gibt es nur bei Base Set
    const vField = f.variant ? VARIANT_FIELD[f.variant] : null;
    const variantCond = f.variant === "shadowless" ? sql` AND c.set_id = 'base1'`
      : vField ? sql` AND (',' || coalesce(c.variants, '') || ',') LIKE ${`%,${vField},%`}` : sql``;
    const priceExpr = f.variant === "reverse_holo" ? sql`COALESCE(c.reverse_trend, c.reverse_avg, c.trend, c.avg, c.low)` : sql`COALESCE(c.trend, c.avg, c.low)`;
    parts.push(sql`
      SELECT 'de'::text AS lang, c.id AS id, c.id AS card_id, NULL::text AS print_id, c.name, c.set_id, c.set_name,
        COALESCE(s.abbreviation, '') AS set_code, c.local_id,
        CASE WHEN s.card_count_official > 0 THEN ltrim(c.local_id, '0') || '/' || s.card_count_official ELSE c.local_id END AS number,
        c.image, c.rarity, c.variants, c.illustrator, ${priceExpr}::float AS price, c.reverse_trend::float AS reverse_price,
        ${score(sql`c.name`)} AS score
      FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
      WHERE c.name <> ''
        ${q.cardId ? sql` AND c.id = ${q.cardId}` : sql``}
        ${nameMatch(sql`c.name`)}
        ${q.number ? sql` AND ltrim(c.local_id, '0') = ${q.number}` : sql``}
        ${q.total ? sql` AND s.card_count_official = ${q.total}` : sql``}
        ${q.setCode ? sql` AND upper(s.abbreviation) = ${q.setCode}` : sql``}
        ${f.set ? sql` AND c.set_id = ${f.set}` : sql``}
        ${variantCond}
        ${rarityFilter(f, sql`c.rarity`)}
        ${minPrice !== null ? sql` AND ${priceExpr} >= ${minPrice}` : sql``}
        ${maxPrice !== null ? sql` AND ${priceExpr} <= ${maxPrice}` : sql``}`);
  }
  const printLangs = langs.filter((l) => l !== "de");
  if (printLangs.length && f.variant !== "shadowless") {
    parts.push(sql`
      SELECT p.lang, p.id AS id, p.base_card_id AS card_id, p.id AS print_id, p.name, p.set_id, p.set_name,
        COALESCE(NULLIF(p.set_code, ''), ps.code, '') AS set_code, p.local_id, p.number,
        p.image, p.rarity, NULL::text AS variants, NULL::text AS illustrator,
        ${f.variant && f.variant !== "normal" ? sql`COALESCE(NULLIF(p.variant_prices->${f.variant}->>'price', '')::numeric, p.price_eur)` : sql`p.price_eur`}::float AS price,
        NULLIF(p.variant_prices->'reverse_holo'->>'price', '')::float AS reverse_price,
        ${score(sql`p.name`)} AS score
      FROM card_prints p LEFT JOIN print_sets ps ON ps.lang = p.lang AND ps.id = p.set_id
      WHERE p.lang IN (${sql.join(printLangs.map((l) => sql`${l}`), sql`, `)})
        ${q.cardId ? sql` AND p.tcgdex_id = ${q.cardId}` : sql``}
        ${nameMatch(sql`p.name`)}
        ${q.number ? sql` AND ltrim(p.local_id, '0') = ${q.number}` : sql``}
        ${q.total ? sql` AND ps.card_count_official = ${q.total}` : sql``}
        ${q.setCode ? sql` AND (upper(p.set_code) = ${q.setCode} OR upper(ps.code) = ${q.setCode})` : sql``}
        ${f.set ? sql` AND p.set_id = ${f.set}` : sql``}
        ${f.variant && f.variant !== "normal" && f.variant !== "holo" ? sql` AND p.variant_prices ? ${f.variant}` : sql``}
        ${rarityFilter(f, sql`p.rarity`)}
        ${minPrice !== null ? sql` AND p.price_eur >= ${minPrice}` : sql``}
        ${maxPrice !== null ? sql` AND p.price_eur <= ${maxPrice}` : sql``}`);
  }
  if (!parts.length) return { items: [], total: 0 };

  const union = sql.join(parts, sql` UNION ALL `);
  const list = rows(await db.execute(sql`
    SELECT *, count(*) OVER()::int AS total_count FROM (${union}) r
    ORDER BY r.score DESC, r.price DESC NULLS LAST, r.name ASC
    LIMIT ${f.limit} OFFSET ${f.offset}`));
  return {
    total: Number(list[0]?.total_count ?? 0),
    items: list.map((r: any) => ({
      lang: String(r.lang),
      id: String(r.id),
      cardId: r.card_id ? String(r.card_id) : null,
      printId: r.print_id ? String(r.print_id) : null,
      name: String(r.name),
      setId: String(r.set_id || ""),
      setName: String(r.set_name || ""),
      setCode: String(r.set_code || ""),
      number: String(r.number || r.local_id || ""),
      image: String(r.image || ""),
      rarity: r.rarity ? String(r.rarity) : "",
      rarityBucket: rarityBucket(r.rarity),
      illustrator: r.illustrator ? String(r.illustrator) : "",
      variants: availableVariants(r.variants).map((v) => ({ key: v, label: VARIANT_LABELS[v] })),
      price: r.price != null ? Number(r.price) : null,
      reversePrice: r.reverse_price != null ? Number(r.reverse_price) : null,
      score: Math.round(Number(r.score || 0) * 100) / 100,
    })),
  };
}

export function registerSearch(app: any) {
  app.get("/api/search", async (c: any) => {
    if (!(await rateLimit(`search:${clientIp(c)}`, 90, 60_000))) return c.json({ error: "Zu viele Suchanfragen. Bitte kurz warten." }, 429);
    const qs = c.req.query();
    const q = parseSearchQuery(qs.q);
    const f = parseSearchFilters(qs);
    if ("error" in f) return c.json({ error: f.error }, 400);
    if (q.text.length === 1 && !q.number && !q.cardId && !f.set) return c.json({ error: "Bitte mindestens 2 Zeichen eingeben." }, 400);
    const key = searchCacheKey(q, f);
    const hit = memo.get(key);
    let data: any;
    if (hit && Date.now() - hit.at < MEMO_MS) data = hit.data;
    else {
      data = await searchCatalog(q, f);
      rememberResult(key, data);
    }
    publicCache(c, "data", { varyQuery: ["q", "lang", "set", "variant", "rarity", "min", "max", "limit", "offset"], sMaxAge: 300, swr: 3600 });
    return c.json({ query: { ...q }, filters: f, ...data });
  });
}
