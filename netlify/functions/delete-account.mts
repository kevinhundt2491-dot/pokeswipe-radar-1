import type { Config } from "@netlify/functions";
import { admin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, profiles, listings } from "../../db/index.ts";
import { log } from "../../server/log.ts";

// Konto löschen (DSGVO Art. 17): Abo sofort beenden, alle Daten entfernen, Login löschen.
// Läuft als Netlify Function, weil nur hier das Löschen des Identity-Logins möglich ist.

async function verifiedUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const cookie = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(req.headers.get("cookie") || "")?.[1];
  const token = header.startsWith("Bearer ") ? header.slice(7) : cookie ? decodeURIComponent(cookie) : "";
  if (!token || token.length > 4096) return null;
  try {
    // Identity-API der eigenen Website (feste Site-URL, nicht aus Anfrage-Headern abgeleitet)
    const base = process.env.URL || new URL(req.url).origin;
    const res = await fetch(`${base}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.id ? { id: String(data.id), email: String(data.email || "") } : null;
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Nur POST" }, { status: 405 });
  let originHost = "";
  try { originHost = new URL(req.headers.get("origin") || "").host; } catch {}
  if (!originHost || originHost !== new URL(req.url).host) {
    return Response.json({ error: "Anfrage von fremder Herkunft blockiert." }, { status: 403 });
  }
  let body: any = {};
  try { body = await req.json(); } catch {}
  if (body?.confirm !== "LÖSCHEN") return Response.json({ error: "Bitte zur Bestätigung LÖSCHEN eingeben." }, { status: 400 });

  const user = await verifiedUser(req);
  if (!user) return Response.json({ error: "Bitte melde dich an." }, { status: 401 });

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  // Laufende Treuhand-Käufe/-Verkäufe zuerst abschließen – sonst ginge Geld der Gegenseite verloren
  const [open] = (await db.execute(sql`SELECT count(*)::int AS n FROM market_orders
    WHERE (buyer_id = ${user.id} OR seller_id = ${user.id}) AND status IN ('paid', 'shipped', 'disputed', 'releasing', 'withdrawn')`)) as any;
  const openCount = Number((open?.rows?.[0] ?? open)?.n ?? 0);
  if (openCount > 0) {
    return Response.json({ error: `Du hast noch ${openCount} laufende Käufe/Verkäufe mit Käuferschutz. Bitte schließe sie ab (Erhalt bestätigen oder Erstattung), dann kannst du dein Konto löschen.` }, { status: 409 });
  }
  // Jeder Schritt einzeln und fehlertolerant; das Ergebnis zeigt, was erledigt wurde (idempotent wiederholbar)
  const steps: Record<string, "ok" | "skipped" | "failed"> = {};
  const step = async (name: string, fn: () => Promise<"ok" | "skipped">) => {
    try { steps[name] = await fn(); } catch (e) { steps[name] = "failed"; log.error("delete-account", `Schritt ${name} fehlgeschlagen`, { userId: user.id, err: e }); }
  };
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const notFound = (e: any) => e?.code === "resource_missing" || e?.statusCode === 404;

  // 1. Stripe: Abo sofort beenden, danach den Kunden löschen (entfernt gespeicherte Zahlungsmethoden; Rechnungen bleiben
  //    bei Stripe wegen der gesetzlichen Aufbewahrungspflicht erhalten)
  await step("stripeSubscription", async () => {
    if (!stripe || !profile?.stripeSubscriptionId) return "skipped";
    try { await stripe.subscriptions.cancel(profile.stripeSubscriptionId); } catch (e) { if (!notFound(e)) throw e; }
    return "ok";
  });
  await step("stripeCustomer", async () => {
    if (!stripe || !profile?.stripeCustomerId) return "skipped";
    try { await stripe.customers.del(profile.stripeCustomerId); } catch (e) { if (!notFound(e)) throw e; }
    return "ok";
  });
  // 2. Stripe Connect: Verkäuferkonto löschen. Mit Restguthaben lehnt Stripe das ab – dann Auszahlungen stoppen
  //    (Konto bleibt bei Stripe gesperrt bestehen, bis der Saldo ausgeglichen ist) und protokollieren.
  await step("stripeConnect", async () => {
    if (!stripe || !profile?.stripeAccountId) return "skipped";
    try {
      await stripe.accounts.del(profile.stripeAccountId);
    } catch (e: any) {
      if (notFound(e)) return "ok";
      await stripe.accounts.update(profile.stripeAccountId, { metadata: { deleted_user: "true", deleted_at: new Date().toISOString() } }).catch(() => {});
      throw e;
    }
    return "ok";
  });
  // 3. Firebase Realtime Database: Online-Anzeige (presence/<anonyme Firebase-UID>). Der Browser entfernt seinen Eintrag
  //    vor dem Aufruf selbst; serverseitig zusätzlich per REST, wenn ein Datenbank-Schlüssel hinterlegt ist.
  await step("firebasePresence", async () => {
    const fbUid = typeof body?.firebaseUid === "string" && /^[A-Za-z0-9]{10,64}$/.test(body.firebaseUid) ? body.firebaseUid : "";
    const secret = String(process.env.FIREBASE_DATABASE_SECRET || "").trim();
    const dbUrl = String(process.env.FIREBASE_DATABASE_URL || "https://pokeswiperadar-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/+$/, "");
    if (!fbUid) return "skipped";
    if (!secret) return body?.firebaseCleared === true ? "ok" : "skipped";
    const res = await fetch(`${dbUrl}/pokeswipe_radar/presence/${fbUid}.json?auth=${encodeURIComponent(secret)}`, { method: "DELETE", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Firebase ${res.status}`);
    return "ok";
  });
  // 4. Netlify Blobs: hochgeladene Inserat- und Pull-Wall-Fotos, Vorschaubilder von Profil, Shop und Beiträgen
  await step("blobs", async () => {
    if (!profile) return "skipped";
    const own = await db.select({ image: listings.image }).from(listings).where(eq(listings.userId, user.id));
    const posts = (await db.execute(sql`SELECT id, image FROM community_posts WHERE user_id = ${user.id}`)) as any;
    const postRows: any[] = Array.isArray(posts) ? posts : posts?.rows ?? [];
    const images = getStore("listing-images");
    for (const l of [...own, ...postRows]) {
      const key = /^\/api\/images\/([a-f0-9-]{36})$/.exec(String(l.image || ""))?.[1];
      if (key) await images.delete(key);
    }
    const og = getStore("og-images");
    const prefixes = [`u-${user.id}-`, `shop-${user.id}-`, ...postRows.map((p) => `p-${p.id}-`)];
    for (const prefix of prefixes) {
      const { blobs } = await og.list({ prefix });
      for (const b of blobs) await og.delete(b.key);
    }
    return "ok";
  });
  // 5. Datenbank: Profil löschen – alle verknüpften Zeilen (Portfolio, Inserate, Tausche, Matches, Steuerdaten,
  //    DAC7-Zähler, Likes …) folgen per ON DELETE CASCADE
  await step("database", async () => {
    if (!profile) return "skipped";
    await db.delete(profiles).where(eq(profiles.userId, user.id));
    return "ok";
  });
  if (steps.database === "failed") {
    return Response.json({ error: "Löschen fehlgeschlagen. Bitte versuche es erneut oder wende dich an den Support.", steps }, { status: 500 });
  }
  try {
    await admin.deleteUser(user.id);
  } catch (e) {
    log.error("delete-account", "Identity-Nutzer nicht gelöscht", { userId: user.id, err: e });
    return Response.json({ ok: true, partial: true, steps, message: "Deine Daten sind gelöscht. Der Login wird vom Team manuell entfernt." });
  }
  steps.identity = "ok";
  const partial = Object.values(steps).includes("failed");
  if (partial) log.warn("delete-account", "Konto gelöscht, einzelne Schritte fehlgeschlagen", { userId: user.id, steps });
  return Response.json({ ok: true, partial, steps });
};

export const config: Config = {
  path: "/api/account/delete",
  method: "POST",
};
