import * as webpush from "web-push";
import { getStore } from "@netlify/blobs";
import { eq, inArray } from "drizzle-orm";
import { db, pushSubscriptions } from "../db/index.ts";
import { sendNativePush } from "./native-push.ts";

type Vapid = { publicKey: string; privateKey: string };
let vapid: Vapid | null = null;

/**
 * VAPID-Schlüssel für Web-Push. Vorrang haben Umgebungsvariablen; sonst werden sie einmalig
 * erzeugt und privat in Netlify Blobs gespeichert (nur der Server kann sie lesen).
 */
export async function getVapid(): Promise<Vapid> {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const store = getStore("app-config");
    let saved = (await store.get("vapid", { type: "json" })) as Vapid | null;
    if (!saved?.publicKey) {
      const fresh = webpush.generateVAPIDKeys();
      await store.setJSON("vapid", fresh, { onlyIfNew: true });
      saved = ((await store.get("vapid", { type: "json" })) as Vapid | null) ?? fresh;
    }
    vapid = saved;
  }
  // VAPID-Kontakt: aus VAPID_SUBJECT bzw. OPERATOR_EMAIL, sonst neutral die Website-Adresse (keine Kontaktdaten im Quellcode)
  webpush.setVapidDetails(vapidSubject(), vapid.publicKey, vapid.privateKey);
  return vapid;
}

export function vapidSubject(env: Record<string, string | undefined> = process.env): string {
  const subj = String(env.VAPID_SUBJECT || "").trim();
  if (/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/.test(subj)) return subj;
  const mail = String(env.OPERATOR_EMAIL || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return `mailto:${mail}`;
  const site = String(env.URL || "").trim();
  return /^https:\/\//.test(site) ? site : "https://pokeswipe-radar.de";
}

/** Schickt eine Push-Nachricht an alle Geräte eines Nutzers; abgelaufene Abos werden entfernt. */
export async function sendPush(userId: string, payload: { title: string; body: string; url: string }) {
  // Native App (Capacitor): parallel über Firebase Cloud Messaging, falls eingerichtet
  try { await sendNativePush(userId, payload); } catch (e: any) { console.warn("Native Push fehlgeschlagen", e?.message); }
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return;
  await getVapid();
  const dead: number[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, timeout: 5000, urgency: "normal" },
      );
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id);
      else console.warn("Push fehlgeschlagen", e?.statusCode || e?.message);
    }
  }));
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
}

const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com",
  "notify.windows.com", "push.services.mozilla.com",
];
export function isValidPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && ALLOWED_PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}
