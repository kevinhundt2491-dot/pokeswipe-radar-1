// Phase 8: Versandetiketten (DHL Parcel DE Shipping API v2) – Händler hinterlegen ihre eigenen DHL-Geschäftskunden-
// Zugangsdaten, erstellen das Etikett direkt aus der Bestellung und bezahlen es über ihren DHL-Vertrag.
//
// • Passwort: AES-256-GCM verschlüsselt. Der Schlüssel liegt getrennt von der Datenbank in Netlify Blobs
//   (Store "app-config", einmalig zufällig erzeugt). Ein Datenbank-Abzug allein verrät die Passwörter also nicht.
// • DHL_API_KEY: der API-Schlüssel der PokeSwipe-Anwendung im DHL-Entwicklerportal (Plattform-Ebene).
//   Ohne ihn ist die Funktion abgeschaltet und die Oberfläche zeigt einen Hinweis.
// • Etikett-PDF: Netlify Blobs (Store "shipping-labels"), nur für den Verkäufer abrufbar.
// • Nach dem Erstellen wird die Sendungsnummer zurückgegeben; der Verkäufer bestätigt den Versand wie bisher
//   mit einem Klick (Sendungsnummer und DHL sind vorausgefüllt), damit Treuhand-Fristen und Mitteilungen unverändert greifen.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db, marketOrders, sellerShippingAccounts, shippingLabels } from "../db/index.ts";
import type { AuthUser } from "./auth.ts";
import {
  DHL_BASE, DHL_PROFILE, DHL_PRODUCTS, PRINT_FORMATS, billingNumber, buildShipmentRequest, chooseProduct, consigneeFromAddress,
  parseShipmentResponse, validateShippingAccount, type DhlProduct, type PrintFormat,
} from "./shipping-logic.ts";
import { str, int, rateLimit } from "./util.ts";
import { log } from "./log.ts";

type Hlp = { auth: any; body: (c: any) => Promise<Record<string, any>> };
type Account = typeof sellerShippingAccounts.$inferSelect;

export const labelsEnabled = () => Boolean(String(process.env.DHL_API_KEY || "").trim());

// ---------------------------------------------------------------------------
// Verschlüsselung der Zugangsdaten
// ---------------------------------------------------------------------------
const KEY_NAME = "shipping-credential-key-v1";
let cachedKey: Buffer | null = null;

async function credentialKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const store = getStore({ name: "app-config", consistency: "strong" });
  let b64 = await store.get(KEY_NAME);
  if (!b64) {
    // Nur anlegen, wenn noch keiner existiert – parallele Instanzen können sich so nicht gegenseitig überschreiben
    await store.set(KEY_NAME, randomBytes(32).toString("base64"), { onlyIfNew: true });
    b64 = await store.get(KEY_NAME);
  }
  const key = Buffer.from(String(b64 || ""), "base64");
  if (key.length !== 32) throw new Error("Schlüssel für Versand-Zugangsdaten ungültig");
  cachedKey = key;
  return key;
}

export async function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await credentialKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export async function decryptSecret(token: string) {
  const [v, iv, tag, data] = String(token).split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unbekanntes Format");
  const d = createDecipheriv("aes-256-gcm", await credentialKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// DHL-Aufrufe
// ---------------------------------------------------------------------------
async function dhlFetch(acc: Account, path: string, init: RequestInit) {
  const password = await decryptSecret(acc.passwordEnc);
  const base = acc.sandbox ? DHL_BASE.sandbox : DHL_BASE.production;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "dhl-api-key": String(process.env.DHL_API_KEY || "").trim(),
      Authorization: `Basic ${Buffer.from(`${acc.username}:${password}`).toString("base64")}`,
      Accept: "application/json",
      "Accept-Language": "de-DE",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function shipperOf(acc: Account) {
  return { name: acc.senderName, street: acc.senderStreet, house: acc.senderHouse, zip: acc.senderZip, city: acc.senderCity, country: acc.senderCountry, email: acc.senderEmail || undefined };
}

const accountView = (a: Account | undefined) => a ? {
  configured: true, provider: a.provider, username: a.username, ekp: a.ekp, participation: a.participation, sandbox: a.sandbox,
  senderName: a.senderName, senderStreet: a.senderStreet, senderHouse: a.senderHouse, senderZip: a.senderZip, senderCity: a.senderCity,
  senderCountry: a.senderCountry, senderEmail: a.senderEmail, defaultProduct: a.defaultProduct, defaultWeightG: a.defaultWeightG,
  verifiedAt: a.verifiedAt, lastError: a.lastError, hasPassword: Boolean(a.passwordEnc),
} : { configured: false };

const labelStore = () => getStore({ name: "shipping-labels", consistency: "strong" });

async function loadAccount(userId: string) {
  const [a] = await db.select().from(sellerShippingAccounts).where(eq(sellerShippingAccounts.userId, userId)).limit(1);
  return a;
}

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerShipping(app: any, { auth, body }: Hlp) {
  app.get("/api/shipping/meta", (c: any) => c.json({
    enabled: labelsEnabled(),
    products: Object.entries(DHL_PRODUCTS).map(([code, p]) => ({ code, label: p.label, maxG: p.maxG, international: p.international })),
    printFormats: PRINT_FORMATS,
  }));

  app.get("/api/seller/shipping-account", auth, async (c: any) => {
    c.header("Cache-Control", "private, no-store");
    return c.json({ enabled: labelsEnabled(), account: accountView(await loadAccount(c.get("user").id)) });
  });

  // Anlegen/Ändern; leeres Passwort beim Ändern = bisheriges behalten. Danach Probelauf bei DHL (validate=true).
  app.put("/api/seller/shipping-account", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!(await rateLimit(`shipacc:${user.id}`, 10, 60_000))) return c.json({ error: "Zu viele Änderungen in kurzer Zeit." }, 429);
    const existing = await loadAccount(user.id);
    const r = validateShippingAccount(await body(c), !existing);
    if (!r.ok) return c.json({ error: r.error }, 400);
    const v = r.value;
    const passwordEnc = v.password ? await encryptSecret(v.password) : existing!.passwordEnc;
    const row = {
      provider: "dhl", username: v.username, passwordEnc, ekp: v.ekp, participation: v.participation, sandbox: v.sandbox,
      senderName: v.senderName, senderStreet: v.senderStreet, senderHouse: v.senderHouse, senderZip: v.senderZip, senderCity: v.senderCity,
      senderCountry: v.senderCountry, senderEmail: v.senderEmail, defaultProduct: v.defaultProduct, defaultWeightG: v.defaultWeightG,
      verifiedAt: null, lastError: "", updatedAt: new Date(),
    };
    const [saved] = await db.insert(sellerShippingAccounts).values({ userId: user.id, ...row })
      .onConflictDoUpdate({ target: sellerShippingAccounts.userId, set: row }).returning();
    let check: { ok: boolean; error?: string } = { ok: false, error: "DHL-Anbindung ist auf der Plattform noch nicht freigeschaltet." };
    if (labelsEnabled()) check = await verifyAccount(saved);
    return c.json({ ok: true, verified: check.ok, verifyError: check.ok ? "" : check.error, account: accountView(await loadAccount(user.id)) });
  });

  app.post("/api/seller/shipping-account/verify", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!labelsEnabled()) return c.json({ error: "DHL-Anbindung ist auf der Plattform noch nicht freigeschaltet." }, 503);
    if (!(await rateLimit(`shipacc:${user.id}`, 10, 60_000))) return c.json({ error: "Zu viele Versuche in kurzer Zeit." }, 429);
    const acc = await loadAccount(user.id);
    if (!acc) return c.json({ error: "Noch keine DHL-Zugangsdaten hinterlegt." }, 404);
    const r = await verifyAccount(acc);
    return c.json({ verified: r.ok, error: r.ok ? "" : r.error, account: accountView(await loadAccount(user.id)) });
  });

  app.delete("/api/seller/shipping-account", auth, async (c: any) => {
    await db.delete(sellerShippingAccounts).where(eq(sellerShippingAccounts.userId, c.get("user").id));
    return c.json({ ok: true });
  });

  // Etiketten einer Bestellung (nur Verkäufer)
  app.get("/api/orders/:id/labels", auth, async (c: any) => {
    const order = await sellerOrder(c);
    if (!order) return c.json({ error: "Bestellung nicht gefunden" }, 404);
    const list = await db.select().from(shippingLabels).where(eq(shippingLabels.marketOrderId, order.id)).orderBy(desc(shippingLabels.createdAt));
    c.header("Cache-Control", "private, no-store");
    return c.json({ labels: list.map(labelView) });
  });

  app.post("/api/orders/:id/label", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    if (!labelsEnabled()) return c.json({ error: "DHL-Etiketten sind auf der Plattform noch nicht freigeschaltet." }, 503);
    if (!(await rateLimit(`label:${user.id}`, 20, 60_000))) return c.json({ error: "Zu viele Etiketten in kurzer Zeit." }, 429);
    const order = await sellerOrder(c);
    if (!order) return c.json({ error: "Bestellung nicht gefunden" }, 404);
    if (order.frozen) return c.json({ error: "Diese Bestellung ist wegen einer Rückbuchung eingefroren." }, 409);
    if (order.status !== "paid") return c.json({ error: "Etiketten gibt es nur für bezahlte, noch nicht versendete Bestellungen." }, 409);
    const acc = await loadAccount(user.id);
    if (!acc) return c.json({ error: "Bitte zuerst deine DHL-Geschäftskunden-Zugangsdaten im Händler-Bereich hinterlegen." }, 412);
    const [active] = await db.select().from(shippingLabels).where(and(eq(shippingLabels.marketOrderId, order.id), eq(shippingLabels.status, "created"))).limit(1);
    const b = await body(c);
    if (active && b.replace !== true) return c.json({ error: "Für diese Bestellung gibt es schon ein Etikett. Erst stornieren oder „Neues Etikett“ bestätigen.", label: labelView(active) }, 409);
    const consignee = consigneeFromAddress(order.shippingAddress);
    if (!consignee.ok) return c.json({ error: consignee.error }, 422);
    const weightG = int(b.weightG, 10, 31_500, acc.defaultWeightG);
    const prod = chooseProduct(b.product || undefined, consignee.value.country, weightG, acc.defaultProduct as DhlProduct);
    if (!prod.ok) return c.json({ error: prod.error }, 422);
    const printFormat: PrintFormat = (PRINT_FORMATS as readonly string[]).includes(String(b.printFormat)) ? b.printFormat : "A4";
    const payload = buildShipmentRequest({
      product: prod.product, billingNumber: billingNumber(acc.ekp, prod.product, acc.participation as any), refNo: `PokeSwipe-${order.id}`,
      weightG, shipper: shipperOf(acc), consignee: consignee.value,
    });
    let res;
    try {
      res = await dhlFetch(acc, `/orders?includeDocs=include&docFormat=PDF&printFormat=${encodeURIComponent(printFormat)}&combine=true`, { method: "POST", body: JSON.stringify(payload) });
    } catch (e) {
      log.error("shipping", "DHL nicht erreichbar", { orderId: order.id, err: e });
      return c.json({ error: "DHL ist gerade nicht erreichbar. Bitte später erneut versuchen." }, 502);
    }
    const parsed = parseShipmentResponse(res.status, res.json);
    if (!parsed.ok) {
      await db.update(sellerShippingAccounts).set({ lastError: parsed.error.slice(0, 300), updatedAt: new Date() }).where(eq(sellerShippingAccounts.userId, user.id));
      if (parsed.status >= 500) log.error("shipping", "DHL-Fehler beim Etikett", { orderId: order.id, status: res.status });
      return c.json({ error: parsed.error }, parsed.status);
    }
    let pdf: Buffer | null = parsed.labelB64 ? Buffer.from(parsed.labelB64, "base64") : null;
    if (!pdf && parsed.labelUrl && /^https:\/\/[a-z0-9.-]*dhl\.com\//i.test(parsed.labelUrl)) {
      try { const r = await fetch(parsed.labelUrl, { signal: AbortSignal.timeout(15_000) }); if (r.ok) pdf = Buffer.from(await r.arrayBuffer()); } catch {}
    }
    if (!pdf) return c.json({ error: `Die Sendung ${parsed.shipmentNo} wurde bei DHL angelegt, das PDF kam aber nicht an. Bitte im DHL-Portal drucken.`, shipmentNo: parsed.shipmentNo }, 502);
    const blobKey = `${user.id}/${order.id}/${parsed.shipmentNo}.pdf`;
    await labelStore().set(blobKey, pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, { metadata: { contentType: "application/pdf" } });
    // Altes Etikett beim Ersetzen bei DHL stornieren (best effort)
    if (active) await cancelLabel(acc, active).catch(() => null);
    const [label] = await db.insert(shippingLabels).values({
      marketOrderId: order.id, sellerId: user.id, provider: "dhl", product: prod.product, shipmentNo: parsed.shipmentNo, weightG, blobKey, sandbox: acc.sandbox,
    }).returning();
    await db.update(sellerShippingAccounts).set({ lastError: "", verifiedAt: acc.verifiedAt ?? new Date(), updatedAt: new Date() }).where(eq(sellerShippingAccounts.userId, user.id));
    log.info("shipping", "DHL-Etikett erstellt", { orderId: order.id, product: prod.product, sandbox: acc.sandbox });
    return c.json({ ok: true, label: labelView(label), carrier: "dhl", trackingNumber: parsed.shipmentNo, warnings: parsed.warnings, sandbox: acc.sandbox }, 201);
  });

  app.get("/api/orders/:id/label/:labelId/pdf", auth, async (c: any) => {
    const order = await sellerOrder(c);
    if (!order) return c.json({ error: "Bestellung nicht gefunden" }, 404);
    const labelId = int(c.req.param("labelId"), 1, 2 ** 31 - 1, 0);
    const [label] = await db.select().from(shippingLabels).where(and(eq(shippingLabels.id, labelId), eq(shippingLabels.marketOrderId, order.id))).limit(1);
    if (!label) return c.json({ error: "Etikett nicht gefunden" }, 404);
    const data = await labelStore().get(label.blobKey, { type: "arrayBuffer" });
    if (!data) return c.json({ error: "Etikett-Datei nicht mehr vorhanden" }, 404);
    return new Response(data, { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="DHL-${label.shipmentNo}.pdf"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  });

  app.delete("/api/orders/:id/label/:labelId", auth, async (c: any) => {
    const user: AuthUser = c.get("user");
    const order = await sellerOrder(c);
    if (!order) return c.json({ error: "Bestellung nicht gefunden" }, 404);
    const labelId = int(c.req.param("labelId"), 1, 2 ** 31 - 1, 0);
    const [label] = await db.select().from(shippingLabels).where(and(eq(shippingLabels.id, labelId), eq(shippingLabels.marketOrderId, order.id), eq(shippingLabels.status, "created"))).limit(1);
    if (!label) return c.json({ error: "Kein aktives Etikett gefunden" }, 404);
    if (order.status !== "paid" && order.trackingNumber === label.shipmentNo) return c.json({ error: "Die Sendung ist bereits als versendet gemeldet und kann nicht mehr storniert werden." }, 409);
    const acc = await loadAccount(user.id);
    if (!acc) return c.json({ error: "DHL-Zugangsdaten fehlen – bitte im DHL-Portal stornieren." }, 412);
    const r = await cancelLabel(acc, label);
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 502);
  });
}

async function sellerOrder(c: any) {
  const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
  if (!id) return null;
  const [o] = await db.select().from(marketOrders).where(and(eq(marketOrders.id, id), eq(marketOrders.sellerId, c.get("user").id))).limit(1);
  return o ?? null;
}

const labelView = (l: typeof shippingLabels.$inferSelect) => ({
  id: l.id, product: l.product, productLabel: DHL_PRODUCTS[l.product as DhlProduct]?.label || l.product, shipmentNo: l.shipmentNo,
  weightG: l.weightG, status: l.status, sandbox: l.sandbox, createdAt: l.createdAt, pdfUrl: `/api/orders/${l.marketOrderId}/label/${l.id}/pdf`,
});

/** Probelauf: validiert eine Beispielsendung an die eigene Adresse, ohne ein Etikett zu kaufen. */
async function verifyAccount(acc: Account): Promise<{ ok: boolean; error?: string }> {
  try {
    const product = (acc.defaultProduct in DHL_PRODUCTS ? acc.defaultProduct : "V62KP") as DhlProduct;
    const payload = buildShipmentRequest({
      product: DHL_PRODUCTS[product].international ? "V62KP" : product, billingNumber: billingNumber(acc.ekp, DHL_PRODUCTS[product].international ? "V62KP" : product, acc.participation as any),
      refNo: "PokeSwipe-Test", weightG: 500, shipper: shipperOf(acc),
      consignee: { name1: acc.senderName, addressStreet: acc.senderStreet, ...(acc.senderHouse ? { addressHouse: acc.senderHouse } : {}), postalCode: acc.senderZip, city: acc.senderCity, country: "DEU" },
    });
    const res = await dhlFetch(acc, "/orders?validate=true", { method: "POST", body: JSON.stringify(payload) });
    const item = Array.isArray(res.json?.items) ? res.json.items[0] : null;
    const ok = res.status === 200 && (!item?.sstatus || Number(item.sstatus.statusCode) < 400);
    const error = ok ? "" : res.status === 401 || res.status === 403
      ? "DHL hat die Zugangsdaten abgelehnt. Bitte Benutzername, Passwort und EKP prüfen."
      : (parseShipmentResponse(res.status, res.json) as any).error || `DHL-Prüfung fehlgeschlagen (HTTP ${res.status}).`;
    await db.update(sellerShippingAccounts).set({ verifiedAt: ok ? new Date() : null, lastError: error.slice(0, 300), updatedAt: new Date() }).where(eq(sellerShippingAccounts.userId, acc.userId));
    return ok ? { ok } : { ok, error };
  } catch (e) {
    log.warn("shipping", "DHL-Prüfung fehlgeschlagen", { userId: acc.userId, err: e });
    return { ok: false, error: "DHL ist gerade nicht erreichbar. Bitte später erneut prüfen." };
  }
}

async function cancelLabel(acc: Account, label: typeof shippingLabels.$inferSelect): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await dhlFetch(acc, `/orders?profile=${encodeURIComponent(DHL_PROFILE)}&shipment=${encodeURIComponent(label.shipmentNo)}`, { method: "DELETE" });
    if (res.status !== 200 && res.status !== 207) {
      const detail = str(res.json?.items?.[0]?.sstatus?.detail || res.json?.detail || "", 200);
      return { ok: false, error: `DHL konnte das Etikett nicht stornieren${detail ? `: ${detail}` : "."} Bereits eingelieferte Sendungen lassen sich nicht stornieren.` };
    }
    await db.update(shippingLabels).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(shippingLabels.id, label.id));
    await labelStore().delete(label.blobKey).catch(() => {});
    return { ok: true };
  } catch (e) {
    log.warn("shipping", "DHL-Storno fehlgeschlagen", { labelId: label.id, err: e });
    return { ok: false, error: "DHL ist gerade nicht erreichbar. Bitte später erneut versuchen." };
  }
}
