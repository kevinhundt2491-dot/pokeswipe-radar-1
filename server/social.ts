// Sammler-Freunde, privater 1:1-Chat, direkter Tausch im Chat und Treffen-Planer.
// Alles mit Login-Pflicht (Netlify Identity) und Netlify Database; Schreiben geht durch denselben Wort-/Link-Filter
// und dieselben Limits wie die übrige Community (guardWrite). Blockierte Nutzer erreichen sich gegenseitig nicht.
// Mitteilungen (Glocke + Web-Push) bei Freundschaftsanfragen, Nachrichten, Tausch-Vorschlägen und Treffen-Einladungen.
import { and, eq, or, sql } from "drizzle-orm";
import { db, profiles, friendships, directMessages, trades, moderationLog } from "../db/index.ts";
import { blockedIds, isBlockedBetween, guardWrite } from "./community.ts";
import { profileSlug } from "./community-logic.ts";
import { sanitizeAvatarUrl } from "./profile-prefs-logic.ts";
import { presenceBadges } from "./presence.ts";
import { friendState, parseMeetup, meetupText, type FriendState } from "./social-logic.ts";
import { notify } from "./prices.ts";
import { str, int, rows, rateLimit } from "./util.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
const ID_MAX = 2 ** 31 - 1;
export const dmLink = (userId: string) => `/?tab=community&dm=${encodeURIComponent(userId)}`;
export const FRIENDS_LINK = "/?tab=community&friends=1";

async function pairRow(a: string, b: string) {
  const [r] = await db.select().from(friendships).where(or(
    and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
    and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
  )).orderBy(sql`CASE WHEN ${friendships.status} = 'accepted' THEN 0 WHEN ${friendships.status} = 'pending' THEN 1 ELSE 2 END`).limit(1);
  return r ?? null;
}
export async function friendStateOf(me: string, other: string): Promise<FriendState> {
  return friendState(await pairRow(me, other), me);
}

const personOf = (p: any) => ({
  id: String(p.user_id), name: String(p.display_name || "Sammler"), slug: profileSlug(p.display_name), city: String(p.city || ""),
  avatar: sanitizeAvatarUrl(p.avatar_url), publicProfile: Boolean(p.public_profile),
  badges: presenceBadges({ plan: p.plan, planUntil: p.plan_until, bonusUntil: p.bonus_until, bonusPlan: p.bonus_plan, creatorAt: p.creator_at, founderAt: p.founder_at }),
});

/** Nur eine Mitteilung je Absender → Empfänger und Zeitfenster (verhindert Push-Flut im laufenden Chat). */
async function notifyOnce(userId: string, title: string, body: string, link: string, minutes: number) {
  const [recent] = rows(await db.execute(sql`SELECT 1 AS x FROM notifications WHERE user_id = ${userId} AND link = ${link}
    AND title = ${title.slice(0, 120)} AND created_at > now() - make_interval(mins => ${minutes}) LIMIT 1`));
  if (!recent) await notify(userId, title, body, link);
}

function dmOut(m: any, me: string) {
  return {
    id: Number(m.id), kind: String(m.kind), body: String(m.body || ""), meta: m.meta ?? null, mine: String(m.user_id) === me,
    createdAt: m.created_at, read: Boolean(m.read_at), pending: m.status === "hidden",
  };
}

export function registerSocial(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  // ---------------------------------------------------------------- Freunde
  app.get("/api/friends", auth, async (c: any) => {
    const me = c.get("user").id;
    const blocked = await blockedIds(me);
    const list = rows(await db.execute(sql`
      SELECT f.id AS fid, f.status, f.requester_id, f.addressee_id, f.created_at AS since, f.responded_at,
        p.user_id, p.display_name, p.city, p.avatar_url, p.public_profile, p.plan, p.plan_until, p.bonus_until, p.bonus_plan, p.creator_at, p.founder_at
      FROM friendships f JOIN profiles p ON p.user_id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      WHERE (f.requester_id = ${me} OR f.addressee_id = ${me}) AND f.status IN ('pending', 'accepted') AND NOT p.banned
      ORDER BY coalesce(f.responded_at, f.created_at) DESC LIMIT 500`)).filter((r: any) => !blocked.includes(String(r.user_id)));
    const unread = rows(await db.execute(sql`SELECT user_id, count(*)::int AS n FROM direct_messages
      WHERE recipient_id = ${me} AND read_at IS NULL AND status = 'visible' GROUP BY user_id`));
    const unreadOf = new Map(unread.map((r: any) => [String(r.user_id), Number(r.n) || 0]));
    const row = (r: any) => ({ ...personOf(r), requestId: Number(r.fid), since: r.responded_at || r.since, unread: unreadOf.get(String(r.user_id)) || 0 });
    return c.json({
      friends: list.filter((r: any) => r.status === "accepted").map(row),
      incoming: list.filter((r: any) => r.status === "pending" && String(r.addressee_id) === me).map(row),
      outgoing: list.filter((r: any) => r.status === "pending" && String(r.requester_id) === me).map(row),
    });
  });

  app.get("/api/friends/status/:id", auth, async (c: any) => {
    const me = c.get("user").id, other = str(c.req.param("id"), 80);
    return c.json({ state: other === me ? "self" : await friendStateOf(me, other) });
  });

  /** ➕ Freundschaftsanfrage senden (liegt schon eine Gegen-Anfrage vor, wird sie direkt angenommen). */
  app.post("/api/friends/:id", auth, async (c: any) => {
    const me = c.get("user").id, other = str(c.req.param("id"), 80);
    if (!other || other === me) return c.json({ error: "Du kannst dir nicht selbst eine Anfrage schicken." }, 400);
    if (!c.get("user").confirmed) return c.json({ error: "Bitte bestätige zuerst deine E-Mail-Adresse." }, 403);
    if (!(await rateLimit(`friendreq:${me}`, 20, 3600_000))) return c.json({ error: "Zu viele Anfragen – bitte später erneut versuchen." }, 429);
    const [p] = await db.select({ id: profiles.userId, banned: profiles.banned }).from(profiles).where(eq(profiles.userId, other)).limit(1);
    if (!p || p.banned) return c.json({ error: "Sammler nicht gefunden." }, 404);
    if (await isBlockedBetween(me, other)) return c.json({ error: "Nicht möglich." }, 403);
    const name = c.get("profile").displayName;
    const row = await pairRow(me, other);
    const st = friendState(row, me);
    if (st === "friends") return c.json({ state: "friends" });
    if (st === "pending_out") return c.json({ state: "pending_out" });
    if (st === "pending_in" && row) {
      await db.update(friendships).set({ status: "accepted", respondedAt: new Date() }).where(eq(friendships.id, row.id));
      await notify(other, `🤝 ${name} hat deine Freundschaftsanfrage angenommen`, "Ihr könnt jetzt privat chatten, Karten tauschen und Treffen vereinbaren.", dmLink(me));
      return c.json({ state: "friends" });
    }
    // Abgelehnte Anfrage: frühestens nach 7 Tagen erneut
    if (row && row.status === "declined") {
      if (row.requesterId === me && row.respondedAt && Date.now() - new Date(row.respondedAt).getTime() < 7 * 86400_000) {
        return c.json({ error: "Diese Anfrage wurde kürzlich abgelehnt – bitte später erneut versuchen." }, 429);
      }
      await db.delete(friendships).where(eq(friendships.id, row.id));
    }
    await db.insert(friendships).values({ requesterId: me, addresseeId: other }).onConflictDoUpdate({
      target: [friendships.requesterId, friendships.addresseeId], set: { status: "pending", createdAt: new Date(), respondedAt: null },
    });
    await notify(other, `➕ Freundschaftsanfrage von ${name}`, "Tippe hier, um anzunehmen oder abzulehnen.", FRIENDS_LINK);
    return c.json({ state: "pending_out" }, 201);
  });

  app.post("/api/friends/:id/respond", auth, async (c: any) => {
    const me = c.get("user").id, other = str(c.req.param("id"), 80);
    const accept = Boolean((await body(c)).accept);
    const [row] = await db.update(friendships).set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
      .where(and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me), eq(friendships.status, "pending"))).returning();
    if (!row) return c.json({ error: "Anfrage nicht gefunden." }, 404);
    if (accept) await notify(other, `🤝 ${c.get("profile").displayName} hat deine Freundschaftsanfrage angenommen`, "Ihr könnt jetzt privat chatten, Karten tauschen und Treffen vereinbaren.", dmLink(me));
    return c.json({ state: accept ? "friends" : "none" });
  });

  app.delete("/api/friends/:id", auth, async (c: any) => {
    const me = c.get("user").id, other = str(c.req.param("id"), 80);
    await db.delete(friendships).where(or(
      and(eq(friendships.requesterId, me), eq(friendships.addresseeId, other)),
      and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me)),
    ));
    return c.json({ state: "none" });
  });

  /** Kleine Zusammenfassung für Glocke & Community-Kopf: offene Anfragen, ungelesene Nachrichten. */
  app.get("/api/social/summary", auth, async (c: any) => {
    const me = c.get("user").id;
    const [r] = rows(await db.execute(sql`SELECT
      (SELECT count(*)::int FROM friendships f JOIN profiles p ON p.user_id = f.requester_id WHERE f.addressee_id = ${me} AND f.status = 'pending' AND NOT p.banned) AS incoming,
      (SELECT count(*)::int FROM direct_messages WHERE recipient_id = ${me} AND read_at IS NULL AND status = 'visible') AS unread`));
    return c.json({ incoming: Number(r?.incoming) || 0, unread: Number(r?.unread) || 0 });
  });

  // ---------------------------------------------------------------- 1:1-Chat
  app.get("/api/dm", auth, async (c: any) => {
    const me = c.get("user").id;
    const blocked = await blockedIds(me);
    const list = rows(await db.execute(sql`
      SELECT DISTINCT ON (x.partner) x.partner, x.id, x.kind, x.body, x.created_at, x.user_id,
        p.user_id AS pid, p.display_name, p.city, p.avatar_url, p.public_profile, p.plan, p.plan_until, p.bonus_until, p.bonus_plan, p.creator_at, p.founder_at,
        (SELECT count(*)::int FROM direct_messages u WHERE u.user_id = x.partner AND u.recipient_id = ${me} AND u.read_at IS NULL AND u.status = 'visible') AS unread
      FROM (SELECT *, CASE WHEN user_id = ${me} THEN recipient_id ELSE user_id END AS partner FROM direct_messages
            WHERE (user_id = ${me} OR recipient_id = ${me}) AND status = 'visible') x
      JOIN profiles p ON p.user_id = x.partner
      WHERE NOT p.banned
      ORDER BY x.partner, x.id DESC LIMIT 100`)).filter((r: any) => !blocked.includes(String(r.partner)));
    list.sort((a: any, b: any) => Number(b.id) - Number(a.id));
    return c.json({
      conversations: list.map((r: any) => ({
        partner: personOf({ ...r, user_id: r.pid }), unread: Number(r.unread) || 0,
        last: { kind: r.kind, body: String(r.body || "").slice(0, 120), mine: String(r.user_id) === me, createdAt: r.created_at },
      })),
    });
  });

  app.get("/api/dm/:id", auth, async (c: any) => {
    const me = c.get("user").id, other = str(c.req.param("id"), 80);
    if (!other || other === me) return c.json({ error: "Ungültiger Chat." }, 400);
    const after = int(c.req.query("after"), 0, ID_MAX, 0);
    const [p] = rows(await db.execute(sql`SELECT user_id, display_name, city, avatar_url, public_profile, binder_visible, banned, plan, plan_until, bonus_until, bonus_plan, creator_at, founder_at FROM profiles WHERE user_id = ${other}`));
    if (!p || p.banned) return c.json({ error: "Sammler nicht gefunden." }, 404);
    const blocked = await isBlockedBetween(me, other);
    const list = blocked ? [] : rows(await db.execute(sql`
      SELECT * FROM (SELECT id, user_id, recipient_id, kind, body, meta, status, read_at, created_at FROM direct_messages
        WHERE ((user_id = ${me} AND recipient_id = ${other}) OR (user_id = ${other} AND recipient_id = ${me}))
          AND id > ${after} AND (status = 'visible' OR (status = 'hidden' AND user_id = ${me}))
        ORDER BY id DESC LIMIT 80) q ORDER BY id`));
    // Aktualisierte Tausch-/Treffen-Karten (Status ändert sich nachträglich) → die letzten 30 Karten immer mitschicken
    const cards = after ? rows(await db.execute(sql`SELECT id, user_id, recipient_id, kind, body, meta, status, read_at, created_at FROM direct_messages
      WHERE ((user_id = ${me} AND recipient_id = ${other}) OR (user_id = ${other} AND recipient_id = ${me})) AND kind <> 'text' AND status = 'visible' AND id <= ${after}
      ORDER BY id DESC LIMIT 30`)) : [];
    await db.execute(sql`UPDATE direct_messages SET read_at = now() WHERE user_id = ${other} AND recipient_id = ${me} AND read_at IS NULL`);
    // Tausch-Status der verknüpften Tausche (für „Annehmen / Anpassen / Abschließen“ direkt im Chat)
    const tradeIds = [...new Set([...list, ...cards].filter((m: any) => m.kind === "trade").map((m: any) => Number(m.meta?.tradeId)).filter((x) => x > 0))];
    const tradeRows = tradeIds.length ? rows(await db.execute(sql`SELECT id, status, from_user, to_user, offer, request, from_value_cents, to_value_cents, cash_cents, cash_payer
      FROM trades WHERE id IN (${sql.join(tradeIds.map((i) => sql`${i}`), sql`, `)}) AND (from_user = ${me} OR to_user = ${me})`)) : [];
    return c.json({
      partner: { ...personOf(p), binderVisible: Boolean(p.binder_visible) },
      friend: await friendStateOf(me, other), blocked,
      messages: list.map((m: any) => dmOut(m, me)),
      updated: cards.map((m: any) => dmOut(m, me)),
      trades: tradeRows.map((t: any) => ({
        id: Number(t.id), status: String(t.status), role: String(t.from_user) === me ? "sender" : "receiver", offer: t.offer, request: t.request,
        fromValueCents: Number(t.from_value_cents) || 0, toValueCents: Number(t.to_value_cents) || 0, cashCents: Number(t.cash_cents) || 0, cashPayer: t.cash_payer,
      })),
    });
  });

  /** Nachricht senden: Text, Tausch-Vorschlag (bestehender strukturierter Tausch) oder Treffen-Einladung. */
  app.post("/api/dm/:id", auth, async (c: any) => {
    const user = c.get("user"), me = user.id, other = str(c.req.param("id"), 80);
    if (!other || other === me) return c.json({ error: "Ungültiger Chat." }, 400);
    const b = await body(c);
    const kind = ["text", "trade", "meetup"].includes(String(b.kind)) ? String(b.kind) : "text";
    const [p] = await db.select({ id: profiles.userId, banned: profiles.banned }).from(profiles).where(eq(profiles.userId, other)).limit(1);
    if (!p || p.banned) return c.json({ error: "Sammler nicht gefunden." }, 404);
    if (await isBlockedBetween(me, other)) return c.json({ error: "Nachricht nicht möglich." }, 403);
    const name = c.get("profile").displayName;
    let text = str(b.body, 1000);
    let meta: any = null;
    if (kind === "trade") {
      const tradeId = int(b.tradeId, 1, ID_MAX, 0);
      const [t] = await db.select({ id: trades.id, offer: trades.offer, request: trades.request }).from(trades).where(and(eq(trades.id, tradeId),
        or(and(eq(trades.fromUser, me), eq(trades.toUser, other)), and(eq(trades.fromUser, other), eq(trades.toUser, me))))).limit(1);
      if (!t) return c.json({ error: "Tausch nicht gefunden." }, 404);
      meta = { tradeId: t.id };
      text = text || `🔄 Tausch-Vorschlag: ${t.offer} ↔ ${t.request}`.slice(0, 1000);
    } else if (kind === "meetup") {
      const m = parseMeetup(b);
      if ("error" in m) return c.json({ error: m.error }, 400);
      meta = m;
      text = `${meetupText(m)}${m.note ? ` – ${m.note}` : ""}`;
    }
    if (!text) return c.json({ error: "Leere Nachricht" }, 400);
    const g = await guardWrite(c, "dm", kind === "trade" ? "" : text);
    if ("error" in g) return c.json({ error: g.error }, g.status);
    const review = kind !== "trade" && g.verdict.action === "review";
    const [m] = await db.insert(directMessages).values({
      userId: me, recipientId: other, kind, body: text, meta, status: review ? "hidden" : "visible", flagReason: review ? g.verdict.reason : null,
    }).returning();
    if (review) await db.insert(moderationLog).values({ action: "auto_hide", targetType: "dm", targetId: String(m.id), userId: me, reason: g.verdict.reason });
    else if (kind === "meetup") await notify(other, `📍 ${name} möchte sich mit dir treffen`, text.slice(0, 200), dmLink(me));
    else if (kind === "trade") await notify(other, `🔄 ${name} schlägt dir einen Tausch vor`, text.slice(0, 200), dmLink(me));
    else await notifyOnce(other, `💬 Neue Nachricht von ${name}`, text.slice(0, 160), dmLink(me), 3);
    return c.json({ message: dmOut(m, me), pending: review, notice: review ? `Deine Nachricht wird kurz geprüft (${g.verdict.reason}).` : "" }, 201);
  });

  /** Treffen beantworten: ✅ zusagen oder 🕒 andere Zeit vorschlagen (neue Einladung, alte wird als „Gegenvorschlag“ markiert). */
  app.post("/api/dm/messages/:mid/meetup", auth, async (c: any) => {
    const me = c.get("user").id;
    const mid = int(c.req.param("mid"), 1, ID_MAX, 0);
    const b = await body(c);
    const [m] = await db.select().from(directMessages).where(and(eq(directMessages.id, mid), eq(directMessages.kind, "meetup"), eq(directMessages.status, "visible"))).limit(1);
    if (!m || m.recipientId !== me) return c.json({ error: "Treffen nicht gefunden." }, 404);
    const meta = (m.meta || {}) as any;
    if (meta.status !== "proposed") return c.json({ error: "Dieses Treffen wurde schon beantwortet." }, 409);
    if (await isBlockedBetween(me, m.userId)) return c.json({ error: "Nicht möglich." }, 403);
    const name = c.get("profile").displayName;
    const action = String(b.action);
    if (action === "accept") {
      await db.update(directMessages).set({ meta: { ...meta, status: "accepted", answeredAt: new Date().toISOString() } }).where(eq(directMessages.id, mid));
      const text = `✅ Treffen zugesagt: ${meetupText(meta)}`;
      const [r] = await db.insert(directMessages).values({ userId: me, recipientId: m.userId, kind: "text", body: text }).returning();
      await notify(m.userId, `✅ ${name} hat dem Treffen zugesagt`, meetupText(meta), dmLink(me));
      return c.json({ ok: true, message: dmOut(r, me) });
    }
    if (action === "counter") {
      const next = parseMeetup({ ...meta, ...b, place: b.place || meta.place, kind: b.kind || meta.kind });
      if ("error" in next) return c.json({ error: next.error }, 400);
      const g = await guardWrite(c, "dm", `${next.place} ${next.note}`);
      if ("error" in g) return c.json({ error: g.error }, g.status);
      await db.update(directMessages).set({ meta: { ...meta, status: "countered", answeredAt: new Date().toISOString() } }).where(eq(directMessages.id, mid));
      const text = `🕒 Anderer Vorschlag – ${meetupText(next)}${next.note ? ` – ${next.note}` : ""}`;
      const [r] = await db.insert(directMessages).values({ userId: me, recipientId: m.userId, kind: "meetup", body: text, meta: { ...next, counterOf: mid } }).returning();
      await notify(m.userId, `🕒 ${name} schlägt eine andere Zeit vor`, meetupText(next), dmLink(me));
      return c.json({ ok: true, message: dmOut(r, me) });
    }
    if (action === "decline") {
      await db.update(directMessages).set({ meta: { ...meta, status: "declined", answeredAt: new Date().toISOString() } }).where(eq(directMessages.id, mid));
      return c.json({ ok: true });
    }
    return c.json({ error: "Unbekannte Aktion" }, 400);
  });

  app.delete("/api/dm/messages/:mid", auth, async (c: any) => {
    const me = c.get("user").id;
    const mid = int(c.req.param("mid"), 1, ID_MAX, 0);
    const [r] = await db.update(directMessages).set({ status: "removed", flagReason: "vom Autor gelöscht" })
      .where(and(eq(directMessages.id, mid), eq(directMessages.userId, me))).returning({ id: directMessages.id });
    return r ? c.json({ ok: true }) : c.json({ error: "Nicht gefunden" }, 404);
  });
}
