// Live-Online-Radar („Gerade online“), Binder-Einblick & Direkt-Tausch.
// Präsenz läuft in Echtzeit über Firebase (pokeswipe_radar/presence/<anonyme UID>, onDisconnect().remove()).
// Damit dort niemand fremde Namen/Badges vortäuschen kann, steht in Firebase nur eine geheime Nonce: Sie wird hier
// an das Konto gebunden (presence_claims) und kann nur vom Besitzer der Firebase-UID in seinen Eintrag geschrieben
// werden. Name, Avatar, Badges und Kartenzahl liefert ausschließlich dieser Server.
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, profiles, presenceClaims } from "../db/index.ts";
import { verifyIdentityToken } from "./auth.ts";
import { effectivePlan } from "./plans.ts";
import { blockedIds } from "./community.ts";
import { profileSlug } from "./community-logic.ts";
import { sanitizeAvatarUrl } from "./profile-prefs-logic.ts";
import { str, rows, rateLimit, clientIp } from "./util.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
const FB_UID_RE = /^[A-Za-z0-9_-]{10,64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,40}$/;

/** Badges eines Profils für die Online-Liste / Binder-Vorschau. */
export function presenceBadges(p: { plan: string; planUntil: Date | null; bonusUntil?: Date | null; bonusPlan?: string | null; creatorAt?: Date | null; founderAt?: Date | null }) {
  const out: string[] = [];
  if (p.creatorAt) out.push("creator");
  if (p.founderAt) out.push("founder");
  const plan = effectivePlan(p);
  if (plan === "pro") out.push("pro");
  else if (plan === "premium") out.push("premium");
  return out;
}

export function registerPresence(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  /** Firebase-UID dieses Geräts mit dem Konto verknüpfen → Nonce für den Präsenz-Eintrag. */
  app.post("/api/presence/claim", auth, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`presence-claim:${user.id}`, 20, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const fbUid = str((await body(c)).fbUid, 80);
    if (!FB_UID_RE.test(fbUid)) return c.json({ error: "Ungültige Kennung" }, 400);
    const [existing] = await db.select().from(presenceClaims).where(and(eq(presenceClaims.fbUid, fbUid), eq(presenceClaims.userId, user.id))).limit(1);
    if (existing) {
      await db.update(presenceClaims).set({ lastSeenAt: new Date() }).where(eq(presenceClaims.nonce, existing.nonce));
      return c.json({ nonce: existing.nonce });
    }
    const nonce = randomBytes(18).toString("base64url");
    await db.insert(presenceClaims).values({ nonce, fbUid, userId: user.id }).onConflictDoNothing();
    // Alte Zuordnungen aufräumen (Geräte, die 60 Tage nicht online waren)
    db.execute(sql`DELETE FROM presence_claims WHERE last_seen_at < now() - interval '60 days'`).catch(() => {});
    return c.json({ nonce });
  });

  /** Verifizierte Mitglieder zu den aktuell online gemeldeten Präsenz-Einträgen. */
  app.post("/api/presence/members", async (c: any) => {
    if (!(await rateLimit(`presence-members:${clientIp(c)}`, 40, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const b = await body(c);
    const entries = (Array.isArray(b.entries) ? b.entries : []).slice(0, 300)
      .map((e: any) => ({ f: String(e?.f || ""), n: String(e?.n || "") }))
      .filter((e: { f: string; n: string }) => FB_UID_RE.test(e.f) && NONCE_RE.test(e.n));
    if (!entries.length) return c.json({ members: {} });
    const viewer = await verifyIdentityToken(c);
    const blocked = new Set(viewer ? await blockedIds(viewer.id) : []);
    const nonces = entries.map((e: { n: string }) => e.n);
    const list = rows(await db.execute(sql`
      SELECT pc.fb_uid, pc.nonce, p.user_id, p.display_name, p.avatar_url, p.plan, p.plan_until, p.bonus_until, p.bonus_plan, p.creator_at, p.founder_at,
        p.binder_visible, p.public_profile,
        CASE WHEN p.binder_visible THEN
          (SELECT coalesce(sum(i.quantity - 1), 0)::int FROM portfolio_items i WHERE i.user_id = p.user_id AND i.quantity >= 2)
          + (SELECT count(*)::int FROM listings l WHERE l.user_id = p.user_id AND l.status = 'active')
        ELSE 0 END AS trade_cards,
        CASE WHEN p.binder_visible THEN (SELECT count(*)::int FROM portfolio_items i WHERE i.user_id = p.user_id) ELSE 0 END AS cards
      FROM presence_claims pc JOIN profiles p ON p.user_id = pc.user_id
      WHERE pc.nonce IN (${sql.join(nonces.map((n: string) => sql`${n}`), sql`, `)}) AND NOT p.banned`));
    const members: Record<string, any> = {};
    for (const r of list) {
      const e = entries.find((x: { f: string; n: string }) => x.n === r.nonce);
      if (!e || e.f !== r.fb_uid) continue; // Nonce gehört zu einer anderen Firebase-UID → ignorieren (Fälschungsversuch)
      if (blocked.has(String(r.user_id))) continue;
      members[e.f] = {
        id: String(r.user_id), name: String(r.display_name || "Sammler"), slug: profileSlug(r.display_name), avatar: sanitizeAvatarUrl(r.avatar_url),
        badges: presenceBadges({ plan: r.plan, planUntil: r.plan_until, bonusUntil: r.bonus_until, bonusPlan: r.bonus_plan, creatorAt: r.creator_at, founderAt: r.founder_at }),
        binderVisible: Boolean(r.binder_visible), tradeCards: Number(r.trade_cards) || 0, cards: Number(r.cards) || 0, publicProfile: Boolean(r.public_profile),
      };
    }
    c.header("Cache-Control", "no-store");
    return c.json({ members });
  });

  /** Binder-Vorschau eines Sammlers: Tausch-Karten (Inserate + Dubletten) und Highlights mit Zustand & Marktpreis. */
  app.get("/api/collectors/:id/binder", async (c: any) => {
    if (!(await rateLimit(`collector-binder:${clientIp(c)}`, 60, 60_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const id = str(c.req.param("id"), 80);
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, id)).limit(1);
    if (!p || p.banned) return c.json({ error: "Sammler nicht gefunden." }, 404);
    const viewer = await verifyIdentityToken(c);
    if (viewer && viewer.id !== id && (await blockedIds(viewer.id)).includes(id)) return c.json({ error: "Dieser Sammler ist nicht verfügbar." }, 404);
    const isMe = viewer?.id === id;
    const head = {
      id, name: p.displayName, slug: profileSlug(p.displayName), avatar: sanitizeAvatarUrl(p.avatarUrl), city: p.city, bio: p.bio,
      badges: presenceBadges(p), publicProfile: p.publicProfile, binderVisible: p.binderVisible, isMe, memberSince: p.createdAt,
    };
    c.header("Cache-Control", "private, no-store");
    if (!p.binderVisible && !isMe) return c.json({ collector: head, hidden: true, listings: [], dupes: [], highlights: [], guest: !viewer });
    // Gäste sehen eine Kostprobe – die ganze Sammlung nur angemeldete Sammler
    const lim = viewer ? 36 : 4;
    const listings = rows(await db.execute(sql`
      SELECT l.id, l.card_id, l.card_name AS name, l.image, l.condition, l.variant, l.lang, l.price::float AS price, l.want, l.buy_now,
        coalesce(c.trend, c.avg)::float AS market
      FROM listings l LEFT JOIN cards c ON c.id = l.card_id
      WHERE l.user_id = ${id} AND l.status = 'active' ORDER BY l.created_at DESC LIMIT ${lim}`));
    const dupes = rows(await db.execute(sql`
      SELECT i.id, i.card_id, i.name, coalesce(nullif(i.image, ''), c.image, '') AS image, i.condition, i.variant, i.lang, i.quantity,
        i.quantity - 1 AS spare, c.set_name, coalesce(c.trend, c.avg, i.manual_value)::float AS market
      FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id
      WHERE i.user_id = ${id} AND i.quantity >= 2 ORDER BY coalesce(c.trend, c.avg, i.manual_value, 0) DESC NULLS LAST LIMIT ${lim}`));
    const highlights = rows(await db.execute(sql`
      SELECT i.id, i.card_id, i.name, coalesce(nullif(i.image, ''), c.image, '') AS image, i.condition, i.variant, i.lang, i.quantity,
        c.set_name, coalesce(c.trend, c.avg, i.manual_value)::float AS market
      FROM portfolio_items i LEFT JOIN cards c ON c.id = i.card_id
      WHERE i.user_id = ${id} ORDER BY coalesce(c.trend, c.avg, i.manual_value, 0) DESC NULLS LAST, i.added_at DESC LIMIT ${viewer ? 12 : 4}`));
    const [stats] = rows(await db.execute(sql`
      SELECT coalesce(sum(quantity), 0)::int AS cards, count(DISTINCT card_id)::int AS unique_cards,
        coalesce(sum(quantity - 1) FILTER (WHERE quantity >= 2), 0)::int AS spare
      FROM portfolio_items WHERE user_id = ${id}`));
    return c.json({
      collector: head, hidden: false, guest: !viewer, listings, dupes, highlights,
      stats: { cards: Number(stats?.cards) || 0, unique: Number(stats?.unique_cards) || 0, spare: Number(stats?.spare) || 0, listings: listings.length },
    });
  });

  /** Privatsphäre-Schalter „Meine Sammlung / Tausch-Karten für andere Sammler sichtbar machen“. */
  app.get("/api/me/binder-visibility", auth, (c: any) => c.json({ binderVisible: c.get("profile").binderVisible }));
  app.put("/api/me/binder-visibility", auth, async (c: any) => {
    const v = (await body(c)).binderVisible;
    if (typeof v !== "boolean") return c.json({ error: "Ungültiger Wert" }, 400);
    await db.update(profiles).set({ binderVisible: v }).where(eq(profiles.userId, c.get("user").id));
    return c.json({ ok: true, binderVisible: v });
  });
}
