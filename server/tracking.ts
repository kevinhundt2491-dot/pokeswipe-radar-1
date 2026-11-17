// Treuhand-Härtung: DHL-Sendungsverfolgung (Shipment Tracking – Unified API) und automatischer Versandstatus.
//
// • DHL_TRACKING_API_KEY (oder – falls die DHL-App beide APIs freigeschaltet hat – DHL_API_KEY):
//   API-Schlüssel aus dem DHL-Entwicklerportal für „Shipment Tracking – Unified“. Ohne Schlüssel gilt die bisherige
//   Regel (Auszahlung AUTO_RELEASE_DAYS nach Versand, sofern der Käufer nicht reklamiert).
// • Der Treuhand-Job (netlify/functions/market-escrow.mts, alle 15 Min.) prüft versendete DHL-Bestellungen in
//   wachsenden Abständen. Beim Zustell-Scan startet die Prüffrist (RELEASE_AFTER_DELIVERY_DAYS) – erst danach wird ausgezahlt.
// Die Regeln selbst stehen in escrow-tracking-logic.ts.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, marketOrders } from "../db/index.ts";
import { notify } from "./prices.ts";
import { log } from "./log.ts";
import { currentJob } from "./resilience.ts";
import {
  initialReleaseAfter, parseDhlTracking, releaseAfterDelivery, trackingCheckDue, RELEASE_AFTER_DELIVERY_DAYS, type TrackingResult,
} from "./escrow-tracking-logic.ts";
import { AUTO_RELEASE_DAYS, CARRIERS } from "./market-logic.ts";
import { withdrawalDeadline } from "./cart-logic.ts";

const TRACK_URL = "https://api-eu.dhl.com/track/shipments";
const trackingKey = () => String(process.env.DHL_TRACKING_API_KEY || process.env.DHL_API_KEY || "").trim();
export const trackingEnabled = () => Boolean(trackingKey());

type Order = typeof marketOrders.$inferSelect;
const fmtDate = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });

export async function fetchDhlTracking(trackingNumber: string): Promise<TrackingResult | null> {
  const key = trackingKey();
  if (!key) return null;
  const url = `${TRACK_URL}?trackingNumber=${encodeURIComponent(trackingNumber)}&language=de&limit=1`;
  const res = await fetch(url, { headers: { "DHL-API-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (res.status === 429 || res.status >= 500) throw new Error(`DHL-Tracking HTTP ${res.status}`);
  if (res.status === 401 || res.status === 403) { log.error("tracking", "DHL-Tracking-Schlüssel abgelehnt", { status: res.status }); return null; }
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return parseDhlTracking(res.status, json);
}

/**
 * Automatischer Statuswechsel nach erfolgreich erzeugtem DHL-Etikett: „versendet“ mit Sendungsnummer und Zeitstempel,
 * Käufer wird benachrichtigt. Gibt die aktualisierte Bestellung zurück (oder null, wenn sie nicht mehr „bezahlt“ war).
 * Bei einem Ersatz-Etikett (Bestellung bereits per Etikett versendet, noch ohne DHL-Scan) wird nur die Sendungsnummer getauscht.
 */
export async function markShippedFromLabel(order: Order, shipmentNo: string, sandbox: boolean): Promise<Order | null> {
  const now = new Date();
  if (order.status === "shipped" && order.labelShippedAt) {
    const [u] = await db.update(marketOrders).set({
      trackingNumber: shipmentNo, trackingStatus: sandbox ? "sandbox" : "", trackingChecks: 0, trackingCheckedAt: null, updatedAt: now,
    }).where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, "shipped"))).returning();
    if (u) await notify(order.buyerId, "📦 Neue Sendungsnummer", `„${order.title}“: Der Verkäufer hat ein neues DHL-Etikett erstellt – Sendungsnummer ${shipmentNo}.`, "/?orders=1");
    return u ?? null;
  }
  if (order.status !== "paid" || order.frozen) return null;
  const enabled = trackingEnabled();
  const [u] = await db.update(marketOrders).set({
    status: "shipped", carrier: "dhl", trackingNumber: shipmentNo, shippedAt: now, labelShippedAt: now,
    releaseAfter: initialReleaseAfter("dhl", enabled, now, AUTO_RELEASE_DAYS, sandbox),
    trackingStatus: sandbox ? "sandbox" : "", trackingChecks: 0, trackingCheckedAt: null, deliveredAt: null, trackingAlertAt: null,
    ...(order.sellerType === "business" ? { withdrawalUntil: withdrawalDeadline("shipped", now, AUTO_RELEASE_DAYS) } : {}),
    updatedAt: now,
  }).where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, "paid"), eq(marketOrders.frozen, false))).returning();
  if (!u) return null;
  const tracked = enabled && !sandbox;
  await notify(order.buyerId, "📦 Versendet",
    `„${order.title}“ ist mit ${CARRIERS.dhl} unterwegs (Sendungsnummer ${shipmentNo}).${tracked
      ? ` Wir verfolgen die Sendung automatisch – ausgezahlt wird erst ${RELEASE_AFTER_DELIVERY_DAYS} Tage nach der Zustellung, falls du dich nicht meldest.`
      : ` Bitte bestätige den Erhalt, sobald die Karte da ist – sonst wird ${AUTO_RELEASE_DAYS} Tage nach Versand automatisch ausgezahlt.`}`, "/?orders=1");
  return u;
}

/** Ersatz/Storno: per Etikett gesetzten Versandstatus zurücknehmen, solange DHL die Sendung noch nicht gescannt hat. */
export async function revertLabelShipment(order: Order, shipmentNo: string): Promise<boolean> {
  if (order.status !== "shipped" || !order.labelShippedAt || order.trackingNumber !== shipmentNo) return false;
  if (order.trackingStatus === "transit" || order.trackingStatus === "delivered") return false;
  const [u] = await db.update(marketOrders).set({
    status: "paid", carrier: "", trackingNumber: "", shippedAt: null, labelShippedAt: null, releaseAfter: null,
    trackingStatus: "", trackingChecks: 0, trackingCheckedAt: null, deliveredAt: null, trackingAlertAt: null, withdrawalUntil: null, updatedAt: new Date(),
  }).where(and(eq(marketOrders.id, order.id), eq(marketOrders.status, "shipped"), eq(marketOrders.trackingNumber, shipmentNo))).returning();
  if (u) await notify(order.buyerId, "↩️ Versand storniert", `„${order.title}“: Der Verkäufer hat das DHL-Etikett storniert. Die Bestellung gilt wieder als „bezahlt, noch nicht versendet“.`, "/?orders=1");
  return Boolean(u);
}

/** Teil des Treuhand-Jobs: versendete DHL-Bestellungen ohne Zustell-Scan prüfen. */
export async function runTrackingChecks(limit = 25) {
  const result = { checked: 0, delivered: 0, errors: 0 };
  if (!trackingEnabled()) return result;
  const list = await db.select().from(marketOrders).where(and(
    eq(marketOrders.status, "shipped"), eq(marketOrders.carrier, "dhl"), eq(marketOrders.frozen, false), isNull(marketOrders.deliveredAt),
    sql`${marketOrders.trackingStatus} <> 'sandbox'`, sql`${marketOrders.trackingNumber} <> ''`,
    sql`(${marketOrders.trackingCheckedAt} IS NULL OR ${marketOrders.trackingCheckedAt} < now() - interval '1 hour')`,
  )).orderBy(sql`${marketOrders.trackingCheckedAt} NULLS FIRST`).limit(limit * 2);
  for (const o of list) {
    if (result.checked >= limit) break;
    if (!trackingCheckDue(o)) continue;
    if (currentJob()?.near(7000)) { currentJob()?.markPartial("Zeitbudget: Sendungsprüfung offen"); break; }
    result.checked++;
    let t: TrackingResult | null;
    try { t = await fetchDhlTracking(o.trackingNumber); }
    catch (e) {
      result.errors++;
      log.warn("tracking", "DHL-Tracking nicht erreichbar", { orderId: o.id, err: e });
      await db.update(marketOrders).set({ trackingCheckedAt: new Date(), trackingChecks: sql`${marketOrders.trackingChecks} + 1` }).where(eq(marketOrders.id, o.id));
      continue;
    }
    if (!t) break; // Schlüssel fehlt/abgelehnt → nächste Läufe
    const now = new Date();
    if (t.status === "delivered") {
      const deliveredAt = t.deliveredAt && t.deliveredAt.getTime() <= now.getTime() ? t.deliveredAt : now;
      const releaseAfter = releaseAfterDelivery(deliveredAt);
      const [u] = await db.update(marketOrders).set({
        trackingStatus: "delivered", deliveredAt, releaseAfter, trackingAlertAt: null, trackingCheckedAt: now,
        trackingChecks: sql`${marketOrders.trackingChecks} + 1`, updatedAt: now,
      }).where(and(eq(marketOrders.id, o.id), eq(marketOrders.status, "shipped"))).returning();
      if (u) {
        result.delivered++;
        await notify(o.buyerId, "📬 Zugestellt", `„${o.title}“ wurde laut DHL zugestellt. Bitte prüfe die Karte und bestätige den Erhalt – oder melde ein Problem bis ${fmtDate(releaseAfter)}. Danach wird automatisch ausgezahlt.`, "/?orders=1");
        await notify(o.sellerId, "📬 Zugestellt", `„${o.title}“ ist laut DHL beim Käufer angekommen. Die Auszahlung erfolgt am ${fmtDate(releaseAfter)}, sofern der Käufer nicht reklamiert (oder früher, wenn er den Erhalt bestätigt).`, "/?orders=1");
      }
      continue;
    }
    await db.update(marketOrders).set({ trackingStatus: t.status, trackingCheckedAt: now, trackingChecks: sql`${marketOrders.trackingChecks} + 1` })
      .where(and(eq(marketOrders.id, o.id), eq(marketOrders.status, "shipped")));
  }
  return result;
}
