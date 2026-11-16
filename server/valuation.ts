// Phase 9: Eigene Preis-Pipeline (Datenbank-Teil). Logik in valuation-logic.ts.
//
// • valuateCard()      berechnet alle Stufen (NM … Damaged, PSA 8/9/10) NUR aus der eigenen Datenbank
//                      (gespeicherte Cardmarket-Referenz, eBay- und PokeSwipe-Verkäufe, Graded-Werte) und speichert
//                      sie in market_valuations + Tagesverlauf market_valuation_history.
// • getValuation()     liefert gespeicherte Werte sofort; ältere Werte werden aus der DB neu berechnet (schnell, ohne
//                      externe Abfrage). Ist die Karte selbst veraltet, aktualisiert ein Hintergrund-Abruf sie
//                      (Stale-While-Revalidate) – ein TCGdex-Ausfall erzeugt nie eine Fehlermeldung.
// • refreshValuations() Teil des stündlichen Preis-Trackers.
// • GET /api/cards/:id/valuation, GET /api/prices/health
import { sql } from "drizzle-orm";
import { db, cards } from "../db/index.ts";
import { rows, str, rateLimit, clientIp } from "./util.ts";
import { publicCache } from "./cache.ts";
import { log } from "./log.ts";
import { CARD_ID_RE, getCard } from "./prices.ts";
import { circuitState } from "./resilience.ts";
import { circuitPhase } from "./resilience-logic.ts";
import { variantPrice, availableVariants, normalizeVariant, VARIANTS, VARIANT_LABELS, type Variant } from "./variant-logic.ts";
import {
  computeValuation, trendFor, freshnessLabel, isStale, TIER_LABELS, TIER_SHORT, GRADED_TIERS, type TierValuation, type GradedTier,
} from "./valuation-logic.ts";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const today = () => new Date().toISOString().slice(0, 10);
/** Gespeicherte Bewertungen gelten so lange ohne Neuberechnung */
const RECOMPUTE_AFTER_MS = 3 * 3600_000;

type CardRow = typeof cards.$inferSelect;

/** Varianten, für die eine eigene Bewertung sinnvoll ist (Normal + Reverse Holo, falls vorhanden). */
function valuationVariants(card: CardRow): Variant[] {
  const av = availableVariants(card.variants);
  const list: Variant[] = ["normal"];
  if (av.includes("reverse_holo") && (card.reverseTrend || card.reverseAvg || card.reverseLow)) list.push("reverse_holo");
  return list;
}

async function loadInputs(card: CardRow, variant: Variant) {
  const ref = variantPrice(card as any, variant);
  const comps = rows(await db.execute(sql`
    SELECT source, grade_key, price::float AS price, sold_at, condition, variant FROM sold_comps
    WHERE target_kind = 'card' AND target_id = ${card.id} AND sold_at > now() - interval '90 days'
    ORDER BY sold_at DESC LIMIT 1500`));
  const ebayRaw: { price: number; soldAt: string }[] = [];
  const ebayGraded: Partial<Record<GradedTier, { price: number; soldAt: string }[]>> = {};
  const pokeswipe: { price: number; soldAt: string; condition: unknown }[] = [];
  for (const c of comps) {
    const point = { price: Number(c.price), soldAt: c.sold_at };
    if (c.source === "pokeswipe") {
      if (normalizeVariant(c.variant) === variant && String(c.grade_key || "raw") === "raw") pokeswipe.push({ ...point, condition: c.condition });
      continue;
    }
    if (!String(c.source).startsWith("ebay")) continue;
    // eBay-Comps haben keine verlässliche Variante – nur der Basis-Variante zuordnen
    if (variant !== "normal") continue;
    const g = String(c.grade_key || "raw");
    if (g === "raw") ebayRaw.push(point);
    else if ((GRADED_TIERS as readonly string[]).includes(g)) (ebayGraded[g as GradedTier] ??= []).push(point);
  }
  const gradeValues: Record<string, any> = {};
  if (variant === "normal") {
    for (const g of rows(await db.execute(sql`
      SELECT grade_key, median_90::float AS median90, sample_90 AS sample90, ask_low::float AS ask_low, updated_at FROM grade_values
      WHERE target_kind = 'card' AND target_id = ${card.id} AND grade_key IN ('psa8', 'psa9', 'psa10')`))) {
      gradeValues[g.grade_key] = { median90: num(g.median90), sample90: Number(g.sample90) || 0, askLow: num(g.ask_low), updatedAt: g.updated_at };
    }
  }
  return {
    reference: ref.price || null, referenceAt: card.priceUpdatedAt ?? card.checkedAt ?? null,
    ebayRaw, ebayGraded, pokeswipe, gradeValues,
    avg7: variant === "reverse_holo" ? num(card.reverseAvg7) : num(card.avg7),
    avg30: variant === "reverse_holo" ? num(card.reverseAvg30) : num(card.avg30),
  };
}

export type StoredTier = TierValuation & { label: string; short: string; trend7: number | null; trend30: number | null };

/** Berechnet und speichert alle Stufen einer Karte (alle sinnvollen Varianten). Keine externe Abfrage. */
export async function valuateCard(cardOrId: string | CardRow): Promise<Record<string, StoredTier[]> | null> {
  const card = typeof cardOrId === "string"
    ? (await db.select().from(cards).where(sql`${cards.id} = ${cardOrId}`).limit(1))[0]
    : cardOrId;
  if (!card) return null;
  const out: Record<string, StoredTier[]> = {};
  const now = Date.now();
  const history = rows(await db.execute(sql`
    SELECT variant, tier, day::text AS day, value::float AS value FROM market_valuation_history
    WHERE card_id = ${card.id} AND day > CURRENT_DATE - 40`));
  for (const variant of valuationVariants(card)) {
    const input = await loadInputs(card, variant);
    const tiers = computeValuation(input, now);
    const stored: StoredTier[] = [];
    for (const t of tiers) {
      const own = history.filter((h: any) => h.variant === variant && h.tier === t.tier).map((h: any) => ({ day: String(h.day), value: Number(h.value) }));
      const factor = t.tier === "nm" ? 1 : null;
      const { trend7, trend30 } = trendFor(t.value, own, factor ? { avg7: input.avg7, avg30: input.avg30 } : {}, now);
      stored.push({ ...t, label: TIER_LABELS[t.tier], short: TIER_SHORT[t.tier], trend7, trend30 });
      const fix = (v: number | null) => (v === null ? null : v.toFixed(2));
      await db.execute(sql`
        INSERT INTO market_valuations (card_id, variant, tier, value, low, high, confidence, sample_size, sources, trend_7, trend_30, data_at, computed_at)
        VALUES (${card.id}, ${variant}, ${t.tier}, ${fix(t.value)}, ${fix(t.low)}, ${fix(t.high)}, ${t.confidence}, ${t.sampleSize},
          ${JSON.stringify(t.sources)}::jsonb, ${trend7}, ${trend30}, ${t.dataAt}, now())
        ON CONFLICT (card_id, variant, tier) DO UPDATE SET value = EXCLUDED.value, low = EXCLUDED.low, high = EXCLUDED.high,
          confidence = EXCLUDED.confidence, sample_size = EXCLUDED.sample_size, sources = EXCLUDED.sources, trend_7 = EXCLUDED.trend_7,
          trend_30 = EXCLUDED.trend_30, data_at = EXCLUDED.data_at, computed_at = now()`);
      if (t.value !== null) {
        await db.execute(sql`
          INSERT INTO market_valuation_history (card_id, variant, tier, day, value, confidence)
          VALUES (${card.id}, ${variant}, ${t.tier}, ${today()}, ${t.value.toFixed(2)}, ${t.confidence})
          ON CONFLICT (card_id, variant, tier, day) DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence`);
      }
    }
    out[variant] = stored;
  }
  return out;
}

function fromRow(r: any): StoredTier {
  const tier = String(r.tier) as StoredTier["tier"];
  return {
    tier, label: TIER_LABELS[tier] || tier, short: TIER_SHORT[tier] || tier,
    value: num(r.value), low: num(r.low), high: num(r.high), confidence: Number(r.confidence) || 0, sampleSize: Number(r.sample_size) || 0,
    sources: typeof r.sources === "string" ? JSON.parse(r.sources) : r.sources || {},
    basis: r.value === null ? "none" : Number(r.sample_size) > 0 ? "blend" : "reference",
    trend7: r.trend_7 === null ? null : Number(r.trend_7), trend30: r.trend_30 === null ? null : Number(r.trend_30),
    dataAt: r.data_at ? new Date(r.data_at).toISOString() : null,
  };
}

const ORDER = ["nm", "lp", "mp", "hp", "dmg", "psa8", "psa9", "psa10"];

/** Ist die Preisquelle TCGdex gerade gesperrt (Circuit offen)? */
export async function pricesDegraded() {
  try { return circuitPhase(await circuitState("tcgdex")) !== "closed"; } catch { return false; }
}

/**
 * Bewertung einer Karte – antwortet immer aus der eigenen Datenbank.
 * Fehlt sie oder ist sie älter als 3 Std., wird sie aus der DB neu berechnet (ohne externe Abfrage).
 */
export async function getValuation(cardId: string, variantInput?: unknown) {
  // getCard nutzt Stale-While-Revalidate: veraltete Karten kommen sofort aus der DB, aktualisiert wird im Hintergrund
  const card = await getCard(cardId);
  if (!card) return null;
  const variants = valuationVariants(card as CardRow);
  const variant = variantInput && variants.includes(normalizeVariant(variantInput)) ? normalizeVariant(variantInput) : "normal";
  let list = rows(await db.execute(sql`
    SELECT tier, value, low, high, confidence, sample_size, sources, trend_7, trend_30, data_at, computed_at
    FROM market_valuations WHERE card_id = ${cardId} AND variant = ${variant}`));
  const newest = list.reduce((m: number, r: any) => Math.max(m, new Date(r.computed_at).getTime()), 0);
  const cardChecked = card.checkedAt ? new Date(card.checkedAt).getTime() : 0;
  let tiers: StoredTier[];
  if (!list.length || Date.now() - newest > RECOMPUTE_AFTER_MS || cardChecked > newest) {
    try {
      const fresh = await valuateCard(card as CardRow);
      tiers = fresh?.[variant] ?? list.map(fromRow);
    } catch (e) {
      log.error("valuation", "Neuberechnung fehlgeschlagen – nutze gespeicherte Werte", { cardId, err: e });
      tiers = list.map(fromRow);
    }
  } else tiers = list.map(fromRow);
  tiers.sort((a, b) => ORDER.indexOf(a.tier) - ORDER.indexOf(b.tier));
  const updatedAt = card.priceUpdatedAt ?? card.checkedAt ?? null;
  const degraded = await pricesDegraded();
  return {
    cardId, variant, variantLabel: VARIANT_LABELS[variant], variants,
    tiers, raw: tiers.filter((t) => !t.tier.startsWith("psa")), graded: tiers.filter((t) => t.tier.startsWith("psa")),
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    freshness: freshnessLabel(updatedAt),
    stale: isStale(updatedAt),
    /** true = TCGdex gerade nicht erreichbar, Werte kommen aus der eigenen Datenbank */
    degraded,
    source: "pokeswipe-db",
  };
}

/** Stündlich (Preis-Tracker): frisch aktualisierte Karten, neue Verkäufe und veraltete Bewertungen neu berechnen. */
export async function refreshValuations({ ids = [] as string[], max = 250, deadline = Infinity } = {}) {
  const due = rows(await db.execute(sql`
    SELECT DISTINCT id FROM (
      SELECT c.id FROM cards c WHERE c.checked_at > now() - interval '2 hours'
      UNION SELECT target_id AS id FROM sold_comps WHERE target_kind = 'card' AND created_at > now() - interval '2 hours'
      UNION SELECT card_id AS id FROM market_valuations GROUP BY card_id HAVING max(computed_at) < now() - interval '24 hours'
    ) x LIMIT ${max}`)).map((r: any) => String(r.id));
  const list = [...new Set([...ids, ...due])].filter((id) => CARD_ID_RE.test(id)).slice(0, max);
  let done = 0, errors = 0;
  for (const id of list) {
    if (Date.now() > deadline - 2000) break;
    try { if (await valuateCard(id)) done++; } catch (e) { errors++; log.error("valuation", "Bewertung fehlgeschlagen", { id, err: e }); }
  }
  return { valuations: done, valuationErrors: errors, valuationsOpen: Math.max(0, list.length - done - errors) };
}

export function registerValuation(app: any) {
  // Öffentlich: Marktwerte je Zustand und Grading (Kartenansicht, Portfolio, Scanner)
  app.get("/api/cards/:id/valuation", async (c: any) => {
    const id = str(c.req.param("id"), 60);
    if (!CARD_ID_RE.test(id)) return c.json({ error: "Ungültige Karte." }, 400);
    if (!(await rateLimit(`val:${clientIp(c)}`, 120, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const v = c.req.query("variant");
    if (v && !(VARIANTS as readonly string[]).includes(String(v))) return c.json({ error: "Unbekannte Variante." }, 400);
    const data = await getValuation(id, v || undefined);
    if (!data) return c.json({ error: "Karte nicht gefunden." }, 404);
    publicCache(c, "data", { varyQuery: ["variant"], sMaxAge: 300, swr: 3600 });
    return c.json(data);
  });

  // Status der Preisquellen (für den Hinweis „Preise aus eigener Datenbank“ in der App)
  app.get("/api/prices/health", async (c: any) => {
    const [r] = rows(await db.execute(sql`
      SELECT max(checked_at) AS last_card, (SELECT max(computed_at) FROM market_valuations) AS last_valuation,
        (SELECT count(*)::int FROM market_valuations WHERE value IS NOT NULL) AS valuations FROM cards`));
    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      degraded: await pricesDegraded(),
      lastCardUpdate: r?.last_card ? new Date(r.last_card).toISOString() : null,
      lastValuation: r?.last_valuation ? new Date(r.last_valuation).toISOString() : null,
      valuations: Number(r?.valuations ?? 0),
    });
  });
}
