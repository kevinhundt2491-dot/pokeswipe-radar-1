// Phase 4: Authentifizierte Community – Pull-Wall (Social Feed), Live-Chat, Likes, Kommentare, Follower,
// Blockieren, Meldungen und Admin-Moderation. Alles läuft über Netlify Identity (geprüftes JWT) und Netlify Database.
// Schreiben dürfen nur angemeldete Nutzer mit bestätigter E-Mail; Limits und Filter greifen serverseitig.
import { and, eq, sql } from "drizzle-orm";
import {
  db, profiles, communityPosts, communityComments, communityLikes, chatMessages, userBlocks, follows, moderationLog, reports,
  communityDeals, radarPins,
} from "../db/index.ts";
import { verifyIdentityToken, isAdmin, type AuthUser } from "./auth.ts";
import { moderateText, trustScore, trustLevel, writeLimits, AUTO_HIDE_REPORTS, profileSlug, type TrustLevel } from "./community-logic.ts";
import { CARD_ID_RE, getCard, notify } from "./prices.ts";
import { str, int, rows, rateLimit, clientIp } from "./util.ts";

type Hlp = {
  auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>>;
  safeImage: (v: unknown) => string; storeDataUrlImage: (d: unknown, userId: string) => Promise<string>;
};

export type TrustInfo = { score: number; level: TrustLevel };

// ---------------------------------------------------------------------------
// Trust-Score (gesammelt für mehrere Nutzer in EINER Abfrage, 2 Minuten zwischengespeichert)
// ---------------------------------------------------------------------------
const trustCache = new Map<string, { info: TrustInfo; expires: number }>();

export async function trustFor(ids: string[]): Promise<Map<string, TrustInfo>> {
  const out = new Map<string, TrustInfo>();
  const todo: string[] = [];
  const now = Date.now();
  for (const id of new Set(ids.filter(Boolean))) {
    const hit = trustCache.get(id);
    if (hit && hit.expires > now) out.set(id, hit.info);
    else todo.push(id);
  }
  if (!todo.length) return out;
  const list = sql.join(todo.slice(0, 200).map((i) => sql`${i}`), sql`, `);
  const data = rows(await db.execute(sql`
    SELECT p.user_id, p.email_confirmed, p.banned, extract(epoch FROM now() - p.created_at)::float / 86400 AS age_days,
      ((p.plan IN ('premium','pro') AND p.plan_until > now()) OR p.bonus_until > now()) AS paid,
      p.stripe_account_ready,
      (SELECT count(*)::int FROM trades t WHERE t.status = 'completed' AND (t.from_user = p.user_id OR t.to_user = p.user_id))
        + (SELECT count(*)::int FROM market_orders o WHERE o.status = 'released' AND (o.buyer_id = p.user_id OR o.seller_id = p.user_id)) AS deals,
      (SELECT coalesce(avg(r.stars), 0)::float FROM reviews r WHERE r.reviewee_id = p.user_id) AS rating_avg,
      (SELECT count(*)::int FROM reviews r WHERE r.reviewee_id = p.user_id) AS rating_count,
      (SELECT count(*)::int FROM moderation_log m WHERE m.user_id = p.user_id AND m.action IN ('remove', 'ban')) AS upheld,
      (SELECT count(*)::int FROM moderation_log m WHERE m.user_id = p.user_id AND m.action = 'mute') AS mutes
    FROM profiles p WHERE p.user_id IN (${list})`));
  if (trustCache.size > 5000) trustCache.clear();
  for (const r of data) {
    const score = trustScore({
      confirmed: Boolean(r.email_confirmed), accountAgeDays: Number(r.age_days) || 0, completedDeals: Number(r.deals) || 0,
      ratingAvg: Number(r.rating_avg) || 0, ratingCount: Number(r.rating_count) || 0, paidPlan: Boolean(r.paid),
      verifiedSeller: Boolean(r.stripe_account_ready), upheldReports: Number(r.upheld) || 0, mutes: Number(r.mutes) || 0, banned: Boolean(r.banned),
    });
    const info = { score, level: trustLevel(score) };
    trustCache.set(String(r.user_id), { info, expires: now + 120_000 });
    out.set(String(r.user_id), info);
  }
  return out;
}
export const forgetTrust = (id: string) => trustCache.delete(id);

/** Blockierte Nutzer in beide Richtungen (wer mich blockiert hat, sieht meine Inhalte nicht, und umgekehrt). */
export async function blockedIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  return rows(await db.execute(sql`
    SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ${userId}
    UNION SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = ${userId}`)).map((r: any) => String(r.id));
}
export async function isBlockedBetween(a: string, b: string) {
  const [r] = rows(await db.execute(sql`
    SELECT 1 AS x FROM user_blocks WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a}) LIMIT 1`));
  return Boolean(r);
}

const notIn = (col: any, ids: string[]) => (ids.length ? sql`AND ${col} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``);

/** Gemeinsame Schreib-Prüfung: bestätigte E-Mail, nicht stummgeschaltet, Limits je Vertrauensstufe, Wort-/Link-Filter. */
export async function guardWrite(c: any, kind: "chat" | "post" | "comment" | "deal" | "radar", text: string) {
  const user: AuthUser = c.get("user");
  const profile = c.get("profile");
  if (!user.confirmed) return { error: "Bitte bestätige zuerst deine E-Mail-Adresse (Link in deinem Postfach), dann kannst du in der Community schreiben.", status: 403 };
  if (profile.mutedUntil && new Date(profile.mutedUntil) > new Date()) {
    return { error: `Du bist bis ${new Date(profile.mutedUntil).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} stummgeschaltet.`, status: 403 };
  }
  const trust = (await trustFor([user.id])).get(user.id)?.score ?? 0;
  const lim = writeLimits(trust, kind);
  if (!rateLimit(`cw:${kind}:${user.id}`, lim.perMinute, 60_000)) return { error: "Bitte nicht so schnell – kurz warten.", status: 429 };
  // Radar: ein Pin pro Konto (wird überschrieben) – dort zählt nur die Zeit-Bremse, keine Tabellen-Zählung
  let recent: string[] = [];
  if (kind === "radar") {
    if (!rateLimit(`cw:radar-h:${user.id}`, lim.perHour, 3600_000)) return { error: `Stündliches Limit erreicht (${lim.perHour} Änderungen am Radar-Pin).`, status: 429 };
  } else {
    const table = kind === "chat" ? sql`chat_messages` : kind === "post" ? sql`community_posts` : kind === "deal" ? sql`community_deals` : sql`community_comments`;
    const [cnt] = rows(await db.execute(sql`
      SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS m, count(*)::int AS h
      FROM ${table} WHERE user_id = ${user.id} AND created_at > now() - interval '1 hour'`));
    if (Number(cnt?.m) >= lim.perMinute) return { error: "Bitte nicht so schnell – kurz warten.", status: 429 };
    if (Number(cnt?.h) >= lim.perHour) return { error: `Stündliches Limit erreicht (${lim.perHour}). Mit wachsendem Vertrauen steigt es automatisch.`, status: 429 };
    const textCol = kind === "post" ? sql`caption` : kind === "deal" ? sql`title` : sql`body`;
    recent = rows(await db.execute(sql`SELECT ${textCol} AS t FROM ${table} WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 5`)).map((r: any) => String(r.t || ""));
  }
  const verdict = moderateText(text, { trust, recent });
  if (verdict.action === "block") {
    await db.insert(moderationLog).values({ action: "auto_block", targetType: kind, targetId: "-", userId: user.id, reason: `${verdict.reason}: ${text.slice(0, 160)}` });
    return { error: `Nicht gesendet: ${verdict.reason}.`, status: 422 };
  }
  return { trust, verdict };
}

const authorOf = (r: any, trust: Map<string, TrustInfo>) => {
  const t = trust.get(String(r.user_id)) ?? { score: 0, level: trustLevel(0) };
  return {
    id: String(r.user_id), name: String(r.display_name || "Sammler"), slug: profileSlug(r.display_name),
    publicProfile: Boolean(r.public_profile), verified: Boolean(r.verified), trust: t.score, level: t.level,
  };
};

// ---------------------------------------------------------------------------
// Meldungen: automatisches Ausblenden ab mehreren Meldungen, Moderations-Aktionen
// ---------------------------------------------------------------------------
export const COMMUNITY_TARGETS = ["post", "comment", "chat", "deal", "radar"] as const;
const contentTable = (type: string) => (type === "post" ? communityPosts : type === "comment" ? communityComments : type === "chat" ? chatMessages
  : type === "deal" ? communityDeals : type === "radar" ? radarPins : null);

async function contentAuthor(type: string, id: number | string): Promise<string | null> {
  const t: any = contentTable(type);
  if (!t) return null;
  // Radar-Pins: ein Pin je Konto, die Ziel-ID ist die Nutzer-ID
  if (type === "radar") {
    const [p] = await db.select({ userId: radarPins.userId }).from(radarPins).where(eq(radarPins.userId, String(id))).limit(1);
    return p ? String(p.userId) : null;
  }
  const [r] = await db.select({ userId: t.userId }).from(t).where(eq(t.id, id)).limit(1);
  return r ? String(r.userId) : null;
}

async function setContentStatus(type: string, id: number | string, status: "visible" | "hidden" | "removed", reason: string | null) {
  const t: any = contentTable(type);
  if (!t) return false;
  if (type === "radar") {
    const [p] = await db.update(radarPins).set({ status, flagReason: reason }).where(eq(radarPins.userId, String(id))).returning({ id: radarPins.userId });
    return Boolean(p);
  }
  const [r] = await db.update(t).set({ status, flagReason: reason }).where(eq(t.id, id)).returning({ id: t.id });
  if (r && type === "comment") {
    // Kommentarzähler am Beitrag aktuell halten
    await db.execute(sql`UPDATE community_posts SET comment_count = (SELECT count(*)::int FROM community_comments WHERE post_id = (SELECT post_id FROM community_comments WHERE id = ${id}) AND status = 'visible')
      WHERE id = (SELECT post_id FROM community_comments WHERE id = ${id})`);
  }
  return Boolean(r);
}

/** Nach einer neuen Meldung: ab AUTO_HIDE_REPORTS verschiedenen Meldenden wird der Inhalt bis zur Prüfung ausgeblendet. */
export async function afterCommunityReport(targetType: string, targetId: string) {
  if (!(COMMUNITY_TARGETS as readonly string[]).includes(targetType)) return;
  if (targetType === "radar") {
    const [r] = rows(await db.execute(sql`
      SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE target_type = 'radar' AND target_id = ${String(targetId)} AND status = 'open'`));
    if (Number(r?.n) >= AUTO_HIDE_REPORTS) {
      const [row] = await db.update(radarPins).set({ status: "hidden", flagReason: `${AUTO_HIDE_REPORTS}+ Meldungen` })
        .where(and(eq(radarPins.userId, String(targetId)), eq(radarPins.status, "visible"))).returning({ userId: radarPins.userId });
      if (row) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "radar", targetId: String(targetId), userId: String(row.userId), reason: `${Number(r.n)} Meldungen` });
    }
    return;
  }
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return;
  const [r] = rows(await db.execute(sql`
    SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE target_type = ${targetType} AND target_id = ${String(id)} AND status = 'open'`));
  if (Number(r?.n) >= AUTO_HIDE_REPORTS) {
    const t: any = contentTable(targetType);
    const [row] = await db.update(t).set({ status: "hidden", flagReason: `${AUTO_HIDE_REPORTS}+ Meldungen` })
      .where(and(eq(t.id, id), eq(t.status, "visible"))).returning({ userId: t.userId });
    if (row) await db.insert(moderationLog).values({ action: "auto_hide", targetType, targetId: String(id), userId: String(row.userId), reason: `${Number(r.n)} Meldungen` });
  }
}

/** Wendet eine Moderations-Aktion an (auch aus der allgemeinen Meldungs-Liste der Admin-Zentrale). */
export async function applyModeration(o: {
  actorId: string; targetType: string; targetId: string; action: string; days?: number; reason?: string;
}): Promise<{ ok: boolean; error?: string; userId?: string | null }> {
  const reason = str(o.reason, 300);
  let userId: string | null = null;
  const contentId: number | string = o.targetType === "radar" ? str(o.targetId, 80) : Number(o.targetId);
  if (o.targetType === "user") userId = str(o.targetId, 80);
  else if ((COMMUNITY_TARGETS as readonly string[]).includes(o.targetType)) userId = await contentAuthor(o.targetType, contentId);
  else return { ok: false, error: "Unbekanntes Ziel" };
  if (!userId) return { ok: false, error: "Nicht gefunden" };

  const log = (action: string) => db.insert(moderationLog).values({ actorId: o.actorId, action, targetType: o.targetType, targetId: String(o.targetId), userId, reason });
  switch (o.action) {
    case "hide": case "remove": case "restore": {
      if (o.targetType === "user") return { ok: false, error: "Aktion passt nicht zum Ziel" };
      const status = o.action === "restore" ? "visible" : o.action === "hide" ? "hidden" : "removed";
      if (!(await setContentStatus(o.targetType, contentId, status, o.action === "restore" ? null : reason || "Moderation"))) return { ok: false, error: "Nicht gefunden" };
      await log(o.action);
      if (o.action === "remove") await notify(userId, "🛡️ Beitrag entfernt", reason || "Ein Beitrag von dir verstieß gegen die Community-Regeln.");
      break;
    }
    case "mute": {
      const days = Math.min(90, Math.max(1, Math.round(Number(o.days) || 1)));
      await db.update(profiles).set({ mutedUntil: new Date(Date.now() + days * 86400_000) }).where(eq(profiles.userId, userId));
      await log("mute");
      await notify(userId, `🔇 ${days} Tag${days > 1 ? "e" : ""} stummgeschaltet`, reason || "Du kannst vorübergehend nicht in der Community schreiben.");
      break;
    }
    case "unmute":
      await db.update(profiles).set({ mutedUntil: null }).where(eq(profiles.userId, userId));
      await log("unmute");
      break;
    case "ban":
      await db.update(profiles).set({ banned: true }).where(eq(profiles.userId, userId));
      // Inhalte ausblenden (beim Entsperren wiederherstellbar) und Inserate entfernen
      for (const t of ["community_posts", "community_comments", "chat_messages", "community_deals", "radar_pins"]) {
        await db.execute(sql`UPDATE ${sql.raw(t)} SET status = 'hidden', flag_reason = 'ban' WHERE user_id = ${userId} AND status = 'visible'`);
      }
      await db.execute(sql`UPDATE listings SET status = 'removed' WHERE user_id = ${userId} AND status = 'active'`);
      await log("ban");
      break;
    case "unban":
      await db.update(profiles).set({ banned: false }).where(eq(profiles.userId, userId));
      for (const t of ["community_posts", "community_comments", "chat_messages", "community_deals", "radar_pins"]) {
        await db.execute(sql`UPDATE ${sql.raw(t)} SET status = 'visible', flag_reason = NULL WHERE user_id = ${userId} AND status = 'hidden' AND flag_reason = 'ban'`);
      }
      await log("unban");
      break;
    default:
      return { ok: false, error: "Unbekannte Aktion" };
  }
  forgetTrust(userId);
  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Feed-Abfragen
// ---------------------------------------------------------------------------
export async function loadPosts(o: { viewerId?: string | null; isAdmin?: boolean; before?: number; authorId?: string; following?: boolean; postId?: number; limit?: number }) {
  const blocked = await blockedIds(o.viewerId);
  const limit = Math.min(40, Math.max(1, o.limit ?? 20));
  const posts = rows(await db.execute(sql`
    SELECT po.id, po.user_id, po.caption, po.image, po.card_id, po.status, po.flag_reason, po.like_count, po.comment_count, po.created_at,
      pr.display_name, pr.public_profile, (pr.plan = 'pro' AND pr.plan_until > now()) AS verified,
      ${o.viewerId ? sql`EXISTS (SELECT 1 FROM community_likes l WHERE l.post_id = po.id AND l.user_id = ${o.viewerId})` : sql`false`} AS liked
    FROM community_posts po JOIN profiles pr ON pr.user_id = po.user_id
    WHERE NOT pr.banned
      AND (po.status = 'visible' ${o.viewerId ? sql`OR (po.status = 'hidden' AND po.user_id = ${o.viewerId})` : sql``})
      ${o.before ? sql`AND po.id < ${o.before}` : sql``}
      ${o.postId ? sql`AND po.id = ${o.postId}` : sql``}
      ${o.authorId ? sql`AND po.user_id = ${o.authorId}` : sql``}
      ${o.following && o.viewerId ? sql`AND (po.user_id = ${o.viewerId} OR po.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${o.viewerId}))` : sql``}
      ${notIn(sql`po.user_id`, blocked)}
    ORDER BY po.id DESC LIMIT ${limit}`));
  if (!posts.length) return [];
  const postIds = sql.join(posts.map((p: any) => sql`${Number(p.id)}`), sql`, `);
  const comments = rows(await db.execute(sql`
    SELECT * FROM (
      SELECT cm.id, cm.post_id, cm.user_id, cm.body, cm.status, cm.created_at, pr.display_name, pr.public_profile,
        (pr.plan = 'pro' AND pr.plan_until > now()) AS verified,
        row_number() OVER (PARTITION BY cm.post_id ORDER BY cm.id DESC) AS rn
      FROM community_comments cm JOIN profiles pr ON pr.user_id = cm.user_id
      WHERE cm.post_id IN (${postIds}) AND NOT pr.banned
        AND (cm.status = 'visible' ${o.viewerId ? sql`OR (cm.status = 'hidden' AND cm.user_id = ${o.viewerId})` : sql``})
        ${notIn(sql`cm.user_id`, blocked)}
    ) x WHERE rn <= 30 ORDER BY id`));
  const trust = await trustFor([...posts.map((p: any) => String(p.user_id)), ...comments.map((c: any) => String(c.user_id))]);
  return posts.map((p: any) => ({
    id: Number(p.id), caption: p.caption, image: p.image, cardId: p.card_id, createdAt: p.created_at,
    status: p.status, pending: p.status === "hidden", likes: Number(p.like_count) || 0, commentCount: Number(p.comment_count) || 0,
    liked: Boolean(p.liked), mine: o.viewerId === String(p.user_id), author: authorOf(p, trust),
    comments: comments.filter((c: any) => Number(c.post_id) === Number(p.id)).map((c: any) => ({
      id: Number(c.id), body: c.body, createdAt: c.created_at, pending: c.status === "hidden",
      mine: o.viewerId === String(c.user_id), author: authorOf(c, trust),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerCommunity(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;
  const viewer = async (c: any) => verifyIdentityToken(c);

  // ---------------- Pull-Wall / Social Feed ----------------
  app.get("/api/community/feed", async (c: any) => {
    if (!rateLimit(`feed:${clientIp(c)}`, 120, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const u = await viewer(c);
    const posts = await loadPosts({
      viewerId: u?.id, before: int(c.req.query("before"), 0, 2 ** 31 - 1, 0) || undefined,
      following: c.req.query("scope") === "following", limit: 20,
    });
    return c.json({ posts, nextBefore: posts.length === 20 ? posts[posts.length - 1].id : null });
  });

  app.get("/api/community/posts/:id", async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const u = await viewer(c);
    const [post] = await loadPosts({ viewerId: u?.id, postId: id, limit: 1 });
    if (!post) return c.json({ error: "Beitrag nicht gefunden" }, 404);
    return c.json({ post });
  });

  app.post("/api/community/posts", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const b = await body(c);
    const caption = str(b.caption, 300);
    let image = "", cardId: string | null = null;
    if (typeof b.image === "string" && b.image.startsWith("data:")) {
      image = await hlp.storeDataUrlImage(b.image, user.id);
      if (!image) return c.json({ error: "Das Foto konnte nicht verarbeitet werden (JPEG/PNG/WebP, max. 600 KB)." }, 400);
    } else if (b.cardId && CARD_ID_RE.test(String(b.cardId))) {
      const card = await getCard(String(b.cardId));
      if (card) { cardId = card.id; image = card.image; }
    } else if (b.image) {
      image = hlp.safeImage(b.image);
    }
    if (!caption && !image) return c.json({ error: "Bitte ein Foto oder eine Beschreibung angeben." }, 400);
    const g = await guardWrite(c, "post", caption);
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const review = g.verdict.action === "review";
    const [post] = await db.insert(communityPosts).values({
      userId: user.id, caption: caption || "Neuer Pull! 🔥", image, cardId,
      status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null,
    }).returning();
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "post", targetId: String(post.id), userId: user.id, reason: g.verdict.reason });
    else {
      // Follower benachrichtigen (gebündelt: höchstens 200, nur wer nicht blockiert ist)
      const fans = rows(await db.execute(sql`SELECT follower_id FROM follows WHERE followee_id = ${user.id} LIMIT 200`));
      const name = c.get("profile").displayName;
      for (const f of fans) await notify(String(f.follower_id), `📸 Neuer Pull von ${name}`, (caption || "Neuer Pull!").slice(0, 120), `/?tab=community&post=${post.id}`);
    }
    return c.json({ id: post.id, pending: review, notice: review ? `Dein Beitrag wird kurz geprüft (${g.verdict.reason}).` : "" }, 201);
  });

  app.delete("/api/community/posts/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const owner = isAdmin(user) ? sql`true` : sql`${communityPosts.userId} = ${user.id}`;
    const [row] = await db.update(communityPosts).set({ status: "removed", flagReason: isAdmin(user) ? "Admin" : "vom Autor gelöscht" })
      .where(and(eq(communityPosts.id, id), owner)).returning({ id: communityPosts.id, userId: communityPosts.userId });
    if (!row) return c.json({ error: "Nicht gefunden" }, 404);
    if (row.userId !== user.id) await db.insert(moderationLog).values({ actorId: user.id, action: "remove", targetType: "post", targetId: String(id), userId: row.userId, reason: "Admin" });
    return c.json({ ok: true });
  });

  app.post("/api/community/posts/:id/like", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    if (!rateLimit(`like:${user.id}`, 60, 60_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    const [post] = await db.select({ id: communityPosts.id, userId: communityPosts.userId }).from(communityPosts)
      .where(and(eq(communityPosts.id, id), eq(communityPosts.status, "visible"))).limit(1);
    if (!post) return c.json({ error: "Beitrag nicht gefunden" }, 404);
    if (await isBlockedBetween(user.id, post.userId)) return c.json({ error: "Nicht möglich." }, 403);
    const [added] = await db.insert(communityLikes).values({ postId: id, userId: user.id }).onConflictDoNothing().returning();
    if (!added) await db.delete(communityLikes).where(and(eq(communityLikes.postId, id), eq(communityLikes.userId, user.id)));
    const [r] = await db.update(communityPosts).set({ likeCount: sql`(SELECT count(*)::int FROM community_likes WHERE post_id = ${id})` })
      .where(eq(communityPosts.id, id)).returning({ likes: communityPosts.likeCount });
    return c.json({ liked: Boolean(added), likes: Number(r?.likes) || 0 });
  });

  app.post("/api/community/posts/:id/comments", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const text = str((await body(c)).body, 300);
    if (!text) return c.json({ error: "Leerer Kommentar" }, 400);
    const [post] = await db.select({ id: communityPosts.id, userId: communityPosts.userId }).from(communityPosts)
      .where(and(eq(communityPosts.id, id), eq(communityPosts.status, "visible"))).limit(1);
    if (!post) return c.json({ error: "Beitrag nicht gefunden" }, 404);
    if (await isBlockedBetween(user.id, post.userId)) return c.json({ error: "Du kannst hier nicht kommentieren." }, 403);
    const g = await guardWrite(c, "comment", text);
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const review = g.verdict.action === "review";
    const [cm] = await db.insert(communityComments).values({ postId: id, userId: user.id, body: text, status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null }).returning();
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "comment", targetId: String(cm.id), userId: user.id, reason: g.verdict.reason });
    else {
      await db.update(communityPosts).set({ commentCount: sql`${communityPosts.commentCount} + 1` }).where(eq(communityPosts.id, id));
      if (post.userId !== user.id) {
        // höchstens eine Kommentar-Mitteilung pro Beitrag und 10 Minuten
        const [recent] = rows(await db.execute(sql`SELECT 1 AS x FROM notifications WHERE user_id = ${post.userId} AND link = ${`/?tab=community&post=${id}`}
          AND title LIKE '💬%' AND created_at > now() - interval '10 minutes' LIMIT 1`));
        if (!recent) await notify(post.userId, `💬 ${c.get("profile").displayName} hat deinen Pull kommentiert`, text.slice(0, 120), `/?tab=community&post=${id}`);
      }
    }
    return c.json({ id: cm.id, pending: review, notice: review ? `Dein Kommentar wird kurz geprüft (${g.verdict.reason}).` : "" }, 201);
  });

  app.delete("/api/community/comments/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [cm] = rows(await db.execute(sql`SELECT cm.user_id, po.user_id AS post_owner FROM community_comments cm JOIN community_posts po ON po.id = cm.post_id WHERE cm.id = ${id}`));
    if (!cm) return c.json({ error: "Nicht gefunden" }, 404);
    // Löschen dürfen: Autor, Besitzer des Beitrags, Admins
    if (![String(cm.user_id), String(cm.post_owner)].includes(user.id) && !isAdmin(user)) return c.json({ error: "Nicht erlaubt" }, 403);
    await setContentStatus("comment", id, "removed", String(cm.user_id) === user.id ? "vom Autor gelöscht" : "entfernt");
    return c.json({ ok: true });
  });

  // ---------------- Live-Chat (Abfrage alle paar Sekunden) ----------------
  app.get("/api/community/chat", async (c: any) => {
    if (!rateLimit(`chatr:${clientIp(c)}`, 90, 60_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
    const u = await viewer(c);
    const after = int(c.req.query("after"), 0, 2 ** 31 - 1, 0);
    const blocked = await blockedIds(u?.id);
    const list = rows(await db.execute(sql`
      SELECT * FROM (
        SELECT m.id, m.user_id, m.body, m.status, m.created_at, p.display_name, p.public_profile, (p.plan = 'pro' AND p.plan_until > now()) AS verified
        FROM chat_messages m JOIN profiles p ON p.user_id = m.user_id
        WHERE m.room = 'global' AND NOT p.banned AND m.id > ${after}
          AND (m.status = 'visible' ${u ? sql`OR (m.status = 'hidden' AND m.user_id = ${u.id})` : sql``})
          AND m.created_at > now() - interval '30 days'
          ${notIn(sql`m.user_id`, blocked)}
        ORDER BY m.id DESC LIMIT 60
      ) x ORDER BY id`));
    const trust = await trustFor(list.map((m: any) => String(m.user_id)));
    // IDs gelöschter Nachrichten seit dem letzten Abruf, damit Clients sie entfernen
    const removed = after ? rows(await db.execute(sql`SELECT id FROM chat_messages WHERE room = 'global' AND status <> 'visible' AND id > ${Math.max(0, after - 200)} ORDER BY id DESC LIMIT 50`)).map((r: any) => Number(r.id)) : [];
    return c.json({
      messages: list.map((m: any) => ({ id: Number(m.id), body: m.body, createdAt: m.created_at, pending: m.status === "hidden", mine: u?.id === String(m.user_id), author: authorOf(m, trust) })),
      removed,
    });
  });

  app.post("/api/community/chat", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const text = str((await body(c)).body, 500);
    if (!text) return c.json({ error: "Leere Nachricht" }, 400);
    const g = await guardWrite(c, "chat", text);
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const review = g.verdict.action === "review";
    const [m] = await db.insert(chatMessages).values({ userId: user.id, body: text, status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null }).returning();
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "chat", targetId: String(m.id), userId: user.id, reason: g.verdict.reason });
    return c.json({ id: m.id, pending: review, notice: review ? `Deine Nachricht wird kurz geprüft (${g.verdict.reason}).` : "" }, 201);
  });

  app.delete("/api/community/chat/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const owner = isAdmin(user) ? sql`true` : sql`${chatMessages.userId} = ${user.id}`;
    const [row] = await db.update(chatMessages).set({ status: "removed", flagReason: "gelöscht" }).where(and(eq(chatMessages.id, id), owner)).returning({ id: chatMessages.id });
    return row ? c.json({ ok: true }) : c.json({ error: "Nicht gefunden" }, 404);
  });

  // ---------------- Blockieren ----------------
  app.get("/api/community/blocks", auth, async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT b.blocked_id AS id, p.display_name AS name, b.created_at FROM user_blocks b JOIN profiles p ON p.user_id = b.blocked_id
      WHERE b.blocker_id = ${c.get("user").id} ORDER BY b.created_at DESC LIMIT 500`));
    return c.json({ blocks: list });
  });
  app.post("/api/community/blocks", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const target = str((await body(c)).userId, 80);
    if (!target || target === user.id) return c.json({ error: "Ungültiger Nutzer" }, 400);
    const [p] = await db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, target)).limit(1);
    if (!p) return c.json({ error: "Nutzer nicht gefunden" }, 404);
    await db.insert(userBlocks).values({ blockerId: user.id, blockedId: target }).onConflictDoNothing();
    // Blockieren beendet gegenseitiges Folgen
    await db.delete(follows).where(sql`(follower_id = ${user.id} AND followee_id = ${target}) OR (follower_id = ${target} AND followee_id = ${user.id})`);
    return c.json({ ok: true });
  });
  app.delete("/api/community/blocks/:id", auth, async (c: any) => {
    await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, c.get("user").id), eq(userBlocks.blockedId, str(c.req.param("id"), 80))));
    return c.json({ ok: true });
  });

  // ---------------- Folgen ----------------
  app.post("/api/follow/:id", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const target = str(c.req.param("id"), 80);
    if (!target || target === user.id) return c.json({ error: "Du kannst dir nicht selbst folgen." }, 400);
    if (!rateLimit(`follow:${user.id}`, 30, 60_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    const [p] = await db.select({ id: profiles.userId, banned: profiles.banned }).from(profiles).where(eq(profiles.userId, target)).limit(1);
    if (!p || p.banned) return c.json({ error: "Nutzer nicht gefunden" }, 404);
    if (await isBlockedBetween(user.id, target)) return c.json({ error: "Nicht möglich." }, 403);
    const [added] = await db.insert(follows).values({ followerId: user.id, followeeId: target }).onConflictDoNothing().returning();
    if (added) await notify(target, `➕ ${c.get("profile").displayName} folgt dir jetzt`, "Teile deine Pulls in der Community, damit deine Follower sie sehen.", "/?tab=community");
    const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE followee_id = ${target}`));
    return c.json({ following: true, followers: Number(n?.n) || 0 });
  });
  app.delete("/api/follow/:id", auth, async (c: any) => {
    const target = str(c.req.param("id"), 80);
    await db.delete(follows).where(and(eq(follows.followerId, c.get("user").id), eq(follows.followeeId, target)));
    const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE followee_id = ${target}`));
    return c.json({ following: false, followers: Number(n?.n) || 0 });
  });
  app.get("/api/me/follows", auth, async (c: any) => {
    const id = c.get("user").id;
    const following = rows(await db.execute(sql`SELECT f.followee_id AS id, p.display_name AS name, p.public_profile FROM follows f JOIN profiles p ON p.user_id = f.followee_id WHERE f.follower_id = ${id} AND NOT p.banned ORDER BY f.created_at DESC LIMIT 500`));
    const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM follows WHERE followee_id = ${id}`));
    return c.json({ following: following.map((f: any) => ({ ...f, slug: profileSlug(f.name) })), followers: Number(n?.n) || 0 });
  });

  // Eigener Community-Status (Vertrauensstufe, Limits, Stummschaltung) für die Oberfläche
  app.get("/api/community/me", auth, async (c: any) => {
    const user: AuthUser = c.get("user"), profile = c.get("profile");
    const t = (await trustFor([user.id])).get(user.id) ?? { score: 0, level: trustLevel(0) };
    return c.json({
      confirmed: user.confirmed, trust: t.score, level: t.level, mutedUntil: profile.mutedUntil,
      limits: { chat: writeLimits(t.score, "chat"), post: writeLimits(t.score, "post"), comment: writeLimits(t.score, "comment") },
      links: t.score >= 40,
    });
  });

  // ---------------- Admin-Moderation ----------------
  app.get("/api/admin/moderation", auth, adminOnly, async (c: any) => {
    const open = rows(await db.execute(sql`
      SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at, rp.display_name AS reporter,
        CASE r.target_type
          WHEN 'post' THEN (SELECT caption FROM community_posts WHERE id = r.target_id::int)
          WHEN 'comment' THEN (SELECT body FROM community_comments WHERE id = r.target_id::int)
          WHEN 'chat' THEN (SELECT body FROM chat_messages WHERE id = r.target_id::int)
          WHEN 'deal' THEN (SELECT title || ' – ' || price::text || ' €' FROM community_deals WHERE id = r.target_id::int)
          WHEN 'radar' THEN (SELECT name || ' (' || city || '): ' || cards FROM radar_pins WHERE user_id = r.target_id) END AS content,
        CASE r.target_type
          WHEN 'post' THEN (SELECT image FROM community_posts WHERE id = r.target_id::int) END AS image,
        CASE r.target_type
          WHEN 'post' THEN (SELECT status FROM community_posts WHERE id = r.target_id::int)
          WHEN 'comment' THEN (SELECT status FROM community_comments WHERE id = r.target_id::int)
          WHEN 'chat' THEN (SELECT status FROM chat_messages WHERE id = r.target_id::int)
          WHEN 'deal' THEN (SELECT status FROM community_deals WHERE id = r.target_id::int)
          WHEN 'radar' THEN (SELECT status FROM radar_pins WHERE user_id = r.target_id) END AS content_status,
        CASE r.target_type
          WHEN 'post' THEN (SELECT p.display_name FROM community_posts x JOIN profiles p ON p.user_id = x.user_id WHERE x.id = r.target_id::int)
          WHEN 'comment' THEN (SELECT p.display_name FROM community_comments x JOIN profiles p ON p.user_id = x.user_id WHERE x.id = r.target_id::int)
          WHEN 'chat' THEN (SELECT p.display_name FROM chat_messages x JOIN profiles p ON p.user_id = x.user_id WHERE x.id = r.target_id::int)
          WHEN 'deal' THEN (SELECT p.display_name FROM community_deals x JOIN profiles p ON p.user_id = x.user_id WHERE x.id = r.target_id::int)
          WHEN 'radar' THEN (SELECT p.display_name FROM profiles p WHERE p.user_id = r.target_id) END AS author
      FROM reports r JOIN profiles rp ON rp.user_id = r.reporter_id
      WHERE r.status = 'open' AND ((r.target_type IN ('post', 'comment', 'chat', 'deal') AND r.target_id ~ '^[0-9]{1,9}$') OR r.target_type = 'radar')
      ORDER BY r.created_at DESC LIMIT 100`));
    const flagged = rows(await db.execute(sql`
      SELECT * FROM (
        SELECT 'post' AS type, x.id, x.caption AS content, x.image, x.flag_reason, x.created_at, p.display_name AS author, x.user_id FROM community_posts x JOIN profiles p ON p.user_id = x.user_id WHERE x.status = 'hidden' AND coalesce(x.flag_reason, '') <> 'ban'
        UNION ALL SELECT 'comment', x.id, x.body, '', x.flag_reason, x.created_at, p.display_name, x.user_id FROM community_comments x JOIN profiles p ON p.user_id = x.user_id WHERE x.status = 'hidden' AND coalesce(x.flag_reason, '') <> 'ban'
        UNION ALL SELECT 'chat', x.id, x.body, '', x.flag_reason, x.created_at, p.display_name, x.user_id FROM chat_messages x JOIN profiles p ON p.user_id = x.user_id WHERE x.status = 'hidden' AND coalesce(x.flag_reason, '') <> 'ban'
        UNION ALL SELECT 'deal', x.id, x.title || ' – ' || x.price::text || ' €', '', x.flag_reason, x.created_at, p.display_name, x.user_id FROM community_deals x JOIN profiles p ON p.user_id = x.user_id WHERE x.status = 'hidden' AND coalesce(x.flag_reason, '') <> 'ban'
      ) q ORDER BY created_at DESC LIMIT 100`));
    const log = rows(await db.execute(sql`
      SELECT m.id, m.action, m.target_type, m.target_id, m.reason, m.created_at, a.display_name AS actor, u.display_name AS user_name
      FROM moderation_log m LEFT JOIN profiles a ON a.user_id = m.actor_id LEFT JOIN profiles u ON u.user_id = m.user_id
      ORDER BY m.id DESC LIMIT 60`));
    const restricted = rows(await db.execute(sql`
      SELECT user_id, display_name, banned, muted_until FROM profiles WHERE banned OR muted_until > now() ORDER BY display_name LIMIT 200`));
    const [stats] = rows(await db.execute(sql`
      SELECT (SELECT count(*)::int FROM community_posts WHERE created_at > now() - interval '1 day') AS posts_24h,
        (SELECT count(*)::int FROM chat_messages WHERE created_at > now() - interval '1 day') AS chat_24h,
        (SELECT count(*)::int FROM moderation_log WHERE action = 'auto_block' AND created_at > now() - interval '1 day') AS blocked_24h`));
    return c.json({ reports: open, flagged, log, restricted, stats });
  });

  app.post("/api/admin/moderation", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const targetType = str(b.targetType, 20), targetId = str(b.targetId, 80), action = str(b.action, 20);
    const r = await applyModeration({ actorId: c.get("user").id, targetType, targetId, action, days: Number(b.days), reason: str(b.reason, 300) });
    if (!r.ok) return c.json({ error: r.error }, 400);
    // Offene Meldungen zu diesem Inhalt schließen
    if (["hide", "remove", "restore"].includes(action)) {
      await db.update(reports).set({ status: action === "restore" ? "dismissed" : "resolved" })
        .where(and(eq(reports.targetType, targetType), eq(reports.targetId, targetId), eq(reports.status, "open")));
    }
    if (b.reportId) await db.update(reports).set({ status: b.dismiss ? "dismissed" : "resolved" }).where(eq(reports.id, int(b.reportId, 1, 2 ** 31 - 1, 0)));
    return c.json({ ok: true });
  });
}
