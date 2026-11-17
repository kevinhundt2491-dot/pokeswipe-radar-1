// Treuhand-Härtung (reine Regeln, ohne Datenbank – tests/escrow-tracking.test.ts):
//  • DHL-Etikett erzeugt → Bestellung automatisch „versendet“ (Sendungsnummer + Zeitstempel, Käufer wird benachrichtigt)
//  • Die Auszahlungsfrist an den Verkäufer startet erst ab bestätigter Zustellung (DHL-Zustell-Scan „delivered“)
//  • Sicherer Fallback: Meldet DHL keinen Zustell-Scan, wird in wachsenden Abständen weiter geprüft. Nach
//    TRACKING_FALLBACK_DAYS wird nur ausgezahlt, wenn DHL die Sendung nachweislich transportiert hat (Versandnachweis).
//    Ohne jeden Carrier-Scan gibt es KEINE automatische Auszahlung – die Bestellung geht an die Admin-Prüfung.
//  • Nicht verfolgbare Versandarten (andere Paketdienste, DHL ohne Tracking-Schlüssel, Sandbox-Etiketten) behalten die
//    bisherige Regel (AUTO_RELEASE_DAYS nach Versand, Käufer kann jederzeit reklamieren).

export const RELEASE_AFTER_DELIVERY_DAYS = 3;
export const TRACKING_FALLBACK_DAYS = 21;
const DAY = 86400_000;

export type TrackingStatus = "" | "pre-transit" | "transit" | "delivered" | "failure" | "unknown" | "sandbox";
const KNOWN: TrackingStatus[] = ["pre-transit", "transit", "delivered", "failure", "unknown"];

/** Hat DHL die Sendung tatsächlich übernommen (Transport- oder Zustell-Scan)? */
export const hasCarrierScan = (s: string | null | undefined) => s === "transit" || s === "delivered";

/** Wird diese Sendung automatisch über die DHL-Sendungsverfolgung geprüft? */
export function isTrackable(o: { carrier: string; trackingStatus?: string | null }, trackingEnabled: boolean) {
  return trackingEnabled && o.carrier === "dhl" && o.trackingStatus !== "sandbox";
}

/** Erste Auszahlungsfrist beim Versand: verfolgbar → spätester Fallback-Zeitpunkt, sonst bisherige Regel. */
export function initialReleaseAfter(carrier: string, trackingEnabled: boolean, shippedAt: Date, autoReleaseDays: number, sandbox = false): Date {
  const trackable = isTrackable({ carrier, trackingStatus: sandbox ? "sandbox" : "" }, trackingEnabled);
  return new Date(shippedAt.getTime() + (trackable ? TRACKING_FALLBACK_DAYS : autoReleaseDays) * DAY);
}

/** Nach dem Zustell-Scan: Prüffrist für den Käufer, danach Auszahlung. */
export const releaseAfterDelivery = (deliveredAt: Date) => new Date(deliveredAt.getTime() + RELEASE_AFTER_DELIVERY_DAYS * DAY);

/** Prüfabstand: anfangs stündlich, nach 6 Prüfungen alle 3 h, nach 20 Prüfungen alle 6 h (schont das DHL-Kontingent). */
export function trackingIntervalMs(checks: number): number {
  if (checks < 6) return 3600_000;
  if (checks < 20) return 3 * 3600_000;
  return 6 * 3600_000;
}

export function trackingCheckDue(o: { trackingCheckedAt: Date | string | null; trackingChecks: number }, now = new Date()): boolean {
  if (!o.trackingCheckedAt) return true;
  return now.getTime() - new Date(o.trackingCheckedAt).getTime() >= trackingIntervalMs(Number(o.trackingChecks) || 0);
}

export type TrackingResult = { status: TrackingStatus; deliveredAt: Date | null; lastEvent: string; found: boolean };

/**
 * Antwort der DHL Shipment Tracking – Unified API (GET /track/shipments) auswerten.
 * 404 = Sendung (noch) nicht bekannt → kein Scan. Unbekannte Statuswerte zählen als „unknown“.
 */
export function parseDhlTracking(httpStatus: number, json: any): TrackingResult {
  if (httpStatus === 404) return { status: "pre-transit", deliveredAt: null, lastEvent: "Noch kein Scan bei DHL", found: false };
  const sh = Array.isArray(json?.shipments) ? json.shipments[0] : null;
  if (httpStatus !== 200 || !sh) return { status: "unknown", deliveredAt: null, lastEvent: "", found: false };
  const code = String(sh.status?.statusCode || "").toLowerCase() as TrackingStatus;
  const status: TrackingStatus = KNOWN.includes(code) ? code : "unknown";
  const events: any[] = Array.isArray(sh.events) ? sh.events : [];
  let deliveredAt: Date | null = null;
  if (status === "delivered") {
    const ev = events.find((e) => String(e?.statusCode || "").toLowerCase() === "delivered") || sh.status;
    const t = new Date(ev?.timestamp || sh.status?.timestamp || "");
    deliveredAt = Number.isFinite(t.getTime()) ? t : null;
  }
  // Transportnachweis auch dann, wenn der Gesamtstatus „unknown“ ist, aber Transport-Scans vorliegen
  const transitSeen = events.some((e) => ["transit", "delivered"].includes(String(e?.statusCode || "").toLowerCase()));
  const finalStatus: TrackingStatus = status === "unknown" && transitSeen ? "transit" : status;
  const lastEvent = String(sh.status?.description || sh.status?.status || events[0]?.description || "").slice(0, 200);
  return { status: finalStatus, deliveredAt, lastEvent, found: true };
}

export type ReleaseInput = {
  carrier: string; trackingStatus: string; shippedAt: Date | string | null; deliveredAt: Date | string | null;
  releaseAfter: Date | string | null;
};
export type ReleaseDecision = { action: "release" | "wait" | "review"; reason: string };

/** Darf eine versendete Bestellung jetzt automatisch an den Verkäufer ausgezahlt werden? */
export function releaseDecision(o: ReleaseInput, trackingEnabled: boolean, now = new Date()): ReleaseDecision {
  const due = o.releaseAfter && new Date(o.releaseAfter).getTime() <= now.getTime();
  if (!due) return { action: "wait", reason: "Frist läuft noch" };
  if (!isTrackable(o, trackingEnabled)) return { action: "release", reason: "Automatisch nach Ablauf der Prüffrist." };
  if (o.deliveredAt) return { action: "release", reason: `Automatisch ${RELEASE_AFTER_DELIVERY_DAYS} Tage nach DHL-Zustellung ohne Reklamation.` };
  if (o.trackingStatus === "failure") return { action: "review", reason: "DHL meldet ein Zustellproblem (z. B. Rücksendung) – Auszahlung nur nach Prüfung." };
  const shipped = o.shippedAt ? new Date(o.shippedAt).getTime() : 0;
  if (now.getTime() - shipped < TRACKING_FALLBACK_DAYS * DAY) return { action: "wait", reason: "Warte auf DHL-Zustell-Scan" };
  if (hasCarrierScan(o.trackingStatus)) {
    return { action: "release", reason: `Automatisch ${TRACKING_FALLBACK_DAYS} Tage nach Versand – DHL hat die Sendung transportiert, aber keinen Zustell-Scan gemeldet.` };
  }
  return { action: "review", reason: "Kein Versandnachweis: DHL hat die Sendung bisher nicht gescannt – keine automatische Auszahlung." };
}

export const TRACKING_LABEL: Record<string, string> = {
  "": "Wird geprüft", "pre-transit": "Etikett erstellt – noch nicht bei DHL", transit: "Unterwegs", delivered: "Zugestellt",
  failure: "Zustellproblem", unknown: "Status unbekannt", sandbox: "Test-Etikett (Sandbox)",
};
