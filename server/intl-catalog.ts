// PokeSwipe & Radar – mehrsprachiger Katalog (Englisch & Japanisch zusätzlich zum deutschen Katalog)
// und die dynamische Swipe-Arena, die direkt aus Katalog, Tausch-Inseraten und Wunschliste gespeist wird.
//
// Import (geplante Funktion catalog-intl-import, alle 10 Minuten):
//   EZB-Kurse → Set-Listen en/ja (täglich) → neue/alte Sets mit allen Karten → Preise der ältesten Drucke
//   (Cardmarket EUR + TCGplayer USD getrennt gespeichert) → deutsche Partnerkarte verknüpfen → Sammlungswerte auffrischen.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, cardPrints, cardPrintPrices, printSets, fxRates } from "../db/index.ts";
import { verifyIdentityToken } from "./auth.ts";
import { printVariantPrices } from "./variant-logic.ts";
import { deckPrefs, prefFactorSql } from "./arena.ts";
import type { PrefProfile } from "./arena-logic.ts";
import { str, int, rows, rateLimit, clientIp } from "./util.ts";
import { publicCache } from "./cache.ts";
import { resilientFetch, markPartial, CircuitOpenError } from "./resilience.ts";
import {
  PRINT_LANGS, PRINT_ID_RE, TCGDEX_ID_RE, SET_ID_RE, LANG_LABEL, LANG_FLAG, RARITY_SQL, RARITY_LABEL, RARITY_BUCKETS, DEAL_MIN_PCT, DEAL_MIN_PRICE, HIT_MIN_PRICE_WITHOUT_RARITY,
  FX_FALLBACK, printId, splitPrintId, displayNumber, pickCardmarket, pickTcgplayer, choosePrice, parseEcbXml, parseDeckQuery,
  normLang, rarityBucket, dealPct, toEur, DIGITAL_SERIES, estimatedPriority, releasePriority, type PrintLang, type Fx, type CatalogLang,
} from "./intl-logic.ts";

const TCGDEX = "https://api.tcgdex.net/v2";
const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const SET_LIST_MAX_AGE_MS = 86400_000;
const SET_REFRESH_MS = 7 * 86400_000;
const PRINT_PRICE_MAX_AGE_MS = 3 * 86400_000;
const PRINT_ON_DEMAND_MAX_AGE_MS = 6 * 3600_000;
const FX_MAX_AGE_MS = 20 * 3600_000;

const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const money2 = (n: number | null) => (n && n > 0 ? n.toFixed(2) : null);
const tcgdexImage = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9/._\-]{3,250}$/.test(s) ? `${s}/high.webp` : "";
};
const tcgdexAsset = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9/._\-]{3,250}$/.test(s) ? s : "";
};

async function tcgdex(lang: PrintLang, path: string, timeoutMs = 9000) {
  const res = await resilientFetch("tcgdex", `${TCGDEX}/${lang}${path}`, { headers: { Accept: "application/json" } }, { timeoutMs, attempts: 3 });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCGdex ${lang} ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Wechselkurse (EZB)
// ---------------------------------------------------------------------------
let fxCache: { fx: Fx; at: number } | null = null;

export async function refreshFx(force = false) {
  const [usd] = await db.select().from(fxRates).where(eq(fxRates.currency, "USD")).limit(1);
  if (!force && usd && Date.now() - usd.updatedAt.getTime() < FX_MAX_AGE_MS) return false;
  const res = await resilientFetch("ecb", ECB_URL, {}, { timeoutMs: 8000, attempts: 3 });
  if (!res.ok) throw new Error(`EZB ${res.status}`);
  const parsed = parseEcbXml(await res.text());
  if (!parsed.day) throw new Error("EZB-Kurse unvollständig");
  for (const cur of ["USD", "JPY"] as const) {
    const rate = parsed[cur];
    if (!rate) continue;
    await db.insert(fxRates).values({ currency: cur, perEur: rate.toFixed(4), rateDay: parsed.day })
      .onConflictDoUpdate({ target: fxRates.currency, set: { perEur: rate.toFixed(4), rateDay: parsed.day, updatedAt: new Date() } });
  }
  fxCache = null;
  return true;
}

export async function getFx(): Promise<Fx> {
  if (fxCache && Date.now() - fxCache.at < 10 * 60_000) return fxCache.fx;
  const list = await db.select().from(fxRates).catch(() => []);
  const get = (c: string) => list.find((r) => r.currency === c);
  const usd = get("USD"), jpy = get("JPY");
  const fx: Fx = usd && jpy
    ? { USD: Number(usd.perEur), JPY: Number(jpy.perEur), day: String(usd.rateDay), estimated: false }
    : { USD: usd ? Number(usd.perEur) : FX_FALLBACK.USD, JPY: jpy ? Number(jpy.perEur) : FX_FALLBACK.JPY, day: usd ? String(usd.rateDay) : null, estimated: !usd };
  // Geschätzte Notfallkurse nur kurz merken – echte EZB-Kurse kommen mit dem nächsten Import
  fxCache = { fx, at: fx.estimated ? Date.now() - 9 * 60_000 : Date.now() };
  return fx;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
/** Serien → Sets (für Serien-Zuordnung, Import-Reihenfolge und zum Ausschluss digitaler TCG-Pocket-Sets). */
async function serieMap(lang: PrintLang) {
  const series: any[] = (await tcgdex(lang, "/series", 10_000)) || [];
  const map = new Map<string, { serieId: string; serieName: string; priority: number; digital: boolean }>();
  const list = series.filter((s) => s?.id && SET_ID_RE.test(String(s.id)));
  for (let i = 0; i < list.length; i += 6) {
    const chunk = await Promise.all(list.slice(i, i + 6).map((s) => tcgdex(lang, `/series/${encodeURIComponent(String(s.id))}`, 8000).catch(() => null)));
    chunk.forEach((detail: any, j) => {
      const serie = list[i + j];
      const sets: any[] = Array.isArray(detail?.sets) ? detail.sets : [];
      sets.forEach((set, pos) => {
        if (!set?.id) return;
        map.set(String(set.id), {
          serieId: String(serie.id).slice(0, 40), serieName: String(serie.name || "").slice(0, 120),
          priority: estimatedPriority(serie.id, pos), digital: DIGITAL_SERIES.has(String(serie.id).toLowerCase()),
        });
      });
    });
  }
  return map;
}

export async function syncPrintSetList(lang: PrintLang) {
  const list: any[] = (await tcgdex(lang, "/sets", 12_000)) || [];
  const series = await serieMap(lang).catch(() => new Map());
  let added = 0, skipped = 0;
  for (const s of list) {
    const id = String(s?.id || "");
    if (!SET_ID_RE.test(id) || !s?.name) continue;
    const serie = series.get(id);
    if (serie?.digital) {
      skipped++;
      await db.update(printSets).set({ active: false, updatedAt: new Date() }).where(and(eq(printSets.lang, lang), eq(printSets.id, id)));
      continue;
    }
    const name = String(s.name).slice(0, 120);
    const official = int(s.cardCount?.official, 0, 5000, 0), total = int(s.cardCount?.total, 0, 5000, 0);
    const priority = serie?.priority ?? 0;
    const [row] = await db.insert(printSets).values({
      lang, id, name, code: id.slice(0, 20), logo: tcgdexAsset(s.logo), symbol: tcgdexAsset(s.symbol),
      serieId: serie?.serieId ?? "", serieName: serie?.serieName ?? "",
      cardCountOfficial: official, cardCountTotal: total, priority,
    }).onConflictDoUpdate({
      target: [printSets.lang, printSets.id],
      set: {
        name, cardCountOfficial: official, cardCountTotal: total, updatedAt: new Date(),
        // Geschätzte Priorität nur, solange noch kein echtes Datum bekannt ist
        priority: sql`CASE WHEN ${printSets.releaseDate} IS NULL THEN ${priority} ELSE ${printSets.priority} END`,
        serieId: sql`CASE WHEN ${printSets.serieId} = '' THEN ${serie?.serieId ?? ""} ELSE ${printSets.serieId} END`,
      },
    }).returning({ cardsImportedAt: printSets.cardsImportedAt });
    if (row && !row.cardsImportedAt) added++;
  }
  return { lang, sets: list.length, pending: added, digitalSkipped: skipped };
}

export async function importPrintSet(lang: PrintLang, setId: string) {
  if (!SET_ID_RE.test(setId)) throw new Error("Ungültige Set-ID");
  const data: any = await tcgdex(lang, `/sets/${encodeURIComponent(setId)}`);
  if (!data) {
    await db.update(printSets).set({ active: false, updatedAt: new Date() }).where(and(eq(printSets.lang, lang), eq(printSets.id, setId)));
    return { lang, setId, cards: 0 };
  }
  const name = String(data.name || setId).slice(0, 120);
  const release = validDate(data.releaseDate);
  const official = int(data.cardCount?.official, 0, 5000, 0);
  const code = String(data.abbreviation?.official || setId).slice(0, 20);
  await db.update(printSets).set({
    name, code,
    serieId: String(data.serie?.id || "").slice(0, 40),
    serieName: String(data.serie?.name || "").slice(0, 120),
    logo: tcgdexAsset(data.logo), symbol: tcgdexAsset(data.symbol),
    releaseDate: release,
    cardCountOfficial: official,
    cardCountTotal: int(data.cardCount?.total, 0, 5000, 0),
    priority: release ? releasePriority(release, 0) : sql`${printSets.priority}`,
    updatedAt: new Date(),
  }).where(and(eq(printSets.lang, lang), eq(printSets.id, setId)));

  const list: any[] = Array.isArray(data.cards) ? data.cards : [];
  const values = list
    .filter((c) => c?.id && TCGDEX_ID_RE.test(String(c.id)) && c.name)
    .map((c) => {
      const localId = String(c.localId ?? "").slice(0, 20);
      return {
        id: printId(lang, String(c.id)), lang, tcgdexId: String(c.id), name: String(c.name).slice(0, 120),
        setId, setName: name, setCode: code, localId, number: displayNumber(localId, official), image: tcgdexImage(c.image),
      };
    });
  for (let i = 0; i < values.length; i += 250) {
    await db.insert(cardPrints).values(values.slice(i, i + 250)).onConflictDoUpdate({
      target: cardPrints.id,
      set: {
        name: sql`excluded.name`, setName: sql`excluded.set_name`, setCode: sql`excluded.set_code`,
        localId: sql`excluded.local_id`, number: sql`excluded.number`,
        image: sql`CASE WHEN excluded.image = '' THEN ${cardPrints.image} ELSE excluded.image END`,
      },
    });
  }
  await db.update(printSets).set({ cardsImportedAt: new Date() }).where(and(eq(printSets.lang, lang), eq(printSets.id, setId)));
  return { lang, setId, cards: values.length };
}

/** Lädt einen Druck inkl. beider Preis-Feeds von TCGdex und speichert ihn (plus Tageswert im Verlauf). */
export async function refreshPrint(id: string) {
  const parts = splitPrintId(id);
  if (!parts) throw new Error("Ungültige Druck-ID");
  const data: any = await tcgdex(parts.lang, `/cards/${encodeURIComponent(parts.tcgdexId)}`);
  if (!data) {
    await db.update(cardPrints).set({ checkedAt: new Date() }).where(eq(cardPrints.id, id));
    return null;
  }
  const fx = await getFx();
  const cm = pickCardmarket(data.pricing?.cardmarket);
  const tcg = pickTcgplayer(data.pricing?.tcgplayer);
  const chosen = choosePrice(cm, tcg, fx.USD);
  const official = int(data.set?.cardCount?.official, 0, 5000, 0);
  const localId = data.localId != null ? String(data.localId).slice(0, 20) : "";
  const setId = SET_ID_RE.test(String(data.set?.id || "")) ? String(data.set.id) : "";
  const row = {
    id, lang: parts.lang, tcgdexId: parts.tcgdexId,
    name: String(data.name || parts.tcgdexId).slice(0, 120),
    setId: setId || "unbekannt",
    setName: String(data.set?.name || "").slice(0, 120),
    localId,
    number: displayNumber(localId, official),
    image: tcgdexImage(data.image),
    rarity: data.rarity ? String(data.rarity).slice(0, 80) : null,
    category: data.category ? String(data.category).slice(0, 30) : null,
    dexId: Array.isArray(data.dexId) && Number.isInteger(data.dexId[0]) && data.dexId[0] > 0 && data.dexId[0] < 2000 ? data.dexId[0] : null,
    cmTrend: money2(cm.trend), cmLow: money2(cm.low), cmAvg7: money2(cm.avg7), cmAvg30: money2(cm.avg30), cmUpdatedAt: cm.updated,
    tcgMarketUsd: money2(tcg.market), tcgLowUsd: money2(tcg.low), tcgVariant: tcg.variant, tcgUpdatedAt: tcg.updated,
    priceEur: money2(chosen.priceEur), lowEur: money2(chosen.lowEur), priceSource: chosen.source,
    // Phase 6: Preise je Variante (TCGplayer, in EUR umgerechnet) + Reverse-Holo-Reihe von Cardmarket
    variantPrices: printVariantPrices(data.pricing, fx.USD),
    checkedAt: new Date(),
  };
  const { id: _id, lang: _l, tcgdexId: _t, ...updates } = row;
  const [saved] = await db.insert(cardPrints).values(row).onConflictDoUpdate({
    target: cardPrints.id,
    set: { ...updates, image: row.image ? row.image : sql`${cardPrints.image}`, setId: setId ? setId : sql`${cardPrints.setId}` },
  }).returning();
  if (row.priceEur || row.cmTrend || row.tcgMarketUsd) {
    await db.insert(cardPrintPrices).values({ printId: id, day: today(), priceEur: row.priceEur, cmTrend: row.cmTrend, tcgMarketUsd: row.tcgMarketUsd })
      .onConflictDoUpdate({ target: [cardPrintPrices.printId, cardPrintPrices.day], set: { priceEur: row.priceEur, cmTrend: row.cmTrend, tcgMarketUsd: row.tcgMarketUsd } });
  }
  return saved;
}

export async function getPrint(id: string, maxAgeMs = PRINT_ON_DEMAND_MAX_AGE_MS) {
  const [existing] = await db.select().from(cardPrints).where(eq(cardPrints.id, id)).limit(1);
  if (existing?.checkedAt && Date.now() - existing.checkedAt.getTime() < maxAgeMs) return existing;
  try { return (await refreshPrint(id)) ?? existing ?? null; } catch { return existing ?? null; }
}

/** Englische Drucke mit der deutschen Karte verknüpfen (gleiche TCGdex-ID = gleiches Cardmarket-Produkt). */
async function linkBaseCards() {
  const r = await db.execute(sql`
    UPDATE card_prints p SET base_card_id = c.id FROM cards c
    WHERE p.lang = 'en' AND p.base_card_id IS NULL AND c.id = p.tcgdex_id`);
  return Number((r as any)?.rowCount ?? 0);
}

/** Sammlungs-Einträge japanischer Drucke (ohne deutsche Partnerkarte) bekommen den aktuellen Referenzpreis. */
async function refreshPrintPortfolioValues() {
  const r = await db.execute(sql`
    UPDATE portfolio_items p SET manual_value = cp.price_eur FROM card_prints cp
    WHERE p.print_id = cp.id AND p.card_id IS NULL AND cp.price_eur IS NOT NULL
      AND (p.manual_value IS NULL OR p.manual_value <> cp.price_eur)`);
  return Number((r as any)?.rowCount ?? 0);
}

export async function runIntlCatalogImport({ deadlineMs = 22_000, maxSetsPerLang = 2, maxPrices = 60 } = {}) {
  const deadline = Date.now() + deadlineMs;
  const result = { fx: false, setLists: [] as string[], setsImported: [] as string[], prices: 0, linked: 0, portfolio: 0, errors: 0 };
  try { result.fx = await refreshFx(); } catch (e) { result.errors++; console.warn("Katalog intl: EZB-Kurse nicht geladen", e); }

  for (const lang of PRINT_LANGS) {
    if (Date.now() > deadline - 8000) { markPartial(`Zeitbudget: Sprache ${lang} im nächsten Lauf`); break; }
    const [state] = rows(await db.execute(sql`SELECT count(*)::int AS n, max(updated_at) AS last FROM print_sets WHERE lang = ${lang}`));
    if (!Number(state?.n) || !state?.last || Date.now() - new Date(state.last).getTime() > SET_LIST_MAX_AGE_MS) {
      try { await syncPrintSetList(lang); result.setLists.push(lang); } catch (e) { result.errors++; console.warn("Katalog intl: Set-Liste", lang, e); }
    }
    const due = await db.select({ id: printSets.id }).from(printSets)
      .where(and(eq(printSets.lang, lang), eq(printSets.active, true),
        sql`(${printSets.cardsImportedAt} IS NULL OR ${printSets.cardsImportedAt} < ${new Date(Date.now() - SET_REFRESH_MS)})`))
      .orderBy(sql`${printSets.cardsImportedAt} IS NOT NULL`, desc(printSets.priority), sql`${printSets.releaseDate} DESC NULLS LAST`, asc(printSets.id))
      .limit(maxSetsPerLang);
    for (const s of due) {
      if (Date.now() > deadline - 7000) { markPartial("Zeitbudget: weitere Sets im nächsten Lauf"); break; }
      try { await importPrintSet(lang, s.id); result.setsImported.push(`${lang}:${s.id}`); } catch (e) { result.errors++; console.warn("Katalog intl: Set", lang, s.id, e); }
    }
  }

  // Preise: je Sprache gleich viele (sonst verdrängt der größere englische Katalog den japanischen);
  // zuerst nie geprüfte Drucke mit Bild, neue Sets zuerst und darin die hohen Nummern (Secret/Illustration Rares)
  const perLang = Math.max(1, Math.ceil(maxPrices / PRINT_LANGS.length));
  const stale: any[] = [];
  for (const lang of PRINT_LANGS) {
    stale.push(...rows(await db.execute(sql`
      SELECT p.id FROM card_prints p LEFT JOIN print_sets s ON s.lang = p.lang AND s.id = p.set_id
      WHERE p.lang = ${lang} AND (p.checked_at IS NULL OR p.checked_at < ${new Date(Date.now() - PRINT_PRICE_MAX_AGE_MS)}) AND COALESCE(s.active, true)
      ORDER BY (p.checked_at IS NOT NULL), (p.image = ''), s.priority DESC NULLS LAST, s.release_date DESC NULLS LAST,
        (CASE WHEN p.local_id ~ '^[0-9]{1,4}$' THEN p.local_id::int ELSE 0 END) DESC, p.checked_at ASC NULLS FIRST
      LIMIT ${perLang}
    `)));
  }
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < stale.length && Date.now() < deadline - 2500) {
      const id = String(stale[i++].id);
      try { await refreshPrint(id); result.prices++; } catch (e) { result.errors++; if (e instanceof CircuitOpenError) break; }
    }
  }));
  if (i < stale.length) markPartial(`Zeitbudget/Quelle: ${stale.length - i} Preise offen`);

  try {
    result.linked = await linkBaseCards();
    result.portfolio = await refreshPrintPortfolioValues();
  } catch (e) { result.errors++; console.warn("Katalog intl: Verknüpfung", e); }
  return result;
}

export async function intlCatalogStatus() {
  const stats = rows(await db.execute(sql`
    SELECT s.lang,
      count(*)::int AS sets,
      count(*) FILTER (WHERE s.cards_imported_at IS NOT NULL)::int AS sets_imported,
      (SELECT count(*)::int FROM card_prints p WHERE p.lang = s.lang) AS prints,
      (SELECT count(*)::int FROM card_prints p WHERE p.lang = s.lang AND p.checked_at IS NOT NULL) AS checked,
      (SELECT count(*)::int FROM card_prints p WHERE p.lang = s.lang AND p.price_eur IS NOT NULL) AS priced,
      (SELECT count(*)::int FROM card_prints p WHERE p.lang = s.lang AND p.tcg_market_usd IS NOT NULL) AS tcgplayer
    FROM print_sets s WHERE s.active GROUP BY s.lang ORDER BY s.lang`));
  return { langs: stats, fx: await getFx() };
}

// ---------------------------------------------------------------------------
// Swipe-Arena: dynamischer Stapel aus Katalog (de/en/ja) + Tausch-Inseraten
// ---------------------------------------------------------------------------
type DeckOpts = ReturnType<typeof parseDeckQuery>;

function rarityWhere(opts: DeckOpts, col = sql`x.rarity`, priceCol = sql`x.price`) {
  if (opts.anyRarity || !opts.rarity) return sql``;
  const { include, exclude } = RARITY_SQL[opts.rarity];
  // „Hits“: alles ab Selten; Karten ohne Seltenheitsangabe (oft japanische Drucke) zählen ab einem Mindestwert
  if (opts.rarity === "hits") {
    return sql` AND ((${col} IS NOT NULL AND ${col} !~* ${exclude}) OR (${col} IS NULL AND ${priceCol} >= ${HIT_MIN_PRICE_WITHOUT_RARITY}))`;
  }
  return sql`${include ? sql` AND ${col} ~* ${include}` : sql``}${exclude ? sql` AND (${col} IS NULL OR ${col} !~* ${exclude})` : sql``}`;
}

export async function buildDeck(opts: DeckOpts, userId: string | null, prefs: PrefProfile | null = null) {
  const langs = opts.langs;
  const hasDe = langs.includes("de");
  const printLangs = langs.filter((l) => l !== "de");
  const wishIds = opts.wishlist && userId
    ? rows(await db.execute(sql`SELECT card_id FROM wishlist_items WHERE user_id = ${userId}`)).map((r: any) => String(r.card_id))
    : [];
  if (opts.wishlist && !wishIds.length) return { items: [], wishlistEmpty: true };
  const wishWhere = opts.wishlist ? sql` AND x.card_id IN (SELECT card_id FROM wishlist_items WHERE user_id = ${userId})` : sql``;
  const setWhere = opts.set ? sql` AND x.lang = ${opts.set.lang} AND x.set_id = ${opts.set.id}` : sql``;
  const priceWhere = sql`${opts.min !== null && opts.min > 0 ? sql` AND x.price >= ${opts.min}` : sql``}${opts.max !== null ? sql` AND x.price <= ${opts.max}` : sql``}`;
  const dealWhere = opts.deals ? sql` AND x.low > 0 AND x.price >= ${DEAL_MIN_PRICE} AND x.low <= x.price * ${(100 - DEAL_MIN_PCT) / 100}` : sql``;
  const exclude = opts.exclude.filter((e) => !e.startsWith("l"));
  const excludeWhere = exclude.length ? sql` AND x.print_id NOT IN (${sql.join(exclude.map((e) => sql`${e}`), sql`, `)})` : sql``;

  const parts = [];
  if (hasDe) parts.push(sql`
    SELECT 'de'::text AS lang, c.id AS print_id, c.id AS card_id, c.name, c.set_id, c.set_name,
      COALESCE(NULLIF(s.abbreviation, ''), c.set_id, '') AS set_code, c.local_id,
      CASE WHEN c.local_id ~ '^[0-9]+$' AND s.card_count_official > 0 THEN c.local_id || '/' || lpad(s.card_count_official::text, GREATEST(length(c.local_id), length(s.card_count_official::text)), '0') ELSE COALESCE(c.local_id, '') END AS number,
      c.image, c.rarity, COALESCE(c.trend, c.avg, c.low)::float AS price, c.low::float AS low, c.avg30::float AS avg30,
      'cardmarket'::text AS source, NULL::float AS usd, NULL::text AS alt_name
    FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
    WHERE c.image <> '' AND COALESCE(c.trend, c.avg, c.low) IS NOT NULL`);
  if (printLangs.length) parts.push(sql`
    SELECT p.lang, p.id AS print_id, p.base_card_id AS card_id, p.name, p.set_id, p.set_name, p.set_code, p.local_id, p.number,
      p.image, p.rarity, p.price_eur::float AS price, p.low_eur::float AS low, p.cm_avg30::float AS avg30,
      p.price_source AS source, p.tcg_market_usd::float AS usd,
      CASE WHEN p.lang = 'ja' THEN ps.name_de ELSE NULL END AS alt_name
    FROM card_prints p LEFT JOIN pokemon_species ps ON ps.dex_id = p.dex_id
    WHERE p.lang IN (${sql.join(printLangs.map((l) => sql`${l}`), sql`, `)}) AND p.image <> '' AND p.price_eur IS NOT NULL`);

  const want = opts.listings && !opts.set ? Math.ceil(opts.limit * 0.75) : opts.limit;
  const cards = parts.length ? rows(await db.execute(sql`
    SELECT * FROM (${sql.join(parts, sql` UNION ALL `)}) x
    WHERE TRUE ${setWhere}${priceWhere}${dealWhere}${wishWhere}${excludeWhere}${rarityWhere(opts)}
    ORDER BY -ln(1 - random()) / (GREATEST(ln(COALESCE(x.price, 0) + 2), 0.6) * ${prefFactorSql(prefs)})
    LIMIT ${want}
  `)) : [];

  // Tausch-Inserate (deutscher Markt) als eigene Karten im Stapel – mit Marktpreis-Vergleich
  let listingRows: any[] = [];
  if (opts.listings && !opts.set && (hasDe || langs.includes("en"))) {
    const exL = opts.exclude.filter((e) => e.startsWith("l")).map((e) => Number(e.slice(1))).filter((n) => n > 0);
    listingRows = rows(await db.execute(sql`
      SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.want, l.city, l.boosted_until > now() AS boosted,
        l.variant, l.condition, l.lang AS listing_lang,
        p.display_name AS seller, c.rarity, c.set_name, c.image AS card_image,
        (CASE WHEN l.variant = 'reverse_holo' THEN COALESCE(c.reverse_trend, c.reverse_avg, c.trend, c.avg) ELSE COALESCE(c.trend, c.avg) END)::float AS market,
        ${userId ? sql`EXISTS (SELECT 1 FROM swipe_likes s WHERE s.user_id = ${userId} AND s.listing_id = l.id)` : sql`false`} AS liked
      FROM listings l JOIN profiles p ON p.user_id = l.user_id LEFT JOIN cards c ON c.id = l.card_id
      WHERE l.status = 'active' AND NOT p.banned
        ${userId ? sql` AND l.user_id <> ${userId}` : sql``}
        ${opts.min !== null && opts.min > 0 ? sql` AND l.price >= ${opts.min}` : sql``}
        ${opts.max !== null ? sql` AND l.price <= ${opts.max}` : sql``}
        ${opts.deals ? sql` AND c.trend >= ${DEAL_MIN_PRICE} AND l.price > 0 AND l.price <= c.trend * ${(100 - DEAL_MIN_PCT) / 100}` : sql``}
        ${opts.wishlist ? sql` AND l.card_id IN (SELECT card_id FROM wishlist_items WHERE user_id = ${userId})` : sql``}
        ${opts.rarity && opts.rarity !== "hits" && !opts.anyRarity ? rarityWhere(opts, sql`c.rarity`, sql`COALESCE(c.trend, c.avg)`) : sql``}
        ${exL.length ? sql` AND l.id NOT IN (${sql.join(exL.map((n) => sql`${n}`), sql`, `)})` : sql``}
      ORDER BY (l.boosted_until > now()) DESC NULLS LAST, random()
      LIMIT ${opts.limit - cards.length > 0 ? Math.max(3, opts.limit - cards.length) : Math.ceil(opts.limit / 4)}
    `));
  }

  const items = [
    ...cards.map((r: any) => ({
      kind: "card" as const,
      key: String(r.print_id),
      lang: r.lang as CatalogLang,
      printId: String(r.print_id),
      cardId: r.card_id ? String(r.card_id) : null,
      name: String(r.name),
      // Japanische Drucke: deutscher Pokémon-Name (über die Pokédex-Nr.) zum Wiedererkennen
      altName: r.alt_name ? String(r.alt_name) : "",
      setId: String(r.set_id || ""),
      setName: String(r.set_name || ""),
      setCode: String(r.set_code || ""),
      number: String(r.number || r.local_id || ""),
      image: String(r.image || ""),
      rarity: r.rarity ? String(r.rarity) : "",
      rarityBucket: rarityBucket(r.rarity),
      price: r.price ?? null,
      low: r.low ?? null,
      avg30: r.avg30 ?? null,
      usd: r.usd ?? null,
      source: r.source || "cardmarket",
      dealPct: dealPct(r.price, r.low),
      wish: wishIds.includes(String(r.card_id || "")),
    })),
    ...listingRows.map((l: any) => ({
      kind: "listing" as const,
      key: `l${l.id}`,
      lang: (["de", "en", "ja"].includes(String(l.listing_lang)) ? String(l.listing_lang) : "de") as CatalogLang,
      listingId: Number(l.id),
      variant: String(l.variant || "normal"),
      condition: String(l.condition || ""),
      liked: Boolean(l.liked),
      printId: l.card_id ? String(l.card_id) : null,
      cardId: l.card_id ? String(l.card_id) : null,
      name: String(l.card_name),
      setName: String(l.set_name || ""),
      number: "",
      image: String(l.image || l.card_image || ""),
      rarity: l.rarity ? String(l.rarity) : "",
      rarityBucket: rarityBucket(l.rarity),
      price: l.market ?? null,
      low: l.price,
      offer: l.price,
      seller: String(l.seller || ""),
      city: String(l.city || ""),
      want: String(l.want || ""),
      boosted: !!l.boosted,
      source: "listing",
      dealPct: dealPct(l.market, l.price),
      wish: wishIds.includes(String(l.card_id || "")),
    })),
  ];
  // Inserate gleichmäßig in den Stapel mischen (nicht alle am Ende)
  const out: any[] = [];
  const cardItems = items.filter((x) => x.kind === "card"), listItems = items.filter((x) => x.kind === "listing");
  const step = listItems.length ? Math.max(2, Math.floor(cardItems.length / listItems.length)) : 0;
  let li = 0;
  cardItems.forEach((c, idx) => {
    out.push(c);
    if (step && (idx + 1) % step === 0 && li < listItems.length) out.push(listItems[li++]);
  });
  while (li < listItems.length) out.push(listItems[li++]);
  return { items: out, wishlistEmpty: false };
}

async function setOptions(lang: CatalogLang) {
  if (lang === "de") {
    return rows(await db.execute(sql`
      SELECT s.id, s.name, COALESCE(NULLIF(s.abbreviation, ''), s.id) AS code, s.release_date,
        (SELECT count(*)::int FROM cards c WHERE c.set_id = s.id AND COALESCE(c.trend, c.avg, c.low) IS NOT NULL AND c.image <> '') AS priced
      FROM card_sets s WHERE s.active AND s.cards_imported_at IS NOT NULL
      ORDER BY s.release_date DESC NULLS LAST, s.name LIMIT 400`));
  }
  return rows(await db.execute(sql`
    SELECT s.id, s.name, s.code, s.release_date,
      (SELECT count(*)::int FROM card_prints p WHERE p.lang = s.lang AND p.set_id = s.id AND p.price_eur IS NOT NULL AND p.image <> '') AS priced
    FROM print_sets s WHERE s.lang = ${lang} AND s.active AND s.cards_imported_at IS NOT NULL
    ORDER BY s.release_date DESC NULLS LAST, s.name LIMIT 400`));
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerIntlCatalog(app: any, { auth, adminOnly }: { auth: any; adminOnly: any }) {
  // Übersicht der Sprachen + Seltenheits-Gruppen (für Filter in der App)
  app.get("/api/catalog/meta", async (c: any) => {
    const counts = rows(await db.execute(sql`
      SELECT 'de' AS lang, count(*)::int AS priced FROM cards WHERE image <> '' AND COALESCE(trend, avg, low) IS NOT NULL
      UNION ALL SELECT lang, count(*)::int FROM card_prints WHERE image <> '' AND price_eur IS NOT NULL GROUP BY lang`));
    const fx = await getFx();
    publicCache(c, "data", { sMaxAge: 600, swr: 3600 });
    return c.json({
      langs: (["de", "en", "ja"] as CatalogLang[]).map((l) => ({
        lang: l, label: LANG_LABEL[l], flag: LANG_FLAG[l], priced: Number(counts.find((r: any) => r.lang === l)?.priced ?? 0),
      })),
      rarities: RARITY_BUCKETS.map((k) => ({ key: k, label: RARITY_LABEL[k] })),
      dealMinPct: DEAL_MIN_PCT,
      fx,
    });
  });

  // Sets je Sprache mit Anzahl bepreister Karten (für den Set-Filter der Arena; /api/catalog/sets ist der deutsche Katalog)
  app.get("/api/swipe/sets", async (c: any) => {
    const lang = normLang(c.req.query("lang")) || "de";
    if (!(await rateLimit(`csets:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const list = await setOptions(lang);
    publicCache(c, "data", { sMaxAge: 900, swr: 3600, varyQuery: ["lang"] });
    return c.json({
      lang,
      sets: list.map((s: any) => ({ id: String(s.id), name: String(s.name), code: String(s.code || ""), releaseDate: s.release_date ? String(s.release_date).slice(0, 10) : null, priced: Number(s.priced || 0) })),
    });
  });

  // Dynamischer Swipe-Stapel (öffentlich; mit Login zusätzlich Wunschlisten-Treffer)
  app.get("/api/swipe/deck", async (c: any) => {
    if (!(await rateLimit(`deck:${clientIp(c)}`, 40, 60_000))) return c.json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
    const opts = parseDeckQuery(c.req.query());
    const user = await verifyIdentityToken(c).catch(() => null);
    if (opts.wishlist && !user) return c.json({ error: "Für den Wunschlisten-Filter bitte anmelden.", login: true }, 401);
    // Preference-Learning: gelernte Vorlieben (Konto oder Gerät) gewichten die Zufallsauswahl
    const prefs = await deckPrefs(user?.id ?? null, c.req.query("pw"));
    const deck = await buildDeck(opts, user?.id ?? null, prefs);
    c.header("Cache-Control", "private, no-store");
    return c.json({ ...deck, personalized: Boolean(prefs && prefs.swipes >= 5), filters: { ...opts, exclude: undefined } });
  });

  // Detail eines englischen/japanischen Drucks mit beiden Preis-Feeds, Verlauf und Partner-Drucken
  app.get("/api/prints/:id", async (c: any) => {
    const id = str(c.req.param("id"), 50);
    if (!PRINT_ID_RE.test(id)) return c.json({ error: "Ungültige Karten-ID" }, 400);
    if (!(await rateLimit(`print:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const print = await getPrint(id);
    if (!print) return c.json({ error: "Karte nicht gefunden" }, 404);
    const fx = await getFx();
    const history = await db.select({ day: cardPrintPrices.day, priceEur: cardPrintPrices.priceEur, cmTrend: cardPrintPrices.cmTrend, tcgMarketUsd: cardPrintPrices.tcgMarketUsd })
      .from(cardPrintPrices).where(eq(cardPrintPrices.printId, id)).orderBy(desc(cardPrintPrices.day)).limit(90);
    // Andere Sprachen derselben Karte: en ↔ de über das gemeinsame Cardmarket-Produkt, ja über die Pokédex-Nr.
    const related = rows(await db.execute(sql`
      SELECT * FROM (
        SELECT 'de'::text AS lang, c.id AS id, c.name, c.set_name, c.image, COALESCE(c.trend, c.avg, c.low)::float AS price
        FROM cards c WHERE c.id = ${print.baseCardId ?? ""}
        UNION ALL
        SELECT p.lang, p.id, p.name, p.set_name, p.image, p.price_eur::float FROM card_prints p
        WHERE p.id <> ${id} AND p.image <> '' AND p.price_eur IS NOT NULL AND ${print.dexId ?? -1}::int > 0 AND p.dex_id = ${print.dexId ?? -1}
          AND p.lang <> ${print.lang}
      ) r ORDER BY r.price DESC NULLS LAST LIMIT 6`));
    const usdEur = toEur(Number(print.tcgMarketUsd) || null, fx.USD);
    const [species] = print.lang === "ja" && print.dexId
      ? rows(await db.execute(sql`SELECT name_de, slug FROM pokemon_species WHERE dex_id = ${print.dexId} LIMIT 1`)) : [];
    publicCache(c, "data");
    return c.json({
      print: {
        ...print, langLabel: LANG_LABEL[print.lang as CatalogLang], flag: LANG_FLAG[print.lang as CatalogLang], tcgMarketEur: usdEur,
        rarityBucket: rarityBucket(print.rarity), altName: species?.name_de ? String(species.name_de) : "", speciesSlug: species?.slug ? String(species.slug) : "",
      },
      history: history.reverse(),
      related,
      fx,
    });
  });

  app.get("/api/admin/catalog-intl", auth, adminOnly, async (c: any) => c.json(await intlCatalogStatus()));
  app.post("/api/admin/catalog-intl/run", auth, adminOnly, async (c: any) => {
    const result = await runIntlCatalogImport({ deadlineMs: 20_000, maxSetsPerLang: 2, maxPrices: 40 });
    return c.json({ ...result, status: await intlCatalogStatus() });
  });
}

/** Für die Sammlung: Druck prüfen und Name/Bild/Preis/Partnerkarte liefern. */
export async function printForPortfolio(id: string) {
  if (!PRINT_ID_RE.test(id)) return null;
  const p = await getPrint(id, 24 * 3600_000);
  if (!p) return null;
  return {
    id: p.id, lang: p.lang, baseCardId: p.baseCardId,
    name: `${p.name}${p.number ? ` (${p.number})` : ""} [${p.lang.toUpperCase()}]`.slice(0, 120),
    image: p.image, priceEur: p.priceEur,
  };
}
