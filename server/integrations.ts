// PokeSwipe & Radar – Integrations-Check für die Admin-Zentrale: Stripe (Schlüssel, Webhook), Partner-IDs
// (Amazon, Cardmarket, eBay, Grading), E-Mail, Impressum, Katalog. Richtet den Stripe-Webhook auf Knopfdruck ein.
// Gibt niemals geheime Werte aus – nur „gesetzt / nicht gesetzt / Format ok“.
import { getStore } from "@netlify/blobs";
import { stripe } from "./billing.ts";
import { cardmarketPartnerId } from "./prices.ts";
import { getOperator, operatorComplete, mailConfigured } from "./legal.ts";
import { catalogStatus } from "./catalog.ts";
import { SITE } from "./growth.ts";
import { log } from "./log.ts";

export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Phase 6: Rückbuchungen (Chargebacks) – Treuhand einfrieren, Auszahlung zurückholen, Konto markieren
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

type AutoWebhook = { id: string; secret: string; url: string; createdAt: string };
type WebhookStatus = { lastEventAt: string | null; lastEventType: string | null; lastError: string | null; lastErrorAt: string | null };

// Strenge Konsistenz: ein gerade per Admin-Klick gespeichertes Webhook-Geheimnis gilt sofort (ohne Deploy, ohne CDN-Verzögerung)
const store = () => getStore({ name: "app-config", consistency: "strong" });
const webhookUrl = () => `${(process.env.URL || SITE()).replace(/\/$/, "")}/api/billing/webhook`;

async function autoWebhook(): Promise<AutoWebhook | null> {
  try { return (await store().get("stripe-webhook", { type: "json" })) as AutoWebhook | null; } catch { return null; }
}

/** Alle gültigen Signatur-Geheimnisse: Netlify-Variable STRIPE_WEBHOOK_SECRET und/oder automatisch eingerichteter Webhook. */
export async function webhookSecrets() {
  const list: string[] = [];
  const env = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (env) list.push(env);
  const auto = await autoWebhook();
  if (auto?.secret && !list.includes(auto.secret)) list.push(auto.secret);
  return list;
}

export async function recordWebhook(type: string, error?: string) {
  try {
    const prev = ((await store().get("stripe-webhook-status", { type: "json" })) as WebhookStatus | null) || { lastEventAt: null, lastEventType: null, lastError: null, lastErrorAt: null };
    const now = new Date().toISOString();
    const next: WebhookStatus = error ? { ...prev, lastError: error.slice(0, 200), lastErrorAt: now } : { ...prev, lastEventAt: now, lastEventType: type.slice(0, 80) };
    await store().setJSON("stripe-webhook-status", next);
  } catch {}
}

/** Legt den Stripe-Webhook für diese Seite an (oder erneuert ihn) und speichert das Signatur-Geheimnis in Netlify Blobs. */
export async function setupStripeWebhook() {
  const s = stripe();
  if (!s) return { ok: false, error: "STRIPE_SECRET_KEY ist nicht gesetzt." };
  const url = webhookUrl();
  if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) return { ok: false, error: "Der Webhook kann nur auf der veröffentlichten https-Seite eingerichtet werden." };
  const existing = await s.webhookEndpoints.list({ limit: 100 });
  const auto = await autoWebhook();
  const mine = existing.data.filter((e) => e.url === url);
  const stored = auto && mine.find((e) => e.id === auto.id);
  if (stored) {
    // Vorhandenen Webhook auf alle benötigten Ereignisse bringen
    await s.webhookEndpoints.update(stored.id, { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
    return { ok: true, id: stored.id, url, created: false };
  }
  // Ein schon vorhandener Endpunkt mit derselben Adresse, dessen Geheimnis wir nicht kennen: nur ersetzen,
  // wenn keine Netlify-Variable gesetzt ist (sonst wurde er bewusst manuell angelegt).
  if (mine.length && process.env.STRIPE_WEBHOOK_SECRET) {
    for (const e of mine) await s.webhookEndpoints.update(e.id, { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
    return { ok: true, id: mine[0].id, url, created: false, manual: true };
  }
  for (const e of mine) await s.webhookEndpoints.del(e.id).catch(() => {});
  const created = await s.webhookEndpoints.create({
    url, enabled_events: [...WEBHOOK_EVENTS],
    description: "PokeSwipe & Radar – Abos & Boosts (automatisch eingerichtet)",
  });
  if (!created.secret) return { ok: false, error: "Stripe hat kein Signatur-Geheimnis geliefert." };
  await store().setJSON("stripe-webhook", { id: created.id, secret: created.secret, url, createdAt: new Date().toISOString() } satisfies AutoWebhook);
  return { ok: true, id: created.id, url, created: true };
}

export async function integrationStatus() {
  const key = String(process.env.STRIPE_SECRET_KEY || "");
  const auto = await autoWebhook();
  let wh: WebhookStatus | null = null;
  try { wh = (await store().get("stripe-webhook-status", { type: "json" })) as WebhookStatus | null; } catch {}
  const amazon = String(process.env.AMAZON_PARTNER_TAG || "").trim();
  const { operator, legacy } = await getOperator();
  let catalog = null;
  try { catalog = await catalogStatus(); } catch {}
  return {
    stripe: {
      key: key ? (key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : "unbekannt") : null,
      webhook: process.env.STRIPE_WEBHOOK_SECRET ? "env" : auto?.secret ? "auto" : null,
      webhookUrl: webhookUrl(),
      lastEventAt: wh?.lastEventAt ?? null, lastEventType: wh?.lastEventType ?? null,
      lastError: wh?.lastError ?? null, lastErrorAt: wh?.lastErrorAt ?? null,
    },
    affiliate: {
      ebay: true,
      amazon: amazon ? (/^[a-z0-9][a-z0-9-]{1,38}-2[1-9]$/i.test(amazon) ? "ok" : "format") : null,
      cardmarket: cardmarketPartnerId() ? "ok" : String(process.env.CARDMARKET_PARTNER_ID || "").trim() ? "format" : null,
      grading: ["AFF_PSA_URL", "AFF_CGC_URL", "AFF_BGS_URL", "AFF_TAG_URL"].filter((k) => /^https:\/\//.test(String(process.env[k] || ""))),
    },
    mail: mailConfigured(),
    legal: { complete: operatorComplete(operator) || Boolean(legacy) },
    firebase: Boolean(String(process.env.FIREBASE_WEB_API_KEY || "").trim()),
    catalog,
  };
}

export function registerIntegrations(app: any, hlp: { auth: any; adminOnly: any }) {
  const { auth, adminOnly } = hlp;
  app.get("/api/admin/integrations", auth, adminOnly, async (c: any) => c.json(await integrationStatus()));
  app.post("/api/admin/integrations/stripe-webhook", auth, adminOnly, async (c: any) => {
    try {
      const r = await setupStripeWebhook();
      return c.json(r, r.ok ? 200 : 400);
    } catch (e: any) {
      log.error("integrations", "Stripe-Webhook-Einrichtung fehlgeschlagen", { err: e });
      return c.json({ ok: false, error: String(e?.message || "Stripe-Fehler").slice(0, 200) }, 502);
    }
  });
}
