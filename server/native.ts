// Phase 4: Schnittstellen für die native App (Capacitor-Hülle um pokeswipe-radar.de)
import { timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, nativePushTokens, profiles } from "../db/index.ts";
import { nativePushConfigured } from "./native-push.ts";
import { str, rateLimit } from "./util.ts";
import { log } from "./log.ts";
import { iosPaymentMode, iosProducts, appleUpdateFromEvent } from "./apple-billing-logic.ts";

/** Konstante Laufzeit beim Vergleich des Webhook-Geheimnisses */
function sameSecret(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };

export function registerNative(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  app.get("/api/native/config", (c: any) => {
    c.header("Cache-Control", "public, max-age=600");
    const mode = iosPaymentMode();
    return c.json({
      push: nativePushConfigured(), minVersion: "1.0.0",
      // Zahlungs-Weiche der iOS-App (Web & Android nutzen weiter Stripe). Der RevenueCat-SDK-Schlüssel ist öffentlich.
      payments: {
        ios: mode,
        revenuecatIosKey: mode === "iap" ? String(process.env.REVENUECAT_IOS_API_KEY || "").trim() : null,
        products: Object.entries(iosProducts()).map(([id, p]) => ({ id, ...p })),
      },
    });
  });

  // Phase 9: RevenueCat-Webhook – bestätigt Apple-In-App-Käufe serverseitig (Authorization-Header = REVENUECAT_WEBHOOK_AUTH)
  app.post("/api/billing/revenuecat/webhook", async (c: any) => {
    const secret = String(process.env.REVENUECAT_WEBHOOK_AUTH || "").trim();
    if (!secret) return c.json({ error: "Nicht eingerichtet" }, 503);
    const header = String(c.req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!sameSecret(header, secret)) return c.json({ error: "Nicht autorisiert" }, 401);
    let payload: any = {};
    try { payload = await c.req.json(); } catch { return c.json({ error: "Ungültig" }, 400); }
    const event = payload?.event;
    const ids = [event?.app_user_id, event?.original_app_user_id, ...(Array.isArray(event?.aliases) ? event.aliases : [])]
      .map((x) => String(x || "")).filter((x) => /^[A-Za-z0-9-]{8,80}$/.test(x) && !x.startsWith("$RCAnonymousID"));
    const update = appleUpdateFromEvent(event);
    if (update.kind === "ignore" || !ids.length) return c.json({ ok: true, ignored: update.kind === "ignore" ? update.reason : "kein Konto" });
    const [profile] = await db.select().from(profiles).where(sql`${profiles.userId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).limit(1);
    if (!profile) return c.json({ ok: true, ignored: "Konto unbekannt" });
    // Ein laufendes Stripe-Abo hat Vorrang vor einem abgelaufenen Apple-Abo
    const stripeActive = profile.planSource === "stripe" && profile.stripeSubscriptionId && profile.planUntil && profile.planUntil.getTime() > Date.now();
    if (update.kind === "active") {
      await db.update(profiles).set({
        plan: update.plan, planUntil: update.until, planInterval: update.interval, planSource: "apple", cancelAtPeriodEnd: false,
        appStoreOriginalTxId: update.originalTxId ?? profile.appStoreOriginalTxId, planCheckedAt: new Date(),
      }).where(eq(profiles.userId, profile.userId));
    } else if (update.kind === "cancel_at_period_end") {
      if (profile.planSource === "apple") await db.update(profiles).set({ cancelAtPeriodEnd: true, ...(update.until ? { planUntil: update.until } : {}) }).where(eq(profiles.userId, profile.userId));
    } else if (update.kind === "expired" && profile.planSource === "apple" && !stripeActive) {
      await db.update(profiles).set({ plan: "free", planUntil: null, cancelAtPeriodEnd: false, planSource: "stripe" }).where(eq(profiles.userId, profile.userId));
    }
    log.info("billing", "Apple-Abo aktualisiert", { userId: profile.userId, kind: update.kind, type: String(event?.type || "") });
    return c.json({ ok: true, applied: update.kind });
  });

  // Universal Links (iOS) und App Links (Android): Links auf pokeswipe-radar.de öffnen direkt die installierte App.
  // Aktiv, sobald APPLE_TEAM_ID bzw. ANDROID_CERT_SHA256 (Fingerabdruck des Signatur-Zertifikats) gesetzt sind.
  app.get("/.well-known/apple-app-site-association", (c: any) => {
    const team = (process.env.APPLE_TEAM_ID || "").trim();
    if (!/^[A-Z0-9]{10}$/.test(team)) return c.json({ error: "Nicht eingerichtet" }, 404);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      applinks: { details: [{ appIDs: [`${team}.de.pokeswiperadar.app`], components: [
        { "/": "/api/*", exclude: true }, { "/": "/.netlify/*", exclude: true }, { "/": "/*" },
      ] }] },
      webcredentials: { apps: [`${team}.de.pokeswiperadar.app`] },
    });
  });
  app.get("/.well-known/assetlinks.json", (c: any) => {
    const prints = (process.env.ANDROID_CERT_SHA256 || "").split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
    if (!prints.length) return c.json({ error: "Nicht eingerichtet" }, 404);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "de.pokeswiperadar.app", sha256_cert_fingerprints: prints } }]);
  });

  // Gerät für Push registrieren (FCM-Token von @capacitor/push-notifications)
  app.post("/api/push/native", auth, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`npush:${user.id}`, 10, 600_000))) return c.json({ error: "Zu viele Anfragen." }, 429);
    const b = await body(c);
    const token = str(b.token, 400);
    const platform = b.platform === "ios" ? "ios" : b.platform === "android" ? "android" : null;
    if (!platform || !/^[A-Za-z0-9:_\-.]{20,400}$/.test(token)) return c.json({ error: "Ungültiges Geräte-Token" }, 400);
    await db.insert(nativePushTokens).values({ userId: user.id, token, platform })
      .onConflictDoUpdate({ target: nativePushTokens.token, set: { userId: user.id, platform, createdAt: new Date() } });
    // höchstens 10 Geräte pro Nutzer
    await db.execute(sql`DELETE FROM native_push_tokens WHERE user_id = ${user.id} AND id NOT IN (SELECT id FROM native_push_tokens WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 10)`);
    return c.json({ ok: true, active: nativePushConfigured() });
  });

  app.post("/api/push/native/remove", auth, async (c: any) => {
    const token = str((await body(c)).token, 400);
    await db.delete(nativePushTokens).where(and(eq(nativePushTokens.userId, c.get("user").id), eq(nativePushTokens.token, token)));
    return c.json({ ok: true });
  });
}
