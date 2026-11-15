// PokeSwipe & Radar – Restock- & Vorbestell-Radar (mit Verzögerung für Free), Graded-Portfolio,
// Grading-Einsendungs-Tracker und KI-Fake-Check.
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  db, profiles, restockWatches, restockDrops, restockConfirmations, restockSubscriptions,
  gradedCards, gradingSubmissions, cardScans, affiliateClicks, cards,
} from "../db/index.ts";
import { PLANS, effectivePlan, type PlanId } from "./plans.ts";
import { CARD_ID_RE, getCard, cardPrice, notify } from "./prices.ts";
import { verifyIdentityToken, isAdmin } from "./auth.ts";
import { berlinDay } from "./logic.ts";
import {
  SHOPS, shopForUrl, parseAvailability, uvpVerdict, affiliateUrl, matchesFilter, isDropTransition,
  GRADE_COMPANIES, SUBMISSION_STATUS, type Availability,
} from "./drops-logic.ts";
import { str, money, int, rows, rateLimit, clientIp, euro } from "./util.ts";

const TAGS = () => ({
  amazon: str(process.env.AMAZON_PARTNER_TAG, 40),
  cardmarket: str(process.env.CARDMARKET_PARTNER_ID, 40),
});
const KINDS = ["display", "etb", "ttb", "bundle", "booster", "tin", "collection", "other"];
const num = (v: unknown) => (v == null ? null : Number(v));
const CONFIRMATIONS_NEEDED = 2;
const EPN_CAMPAIGN_ID = "5339244109";
const ebaySold = (q: string) =>
  `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=${EPN_CAMPAIGN_ID}&customid=pokeswipe-graded&toolid=10001&mkevt=1`;

/** Link zur offiziellen Zertifikats-Prüfung der Grading-Firma. */
export function certUrl(company: string, cert: string) {
  const c = encodeURIComponent(cert);
  if (!cert) return "";
  if (company === "PSA") return `https://www.psacard.com/cert/${c}`;
  if (company === "CGC") return `https://www.cgccards.com/certlookup/${c}/`;
  if (company === "BGS") return "https://www.beckett.com/grading/card-lookup";
  if (company === "TAG") return `https://my.taggrading.com/card/${c}`;
  return "";
}

async function viewerPlan(c: any): Promise<{ userId: string | null; plan: PlanId; admin: boolean }> {
  const user = await verifyIdentityToken(c).catch(() => null);
  if (!user) return { userId: null, plan: "free", admin: false };
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  return { userId: user.id, plan: effectivePlan(p), admin: isAdmin(user) };
}

/** Ist ein beobachtetes Produkt gerade frisch verfügbar und für diesen Tarif noch in der Verzögerung? */
function watchLocked(w: typeof restockWatches.$inferSelect, delayMin: number, admin: boolean) {
  if (admin || delayMin <= 0 || !w.lastChangeAt) return false;
  if (w.status !== "in_stock" && w.status !== "preorder") return false;
  return new Date(w.lastChangeAt).getTime() + delayMin * 60_000 > Date.now();
}

// ---------------------------------------------------------------------------
// Automatische Prüfung der Produktseiten
// ---------------------------------------------------------------------------
const MAX_PAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

/** Liest höchstens maxBytes einer Antwort (Schutz gegen riesige Seiten). */
async function readLimited(res: Response, maxBytes: number) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch {}
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

async function fetchProductPage(url: string) {
  if (!shopForUrl(url)) throw new Error("Shop nicht erlaubt");
  const signal = AbortSignal.timeout(8000);
  let current = url;
  // Weiterleitungen manuell folgen: jedes Ziel muss wieder ein erlaubter Shop sein (kein SSRF über offene Redirects)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokeSwipeRadar/2.0; Restock-Check)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch {}
      if (!loc) throw new Error(`HTTP ${res.status}`);
      const next = new URL(loc, current).href;
      if (!shopForUrl(next)) throw new Error("Weiterleitung auf fremde Domain");
      current = next;
      continue;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch {}
      throw new Error(`HTTP ${res.status}`);
    }
    return parseAvailability(await readLimited(res, MAX_PAGE_BYTES));
  }
  throw new Error("Zu viele Weiterleitungen");
}

async function makeDrop(values: typeof restockDrops.$inferInsert) {
  const [row] = await db.insert(restockDrops).values(values).returning();
  return row;
}

async function checkWatch(w: typeof restockWatches.$inferSelect) {
  let result: { status: Availability; price: number | null };
  try {
    result = await fetchProductPage(w.url);
  } catch (e: any) {
    await db.update(restockWatches).set({ lastCheckedAt: new Date(), failCount: w.failCount + 1 }).where(eq(restockWatches.id, w.id));
    return { id: w.id, error: String(e?.message || e) };
  }
  const changed = result.status !== "unknown" && result.status !== w.status;
  await db.update(restockWatches).set({
    lastCheckedAt: new Date(), failCount: 0,
    ...(result.status !== "unknown" ? { status: result.status } : {}),
    ...(result.price ? { lastPrice: result.price.toFixed(2) } : {}),
    ...(changed ? { lastChangeAt: new Date() } : {}),
  }).where(eq(restockWatches.id, w.id));
  // Erste Prüfung legt nur den Ausgangszustand fest – kein Alarm
  if (w.lastCheckedAt && changed && isDropTransition(w.status, result.status)) {
    // Kein zweiter Alarm für dasselbe Produkt innerhalb von 30 Minuten (Shops schwanken oft kurz)
    const [recent] = await db.select({ id: restockDrops.id }).from(restockDrops)
      .where(and(eq(restockDrops.watchId, w.id), sql`${restockDrops.createdAt} > now() - interval '30 minutes'`)).limit(1);
    if (!recent) {
      await makeDrop({
        watchId: w.id, kind: result.status === "preorder" ? "preorder" : "restock", source: "auto",
        title: w.name, shop: w.shop, url: w.url, price: (result.price ?? num(w.lastPrice))?.toFixed(2) ?? null,
        uvp: w.uvp, status: "live", liveAt: new Date(),
      });
      return { id: w.id, drop: result.status };
    }
  }
  return { id: w.id, status: result.status };
}

type Sub = { userId: string; plan: PlanId; filter: typeof restockSubscriptions.$inferSelect };
async function subscribers(): Promise<Sub[]> {
  const list = await db.select({ s: restockSubscriptions, p: profiles }).from(restockSubscriptions)
    .innerJoin(profiles, eq(profiles.userId, restockSubscriptions.userId))
    .where(and(eq(restockSubscriptions.enabled, true), eq(profiles.banned, false))).limit(20_000);
  return list.map(({ s, p }) => ({ userId: s.userId, plan: effectivePlan(p), filter: s }));
}

async function sendDrop(drop: typeof restockDrops.$inferSelect, subs: Sub[], deadline: number) {
  const v = uvpVerdict(num(drop.price), num(drop.uvp));
  const shop = SHOPS[drop.shop]?.label || drop.shop;
  const icon = drop.kind === "preorder" ? "📝 Vorbestellung offen" : "🚨 Restock";
  const title = `${icon}: ${drop.title}`.slice(0, 120);
  const priceText = drop.price ? `${euro(Number(drop.price))} • ${v.level === "fair" ? "✅" : v.level === "scalper" ? "❌" : "⚠️"} ${v.label}` : "Preis im Shop prüfen";
  const body = `${shop}${drop.city ? ` (${drop.city})` : ""} • ${priceText}`;
  let sent = 0;
  for (let i = 0; i < subs.length; i += 25) {
    if (Date.now() > deadline) break;
    await Promise.all(subs.slice(i, i + 25).map((s) => notify(s.userId, title, body, `/?tab=flip&sub=drops&drop=${drop.id}`).catch(() => {})));
    sent += Math.min(25, subs.length - i);
  }
  return sent;
}

/** Verschickt fällige Restock-Alarme: bezahlte Tarife sofort, Free nach der Verzögerung. */
async function dispatchDrops(deadline: number) {
  let paid = 0, free = 0;
  const pendingPaid = await db.select().from(restockDrops)
    .where(and(eq(restockDrops.status, "live"), eq(restockDrops.paidNotified, false), sql`${restockDrops.liveAt} > now() - interval '6 hours'`)).limit(10);
  const freeDelay = PLANS.free.restockDelayMin;
  const pendingFree = await db.select().from(restockDrops)
    .where(and(eq(restockDrops.status, "live"), eq(restockDrops.freeNotified, false),
      sql`${restockDrops.liveAt} <= now() - make_interval(mins => ${freeDelay}::int)`, sql`${restockDrops.liveAt} > now() - interval '6 hours'`)).limit(10);
  if (!pendingPaid.length && !pendingFree.length) return { paid, free };
  const subs = await subscribers();
  for (const d of pendingPaid) {
    const [claimed] = await db.update(restockDrops).set({ paidNotified: true })
      .where(and(eq(restockDrops.id, d.id), eq(restockDrops.paidNotified, false))).returning();
    if (!claimed) continue;
    const target = subs.filter((s) => PLANS[s.plan].restockDelayMin === 0 && s.userId !== d.reportedBy
      && matchesFilter(d, s.filter, PLANS[s.plan].restockFilters));
    paid += await sendDrop(d, target, deadline);
  }
  for (const d of pendingFree) {
    const [claimed] = await db.update(restockDrops).set({ freeNotified: true })
      .where(and(eq(restockDrops.id, d.id), eq(restockDrops.freeNotified, false))).returning();
    if (!claimed) continue;
    const target = subs.filter((s) => PLANS[s.plan].restockDelayMin > 0 && s.userId !== d.reportedBy
      && matchesFilter(d, s.filter, PLANS[s.plan].restockFilters));
    free += await sendDrop(d, target, deadline);
  }
  return { paid, free };
}

/** Erinnert an Grading-Einsendungen, deren erwartetes Datum überschritten ist. */
export async function runSubmissionReminders() {
  const today = berlinDay(new Date());
  const due = await db.select().from(gradingSubmissions).where(and(
    inArray(gradingSubmissions.status, ["sent", "arrived", "grading", "shipped"]),
    eq(gradingSubmissions.reminderSent, false), sql`${gradingSubmissions.expectedDay} < ${today}::date`,
  )).limit(200);
  for (const s of due) {
    await db.update(gradingSubmissions).set({ reminderSent: true }).where(eq(gradingSubmissions.id, s.id));
    await notify(s.userId, `⏰ ${s.company}-Einsendung überfällig`, `„${s.title || `${s.cardCount} Karten`}“ sollte bis ${s.expectedDay} fertig sein. Prüfe den Status und trag ihn ein.`, "/?tab=portfolio&sub=graded");
  }
  return due.length;
}

/** Läuft alle 2 Minuten: Produktseiten prüfen, Alarme verschicken. */
export async function runRestockJobs({ deadlineMs = 20_000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  const due = await db.select().from(restockWatches).where(and(
    eq(restockWatches.active, true), eq(restockWatches.autoCheck, true),
    // Nach Fehlern seltener prüfen (max. alle ~30 Minuten), damit Shops nicht unnötig belastet werden
    sql`(${restockWatches.lastCheckedAt} IS NULL OR ${restockWatches.lastCheckedAt} < now() - make_interval(mins => LEAST(30, 2 + ${restockWatches.failCount} * 4)))`,
  )).orderBy(sql`${restockWatches.lastCheckedAt} ASC NULLS FIRST`).limit(30);
  const checks: any[] = [];
  for (let i = 0; i < due.length; i += 6) {
    if (Date.now() > deadline - 8000) break;
    checks.push(...(await Promise.all(due.slice(i, i + 6).map(checkWatch))));
  }
  const sent = await dispatchDrops(deadline);
  return { checked: checks.length, drops: checks.filter((c) => c.drop).length, errors: checks.filter((c) => c.error).length, ...sent };
}

// ---------------------------------------------------------------------------
// KI-Fake-Check
// ---------------------------------------------------------------------------
async function fakeChecksUsed(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cardScans)
    .where(and(eq(cardScans.userId, userId), sql`${cardScans.result} LIKE 'Fake-Check%'`, sql`${cardScans.createdAt} > now() - interval '30 days'`));
  return Number(r?.n ?? 0);
}

/**
 * Reserviert atomar einen Fake-Check: erst eintragen, dann zählen. Nur die ersten `limit` Einträge
 * (nach ID) gelten – parallele Anfragen können das Monatslimit so nicht überschreiten.
 */
async function reserveFakeCheck(userId: string, limit: number): Promise<number | null> {
  const [row] = await db.insert(cardScans).values({ userId, result: "Fake-Check pending" }).returning({ id: cardScans.id });
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cardScans)
    .where(and(eq(cardScans.userId, userId), sql`${cardScans.result} LIKE 'Fake-Check%'`,
      sql`${cardScans.createdAt} > now() - interval '30 days'`, sql`${cardScans.id} <= ${row.id}`));
  if (Number(r?.n ?? 0) > limit) {
    await db.delete(cardScans).where(eq(cardScans.id, row.id));
    return null;
  }
  return row.id;
}

const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerDrops(app: any, hlp: { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> }) {
  const { auth, adminOnly, body } = hlp;
  const idParam = (c: any) => int(c.req.param("id"), 1, 2 ** 31 - 1, 0);

  // ------------------------------ Restock-Radar ------------------------------
  app.get("/api/restock", async (c: any) => {
    const viewer = await viewerPlan(c);
    const delay = PLANS[viewer.plan].restockDelayMin;
    const drops = await db.select().from(restockDrops)
      .where(and(inArray(restockDrops.status, ["live", "pending"]), sql`${restockDrops.createdAt} > now() - interval '7 days'`))
      .orderBy(desc(restockDrops.createdAt)).limit(60);
    let confirmed = new Set<number>();
    if (viewer.userId && drops.length) {
      const mine = await db.select({ id: restockConfirmations.dropId }).from(restockConfirmations)
        .where(and(eq(restockConfirmations.userId, viewer.userId), inArray(restockConfirmations.dropId, drops.map((d) => d.id))));
      confirmed = new Set(mine.map((m) => m.id));
    }
    const now = Date.now();
    const feed = drops.map((d) => {
      const liveAt = d.liveAt ? new Date(d.liveAt).getTime() : null;
      const unlockAt = liveAt ? liveAt + delay * 60_000 : null;
      const locked = d.status === "live" && unlockAt != null && unlockAt > now && !viewer.admin;
      return {
        id: d.id, kind: d.kind, source: d.source, status: d.status, shop: d.shop, shopLabel: SHOPS[d.shop]?.label || d.shop,
        title: locked ? "" : d.title, city: locked ? "" : d.city, price: locked ? null : num(d.price), uvp: num(d.uvp),
        verdict: locked ? null : uvpVerdict(num(d.price), num(d.uvp)), hasLink: Boolean(d.url), locked,
        unlockInMin: locked && unlockAt ? Math.ceil((unlockAt - now) / 60_000) : 0,
        confirmations: d.confirmations, confirmed: confirmed.has(d.id), mine: Boolean(viewer.userId) && d.reportedBy === viewer.userId,
        createdAt: d.createdAt, liveAt: d.liveAt,
      };
    });
    // Vorbestell- & Preis-Übersicht je Produkt (alle Shops)
    const watches = await db.select().from(restockWatches).where(eq(restockWatches.active, true))
      .orderBy(sql`${restockWatches.releaseDay} DESC NULLS LAST`, restockWatches.name).limit(300);
    const products = new Map<string, any>();
    for (const w of watches) {
      const key = w.name.toLowerCase();
      if (!products.has(key)) products.set(key, { name: w.name, setName: w.setName, kind: w.kind, releaseDay: w.releaseDay, uvp: num(w.uvp), offers: [] });
      const p = products.get(key);
      if (!p.uvp && w.uvp) p.uvp = num(w.uvp);
      // Frisch verfügbare Produkte erst nach der Tarif-Verzögerung zeigen (sonst wäre der Free-Delay umgehbar)
      const fresh = watchLocked(w, delay, viewer.admin);
      p.offers.push({
        id: w.id, shop: w.shop, shopLabel: SHOPS[w.shop]?.label || w.shop, status: fresh ? "unknown" : w.status,
        price: fresh ? null : num(w.lastPrice), verdict: fresh ? null : uvpVerdict(num(w.lastPrice), num(w.uvp)),
        checkedAt: w.lastCheckedAt, autoCheck: w.autoCheck, locked: fresh,
      });
    }
    let subscription = null;
    if (viewer.userId) {
      const [s] = await db.select().from(restockSubscriptions).where(eq(restockSubscriptions.userId, viewer.userId)).limit(1);
      subscription = s ? { enabled: s.enabled, preorders: s.preorders, shops: s.shops, keywords: s.keywords, maxPrice: num(s.maxPrice), uvpOnly: s.uvpOnly } : null;
    }
    const [stats] = rows(await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'live' AND live_at > now() - interval '7 days')::int AS week,
        (SELECT count(*)::int FROM restock_watches WHERE active AND auto_check) AS watched
      FROM restock_drops`));
    c.header("Cache-Control", "private, no-store");
    return c.json({
      feed, products: [...products.values()], subscription, plan: viewer.plan, delayMin: delay,
      freeDelayMin: PLANS.free.restockDelayMin, filters: PLANS[viewer.plan].restockFilters, isAdmin: viewer.admin,
      shops: Object.entries(SHOPS).map(([id, s]) => ({ id, label: s.label })),
      stats: { week: Number(stats?.week ?? 0), watched: Number(stats?.watched ?? 0) },
      confirmationsNeeded: CONFIRMATIONS_NEEDED,
    });
  });

  app.post("/api/restock/subscribe", auth, async (c: any) => {
    const b = await body(c), userId = c.get("user").id, plan: PlanId = c.get("plan");
    const filters = PLANS[plan].restockFilters;
    const shops = filters ? String(b.shops || "").split(",").map((s) => s.trim()).filter((s) => s in SHOPS).join(",") : "";
    const keywords = filters ? String(b.keywords || "").split(",").map((s) => str(s, 30).toLowerCase()).filter(Boolean).slice(0, 10).join(",") : "";
    const values = {
      userId, enabled: b.enabled !== false, preorders: b.preorders !== false, shops, keywords,
      maxPrice: filters ? money(b.maxPrice) : null, uvpOnly: filters ? Boolean(b.uvpOnly) : false,
    };
    await db.insert(restockSubscriptions).values(values)
      .onConflictDoUpdate({ target: restockSubscriptions.userId, set: { enabled: values.enabled, preorders: values.preorders, shops, keywords, maxPrice: values.maxPrice, uvpOnly: values.uvpOnly } });
    return c.json({ ok: true, filtersApplied: filters, delayMin: PLANS[plan].restockDelayMin });
  });

  // Community-Meldung: „Hier gibt es gerade UVP-Ware“
  app.post("/api/restock/report", auth, async (c: any) => {
    const b = await body(c), user = c.get("user"), profile = c.get("profile");
    if (!rateLimit(`restock-report:${user.id}`, 5, 3600_000)) return c.json({ error: "Maximal 5 Meldungen pro Stunde." }, 429);
    const title = str(b.title, 100);
    if (title.length < 4) return c.json({ error: "Bitte gib an, welches Produkt es gibt (z. B. „151 Display“)." }, 400);
    const rawUrl = str(b.url, 500);
    const shopFromUrl = rawUrl ? shopForUrl(rawUrl) : null;
    if (rawUrl && !shopFromUrl) return c.json({ error: "Link wird nicht unterstützt. Erlaubt sind die großen Shops (Amazon, Smyths, Müller, MediaMarkt, Otto …)." }, 400);
    const shop = shopFromUrl || (str(b.shop, 20) in SHOPS ? str(b.shop, 20) : "other");
    const city = str(b.city, 60);
    if (!rawUrl && !city) return c.json({ error: "Bitte einen Shop-Link oder die Stadt des Ladens angeben." }, 400);
    const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(restockDrops)
      .where(and(eq(restockDrops.reportedBy, user.id), sql`${restockDrops.createdAt} > now() - interval '1 hour'`));
    if (Number(recent?.n ?? 0) >= 5) return c.json({ error: "Maximal 5 Meldungen pro Stunde." }, 429);
    const admin = isAdmin(user);
    const row = await makeDrop({
      kind: b.kind === "preorder" ? "preorder" : "restock", source: admin ? "admin" : "community", title, shop,
      url: rawUrl, city, price: money(b.price), uvp: money(b.uvp), reportedBy: profile.userId,
      status: admin ? "live" : "pending", liveAt: admin ? new Date() : null,
    });
    if (admin) await dispatchDrops(Date.now() + 8000);
    return c.json({ ok: true, id: row.id, live: admin, needed: CONFIRMATIONS_NEEDED });
  });

  app.post("/api/restock/:id/confirm", auth, async (c: any) => {
    const id = idParam(c), userId = c.get("user").id;
    const [d] = await db.select().from(restockDrops).where(eq(restockDrops.id, id)).limit(1);
    if (!d || d.status === "removed") return c.json({ error: "Meldung nicht gefunden." }, 404);
    if (d.reportedBy === userId) return c.json({ error: "Eigene Meldungen kannst du nicht bestätigen." }, 400);
    const inserted = await db.insert(restockConfirmations).values({ dropId: id, userId }).onConflictDoNothing().returning();
    if (!inserted.length) return c.json({ ok: true, already: true });
    const [u] = await db.update(restockDrops).set({ confirmations: sql`${restockDrops.confirmations} + 1` })
      .where(eq(restockDrops.id, id)).returning();
    let live = u.status === "live";
    if (u.status === "pending" && u.confirmations >= CONFIRMATIONS_NEEDED) {
      const [promoted] = await db.update(restockDrops).set({ status: "live", liveAt: new Date() })
        .where(and(eq(restockDrops.id, id), eq(restockDrops.status, "pending"))).returning();
      if (promoted) { live = true; await dispatchDrops(Date.now() + 8000); }
    }
    return c.json({ ok: true, confirmations: u.confirmations, live });
  });

  // Shop-Link – mit Partner-Kennung und Klick-Zählung; Free erst nach der Verzögerung
  app.get("/api/restock/:id/link", async (c: any) => {
    const id = idParam(c);
    const [d] = await db.select().from(restockDrops).where(eq(restockDrops.id, id)).limit(1);
    c.header("Cache-Control", "no-store");
    if (!d || !d.url || d.status === "removed") return c.json({ error: "Für diese Meldung gibt es keinen Shop-Link." }, 404);
    const viewer = await viewerPlan(c);
    const delay = PLANS[viewer.plan].restockDelayMin;
    if (d.status === "live" && d.liveAt && new Date(d.liveAt).getTime() + delay * 60_000 > Date.now() && !viewer.admin) {
      const min = Math.ceil((new Date(d.liveAt).getTime() + delay * 60_000 - Date.now()) / 60_000);
      return c.json({ error: `Dieser Drop ist für Premium schon offen – im Free-Tarif in ${min} Min.`, upgrade: true }, 402);
    }
    if (rateLimit(`go:${clientIp(c)}`, 30, 60_000)) {
      try { await db.insert(affiliateClicks).values({ partner: `restock-${d.shop}`, userId: viewer.userId }); } catch {}
    }
    const target = affiliateUrl(d.url, TAGS());
    return shopForUrl(target) ? c.json({ url: target }) : c.json({ error: "Link ungültig." }, 400);
  });

  app.get("/api/restock/watch/:id/go", async (c: any) => {
    const [w] = await db.select().from(restockWatches).where(eq(restockWatches.id, idParam(c))).limit(1);
    c.header("Cache-Control", "no-store");
    if (!w || !w.active) return c.redirect("/?tab=flip&sub=drops", 302);
    const viewer = await viewerPlan(c);
    if (watchLocked(w, PLANS[viewer.plan].restockDelayMin, viewer.admin)) return c.redirect("/?tab=flip&sub=drops", 302);
    if (rateLimit(`go:${clientIp(c)}`, 30, 60_000)) {
      try {
        await db.insert(affiliateClicks).values({ partner: `preorder-${w.shop}`, userId: viewer.userId });
      } catch {}
    }
    const target = affiliateUrl(w.url, TAGS());
    c.header("Referrer-Policy", "no-referrer-when-downgrade");
    return c.redirect(shopForUrl(target) ? target : "/?tab=flip&sub=drops", 302);
  });

  // ------------------------------ Admin ------------------------------
  app.get("/api/admin/restock", auth, adminOnly, async (c: any) => {
    const watches = await db.select().from(restockWatches).orderBy(desc(restockWatches.createdAt)).limit(500);
    return c.json({ watches, amazonTag: Boolean(TAGS().amazon), cardmarketId: Boolean(TAGS().cardmarket) });
  });

  app.post("/api/admin/restock/watches", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const url = str(b.url, 500), shop = shopForUrl(url);
    if (!shop) return c.json({ error: "Bitte eine https-Produktseite eines unterstützten Shops angeben." }, 400);
    const name = str(b.name, 100);
    if (name.length < 3) return c.json({ error: "Bitte den Produktnamen angeben." }, 400);
    const releaseDay = /^\d{4}-\d{2}-\d{2}$/.test(String(b.releaseDay || "")) ? String(b.releaseDay) : null;
    const [row] = await db.insert(restockWatches).values({
      name, setName: str(b.setName, 80), kind: KINDS.includes(b.kind) ? b.kind : "other", shop, url,
      uvp: money(b.uvp), releaseDay, autoCheck: b.autoCheck !== false,
      status: ["in_stock", "preorder", "out_of_stock"].includes(b.status) ? b.status : "unknown",
    }).returning();
    return c.json(row);
  });

  app.patch("/api/admin/restock/watches/:id", auth, adminOnly, async (c: any) => {
    const b = await body(c), set: Record<string, any> = {};
    if (b.active !== undefined) set.active = Boolean(b.active);
    if (b.autoCheck !== undefined) set.autoCheck = Boolean(b.autoCheck);
    if (b.uvp !== undefined) set.uvp = money(b.uvp);
    if (["in_stock", "preorder", "out_of_stock", "unknown"].includes(b.status)) set.status = b.status;
    if (!Object.keys(set).length) return c.json({ error: "Nichts zu ändern." }, 400);
    const [row] = await db.update(restockWatches).set(set).where(eq(restockWatches.id, idParam(c))).returning();
    return row ? c.json(row) : c.json({ error: "Nicht gefunden." }, 404);
  });

  app.delete("/api/admin/restock/watches/:id", auth, adminOnly, async (c: any) => {
    await db.delete(restockWatches).where(eq(restockWatches.id, idParam(c)));
    return c.json({ ok: true });
  });

  app.delete("/api/restock/:id", auth, adminOnly, async (c: any) => {
    await db.update(restockDrops).set({ status: "removed" }).where(eq(restockDrops.id, idParam(c)));
    return c.json({ ok: true });
  });

  app.post("/api/admin/restock/run", auth, adminOnly, async (c: any) => c.json(await runRestockJobs({ deadlineMs: 18_000 })));

  // ------------------------------ Graded-Portfolio ------------------------------
  app.get("/api/graded", auth, async (c: any) => {
    const userId = c.get("user").id, plan: PlanId = c.get("plan");
    const list = await db.select({ g: gradedCards, trend: cards.trend, avg: cards.avg, low: cards.low })
      .from(gradedCards).leftJoin(cards, eq(cards.id, gradedCards.cardId))
      .where(eq(gradedCards.userId, userId)).orderBy(desc(gradedCards.createdAt)).limit(5000);
    const items = list.map(({ g, trend, avg, low }) => ({
      id: g.id, cardId: g.cardId, name: g.name, image: g.image, company: g.company, grade: Number(g.grade),
      certNumber: g.certNumber, certUrl: certUrl(g.company, g.certNumber), purchasePrice: num(g.purchasePrice),
      value: num(g.value), valueUpdatedAt: g.valueUpdatedAt, rawPrice: cardPrice({ trend, avg, low }) || null,
      soldUrl: ebaySold(`${g.name} ${g.company} ${Number(g.grade)}`), submissionId: g.submissionId,
    }));
    const subs = await db.select().from(gradingSubmissions).where(eq(gradingSubmissions.userId, userId))
      .orderBy(desc(gradingSubmissions.createdAt)).limit(500);
    const total = items.reduce((s, i) => s + (i.value ?? 0), 0);
    const cost = items.reduce((s, i) => s + (i.purchasePrice ?? 0), 0);
    return c.json({
      items, submissions: subs.map((s) => ({ ...s, declaredValue: num(s.declaredValue), cost: num(s.cost) })),
      totals: { value: total, cost, count: items.length, withoutValue: items.filter((i) => i.value == null).length },
      limits: { graded: PLANS[plan].gradedCards, submissions: PLANS[plan].submissions }, plan,
    });
  });

  const gradeOf = (v: unknown) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 1 && n <= 10 ? (Math.round(n * 2) / 2).toFixed(1) : null;
  };

  app.post("/api/graded", auth, async (c: any) => {
    const b = await body(c), userId = c.get("user").id, plan: PlanId = c.get("plan");
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(gradedCards).where(eq(gradedCards.userId, userId));
    if (Number(cnt?.n ?? 0) >= PLANS[plan].gradedCards) {
      return c.json({ error: `Limit erreicht: ${PLANS[plan].gradedCards} Graded-Karten im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    const grade = gradeOf(b.grade);
    if (!grade) return c.json({ error: "Bitte eine Note zwischen 1 und 10 angeben." }, 400);
    const company = (GRADE_COMPANIES as readonly string[]).includes(b.company) ? b.company : "other";
    let cardId: string | null = null, name = str(b.name, 100), image = "";
    if (b.cardId && CARD_ID_RE.test(String(b.cardId))) {
      const card = await getCard(String(b.cardId));
      if (card) { cardId = card.id; name = name || `${card.name}${card.setName ? ` (${card.setName})` : ""}`; image = card.image; }
    }
    if (name.length < 2) return c.json({ error: "Bitte die Karte auswählen oder einen Namen eingeben." }, 400);
    const value = money(b.value);
    // Nur eigene Einsendungen verknüpfen
    let submissionId: number | null = int(b.submissionId, 1, 2 ** 31 - 1, 0) || null;
    if (submissionId) {
      const [own] = await db.select({ id: gradingSubmissions.id }).from(gradingSubmissions)
        .where(and(eq(gradingSubmissions.id, submissionId), eq(gradingSubmissions.userId, userId))).limit(1);
      if (!own) submissionId = null;
    }
    const [row] = await db.insert(gradedCards).values({
      userId, cardId, name, image, company, grade, certNumber: str(b.certNumber, 30).replace(/[^A-Za-z0-9-]/g, ""),
      purchasePrice: money(b.purchasePrice), value, valueUpdatedAt: value ? new Date() : null,
      submissionId,
    }).returning();
    return c.json(row);
  });

  app.put("/api/graded/:id", auth, async (c: any) => {
    const b = await body(c), set: Record<string, any> = {};
    if (b.value !== undefined) { set.value = money(b.value); set.valueUpdatedAt = new Date(); }
    if (b.purchasePrice !== undefined) set.purchasePrice = money(b.purchasePrice);
    if (b.certNumber !== undefined) set.certNumber = str(b.certNumber, 30).replace(/[^A-Za-z0-9-]/g, "");
    if (b.grade !== undefined) { const g = gradeOf(b.grade); if (g) set.grade = g; }
    if (!Object.keys(set).length) return c.json({ error: "Nichts zu ändern." }, 400);
    const [row] = await db.update(gradedCards).set(set)
      .where(and(eq(gradedCards.id, idParam(c)), eq(gradedCards.userId, c.get("user").id))).returning();
    return row ? c.json(row) : c.json({ error: "Nicht gefunden." }, 404);
  });

  app.delete("/api/graded/:id", auth, async (c: any) => {
    await db.delete(gradedCards).where(and(eq(gradedCards.id, idParam(c)), eq(gradedCards.userId, c.get("user").id)));
    return c.json({ ok: true });
  });

  // ------------------------------ Grading-Einsendungen ------------------------------
  const dayOf = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  const submissionFields = (b: Record<string, any>) => {
    const set: Record<string, any> = {};
    if (b.company !== undefined) set.company = (GRADE_COMPANIES as readonly string[]).includes(b.company) ? b.company : "other";
    if (b.service !== undefined) set.service = str(b.service, 40);
    if (b.title !== undefined) set.title = str(b.title, 80);
    if (b.cardCount !== undefined) set.cardCount = int(b.cardCount, 1, 500, 1);
    if (b.declaredValue !== undefined) set.declaredValue = money(b.declaredValue);
    if (b.cost !== undefined) set.cost = money(b.cost);
    if (b.status !== undefined && (SUBMISSION_STATUS as readonly string[]).includes(b.status)) set.status = b.status;
    if (b.sentDay !== undefined) set.sentDay = dayOf(b.sentDay);
    if (b.expectedDay !== undefined) { set.expectedDay = dayOf(b.expectedDay); set.reminderSent = false; }
    if (b.tracking !== undefined) set.tracking = str(b.tracking, 60);
    if (b.submissionNumber !== undefined) set.submissionNumber = str(b.submissionNumber, 40);
    if (b.notes !== undefined) set.notes = str(b.notes, 500);
    return set;
  };

  app.post("/api/submissions", auth, async (c: any) => {
    const b = await body(c), userId = c.get("user").id, plan: PlanId = c.get("plan");
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(gradingSubmissions)
      .where(and(eq(gradingSubmissions.userId, userId), sql`${gradingSubmissions.status} <> 'done'`));
    if (Number(cnt?.n ?? 0) >= PLANS[plan].submissions) {
      return c.json({ error: `Limit erreicht: ${PLANS[plan].submissions} offene Einsendung${PLANS[plan].submissions > 1 ? "en" : ""} im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    const [row] = await db.insert(gradingSubmissions).values({ userId, ...submissionFields(b) } as any).returning();
    return c.json(row);
  });

  app.put("/api/submissions/:id", auth, async (c: any) => {
    const set = submissionFields(await body(c));
    if (!Object.keys(set).length) return c.json({ error: "Nichts zu ändern." }, 400);
    set.updatedAt = new Date();
    const [row] = await db.update(gradingSubmissions).set(set)
      .where(and(eq(gradingSubmissions.id, idParam(c)), eq(gradingSubmissions.userId, c.get("user").id))).returning();
    return row ? c.json(row) : c.json({ error: "Nicht gefunden." }, 404);
  });

  app.delete("/api/submissions/:id", auth, async (c: any) => {
    await db.delete(gradingSubmissions).where(and(eq(gradingSubmissions.id, idParam(c)), eq(gradingSubmissions.userId, c.get("user").id)));
    return c.json({ ok: true });
  });

  // ------------------------------ KI-Fake-Check ------------------------------
  app.get("/api/scan/fake", auth, async (c: any) => {
    const plan: PlanId = c.get("plan"), limit = PLANS[plan].fakeChecksPerMonth;
    return c.json({ limit, left: Math.max(0, limit - (await fakeChecksUsed(c.get("user").id))), plan });
  });

  app.post("/api/scan/fake", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    if (!rateLimit(`fake:${user.id}`, 4, 60_000)) return c.json({ error: "Bitte kurz warten." }, 429);
    const limit = PLANS[plan].fakeChecksPerMonth;
    if ((await fakeChecksUsed(user.id)) >= limit) {
      return c.json({ error: `Du hast deine ${limit} Fake-Check${limit > 1 ? "s" : ""} für diesen Monat genutzt (Tarif ${PLANS[plan].label}).`, upgrade: true }, 402);
    }
    const b = await body(c);
    const front = IMG_RE.exec(String(b.front || ""));
    const back = b.back ? IMG_RE.exec(String(b.back)) : null;
    if (!front || front[2].length > 2_000_000 || (b.back && (!back || back[2].length > 2_000_000))) {
      return c.json({ error: "Bitte ein Foto (JPG/PNG, max. ca. 1,5 MB) der Vorderseite aufnehmen, optional auch der Rückseite." }, 400);
    }
    const content: any[] = [{ type: "text", text: "Vorderseite:" }, { type: "image", source: { type: "base64", media_type: front[1], data: front[2] } }];
    if (back) content.push({ type: "text", text: "Rückseite:" }, { type: "image", source: { type: "base64", media_type: back[1], data: back[2] } });
    content.push({
      type: "text",
      text: `Du bist ein erfahrener Prüfer für Pokémon-Sammelkarten und suchst Hinweise auf Fälschungen. Prüfe die Fotos auf typische Fälschungsmerkmale: Schriftart und Textabstände, Rechtschreibfehler, Energiesymbole, Farbsättigung (zu blass oder zu knallig), Holo-/Textur-Muster, Rand- und Rahmenbreite, Set-Symbol, Set-Nummer und Seltenheit, Copyright-Zeile, Rückseiten-Farbe (Blauton, Pokéball-Position). Antworte NUR mit JSON:
{"isCard": true|false, "cardName": "erkannter Kartenname", "verdict": "likely_real"|"suspicious"|"likely_fake"|"unclear", "confidence": 0-100, "checks": [{"name": "kurzer deutscher Prüfpunkt", "ok": true|false|null, "note": "kurze deutsche Begründung"}], "tips": ["kurze deutsche Tipps für weitere Prüfung"], "photoQuality": "gut"|"mittel"|"schlecht"}
Sei vorsichtig: Ein Foto ersetzt keine Prüfung in der Hand. Bei schlechter Fotoqualität wähle "unclear".`,
    });
    const reservation = await reserveFakeCheck(user.id, limit);
    if (!reservation) {
      return c.json({ error: `Du hast deine ${limit} Fake-Check${limit > 1 ? "s" : ""} für diesen Monat genutzt (Tarif ${PLANS[plan].label}).`, upgrade: true }, 402);
    }
    let r: any = {};
    try {
      const ai = new Anthropic({ timeout: 45_000 });
      const msg = await ai.messages.create({ model: "claude-sonnet-5-5", max_tokens: 900, messages: [{ role: "user", content }] });
      const text = msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
      r = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch (e) {
      console.warn("Fake-Check fehlgeschlagen", e);
      await db.delete(cardScans).where(eq(cardScans.id, reservation)).catch(() => {});
      return c.json({ error: "Die KI-Prüfung ist gerade nicht erreichbar. Es wurde kein Check verbraucht." }, 503);
    }
    const verdict = ["likely_real", "suspicious", "likely_fake", "unclear"].includes(r.verdict) ? r.verdict : "unclear";
    await db.update(cardScans).set({ result: `Fake-Check ${verdict}` }).where(eq(cardScans.id, reservation));
    if (!r.isCard) return c.json({ ok: false, message: "Keine Karte erkannt. Bitte die Karte gerade, hell und formatfüllend fotografieren.", left: Math.max(0, limit - (await fakeChecksUsed(user.id))) });
    return c.json({
      ok: true, verdict, confidence: int(r.confidence, 0, 100, 0), cardName: str(r.cardName, 80),
      checks: (Array.isArray(r.checks) ? r.checks : []).slice(0, 10).map((x: any) => ({
        name: str(x?.name, 60), ok: x?.ok === true ? true : x?.ok === false ? false : null, note: str(x?.note, 160),
      })).filter((x: any) => x.name),
      tips: (Array.isArray(r.tips) ? r.tips : []).slice(0, 5).map((x: unknown) => str(x, 160)).filter(Boolean),
      photoQuality: str(r.photoQuality, 10), hadBack: Boolean(back),
      left: Math.max(0, limit - (await fakeChecksUsed(user.id))),
    });
  });
}
