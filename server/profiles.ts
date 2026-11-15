// Phase 4: Öffentliche Sammlungs-Profile /u/<name> und teilbare Pull-Wall-Beiträge /p/<id>
// – nur mit Zustimmung (Einstellung „Öffentliches Profil“), ohne E-Mail, exakte Werte oder Kaufpreise.
// Mit dynamischem Vorschaubild (/api/og/u/<name>.jpg, /api/og/p/<id>.jpg) für WhatsApp, Telegram, Facebook, X & Co.
import { eq, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db, profiles } from "../db/index.ts";
import { verifyIdentityToken, type AuthUser } from "./auth.ts";
import { BADGES } from "./logic.ts";
import { SITE, h, slugify, cdnImage, pageShell } from "./growth.ts";
import { trustFor, blockedIds, loadPosts } from "./community.ts";
import { profileSlug, trustLevel, valueTier, moderateText } from "./community-logic.ts";
import { lowJpegUrl } from "./scan-index.ts";
import { composeCardFan, encodeJpeg, decodeJpeg, type Rgba } from "./og-image.ts";
import { str, int, rows, rateLimit, clientIp, euro } from "./util.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
const SLUG_RE = /^[\p{L}\p{N}_.\-]{2,24}$/u;

const cacheHeaders = (c: any, maxAge = 300, cdn = 900) => {
  c.header("Cache-Control", `public, max-age=${maxAge}`);
  c.header("Netlify-CDN-Cache-Control", `public, s-maxage=${cdn}, stale-while-revalidate=3600`);
};
const absImage = (img: string, w = 1200) => (img ? `${SITE()}${cdnImage(img, w, "jpg")}` : "");

async function profileBySlug(slug: string) {
  if (!SLUG_RE.test(slug)) return null;
  const [p] = await db.select().from(profiles).where(sql`lower(${profiles.displayName}) = lower(${"@" + slug})`).limit(1);
  return p && !p.banned ? p : null;
}

/** Öffentliche Profildaten (ohne E-Mail, Kaufpreise, genaue Werte). */
export async function publicProfile(p: typeof profiles.$inferSelect, viewer: AuthUser | null) {
  const id = p.userId;
  const [stats] = rows(await db.execute(sql`
    SELECT count(*)::int AS entries, coalesce(sum(i.quantity), 0)::int AS cards, count(DISTINCT c.set_id)::int AS sets,
      coalesce(sum(i.quantity * coalesce(c.trend, c.avg, c.low, i.manual_value, 0)), 0)::float AS value
    FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id WHERE i.user_id = ${id}`));
  const showcase = rows(await db.execute(sql`
    SELECT i.card_id, i.name, coalesce(nullif(i.image, ''), c.image, '') AS image, c.set_name, i.lang, i.quantity
    FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id
    WHERE i.user_id = ${id}
    ORDER BY coalesce(c.trend, c.avg, c.low, i.manual_value, 0) DESC NULLS LAST, i.added_at DESC LIMIT 12`));
  const binder = rows(await db.execute(sql`
    SELECT l.id, l.card_id, l.card_name, l.image, l.price::float AS price, l.want, l.city, l.buy_now, l.shipping_cents, l.condition
    FROM listings l WHERE l.user_id = ${id} AND l.status = 'active' ORDER BY l.created_at DESC LIMIT 24`));
  const dupes = rows(await db.execute(sql`
    SELECT i.card_id, i.name, coalesce(nullif(i.image, ''), c.image, '') AS image, c.set_name, i.quantity - 1 AS spare
    FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id
    WHERE i.user_id = ${id} AND i.quantity >= 2 ORDER BY coalesce(c.trend, c.avg, 0) DESC NULLS LAST LIMIT 24`));
  const wishlist = p.showWishlist ? rows(await db.execute(sql`
    SELECT w.card_id, c.name, c.image, c.set_name FROM wishlist_items w JOIN cards c ON c.id = w.card_id
    WHERE w.user_id = ${id} ORDER BY w.created_at DESC LIMIT 24`)) : [];
  const badgeIds = rows(await db.execute(sql`SELECT badge FROM user_badges WHERE user_id = ${id} ORDER BY earned_at`)).map((r: any) => String(r.badge));
  const badges = BADGES.filter((b) => badgeIds.includes(b.id) && (p.showValueTier || !b.id.startsWith("value-")))
    .map(({ id: bid, icon, label, description }) => ({ id: bid, icon, label, description }));
  const [social] = rows(await db.execute(sql`
    SELECT (SELECT count(*)::int FROM follows WHERE followee_id = ${id}) AS followers,
      (SELECT count(*)::int FROM follows WHERE follower_id = ${id}) AS following,
      (SELECT coalesce(round(avg(stars)::numeric, 1), 0)::float FROM reviews WHERE reviewee_id = ${id}) AS rating,
      (SELECT count(*)::int FROM reviews WHERE reviewee_id = ${id}) AS rating_count,
      (SELECT count(*)::int FROM trades WHERE status = 'completed' AND (from_user = ${id} OR to_user = ${id}))
        + (SELECT count(*)::int FROM market_orders WHERE status = 'released' AND (buyer_id = ${id} OR seller_id = ${id})) AS deals,
      ${viewer ? sql`EXISTS (SELECT 1 FROM follows WHERE follower_id = ${viewer.id} AND followee_id = ${id})` : sql`false`} AS is_following`));
  const t = (await trustFor([id])).get(id) ?? { score: 0, level: trustLevel(0) };
  const posts = await loadPosts({ viewerId: viewer?.id, authorId: id, limit: 6 });
  const verified = p.plan === "pro" && p.planUntil && new Date(p.planUntil) > new Date();
  return {
    id, name: p.displayName, slug: profileSlug(p.displayName), bio: p.bio, city: p.city, memberSince: p.createdAt,
    verified: Boolean(verified), sellerVerified: p.stripeAccountReady, trust: t.score, level: t.level,
    stats: { cards: Number(stats?.cards) || 0, entries: Number(stats?.entries) || 0, sets: Number(stats?.sets) || 0 },
    valueTier: p.showValueTier ? valueTier(Number(stats?.value) || 0) : null,
    badges, showcase, binder, dupes, wishlist, posts,
    followers: Number(social?.followers) || 0, following: Number(social?.following) || 0,
    rating: { avg: Number(social?.rating) || 0, count: Number(social?.rating_count) || 0 }, deals: Number(social?.deals) || 0,
    isFollowing: Boolean(social?.is_following), isMe: viewer?.id === id, publicProfile: p.publicProfile,
  };
}

// ---------------------------------------------------------------------------
// Vorschaubild: Kartenbilder laden (TCGdex low.jpg bzw. Netlify Image CDN als JPEG) und zur Collage zusammensetzen
// ---------------------------------------------------------------------------
async function loadJpeg(image: string): Promise<Rgba | null> {
  if (!image) return null;
  let url = lowJpegUrl(image);
  if (!url) {
    // Eigene Uploads (/api/images/…) und andere erlaubte Quellen über das Image CDN als JPEG
    if (image.startsWith("/api/images/") || /^https:\/\/(assets\.tcgdex\.net|images\.pokemontcg\.io|raw\.githubusercontent\.com)\//.test(image)) {
      url = `${SITE()}${cdnImage(image, 500, "jpg")}`;
    } else return null;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length < 3_000_000 ? decodeJpeg(buf) : null;
  } catch { return null; }
}

export async function ogJpeg(key: string, images: string[], accent?: [number, number, number]) {
  const store = getStore("og-images");
  const hit = await store.get(key, { type: "arrayBuffer" }).catch(() => null);
  if (hit) return new Uint8Array(hit);
  const decoded = (await Promise.all(images.slice(0, 5).map(loadJpeg))).filter(Boolean) as Rgba[];
  const jpg = encodeJpeg(composeCardFan(decoded, accent));
  await store.set(key, jpg.buffer as ArrayBuffer).catch(() => {});
  return jpg;
}
export const imgKey = (prefix: string, images: string[]) => {
  let x = 0;
  for (const ch of images.join("|")) x = (Math.imul(x, 31) + ch.charCodeAt(0)) | 0;
  return `${prefix}-${(x >>> 0).toString(36)}`;
};

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
const CSS = `<style>.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}.ci{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:6px;text-decoration:none;font-size:12px;display:block}
.ci img{width:100%;border-radius:8px;display:block;aspect-ratio:245/342;object-fit:cover;background:#0f172a}.ci span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ci b{color:#34d399}
.head{display:flex;flex-wrap:wrap;gap:16px;align-items:center}.av{width:76px;height:76px;border-radius:24px;background:linear-gradient(135deg,#ffcb05,#f97316);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;color:#0f172a}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.bdg{background:#1e293b;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800}
.post{background:#0b1220;border:1px solid #1e293b;border-radius:16px;padding:10px;font-size:13px}.post img{max-width:100%;max-height:260px;border-radius:10px;display:block;margin:6px auto}.posts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}</style>`;

const cardTile = (x: any, extra = "") => {
  const href = x.card_id ? `/karte/${encodeURIComponent(x.card_id)}/${slugify(String(x.name || x.card_name || "karte"))}` : "#";
  const name = x.name || x.card_name || "Karte";
  return `<a class="ci" href="${h(href)}">${x.image ? `<img src="${h(cdnImage(x.image, 220))}" alt="${h(name)}" loading="lazy" width="112" height="156">` : ""}<span><strong>${h(name)}</strong></span><span class="muted">${h(x.set_name || "")}</span>${extra}</a>`;
};

function profilePage(pp: Awaited<ReturnType<typeof publicProfile>>) {
  const url = `${SITE()}/u/${encodeURIComponent(pp.slug)}`;
  const title = `${pp.name} – Pokémon-Sammlung auf PokeSwipe & Radar`;
  const description = `${pp.name}${pp.city ? ` aus ${pp.city}` : ""}: ${pp.stats.cards} Karten aus ${pp.stats.sets} Sets${pp.binder.length ? `, ${pp.binder.length} Karten zum Tausch/Verkauf` : ""}. ${pp.bio || "Sammlung ansehen, folgen und tauschen."}`.slice(0, 280);
  const body = `${CSS}<div class="card">
    <div class="head"><div class="av">${h((pp.name.replace("@", "")[0] || "S").toUpperCase())}</div>
    <div><h1>${h(pp.name)} ${pp.verified ? '<span class="pill deal">✔ Pro Trader</span>' : ""}</h1>
    <p class="muted">${h(pp.level.icon)} ${h(pp.level.label)} · Mitglied seit ${new Date(pp.memberSince).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}${pp.city ? ` · 📍 ${h(pp.city)}` : ""}${pp.sellerVerified ? " · 🔒 Verifizierter Verkäufer" : ""}</p>
    ${pp.bio ? `<p>${h(pp.bio)}</p>` : ""}</div></div>
    <div class="stats"><div class="stat"><b>${pp.stats.cards}</b>Karten</div><div class="stat"><b>${pp.stats.sets}</b>Sets</div><div class="stat"><b>${pp.followers}</b>Follower</div>
    <div class="stat"><b>${pp.rating.count ? `⭐ ${pp.rating.avg}` : "–"}</b>${pp.rating.count} Bewertungen</div><div class="stat"><b>${pp.deals}</b>Tausche &amp; Käufe</div><div class="stat"><b>${pp.valueTier ? `${h(pp.valueTier.icon)} ${h(pp.valueTier.label)}` : pp.badges.length}</b>${pp.valueTier ? "Sammlungswert" : "Abzeichen"}</div></div>
    ${pp.badges.length ? `<div class="badges">${pp.badges.map((b) => `<span class="bdg" title="${h(b.description)}">${h(b.icon)} ${h(b.label)}</span>`).join("")}</div>` : ""}
    <div class="btns"><a class="btn y" href="/?profile=${encodeURIComponent(pp.slug)}">➕ In der App folgen</a><a class="btn s" href="https://wa.me/?text=${encodeURIComponent(`Schau dir die Pokémon-Sammlung von ${pp.name} an: ${url}`)}" rel="noopener">WhatsApp teilen</a></div></div>
    ${pp.showcase.length ? `<h2>🏆 Showcase</h2><div class="cards">${pp.showcase.map((x: any) => cardTile(x, x.quantity > 1 ? `<span class="muted">${Number(x.quantity)}×</span>` : "")).join("")}</div>` : ""}
    ${pp.binder.length || pp.dupes.length ? `<h2>📒 Tausch-Ordner</h2><div class="cards">${pp.binder.map((x: any) => cardTile(x, `<b>${h(euro(Number(x.price)))}</b>${x.buy_now ? '<span class="muted">🔒 Käuferschutz</span>' : ""}`)).join("")}${pp.dupes.map((x: any) => cardTile(x, `<span class="muted">${Number(x.spare)}× doppelt</span>`)).join("")}</div>` : ""}
    ${pp.wishlist.length ? `<h2>❤️ Sucht</h2><div class="cards">${pp.wishlist.map((x: any) => cardTile(x)).join("")}</div>` : ""}
    ${pp.posts.length ? `<h2>📸 Letzte Pulls</h2><div class="posts">${pp.posts.filter((p: any) => !p.pending).map((p: any) => `<a class="post" href="/p/${p.id}" style="text-decoration:none">${p.image ? `<img src="${h(cdnImage(p.image, 480))}" alt="Pull von ${h(pp.name)}" loading="lazy">` : ""}<span>${h(p.caption)}</span><br><span class="muted">❤️ ${p.likes} · 💬 ${p.commentCount}</span></a>`).join("")}</div>` : ""}`;
  return pageShell({
    title, description, canonical: url, image: `${SITE()}/api/og/u/${encodeURIComponent(pp.slug)}.jpg`, body,
    jsonLd: { "@context": "https://schema.org", "@type": "ProfilePage", dateCreated: pp.memberSince, mainEntity: { "@type": "Person", name: pp.name, alternateName: pp.slug, description: pp.bio || undefined, interactionStatistic: [{ "@type": "InteractionCounter", interactionType: "https://schema.org/FollowAction", userInteractionCount: pp.followers }] } },
  });
}

const notFoundPage = (c: any, text: string) => c.html(pageShell({
  title: "Profil nicht verfügbar – PokeSwipe & Radar", description: text, canonical: `${SITE()}/`, robots: "noindex",
  body: `<div class="card"><h1>🔒 Nicht verfügbar</h1><p class="muted">${h(text)}</p><div class="btns"><a class="btn y" href="/">Zur App</a></div></div>`,
}), 404);

export function registerProfiles(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  app.get("/api/u/:slug", async (c: any) => {
    if (!rateLimit(`prof:${clientIp(c)}`, 60, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const p = await profileBySlug(decodeURIComponent(c.req.param("slug")));
    const viewer = await verifyIdentityToken(c);
    if (!p || (!p.publicProfile && viewer?.id !== p.userId)) return c.json({ error: "Dieses Profil ist privat oder existiert nicht." }, 404);
    if (viewer && (await blockedIds(viewer.id)).includes(p.userId)) return c.json({ error: "Dieses Profil ist nicht verfügbar." }, 404);
    return c.json({ profile: await publicProfile(p, viewer) });
  });

  app.get("/u/:slug", async (c: any) => {
    const p = await profileBySlug(decodeURIComponent(c.req.param("slug")));
    if (!p || !p.publicProfile) return notFoundPage(c, "Dieses Sammler-Profil ist privat oder existiert nicht.");
    cacheHeaders(c, 60, 300); // kurz, damit „Profil privat schalten“ schnell greift
    return c.html(profilePage(await publicProfile(p, null)));
  });

  app.get("/api/og/u/:file", async (c: any) => {
    const slug = decodeURIComponent(String(c.req.param("file")).replace(/\.jpg$/, ""));
    const p = await profileBySlug(slug);
    if (!p || !p.publicProfile) return c.notFound();
    const imgs = rows(await db.execute(sql`
      SELECT coalesce(nullif(i.image, ''), c.image, '') AS image FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id
      WHERE i.user_id = ${p.userId} AND coalesce(nullif(i.image, ''), c.image, '') <> ''
      ORDER BY coalesce(c.trend, c.avg, c.low, i.manual_value, 0) DESC NULLS LAST LIMIT 5`)).map((r: any) => String(r.image));
    const jpg = await ogJpeg(imgKey(`u-${p.userId}`, imgs), imgs);
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return c.body(jpg, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" });
  });

  // Teilbarer Pull-Wall-Beitrag mit Vorschaubild
  app.get("/p/:id", async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [post] = await loadPosts({ postId: id, limit: 1 });
    if (!post || post.pending) return notFoundPage(c, "Dieser Beitrag wurde entfernt oder existiert nicht.");
    const url = `${SITE()}/p/${id}`;
    const title = `${post.author.name}: ${post.caption}`.slice(0, 90);
    cacheHeaders(c, 120, 300);
    return c.html(pageShell({
      title: `${title} – PokeSwipe Pull-Wall`, description: `❤️ ${post.likes} · 💬 ${post.commentCount} – Pokémon-Pull von ${post.author.name} in der PokeSwipe-Community. Jetzt ansehen und eigene Hits teilen!`,
      canonical: url, image: post.image ? `${SITE()}/api/og/p/${id}.jpg` : undefined,
      body: `${CSS}<div class="card" style="max-width:560px;margin:0 auto">
        <p class="muted">${post.author.publicProfile ? `<a href="/u/${encodeURIComponent(post.author.slug)}"><strong>${h(post.author.name)}</strong></a>` : `<strong>${h(post.author.name)}</strong>`} · ${h(post.author.level.icon)} ${h(post.author.level.label)} · ${new Date(post.createdAt).toLocaleDateString("de-DE")}</p>
        <h1 style="font-size:20px">${h(post.caption)}</h1>
        ${post.image ? `<img class="img" src="${h(cdnImage(post.image, 900))}" alt="${h(post.caption)}">` : ""}
        <p class="muted">❤️ ${post.likes} Likes · 💬 ${post.commentCount} Kommentare</p>
        ${post.comments.filter((x: any) => !x.pending).slice(-5).map((x: any) => `<p style="font-size:13px"><strong>${h(x.author.name)}:</strong> ${h(x.body)}</p>`).join("")}
        <div class="btns"><a class="btn y" href="/?tab=community&post=${id}">❤️ In der App liken &amp; kommentieren</a></div></div>`,
      jsonLd: { "@context": "https://schema.org", "@type": "SocialMediaPosting", headline: post.caption.slice(0, 110), datePublished: post.createdAt, author: { "@type": "Person", name: post.author.name }, image: post.image ? absImage(post.image) : undefined, interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: post.likes } },
    }));
  });

  app.get("/api/og/p/:file", async (c: any) => {
    const id = int(String(c.req.param("file")).replace(/\.jpg$/, ""), 1, 2 ** 31 - 1, 0);
    const [r] = rows(await db.execute(sql`SELECT image FROM community_posts WHERE id = ${id} AND status = 'visible'`));
    if (!r?.image) return c.notFound();
    const jpg = await ogJpeg(imgKey(`p-${id}`, [String(r.image)]), [String(r.image)], [236, 72, 153]);
    c.header("Netlify-CDN-Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return c.body(jpg, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" });
  });

  // Teil-Sitemap öffentlicher Profile (nur mit Zustimmung und mit mindestens einer Karte)
  app.get("/sitemaps/profiles.xml", async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT p.display_name, p.created_at FROM profiles p
      WHERE p.public_profile AND NOT p.banned AND EXISTS (SELECT 1 FROM portfolio_items i WHERE i.user_id = p.user_id)
      ORDER BY p.created_at DESC LIMIT 20000`));
    cacheHeaders(c, 3600, 3600);
    c.header("Content-Type", "application/xml; charset=utf-8");
    return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${list.map((p: any) =>
      `<url><loc>${h(`${SITE()}/u/${encodeURIComponent(profileSlug(p.display_name))}`)}</loc><changefreq>weekly</changefreq></url>`).join("")}</urlset>`);
  });

  // Einstellungen des eigenen öffentlichen Profils
  app.get("/api/me/public-profile", auth, async (c: any) => {
    const p = c.get("profile");
    return c.json({ publicProfile: p.publicProfile, bio: p.bio, showWishlist: p.showWishlist, showValueTier: p.showValueTier, slug: profileSlug(p.displayName), url: `${SITE()}/u/${encodeURIComponent(profileSlug(p.displayName))}` });
  });
  app.put("/api/me/public-profile", auth, async (c: any) => {
    const b = await body(c);
    const updates: Record<string, unknown> = {};
    if (typeof b.publicProfile === "boolean") updates.publicProfile = b.publicProfile;
    if (typeof b.showWishlist === "boolean") updates.showWishlist = b.showWishlist;
    if (typeof b.showValueTier === "boolean") updates.showValueTier = b.showValueTier;
    if (b.bio !== undefined) {
      const bio = str(b.bio, 200).replace(/https?:\/\/\S+/gi, "").trim();
      const verdict = moderateText(bio, { trust: 0 });
      if (verdict.action !== "ok") return c.json({ error: `Profiltext nicht gespeichert: ${verdict.reason}.` }, 422);
      updates.bio = bio;
    }
    if (Object.keys(updates).length) await db.update(profiles).set(updates).where(eq(profiles.userId, c.get("user").id));
    return c.json({ ok: true, ...updates });
  });
}
