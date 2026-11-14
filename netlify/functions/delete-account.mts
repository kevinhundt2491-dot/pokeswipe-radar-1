import type { Config } from "@netlify/functions";
import { admin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, profiles, listings } from "../../db/index.ts";

// Konto löschen (DSGVO Art. 17): Abo sofort beenden, alle Daten entfernen, Login löschen.
// Läuft als Netlify Function, weil nur hier das Löschen des Identity-Logins möglich ist.

async function verifiedUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const cookie = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(req.headers.get("cookie") || "")?.[1];
  const token = header.startsWith("Bearer ") ? header.slice(7) : cookie ? decodeURIComponent(cookie) : "";
  if (!token || token.length > 4096) return null;
  const res = await fetch(`${new URL(req.url).origin}/.netlify/identity/user`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.id ? { id: String(data.id), email: String(data.email || "") } : null;
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
  if (profile?.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
    try {
      await new Stripe(process.env.STRIPE_SECRET_KEY).subscriptions.cancel(profile.stripeSubscriptionId);
    } catch (e) {
      console.warn("Abo beim Löschen nicht gekündigt", e);
    }
  }
  if (profile) {
    // Hochgeladene Inserat-Fotos entfernen
    const own = await db.select({ image: listings.image }).from(listings).where(eq(listings.userId, user.id));
    const store = getStore("listing-images");
    for (const l of own) {
      const key = /^\/api\/images\/([a-f0-9-]{36})$/.exec(l.image)?.[1];
      if (key) await store.delete(key).catch(() => {});
    }
    await db.delete(profiles).where(eq(profiles.userId, user.id)); // alle verknüpften Daten folgen per Cascade
  }
  try {
    await admin.deleteUser(user.id);
  } catch (e) {
    console.error("Identity-Nutzer nicht gelöscht", e);
    return Response.json({ ok: true, partial: true, message: "Deine Daten sind gelöscht. Der Login wird vom Team manuell entfernt." });
  }
  return Response.json({ ok: true });
};

export const config: Config = {
  path: "/api/account/delete",
  method: "POST",
};
