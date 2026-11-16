// PokeSwipe & Radar – Wachstum & Bindung: Wunschliste mit Tausch-Abgleich, öffentliche Kartenseiten (SEO),
// tägliche Serie, Abzeichen, Bestenliste, Kalender (Releases & Events), Wochen-Report, Shop-Statistik,
// CSV-Import, KI-Zustandscheck, Rechtliches (Impressum, Daten-Export).
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import {
  db, profiles, cards, priceHistory, portfolioItems, priceAlerts, notifications, listings, trades, tradeMessages, reviews,
  wishlistItems, userBadges, calendarEvents, calendarReminders, cardScans, sealedAlerts, trackedSets,
} from "../db/index.ts";
import { PLANS, SWITCH_BONUS_DAYS, SWITCH_MIN_CARDS, type PlanId } from "./plans.ts";
import { CARD_ID_RE, getCard, cardPrice, notify, cardmarketPartnerId } from "./prices.ts";
import { verifyIdentityToken, isAdmin } from "./auth.ts";
import { searchTcgdex, fetchSet, normNum, pool, reserveScan } from "./features.ts";
import { BADGES, earnedBadges, berlinDay, nextStreak, weeklySummary, type BadgeStats } from "./logic.ts";
import { str, money, int, rows, rateLimit, clientIp, euro } from "./util.ts";
import { scanLimit } from "./viral.ts";
import { checkMatchesAfterWishlist } from "./trading.ts";
import { parseVariant, normalizeVariant, normalizeCondition, availableVariants, variantPrice, VARIANT_LABELS } from "./variant-logic.ts";
import { publicCache } from "./cache.ts";
import { conditionPricesForCard, recentMarketSales, type ConditionPrices } from "./condition-prices.ts";
import { CONDITION_MIN_SALES } from "./condition-logic.ts";
import { CONDITIONS } from "./market-logic.ts";
import { cardPrints, printSets } from "../db/index.ts";
import {
  pt, euroL, fmtPct, fmtDate, OG_LOCALE, SOURCE_NOTES, CONDITIONS_EN, typeLabel, stageLabel, withAppLang, localPath, langFromPath,
  hreflangTags, alternatesFor, pokemonEnSlug, displayName, type Lang, type Alternates,
} from "./page-i18n.ts";

type Profile = typeof profiles.$inferSelect;

export const SITE = () => process.env.URL || "https://pokeswipe-radar.de";
const EPN_CAMPAIGN_ID = "5339244109";
/** eBay-Suche mit Partner-Kennung (eBay Partner Network). */
export const ebayUrl = (q: string, src = "web") =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_BIN=1&_sop=15&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=${EPN_CAMPAIGN_ID}&customid=${encodeURIComponent(`pokeswipe-${src}`)}&toolid=10001&mkevt=1`;
/** Cardmarket-Suche mit UTM und (falls gesetzt) Partnerkennung CARDMARKET_PARTNER_ID. */
export const cardmarketSearch = (q: string, lang: Lang = "de") => {
  const u = new URL(`https://www.cardmarket.com/${lang === "en" ? "en" : "de"}/Pokemon/Products/Search`);
  u.searchParams.set("searchString", q.slice(0, 120));
  u.searchParams.set("utm_source", "pokeswipe_radar");
  u.searchParams.set("utm_medium", "seo");
  const ref = cardmarketPartnerId();
  if (ref) u.searchParams.set("referrer", ref);
  return u.toString();
};
export const h = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const slugify = (s: string) => s.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/é/g, "e")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "karte";
export const cdnImage = (url: string, w: number, fm = "") =>
  url ? `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}${fm ? `&fm=${fm}` : ""}` : "";

// ---------------------------------------------------------------------------
// Wunschliste: Benachrichtigung bei neuen Inseraten
// ---------------------------------------------------------------------------
export async function notifyWishlistListing(row: typeof listings.$inferSelect, sellerName: string, sellerId: string) {
  if (!row.cardId) return;
  const watchers = rows(await db.execute(sql`
    SELECT w.id, w.user_id FROM wishlist_items w
    JOIN profiles p ON p.user_id = w.user_id AND NOT p.banned
    WHERE w.card_id = ${row.cardId} AND w.user_id <> ${sellerId}
      AND (w.max_price IS NULL OR w.max_price >= ${row.price})
      AND (w.last_notified_at IS NULL OR w.last_notified_at < now() - interval '6 hours')
      -- Wer schon über einen Preisalarm benachrichtigt wird, bekommt keine zweite Nachricht
      AND NOT EXISTS (SELECT 1 FROM price_alerts a WHERE a.user_id = w.user_id AND a.card_id = w.card_id
        AND a.active AND a.direction = 'below' AND a.target_price >= ${row.price})
    LIMIT 300
  `));
  for (const w of watchers) {
    await notify(w.user_id, "❤️ Wunschkarte im Tausch-Hub", `${row.cardName} für ${euro(Number(row.price))} in ${row.city} (${sellerName}).`, "/?tab=portfolio&sub=wishlist");
    await db.update(wishlistItems).set({ lastNotifiedAt: new Date() }).where(eq(wishlistItems.id, w.id));
  }
}

// ---------------------------------------------------------------------------
// Shop-Statistik
// ---------------------------------------------------------------------------
export async function recordShopView(c: any, ownerId: string) {
  try {
    if (!(await rateLimit(`shopview:${clientIp(c)}:${ownerId}`, 1, 30 * 60_000))) return;
    const viewer = await verifyIdentityToken(c);
    if (viewer?.id === ownerId) return;
    await db.execute(sql`
      INSERT INTO shop_stats (user_id, day, views) VALUES (${ownerId}, CURRENT_DATE, 1)
      ON CONFLICT (user_id, day) DO UPDATE SET views = shop_stats.views + 1
    `);
  } catch (e) {
    console.warn("Shop-Aufruf nicht gezählt", e);
  }
}

// ---------------------------------------------------------------------------
// Abzeichen
// ---------------------------------------------------------------------------
async function badgeStats(userId: string, bestStreak: number): Promise<BadgeStats> {
  const [r] = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM portfolio_items WHERE user_id = ${userId}) AS portfolio_count,
      (SELECT COALESCE(SUM(p.quantity * COALESCE(c.trend, c.avg, c.low, p.manual_value, 0)), 0)::float
         FROM portfolio_items p LEFT JOIN cards c ON c.id = p.card_id WHERE p.user_id = ${userId}) AS portfolio_value,
      (SELECT count(*)::int FROM trades WHERE status = 'completed' AND (from_user = ${userId} OR to_user = ${userId})) AS completed_trades,
      (SELECT count(*)::int FROM card_scans WHERE user_id = ${userId}) AS scans,
      (SELECT count(*)::int FROM wishlist_items WHERE user_id = ${userId}) AS wishlist_count,
      (SELECT count(*)::int FROM profiles WHERE referred_by = ${userId} AND referral_rewarded) AS referrals,
      (SELECT COALESCE(avg(stars), 0)::float FROM reviews WHERE reviewee_id = ${userId}) AS reviews_avg,
      (SELECT count(*)::int FROM reviews WHERE reviewee_id = ${userId}) AS reviews_count
  `));
  return {
    portfolioCount: Number(r?.portfolio_count ?? 0), portfolioValue: Number(r?.portfolio_value ?? 0),
    completedTrades: Number(r?.completed_trades ?? 0), bestStreak, scans: Number(r?.scans ?? 0),
    wishlistCount: Number(r?.wishlist_count ?? 0), referralsRewarded: Number(r?.referrals ?? 0),
    reviewsAvg: Number(r?.reviews_avg ?? 0), reviewsCount: Number(r?.reviews_count ?? 0),
  };
}

/** Prüft die Abzeichen eines Nutzers, speichert neue und meldet sie. */
async function refreshBadges(profile: Profile) {
  const earned = earnedBadges(await badgeStats(profile.userId, profile.bestStreak));
  if (!earned.length) return { all: [] as string[], fresh: [] as string[] };
  const inserted = await db.insert(userBadges).values(earned.map((badge) => ({ userId: profile.userId, badge })))
    .onConflictDoNothing().returning({ badge: userBadges.badge });
  const fresh = inserted.map((b) => b.badge);
  for (const id of fresh.slice(0, 3)) {
    const b = BADGES.find((x) => x.id === id);
    if (b) await notify(profile.userId, `${b.icon} Neues Abzeichen: ${b.label}`, b.description, "/?tab=community&sub=ranks");
  }
  const all = (await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, profile.userId))).map((b) => b.badge);
  return { all, fresh };
}

// ---------------------------------------------------------------------------
// Öffentliche Kartenseite (für Google, WhatsApp-Vorschau & Teilen)
// ---------------------------------------------------------------------------
export function chartSvg(points: number[], w = 640, hgt = 160, lang: Lang = "de") {
  const v = points.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return `<p class="muted">${pt(lang, "chart.empty")}</p>`;
  const min = Math.min(...v) * 0.97, max = Math.max(...v) * 1.03, span = max - min || 1;
  const line = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(hgt - ((x - min) / span) * hgt).toFixed(1)}`).join(" ");
  const col = v[v.length - 1] >= v[0] ? "#34d399" : "#fb7185";
  return `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" style="width:100%;height:160px" role="img" aria-label="${pt(lang, "chart.aria")}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <polygon fill="url(#g)" points="0,${hgt} ${line} ${w},${hgt}"/><polyline fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${line}"/></svg>`;
}

const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;background:#070a14;color:#f8fafc;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}
a{color:inherit}.wrap{max-width:960px;margin:0 auto;padding:16px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0 20px}
.logo{font-weight:900;font-size:18px;text-decoration:none}.logo span{color:#ffcb05}.card{background:rgba(15,23,42,.85);border:2px solid rgba(255,203,5,.35);border-radius:24px;padding:20px}
.grid{display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:24px}@media(max-width:640px){.grid{grid-template-columns:1fr}.img{max-width:240px;margin:0 auto}}
.img{width:100%;border-radius:14px;display:block}h1{font-size:26px;margin:0 0 4px;font-weight:900}.muted{color:#94a3b8;font-size:13px}.price{font-size:36px;font-weight:900;color:#34d399;margin:8px 0 0}
.up{color:#34d399;font-weight:800}.down{color:#fb7185;font-weight:800}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.stat{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:10px;font-size:12px}
.stat b{display:block;font-size:15px;color:#fff}.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.btn{display:inline-block;padding:11px 16px;border-radius:14px;font-weight:900;font-size:13px;text-decoration:none}
.y{background:#ffcb05;color:#0f172a}.g{background:#10b981;color:#0f172a}.s{background:#1e293b;color:#fff}h2{font-size:17px;margin:26px 0 10px;font-weight:900}
.list{display:grid;gap:8px}.row{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:10px 12px;font-size:13px}
.pill{font-size:11px;font-weight:900;border-radius:999px;padding:2px 8px}.deal{background:#10b981;color:#0f172a}.fair{background:#334155}.high{background:rgba(244,63,94,.3);color:#fecdd3}
footer{margin:32px 0 16px;font-size:12px;color:#64748b;text-align:center}`;

export function pageShell(o: {
  title: string; description: string; canonical: string; image?: string; body: string; jsonLd?: object | object[]; robots?: string;
  /** Seitensprache (Standard Deutsch) */
  lang?: Lang;
  /** Beide Sprachfassungen (Pfade) – erzeugt hreflang-Verweise und den Sprachwechsel im Kopf */
  alternates?: Alternates;
}) {
  const lang: Lang = o.lang === "en" ? "en" : "de";
  const t = (k: Parameters<typeof pt>[1]) => pt(lang, k);
  const home = lang === "en" ? withAppLang("en", "/") : "/";
  const other = o.alternates ? (lang === "en" ? o.alternates.de : o.alternates.en) : "";
  const switchLink = other ? `<a class="btn s" href="${h(other)}" hreflang="${lang === "en" ? "de" : "en"}" lang="${lang === "en" ? "de" : "en"}">${t("shell.switch")}</a>` : "";
  const appBtn = `<a class="btn y" href="${h(home)}">${t("shell.openApp")}</a>`;
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(o.title)}</title><meta name="description" content="${h(o.description)}"><link rel="canonical" href="${h(o.canonical)}">${o.robots ? `<meta name="robots" content="${h(o.robots)}">` : ""}${o.alternates ? hreflangTags(SITE(), o.alternates, h) : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="PokeSwipe & Radar"><meta property="og:locale" content="${OG_LOCALE[lang]}">${o.alternates ? `<meta property="og:locale:alternate" content="${OG_LOCALE[lang === "en" ? "de" : "en"]}">` : ""}
<meta property="og:title" content="${h(o.title)}"><meta property="og:description" content="${h(o.description)}"><meta property="og:url" content="${h(o.canonical)}">
${o.image ? `<meta property="og:image" content="${h(o.image)}"><meta name="twitter:image" content="${h(o.image)}">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#0b0f19"><link rel="icon" href="/icon.svg" type="image/svg+xml">
${(Array.isArray(o.jsonLd) ? o.jsonLd : o.jsonLd ? [o.jsonLd] : []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("")}
<style>${PAGE_CSS}</style></head><body><div class="wrap">
<div class="top"><a class="logo" href="${h(home)}">Poke<span>Swipe</span> &amp; Radar</a>${switchLink ? `<span class="btns" style="margin:0">${switchLink}${appBtn}</span>` : appBtn}</div>
${o.body}
<footer>${t("shell.footerNote")}<br><a href="/rechtliches#impressum">${t("shell.imprint")}</a> · <a href="/datenschutz">${t("shell.privacy")}</a> · <a href="/rechtliches#agb">${t("shell.terms")}</a> · <a href="/rechtliches#widerruf">${t("shell.withdrawal")}</a> · <a href="${localPath(lang, "/sets")}">${t("shell.allSets")}</a> · <a href="${localPath(lang, "/pokemon")}">${t("shell.pokemon")}</a> · <a href="${localPath(lang, "/sealed")}">${t("shell.sealed")}</a> · <a href="${localPath(lang, "/trends")}">${t("shell.trends")}</a> · <a href="/kuendigen"><b>${t("shell.cancel")}</b></a>${switchLink ? ` · <a href="${h(other)}" hreflang="${lang === "en" ? "de" : "en"}">${t("shell.switch")}</a>` : ""}</footer>
</div></body></html>`;
}

const fmtDay = (lang: Lang, iso: string) => fmtDate(lang, iso, { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const conditionName = (lang: Lang, k: string) => (lang === "en" ? CONDITIONS_EN[k] : CONDITIONS[k]) || "";

/** Tabelle „Preise nach Zustand“ und „Zuletzt auf PokeSwipe verkauft“ für die Kartenseite. */
export function conditionSection(cond: ConditionPrices | null, sales: Awaited<ReturnType<typeof recentMarketSales>>, lang: Lang = "de") {
  if (!cond || !cond.conditions.length) return "";
  const t = (k: Parameters<typeof pt>[1], v?: Record<string, string | number>) => pt(lang, k, v);
  const cell = (v: number | null) => (v ? h(euroL(lang, v)) : "–");
  const table = `<h2>${t("cond.title")}${cond.variants.length > 1 ? ` <span class="muted" style="font-weight:600">(${h(cond.variantLabel)})</span>` : ""}</h2>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="text-align:left;color:#94a3b8"><th style="padding:6px">${t("cond.colCondition")}</th><th style="padding:6px">${t("cond.colValue")}</th><th style="padding:6px">${t("cond.colSold")}</th><th style="padding:6px">${t("cond.colLast")}</th><th style="padding:6px">${t("cond.colAsks")}</th></tr></thead>
  <tbody>${cond.conditions.map((r) => `<tr style="border-top:1px solid #1e293b">
    <td style="padding:6px"><b>${h(r.short)}</b> <span class="muted">${h(conditionName(lang, r.condition))}</span></td>
    <td style="padding:6px"><b>${cell(r.value)}</b><br><span class="muted" style="font-size:11px">${h(SOURCE_NOTES[lang][r.valueSource] || "")}</span></td>
    <td style="padding:6px">${r.soldCount90 ? `${cell(r.soldMedian90)} <span class="muted">(${r.soldCount90}×)</span>` : "–"}</td>
    <td style="padding:6px">${r.lastSoldPrice && r.lastSoldAt ? `${cell(r.lastSoldPrice)} <span class="muted">${h(fmtDay(lang, r.lastSoldAt))}</span>` : "–"}</td>
    <td style="padding:6px">${r.askCount ? `${cell(r.askLow)} <span class="muted">(${r.askCount})</span>` : "–"}</td></tr>`).join("")}</tbody></table></div>
  <p class="muted" style="font-size:12px">${t("cond.note", { min: CONDITION_MIN_SALES })}</p>`;
  const recent = sales.length ? `<h2>${t("cond.recent")}</h2><div class="list">${sales.map((s) => `<div class="row"><span><b>${h(euroL(lang, s.price))}</b> <span class="muted">${s.condition ? `• ${h(s.condition.toUpperCase())} ` : ""}${s.variant !== "normal" ? `• ${h(s.variantLabel)} ` : ""}• ${h(s.lang.toUpperCase())}</span></span><span class="muted">${h(fmtDay(lang, s.soldAt))}</span></div>`).join("")}</div>` : "";
  return table + recent;
}

/** Englische Namen deutscher Katalogkarten (gleiche TCGdex-ID im englischen Druck „en:<id>“). */
export async function englishCardNames(ids: string[]): Promise<Map<string, { name: string; setName: string }>> {
  const out = new Map<string, { name: string; setName: string }>();
  const keys = [...new Set(ids.filter(Boolean))].map((id) => `en:${id}`);
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const list = await db.select({ id: cardPrints.id, name: cardPrints.name, setName: cardPrints.setName }).from(cardPrints)
      .where(inArray(cardPrints.id, chunk)).catch(() => []);
    for (const r of list) if (r.name) out.set(r.id.slice(3), { name: r.name, setName: r.setName || "" });
  }
  return out;
}

/** Englische Set-Namen (print_sets, Sprache en, gleiche Set-ID). */
export async function englishSetNames(ids: string[]): Promise<Map<string, { name: string; serieName: string }>> {
  const out = new Map<string, { name: string; serieName: string }>();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  const found = await db.select({ id: printSets.id, name: printSets.name, serieName: printSets.serieName }).from(printSets)
    .where(and(eq(printSets.lang, "en"), inArray(printSets.id, list))).catch(() => []);
  for (const r of found) if (r.name) out.set(r.id, { name: r.name, serieName: r.serieName || "" });
  return out;
}

async function cardPage(c: any) {
  const lang = langFromPath(c.req.path);
  const t = (k: Parameters<typeof pt>[1], v?: Record<string, string | number>) => pt(lang, k, v);
  const eur = (n: number) => euroL(lang, n);
  const lp = (p: string) => localPath(lang, p);
  const id = String(c.req.param("id") || "");
  const home = lang === "en" ? `${SITE()}/en/sets` : SITE();
  if (!CARD_ID_RE.test(id)) return c.html(pageShell({ lang, title: t("card.notFound"), description: "", canonical: home, body: `<div class="card"><h1>${t("card.notFound")}</h1></div>` }), 404);
  if (!(await rateLimit(`cardpage:${clientIp(c)}`, 40, 60_000))) return c.text(t("common.tooMany"), 429);
  const card = await getCard(id, 12 * 3600_000);
  if (!card) {
    return c.html(pageShell({ lang, title: `${t("card.notFound")} | PokeSwipe & Radar`, description: "", canonical: home,
      body: `<div class="card"><h1>${t("card.notFound")}</h1><p class="muted">${t("card.notFoundText")}</p><a class="btn y" href="${h(lp("/"))}">${t("card.toSearch")}</a></div>` }), 404);
  }
  // Englischer Druck derselben Karte (Name/Set-Name) – für englische Seite und hreflang-Slug
  const en = (await englishCardNames([card.id])).get(card.id);
  const name = displayName(lang, card.name, en?.name);
  const setName = displayName(lang, card.setName || "", en?.setName) || card.setName;
  const price = cardPrice(card);
  const facts = [card.types ? t("card.type", { t: h(card.types.split(",").map((x) => typeLabel(lang, x)).join(", ")) }) : "", card.hp ? t("card.hp", { n: Number(card.hp) }) : "", card.stage ? h(stageLabel(lang, card.stage)) : "",
    card.regulationMark ? t("card.regulation", { m: h(card.regulationMark) }) : ""].filter(Boolean);
  const species = card.dexId ? rows(await db.execute(sql`SELECT name_de, name_en, slug, card_count FROM pokemon_species WHERE dex_id = ${card.dexId} LIMIT 1`))[0] : null;
  const hist = await db.select({ day: priceHistory.day, trend: priceHistory.trend }).from(priceHistory)
    .where(eq(priceHistory.cardId, id)).orderBy(desc(priceHistory.day)).limit(90);
  const series = hist.reverse().map((x) => Number(x.trend));
  const offers = rows(await db.execute(sql`
    SELECT l.id, l.price::float AS price, l.shipping_cents, l.city, l.created_at, p.display_name, l.variant, l.condition, p.seller_type,
      (l.buy_now AND p.stripe_account_ready AND l.quantity - l.reserved > 0) AS buyable, greatest(l.quantity - l.reserved, 0) AS available
    FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.card_id = ${id} AND l.status = 'active' AND NOT p.banned
    ORDER BY (l.buy_now AND p.stripe_account_ready AND l.quantity - l.reserved > 0) DESC, (l.price * 100 + l.shipping_cents) ASC LIMIT 12
  `));
  const [wishers] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM wishlist_items WHERE card_id = ${id}`));
  const avg30 = Number(card.avg30 ?? 0);
  // Phase 6: Varianten-Preise (Reverse Holo eigene Cardmarket-Reihe, sonst Basispreis)
  const variantRows = availableVariants(card.variants).map((v) => {
    const vp = variantPrice(card, v);
    return { label: VARIANT_LABELS[v], price: vp.price, exact: vp.exact };
  });
  // Phase 8: Preise nach Zustand (eigene Verkäufe + Angebote + Referenz) und letzte Verkäufe auf PokeSwipe
  const cond = await conditionPricesForCard(id, undefined, card).catch(() => null);
  const sales = await recentMarketSales(id, 8).catch(() => []);
  const ch30 = price && avg30 ? ((price - avg30) / avg30) * 100 : null;
  const dePath = `/karte/${encodeURIComponent(card.id)}/${slugify(card.name)}`;
  const alternates = alternatesFor(dePath, `/karte/${encodeURIComponent(card.id)}/${slugify(en?.name || card.name)}`);
  const canonical = `${SITE()}${lang === "en" ? alternates.en : alternates.de}`;
  const priceText = price ? eur(price) : t("card.noPrice");
  const change = ch30 !== null ? fmtPct(lang, ch30, 1, true) : "";
  const title = t("card.title", { name, set: setName || card.id, price: price ? eur(price) : t("card.titlePriceFallback") });
  const description = t("card.desc", { name, set: setName || "Pokémon TCG", price: priceText, change: ch30 !== null ? t("card.descChange", { change }) : "" });
  const ogImage = card.image ? `${SITE()}${cdnImage(card.image.replace(/\/high\.webp$/, "/high.png"), 600, "jpg")}` : "";
  const appLink = (extra = "") => withAppLang(lang, `/?card=${encodeURIComponent(card.id)}${extra}`);
  const badge = (p: number) => {
    if (!price) return "";
    const r = p / price;
    return r < 0.85 ? `<span class="pill deal">${t("badge.deal")}</span>` : r <= 1.1 ? `<span class="pill fair">${t("badge.fair")}</span>` : `<span class="pill high">${t("badge.high")}</span>`;
  };
  const setSlug = slugify((lang === "en" && en?.setName) || card.setName || card.setId || "");
  const speciesName = species ? displayName(lang, species.name_de, species.name_en) : "";
  const speciesSlug = species ? (lang === "en" ? pokemonEnSlug(species.name_en, species.slug) : species.slug) : "";
  const body = `<div class="card"><div class="grid">
    <div>${card.image ? `<img class="img" src="${h(cdnImage(card.image, 520))}" alt="${h(t("card.imgAlt", { name }))}" width="260" height="362">` : ""}</div>
    <div>
      <h1>${h(name)}</h1>
      <p class="muted">${card.setId ? `<a href="${h(lp(`/set/${encodeURIComponent(card.setId)}/${setSlug}`))}">${h(setName)}</a>` : h(setName)}${card.localId ? t("card.number", { n: h(card.localId) }) : ""}${card.rarity ? ` • ${h(card.rarity)}` : ""}${card.illustrator ? t("card.illustrator", { n: h(card.illustrator) }) : ""}</p>
      <p class="price">${h(priceText)}</p>
      <p class="muted">${t("card.trend")}${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "up" : "down"}">${t("common.change30", { change })}</span>` : ""}</p>
      <div class="stats">
        <div class="stat">${t("card.avg7")}<b>${card.avg7 ? h(eur(Number(card.avg7))) : "–"}</b></div>
        <div class="stat">${t("card.avg30")}<b>${card.avg30 ? h(eur(Number(card.avg30))) : "–"}</b></div>
        <div class="stat">${t("card.from")}<b>${card.low ? h(eur(Number(card.low))) : "–"}</b></div>
      </div>
      ${variantRows.length > 1 ? `<h2 style="font-size:15px;margin:14px 0 6px">${t("card.variants")}</h2><div class="stats">${variantRows.map((v) =>
        `<div class="stat">${h(v.label)}<b>${v.price ? h(eur(v.price)) : "–"}</b>${v.exact ? "" : `<span class="muted" style="font-size:10px">${t("card.basePrice")}</span>`}</div>`).join("")}</div>
` : ""}
      ${chartSvg(series, 640, 160, lang)}
      <div class="btns">
        <a class="btn y" href="${h(appLink())}">${t("card.alert")}</a>
        <a class="btn g" href="${h(appLink("&wish=1"))}">${t("card.wish")}</a>
        <a class="btn s" href="${h(appLink("&list=1"))}">${t("card.list")}</a>
        <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`${name.replace(/-ex\b/, " ex")} ${card.id.split("-").pop()}`, "karte"))}" target="_blank" rel="noopener sponsored">${t("card.ebay")}</a>
        <a class="btn" style="background:#4f46e5;color:#fff" href="${h(cardmarketSearch(name, lang))}" target="_blank" rel="noopener sponsored">${t("common.cardmarket")}</a>
      </div>
      ${Number(wishers?.n) ? `<p class="muted" style="margin-top:10px">${t("card.wishers", { n: Number(wishers.n) })}</p>` : ""}
      ${facts.length ? `<p class="muted">${facts.join(" • ")}</p>` : ""}
      ${species ? `<p style="margin-top:10px"><a class="btn s" href="${h(lp(`/pokemon/${speciesSlug}`))}">${t("card.species", { n: Number(species.card_count), name: h(speciesName) })}</a></p>` : ""}
    </div></div></div>
  ${conditionSection(cond, sales, lang)}
  <h2>${t("card.buyTitle")}</h2>
  ${offers.length ? `<div class="list">${offers.map((o: any) => `<a class="row" href="${o.buyable ? h(withAppLang(lang, `/?buy=${Number(o.id)}`)) : h(appLink("&tab=map"))}" style="text-decoration:none">
      <span><b>${h(eur(o.price))}</b>${o.buyable ? ` <span class="muted">${t("card.shipping", { price: Number(o.shipping_cents) ? h(eur(Number(o.shipping_cents) / 100)) : t("card.freeShipping") })}</span>` : ""} <span class="muted">${o.variant && o.variant !== "normal" ? `• ${h(VARIANT_LABELS[normalizeVariant(o.variant)])} ` : ""}${o.condition ? `• ${h(String(o.condition).toUpperCase())} ` : ""}• ${h(o.display_name)} (${o.seller_type === "business" ? t("card.business") : t("card.private")})${Number(o.available) > 1 ? t("card.pieces", { n: Number(o.available) }) : ""}</span></span>
      ${o.buyable ? `<span class="pill fair">${t("card.addCart")}</span>` : badge(o.price)}</a>`).join("")}</div>
    <p class="muted" style="font-size:12px">${t("card.protection")}</p>`
    : `<p class="muted">${t("card.noOffers")}</p>`}`;
  const jsonLd: any = {
    "@context": "https://schema.org", "@type": "Product", name, sku: card.id,
    ...(card.rarity ? { additionalProperty: [{ "@type": "PropertyValue", name: t("card.ldRarity"), value: card.rarity }] } : {}),
    category: t("card.ldCategory"), brand: { "@type": "Brand", name: "Pokémon TCG" },
    ...(lang === "en" ? { url: canonical, inLanguage: "en" } : {}),
    ...(card.image ? { image: card.image } : {}),
    ...(offers.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "EUR", offerCount: offers.length,
      lowPrice: Math.min(...offers.map((o: any) => o.price)).toFixed(2), highPrice: Math.max(...offers.map((o: any) => o.price)).toFixed(2) } } : {}),
  };
  publicCache(c, "page");
  return c.html(pageShell({ lang, alternates, title, description, canonical, image: ogImage, body, jsonLd }));
}

// ---------------------------------------------------------------------------
// KI-Zustandscheck & CSV-Import
// ---------------------------------------------------------------------------
async function scansToday(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cardScans)
    .where(and(eq(cardScans.userId, userId), sql`${cardScans.createdAt} > now() - interval '1 day'`));
  return Number(r?.n ?? 0);
}

const lower = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/** Sucht zu einer CSV-Zeile die passende TCGdex-Karte (Name + Nummer, optional Set-Name). */
async function matchRow(row: { name: string; number: string; set: string }, cache: Map<string, any[]>) {
  const key = lower(row.name);
  if (!cache.has(key)) {
    let list = await searchTcgdex("de", row.name);
    if (!list.length) list = await searchTcgdex("en", row.name);
    cache.set(key, list);
  }
  const list = cache.get(key)!;
  if (!list.length) return null;
  const num = normNum(row.number.split("/")[0]);
  let cands = num ? list.filter((x: any) => normNum(x.localId) === num) : [];
  if (!cands.length) return list.length === 1 ? list[0] : null;
  if (cands.length > 1 && row.set) {
    const want = lower(row.set);
    const withSets = await Promise.all(cands.slice(0, 8).map(async (x: any) => {
      const set = await fetchSet(String(x.id).split("-").slice(0, -1).join("-"));
      const name = lower(String(set?.name || ""));
      return { x, ok: name && (name.includes(want) || want.includes(name) || lower(String(set?.id || "")) === want) };
    }));
    const hit = withSets.filter((s) => s.ok).map((s) => s.x);
    if (hit.length) cands = hit;
  }
  return cands[0];
}

// ---------------------------------------------------------------------------
// Geplante Aufgaben: Erinnerungen & Wochen-Report
// ---------------------------------------------------------------------------
export async function runGrowthJobs({ deadlineMs = 20_000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "numeric", hourCycle: "h23" }).format(now));
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short" }).format(now);
  let reminders = 0, reports = 0;

  // 1. Kalender-Erinnerungen ab 8 Uhr für alles, was heute oder morgen stattfindet
  if (hour >= 8) {
    const today = berlinDay(now);
    const tomorrow = berlinDay(new Date(now.getTime() + 86400_000));
    const due = await db.select().from(calendarEvents).where(and(
      eq(calendarEvents.status, "active"), eq(calendarEvents.remindersSent, false),
      sql`${calendarEvents.day} BETWEEN ${today}::date AND ${tomorrow}::date`,
    )).limit(30);
    for (const ev of due) {
      if (Date.now() > deadline) break;
      const [claimed] = await db.update(calendarEvents).set({ remindersSent: true })
        .where(and(eq(calendarEvents.id, ev.id), eq(calendarEvents.remindersSent, false))).returning();
      if (!claimed) continue;
      const subs = await db.select({ userId: calendarReminders.userId }).from(calendarReminders).where(eq(calendarReminders.eventId, ev.id)).limit(2000);
      const when = String(ev.day) === today ? "heute" : "morgen";
      for (const s of subs) {
        await notify(s.userId, `${ev.kind === "release" ? "📦 Release" : "📅 Event"} ${when}: ${ev.title}`,
          `${ev.city ? ev.city + " • " : ""}${ev.description}`.slice(0, 200), "/?tab=community&sub=calendar");
        reminders++;
      }
    }
  }

  // 2. Wochen-Report montags ab 8 Uhr (in Etappen, falls es viele Nutzer sind)
  if (weekday === "Mon" && hour >= 8) {
    const [deals] = rows(await db.execute(sql`
      SELECT count(*)::int AS n FROM listings l JOIN cards c ON c.id = l.card_id
      WHERE l.status = 'active' AND l.created_at > now() - interval '7 days' AND l.price < 0.85 * COALESCE(c.trend, c.avg)
    `));
    const users = rows(await db.execute(sql`
      SELECT p.user_id FROM profiles p
      WHERE p.weekly_report AND NOT p.banned
        AND (p.last_weekly_report IS NULL OR p.last_weekly_report < now() - interval '6 days')
        AND EXISTS (SELECT 1 FROM portfolio_items i WHERE i.user_id = p.user_id)
      LIMIT 200
    `));
    for (const u of users) {
      if (Date.now() > deadline) break;
      const [snap] = rows(await db.execute(sql`
        SELECT
          (SELECT value::float FROM portfolio_snapshots WHERE user_id = ${u.user_id} ORDER BY day DESC LIMIT 1) AS now_value,
          (SELECT value::float FROM portfolio_snapshots WHERE user_id = ${u.user_id} AND day <= CURRENT_DATE - 7 ORDER BY day DESC LIMIT 1) AS week_value
      `));
      const [top] = rows(await db.execute(sql`
        SELECT c.name, ((COALESCE(c.trend, c.avg) - h.trend) / h.trend * 100)::float AS change
        FROM portfolio_items i JOIN cards c ON c.id = i.card_id
        JOIN LATERAL (SELECT trend FROM price_history WHERE card_id = c.id AND day <= CURRENT_DATE - 7 AND trend > 0 ORDER BY day DESC LIMIT 1) h ON true
        WHERE i.user_id = ${u.user_id} AND COALESCE(c.trend, c.avg) > 0
        ORDER BY abs((COALESCE(c.trend, c.avg) - h.trend) / h.trend) DESC LIMIT 1
      `));
      let text = weeklySummary({ value: Number(snap?.now_value ?? 0), valueWeekAgo: snap?.week_value ?? null, top: top ? { name: top.name, change: Number(top.change) } : null });
      if (Number(deals?.n)) text += ` ${deals.n} neue Top-Deals im Tausch-Hub.`;
      await notify(u.user_id, "📊 Dein Wochen-Report", text, "/?tab=portfolio");
      await db.update(profiles).set({ lastWeeklyReport: new Date() }).where(eq(profiles.userId, u.user_id));
      reports++;
    }
  }
  return { reminders, reports };
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerGrowth(app: any, hlp: {
  auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>>; ratingOf: (id: string) => Promise<{ avg: number; count: number }>;
}) {
  const { auth, adminOnly, body } = hlp;
  const idParam = (c: any) => int(c.req.param("id"), 1, 2 ** 31 - 1, 0);

  // ------------------------------ Wunschliste ------------------------------
  app.get("/api/wishlist", auth, async (c: any) => {
    const userId = c.get("user").id;
    const items = await db.select({
      id: wishlistItems.id, cardId: wishlistItems.cardId, maxPrice: wishlistItems.maxPrice, createdAt: wishlistItems.createdAt,
      variant: wishlistItems.variant, name: cards.name, image: cards.image, setName: cards.setName, trend: cards.trend, avg: cards.avg, low: cards.low,
    }).from(wishlistItems).innerJoin(cards, eq(cards.id, wishlistItems.cardId))
      .where(eq(wishlistItems.userId, userId)).orderBy(desc(wishlistItems.createdAt));
    const offers = rows(await db.execute(sql`
      SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.city, l.user_id, p.display_name AS seller,
        (p.plan = 'pro' AND p.plan_until > now()) AS verified
      FROM listings l JOIN profiles p ON p.user_id = l.user_id
      JOIN wishlist_items w ON w.card_id = l.card_id AND w.user_id = ${userId}
      WHERE l.status = 'active' AND NOT p.banned AND l.user_id <> ${userId} AND (w.variant = '' OR w.variant = l.variant)
        AND (w.max_price IS NULL OR l.price <= w.max_price * 1.15)
      ORDER BY l.price ASC LIMIT 60
    `));
    // Tausch-Partner: Wer sucht Karten, die ich besitze – und bietet idealerweise etwas von meiner Wunschliste an?
    const partners = rows(await db.execute(sql`
      WITH owned AS (SELECT DISTINCT card_id FROM portfolio_items WHERE user_id = ${userId} AND card_id IS NOT NULL),
      wanted AS (SELECT card_id FROM wishlist_items WHERE user_id = ${userId}),
      they_want AS (
        SELECT w.user_id, array_agg(DISTINCT c.name) AS cards FROM wishlist_items w JOIN cards c ON c.id = w.card_id
        WHERE w.card_id IN (SELECT card_id FROM owned) AND w.user_id <> ${userId} GROUP BY w.user_id
      ),
      they_offer AS (
        SELECT l.user_id, array_agg(DISTINCT l.card_name) AS cards, min(l.id) AS listing_id FROM listings l
        WHERE l.status = 'active' AND l.card_id IN (SELECT card_id FROM wanted) AND l.user_id <> ${userId} GROUP BY l.user_id
      )
      SELECT COALESCE(tw.user_id, tof.user_id) AS user_id, p.display_name, p.city,
        COALESCE(tw.cards, '{}') AS they_want, COALESCE(tof.cards, '{}') AS they_offer, tof.listing_id,
        (tw.user_id IS NOT NULL AND tof.user_id IS NOT NULL) AS perfect
      FROM they_want tw FULL OUTER JOIN they_offer tof ON tof.user_id = tw.user_id
      JOIN profiles p ON p.user_id = COALESCE(tw.user_id, tof.user_id)
      WHERE NOT p.banned AND tw.user_id IS NOT NULL
      ORDER BY perfect DESC, cardinality(COALESCE(tw.cards, '{}')) DESC LIMIT 20
    `));
    return c.json({
      items: items.map((i) => ({ ...i, price: cardPrice(i) })),
      offers, partners, limit: PLANS[c.get("plan") as PlanId].wishlist,
    });
  });

  app.post("/api/wishlist", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    const b = await body(c);
    const cardId = str(b.cardId, 40);
    if (!CARD_ID_RE.test(cardId)) return c.json({ error: "Ungültige Karte" }, 400);
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(wishlistItems).where(eq(wishlistItems.userId, user.id));
    if (Number(r?.n ?? 0) >= PLANS[plan].wishlist) {
      return c.json({ error: `Limit erreicht: ${PLANS[plan].wishlist} Karten auf der Wunschliste im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    const card = await getCard(cardId);
    if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
    const maxPrice = b.maxPrice === null || b.maxPrice === "" || b.maxPrice === undefined ? null : money(b.maxPrice);
    // Phase 6: gewünschte Variante ("" = jede Variante)
    const variant = b.variant === undefined || b.variant === null || b.variant === "" ? "" : parseVariant(b.variant);
    if (variant === null) return c.json({ error: "Unbekannte Kartenvariante." }, 400);
    const [item] = await db.insert(wishlistItems).values({ userId: user.id, cardId: card.id, maxPrice, variant })
      .onConflictDoUpdate({ target: [wishlistItems.userId, wishlistItems.cardId], set: { maxPrice, variant } }).returning();
    const matches = await checkMatchesAfterWishlist(user.id, card.id);
    // Gibt es schon passende Angebote?
    const [offer] = rows(await db.execute(sql`
      SELECT count(*)::int AS n, min(price)::float AS min FROM listings
      WHERE card_id = ${card.id} AND status = 'active' AND user_id <> ${user.id} AND (${maxPrice}::numeric IS NULL OR price <= ${maxPrice}::numeric)
    `));
    return c.json({ item, offers: Number(offer?.n ?? 0), minPrice: offer?.min ?? null, matches }, 201);
  });

  app.delete("/api/wishlist/:id", auth, async (c: any) => {
    await db.delete(wishlistItems).where(and(eq(wishlistItems.id, idParam(c)), eq(wishlistItems.userId, c.get("user").id)));
    return c.json({ ok: true });
  });

  // ------------------------- Tägliche Serie & Abzeichen --------------------
  app.post("/api/daily/checkin", auth, async (c: any) => {
    let profile: Profile = c.get("profile");
    const today = berlinDay();
    const last = profile.lastCheckin ? String(profile.lastCheckin) : null;
    const next = nextStreak(last, profile.streak, today);
    if (next.changed) {
      const best = Math.max(profile.bestStreak, next.streak);
      const [u] = await db.update(profiles).set({ streak: next.streak, bestStreak: best, lastCheckin: today })
        .where(and(eq(profiles.userId, profile.userId), sql`${profiles.lastCheckin} IS DISTINCT FROM ${today}::date`)).returning();
      if (u) profile = u;
    }
    const badges = next.changed ? await refreshBadges(profile) : { all: [], fresh: [] };
    return c.json({ streak: profile.streak, bestStreak: profile.bestStreak, firstToday: next.changed, newBadges: badges.fresh });
  });

  app.get("/api/badges", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    const { all } = await refreshBadges(profile);
    const stats = await badgeStats(profile.userId, profile.bestStreak);
    return c.json({
      badges: BADGES.map(({ test, ...b }) => ({ ...b, earned: all.includes(b.id) })),
      streak: profile.streak, bestStreak: profile.bestStreak, stats,
      leaderboardOptIn: profile.leaderboardOptIn, weeklyReport: profile.weeklyReport,
    });
  });

  app.post("/api/me/preferences", auth, async (c: any) => {
    const b = await body(c);
    const updates: Partial<Profile> = {};
    if (typeof b.leaderboardOptIn === "boolean") updates.leaderboardOptIn = b.leaderboardOptIn;
    if (typeof b.weeklyReport === "boolean") updates.weeklyReport = b.weeklyReport;
    if (!Object.keys(updates).length) return c.json({ error: "Nichts zu ändern." }, 400);
    await db.update(profiles).set(updates).where(eq(profiles.userId, c.get("user").id));
    return c.json({ ok: true, ...updates });
  });

  // ------------------------------ Bestenliste ------------------------------
  app.get("/api/leaderboard", async (c: any) => {
    const type = ["value", "trades", "streak"].includes(c.req.query("type")) ? c.req.query("type") : "value";
    const query = type === "value"
      ? sql`SELECT p.display_name, p.city, s.value::float AS score FROM profiles p
          JOIN LATERAL (SELECT value FROM portfolio_snapshots WHERE user_id = p.user_id ORDER BY day DESC LIMIT 1) s ON true
          WHERE p.leaderboard_opt_in AND NOT p.banned AND s.value > 0 ORDER BY s.value DESC LIMIT 50`
      : type === "trades"
        ? sql`SELECT p.display_name, p.city, t.n::float AS score FROM profiles p
            JOIN LATERAL (SELECT count(*) AS n FROM trades WHERE status = 'completed' AND (from_user = p.user_id OR to_user = p.user_id)) t ON true
            WHERE p.leaderboard_opt_in AND NOT p.banned AND t.n > 0 ORDER BY t.n DESC LIMIT 50`
        : sql`SELECT p.display_name, p.city, p.best_streak::float AS score FROM profiles p
            WHERE p.leaderboard_opt_in AND NOT p.banned AND p.best_streak > 0 ORDER BY p.best_streak DESC LIMIT 50`;
    publicCache(c, "data", { sMaxAge: 120, swr: 600, varyQuery: ["type"] });
    return c.json({ type, entries: rows(await db.execute(query)) });
  });

  // ------------------------------- Kalender --------------------------------
  app.get("/api/calendar", async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT e.id, e.kind, e.title, e.day::text AS day, e.city, e.url, e.description, e.created_by,
        p.display_name AS author, (SELECT count(*)::int FROM calendar_reminders r WHERE r.event_id = e.id) AS interested
      FROM calendar_events e LEFT JOIN profiles p ON p.user_id = e.created_by
      WHERE e.status = 'active' AND e.day >= CURRENT_DATE - 1
      ORDER BY e.day ASC, e.id ASC LIMIT 120
    `));
    const u = await verifyIdentityToken(c);
    const mine = u ? (await db.select({ eventId: calendarReminders.eventId }).from(calendarReminders).where(eq(calendarReminders.userId, u.id))).map((r) => r.eventId) : [];
    return c.json({ events: list.map((e: any) => ({ ...e, reminded: mine.includes(e.id), mine: Boolean(u && e.created_by === u.id), created_by: undefined })) });
  });

  app.post("/api/calendar", auth, async (c: any) => {
    const user = c.get("user");
    const b = await body(c);
    const kind = b.kind === "release" ? "release" : "event";
    if (kind === "release" && !isAdmin(user)) return c.json({ error: "Releases trägt das Team ein." }, 403);
    if (!(await rateLimit(`event:${user.id}`, 5, 3600_000))) return c.json({ error: "Bitte später weitere Events eintragen." }, 429);
    const title = str(b.title, 120);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || "")) ? String(b.day) : "";
    const t = day ? Date.parse(`${day}T12:00:00Z`) : NaN;
    if (title.length < 3 || !Number.isFinite(t) || t < Date.now() - 86400_000 || t > Date.now() + 730 * 86400_000) {
      return c.json({ error: "Bitte Titel und ein Datum in der Zukunft angeben." }, 400);
    }
    let url = str(b.url, 300);
    try { if (url && new URL(url).protocol !== "https:") url = ""; } catch { url = ""; }
    const [ev] = await db.insert(calendarEvents).values({
      kind, title, day, city: str(b.city, 60), url, description: str(b.description, 500), createdBy: user.id,
    }).returning();
    await db.insert(calendarReminders).values({ userId: user.id, eventId: ev.id }).onConflictDoNothing();
    return c.json(ev, 201);
  });

  app.delete("/api/calendar/:id", auth, async (c: any) => {
    const user = c.get("user");
    const owner = isAdmin(user) ? sql`true` : eq(calendarEvents.createdBy, user.id);
    const [ev] = await db.update(calendarEvents).set({ status: "removed" }).where(and(eq(calendarEvents.id, idParam(c)), owner)).returning();
    if (!ev) return c.json({ error: "Nicht gefunden" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/calendar/:id/remind", auth, async (c: any) => {
    const userId = c.get("user").id, id = idParam(c);
    const [ev] = await db.select({ id: calendarEvents.id }).from(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.status, "active"))).limit(1);
    if (!ev) return c.json({ error: "Nicht gefunden" }, 404);
    const removed = await db.delete(calendarReminders).where(and(eq(calendarReminders.userId, userId), eq(calendarReminders.eventId, id))).returning();
    if (removed.length) return c.json({ reminded: false });
    await db.insert(calendarReminders).values({ userId, eventId: id }).onConflictDoNothing();
    return c.json({ reminded: true });
  });

  // ---------------------------- Shop-Statistik -----------------------------
  app.post("/api/listings/:id/view", async (c: any) => {
    const id = idParam(c);
    if (!id || !(await rateLimit(`lview:${clientIp(c)}:${id}`, 1, 30 * 60_000))) return c.json({ ok: true });
    const [l] = await db.select({ userId: listings.userId }).from(listings).where(eq(listings.id, id)).limit(1);
    const viewer = await verifyIdentityToken(c);
    if (l && viewer?.id !== l.userId) {
      await db.execute(sql`
        INSERT INTO shop_stats (user_id, day, listing_views) VALUES (${l.userId}, CURRENT_DATE, 1)
        ON CONFLICT (user_id, day) DO UPDATE SET listing_views = shop_stats.listing_views + 1
      `);
    }
    return c.json({ ok: true });
  });

  app.get("/api/shop/stats", auth, async (c: any) => {
    const userId = c.get("user").id;
    if (!PLANS[c.get("plan") as PlanId].shop) return c.json({ error: "Shop-Statistiken sind im Pro-Trader-Tarif enthalten.", upgrade: true }, 402);
    const days = rows(await db.execute(sql`
      SELECT d::date::text AS day, COALESCE(s.views, 0)::int AS views, COALESCE(s.listing_views, 0)::int AS listing_views,
        (SELECT count(*)::int FROM trades t WHERE t.to_user = ${userId} AND t.created_at::date = d::date) AS requests
      FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d
      LEFT JOIN shop_stats s ON s.user_id = ${userId} AND s.day = d::date ORDER BY d
    `));
    const top = rows(await db.execute(sql`
      SELECT l.id, l.card_name, l.price::float AS price, l.status, count(t.id)::int AS requests,
        count(t.id) FILTER (WHERE t.status = 'completed')::int AS completed
      FROM listings l LEFT JOIN trades t ON t.listing_id = l.id AND t.created_at > now() - interval '30 days'
      WHERE l.user_id = ${userId} AND l.created_at > now() - interval '120 days'
      GROUP BY l.id ORDER BY requests DESC, l.created_at DESC LIMIT 10
    `));
    const sum = (k: string) => days.reduce((a: number, d: any) => a + Number(d[k] || 0), 0);
    const [sold] = rows(await db.execute(sql`
      SELECT count(*)::int AS n FROM trades WHERE to_user = ${userId} AND status = 'completed' AND updated_at > now() - interval '30 days'
    `));
    return c.json({ days, top, totals: { views: sum("views"), listingViews: sum("listing_views"), requests: sum("requests"), completed: Number(sold?.n ?? 0) } });
  });

  // ------------------------------ CSV-Import -------------------------------
  app.post("/api/portfolio/import-rows", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    if (!(await rateLimit(`import:${user.id}`, 30, 600_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const b = await body(c);
    const input = (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map((r: any) => ({
      name: str(r?.name, 120), number: str(r?.number, 16), set: str(r?.set, 120),
      quantity: int(r?.quantity, 1, 999, 1), purchasePrice: money(r?.purchasePrice),
      variant: normalizeVariant(r?.variant), condition: normalizeCondition(r?.condition),
      lang: ["de", "en", "ja"].includes(String(r?.lang)) ? String(r.lang) : "de",
    })).filter((r: any) => r.name);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems).where(eq(portfolioItems.userId, user.id));
    const room = Math.max(0, PLANS[plan].portfolio - Number(cnt?.n ?? 0));
    const todo = input.slice(0, room);
    const cache = new Map<string, any[]>();
    const done = new Set<number>();
    let matched = 0;
    const unmatched: string[] = [];
    await pool(todo.map((r: any, i: number) => ({ r, i })), 4, async ({ r, i }: any) => {
      const hit = await matchRow(r, cache);
      const card = hit ? await getCard(String(hit.id)) : null;
      await db.insert(portfolioItems).values({
        userId: user.id, cardId: card?.id ?? null, name: card?.name || r.name, image: card?.image || "",
        quantity: r.quantity, purchasePrice: r.purchasePrice, variant: r.variant, condition: r.condition, lang: r.lang,
      });
      if (card) matched++; else unmatched.push(r.name);
      done.add(i);
    }, Date.now() + 17_000);
    const retry = todo.filter((_: any, i: number) => !done.has(i));
    return c.json({ imported: done.size, matched, unmatched: unmatched.slice(0, 50), retry, overLimit: input.length - todo.length });
  });

  // ------------------------- Wechsel-Bonus (Umzug aus einer anderen App) -------------------------
  // Einmalig pro Konto: Wer mindestens SWITCH_MIN_CARDS erkannte Karten importiert hat, bekommt
  // SWITCH_BONUS_DAYS Tage Premium (über bonusUntil, wie beim Empfehlungsprogramm).
  app.post("/api/switch-bonus", auth, async (c: any) => {
    const user = c.get("user"), profile = c.get("profile");
    if (profile.switchBonusAt) return c.json({ error: "Der Wechsel-Bonus wurde für dieses Konto schon eingelöst.", used: true }, 409);
    if (profile.stripeSubscriptionId) return c.json({ error: "Der Wechsel-Bonus gilt nur für neue Konten ohne Abo." }, 409);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioItems)
      .where(and(eq(portfolioItems.userId, user.id), sql`${portfolioItems.cardId} IS NOT NULL`));
    const n = Number(cnt?.n ?? 0);
    if (n < SWITCH_MIN_CARDS) {
      return c.json({ error: `Für den Wechsel-Bonus brauchst du mindestens ${SWITCH_MIN_CARDS} importierte Karten mit Live-Preis (aktuell ${n}).`, missing: SWITCH_MIN_CARDS - n }, 400);
    }
    const base = profile.bonusUntil && profile.bonusUntil.getTime() > Date.now() ? profile.bonusUntil.getTime() : Date.now();
    const bonusUntil = new Date(base + SWITCH_BONUS_DAYS * 86400_000);
    const [updated] = await db.update(profiles).set({ bonusUntil, switchBonusAt: new Date() })
      .where(and(eq(profiles.userId, user.id), isNull(profiles.switchBonusAt))).returning({ id: profiles.userId });
    if (!updated) return c.json({ error: "Der Wechsel-Bonus wurde für dieses Konto schon eingelöst.", used: true }, 409);
    return c.json({ ok: true, bonusUntil, days: SWITCH_BONUS_DAYS });
  });

  // ------------------------- KI-Zustandscheck (Grading) --------------------
  app.post("/api/scan/condition", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    if (!(await rateLimit(`scan:${user.id}`, 6, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const limit = await scanLimit(user.id, plan);
    const limitMsg = `Tageslimit erreicht: ${limit} Scans heute (Tarif ${PLANS[plan].label}${limit > PLANS[plan].scansPerDay ? " + Teilen-Bonus" : ""}). Tipp: Teile eine Karte – jeder neue Besucher bringt dir heute +1 Scan.`;
    if ((await scansToday(user.id)) >= limit) {
      return c.json({ error: limitMsg, upgrade: true, shareBonus: true }, 402);
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((await body(c)).image || ""));
    if (!m || m[2].length > 2_000_000) return c.json({ error: "Bitte ein Foto (JPG/PNG, max. ca. 1,5 MB) aufnehmen." }, 400);
    const reservation = await reserveScan(user.id, limit);
    if (!reservation) {
      return c.json({ error: limitMsg, upgrade: true, shareBonus: true }, 402);
    }
    const ai = new Anthropic();
    const msg = await ai.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
          { type: "text", text: 'Du prüfst den Zustand einer Pokémon-Sammelkarte auf einem Foto (Vorderseite) für eine Grading-Einschätzung. Antworte NUR mit JSON: {"isCard": true|false, "centeringLR": "z. B. 55/45", "centeringTB": "z. B. 50/50", "corners": 1-10, "edges": 1-10, "surface": 1-10, "gradeLow": 1-10, "gradeHigh": 1-10, "issues": ["kurze deutsche Stichpunkte"], "photoQuality": "gut|mittel|schlecht"}. Sei eher streng. Wenn das Foto unscharf ist, sag es in issues.' },
        ],
      }],
    }).catch(async (e: unknown) => {
      // Fehlgeschlagener KI-Aufruf verbraucht keinen Scan
      await db.delete(cardScans).where(eq(cardScans.id, reservation)).catch(() => {});
      throw e;
    });
    const text = msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
    let r: any = {};
    try { r = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
    await db.update(cardScans).set({ result: `Zustand ${str(r.gradeLow, 4) || "?"}-${str(r.gradeHigh, 4) || "?"}` }).where(eq(cardScans.id, reservation));
    if (!r.isCard) return c.json({ ok: false, message: "Keine Karte erkannt. Bitte die Vorderseite gerade, hell und formatfüllend fotografieren." });
    const n = (v: unknown) => int(v, 1, 10, 0) || null;
    return c.json({
      ok: true,
      centeringLR: str(r.centeringLR, 10), centeringTB: str(r.centeringTB, 10),
      corners: n(r.corners), edges: n(r.edges), surface: n(r.surface), gradeLow: n(r.gradeLow), gradeHigh: n(r.gradeHigh),
      issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 6).map((x: unknown) => str(x, 140)).filter(Boolean),
      photoQuality: str(r.photoQuality, 10),
    });
  });

  /** DSGVO-Auskunft: alle eigenen Daten als JSON-Datei. */
  app.get("/api/me/export", auth, async (c: any) => {
    const userId = c.get("user").id, profile: Profile = c.get("profile");
    if (!(await rateLimit(`export:${userId}`, 5, 3600_000))) return c.json({ error: "Bitte später erneut versuchen." }, 429);
    const { stripeCustomerId, stripeSubscriptionId, ...p } = profile;
    const data = {
      exportedAt: new Date().toISOString(),
      profile: { ...p, payments: Boolean(stripeCustomerId) ? "über Stripe (Rechnungen im Stripe-Kundenportal bzw. per E-Mail)" : "keine" },
      portfolio: await db.select().from(portfolioItems).where(eq(portfolioItems.userId, userId)),
      wishlist: await db.select().from(wishlistItems).where(eq(wishlistItems.userId, userId)),
      priceAlerts: await db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId)),
      sealedAlerts: await db.select().from(sealedAlerts).where(eq(sealedAlerts.userId, userId)),
      trackedSets: await db.select().from(trackedSets).where(eq(trackedSets.userId, userId)),
      listings: await db.select().from(listings).where(eq(listings.userId, userId)),
      trades: rows(await db.execute(sql`SELECT * FROM trades WHERE from_user = ${userId} OR to_user = ${userId}`)),
      tradeMessages: await db.select().from(tradeMessages).where(eq(tradeMessages.userId, userId)),
      reviewsWritten: await db.select().from(reviews).where(eq(reviews.reviewerId, userId)),
      reviewsReceived: await db.select().from(reviews).where(eq(reviews.revieweeId, userId)),
      badges: await db.select().from(userBadges).where(eq(userBadges.userId, userId)),
      calendar: await db.select().from(calendarEvents).where(eq(calendarEvents.createdBy, userId)),
      gradedCards: rows(await db.execute(sql`SELECT * FROM graded_cards WHERE user_id = ${userId}`)),
      gradingSubmissions: rows(await db.execute(sql`SELECT * FROM grading_submissions WHERE user_id = ${userId}`)),
      restockAlerts: rows(await db.execute(sql`SELECT * FROM restock_subscriptions WHERE user_id = ${userId}`)),
      restockReports: rows(await db.execute(sql`SELECT id, title, shop, url, city, price, status, created_at FROM restock_drops WHERE reported_by = ${userId}`)),
      notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(500),
      // Phase 4: Community, Follower, Blockierungen, Marktplatz-Bestellungen
      communityPosts: rows(await db.execute(sql`SELECT id, caption, image, card_id, status, like_count, comment_count, created_at FROM community_posts WHERE user_id = ${userId}`)),
      communityComments: rows(await db.execute(sql`SELECT id, post_id, body, status, created_at FROM community_comments WHERE user_id = ${userId}`)),
      chatMessages: rows(await db.execute(sql`SELECT id, body, status, created_at FROM chat_messages WHERE user_id = ${userId} ORDER BY id DESC LIMIT 2000`)),
      likes: rows(await db.execute(sql`SELECT post_id, created_at FROM community_likes WHERE user_id = ${userId}`)),
      following: rows(await db.execute(sql`SELECT p.display_name, f.created_at FROM follows f JOIN profiles p ON p.user_id = f.followee_id WHERE f.follower_id = ${userId}`)),
      followersCount: Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE followee_id = ${userId}`))[0]?.n ?? 0),
      blocked: rows(await db.execute(sql`SELECT p.display_name, b.created_at FROM user_blocks b JOIN profiles p ON p.user_id = b.blocked_id WHERE b.blocker_id = ${userId}`)),
      marketOrders: rows(await db.execute(sql`SELECT id, listing_id, title, status, price_cents, shipping_cents, fee_cents, carrier, tracking_number, dispute_reason, paid_at, shipped_at, released_at, created_at,
        CASE WHEN buyer_id = ${userId} THEN 'buyer' ELSE 'seller' END AS role,
        CASE WHEN buyer_id = ${userId} THEN shipping_address END AS my_shipping_address
        FROM market_orders WHERE buyer_id = ${userId} OR seller_id = ${userId}`)),
    };
    return c.body(JSON.stringify(data, null, 2), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pokeswipe-meine-daten.json"',
    });
  });

  // ------------- Live-Preise für den Karten-Katalog der Startseite ----------
  app.get("/api/prices", async (c: any) => {
    const ids = [...new Set(String(c.req.query("ids") || "").split(",").map((x) => x.trim()).filter((x) => CARD_ID_RE.test(x)))].slice(0, 40);
    if (!ids.length) return c.json({ prices: {} });
    if (!(await rateLimit(`prices:${clientIp(c)}`, 20, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const prices: Record<string, { trend: number | null; low: number | null; avg30: number | null; updated: string | null }> = {};
    await pool(ids, 4, async (id: string) => {
      const card = await getCard(id, 6 * 3600_000);
      if (!card) return;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      prices[id] = { trend: n(card.trend ?? card.avg), low: n(card.low), avg30: n(card.avg30), updated: card.priceUpdatedAt ? new Date(card.priceUpdatedAt).toISOString() : null };
    }, Date.now() + 15_000);
    // Nur Karten-IDs aus der Abfrage bestimmen das Ergebnis – kein Nutzerbezug
    publicCache(c, "data", { sMaxAge: 900, swr: 86_400, varyQuery: ["ids"] });
    return c.json({ prices });
  });

  // ------------------------- Öffentliche Seiten (SEO) ----------------------
  app.get("/karte/:id/:slug?", cardPage);
  // Englische Fassung (gleicher Renderer, Sprache aus dem Pfad) und /en → App auf Englisch
  app.get("/en/card/:id/:slug?", cardPage);
  app.get("/en", (c: any) => c.redirect("/?lang=en", 302));
  app.get("/en/", (c: any) => c.redirect("/?lang=en", 302));

  // Manueller Start der Hintergrund-Aufgaben für Admins (Test)
  app.post("/api/admin/run-growth", auth, adminOnly, async (c: any) => c.json(await runGrowthJobs({ deadlineMs: 15_000 })));
}
