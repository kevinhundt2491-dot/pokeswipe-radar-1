// PokeSwipe & Radar – Phase 5: geteilte Community-Deals (Flip-Radar) und Sammler-Radar über die eigene API.
//
// Vorher lagen Community-Deals nur im Browser-Speicher der meldenden Person (niemand sonst sah sie) und Radar-Pins in einem
// anonym beschreibbaren Firebase-Knoten. Jetzt gilt für beide: Login-Pflicht (Netlify Identity, bestätigte E-Mail),
// Limits je Vertrauensstufe, Wort-/Link-Filter, Melden (automatisches Ausblenden ab 3 Meldungen), Blockieren und
// Admin-Moderation (über die gemeinsame Moderation in server/community.ts). Radar-Koordinaten rundet der Server auf ~1 km.
import { and, eq, sql } from "drizzle-orm";
import { db, communityDeals, communityDealVotes, radarPins, moderationLog } from "../db/index.ts";
import { verifyIdentityToken, isAdmin, type AuthUser } from "./auth.ts";
import { guardWrite, blockedIds, trustFor } from "./community.ts";
import { radarRound, parseCardNumber, trustLevel } from "./community-logic.ts";
import { CARD_ID_RE, getCard, cardPrice } from "./prices.ts";
import { str, int, rows, rateLimit, clientIp } from "./util.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };

const DEAL_HOURS = 72;
const RADAR_MAX_AGE_DAYS = 90;
const notIn = (col: any, ids: string[]) => (ids.length ? sql`AND ${col} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``);

/** Nur https-Links; Host wird als Shop-Name angezeigt. */
function cleanUrl(v: unknown): { url: string; shop: string } {
  const s = str(v, 400);
  if (!s) return { url: "", shop: "" };
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password) return { url: "", shop: "" };
    return { url: u.toString().slice(0, 400), shop: u.hostname.replace(/^www\./, "").slice(0, 60) };
  } catch {
    return { url: "", shop: "" };
  }
}

/** Marktwert zum gemeldeten Deal: gewählte Katalogkarte oder Treffer über Name + Nummer („Glurak ex 199/165“). */
async function marketFor(title: string, cardId: unknown): Promise<{ cardId: string | null; market: number | null }> {
  if (typeof cardId === "string" && CARD_ID_RE.test(cardId)) {
    const card = await getCard(cardId).catch(() => null);
    if (card) return { cardId: card.id, market: cardPrice(card) || null };
  }
  const num = parseCardNumber(title);
  const word = title.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().split(/\s+/).find((w) => w.length >= 3 && !/^\d/.test(w));
  if (!num || !word) return { cardId: null, market: null };
  const [hit] = rows(await db.execute(sql`
    SELECT c.id, COALESCE(c.trend, c.avg, c.low)::float AS price FROM cards c JOIN card_sets s ON s.id = c.set_id
    WHERE ltrim(c.local_id, '0') = ${num.num} AND s.card_count_official = ${num.total} AND c.name ILIKE ${word + "%"}
    ORDER BY COALESCE(c.trend, c.avg, c.low) DESC NULLS LAST LIMIT 1`));
  return hit ? { cardId: String(hit.id), market: hit.price ? Number(hit.price) : null } : { cardId: null, market: null };
}

export async function listCommunityDeals(viewerId: string | null, opts: { cat?: string; limit?: number } = {}) {
  const blocked = await blockedIds(viewerId);
  const cat = ["singles", "sealed"].includes(String(opts.cat)) ? String(opts.cat) : "";
  const list = rows(await db.execute(sql`
    SELECT d.id, d.user_id, d.title, d.price::float AS price, d.url, d.shop, d.category, d.lang, d.card_id, d.market_price::float AS market_price,
      d.status, d.up, d.down, d.created_at, d.expires_at, p.display_name, (p.plan = 'pro' AND p.plan_until > now()) AS verified,
      c.image AS card_image, c.name AS card_name,
      ${viewerId ? sql`(SELECT v.vote FROM community_deal_votes v WHERE v.deal_id = d.id AND v.user_id = ${viewerId})` : sql`NULL::int`} AS my_vote
    FROM community_deals d JOIN profiles p ON p.user_id = d.user_id LEFT JOIN cards c ON c.id = d.card_id
    WHERE NOT p.banned AND d.expires_at > now()
      AND (d.status = 'visible' ${viewerId ? sql`OR (d.status = 'hidden' AND d.user_id = ${viewerId})` : sql``})
      ${cat ? sql`AND d.category = ${cat}` : sql``}
      ${notIn(sql`d.user_id`, blocked)}
    ORDER BY (d.up - d.down) DESC, d.id DESC LIMIT ${Math.min(60, Math.max(1, opts.limit ?? 40))}`));
  const trust = await trustFor(list.map((d: any) => String(d.user_id)));
  return list.map((d: any) => {
    const t = trust.get(String(d.user_id)) ?? { score: 0, level: trustLevel(0) };
    const pct = d.market_price && d.price ? Math.round(((d.market_price - d.price) / d.market_price) * 100) : null;
    return {
      id: Number(d.id), title: d.title, price: Number(d.price), url: d.url, shop: d.shop, category: d.category, lang: d.lang,
      cardId: d.card_id, image: d.card_image || "", marketPrice: d.market_price ?? null, discountPct: pct,
      up: Number(d.up) || 0, down: Number(d.down) || 0, myVote: d.my_vote === null || d.my_vote === undefined ? 0 : Number(d.my_vote),
      pending: d.status === "hidden", mine: viewerId === String(d.user_id), createdAt: d.created_at, expiresAt: d.expires_at,
      author: { id: String(d.user_id), name: String(d.display_name || "Sammler"), verified: Boolean(d.verified), trust: t.score, level: t.level },
    };
  });
}

export async function listRadarPins(viewerId: string | null) {
  const blocked = await blockedIds(viewerId);
  const list = rows(await db.execute(sql`
    SELECT r.user_id, r.name, r.city, r.cards, r.lat, r.lng, r.status, r.updated_at, p.display_name, p.public_profile,
      (p.plan = 'pro' AND p.plan_until > now()) AS verified
    FROM radar_pins r JOIN profiles p ON p.user_id = r.user_id
    WHERE NOT p.banned AND r.updated_at > now() - make_interval(days => ${RADAR_MAX_AGE_DAYS})
      AND (r.status = 'visible' ${viewerId ? sql`OR (r.status = 'hidden' AND r.user_id = ${viewerId})` : sql``})
      ${notIn(sql`r.user_id`, blocked)}
    ORDER BY r.updated_at DESC LIMIT 300`));
  const trust = await trustFor(list.map((r: any) => String(r.user_id)));
  return list.map((r: any) => {
    const t = trust.get(String(r.user_id)) ?? { score: 0, level: trustLevel(0) };
    return {
      userId: String(r.user_id), name: r.name, city: r.city, cards: r.cards, lat: Number(r.lat), lng: Number(r.lng),
      timestamp: new Date(r.updated_at).getTime(), pending: r.status === "hidden", mine: viewerId === String(r.user_id),
      verified: Boolean(r.verified), level: t.level, profileName: String(r.display_name || ""), publicProfile: Boolean(r.public_profile),
    };
  });
}

export function registerDealsRadar(app: any, { auth, body }: Hlp) {
  const viewer = async (c: any) => verifyIdentityToken(c).catch(() => null);

  // ---------------- Community-Deals (Flip-Radar) ----------------
  app.get("/api/flip/community-deals", async (c: any) => {
    if (!(await rateLimit(`cdeals:${clientIp(c)}`, 90, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const u = await viewer(c);
    c.header("Cache-Control", "private, no-store");
    return c.json({ deals: await listCommunityDeals(u?.id ?? null, { cat: c.req.query("cat") }) });
  });

  app.post("/api/flip/community-deals", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const b = await body(c);
    const title = str(b.title, 120);
    const price = Number(String(b.price ?? "").replace(",", "."));
    if (title.length < 4) return c.json({ error: "Bitte die Karte bzw. das Produkt genauer angeben." }, 400);
    if (!Number.isFinite(price) || price <= 0 || price > 100_000) return c.json({ error: "Bitte einen gültigen Preis angeben." }, 400);
    const { url, shop } = cleanUrl(b.url);
    if (b.url && !url) return c.json({ error: "Nur sichere https-Links sind erlaubt." }, 400);
    const g = await guardWrite(c, "deal", `${title} ${url}`.trim());
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const category = b.category === "sealed" ? "sealed" : "singles";
    const lang = ["de", "en", "ja"].includes(b.lang) ? b.lang : "de";
    const m = category === "singles" ? await marketFor(title, b.cardId) : { cardId: null, market: null };
    const review = g.verdict.action === "review";
    const [deal] = await db.insert(communityDeals).values({
      userId: user.id, title, price: price.toFixed(2), url, shop: shop || str(b.shop, 60), category, lang,
      cardId: m.cardId, marketPrice: m.market ? m.market.toFixed(2) : null,
      status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null,
      expiresAt: new Date(Date.now() + DEAL_HOURS * 3600_000),
    }).returning();
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "deal", targetId: String(deal.id), userId: user.id, reason: g.verdict.reason });
    return c.json({ id: deal.id, pending: review, marketPrice: m.market, notice: review ? `Dein Deal wird kurz geprüft (${g.verdict.reason}).` : "" }, 201);
  });

  // Abstimmung: 1 = „noch verfügbar / echter Deal“, -1 = „weg / kein Deal“. Erneut gleich abstimmen hebt die Stimme auf.
  app.post("/api/flip/community-deals/:id/vote", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    if (!(await rateLimit(`dvote:${user.id}`, 40, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const vote = Number((await body(c)).vote) === -1 ? -1 : 1;
    const [deal] = await db.select({ id: communityDeals.id, userId: communityDeals.userId }).from(communityDeals)
      .where(and(eq(communityDeals.id, id), eq(communityDeals.status, "visible"), sql`${communityDeals.expiresAt} > now()`)).limit(1);
    if (!deal) return c.json({ error: "Deal nicht gefunden oder abgelaufen." }, 404);
    if (deal.userId === user.id) return c.json({ error: "Eigene Deals kannst du nicht bewerten." }, 400);
    const [prev] = await db.select({ vote: communityDealVotes.vote }).from(communityDealVotes)
      .where(and(eq(communityDealVotes.dealId, id), eq(communityDealVotes.userId, user.id))).limit(1);
    if (prev?.vote === vote) await db.delete(communityDealVotes).where(and(eq(communityDealVotes.dealId, id), eq(communityDealVotes.userId, user.id)));
    else await db.insert(communityDealVotes).values({ dealId: id, userId: user.id, vote })
      .onConflictDoUpdate({ target: [communityDealVotes.dealId, communityDealVotes.userId], set: { vote, createdAt: new Date() } });
    const [r] = await db.update(communityDeals).set({
      up: sql`(SELECT count(*)::int FROM community_deal_votes WHERE deal_id = ${id} AND vote = 1)`,
      down: sql`(SELECT count(*)::int FROM community_deal_votes WHERE deal_id = ${id} AND vote = -1)`,
    }).where(eq(communityDeals.id, id)).returning({ up: communityDeals.up, down: communityDeals.down });
    // Von der Community als vergriffen markiert: ab 3 Gegenstimmen und deutlich mehr „weg“ als „da“ sofort ablaufen lassen
    if (r && r.down >= 3 && r.down > r.up * 2) await db.update(communityDeals).set({ expiresAt: new Date() }).where(eq(communityDeals.id, id));
    return c.json({ up: Number(r?.up) || 0, down: Number(r?.down) || 0, myVote: prev?.vote === vote ? 0 : vote });
  });

  app.delete("/api/flip/community-deals/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const owner = isAdmin(user) ? sql`true` : sql`${communityDeals.userId} = ${user.id}`;
    const [row] = await db.update(communityDeals).set({ status: "removed", flagReason: isAdmin(user) ? "Admin" : "vom Autor gelöscht" })
      .where(and(eq(communityDeals.id, id), owner)).returning({ userId: communityDeals.userId });
    if (!row) return c.json({ error: "Nicht gefunden" }, 404);
    if (row.userId !== user.id) await db.insert(moderationLog).values({ actorId: user.id, action: "remove", targetType: "deal", targetId: String(id), userId: row.userId, reason: "Admin" });
    return c.json({ ok: true });
  });

  // ---------------- Sammler-Radar ----------------
  app.get("/api/radar", async (c: any) => {
    if (!(await rateLimit(`radar:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const u = await viewer(c);
    c.header("Cache-Control", "private, no-store");
    return c.json({ pins: await listRadarPins(u?.id ?? null) });
  });

  app.put("/api/radar", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const b = await body(c);
    const profile = c.get("profile");
    const name = str(b.name, 35) || String(profile.displayName || "Sammler").slice(0, 35);
    const city = str(b.city, 60), cards = str(b.cards, 120);
    if (city.length < 2 || cards.length < 2) return c.json({ error: "Bitte Ort und Karten angeben." }, 400);
    // Datenschutz: exakte Koordinaten werden nie gespeichert – nur die Mitte einer ~1-km-Rasterzelle
    const pos = radarRound(b.lat, b.lng);
    if (!pos) return c.json({ error: "Standort ungültig. Bitte GPS erlauben oder die Stadt genauer angeben." }, 400);
    const g = await guardWrite(c, "radar", `${name} ${city} ${cards}`);
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const review = g.verdict.action === "review";
    const values = { name, city, cards, lat: pos.lat, lng: pos.lng, status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null, updatedAt: new Date() };
    // Ein vom Admin entfernter oder durch Meldungen ausgeblendeter Pin bleibt ausgeblendet, bis ein Admin ihn freigibt
    const [existing] = await db.select({ status: radarPins.status, flagReason: radarPins.flagReason }).from(radarPins).where(eq(radarPins.userId, user.id)).limit(1);
    const moderated = existing && (existing.status === "removed" || (existing.status === "hidden" && /Meldungen|ban|Moderation|Admin/i.test(String(existing.flagReason || ""))));
    if (existing && moderated) {
      values.status = existing.status; values.flagReason = existing.flagReason;
    }
    await db.insert(radarPins).values({ userId: user.id, ...values })
      .onConflictDoUpdate({ target: radarPins.userId, set: values });
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "radar", targetId: user.id, userId: user.id, reason: g.verdict.reason });
    return c.json({ ok: true, lat: pos.lat, lng: pos.lng, pending: values.status !== "visible", notice: review ? `Dein Pin wird kurz geprüft (${g.verdict.reason}).` : "" });
  });

  app.delete("/api/radar", auth, async (c: any) => {
    await db.delete(radarPins).where(eq(radarPins.userId, c.get("user").id));
    return c.json({ ok: true });
  });
}
