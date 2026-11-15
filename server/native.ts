// Phase 4: Schnittstellen für die native App (Capacitor-Hülle um pokeswipe-radar.de)
import { and, eq, sql } from "drizzle-orm";
import { db, nativePushTokens } from "../db/index.ts";
import { nativePushConfigured } from "./native-push.ts";
import { str, rateLimit } from "./util.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };

export function registerNative(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  app.get("/api/native/config", (c: any) => {
    c.header("Cache-Control", "public, max-age=600");
    return c.json({ push: nativePushConfigured(), minVersion: "1.0.0" });
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
    if (!rateLimit(`npush:${user.id}`, 10, 600_000)) return c.json({ error: "Zu viele Anfragen." }, 429);
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
