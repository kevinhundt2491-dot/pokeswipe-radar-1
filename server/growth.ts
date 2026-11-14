// PokeSwipe & Radar – Wachstum & Bindung: Wunschliste mit Tausch-Abgleich, öffentliche Kartenseiten (SEO),
// tägliche Serie, Abzeichen, Bestenliste, Kalender (Releases & Events), Wochen-Report, Shop-Statistik,
// CSV-Import, KI-Zustandscheck, Rechtliches (Impressum, Daten-Export).
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import {
  db, profiles, cards, priceHistory, portfolioItems, priceAlerts, notifications, listings, trades, tradeMessages, reviews,
  wishlistItems, userBadges, calendarEvents, calendarReminders, cardScans, sealedAlerts, trackedSets,
} from "../db/index.ts";
import { PLANS, type PlanId } from "./plans.ts";
import { CARD_ID_RE, getCard, cardPrice, notify } from "./prices.ts";
import { verifyIdentityToken, isAdmin } from "./auth.ts";
import { searchTcgdex, fetchSet, normNum, pool } from "./features.ts";
import { BADGES, earnedBadges, berlinDay, nextStreak, weeklySummary, type BadgeStats } from "./logic.ts";
import { str, money, int, rows, rateLimit, clientIp, euro } from "./util.ts";

type Profile = typeof profiles.$inferSelect;

const SITE = () => process.env.URL || "https://pokeswipe-radar.de";
const EPN_CAMPAIGN_ID = "5339244109";
/** eBay-Suche mit Partner-Kennung (eBay Partner Network). */
const ebayUrl = (q: string, src = "web") =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_BIN=1&_sop=15&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=${EPN_CAMPAIGN_ID}&customid=${encodeURIComponent(`pokeswipe-${src}`)}&toolid=10001&mkevt=1`;
const h = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const slugify = (s: string) => s.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/é/g, "e")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "karte";
const cdnImage = (url: string, w: number, fm = "") =>
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
    if (!rateLimit(`shopview:${clientIp(c)}:${ownerId}`, 1, 30 * 60_000)) return;
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
function chartSvg(points: number[], w = 640, hgt = 160) {
  const v = points.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return `<p class="muted">Der Preisverlauf baut sich täglich auf.</p>`;
  const min = Math.min(...v) * 0.97, max = Math.max(...v) * 1.03, span = max - min || 1;
  const line = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(hgt - ((x - min) / span) * hgt).toFixed(1)}`).join(" ");
  const col = v[v.length - 1] >= v[0] ? "#34d399" : "#fb7185";
  return `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" style="width:100%;height:160px" role="img" aria-label="Preisverlauf">
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

function pageShell(o: { title: string; description: string; canonical: string; image?: string; body: string; jsonLd?: object }) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(o.title)}</title><meta name="description" content="${h(o.description)}"><link rel="canonical" href="${h(o.canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="PokeSwipe & Radar"><meta property="og:locale" content="de_DE">
<meta property="og:title" content="${h(o.title)}"><meta property="og:description" content="${h(o.description)}"><meta property="og:url" content="${h(o.canonical)}">
${o.image ? `<meta property="og:image" content="${h(o.image)}"><meta name="twitter:image" content="${h(o.image)}">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#0b0f19"><link rel="icon" href="/icon.svg" type="image/svg+xml">
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<style>${PAGE_CSS}</style></head><body><div class="wrap">
<div class="top"><a class="logo" href="/">Poke<span>Swipe</span> &amp; Radar</a><a class="btn y" href="/">App öffnen</a></div>
${o.body}
<footer>Preise: Cardmarket über TCGdex, täglich aktualisiert. *Affiliate-Link (eBay Partner Network): Wir erhalten ggf. eine Provision, für dich ohne Mehrkosten. Pokémon und alle Namen sind Marken ihrer Inhaber; PokeSwipe &amp; Radar ist ein unabhängiges Fanprojekt.<br><a href="/?legal=1">Impressum &amp; Datenschutz</a></footer>
</div></body></html>`;
}

async function cardPage(c: any) {
  const id = String(c.req.param("id") || "");
  if (!CARD_ID_RE.test(id)) return c.html(pageShell({ title: "Karte nicht gefunden", description: "", canonical: SITE(), body: `<div class="card"><h1>Karte nicht gefunden</h1></div>` }), 404);
  if (!rateLimit(`cardpage:${clientIp(c)}`, 40, 60_000)) return c.text("Zu viele Anfragen", 429);
  const card = await getCard(id, 12 * 3600_000);
  if (!card) {
    return c.html(pageShell({ title: "Karte nicht gefunden | PokeSwipe & Radar", description: "", canonical: SITE(),
      body: `<div class="card"><h1>Karte nicht gefunden</h1><p class="muted">Diese Karte gibt es nicht (mehr).</p><a class="btn y" href="/">Zur Kartensuche</a></div>` }), 404);
  }
  const price = cardPrice(card);
  const hist = await db.select({ day: priceHistory.day, trend: priceHistory.trend }).from(priceHistory)
    .where(eq(priceHistory.cardId, id)).orderBy(desc(priceHistory.day)).limit(90);
  const series = hist.reverse().map((x) => Number(x.trend));
  const offers = rows(await db.execute(sql`
    SELECT l.price::float AS price, l.city, l.created_at, p.display_name
    FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.card_id = ${id} AND l.status = 'active' AND NOT p.banned
    ORDER BY l.price ASC LIMIT 10
  `));
  const [wishers] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM wishlist_items WHERE card_id = ${id}`));
  const avg30 = Number(card.avg30 ?? 0);
  const ch30 = price && avg30 ? ((price - avg30) / avg30) * 100 : null;
  const slug = slugify(card.name);
  const canonical = `${SITE()}/karte/${encodeURIComponent(card.id)}/${slug}`;
  const priceText = price ? euro(price) : "noch kein Preis";
  const title = `${card.name} (${card.setName || card.id}) – Preis ${price ? euro(price) : "aktuell"} | PokeSwipe & Radar`;
  const description = `Aktueller Cardmarket-Preis für ${card.name} aus ${card.setName || "Pokémon TCG"}: ${priceText}${ch30 !== null ? ` (${ch30 >= 0 ? "+" : ""}${ch30.toFixed(1).replace(".", ",")} % in 30 Tagen)` : ""}. Preisverlauf, Preisalarm und Tauschangebote aus der Community.`;
  const ogImage = card.image ? `${SITE()}${cdnImage(card.image.replace(/\/high\.webp$/, "/high.png"), 600, "jpg")}` : "";
  const appLink = (extra = "") => `/?card=${encodeURIComponent(card.id)}${extra}`;
  const badge = (p: number) => {
    if (!price) return "";
    const r = p / price;
    return r < 0.85 ? `<span class="pill deal">🔥 Top-Deal</span>` : r <= 1.1 ? `<span class="pill fair">✓ Fair</span>` : `<span class="pill high">Über Markt</span>`;
  };
  const body = `<div class="card"><div class="grid">
    <div>${card.image ? `<img class="img" src="${h(cdnImage(card.image, 520))}" alt="${h(card.name)} Pokémon-Karte" width="260" height="362">` : ""}</div>
    <div>
      <h1>${h(card.name)}</h1>
      <p class="muted">${h(card.setName)} • ${h(card.id)}</p>
      <p class="price">${h(priceText)}</p>
      <p class="muted">Cardmarket-Trend${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "up" : "down"}">${ch30 >= 0 ? "+" : ""}${ch30.toFixed(1).replace(".", ",")} % (30 Tage)</span>` : ""}</p>
      <div class="stats">
        <div class="stat">Ø 7 Tage<b>${card.avg7 ? h(euro(Number(card.avg7))) : "–"}</b></div>
        <div class="stat">Ø 30 Tage<b>${card.avg30 ? h(euro(Number(card.avg30))) : "–"}</b></div>
        <div class="stat">Ab<b>${card.low ? h(euro(Number(card.low))) : "–"}</b></div>
      </div>
      ${chartSvg(series)}
      <div class="btns">
        <a class="btn y" href="${h(appLink())}">🎯 Preisalarm setzen</a>
        <a class="btn g" href="${h(appLink("&wish=1"))}">❤️ Auf die Wunschliste</a>
        <a class="btn s" href="${h(appLink("&list=1"))}">🤝 Selbst inserieren</a>
        <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`${card.name.replace(/-ex\b/, " ex")} ${card.id.split("-").pop()}`, "karte"))}" target="_blank" rel="noopener sponsored">🛒 Bei eBay kaufen*</a>
      </div>
      ${Number(wishers?.n) ? `<p class="muted" style="margin-top:10px">❤️ ${Number(wishers.n)} Sammler suchen diese Karte.</p>` : ""}
    </div></div></div>
  <h2>🤝 Angebote aus der Community</h2>
  ${offers.length ? `<div class="list">${offers.map((o: any) => `<a class="row" href="${h(appLink("&tab=map"))}" style="text-decoration:none">
      <span><b>${h(euro(o.price))}</b> <span class="muted">• ${h(o.city)} • ${h(o.display_name)}</span></span>${badge(o.price)}</a>`).join("")}</div>`
    : `<p class="muted">Gerade keine Angebote. Setz die Karte auf deine Wunschliste – wir melden uns, sobald sie jemand anbietet.</p>`}`;
  const jsonLd: any = {
    "@context": "https://schema.org", "@type": "Product", name: card.name, sku: card.id,
    category: "Pokémon-Sammelkarte", brand: { "@type": "Brand", name: "Pokémon TCG" },
    ...(card.image ? { image: card.image } : {}),
    ...(offers.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "EUR", offerCount: offers.length,
      lowPrice: Math.min(...offers.map((o: any) => o.price)).toFixed(2), highPrice: Math.max(...offers.map((o: any) => o.price)).toFixed(2) } } : {}),
  };
  c.header("Cache-Control", "public, max-age=300");
  c.header("Netlify-CDN-Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
  return c.html(pageShell({ title, description, canonical, image: ogImage, body, jsonLd }));
}

// ---------------------------------------------------------------------------
// Rechtliches (Impressum-Text pflegt der Admin; gespeichert in Netlify Blobs)
// ---------------------------------------------------------------------------
type Legal = { impressum: string; updatedAt: string | null };
export const DEFAULT_IMPRESSUM = `Kevin Hundt
Hähn 10
51515 Kürten
Deutschland

Telefon: 0174 2182874
E-Mail: info@galabau-hundt.de

Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: Kevin Hundt, Anschrift wie oben.

EU-Streitschlichtung: Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung bereit: https://ec.europa.eu/consumers/odr/. Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.`;

async function getLegal(): Promise<Legal> {
  let saved: Legal | null = null;
  try { saved = (await getStore("app-config").get("legal", { type: "json" })) as Legal | null; } catch {}
  return { impressum: saved?.impressum || DEFAULT_IMPRESSUM, updatedAt: saved?.updatedAt || null };
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
      name: cards.name, image: cards.image, setName: cards.setName, trend: cards.trend, avg: cards.avg, low: cards.low,
    }).from(wishlistItems).innerJoin(cards, eq(cards.id, wishlistItems.cardId))
      .where(eq(wishlistItems.userId, userId)).orderBy(desc(wishlistItems.createdAt));
    const offers = rows(await db.execute(sql`
      SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.city, l.user_id, p.display_name AS seller,
        (p.plan = 'pro' AND p.plan_until > now()) AS verified
      FROM listings l JOIN profiles p ON p.user_id = l.user_id
      JOIN wishlist_items w ON w.card_id = l.card_id AND w.user_id = ${userId}
      WHERE l.status = 'active' AND NOT p.banned AND l.user_id <> ${userId}
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
    const [item] = await db.insert(wishlistItems).values({ userId: user.id, cardId: card.id, maxPrice })
      .onConflictDoUpdate({ target: [wishlistItems.userId, wishlistItems.cardId], set: { maxPrice } }).returning();
    // Gibt es schon passende Angebote?
    const [offer] = rows(await db.execute(sql`
      SELECT count(*)::int AS n, min(price)::float AS min FROM listings
      WHERE card_id = ${card.id} AND status = 'active' AND user_id <> ${user.id} AND (${maxPrice}::numeric IS NULL OR price <= ${maxPrice}::numeric)
    `));
    return c.json({ item, offers: Number(offer?.n ?? 0), minPrice: offer?.min ?? null }, 201);
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
    c.header("Cache-Control", "public, max-age=120");
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
    if (!rateLimit(`event:${user.id}`, 5, 3600_000)) return c.json({ error: "Bitte später weitere Events eintragen." }, 429);
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
    if (!id || !rateLimit(`lview:${clientIp(c)}:${id}`, 1, 30 * 60_000)) return c.json({ ok: true });
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
    if (!rateLimit(`import:${user.id}`, 30, 600_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    const b = await body(c);
    const input = (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map((r: any) => ({
      name: str(r?.name, 120), number: str(r?.number, 16), set: str(r?.set, 120),
      quantity: int(r?.quantity, 1, 999, 1), purchasePrice: money(r?.purchasePrice),
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
        quantity: r.quantity, purchasePrice: r.purchasePrice,
      });
      if (card) matched++; else unmatched.push(r.name);
      done.add(i);
    }, Date.now() + 17_000);
    const retry = todo.filter((_: any, i: number) => !done.has(i));
    return c.json({ imported: done.size, matched, unmatched: unmatched.slice(0, 50), retry, overLimit: input.length - todo.length });
  });

  // ------------------------- KI-Zustandscheck (Grading) --------------------
  app.post("/api/scan/condition", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    if (!rateLimit(`scan:${user.id}`, 6, 60_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    if ((await scansToday(user.id)) >= PLANS[plan].scansPerDay) {
      return c.json({ error: `Tageslimit erreicht: ${PLANS[plan].scansPerDay} Scans im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((await body(c)).image || ""));
    if (!m || m[2].length > 2_000_000) return c.json({ error: "Bitte ein Foto (JPG/PNG, max. ca. 1,5 MB) aufnehmen." }, 400);
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
    });
    const text = msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
    let r: any = {};
    try { r = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
    await db.insert(cardScans).values({ userId: user.id, result: `Zustand ${r.gradeLow ?? "?"}-${r.gradeHigh ?? "?"}` });
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

  // ------------------------------ Rechtliches ------------------------------
  app.get("/api/legal", async (c: any) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(await getLegal());
  });

  app.put("/api/admin/legal", auth, adminOnly, async (c: any) => {
    const impressum = str((await body(c)).impressum, 4000);
    const legal = { impressum, updatedAt: new Date().toISOString() };
    await getStore("app-config").setJSON("legal", legal);
    return c.json(legal);
  });

  /** DSGVO-Auskunft: alle eigenen Daten als JSON-Datei. */
  app.get("/api/me/export", auth, async (c: any) => {
    const userId = c.get("user").id, profile: Profile = c.get("profile");
    if (!rateLimit(`export:${userId}`, 5, 3600_000)) return c.json({ error: "Bitte später erneut versuchen." }, 429);
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
      notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(500),
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
    if (!rateLimit(`prices:${clientIp(c)}`, 20, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const prices: Record<string, { trend: number | null; low: number | null; avg30: number | null; updated: string | null }> = {};
    await pool(ids, 4, async (id: string) => {
      const card = await getCard(id, 6 * 3600_000);
      if (!card) return;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      prices[id] = { trend: n(card.trend ?? card.avg), low: n(card.low), avg30: n(card.avg30), updated: card.priceUpdatedAt ? new Date(card.priceUpdatedAt).toISOString() : null };
    }, Date.now() + 15_000);
    c.header("Cache-Control", "public, max-age=900");
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    return c.json({ prices });
  });

  // ------------------------- Öffentliche Seiten (SEO) ----------------------
  app.get("/karte/:id/:slug?", cardPage);

  app.get("/sitemap.xml", async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT id, name, COALESCE(price_updated_at, checked_at) AS updated FROM cards
      WHERE COALESCE(trend, avg, low) IS NOT NULL ORDER BY checked_at DESC NULLS LAST LIMIT 5000
    `));
    const shops = rows(await db.execute(sql`
      SELECT shop_slug FROM profiles WHERE shop_slug IS NOT NULL AND plan = 'pro' AND plan_until > now() AND NOT banned LIMIT 500
    `));
    const base = SITE();
    const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
      .concat(list.map((r: any) => `<url><loc>${h(`${base}/karte/${encodeURIComponent(r.id)}/${slugify(r.name)}`)}</loc>${r.updated ? `<lastmod>${new Date(r.updated).toISOString().slice(0, 10)}</lastmod>` : ""}<changefreq>daily</changefreq></url>`))
      .concat(shops.map((s: any) => `<url><loc>${h(`${base}/shop/${s.shop_slug}`)}</loc><changefreq>daily</changefreq></url>`));
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, 200, { "Content-Type": "application/xml; charset=utf-8" });
  });

  // Manueller Start der Hintergrund-Aufgaben für Admins (Test)
  app.post("/api/admin/run-growth", auth, adminOnly, async (c: any) => c.json(await runGrowthJobs({ deadlineMs: 15_000 })));
}
