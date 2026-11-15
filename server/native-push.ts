// Phase 4: Push-Nachrichten an die native App (Capacitor, iOS & Android) über Firebase Cloud Messaging (HTTP v1).
// Aktiv, sobald FCM_SERVICE_ACCOUNT (JSON des Firebase-Dienstkontos, einzeilig) als Umgebungsvariable gesetzt ist.
// Ohne die Variable bleibt alles wie bisher: Web-Push (Service Worker) und Mitteilungen in der App.
import { createSign } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, nativePushTokens } from "../db/index.ts";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let cachedToken: { value: string; expires: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.FCM_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    return sa?.project_id && sa?.client_email && sa?.private_key ? { ...sa, private_key: String(sa.private_key).replace(/\\n/g, "\n") } : null;
  } catch { return null; }
}
export const nativePushConfigured = () => Boolean(serviceAccount());

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** OAuth-Zugangstoken für FCM aus dem Dienstkonto (signiertes JWT, 55 Minuten zwischengespeichert). */
async function accessToken(sa: ServiceAccount) {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  const jwt = `${head}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`FCM-Token ${res.status}`);
  const data: any = await res.json();
  cachedToken = { value: String(data.access_token), expires: Date.now() + 55 * 60_000 };
  return cachedToken.value;
}

/** Schickt eine Nachricht an alle registrierten App-Geräte eines Nutzers; ungültige Tokens werden entfernt. */
export async function sendNativePush(userId: string, payload: { title: string; body: string; url: string }) {
  const sa = serviceAccount();
  if (!sa) return;
  const tokens = await db.select().from(nativePushTokens).where(eq(nativePushTokens.userId, userId));
  if (!tokens.length) return;
  const bearer = await accessToken(sa);
  const dead: number[] = [];
  await Promise.all(tokens.map(async (t) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token: t.token,
          notification: { title: payload.title, body: payload.body },
          data: { url: payload.url || "/" },
          android: { priority: "high", notification: { channel_id: "pokeswipe", icon: "ic_stat_pokeswipe", color: "#FFCB05" } },
          apns: { payload: { aps: { sound: "default" } } },
        } }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 404 || res.status === 400) {
        const err: any = await res.json().catch(() => ({}));
        if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(JSON.stringify(err))) dead.push(t.id);
      } else if (!res.ok) console.warn("FCM", res.status);
    } catch (e: any) { console.warn("FCM fehlgeschlagen", e?.message); }
  }));
  if (dead.length) await db.delete(nativePushTokens).where(inArray(nativePushTokens.id, dead));
}
