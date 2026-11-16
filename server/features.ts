
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql, asc, inArray } from "drizzle-orm";
import {
  db, profiles, cards, portfolioItems, pushSubscriptions, trackedSets, sealedProducts, sealedPriceHistory,
  sealedAlerts, cardScans, affiliateClicks, payments, listings,
} from "../db/index.ts";
import { PLANS, REFERRAL_TRIAL_DAYS, TRIAL_DAYS, effectivePlan, type PlanId } from "./plans.ts";
import { getCard, cardPrice, notify, evaluateSealedAlerts, CARD_ID_RE } from "./prices.ts";
import { getVapid, isValidPushEndpoint, sendPush } from "./push.ts";
import { verifyIdentityToken } from "./auth.ts";
import { recordShopView } from "./growth.ts";
import { str, money, int, rows, rateLimit, clientIp, euro, trustedOrigin } from "./util.ts";
import { scanLimit, shareBonusToday, attributeSignup } from "./viral.ts";

type Profile = typeof profiles.$inferSelect;

// ---------------------------------------------------------------------------
// Hilfsfunktionen, die auch app.ts nutzt
// ---------------------------------------------------------------------------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

export async function ensureReferralCode(profile: Profile) {
  if (profile.referralCode) return profile.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      const [u] = await db.update(profiles).set({ referralCode: code })
        .where(and(eq(profiles.userId, profile.userId), sql`${profiles.referralCode} IS NULL`)).returning();
      if (u) return u.referralCode!;
      const [again] = await db.select({ code: profiles.referralCode }).from(profiles).where(eq(profiles.userId, profile.userId));
      if (again?.code) return again.code;
    } catch {
      // Code schon vergeben – neuer Versuch
    }
  }
  return "";
}

/** Testphase in Tagen für das erste Abo: 30 Tage mit Empfehlung, sonst 7 Tage – 0, wenn schon genutzt. */
export async function trialDays(profile: Profile) {
  if (!(await trialEligible(profile))) return 0;
  return profile.referredBy ? REFERRAL_TRIAL_DAYS : TRIAL_DAYS;
}

export async function trialEligible(profile: Profile) {
  if (profile.usedTrial || profile.stripeSubscriptionId) return false;
  const [paid] = await db.select({ id: payments.id }).from(payments)
    .where(and(eq(payments.userId, profile.userId), eq(payments.kind, "subscription"))).limit(1);
  return !paid;
}

async function scansToday(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cardScans)
    .where(and(eq(cardScans.userId, userId), sql`${cardScans.createdAt} > now() - interval '1 day'`));
  return Number(r?.n ?? 0);
}

/**
 * Reserviert atomar einen KI-Scan (Tageslimit): erst eintragen, dann zählen. Nur die ersten `limit`
 * Einträge der letzten 24 h (nach ID) gelten – parallele Anfragen können das Limit nicht überschreiten.
 * Liefert die ID der Reservierung oder null, wenn das Limit erreicht ist.
 */
export async function reserveScan(userId: string, limit: number): Promise<number | null> {
  const [row] = await db.insert(cardScans).values({ userId, result: "" }).returning({ id: cardScans.id });
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cardScans)
    .where(and(eq(cardScans.userId, userId), sql`${cardScans.createdAt} > now() - interval '1 day'`, sql`${cardScans.id} <= ${row.id}`));
  if (Number(r?.n ?? 0) > limit) {
    await db.delete(cardScans).where(eq(cardScans.id, row.id));
    return null;
  }
  return row.id;
}

export async function extraMe(c: any, profile: Profile, plan: PlanId) {
  const code = await ensureReferralCode(profile);
  const [ref] = rows(await db.execute(sql`
    SELECT count(*)::int AS invited, count(*) FILTER (WHERE referral_rewarded)::int AS rewarded
    FROM profiles WHERE referred_by = ${profile.userId}
  `));
  const [sets] = await db.select({ n: sql<number>`count(*)::int` }).from(trackedSets).where(eq(trackedSets.userId, profile.userId));
  const origin = process.env.URL || trustedOrigin(c) || "https://pokeswipe-radar.de";
  const shareBonus = await shareBonusToday(profile.userId);
  return {
    referral: {
      code,
      link: `${origin}/einladung/${code}`,
      invited: Number(ref?.invited ?? 0),
      rewarded: Number(ref?.rewarded ?? 0),
      trialDays: REFERRAL_TRIAL_DAYS,
    },
    trialEligible: await trialEligible(profile),
    trialDays: await trialDays(profile),
    referred: Boolean(profile.referredBy),
    planInterval: profile.planInterval,
    bonusUntil: profile.bonusUntil,
    bonusPlan: profile.bonusPlan,
    shareBonus,
    switchBonusAvailable: !profile.switchBonusAt && !profile.stripeSubscriptionId,
    shop: { slug: profile.shopSlug, title: profile.shopTitle, bio: profile.shopBio, enabled: PLANS[plan].shop, banner: profile.shopBanner, logo: profile.shopLogo, accent: profile.shopAccent },
    scansLeft: Math.max(0, PLANS[plan].scansPerDay + shareBonus - (await scansToday(profile.userId))),
    setsTracked: Number(sets?.n ?? 0),
  };
}

const RESERVED_SLUGS = new Set(["admin", "api", "shop", "shops", "pokeswipe", "support", "hilfe", "radar", "login", "konto"]);

export async function applyShopUpdates(b: Record<string, any>, profile: Profile, plan: PlanId, updates: Partial<Profile>) {
  if (b.shopSlug === undefined && b.shopTitle === undefined && b.shopBio === undefined) return null;
  if (!PLANS[plan].shop) return "Händler-Shops sind im Pro-Trader-Tarif enthalten.";
  if (b.shopSlug !== undefined) {
    const slug = str(b.shopSlug, 30).toLowerCase();
    if (slug === "") updates.shopSlug = null;
    else {
      if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug) || RESERVED_SLUGS.has(slug)) {
        return "Shop-Adresse: 3–30 Zeichen, nur a–z, 0–9 und Bindestrich.";
      }
      const [taken] = await db.select({ id: profiles.userId }).from(profiles)
        .where(and(eq(profiles.shopSlug, slug), sql`${profiles.userId} <> ${profile.userId}`)).limit(1);
      if (taken) return "Diese Shop-Adresse ist schon vergeben.";
      updates.shopSlug = slug;
    }
  }
  if (b.shopTitle !== undefined) updates.shopTitle = str(b.shopTitle, 60);
  if (b.shopBio !== undefined) updates.shopBio = str(b.shopBio, 600);
  return null;
}

export async function activeAlertCount(userId: string) {
  const [r] = rows(await db.execute(sql`
    SELECT (SELECT count(*) FROM price_alerts WHERE user_id = ${userId} AND active)
         + (SELECT count(*) FROM sealed_alerts WHERE user_id = ${userId} AND active) AS n
  `));
  return Number(r?.n ?? 0);
}

export async function findSealed(id: number) {
  if (!id) return null;
  const [p] = await db.select().from(sealedProducts).where(and(eq(sealedProducts.id, id), eq(sealedProducts.active, true))).limit(1);
  return p ?? null;
}

/** Neues Sealed-Inserat: Nutzer benachrichtigen, deren Zielpreis erreicht ist. */
export async function notifySealedListing(row: typeof listings.$inferSelect, sellerName: string, sellerId: string) {
  const watchers = await db.selectDistinct({ userId: sealedAlerts.userId }).from(sealedAlerts).where(and(
    eq(sealedAlerts.productId, row.sealedProductId!), eq(sealedAlerts.active, true), eq(sealedAlerts.direction, "below"),
    sql`${sealedAlerts.targetPrice} >= ${row.price}`, sql`${sealedAlerts.userId} <> ${sellerId}`,
  ));
  for (const w of watchers.slice(0, 200)) {
    await notify(w.userId, "📦 Sealed unter deinem Zielpreis", `${row.cardName} für ${euro(Number(row.price))} in ${row.city} (${sellerName}).`, "/?tab=map");
  }
}

// ---------------------------------------------------------------------------
// TCGdex-Helfer
// ---------------------------------------------------------------------------
const setCache = new Map<string, { data: any; expires: number }>();
export async function fetchSet(setId: string, lang: "de" | "en" = "de") {
  const key = `${lang}:${setId}`;
  const hit = setCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(setId)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (setCache.size > 300) setCache.clear();
    setCache.set(key, { data, expires: Date.now() + 6 * 3600_000 });
    return data;
  } catch {
    return null;
  }
}

export async function searchTcgdex(lang: "de" | "en", name: string) {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const normNum = (v: unknown) => String(v ?? "").replace(/^0+/, "").toLowerCase();

export async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>, deadline: number) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const x = items[i++];
      try { await fn(x); } catch {}
    }
  }));
}

// ---------------------------------------------------------------------------
// Grading-Partner (Affiliate) – eigene Partner-Links per Umgebungsvariable hinterlegen
// ---------------------------------------------------------------------------
const PARTNERS = [
  { id: "psa", name: "PSA", env: "AFF_PSA_URL", url: "https://www.psacard.com/", tagline: "Marktführer – PSA 10 erzielt meist die höchsten Wiederverkaufspreise.", features: ["Skala 1–10", "Größter Sammlermarkt", "Online-Einreichung"] },
  { id: "cgc", name: "CGC Cards", env: "AFF_CGC_URL", url: "https://www.cgccards.com/", tagline: "Beliebt bei modernen Karten, mit „Pristine 10“ über der Gem Mint.", features: ["Pristine 10", "Klare Slabs", "Subgrades optional"] },
  { id: "beckett", name: "Beckett (BGS)", env: "AFF_BGS_URL", url: "https://www.beckett.com/grading", tagline: "Subgrades für Centering, Ecken, Kanten und Oberfläche – Black Label als Krönung.", features: ["Subgrades", "Black Label", "Lange Tradition"] },
  { id: "tag", name: "TAG Grading", env: "AFF_TAG_URL", url: "https://taggrading.com/", tagline: "Digitaler Report mit Fotos jeder gefundenen Schwachstelle.", features: ["Digitaler Report", "Objektive Bewertung", "Transparente Fehlerbilder"] },
];

// ---------------------------------------------------------------------------
// Sealed-Startkatalog (ohne Preise – Referenzpreise pflegt der Admin)
// ---------------------------------------------------------------------------
const SEALED_SEED: [string, string, string][] = [
  ["151 Top-Trainer-Box", "Karmesin & Purpur – 151", "ttb"],
  ["151 Booster-Bundle", "Karmesin & Purpur – 151", "bundle"],
  ["Stürmische Funken Display (36 Booster)", "Karmesin & Purpur – Stürmische Funken", "display"],
  ["Stürmische Funken Top-Trainer-Box", "Karmesin & Purpur – Stürmische Funken", "ttb"],
  ["Prismatische Entwicklungen Top-Trainer-Box", "Karmesin & Purpur – Prismatische Entwicklungen", "ttb"],
  ["Prismatische Entwicklungen Booster-Bundle", "Karmesin & Purpur – Prismatische Entwicklungen", "bundle"],
  ["Paldeas Schicksale Top-Trainer-Box", "Karmesin & Purpur – Paldeas Schicksale", "ttb"],
  ["Reisegefährten Display (36 Booster)", "Karmesin & Purpur – Reisegefährten", "display"],
  ["Drachenwandel Display (36 Booster)", "Schwert & Schild – Drachenwandel", "display"],
];
const SEALED_KINDS = ["display", "etb", "ttb", "bundle", "booster", "tin", "collection", "other"];

async function seedSealed() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(sealedProducts);
  if (Number(r?.n ?? 0) > 0) return;
  await db.execute(sql`
    INSERT INTO sealed_products (name, set_name, kind)
    SELECT v.name, v.set_name, v.kind FROM (VALUES ${sql.join(SEALED_SEED.map(([n, s, k]) => sql`(${n}, ${s}, ${k})`), sql`, `)}) AS v(name, set_name, kind)
    WHERE NOT EXISTS (SELECT 1 FROM sealed_products)
  `);
}

function adminImage(v: unknown) {
  const s = str(v, 400);
  if (!s) return "";
  try { const u = new URL(s); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerFeatures(app: any, h: {
  auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>>;
  safeImage: (v: unknown) => string; storeDataUrlImage: (v: unknown, userId: string) => Promise<string>;
  ratingOf: (userId: string) => Promise<{ avg: number; count: number }>;
}) {
  const { auth, adminOnly, body } = h;

  // ------------------------------- Web-Push -------------------------------
  app.get("/api/push/key", async (c: any) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ publicKey: (await getVapid()).publicKey });
  });

  app.post("/api/push/subscribe", auth, async (c: any) => {
    const b = await body(c);
    const sub = b.subscription || {};
    const endpoint = str(sub.endpoint, 1000), p256dh = str(sub.keys?.p256dh, 200), authKey = str(sub.keys?.auth, 100);
    if (!isValidPushEndpoint(endpoint) || !p256dh || !authKey) return c.json({ error: "Ungültiges Push-Abo" }, 400);
    const userId = c.get("user").id;
    await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh, auth: authKey })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh, auth: authKey } });
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    if (Number(n?.n) > 10) {
      await db.execute(sql`DELETE FROM push_subscriptions WHERE id IN (
        SELECT id FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT ${Number(n.n) - 10})`);
    }
    return c.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", auth, async (c: any) => {
    const endpoint = str((await body(c)).endpoint, 1000);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.get("user").id)));
    return c.json({ ok: true });
  });

  app.post("/api/push/test", auth, async (c: any) => {
    if (!(await rateLimit(`pushtest:${c.get("user").id}`, 3, 600_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    await sendPush(c.get("user").id, { title: "⚡ PokeSwipe Push funktioniert!", body: "Du bekommst Preisalarme und Tausch-Nachrichten jetzt auch bei geschlossener App.", url: "/" });
    return c.json({ ok: true });
  });

  // ---------------------------- Kamera-Scan (KI) ---------------------------
  app.post("/api/scan", auth, async (c: any) => {
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
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
          { type: "text", text: 'Das Foto zeigt eine Pokémon-Sammelkarte. Antworte NUR mit JSON: {"name": "Kartenname wie aufgedruckt (ohne HP)", "number": "Kartennummer vor dem Schrägstrich, z. B. 199", "total": "Zahl nach dem Schrägstrich", "language": "de|en|ja|other", "isPokemonCard": true|false}. Unbekannte Werte als leeren String.' },
        ],
      }],
    }).catch(async (e: unknown) => {
      // Fehlgeschlagener KI-Aufruf verbraucht keinen Scan
      await db.delete(cardScans).where(eq(cardScans.id, reservation)).catch(() => {});
      throw e;
    });
    const text = msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
    let parsed: any = {};
    try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
    const name = str(parsed.name, 80).replace(/\s*-?\s*ex$/i, (x) => x).trim();
    const number = normNum(str(parsed.number, 12));
    await db.update(cardScans).set({ result: `${name} ${number}`.trim().slice(0, 120) }).where(eq(cardScans.id, reservation));
    if (!parsed.isPokemonCard || !name) return c.json({ found: false, message: "Keine Pokémon-Karte erkannt. Bitte Karte gerade, hell und formatfüllend fotografieren." });

    const baseName = name.replace(/\s+(ex|EX|GX|V|VMAX|VSTAR)$/u, "").trim();
    let list = await searchTcgdex("de", name);
    if (!list.length && baseName !== name) list = await searchTcgdex("de", baseName);
    if (!list.length) list = await searchTcgdex("en", name);
    const byNumber = number ? list.filter((x: any) => normNum(x.localId) === number) : [];
    const totalHint = str(parsed.total, 6);
    let ranked = byNumber.length ? byNumber : list;
    if (byNumber.length > 1 && totalHint) {
      const totals = await Promise.all(byNumber.slice(0, 6).map(async (x: any) => {
        const set = await fetchSet(String(x.id).split("-").slice(0, -1).join("-"));
        return { x, ok: set && String(set.cardCount?.official) === totalHint };
      }));
      const matched = totals.filter((t) => t.ok).map((t) => t.x);
      if (matched.length) ranked = matched;
    }
    return c.json({
      found: ranked.length > 0,
      detected: { name, number, total: totalHint },
      candidates: ranked.slice(0, 8).map((x: any) => ({ id: x.id, name: x.name, localId: x.localId, image: x.image ? `${x.image}/low.webp` : "" })),
    });
  });

  // ---------------------------- Set-Fortschritt ----------------------------
  app.get("/api/sets/tracked", auth, async (c: any) => {
    const userId = c.get("user").id;
    const tracked = await db.select().from(trackedSets).where(eq(trackedSets.userId, userId)).orderBy(desc(trackedSets.createdAt));
    const owned = rows(await db.execute(sql`
      SELECT split_part(card_id, '-', 1) AS prefix, card_id FROM portfolio_items WHERE user_id = ${userId} AND card_id IS NOT NULL
    `));
    return c.json({
      sets: tracked.map((t) => ({ ...t, owned: new Set(owned.filter((o: any) => String(o.card_id).startsWith(t.setId + "-")).map((o: any) => o.card_id)).size })),
      limit: PLANS[c.get("plan") as PlanId].sets,
    });
  });

  app.get("/api/sets/:id", auth, async (c: any) => {
    const setId = c.req.param("id");
    if (!/^[a-zA-Z0-9.\-]{1,20}$/.test(setId)) return c.json({ error: "Ungültiges Set" }, 400);
    const [set, setEn] = await Promise.all([fetchSet(setId), fetchSet(setId, "en")]);
    if (!set?.cards) return c.json({ error: "Set nicht gefunden" }, 404);
    const enNames = new Map<string, string>((setEn?.cards || []).map((x: any) => [String(x.id), String(x.name || "")]));
    const userId = c.get("user").id;
    const ids: string[] = set.cards.map((x: any) => String(x.id)).filter((id: string) => CARD_ID_RE.test(id));

    // Fehlende Preise schrittweise nachladen (max. ~8 s pro Aufruf, Rest beim nächsten Öffnen)
    const known = ids.length ? await db.select().from(cards).where(inArray(cards.id, ids)) : [];
    const knownMap = new Map(known.map((k) => [k.id, k]));
    const missing = ids.filter((id) => !knownMap.get(id)?.checkedAt || Date.now() - knownMap.get(id)!.checkedAt!.getTime() > 3 * 86400_000);
    await pool(missing.slice(0, 40), 6, async (id) => {
      const card = await getCard(id, 3 * 86400_000);
      if (card) knownMap.set(card.id, card);
    }, Date.now() + 8000);

    const ownedRows = await db.select({ cardId: portfolioItems.cardId, q: sql<number>`sum(${portfolioItems.quantity})::int` })
      .from(portfolioItems).where(and(eq(portfolioItems.userId, userId), sql`${portfolioItems.cardId} LIKE ${setId + "-%"}`))
      .groupBy(portfolioItems.cardId);
    const ownedMap = new Map(ownedRows.map((r) => [r.cardId, Number(r.q)]));
    let ownedValue = 0, missingCost = 0, priced = 0;
    const list = set.cards.map((x: any) => {
      const k = knownMap.get(String(x.id));
      const price = cardPrice(k);
      if (price) priced++;
      const qty = ownedMap.get(String(x.id)) || 0;
      if (qty) ownedValue += price; else missingCost += price;
      return { id: x.id, localId: x.localId, name: x.name, en: enNames.get(String(x.id)) || "", image: x.image ? `${x.image}/low.webp` : "", price, owned: qty > 0, qty };
    });
    const [tracked] = await db.select({ id: trackedSets.id }).from(trackedSets).where(and(eq(trackedSets.userId, userId), eq(trackedSets.setId, setId))).limit(1);
    return c.json({
      id: set.id, name: set.name, enName: String(setEn?.name || ""), abbr: String(setEn?.abbreviation?.official || set.abbreviation?.official || ""), logo: set.logo ? `${set.logo}.webp` : "", official: set.cardCount?.official ?? list.length,
      total: list.length, owned: list.filter((x: any) => x.owned).length, ownedValue, missingCost, priced,
      pricesPending: list.length - priced > 0 && missing.length > 40, tracked: Boolean(tracked), cards: list,
    });
  });

  app.post("/api/sets/:id/track", auth, async (c: any) => {
    const setId = c.req.param("id"), user = c.get("user"), plan: PlanId = c.get("plan");
    if (!/^[a-zA-Z0-9.\-]{1,20}$/.test(setId)) return c.json({ error: "Ungültiges Set" }, 400);
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(trackedSets).where(eq(trackedSets.userId, user.id));
    if (Number(r?.n ?? 0) >= PLANS[plan].sets) {
      return c.json({ error: `Limit erreicht: ${PLANS[plan].sets} Set(s) im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    const set = await fetchSet(setId);
    if (!set) return c.json({ error: "Set nicht gefunden" }, 404);
    await db.insert(trackedSets).values({ userId: user.id, setId, setName: str(set.name, 120) }).onConflictDoNothing();
    return c.json({ ok: true });
  });

  app.delete("/api/sets/:id/track", auth, async (c: any) => {
    await db.delete(trackedSets).where(and(eq(trackedSets.userId, c.get("user").id), eq(trackedSets.setId, c.req.param("id"))));
    return c.json({ ok: true });
  });

  app.delete("/api/portfolio/by-card/:cardId", auth, async (c: any) => {
    const cardId = c.req.param("cardId");
    if (!CARD_ID_RE.test(cardId)) return c.json({ error: "Ungültige Karten-ID" }, 400);
    const userId = c.get("user").id;
    const [item] = await db.select({ id: portfolioItems.id, quantity: portfolioItems.quantity }).from(portfolioItems)
      .where(and(eq(portfolioItems.userId, userId), eq(portfolioItems.cardId, cardId))).orderBy(asc(portfolioItems.id)).limit(1);
    if (!item) return c.json({ ok: true });
    if (item.quantity > 1) await db.update(portfolioItems).set({ quantity: item.quantity - 1 }).where(eq(portfolioItems.id, item.id));
    else await db.delete(portfolioItems).where(eq(portfolioItems.id, item.id));
    return c.json({ ok: true });
  });

  // ------------------------------ Sealed-Tracker ---------------------------
  const sealedListQuery = (where = sql`TRUE`) => db.execute(sql`
    SELECT s.id, s.name, s.set_name, s.kind, s.image, s.ref_price::float AS ref_price, s.ref_updated_at,
      (SELECT avg(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_avg,
      (SELECT min(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_min,
      (SELECT count(*)::int FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS listing_count,
      (SELECT COALESCE(h.ref_price, h.community_avg)::float FROM sealed_price_history h
         WHERE h.product_id = s.id AND h.day <= CURRENT_DATE - 30 ORDER BY h.day DESC LIMIT 1) AS price_30d,
      (SELECT array_agg(COALESCE(h.ref_price, h.community_avg)::float ORDER BY h.day) FROM sealed_price_history h
         WHERE h.product_id = s.id AND h.day > CURRENT_DATE - 30) AS history
    FROM sealed_products s WHERE s.active AND ${where}
    ORDER BY s.kind, s.name
  `);
  const shapeSealed = (p: any) => {
    const price = p.ref_price ?? p.community_avg ?? null;
    return { ...p, price, change30: price && p.price_30d ? ((price - p.price_30d) / p.price_30d) * 100 : null, history: p.history || [] };
  };

  app.get("/api/sealed", async (c: any) => {
    await seedSealed();
    c.header("Cache-Control", "no-store");
    return c.json({ products: rows(await sealedListQuery()).map(shapeSealed), kinds: SEALED_KINDS });
  });

  app.get("/api/sealed/:id", async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [p] = rows(await sealedListQuery(sql`s.id = ${id}`));
    if (!p) return c.json({ error: "Nicht gefunden" }, 404);
    const history = await db.select().from(sealedPriceHistory).where(eq(sealedPriceHistory.productId, id)).orderBy(desc(sealedPriceHistory.day)).limit(90);
    const offers = rows(await db.execute(sql`
      SELECT l.id, l.price::float AS price, l.city, l.want, l.user_id, p.display_name AS seller
      FROM listings l JOIN profiles p ON p.user_id = l.user_id
      WHERE l.sealed_product_id = ${id} AND l.status = 'active' AND NOT p.banned ORDER BY l.price ASC LIMIT 20
    `));
    return c.json({ product: shapeSealed(p), history: history.reverse(), offers });
  });

  app.get("/api/sealed-alerts", auth, async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT a.id, a.product_id, a.target_price::float AS target_price, a.direction, s.name, s.kind,
        COALESCE(s.ref_price, (SELECT avg(l.price) FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active'))::float AS price
      FROM sealed_alerts a JOIN sealed_products s ON s.id = a.product_id
      WHERE a.user_id = ${c.get("user").id} AND a.active ORDER BY a.created_at DESC
    `));
    return c.json({ alerts: list });
  });

  app.post("/api/sealed-alerts", auth, async (c: any) => {
    const user = c.get("user"), plan: PlanId = c.get("plan");
    const b = await body(c);
    const productId = int(b.productId, 1, 2 ** 31 - 1, 0);
    const target = money(b.targetPrice);
    if (!productId || !target || Number(target) <= 0) return c.json({ error: "Bitte Produkt und Zielpreis angeben." }, 400);
    if ((await activeAlertCount(user.id)) >= PLANS[plan].alerts) {
      return c.json({ error: `Limit erreicht: ${PLANS[plan].alerts} Preisalarme im Tarif ${PLANS[plan].label}.`, upgrade: true }, 402);
    }
    if (!(await findSealed(productId))) return c.json({ error: "Produkt nicht gefunden" }, 404);
    const [a] = await db.insert(sealedAlerts).values({ userId: user.id, productId, targetPrice: target, direction: b.direction === "above" ? "above" : "below" }).returning();
    const [p] = rows(await sealedListQuery(sql`s.id = ${productId}`));
    if (p) await evaluateSealedAlerts(productId, Number(p.ref_price ?? p.community_avg ?? 0));
    return c.json(a, 201);
  });

  app.delete("/api/sealed-alerts/:id", auth, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    await db.delete(sealedAlerts).where(and(eq(sealedAlerts.id, id), eq(sealedAlerts.userId, c.get("user").id)));
    return c.json({ ok: true });
  });

  app.post("/api/admin/sealed", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const name = str(b.name, 120);
    if (!name) return c.json({ error: "Name fehlt" }, 400);
    const ref = money(b.refPrice);
    const [p] = await db.insert(sealedProducts).values({
      name, setName: str(b.setName, 120), kind: SEALED_KINDS.includes(b.kind) ? b.kind : "other",
      image: adminImage(b.image), refPrice: ref, refUpdatedAt: ref ? new Date() : null,
      // Admin-Preis = manueller Override: der automatische Sealed-Preis-Job lässt ihn stehen
      priceLocked: !!ref,
    }).returning();
    return c.json(p, 201);
  });

  app.patch("/api/admin/sealed/:id", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const updates: Record<string, any> = {};
    if (b.refPrice !== undefined) {
      updates.refPrice = money(b.refPrice); updates.refUpdatedAt = new Date();
      // Mit Preis: Override sperren; Preis leeren: wieder dem automatischen Job überlassen
      updates.priceLocked = !!updates.refPrice; updates.priceSource = updates.refPrice ? "admin" : "auto";
    }
    if (typeof b.priceLocked === "boolean") updates.priceLocked = b.priceLocked;
    if (b.name !== undefined) updates.name = str(b.name, 120);
    if (b.setName !== undefined) updates.setName = str(b.setName, 120);
    if (b.kind !== undefined && SEALED_KINDS.includes(b.kind)) updates.kind = b.kind;
    if (b.image !== undefined) updates.image = adminImage(b.image);
    if (b.active !== undefined) updates.active = Boolean(b.active);
    const [p] = await db.update(sealedProducts).set(updates).where(eq(sealedProducts.id, id)).returning();
    if (!p) return c.json({ error: "Nicht gefunden" }, 404);
    if (updates.refPrice !== undefined) {
      await db.insert(sealedPriceHistory).values({ productId: id, day: new Date().toISOString().slice(0, 10), refPrice: updates.refPrice })
        .onConflictDoUpdate({ target: [sealedPriceHistory.productId, sealedPriceHistory.day], set: { refPrice: updates.refPrice } });
      if (updates.refPrice) await evaluateSealedAlerts(id, Number(updates.refPrice));
    }
    return c.json(p);
  });

  // --------------------------- Grading-Partner -----------------------------
  app.get("/api/partners", (c: any) => {
    c.header("Cache-Control", "public, max-age=600");
    return c.json({ partners: PARTNERS.map(({ env, url, ...p }) => ({ ...p, link: `/api/go/${p.id}`, affiliate: Boolean(process.env[env]) })) });
  });

  app.get("/api/go/:partner", async (c: any) => {
    const p = PARTNERS.find((x) => x.id === c.req.param("partner"));
    if (!p) return c.redirect("/", 302);
    if ((await rateLimit(`go:${clientIp(c)}`, 30, 60_000))) {
      try {
        const u = await verifyIdentityToken(c);
        await db.insert(affiliateClicks).values({ partner: p.id, userId: u?.id ?? null });
      } catch (e) {
        console.warn("Klick nicht gezählt", e);
      }
    }
    const target = process.env[p.env] || p.url;
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer-when-downgrade");
    return c.redirect(target.startsWith("https://") ? target : p.url, 302);
  });

  app.get("/api/admin/affiliate", auth, adminOnly, async (c: any) => {
    const list = rows(await db.execute(sql`
      SELECT partner, count(*)::int AS total,
        count(*) FILTER (WHERE created_at > date_trunc('month', now()))::int AS this_month
      FROM affiliate_clicks GROUP BY partner ORDER BY total DESC
    `));
    const [ref] = rows(await db.execute(sql`
      SELECT count(*) FILTER (WHERE referred_by IS NOT NULL)::int AS referred,
        count(*) FILTER (WHERE referral_rewarded)::int AS converted FROM profiles
    `));
    return c.json({ clicks: list, partners: PARTNERS.map((p) => ({ id: p.id, name: p.name, env: p.env, configured: Boolean(process.env[p.env]) })), referrals: ref });
  });

  // ---------------------------- Händler-Shops ------------------------------
  // Seit Phase 5 in server/shops.ts (Branding, Sprachfilter, Antwortzeit, öffentliche Shop-Seite mit Vorschaubild)

  // ------------------------- Empfehlungsprogramm ---------------------------
  app.post("/api/referral/claim", auth, async (c: any) => {
    const profile: Profile = c.get("profile");
    const b = await body(c);
    const code = str(b.code, 12).toUpperCase();
    const via = str(b.via, 10).toLowerCase();
    if (!/^[A-Z0-9]{6,10}$/.test(code)) return c.json({ error: "Ungültiger Code" }, 400);
    if (profile.referredBy) return c.json({ ok: true, already: true });
    if (Date.now() - profile.createdAt.getTime() > 14 * 86400_000) return c.json({ error: "Empfehlungen gelten nur für neue Konten." }, 409);
    if (profile.stripeSubscriptionId) return c.json({ error: "Empfehlungen gelten nur für neue Konten." }, 409);
    const [referrer] = await db.select().from(profiles).where(eq(profiles.referralCode, code)).limit(1);
    if (!referrer || referrer.userId === profile.userId || referrer.banned) return c.json({ error: "Code nicht gefunden" }, 404);
    if (referrer.email.toLowerCase() === profile.email.toLowerCase()) return c.json({ error: "Code nicht gültig" }, 409);
    const [set] = await db.update(profiles).set({ referredBy: referrer.userId }).where(and(eq(profiles.userId, profile.userId), sql`${profiles.referredBy} IS NULL`)).returning({ id: profiles.userId });
    if (!set) return c.json({ ok: true, already: true });
    if (via) await attributeSignup(profile.userId, referrer.userId, via).catch(() => {});
    await notify(referrer.userId, "👋 Neuer Sammler über deinen Link", `${profile.displayName} hat sich registriert. Sobald das erste Abo bezahlt ist, bekommst du deinen Gratismonat.`);
    return c.json({ ok: true, trialDays: REFERRAL_TRIAL_DAYS });
  });

  // Alarme insgesamt für die Tracker-Übersicht (Karten + Sealed)
  app.get("/api/alerts/count", auth, async (c: any) => c.json({ count: await activeAlertCount(c.get("user").id), limit: PLANS[c.get("plan") as PlanId].alerts }));

}
