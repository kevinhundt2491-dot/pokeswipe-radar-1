// PokeSwipe & Radar – Phase 5: Händler-Shops für Pro Trader.
//
// • /shop/<name>            öffentliche, server-gerenderte Shop-Seite (Banner, Logo, ✔-Badge, Antwortzeit, Bewertungen,
//                           Live-Inventar mit 🇩🇪/🇬🇧/🇯🇵-Filter, Shop-Kennzahlen) mit OpenGraph-/Twitter-Vorschau und JSON-LD
// • /api/og/shop/<name>.jpg dynamisches Vorschaubild (Kartenfächer der wertvollsten Angebote in der Shop-Farbe)
// • /api/shops, /api/shops/<name>  Daten für die App (der Shop-Dialog lädt das Inventar alle 30 Sekunden neu)
// • PUT /api/shop/branding  Banner, Logo und Akzentfarbe (nur Pro Trader)
import { eq, sql } from "drizzle-orm";
import { db, profiles } from "../db/index.ts";
import { verifyIdentityToken } from "./auth.ts";
import { PLANS, effectivePlan, type PlanId } from "./plans.ts";
import { SITE, h, cdnImage, pageShell, recordShopView } from "./growth.ts";
import { ogJpeg, imgKey } from "./profiles.ts";
import { blockedIds } from "./community.ts";
import { str, rows, rateLimit, clientIp, euro } from "./util.ts";

type Hlp = {
  auth: any; body: (c: any) => Promise<Record<string, any>>;
  storeDataUrlImage: (d: unknown, userId: string) => Promise<string>;
  ratingOf: (userId: string) => Promise<{ avg: number; count: number }>;
};

export const SHOP_ACCENTS: Record<string, [number, number, number]> = {
  "#22d3ee": [34, 211, 238], "#facc15": [250, 204, 21], "#f472b6": [244, 114, 182], "#a78bfa": [167, 139, 250],
  "#34d399": [52, 211, 153], "#fb923c": [251, 146, 60], "#f87171": [248, 113, 113], "#60a5fa": [96, 165, 250],
};
const DEFAULT_ACCENT = "#22d3ee";
const LANGS = ["de", "en", "ja"] as const;
const FLAG: Record<string, string> = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const IMG_RE = /^\/api\/images\/[A-Za-z0-9-]{8,80}$/;

const accentOf = (v: string | null | undefined) => (v && SHOP_ACCENTS[v] ? v : DEFAULT_ACCENT);
const safeOwnImage = (v: string | null | undefined) => (v && IMG_RE.test(v) ? v : "");

/** Antwortzeit in lesbarer Form („meist innerhalb von 2 Std.“). */
export function responseLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "Antwortzeit: noch keine Daten";
  if (minutes <= 60) return "Antwortet meist innerhalb 1 Std.";
  if (minutes <= 6 * 60) return `Antwortet meist innerhalb ${Math.ceil(minutes / 60)} Std.`;
  if (minutes <= 24 * 60) return "Antwortet meist am selben Tag";
  return `Antwortet meist innerhalb ${Math.ceil(minutes / 1440)} Tagen`;
}

async function shopProfile(slug: string) {
  if (!SLUG_RE.test(slug)) return null;
  const [p] = await db.select().from(profiles).where(eq(profiles.shopSlug, slug)).limit(1);
  if (!p || p.banned || effectivePlan({ plan: p.plan, planUntil: p.planUntil }) !== "pro") return null;
  return p;
}

/** Mittlere Zeit bis zur ersten Antwort des Händlers auf Tauschanfragen und Kaufangebote (letzte 90 Tage). */
async function responseMinutes(userId: string): Promise<number | null> {
  const [r] = rows(await db.execute(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::float AS med, count(*)::int AS n FROM (
      SELECT extract(epoch FROM (COALESCE(
        (SELECT min(m.created_at) FROM trade_messages m WHERE m.trade_id = t.id AND m.user_id = ${userId}),
        CASE WHEN t.status <> 'pending' THEN t.updated_at END) - t.created_at)) / 60 AS mins
      FROM trades t WHERE t.to_user = ${userId} AND t.created_at > now() - interval '90 days'
    ) x WHERE mins IS NOT NULL AND mins >= 0`));
  return r && Number(r.n) > 0 ? Math.round(Number(r.med)) : null;
}

export async function shopDetails(slug: string, ratingOf: Hlp["ratingOf"], lang = "") {
  const p = await shopProfile(slug);
  if (!p) return null;
  const langFilter = (LANGS as readonly string[]).includes(lang) ? lang : "";
  const items = rows(await db.execute(sql`
    SELECT l.id, l.card_id, l.sealed_product_id, l.card_name, l.image, l.price::float AS price, l.want, l.city, l.created_at, l.user_id, l.lang,
      l.buy_now, l.shipping_cents, l.condition, (l.boosted_until > now()) AS boosted, COALESCE(c.trend, c.avg)::float AS market_price
    FROM listings l LEFT JOIN cards c ON c.id = l.card_id
    WHERE l.user_id = ${p.userId} AND l.status = 'active' ${langFilter ? sql`AND l.lang = ${langFilter}` : sql``}
    ORDER BY (l.boosted_until > now()) DESC NULLS LAST, l.created_at DESC LIMIT 200`));
  const [stats] = rows(await db.execute(sql`
    SELECT (SELECT count(*)::int FROM listings WHERE user_id = ${p.userId} AND status = 'active') AS active,
      (SELECT count(*)::int FROM listings WHERE user_id = ${p.userId} AND status = 'active' AND lang = 'de') AS de,
      (SELECT count(*)::int FROM listings WHERE user_id = ${p.userId} AND status = 'active' AND lang = 'en') AS en,
      (SELECT count(*)::int FROM listings WHERE user_id = ${p.userId} AND status = 'active' AND lang = 'ja') AS ja,
      (SELECT coalesce(sum(price), 0)::float FROM listings WHERE user_id = ${p.userId} AND status = 'active') AS inventory_value,
      (SELECT count(*)::int FROM trades WHERE status = 'completed' AND (from_user = ${p.userId} OR to_user = ${p.userId})) AS trades,
      (SELECT count(*)::int FROM market_orders WHERE seller_id = ${p.userId} AND status = 'released') AS sales,
      (SELECT count(*)::int FROM follows WHERE followee_id = ${p.userId}) AS followers,
      (SELECT max(created_at) FROM listings WHERE user_id = ${p.userId}) AS last_listing`));
  const minutes = await responseMinutes(p.userId);
  return {
    profile: p,
    shop: {
      slug: p.shopSlug, title: p.shopTitle || p.displayName, bio: p.shopBio, displayName: p.displayName, city: p.city,
      userId: p.userId, memberSince: p.createdAt, rating: await ratingOf(p.userId), completedTrades: Number(stats?.trades ?? 0),
      banner: safeOwnImage(p.shopBanner), logo: safeOwnImage(p.shopLogo), accent: accentOf(p.shopAccent),
      verified: true, sellerVerified: Boolean(p.stripeAccountReady), responseMinutes: minutes, responseLabel: responseLabel(minutes),
      stats: {
        active: Number(stats?.active ?? 0), sales: Number(stats?.sales ?? 0), followers: Number(stats?.followers ?? 0),
        inventoryValue: Number(stats?.inventory_value ?? 0), lastListing: stats?.last_listing ?? null,
        langs: { de: Number(stats?.de ?? 0), en: Number(stats?.en ?? 0), ja: Number(stats?.ja ?? 0) },
      },
      publicUrl: `${SITE()}/shop/${p.shopSlug}`,
    },
    listings: items.map((l: any) => ({
      ...l, seller: p.displayName, verified: true,
      priceCheck: l.market_price ? (l.price / l.market_price < 0.85 ? "deal" : l.price / l.market_price <= 1.1 ? "fair" : "high") : null,
    })),
    lang: langFilter,
  };
}

const SHOP_CSS = (accent: string) => `<style>
.sb{border-radius:22px;overflow:hidden;border:1px solid ${accent}66;background:#0b1220;margin-bottom:14px}
.sb .bn{height:170px;background:linear-gradient(120deg,${accent}cc,#312e81 60%,#0b1220);background-size:cover;background-position:center}
.sb .in{padding:14px 16px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:-54px}
.sb .lg{width:96px;height:96px;border-radius:24px;border:3px solid ${accent};background:#0f172a center/cover;display:flex;align-items:center;justify-content:center;font-size:42px;flex-shrink:0}
.sb h1{margin:0;font-size:24px}.vb{display:inline-block;background:${accent};color:#0f172a;font-weight:900;font-size:11px;border-radius:999px;padding:2px 10px;margin-left:6px;vertical-align:middle}
.kp{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:10px 0}.kp div{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:8px 10px;font-size:12px}.kp b{display:block;font-size:17px;color:#fff}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.tabs a{background:#1e293b;color:#e2e8f0;border-radius:12px;padding:5px 12px;font-size:13px;font-weight:800;text-decoration:none}.tabs a.on{background:${accent};color:#0f172a}
.inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.it{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:6px;font-size:12px;text-decoration:none;color:#e2e8f0;display:block}
.it img{width:100%;aspect-ratio:245/342;object-fit:cover;border-radius:8px;background:#0f172a;display:block}.it span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.it b{color:#34d399}.pc{font-size:10px;font-weight:900;border-radius:6px;padding:1px 6px}
</style>`;

function shopPage(d: NonNullable<Awaited<ReturnType<typeof shopDetails>>>) {
  const s = d.shop;
  const url = `${SITE()}/shop/${s.slug}`;
  const rating = s.rating.count ? `⭐ ${s.rating.avg.toLocaleString("de-DE")} (${s.rating.count} Bewertungen)` : "Noch keine Bewertungen";
  const desc = `${s.title}: ${s.stats.active} Pokémon-Karten-Angebote von ${s.displayName}${s.city ? ` aus ${s.city}` : ""}. ${rating} · ${s.responseLabel}. Verifizierter Pro-Trader auf PokeSwipe & Radar.`;
  const tab = (lang: string, label: string, n: number) => `<a class="${d.lang === lang ? "on" : ""}" href="/shop/${encodeURIComponent(String(s.slug))}${lang ? `?lang=${lang}` : ""}">${label}${lang ? ` (${n})` : ""}</a>`;
  const pcLabel: Record<string, string> = { deal: "🔥 Unter Marktwert", fair: "✅ Fairer Preis", high: "über Markt" };
  const pcColor: Record<string, string> = { deal: "background:#34d399;color:#0f172a", fair: "background:#1e293b;color:#a7f3d0", high: "background:#1e293b;color:#fca5a5" };
  const body = `${SHOP_CSS(s.accent)}
    <div class="sb"><div class="bn"${s.banner ? ` style="background-image:url('${h(cdnImage(s.banner, 1200))}')"` : ""}></div>
      <div class="in"><div class="lg"${s.logo ? ` style="background-image:url('${h(cdnImage(s.logo, 240))}')"` : ""}>${s.logo ? "" : "🏪"}</div>
        <div><h1>${h(s.title)}<span class="vb">✔ Verifizierter Händler</span></h1>
          <p class="muted" style="margin:4px 0 0">${h(s.displayName)}${s.city ? ` · 📍 ${h(s.city)}` : ""} · dabei seit ${new Date(s.memberSince).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</p>
          <p style="margin:4px 0 0;font-size:13px">${h(rating)} · ⏱️ ${h(s.responseLabel)}${s.sellerVerified ? " · 🔒 Käuferschutz verfügbar" : ""}</p></div></div>
      ${s.bio ? `<p style="padding:0 16px 14px;margin:0;white-space:pre-line;font-size:14px">${h(s.bio)}</p>` : ""}</div>
    <div class="kp"><div><b>${s.stats.active}</b>aktive Angebote</div><div><b>${s.completedTrades + s.stats.sales}</b>abgeschlossene Deals</div>
      <div><b>${h(euro(s.stats.inventoryValue))}</b>Inventar-Wert</div><div><b>${s.stats.followers}</b>Follower</div></div>
    <div class="tabs">${tab("", "Alle Sprachen", s.stats.active)}${tab("de", "🇩🇪 Deutsch", s.stats.langs.de)}${tab("en", "🇬🇧 Englisch", s.stats.langs.en)}${tab("ja", "🇯🇵 Japanisch", s.stats.langs.ja)}</div>
    <div class="inv">${d.listings.length ? d.listings.map((l: any) => `<a class="it" href="/?shop=${encodeURIComponent(String(s.slug))}">
        <img src="${h(cdnImage(l.image || "/card-fallback.svg", 300))}" alt="${h(l.card_name)}" loading="lazy">
        <span><strong>${h(FLAG[l.lang] || "")} ${h(l.card_name)}</strong></span><span><b>${h(euro(Number(l.price)))}</b>${l.buy_now ? " · 🔒 Sofort-Kauf" : ""}</span>
        ${l.priceCheck ? `<span class="pc" style="${pcColor[l.priceCheck]}">${pcLabel[l.priceCheck]}</span>` : ""}</a>`).join("")
      : `<p class="muted">Gerade keine Angebote${d.lang ? " in dieser Sprache" : ""}.</p>`}</div>
    <div class="btns" style="margin-top:14px"><a class="btn y" href="/?shop=${encodeURIComponent(String(s.slug))}">🤝 In der App anfragen &amp; kaufen</a></div>`;
  return pageShell({
    title: `${s.title} – Pokémon-Karten-Shop | PokeSwipe & Radar`, description: desc.slice(0, 300), canonical: d.lang ? `${url}?lang=${d.lang}` : url,
    image: `${SITE()}/api/og/shop/${encodeURIComponent(String(s.slug))}.jpg`, body,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Store", name: s.title, url, description: s.bio || desc,
      image: s.logo ? `${SITE()}${cdnImage(s.logo, 400, "jpg")}` : undefined,
      address: s.city ? { "@type": "PostalAddress", addressLocality: s.city, addressCountry: "DE" } : undefined,
      aggregateRating: s.rating.count ? { "@type": "AggregateRating", ratingValue: s.rating.avg, reviewCount: s.rating.count, bestRating: 5, worstRating: 1 } : undefined,
      makesOffer: d.listings.slice(0, 20).map((l: any) => ({ "@type": "Offer", name: l.card_name, price: Number(l.price).toFixed(2), priceCurrency: "EUR", availability: "https://schema.org/InStock" })),
    },
  });
}

export function registerShops(app: any, { auth, body, storeDataUrlImage, ratingOf }: Hlp) {
  app.get("/api/shops", async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT p.user_id, p.shop_slug, COALESCE(NULLIF(p.shop_title, ''), p.display_name) AS title, p.shop_bio, p.display_name, p.city,
        p.shop_logo, p.shop_banner, p.shop_accent,
        (SELECT count(*)::int FROM listings l WHERE l.user_id = p.user_id AND l.status = 'active') AS listing_count,
        (SELECT round(avg(r.stars)::numeric, 1)::float FROM reviews r WHERE r.reviewee_id = p.user_id) AS rating,
        (SELECT count(*)::int FROM reviews r WHERE r.reviewee_id = p.user_id) AS rating_count
      FROM profiles p
      WHERE p.shop_slug IS NOT NULL AND p.plan = 'pro' AND p.plan_until > now() AND NOT p.banned
      ORDER BY rating_count DESC, listing_count DESC LIMIT 60`));
    return c.json({ shops: list.map((s: any) => ({ ...s, shop_logo: safeOwnImage(s.shop_logo), shop_banner: safeOwnImage(s.shop_banner), shop_accent: accentOf(s.shop_accent) })) });
  });

  app.get("/api/shops/:slug", async (c: any) => {
    if (!rateLimit(`shopapi:${clientIp(c)}`, 90, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const d = await shopDetails(str(c.req.param("slug"), 30).toLowerCase(), ratingOf, String(c.req.query("lang") || ""));
    if (!d) return c.json({ error: "Shop nicht gefunden" }, 404);
    const viewer = await verifyIdentityToken(c).catch(() => null);
    if (viewer && (await blockedIds(viewer.id)).includes(d.profile.userId)) return c.json({ error: "Shop nicht gefunden" }, 404);
    await recordShopView(c, d.profile.userId);
    c.header("Cache-Control", "private, no-store");
    return c.json({ shop: d.shop, listings: d.listings, lang: d.lang });
  });

  app.put("/api/shop/branding", auth, async (c: any) => {
    const user = c.get("user"), plan = c.get("plan") as PlanId;
    if (!PLANS[plan].shop) return c.json({ error: "Shop-Branding ist im Pro-Trader-Tarif enthalten.", upgrade: true }, 402);
    if (!rateLimit(`shopbrand:${user.id}`, 10, 60_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    const b = await body(c);
    const updates: Record<string, string> = {};
    for (const [field, col] of [["banner", "shopBanner"], ["logo", "shopLogo"]] as const) {
      if (b[field] === undefined) continue;
      if (b[field] === "" || b[field] === null) { updates[col] = ""; continue; }
      if (typeof b[field] !== "string" || !b[field].startsWith("data:image/")) return c.json({ error: "Bitte ein Bild hochladen (JPEG, PNG oder WebP)." }, 400);
      const stored = await storeDataUrlImage(b[field], user.id);
      if (!stored) return c.json({ error: "Das Bild konnte nicht verarbeitet werden (JPEG/PNG/WebP, max. 600 KB)." }, 400);
      updates[col] = stored;
    }
    if (b.accent !== undefined) updates.shopAccent = SHOP_ACCENTS[String(b.accent)] ? String(b.accent) : "";
    if (Object.keys(updates).length) await db.update(profiles).set(updates).where(eq(profiles.userId, user.id));
    const [p] = await db.select({ banner: profiles.shopBanner, logo: profiles.shopLogo, accent: profiles.shopAccent }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
    return c.json({ banner: safeOwnImage(p?.banner), logo: safeOwnImage(p?.logo), accent: accentOf(p?.accent) });
  });

  // Öffentliche Shop-Seite (Google, WhatsApp-/Instagram-Vorschau); die App öffnet den Shop über /?shop=<name>
  app.get("/shop/:slug", async (c: any) => {
    const slug = str(c.req.param("slug"), 30).toLowerCase();
    if (!rateLimit(`shoppage:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
    const d = await shopDetails(slug, ratingOf, String(c.req.query("lang") || ""));
    if (!d) {
      return c.html(pageShell({
        title: "Shop nicht gefunden – PokeSwipe & Radar", description: "Diesen Händler-Shop gibt es nicht (mehr).", canonical: `${SITE()}/`, robots: "noindex",
        body: `<div class="card"><h1>🏪 Shop nicht gefunden</h1><p class="muted">Diesen Händler-Shop gibt es nicht (mehr) oder er ist gerade nicht aktiv.</p><div class="btns"><a class="btn y" href="/?tab=map">Zum Tausch-Hub</a></div></div>`,
      }), 404);
    }
    await recordShopView(c, d.profile.userId);
    c.header("Cache-Control", "public, max-age=60");
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    return c.html(shopPage(d));
  });

  app.get("/api/og/shop/:file", async (c: any) => {
    const slug = String(c.req.param("file")).replace(/\.jpg$/, "").toLowerCase();
    const p = await shopProfile(slug);
    if (!p) return c.notFound();
    const imgs = rows(await db.execute(sql`
      SELECT coalesce(nullif(l.image, ''), c.image, '') AS image FROM listings l LEFT JOIN cards c ON c.id = l.card_id
      WHERE l.user_id = ${p.userId} AND l.status = 'active' AND coalesce(nullif(l.image, ''), c.image, '') <> ''
      ORDER BY l.price DESC LIMIT 5`)).map((r: any) => String(r.image));
    const accent = SHOP_ACCENTS[accentOf(p.shopAccent)];
    const jpg = await ogJpeg(imgKey(`shop-${p.userId}-${accentOf(p.shopAccent)}`, imgs), imgs, accent);
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return c.body(jpg, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" });
  });
}

