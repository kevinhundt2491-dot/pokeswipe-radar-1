// PokeSwipe & Radar – Phase 2: Live Flip-Radar, Verkaufspreise (Sold Comps), PSA-Werte und automatische Sealed-Preise.
//
// flip-radar-sync (alle 10 Minuten):   Ziele reihum (Wunschliste/Sammlung zuerst, dann wertvolle Karten) → eBay Browse API →
//   Titel prüfen (Zuordnung, Grading, Sprache, Fälschungen) → Referenzpreis (Cardmarket/TCGplayer bzw. Verkaufs-Median) →
//   Deal ≥ 20 % unter Marktwert → Einzelangebot mit ePN-Partner-Link speichern → beendete Auktionen als Verkäufe übernehmen →
//   Median je Note (Raw, PSA 8/9/10, BGS, CGC) → Wunschlisten-Push.
// update-sealed-prices (alle 3 Stunden): Displays, ETBs, Tins, Kollektionen aus eBay-Verkäufen/-Angeboten und Community-Inseraten;
//   Admin-Overrides (CSV/Formular, price_locked) bleiben unangetastet.
//
// Ohne EBAY_CLIENT_ID/EBAY_CLIENT_SECRET läuft der Radar im Demo-Modus: echte Cardmarket-Tiefstpreise statt eBay-Angeboten,
// Sealed-Preise nur aus Community-Inseraten. Die Oberfläche kennzeichnet das deutlich.
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, profiles, sealedProducts, sealedPriceHistory, marketOffers, soldComps, gradeValues, flipTargets, flipSyncRuns,
} from "../db/index.ts";
import { verifyIdentityToken, isAdmin } from "./auth.ts";
import { effectivePlan } from "./plans.ts";
import { notify, evaluateSealedAlerts, CARD_ID_RE } from "./prices.ts";
import { str, rows, rateLimit, clientIp, int } from "./util.ts";
import { browseSearch, insightsSearch, ebayConfigured, insightsAvailable, EBAY_CATEGORY_SINGLES, type EbayOffer } from "./ebay.ts";
import {
  GRADE_KEYS, GRADE_LABEL, FLIP_DEAL_MIN_PCT, SNIPER_MIN_PCT, FLIP_MIN_REF_EUR, GRADING_PRESETS, SEALED_SOURCE_LABEL,
  parseGrade, rawCondition, titleLang, isJunkTitle, titleMatchesCard, titleMatchesSealed, evaluateDeal, chooseRef,
  trimOutliers, median, round2, dailyMedians, sealedAutoPrice, affiliateItemUrl, ebaySearchUrl, buildQuery,
  nameTokens, targetKey, parseTargetKey, discountPct, type GradeKey, type TargetKind, type MatchTarget,
} from "./flip-logic.ts";

const PRINT_ID_RE = /^(en|ja):[A-Za-z0-9.\-_]{2,40}$/;
const money2 = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n.toFixed(2) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Ziele
// ---------------------------------------------------------------------------
type Target = {
  kind: TargetKind; id: string; name: string; nameEn: string; localId: string; total: number | null;
  lang: string; market: number | null; marketSource: string; image: string; number: string; interest: number;
};

const shapeTarget = (r: any): Target => ({
  kind: r.kind, id: String(r.target_id), name: String(r.name || ""), nameEn: String(r.name_en || ""),
  localId: String(r.local_id || ""), total: Number(r.total) > 0 ? Number(r.total) : null, lang: String(r.lang || "de"),
  market: Number(r.market) > 0 ? Number(r.market) : null, marketSource: String(r.market_source || "cardmarket"),
  image: String(r.image || ""), number: String(r.number || ""), interest: Number(r.interest) || 0,
});

/** SQL aller möglichen Karten-Ziele (deutsche Karten + englische/japanische Drucke) mit Marktpreis und Interesse. */
const candidateSql = (minDe: number, minPrint: number) => sql`
  SELECT 'card'::text AS kind, c.id AS target_id, c.name, COALESCE(sp.name_en, '') AS name_en, c.local_id,
    NULLIF(s.card_count_official, 0) AS total, 'de'::text AS lang, COALESCE(c.trend, c.avg)::float AS market, 'cardmarket'::text AS market_source,
    c.image, CASE WHEN c.local_id ~ '^[0-9]+$' AND s.card_count_official > 0 THEN c.local_id || '/' || s.card_count_official ELSE COALESCE(c.local_id, '') END AS number,
    COALESCE(w.n, 0) + COALESCE(pf.n, 0) AS interest
  FROM cards c
  LEFT JOIN card_sets s ON s.id = c.set_id
  LEFT JOIN pokemon_species sp ON sp.dex_id = c.dex_id
  LEFT JOIN (SELECT card_id, count(*)::int AS n FROM wishlist_items GROUP BY card_id) w ON w.card_id = c.id
  LEFT JOIN (SELECT card_id, count(*)::int AS n FROM portfolio_items WHERE card_id IS NOT NULL GROUP BY card_id) pf ON pf.card_id = c.id
  WHERE c.local_id IS NOT NULL AND (COALESCE(c.trend, c.avg) >= ${minDe} OR (COALESCE(w.n, 0) > 0 AND COALESCE(c.trend, c.avg) >= ${FLIP_MIN_REF_EUR}))
  UNION ALL
  SELECT 'print'::text, p.id, p.name, COALESCE(sp.name_en, ''), p.local_id,
    NULLIF(substring(p.number from '/0*([0-9]+)$'), '')::int, p.lang, p.price_eur::float, COALESCE(p.price_source, 'cardmarket'),
    p.image, p.number, COALESCE(pf.n, 0)
  FROM card_prints p
  LEFT JOIN pokemon_species sp ON sp.dex_id = p.dex_id
  LEFT JOIN (SELECT print_id, count(*)::int AS n FROM portfolio_items WHERE print_id IS NOT NULL GROUP BY print_id) pf ON pf.print_id = p.id
  WHERE p.local_id <> '' AND (p.price_eur >= ${minPrint} OR (COALESCE(pf.n, 0) > 0 AND p.price_eur >= ${FLIP_MIN_REF_EUR}))
    AND (p.lang <> 'ja' OR sp.name_en IS NOT NULL)`;

/** Fällige Ziele: Wunschliste/Sammlung alle 3 h, Karten ab 50 € alle 8 h, übrige alle 36 h. */
async function dueTargets(limit: number): Promise<Target[]> {
  return rows(await db.execute(sql`
    SELECT x.* FROM (${candidateSql(12, 15)}) x
    LEFT JOIN flip_targets ft ON ft.id = x.kind || ':' || x.target_id
    WHERE COALESCE(ft.last_synced_at, 'epoch'::timestamptz) + CASE
      WHEN x.interest > 0 THEN interval '3 hours' WHEN x.market >= 50 THEN interval '8 hours' ELSE interval '36 hours' END < now()
    ORDER BY (x.interest > 0) DESC, ft.last_synced_at ASC NULLS FIRST, x.market DESC NULLS LAST
    LIMIT ${limit}`)).map(shapeTarget);
}

async function loadTarget(kind: TargetKind, id: string): Promise<Target | null> {
  if (kind === "card" || kind === "print") {
    const [r] = rows(await db.execute(sql`SELECT x.* FROM (${candidateSql(0, 0)}) x WHERE x.kind = ${kind} AND x.target_id = ${id} LIMIT 1`));
    return r ? shapeTarget(r) : null;
  }
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const [p] = await db.select().from(sealedProducts).where(eq(sealedProducts.id, pid)).limit(1);
  if (!p) return null;
  return { kind, id: String(p.id), name: p.name, nameEn: "", localId: "", total: null, lang: "de", market: Number(p.refPrice) || null, marketSource: "sealed", image: p.image, number: "", interest: 0 };
}

const matchTargetOf = (t: Target): MatchTarget => ({
  names: [t.name, t.nameEn].filter(Boolean),
  localId: t.localId, total: t.total,
  ...(t.kind === "print" && t.lang === "ja" ? { requireLang: "ja" as const } : { rejectLang: ["ja" as const] }),
});

/** eBay-Suche: deutscher ODER englischer Name + Nummer („(Glurak, Charizard) 199/165“). */
function searchQueryOf(t: Target): string {
  if (t.kind === "sealed") return buildQuery({ kind: "sealed", name: t.name });
  const de = nameTokens(t.kind === "print" && t.lang === "ja" ? "" : t.name)[0];
  const en = nameTokens(t.nameEn)[0];
  const names = [...new Set([de, en].filter(Boolean))];
  const number = t.total && /^\d+$/.test(t.localId) ? `${Number(t.localId)}/${t.total}` : t.localId;
  const namePart = names.length > 1 ? `(${names.join(", ")})` : names[0] || t.name;
  return `${namePart} ${number}${t.lang === "ja" ? " japanese" : ""}`.trim().slice(0, 90);
}

// ---------------------------------------------------------------------------
// Verkaufsdaten & Werte je Note
// ---------------------------------------------------------------------------
async function soldStats(kind: TargetKind, id: string) {
  const list = rows(await db.execute(sql`
    SELECT grade_key, price::float AS price, sold_at FROM sold_comps
    WHERE target_kind = ${kind} AND target_id = ${id} AND sold_at > now() - interval '90 days'`));
  const out: Record<string, { median: number | null; sample: number }> = {};
  for (const g of GRADE_KEYS) {
    const v = list.filter((r: any) => r.grade_key === g).map((r: any) => Number(r.price));
    const trimmed = trimOutliers(v);
    out[g] = { median: median(trimmed), sample: trimmed.length };
  }
  return out;
}

/** Median 30/90 Tage, Spanne und günstigstes aktives Angebot je Note neu berechnen. */
async function rebuildGradeValues(kind: TargetKind, id: string) {
  const comps = rows(await db.execute(sql`
    SELECT grade_key, price::float AS price, sold_at FROM sold_comps
    WHERE target_kind = ${kind} AND target_id = ${id} AND sold_at > now() - interval '90 days'`));
  const asks = rows(await db.execute(sql`
    SELECT grade_key, min(total)::float AS low, count(*)::int AS n FROM market_offers
    WHERE target_kind = ${kind} AND target_id = ${id} AND status = 'active' AND buying_option = 'FIXED_PRICE' AND raw_condition <> 'dmg'
    GROUP BY grade_key`));
  const since30 = Date.now() - 30 * 86400_000;
  for (const g of GRADE_KEYS) {
    const all = trimOutliers(comps.filter((r: any) => r.grade_key === g).map((r: any) => Number(r.price)));
    const last30 = trimOutliers(comps.filter((r: any) => r.grade_key === g && new Date(r.sold_at).getTime() >= since30).map((r: any) => Number(r.price)));
    const ask = asks.find((a: any) => a.grade_key === g);
    if (!all.length && !ask) {
      await db.delete(gradeValues).where(and(eq(gradeValues.targetKind, kind), eq(gradeValues.targetId, id), eq(gradeValues.gradeKey, g)));
      continue;
    }
    const values = {
      median90: money2(median(all)), median30: money2(median(last30)), sample90: all.length, sample30: last30.length,
      low90: money2(all.length ? Math.min(...all) : null), high90: money2(all.length ? Math.max(...all) : null),
      askLow: money2(ask ? Number(ask.low) : null), askCount: ask ? Number(ask.n) : 0, updatedAt: new Date(),
    };
    await db.insert(gradeValues).values({ targetKind: kind, targetId: id, gradeKey: g, ...values })
      .onConflictDoUpdate({ target: [gradeValues.targetKind, gradeValues.targetId, gradeValues.gradeKey], set: values });
  }
}

/** Beendete Auktionen mit Geboten werden zu Verkäufen (letzter gesehener Gebotsstand + Versand). */
async function harvestEndedAuctions(kind?: TargetKind, id?: string) {
  const scope = kind && id ? sql` AND target_kind = ${kind} AND target_id = ${id}` : sql``;
  const ended = rows(await db.execute(sql`
    UPDATE market_offers SET status = 'ended', gone_at = now()
    WHERE status = 'active' AND buying_option = 'AUCTION' AND end_at IS NOT NULL AND end_at < now() ${scope}
    RETURNING id, target_kind, target_id, grade_key, grade, lang, title, total::float AS total, bid_count, end_at, last_seen_at, item_url, raw_condition`));
  let comps = 0;
  for (const o of ended) {
    // Nur aussagekräftig, wenn geboten wurde und der Stand kurz vor Ende gesehen wurde
    if (!(Number(o.bid_count) > 0) || o.raw_condition === "dmg" || isJunkTitle(o.title)) continue;
    if (new Date(o.end_at).getTime() - new Date(o.last_seen_at).getTime() > 18 * 3600_000) continue;
    const r = await db.insert(soldComps).values({
      externalId: `auction:${o.id}`, source: "ebay-auction", targetKind: o.target_kind, targetId: o.target_id,
      gradeKey: o.grade_key, grade: o.grade, lang: o.lang, title: String(o.title).slice(0, 200), price: Number(o.total).toFixed(2),
      soldAt: new Date(o.end_at), url: String(o.item_url || "").slice(0, 600),
    }).onConflictDoNothing().returning({ id: soldComps.id });
    comps += r.length;
  }
  return comps;
}

// ---------------------------------------------------------------------------
// Sync eines Ziels
// ---------------------------------------------------------------------------
type OfferRow = typeof marketOffers.$inferInsert;

function analyseOffer(o: EbayOffer, t: Target) {
  const junk = isJunkTitle(o.title);
  const grade = parseGrade(o.title);
  const cond = grade.key === "raw" ? rawCondition(o.title) : "";
  const lang = titleLang(o.title);
  const matches = t.kind === "sealed" ? titleMatchesSealed(o.title, t.name, (t as any).sealedKind || "") : !junk && titleMatchesCard(o.title, matchTargetOf(t));
  return { junk, grade, cond, lang, matches };
}

async function storeOffers(t: Target, offers: EbayOffer[], runStart: Date, sold: Record<string, { median: number | null; sample: number }>) {
  let stored = 0, deals = 0;
  const newDealIds: string[] = [];
  for (const o of offers) {
    const a = analyseOffer(o, t);
    if (!a.matches) continue;
    const total = round2(o.price + (o.shipping ?? 0));
    const { ref, source } = t.kind === "sealed"
      ? { ref: t.market, source: t.market ? "sealed" : null }
      : chooseRef(a.grade.key, a.grade.key === "raw" ? t.market : null, sold[a.grade.key] ?? null, t.marketSource);
    const deal = evaluateDeal({ total, ref, buyingOption: o.buyingOption, endAt: o.endAt, junk: a.junk, rawCondition: a.cond, sellerFeedbackPct: o.sellerFeedbackPct });
    const url = affiliateItemUrl(o.itemWebUrl, o.affiliateUrl, `pokeswipe-flip-${t.kind}`);
    if (!url) continue;
    const id = `ebay:${o.itemId}`;
    const values: OfferRow = {
      id, source: "ebay", targetKind: t.kind, targetId: t.id, gradeKey: a.grade.key, grade: a.grade.label, rawCondition: a.cond,
      lang: a.lang, title: o.title, price: o.price.toFixed(2), shipping: o.shipping != null ? o.shipping.toFixed(2) : null, total: total.toFixed(2),
      buyingOption: o.buyingOption, bidCount: o.bidCount, endAt: o.endAt, itemUrl: url.slice(0, 1200),
      image: /^https:\/\//.test(o.image) ? o.image : "", seller: o.seller,
      sellerFeedbackPct: o.sellerFeedbackPct != null && Number.isFinite(o.sellerFeedbackPct) ? o.sellerFeedbackPct.toFixed(1) : null,
      sellerFeedbackScore: o.sellerFeedbackScore != null && Number.isFinite(o.sellerFeedbackScore) ? Math.round(o.sellerFeedbackScore) : null,
      itemCondition: o.condition, country: o.country,
      refPrice: money2(ref), refSource: source, discountPct: deal.pct != null ? Math.max(-999, Math.min(100, deal.pct)).toFixed(1) : null,
      isDeal: deal.isDeal, suspicious: deal.suspicious, status: "active", lastSeenAt: new Date(),
    };
    const { id: _i, ...updates } = values;
    const [saved] = await db.insert(marketOffers).values(values)
      .onConflictDoUpdate({ target: marketOffers.id, set: { ...updates, goneAt: null } })
      .returning({ firstSeenAt: marketOffers.firstSeenAt, notifiedAt: marketOffers.notifiedAt });
    stored++;
    if (deal.isDeal) {
      deals++;
      if (saved && saved.firstSeenAt >= runStart && !saved.notifiedAt) newDealIds.push(id);
    }
  }
  // Nicht mehr gefundene Sofort-Kaufen-Angebote: verkauft oder beendet (zählt NICHT als Verkauf)
  await db.execute(sql`
    UPDATE market_offers SET status = 'gone', gone_at = now()
    WHERE target_kind = ${t.kind} AND target_id = ${t.id} AND status = 'active' AND buying_option = 'FIXED_PRICE' AND last_seen_at < ${runStart}`);
  return { stored, deals, newDealIds };
}

async function storeSales(t: Target, sales: { itemId: string; title: string; price: number; soldAt: Date; url: string }[]) {
  let n = 0;
  for (const s of sales) {
    const a = analyseOffer({ title: s.title } as EbayOffer, t);
    if (!a.matches || a.cond === "dmg") continue;
    const r = await db.insert(soldComps).values({
      externalId: `ebay-sold:${s.itemId}:${s.soldAt.toISOString().slice(0, 10)}`, source: "ebay-sold", targetKind: t.kind, targetId: t.id,
      gradeKey: a.grade.key, grade: a.grade.label, lang: a.lang, title: s.title, price: s.price.toFixed(2), soldAt: s.soldAt,
      url: affiliateItemUrl(s.url, null, "pokeswipe-comps").slice(0, 600),
    }).onConflictDoNothing().returning({ id: soldComps.id });
    n += r.length;
  }
  return n;
}

export async function syncTarget(t: Target, runStart = new Date()) {
  const query = searchQueryOf(t);
  const key = targetKey(t.kind, t.id);
  const [state] = await db.select().from(flipTargets).where(eq(flipTargets.id, key)).limit(1);
  const category = t.kind === "sealed" ? "" : EBAY_CATEGORY_SINGLES;
  const offers = await browseSearch(query, { category, limit: 100 });
  let comps = 0;
  // Echte Verkäufe (falls freigeschaltet) höchstens einmal pro Tag je Ziel
  if (insightsAvailable() && (!state?.insightsAt || Date.now() - state.insightsAt.getTime() > 20 * 3600_000)) {
    const sales = await insightsSearch(query, { category, limit: 100 }).catch(() => null);
    if (sales) comps += await storeSales(t, sales);
  }
  comps += await harvestEndedAuctions(t.kind, t.id);
  const sold = await soldStats(t.kind, t.id);
  const res = await storeOffers(t, offers, runStart, sold);
  await rebuildGradeValues(t.kind, t.id);
  const now = new Date();
  const values = { id: key, targetKind: t.kind, targetId: t.id, query, lastSyncedAt: now, lastOffers: res.stored, lastDeals: res.deals, errors: 0, ...(insightsAvailable() ? { insightsAt: now } : {}) };
  const { id: _k, ...updates } = values;
  await db.insert(flipTargets).values(values).onConflictDoUpdate({ target: flipTargets.id, set: updates });
  return { ...res, comps, found: offers.length };
}

/** Wunschlisten-Push für neue Deals (max. 1 Mitteilung pro Karte und Nutzer in 12 h; Sniper-Details nur für Abonnenten). */
async function notifyWishlistDeals(ids: string[]) {
  if (!ids.length) return 0;
  const hits = rows(await db.execute(sql`
    SELECT o.id AS offer_id, o.title, o.total::float AS total, o.discount_pct::float AS pct, o.target_id, o.target_kind,
      w.id AS wish_id, w.user_id, p.plan, p.plan_until, p.bonus_until, p.bonus_plan
    FROM market_offers o
    LEFT JOIN card_prints cp ON o.target_kind = 'print' AND cp.id = o.target_id
    JOIN wishlist_items w ON w.card_id = CASE WHEN o.target_kind = 'card' THEN o.target_id ELSE cp.base_card_id END
    JOIN profiles p ON p.user_id = w.user_id
    WHERE o.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND NOT p.banned
      AND (w.max_price IS NULL OR o.total <= w.max_price)
      AND (w.last_notified_at IS NULL OR w.last_notified_at < now() - interval '12 hours')
    ORDER BY o.discount_pct DESC LIMIT 60`));
  const done = new Set<number>();
  let sent = 0;
  for (const h of hits) {
    if (done.has(Number(h.wish_id))) continue;
    done.add(Number(h.wish_id));
    const plan = effectivePlan({ plan: h.plan, planUntil: h.plan_until ? new Date(h.plan_until) : null, bonusUntil: h.bonus_until ? new Date(h.bonus_until) : null, bonusPlan: h.bonus_plan });
    const pct = Math.round(Number(h.pct) || 0);
    const locked = plan === "free" && pct >= SNIPER_MIN_PCT;
    await notify(h.user_id,
      locked ? `👑 Sniper-Deal auf deiner Wunschliste (−${pct} %)` : `🔥 Wunschkarte −${pct} % bei eBay`,
      locked ? "Ein Angebot liegt deutlich unter Marktwert. Mit Premium oder Pro siehst du es sofort." : `${String(h.title).slice(0, 90)} für ${Number(h.total).toFixed(2).replace(".", ",")} €`,
      "/?tab=flip&sub=deals").catch(() => {});
    await db.execute(sql`UPDATE wishlist_items SET last_notified_at = now() WHERE id = ${h.wish_id}`);
    await db.execute(sql`UPDATE market_offers SET notified_at = now() WHERE id = ${h.offer_id}`);
    sent++;
  }
  return sent;
}

async function logRun(job: "flip" | "sealed", mode: "live" | "demo") {
  const [r] = await db.insert(flipSyncRuns).values({ job, mode }).returning({ id: flipSyncRuns.id });
  return r.id;
}
async function finishRun(id: number, v: { queries?: number; offers?: number; deals?: number; comps?: number; updated?: number; error?: string | null }) {
  await db.update(flipSyncRuns).set({ ...v, error: v.error ? v.error.slice(0, 400) : null, finishedAt: new Date() }).where(eq(flipSyncRuns.id, id));
}

/** Geplanter Lauf des Flip-Radars. */
export async function runFlipSync({ deadlineMs = 22_000, maxTargets = 18, concurrency = 3 } = {}) {
  const started = Date.now();
  const runStart = new Date();
  if (!ebayConfigured()) {
    const id = await logRun("flip", "demo");
    await finishRun(id, { error: "EBAY_CLIENT_ID/EBAY_CLIENT_SECRET nicht gesetzt – Demo-Modus mit Cardmarket-Daten" });
    return { mode: "demo" as const, queries: 0, offers: 0, deals: 0, comps: 0, notified: 0 };
  }
  const runId = await logRun("flip", "live");
  const totals = { queries: 0, offers: 0, deals: 0, comps: 0, notified: 0 };
  const errors: string[] = [];
  try {
    // Abgelaufene Auktionen anderer Ziele + uralte Angebote aufräumen
    totals.comps += await harvestEndedAuctions();
    await db.execute(sql`UPDATE market_offers SET status = 'gone', gone_at = now() WHERE status = 'active' AND last_seen_at < now() - interval '4 days'`);
    await db.execute(sql`DELETE FROM market_offers WHERE status <> 'active' AND COALESCE(gone_at, last_seen_at) < now() - interval '30 days'`);
    await db.execute(sql`DELETE FROM sold_comps WHERE sold_at < now() - interval '400 days'`);

    const queue = await dueTargets(maxTargets);
    const newDeals: string[] = [];
    const worker = async () => {
      while (queue.length && Date.now() - started < deadlineMs - 4000) {
        const t = queue.shift()!;
        try {
          const r = await syncTarget(t, runStart);
          totals.queries++; totals.offers += r.stored; totals.deals += r.deals; totals.comps += r.comps;
          newDeals.push(...r.newDealIds);
        } catch (e: any) {
          errors.push(`${t.kind}:${t.id} ${String(e?.message || e).slice(0, 60)}`);
          await db.execute(sql`
            INSERT INTO flip_targets (id, target_kind, target_id, query, last_synced_at, errors) VALUES (${targetKey(t.kind, t.id)}, ${t.kind}, ${t.id}, '', now(), 1)
            ON CONFLICT (id) DO UPDATE SET errors = flip_targets.errors + 1, last_synced_at = now()`);
          // Kontingent erschöpft oder Zugang gesperrt: Lauf beenden
          if (/ 429| 401| 403|OAuth/.test(String(e?.message))) queue.length = 0;
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    totals.notified = await notifyWishlistDeals(newDeals).catch(() => 0);
  } catch (e: any) {
    errors.push(String(e?.message || e).slice(0, 120));
  }
  await finishRun(runId, { queries: totals.queries, offers: totals.offers, deals: totals.deals, comps: totals.comps, error: errors.length ? errors.slice(0, 5).join(" | ") : null });
  return { mode: "live" as const, ...totals, errors: errors.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// Automatische Sealed-Preise
// ---------------------------------------------------------------------------
export async function runSealedPrices({ deadlineMs = 22_000, max = 20 } = {}) {
  const started = Date.now();
  const live = ebayConfigured();
  const runId = await logRun("sealed", live ? "live" : "demo");
  const products = await db.select().from(sealedProducts).where(eq(sealedProducts.active, true))
    .orderBy(sql`${sealedProducts.autoPriceAt} ASC NULLS FIRST`).limit(max);
  let queries = 0, offersN = 0, updated = 0, comps = 0;
  const errors: string[] = [];
  const runStart = new Date();
  for (const p of products) {
    if (Date.now() - started > deadlineMs - 3000) break;
    try {
      const t: Target & { sealedKind: string } = {
        kind: "sealed", id: String(p.id), name: p.name, nameEn: "", localId: "", total: null, lang: "de",
        market: Number(p.refPrice) || null, marketSource: "sealed", image: p.image, number: "", interest: 0, sealedKind: p.kind,
      };
      const asks: number[] = [];
      const sold: number[] = [];
      if (live) {
        const q = p.ebayQuery?.trim() || buildQuery({ kind: "sealed", name: p.name });
        const found = await browseSearch(q, { category: "", limit: 100 });
        queries++;
        for (const o of found) {
          if (o.buyingOption === "FIXED_PRICE" && titleMatchesSealed(o.title, p.name, p.kind)) asks.push(o.price + (o.shipping ?? 0));
        }
        if (insightsAvailable()) {
          const sales = await insightsSearch(q, { category: "", limit: 100 }).catch(() => null);
          if (sales) {
            for (const s of sales) if (titleMatchesSealed(s.title, p.name, p.kind) && Date.now() - s.soldAt.getTime() < 30 * 86400_000) sold.push(s.price);
            comps += await storeSales(t, sales);
          }
        }
        comps += await harvestEndedAuctions("sealed", t.id);
        const r = await storeOffers(t, found, runStart, {});
        offersN += r.stored;
        await rebuildGradeValues("sealed", t.id);
      }
      const auctions = rows(await db.execute(sql`
        SELECT price::float AS price FROM sold_comps WHERE target_kind = 'sealed' AND target_id = ${t.id} AND source = 'ebay-auction' AND sold_at > now() - interval '30 days'`)).map((r: any) => Number(r.price));
      const community = rows(await db.execute(sql`
        SELECT l.price::float AS price FROM listings l JOIN profiles pr ON pr.user_id = l.user_id
        WHERE l.sealed_product_id = ${p.id} AND l.status = 'active' AND NOT pr.banned`)).map((r: any) => Number(r.price));
      const est = sealedAutoPrice({ sold, auctions, asks, community });
      const communityAvg = community.length ? round2(community.reduce((a, b) => a + b, 0) / community.length) : null;
      const set: Record<string, any> = { autoPriceAt: new Date() };
      if (est) Object.assign(set, { autoPrice: est.price.toFixed(2), autoPriceSource: est.source, autoSample: est.sample });
      if (est && !p.priceLocked) Object.assign(set, { refPrice: est.price.toFixed(2), refUpdatedAt: new Date(), priceSource: `auto-${est.source}` });
      await db.update(sealedProducts).set(set).where(eq(sealedProducts.id, p.id));
      const effective = !p.priceLocked && est ? est.price.toFixed(2) : p.refPrice;
      if (effective || communityAvg) {
        await db.insert(sealedPriceHistory).values({ productId: p.id, day: today(), refPrice: effective ?? null, communityAvg: money2(communityAvg), listingCount: community.length })
          .onConflictDoUpdate({ target: [sealedPriceHistory.productId, sealedPriceHistory.day], set: { refPrice: effective ?? null, communityAvg: money2(communityAvg), listingCount: community.length } });
      }
      if (est && !p.priceLocked) { await evaluateSealedAlerts(p.id, est.price); updated++; }
    } catch (e: any) {
      errors.push(`${p.id} ${String(e?.message || e).slice(0, 60)}`);
      await db.update(sealedProducts).set({ autoPriceAt: new Date() }).where(eq(sealedProducts.id, p.id));
      if (/ 429| 401| 403|OAuth/.test(String(e?.message))) break;
    }
  }
  await finishRun(runId, { queries, offers: offersN, comps, updated, error: errors.length ? errors.slice(0, 5).join(" | ") : (live ? null : "Demo-Modus: nur Community-Inserate (eBay-Schlüssel fehlen)") });
  return { mode: live ? "live" : "demo", queries, offers: offersN, updated, comps, errors: errors.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------
type Viewer = { paid: boolean; admin: boolean };
async function viewerOf(c: any): Promise<Viewer> {
  const user = await verifyIdentityToken(c).catch(() => null);
  if (!user) return { paid: false, admin: false };
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  const admin = isAdmin(user);
  return { paid: admin || (!!p && effectivePlan(p) !== "free"), admin };
}

function shapeOffer(o: any, viewer: Viewer) {
  const pct = o.discount_pct != null ? Number(o.discount_pct) : null;
  const locked = !viewer.paid && !!o.is_deal && pct != null && pct >= SNIPER_MIN_PCT;
  const base = {
    id: String(o.id), kind: String(o.target_kind), targetId: String(o.target_id), category: o.target_kind === "sealed" ? "sealed" : "singles",
    gradeKey: String(o.grade_key), grade: String(o.grade || ""), lang: o.lang || null, buyingOption: String(o.buying_option),
    bidCount: Number(o.bid_count) || 0, endAt: o.end_at, refPrice: o.ref_price != null ? Number(o.ref_price) : null, refSource: o.ref_source || null,
    discountPct: pct, isDeal: !!o.is_deal, suspicious: !!o.suspicious, firstSeenAt: o.first_seen_at, lastSeenAt: o.last_seen_at,
    targetName: String(o.target_name || ""), targetNumber: String(o.target_number || ""), targetImage: String(o.target_image || ""),
    source: "ebay", locked,
  };
  if (locked) return { ...base, title: "", total: null, price: null, shipping: null, itemUrl: "", image: "", seller: "", sellerFeedbackPct: null, rawCondition: "" };
  return {
    ...base, title: String(o.title), total: Number(o.total), price: Number(o.price), shipping: o.shipping != null ? Number(o.shipping) : null,
    itemUrl: String(o.item_url), image: String(o.image || ""), seller: String(o.seller || ""),
    sellerFeedbackPct: o.seller_feedback_pct != null ? Number(o.seller_feedback_pct) : null, sellerFeedbackScore: o.seller_feedback_score != null ? Number(o.seller_feedback_score) : null,
    rawCondition: String(o.raw_condition || ""), country: String(o.country || ""),
  };
}

const targetJoin = sql`
  LEFT JOIN cards c ON o.target_kind = 'card' AND c.id = o.target_id
  LEFT JOIN card_prints cp ON o.target_kind = 'print' AND cp.id = o.target_id
  LEFT JOIN sealed_products sp ON o.target_kind = 'sealed' AND sp.id::text = o.target_id`;
const targetCols = sql`COALESCE(c.name, cp.name, sp.name) AS target_name, COALESCE(c.local_id, cp.number, '') AS target_number, COALESCE(NULLIF(c.image, ''), NULLIF(cp.image, ''), sp.image, '') AS target_image`;

type DealQuery = { cat: string; grade: string; option: string; lang: string; minPct: number; sort: string; limit: number };
export function parseDealQuery(q: Record<string, string | undefined>): DealQuery {
  const pick = (v: unknown, list: string[], d: string) => (list.includes(String(v)) ? String(v) : d);
  return {
    cat: pick(q.cat, ["all", "singles", "sealed"], "all"),
    grade: pick(q.grade, ["all", "raw", "graded", "psa10"], "all"),
    option: pick(q.option, ["all", "bin", "auction"], "all"),
    lang: pick(q.lang, ["all", "de", "en", "ja"], "all"),
    minPct: int(q.minPct, FLIP_DEAL_MIN_PCT, 90, FLIP_DEAL_MIN_PCT),
    sort: pick(q.sort, ["discount", "ending", "newest", "savings"], "discount"),
    limit: int(q.limit, 1, 60, 40),
  };
}

async function liveDeals(f: DealQuery, viewer: Viewer) {
  const where = [sql`o.status = 'active'`, sql`o.is_deal`, sql`o.last_seen_at > now() - interval '36 hours'`, sql`o.discount_pct >= ${f.minPct}`];
  if (f.cat === "singles") where.push(sql`o.target_kind IN ('card', 'print')`);
  if (f.cat === "sealed") where.push(sql`o.target_kind = 'sealed'`);
  if (f.grade === "raw") where.push(sql`o.grade_key = 'raw'`);
  if (f.grade === "graded") where.push(sql`o.grade_key <> 'raw'`);
  if (f.grade === "psa10") where.push(sql`o.grade_key = 'psa10'`);
  if (f.option === "bin") where.push(sql`o.buying_option = 'FIXED_PRICE'`);
  if (f.option === "auction") where.push(sql`o.buying_option = 'AUCTION'`);
  if (f.lang === "ja") where.push(sql`(o.lang = 'ja' OR cp.lang = 'ja')`);
  if (f.lang === "en") where.push(sql`(o.lang = 'en' OR (cp.lang = 'en' AND o.lang IS NULL))`);
  if (f.lang === "de") where.push(sql`(o.lang = 'de' OR (o.target_kind = 'card' AND o.lang IS NULL))`);
  const order = f.sort === "ending" ? sql`o.end_at ASC NULLS LAST` : f.sort === "newest" ? sql`o.first_seen_at DESC`
    : f.sort === "savings" ? sql`(o.ref_price - o.total) DESC` : sql`o.suspicious ASC, o.discount_pct DESC`;
  const list = rows(await db.execute(sql`
    SELECT o.*, ${targetCols} FROM market_offers o ${targetJoin}
    WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT ${f.limit}`));
  return list.map((o: any) => shapeOffer(o, viewer));
}

/** Demo/Fallback: echte Cardmarket-Tiefstpreise unter Trend (deutsch + EN/JA-Drucke) und Community-Inserate für Sealed. */
async function fallbackDeals(f: DealQuery, viewer: Viewer) {
  const out: any[] = [];
  const minRatio = (100 - f.minPct) / 100;
  if (f.cat !== "sealed" && (f.grade === "all" || f.grade === "raw") && f.option !== "auction") {
    const langCond = f.lang === "all" ? sql`TRUE` : sql`x.lang = ${f.lang}`;
    const list = rows(await db.execute(sql`
      SELECT * FROM (
        SELECT 'card'::text AS kind, c.id, c.name, c.local_id AS number, c.image, 'de'::text AS lang, c.trend::float AS ref, c.low::float AS low, c.set_name
        FROM cards c WHERE c.trend >= ${FLIP_MIN_REF_EUR} AND c.low > 0 AND c.low <= c.trend * ${minRatio} AND c.image <> ''
        UNION ALL
        SELECT 'print', p.id, p.name, p.number, p.image, p.lang, p.cm_trend::float, p.cm_low::float, p.set_name
        FROM card_prints p WHERE p.price_source = 'cardmarket' AND p.cm_trend >= ${FLIP_MIN_REF_EUR} AND p.cm_low > 0 AND p.cm_low <= p.cm_trend * ${minRatio} AND p.image <> ''
      ) x WHERE ${langCond}
      ORDER BY (x.ref - x.low) / x.ref DESC, x.ref DESC LIMIT ${f.limit}`));
    for (const r of list) {
      const pct = discountPct(r.ref, r.low);
      const locked = !viewer.paid && pct != null && pct >= SNIPER_MIN_PCT;
      const q = `${r.name} ${r.number || ""}${r.lang === "ja" ? " japanese" : ""}`.trim();
      out.push({
        id: `cm:${r.id}`, kind: r.kind, targetId: String(r.id), category: "singles", gradeKey: "raw", grade: "Raw", lang: r.lang,
        buyingOption: "FIXED_PRICE", refPrice: Number(r.ref), refSource: "cardmarket", discountPct: pct, isDeal: true, suspicious: pct != null && pct >= 60,
        targetName: String(r.name), targetNumber: String(r.number || ""), targetImage: String(r.image || ""), source: "cardmarket-low", locked,
        title: locked ? "" : `${r.name} ${r.number || ""} – ${r.set_name || ""}`.trim(), total: locked ? null : Number(r.low),
        itemUrl: locked ? "" : ebaySearchUrl(q, "pokeswipe-flip-demo"), searchQuery: locked ? "" : q, image: "", seller: "",
      });
    }
  }
  if (f.cat !== "singles" && f.option !== "auction") {
    const list = rows(await db.execute(sql`
      SELECT l.id, l.price::float AS price, l.city, sp.id AS pid, sp.name, sp.image, sp.ref_price::float AS ref
      FROM listings l JOIN sealed_products sp ON sp.id = l.sealed_product_id JOIN profiles pr ON pr.user_id = l.user_id
      WHERE l.status = 'active' AND NOT pr.banned AND sp.ref_price >= ${FLIP_MIN_REF_EUR} AND l.price <= sp.ref_price * ${minRatio}
      ORDER BY (sp.ref_price - l.price) / sp.ref_price DESC LIMIT 20`));
    for (const r of list) {
      const pct = discountPct(r.ref, r.price);
      out.push({
        id: `listing:${r.id}`, kind: "sealed", targetId: String(r.pid), category: "sealed", gradeKey: "raw", grade: "", lang: "de",
        buyingOption: "FIXED_PRICE", refPrice: Number(r.ref), refSource: "sealed", discountPct: pct, isDeal: true, suspicious: false,
        targetName: String(r.name), targetNumber: "", targetImage: String(r.image || ""), source: "community-listing", locked: false,
        title: `${r.name} – Tausch-Hub${r.city ? `, ${r.city}` : ""}`, total: Number(r.price), itemUrl: "", listingId: Number(r.id), image: "", seller: "",
      });
    }
  }
  return out.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0)).slice(0, f.limit);
}

async function flipMeta() {
  const [r] = rows(await db.execute(sql`
    SELECT (SELECT count(*)::int FROM market_offers WHERE status = 'active') AS offers,
      (SELECT count(*)::int FROM market_offers WHERE status = 'active' AND is_deal) AS deals,
      (SELECT count(*)::int FROM sold_comps WHERE sold_at > now() - interval '90 days') AS comps,
      (SELECT max(finished_at) FROM flip_sync_runs WHERE job = 'flip' AND mode = 'live') AS last_live`));
  return { offers: Number(r?.offers ?? 0), deals: Number(r?.deals ?? 0), comps: Number(r?.comps ?? 0), lastSync: r?.last_live ?? null };
}

/** Komplette Verkaufs-/Grading-Ansicht eines Ziels. */
export async function compsFor(kind: TargetKind, id: string, viewer: Viewer) {
  const t = await loadTarget(kind, id);
  if (!t) return null;
  const grades = await db.select().from(gradeValues).where(and(eq(gradeValues.targetKind, kind), eq(gradeValues.targetId, id)));
  const comps = rows(await db.execute(sql`
    SELECT source, grade_key, grade, lang, title, price::float AS price, sold_at, url FROM sold_comps
    WHERE target_kind = ${kind} AND target_id = ${id} AND sold_at > now() - interval '90 days' ORDER BY sold_at DESC LIMIT 400`));
  const offers = rows(await db.execute(sql`
    SELECT o.*, ${targetCols} FROM market_offers o ${targetJoin}
    WHERE o.target_kind = ${kind} AND o.target_id = ${id} AND o.status = 'active' AND o.last_seen_at > now() - interval '36 hours'
    ORDER BY o.total ASC LIMIT 24`));
  const series: Record<string, { day: string; median: number; n: number }[]> = {};
  for (const g of GRADE_KEYS) {
    const pts = comps.filter((c: any) => c.grade_key === g).map((c: any) => ({ day: new Date(c.sold_at).toISOString().slice(0, 10), price: Number(c.price) }));
    if (pts.length) series[g] = dailyMedians(pts);
  }
  const marketHistory = kind === "card"
    ? rows(await db.execute(sql`SELECT day, COALESCE(trend, avg)::float AS value FROM price_history WHERE card_id = ${id} ORDER BY day DESC LIMIT 90`)).reverse()
    : kind === "print"
      ? rows(await db.execute(sql`SELECT day, price_eur::float AS value FROM card_print_prices WHERE print_id = ${id} ORDER BY day DESC LIMIT 90`)).reverse()
      : rows(await db.execute(sql`SELECT day, COALESCE(ref_price, community_avg)::float AS value FROM sealed_price_history WHERE product_id = ${Number(id)} ORDER BY day DESC LIMIT 90`)).reverse();
  const g = (k: GradeKey) => grades.find((x) => x.gradeKey === k);
  const [st] = await db.select().from(flipTargets).where(eq(flipTargets.id, targetKey(kind, id))).limit(1);
  let sealed: any = null;
  if (kind === "sealed") {
    const [p] = await db.select().from(sealedProducts).where(eq(sealedProducts.id, Number(id))).limit(1);
    if (p) sealed = {
      refPrice: p.refPrice != null ? Number(p.refPrice) : null, priceSource: p.priceSource, locked: p.priceLocked,
      autoPrice: p.autoPrice != null ? Number(p.autoPrice) : null, autoSource: p.autoPriceSource, autoSourceLabel: SEALED_SOURCE_LABEL[p.autoPriceSource || ""] || "",
      autoSample: p.autoSample, autoPriceAt: p.autoPriceAt, boosterCount: p.boosterCount,
    };
  }
  return {
    mode: ebayConfigured() ? "live" : "demo",
    insights: insightsAvailable(),
    target: { kind, id, name: t.name, number: t.number, image: t.image, lang: t.lang, market: t.market, marketSource: t.marketSource, lastSyncedAt: st?.lastSyncedAt ?? null },
    grades: GRADE_KEYS.map((k) => {
      const v = g(k);
      return {
        key: k, label: GRADE_LABEL[k],
        median90: v?.median90 != null ? Number(v.median90) : null, median30: v?.median30 != null ? Number(v.median30) : null,
        sample90: v?.sample90 ?? 0, sample30: v?.sample30 ?? 0,
        low90: v?.low90 != null ? Number(v.low90) : null, high90: v?.high90 != null ? Number(v.high90) : null,
        askLow: v?.askLow != null ? Number(v.askLow) : null, askCount: v?.askCount ?? 0,
      };
    }),
    series,
    marketHistory: marketHistory.map((r: any) => ({ day: String(r.day).slice(0, 10), value: Number(r.value) || null })),
    sold: comps.slice(0, 30).map((c: any) => ({
      source: c.source, gradeKey: c.grade_key, grade: c.grade || GRADE_LABEL[c.grade_key as GradeKey] || "", lang: c.lang, title: c.title,
      price: Number(c.price), soldAt: c.sold_at, url: /^https:\/\//.test(String(c.url || "")) ? c.url : "",
    })),
    offers: offers.map((o: any) => shapeOffer(o, viewer)),
    searchUrl: ebaySearchUrl(t.kind === "sealed" ? buildQuery({ kind: "sealed", name: t.name }) : `${t.nameEn && t.lang === "ja" ? t.nameEn : t.name} ${t.number}${t.lang === "ja" ? " japanese" : ""}`, "pokeswipe-comps"),
    soldSearchUrl: `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(`${t.name} ${t.number}`.trim())}&LH_Sold=1&LH_Complete=1&_sop=13&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=5339244109&customid=pokeswipe-comps-sold&toolid=10001&mkevt=1`,
    sealed,
    gradingPresets: GRADING_PRESETS,
    dealMinPct: FLIP_DEAL_MIN_PCT,
  };
}

export async function flipAdminStatus() {
  const runs = await db.select().from(flipSyncRuns).orderBy(desc(flipSyncRuns.startedAt)).limit(12);
  const [counts] = rows(await db.execute(sql`
    SELECT (SELECT count(*)::int FROM flip_targets) AS targets,
      (SELECT count(*)::int FROM flip_targets WHERE last_synced_at > now() - interval '24 hours') AS targets24,
      (SELECT count(*)::int FROM market_offers WHERE status = 'active') AS offers,
      (SELECT count(*)::int FROM market_offers WHERE status = 'active' AND is_deal) AS deals,
      (SELECT count(*)::int FROM sold_comps) AS comps,
      (SELECT count(*)::int FROM sold_comps WHERE source = 'ebay-sold') AS comps_sold,
      (SELECT count(*)::int FROM sealed_products WHERE active) AS sealed,
      (SELECT count(*)::int FROM sealed_products WHERE active AND price_locked) AS sealed_locked,
      (SELECT count(*)::int FROM sealed_products WHERE active AND auto_price IS NOT NULL) AS sealed_auto`));
  const sealed = rows(await db.execute(sql`
    SELECT id, name, kind, ref_price::float AS ref_price, price_source, price_locked, auto_price::float AS auto_price, auto_price_source, auto_sample, auto_price_at, ebay_query
    FROM sealed_products WHERE active ORDER BY name LIMIT 300`));
  // Kontolöschungs-Webhook (Pflicht für eBay-Production-Keys): nur ob der Token gesetzt ist, nie der Wert
  const deletionToken = String(process.env.EBAY_VERIFICATION_TOKEN || "").trim();
  const deletionWebhook = {
    tokenSet: /^[A-Za-z0-9_-]{32,80}$/.test(deletionToken),
    endpoint: String(process.env.EBAY_ENDPOINT_URL || "").trim() || "https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion",
  };
  return { configured: ebayConfigured(), insights: insightsAvailable(), counts, runs, sealed, deletionWebhook };
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerFlip(app: any, { auth, adminOnly, body }: { auth: any; adminOnly: any; body: (c: any) => Promise<any> }) {
  // Deal-Feed (öffentlich; Sniper-Deals ≥ 25 % nur für Abonnenten vollständig)
  app.get("/api/flip/deals", async (c: any) => {
    if (!rateLimit(`flip:${clientIp(c)}`, 40, 60_000)) return c.json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
    const f = parseDealQuery(c.req.query());
    const viewer = await viewerOf(c);
    const live = ebayConfigured();
    const deals = live ? await liveDeals(f, viewer) : [];
    const fallback = deals.length ? [] : await fallbackDeals(f, viewer);
    c.header("Cache-Control", "private, no-store");
    return c.json({
      mode: live ? "live" : "demo", deals, fallback, filters: f, meta: await flipMeta(),
      paid: viewer.paid, sniperMinPct: SNIPER_MIN_PCT, dealMinPct: FLIP_DEAL_MIN_PCT,
    });
  });

  // Verkaufspreise, PSA-Werte, Charts, aktive Angebote eines Ziels: /api/flip/comps/card:sv03.5-199 | print:ja:SV2a-201 | sealed:12
  app.get("/api/flip/comps/:key", async (c: any) => {
    if (!rateLimit(`comps:${clientIp(c)}`, 60, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const parsed = parseTargetKey(str(c.req.param("key"), 70));
    if (!parsed) return c.json({ error: "Ungültige Karte" }, 400);
    const ok = parsed.kind === "card" ? CARD_ID_RE.test(parsed.id) : parsed.kind === "print" ? PRINT_ID_RE.test(parsed.id) : /^\d{1,9}$/.test(parsed.id);
    if (!ok) return c.json({ error: "Ungültige Karte" }, 400);
    const viewer = await viewerOf(c);
    const data = await compsFor(parsed.kind, parsed.id, viewer);
    if (!data) return c.json({ error: "Karte nicht gefunden" }, 404);
    c.header("Cache-Control", "private, max-age=60");
    return c.json(data);
  });

  // Angemeldete Nutzer: ein Ziel sofort bei eBay abgleichen (z. B. aus der Kartenansicht), höchstens alle 30 Minuten je Karte
  app.post("/api/flip/refresh/:key", auth, async (c: any) => {
    const parsed = parseTargetKey(str(c.req.param("key"), 70));
    if (!parsed || parsed.kind === "sealed") return c.json({ error: "Ungültige Karte" }, 400);
    if (!(parsed.kind === "card" ? CARD_ID_RE.test(parsed.id) : PRINT_ID_RE.test(parsed.id))) return c.json({ error: "Ungültige Karte" }, 400);
    if (!ebayConfigured()) return c.json({ error: "Die eBay-Anbindung ist noch nicht aktiv.", demo: true }, 503);
    const user = c.get("user");
    if (!rateLimit(`flipref:${user.id}`, 6, 60 * 60_000)) return c.json({ error: "Bitte später erneut versuchen (max. 6 Abgleiche pro Stunde)." }, 429);
    const [st] = await db.select().from(flipTargets).where(eq(flipTargets.id, targetKey(parsed.kind, parsed.id))).limit(1);
    if (st?.lastSyncedAt && Date.now() - st.lastSyncedAt.getTime() < 30 * 60_000) return c.json({ ok: true, fresh: true });
    const t = await loadTarget(parsed.kind, parsed.id);
    if (!t) return c.json({ error: "Karte nicht gefunden" }, 404);
    const r = await syncTarget(t);
    return c.json({ ok: true, found: r.found, stored: r.stored, deals: r.deals });
  });

  app.get("/api/admin/flip", auth, adminOnly, async (c: any) => c.json(await flipAdminStatus()));
  app.post("/api/admin/flip/run", auth, adminOnly, async (c: any) => {
    const result = await runFlipSync({ deadlineMs: 20_000, maxTargets: 10 });
    return c.json({ result, status: await flipAdminStatus() });
  });
  app.post("/api/admin/sealed-prices/run", auth, adminOnly, async (c: any) => {
    const result = await runSealedPrices({ deadlineMs: 20_000, max: 12 });
    return c.json({ result, status: await flipAdminStatus() });
  });
  // Admin-Override: Referenzpreis sperren/freigeben und optional eigenen eBay-Suchbegriff setzen
  app.post("/api/admin/sealed/:id/lock", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    if (!id) return c.json({ error: "Ungültiges Produkt" }, 400);
    const b = await body(c);
    const set: Record<string, any> = {};
    if (typeof b.locked === "boolean") set.priceLocked = b.locked;
    if (typeof b.ebayQuery === "string") set.ebayQuery = str(b.ebayQuery, 90);
    if (!Object.keys(set).length) return c.json({ error: "Nichts zu ändern" }, 400);
    // Freigeben: sofort den zuletzt berechneten automatischen Preis übernehmen
    if (b.locked === false) {
      const [p] = await db.select().from(sealedProducts).where(eq(sealedProducts.id, id)).limit(1);
      if (p?.autoPrice) Object.assign(set, { refPrice: p.autoPrice, refUpdatedAt: new Date(), priceSource: `auto-${p.autoPriceSource || "ebay"}` });
    }
    const [row] = await db.update(sealedProducts).set(set).where(eq(sealedProducts.id, id)).returning({ id: sealedProducts.id, priceLocked: sealedProducts.priceLocked });
    if (!row) return c.json({ error: "Produkt nicht gefunden" }, 404);
    return c.json({ ok: true, ...row });
  });
}
