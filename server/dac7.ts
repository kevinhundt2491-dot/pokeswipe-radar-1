// Phase 6: DAC7 (Plattformen-Steuertransparenzgesetz) – Jahreszähler je Verkäufer, Erfassung der Steuerdaten,
// Erinnerungen/Sperre bei fehlenden Angaben und Admin-Export für die Meldung an das Bundeszentralamt für Steuern.
//
// Die Zähler (seller_dac7_stats) werden bei jeder Auszahlung (releaseOrder) fortgeschrieben und bei einer
// Rückbuchung/Erstattung nach der Auszahlung korrigiert. Die reinen Schwellen-/Prüfregeln stehen in dac7-logic.ts.
import { and, eq, gte, sql } from "drizzle-orm";
import { db, marketOrders, sellerDac7Stats, sellerTaxInfo, sellerAccounts, moderationLog } from "../db/index.ts";
import { notify } from "./prices.ts";
import { str, int, rows, rateLimit } from "./util.ts";
import { log } from "./log.ts";
import { sealField, openField, openFieldSafe, needsReseal, vaultConfigured } from "./vault.ts";
import { maskBirthDate, maskIban, maskTaxId } from "./vault-logic.ts";
import {
  dac7Reportable, dac7ReminderDue, dac7Blocked, commercialReasons, netConsiderationCents, validateTaxInfo, taxInfoComplete,
  csvRow, csvEuro, psttgStage, PSTTG_WARN_TX, PSTTG_WARN_GROSS_CENTS, DAC7_MAX_REMINDERS, DAC7_REMINDER_INTERVAL_DAYS, DAC7_TX_THRESHOLD, DAC7_GROSS_THRESHOLD_CENTS,
} from "./dac7-logic.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
type Order = typeof marketOrders.$inferSelect;
type TaxRow = typeof sellerTaxInfo.$inferSelect;

/** Kalenderjahr und Quartal in deutscher Zeit (Jahreswechsel um Mitternacht in Berlin, nicht UTC). */
export function berlinYearQuarter(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "numeric" }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value) || d.getUTCFullYear();
  const month = Number(parts.find((p) => p.type === "month")?.value) || d.getUTCMonth() + 1;
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

const quarterColumn = (q: 1 | 2 | 3 | 4) => ({ 1: sellerDac7Stats.q1Cents, 2: sellerDac7Stats.q2Cents, 3: sellerDac7Stats.q3Cents, 4: sellerDac7Stats.q4Cents })[q];
const quarterKey = (q: 1 | 2 | 3 | 4) => (`q${q}Cents`) as "q1Cents" | "q2Cents" | "q3Cents" | "q4Cents";

// ---------------------------------------------------------------------------
// Zähler fortschreiben
// ---------------------------------------------------------------------------
/** Nach erfolgreicher Auszahlung: Verkauf, Vergütung (Preis + Versand), Provision und Quartal zählen. */
export async function recordDac7Release(order: Pick<Order, "sellerId" | "priceCents" | "shippingCents" | "feeCents">, at = new Date()) {
  const { year, quarter } = berlinYearQuarter(at);
  const gross = order.priceCents + order.shippingCents;
  const col = quarterColumn(quarter);
  await db.insert(sellerDac7Stats).values({
    userId: order.sellerId, year, transactions: 1, grossCents: gross, feeCents: order.feeCents, [quarterKey(quarter)]: gross,
  }).onConflictDoUpdate({
    target: [sellerDac7Stats.userId, sellerDac7Stats.year],
    set: {
      transactions: sql`${sellerDac7Stats.transactions} + 1`,
      grossCents: sql`${sellerDac7Stats.grossCents} + ${gross}`,
      feeCents: sql`${sellerDac7Stats.feeCents} + ${order.feeCents}`,
      [quarterKey(quarter)]: sql`${col} + ${gross}`,
      updatedAt: new Date(),
    },
  });
  await refreshPsttgFlags(order.sellerId, year);
}

/**
 * Phase 10: PStTG-Stufen nach jeder Änderung des Jahreszählers fortschreiben.
 *  – ab 25 Verkäufen oder 1.700 €: einmalige Vorwarnung (Mitteilung + Banner), sofern Steuerdaten fehlen
 *  – ab 30 Verkäufen oder mehr als 2.000 €: reporting_required = true → Datensatz erscheint im PStTG-Export
 * Fällt der Umsatz durch Erstattungen wieder unter die Grenze, wird die Markierung zurückgenommen.
 */
export async function refreshPsttgFlags(userId: string, year: number) {
  const [row] = await db.select().from(sellerDac7Stats).where(and(eq(sellerDac7Stats.userId, userId), eq(sellerDac7Stats.year, year))).limit(1);
  if (!row) return null;
  const stage = psttgStage(row);
  const reporting = stage === "reporting";
  if (reporting !== row.reportingRequired) {
    await db.update(sellerDac7Stats).set({ reportingRequired: reporting, updatedAt: new Date() }).where(eq(sellerDac7Stats.id, row.id));
  }
  if (stage !== "none" && !row.thresholdWarningSent) {
    // Genau einmal je Verkäufer und Jahr (parallele Auszahlungen)
    const [claimed] = await db.update(sellerDac7Stats).set({ thresholdWarningSent: true, thresholdWarningAt: new Date() })
      .where(and(eq(sellerDac7Stats.id, row.id), eq(sellerDac7Stats.thresholdWarningSent, false))).returning({ id: sellerDac7Stats.id });
    if (claimed && !rawComplete(await taxRowOf(userId))) {
      await notify(userId, reporting ? "🧾 PStTG-Meldegrenze erreicht" : "🧾 Bald meldepflichtig: Steuerdaten hinterlegen",
        reporting
          ? `Du hast ${year} ${DAC7_TX_THRESHOLD} Verkäufe oder mehr als ${(DAC7_GROSS_THRESHOLD_CENTS / 100).toLocaleString("de-DE")} € Umsatz erreicht. Nach dem Plattformen-Steuertransparenzgesetz müssen wir Name, Anschrift, Geburtsdatum, Steuer-ID und IBAN an das Bundeszentralamt für Steuern melden. Bitte trage sie im Verkäuferkonto unter „Steuerdaten (DAC7)“ ein.`
          : `Du hast ${year} bereits ${row.transactions} Verkäufe bzw. ${(netConsiderationCents(row) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} Umsatz. Ab ${DAC7_TX_THRESHOLD} Verkäufen oder mehr als ${(DAC7_GROSS_THRESHOLD_CENTS / 100).toLocaleString("de-DE")} € im Jahr sind wir gesetzlich zur Meldung verpflichtet (PStTG). Hinterlege jetzt Steuer-ID und Anschrift, damit dein Verkaufen nicht unterbrochen wird.`,
        "/?seller=taxinfo").catch(() => {});
    }
  }
  return { stage, reportingRequired: reporting };
}

/** Banner-Stand für den Verkäufer im laufenden Jahr (für /api/me, Verkäuferkonto und Steuerdaten-Dialog). */
export async function psttgNotice(userId: string) {
  const { year } = berlinYearQuarter();
  const [row] = await db.select().from(sellerDac7Stats).where(and(eq(sellerDac7Stats.userId, userId), eq(sellerDac7Stats.year, year))).limit(1);
  if (!row) return null;
  const stage = psttgStage(row);
  if (stage === "none") return null;
  const complete = rawComplete(await taxRowOf(userId));
  return {
    year, stage, taxInfoComplete: complete, transactions: row.transactions, netCents: netConsiderationCents(row),
    warn: { transactions: PSTTG_WARN_TX, grossCents: PSTTG_WARN_GROSS_CENTS },
    report: { transactions: DAC7_TX_THRESHOLD, grossCents: DAC7_GROSS_THRESHOLD_CENTS },
  };
}

/** Steuerdaten-Status im Verkäuferkonto-Spiegel (seller_accounts) nachziehen. */
export async function syncPsttgTaxFlag(userId: string) {
  const complete = rawComplete(await taxRowOf(userId));
  await db.update(sellerAccounts).set({ psttgTaxDataComplete: complete, updatedAt: new Date() }).where(eq(sellerAccounts.userId, userId));
  return complete;
}

/**
 * Erstattung bzw. verlorene Rückbuchung NACH der Auszahlung: Der Betrag wird im Jahr der Auszahlung als
 * Erstattung (refundedCents) gebucht und aus dem Quartal der Auszahlung herausgerechnet; die Provision gilt als
 * nicht einbehalten. Die Zahl der Verkäufe bleibt (die Tätigkeit wurde erbracht).
 */
export async function recordDac7Refund(order: Pick<Order, "sellerId" | "priceCents" | "shippingCents" | "feeCents" | "releasedAt">) {
  if (!order.releasedAt) return;
  const { year, quarter } = berlinYearQuarter(new Date(order.releasedAt));
  const gross = order.priceCents + order.shippingCents;
  const col = quarterColumn(quarter);
  await db.update(sellerDac7Stats).set({
    refundedCents: sql`${sellerDac7Stats.refundedCents} + ${gross}`,
    feeCents: sql`GREATEST(0, ${sellerDac7Stats.feeCents} - ${order.feeCents})`,
    [quarterKey(quarter)]: sql`GREATEST(0, ${col} - ${gross})`,
    updatedAt: new Date(),
  }).where(and(eq(sellerDac7Stats.userId, order.sellerId), eq(sellerDac7Stats.year, year)));
  await refreshPsttgFlags(order.sellerId, year);
}

// ---------------------------------------------------------------------------
// Sperre & Erinnerungen
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Verschlüsselte Steuerdaten (Steuer-ID, IBAN, Geburtsdatum – AES-256-GCM, server/vault.ts)
// ---------------------------------------------------------------------------
/** Verschlüsselte Spaltenwerte für die Datenbank. Das Klartext-Geburtsdatum (Spalte birth_date) wird geleert. */
async function sealTax(v: { taxId: string; iban: string; birthDate: string | null }) {
  return {
    taxId: await sealField(v.taxId, "tax_id"),
    iban: await sealField(v.iban, "iban"),
    birthDateEnc: await sealField(v.birthDate || "", "birth_date"),
    birthDate: null,
  };
}

/** Datenbankzeile → Klartext (nur serverintern, für Verkäufer selbst und den BZSt-Export). */
async function openTax(t: TaxRow): Promise<TaxRow> {
  const birth = t.birthDateEnc ? await openField(t.birthDateEnc, "birth_date") : (t.birthDate ? String(t.birthDate) : "");
  return { ...t, taxId: await openField(t.taxId, "tax_id"), iban: await openField(t.iban, "iban"), birthDate: birth || null };
}

/** Alt-Einträge (Klartext oder Notfall-Schlüssel) auf den aktuellen Schlüssel umschlüsseln. */
async function resealIfNeeded(raw: TaxRow, plain: TaxRow) {
  const legacyBirth = Boolean(raw.birthDate) && !raw.birthDateEnc;
  if (!legacyBirth && !needsReseal(raw.taxId) && !needsReseal(raw.iban) && !needsReseal(raw.birthDateEnc)) return false;
  const sealed = await sealTax({ taxId: plain.taxId, iban: plain.iban, birthDate: plain.birthDate ? String(plain.birthDate) : null });
  await db.update(sellerTaxInfo).set(sealed).where(eq(sellerTaxInfo.userId, raw.userId));
  return true;
}

async function taxInfoOf(userId: string): Promise<TaxRow | null> {
  const [t] = await db.select().from(sellerTaxInfo).where(eq(sellerTaxInfo.userId, userId)).limit(1);
  if (!t) return null;
  const plain = await openTax(t);
  resealIfNeeded(t, plain).catch((e) => log.error("dac7", "Umschlüsseln fehlgeschlagen", { err: e }));
  return plain;
}

async function taxRowOf(userId: string): Promise<TaxRow | null> {
  const [t] = await db.select().from(sellerTaxInfo).where(eq(sellerTaxInfo.userId, userId)).limit(1);
  return t ?? null;
}

/** DSGVO-Datenexport (Art. 15/20): eigene Steuerdaten mit maskierten sensiblen Feldern (Klartext nur im Verkäuferkonto). */
export async function taxInfoForExport(userId: string) {
  const raw = await taxRowOf(userId);
  if (!raw) return null;
  const birth = raw.birthDateEnc ? await openFieldSafe(raw.birthDateEnc, "birth_date") : { value: raw.birthDate ? String(raw.birthDate) : "", error: false };
  const tax = await openFieldSafe(raw.taxId, "tax_id"), iban = await openFieldSafe(raw.iban, "iban");
  return {
    sellerType: raw.sellerType, legalName: raw.legalName, street: raw.street, postalCode: raw.postalCode, city: raw.city, country: raw.country,
    vatId: raw.vatId, businessRegNo: raw.businessRegNo, collectedAt: raw.collectedAt, updatedAt: raw.updatedAt,
    birthDate: maskBirthDate(birth.value), taxId: maskTaxId(tax.value), iban: maskIban(iban.value),
    note: "Steuer-ID, IBAN und Geburtsdatum sind verschlüsselt gespeichert und hier maskiert. Vollständig einsehen: Verkäuferkonto → Steuerdaten (DAC7) → Anzeigen.",
  };
}

/** Vollständigkeit ohne Entschlüsseln (verschlüsselte Felder zählen als vorhanden). */
export const rawComplete = (t: TaxRow | null | undefined) => Boolean(t) && taxInfoComplete({ ...t!, birthDate: t!.birthDateEnc || (t!.birthDate ? String(t!.birthDate) : null) });

/**
 * Job (Treuhand-Lauf) und Admin-Knopf: unverschlüsselte Alt-Einträge und Einträge mit Notfall-Schlüssel
 * auf den aktuellen Schlüssel bringen. Fehler einzelner Zeilen blockieren den Rest nicht.
 */
export async function resealTaxRows(limit = 50) {
  const list = rows(await db.execute(sql`
    SELECT user_id FROM seller_tax_info
    WHERE tax_id NOT LIKE 'enc:v1:%' OR (iban <> '' AND iban NOT LIKE 'enc:v1:%') OR (birth_date IS NOT NULL AND birth_date_enc = '')
      ${vaultConfigured() ? sql`OR tax_id LIKE 'enc:v1:blob:%' OR iban LIKE 'enc:v1:blob:%' OR birth_date_enc LIKE 'enc:v1:blob:%'` : sql``}
    LIMIT ${limit}`));
  let resealed = 0, failed = 0;
  for (const r of list) {
    try {
      const [t] = await db.select().from(sellerTaxInfo).where(eq(sellerTaxInfo.userId, String(r.user_id))).limit(1);
      if (t && await resealIfNeeded(t, await openTax(t))) resealed++;
    } catch (e) { failed++; log.error("dac7", "Steuerdaten konnten nicht umgeschlüsselt werden", { err: e }); }
  }
  return { resealed, failed, remaining: Math.max(0, list.length - resealed - failed) };
}

/** Fehlermeldung, wenn der Verkäufer wegen fehlender DAC7-Angaben keine neuen Treuhand-Verkäufe starten darf, sonst null. */
export async function dac7SellerBlock(userId: string): Promise<string | null> {
  const { year } = berlinYearQuarter();
  // Vorjahr zählt mit: die Meldung für das Vorjahr erfolgt bis 31. Januar
  const stats = await db.select().from(sellerDac7Stats).where(and(eq(sellerDac7Stats.userId, userId), gte(sellerDac7Stats.year, year - 1)));
  const reportable = stats.filter((s) => dac7Reportable(s));
  if (!reportable.length) return null;
  const hasTaxInfo = rawComplete(await taxRowOf(userId));
  const hit = reportable.find((s) => dac7Blocked({ reportable: true, hasTaxInfo, remindersSent: s.remindersSent, lastReminderAt: s.lastReminderAt }));
  if (!hit) return null;
  return `Du hast ${hit.year} die DAC7-Meldegrenze erreicht (${DAC7_TX_THRESHOLD} Verkäufe oder mehr als ${(DAC7_GROSS_THRESHOLD_CENTS / 100).toLocaleString("de-DE")} €). Nach dem Plattformen-Steuertransparenzgesetz müssen wir deine Steuerdaten an das Bundeszentralamt für Steuern melden. Bitte trage sie unter „Verkäuferkonto → Steuerdaten (DAC7)“ ein – bis dahin sind neue Verkäufe mit Käuferschutz gesperrt.`;
}

/** Teil des Treuhand-Jobs: meldepflichtige Verkäufer ohne Steuerdaten erinnern (max. 2-mal, im Abstand von 7 Tagen). */
export async function runDac7Reminders(now = new Date()) {
  const { year } = berlinYearQuarter(now);
  const list = rows(await db.execute(sql`
    SELECT s.id, s.user_id, s.year, s.transactions, s.gross_cents, s.refunded_cents, s.reminders_sent, s.last_reminder_at,
      t.user_id AS tax_user, t.seller_type, t.legal_name, t.street, t.postal_code, t.city, t.country, t.birth_date, t.birth_date_enc, t.tax_id, t.vat_id, t.business_reg_no, t.iban
    FROM seller_dac7_stats s LEFT JOIN seller_tax_info t ON t.user_id = s.user_id
    WHERE s.year >= ${year - 1} AND s.reminders_sent < ${DAC7_MAX_REMINDERS}
      AND (s.transactions >= ${DAC7_TX_THRESHOLD} OR s.gross_cents - s.refunded_cents > ${DAC7_GROSS_THRESHOLD_CENTS})
    ORDER BY s.last_reminder_at NULLS FIRST LIMIT 100`));
  let sent = 0;
  for (const r of list) {
    const stats = { transactions: Number(r.transactions), grossCents: Number(r.gross_cents), refundedCents: Number(r.refunded_cents) };
    const hasTaxInfo = Boolean(r.tax_user) && taxInfoComplete({
      sellerType: r.seller_type, legalName: r.legal_name, street: r.street, postalCode: r.postal_code, city: r.city, country: r.country,
      birthDate: r.birth_date_enc || (r.birth_date ? String(r.birth_date) : null), taxId: r.tax_id, vatId: r.vat_id, businessRegNo: r.business_reg_no, iban: r.iban,
    });
    const state = { reportable: dac7Reportable(stats), hasTaxInfo, remindersSent: Number(r.reminders_sent), lastReminderAt: r.last_reminder_at ? new Date(r.last_reminder_at) : null };
    if (!dac7ReminderDue(state, now)) continue;
    // Genau einmal je Stufe (paralleler Job-Lauf)
    const [claimed] = await db.update(sellerDac7Stats).set({ remindersSent: sql`${sellerDac7Stats.remindersSent} + 1`, lastReminderAt: now })
      .where(and(eq(sellerDac7Stats.id, Number(r.id)), eq(sellerDac7Stats.remindersSent, state.remindersSent))).returning();
    if (!claimed) continue;
    const last = claimed.remindersSent >= DAC7_MAX_REMINDERS;
    const deadline = new Date(now.getTime() + DAC7_REMINDER_INTERVAL_DAYS * 86400_000).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
    await notify(String(r.user_id), last ? "🧾 Letzte Erinnerung: Steuerdaten fehlen" : "🧾 Steuerdaten für DAC7 benötigt",
      `Du hast ${r.year} ${netConsiderationCents(stats) > DAC7_GROSS_THRESHOLD_CENTS ? "mehr als 2.000 € verkauft" : `${DAC7_TX_THRESHOLD} Verkäufe abgeschlossen`}. Nach dem Plattformen-Steuertransparenzgesetz (DAC7) müssen wir Name, Anschrift, Geburtsdatum, Steuer-ID und IBAN an das Bundeszentralamt für Steuern melden. Bitte trage sie im Verkäuferkonto unter „Steuerdaten (DAC7)“ ein.${last ? ` Ohne Angaben bis ${deadline} sind neue Verkäufe mit Käuferschutz gesperrt.` : ""}`,
      "/?seller=taxinfo");
    sent++;
  }
  return { reminded: sent };
}

// ---------------------------------------------------------------------------
// Admin-Übersicht und Export
// ---------------------------------------------------------------------------
async function sellerYearRows(year: number) {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  return rows(await db.execute(sql`
    SELECT s.*, p.display_name, p.email, p.flagged_at, p.stripe_account_id,
      t.user_id AS tax_user, t.seller_type, t.legal_name, t.street, t.postal_code, t.city, t.country, t.birth_date::text AS birth_date, t.birth_date_enc,
      t.tax_id, t.vat_id, t.business_reg_no, t.iban, t.updated_at AS tax_updated_at,
      coalesce(x.sealed_sales, 0)::int AS sealed_sales, coalesce(x.q1_tx, 0)::int AS q1_tx, coalesce(x.q2_tx, 0)::int AS q2_tx,
      coalesce(x.q3_tx, 0)::int AS q3_tx, coalesce(x.q4_tx, 0)::int AS q4_tx,
      coalesce(x.q1_fee, 0)::int AS q1_fee, coalesce(x.q2_fee, 0)::int AS q2_fee, coalesce(x.q3_fee, 0)::int AS q3_fee, coalesce(x.q4_fee, 0)::int AS q4_fee,
      coalesce(r.max_repeat, 0)::int AS max_repeat
    FROM seller_dac7_stats s
    JOIN profiles p ON p.user_id = s.user_id
    LEFT JOIN seller_tax_info t ON t.user_id = s.user_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE l.sealed_product_id IS NOT NULL OR l.condition = 'sealed') AS sealed_sales,
        ${sql.raw([1, 2, 3, 4].map((q) => `count(*) FILTER (WHERE extract(quarter FROM o.released_at AT TIME ZONE 'Europe/Berlin') = ${q}) AS q${q}_tx, sum(o.fee_cents) FILTER (WHERE extract(quarter FROM o.released_at AT TIME ZONE 'Europe/Berlin') = ${q} AND o.status <> 'chargeback_lost') AS q${q}_fee`).join(", "))}
      FROM market_orders o LEFT JOIN listings l ON l.id = o.listing_id
      WHERE o.seller_id = s.user_id AND o.released_at IS NOT NULL
        AND (o.released_at AT TIME ZONE 'Europe/Berlin') >= ${from}::timestamp AND (o.released_at AT TIME ZONE 'Europe/Berlin') < ${to}::timestamp
    ) x ON true
    LEFT JOIN LATERAL (
      SELECT max(n) AS max_repeat FROM (
        SELECT count(*) AS n FROM market_orders o
        WHERE o.seller_id = s.user_id AND o.released_at IS NOT NULL
          AND (o.released_at AT TIME ZONE 'Europe/Berlin') >= ${from}::timestamp AND (o.released_at AT TIME ZONE 'Europe/Berlin') < ${to}::timestamp
        GROUP BY lower(o.title)) g
    ) r ON true
    WHERE s.year = ${year}
    ORDER BY (s.gross_cents - s.refunded_cents) DESC LIMIT 2000`));
}

/** Steuerdaten einer Admin-Zeile – sensible Felder noch verschlüsselt (Vollständigkeit lässt sich trotzdem prüfen). */
function taxOfRow(r: any) {
  if (!r.tax_user) return null;
  return {
    sellerType: r.seller_type, legalName: r.legal_name, street: r.street, postalCode: r.postal_code, city: r.city, country: r.country,
    birthDate: r.birth_date_enc || r.birth_date || null, taxId: r.tax_id, vatId: r.vat_id, businessRegNo: r.business_reg_no, iban: r.iban,
  };
}

/** Sensible Felder einer Admin-Zeile entschlüsseln (Fehler → leer + Kennzeichen, der Export läuft weiter). */
async function openRowTax(r: any) {
  const birth = r.birth_date_enc ? await openFieldSafe(r.birth_date_enc, "birth_date") : { value: r.birth_date || "", error: false };
  const tax = await openFieldSafe(r.tax_id, "tax_id");
  const iban = await openFieldSafe(r.iban, "iban");
  return { taxId: tax.value, iban: iban.value, birthDate: birth.value || null, error: tax.error || iban.error || birth.error };
}

function evaluate(r: any) {
  const stats = { transactions: Number(r.transactions), grossCents: Number(r.gross_cents), refundedCents: Number(r.refunded_cents) };
  const reasons = commercialReasons({
    ...stats, sealedSales: Number(r.sealed_sales), maxRepeatTitle: Number(r.max_repeat),
    maxQuarterTransactions: Math.max(Number(r.q1_tx), Number(r.q2_tx), Number(r.q3_tx), Number(r.q4_tx)),
  });
  const tax = taxOfRow(r);
  return { stats, reportable: dac7Reportable(stats), commercial: reasons.length > 0, commercialReasons: reasons, tax, taxComplete: taxInfoComplete(tax) };
}


function parseYear(v: unknown) {
  const now = berlinYearQuarter().year;
  const y = int(v, 2023, now + 1, 0);
  return y || now;
}

// ---------------------------------------------------------------------------
// Routen (eingebunden aus registerMarket)
// ---------------------------------------------------------------------------
export function registerDac7(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;

  app.get("/api/market/tax-info", auth, async (c: any) => {
    const userId: string = c.get("user").id;
    // Klartext nur auf ausdrücklichen Wunsch des Verkäufers selbst („👁️ Anzeigen“), sonst maskiert
    const reveal = c.req.query("reveal") === "1";
    if (reveal && !(await rateLimit(`taxreveal:${userId}`, 20, 3600_000))) return c.json({ error: "Zu viele Abrufe – bitte später erneut versuchen." }, 429);
    c.header("Cache-Control", "private, no-store");
    const { year } = berlinYearQuarter();
    let tax: TaxRow | null;
    try { tax = await taxInfoOf(userId); }
    catch (e) { log.error("dac7", "Steuerdaten nicht lesbar", { err: e }); return c.json({ error: "Deine Steuerdaten können gerade nicht entschlüsselt werden. Bitte später erneut versuchen." }, 503); }
    const stats = await db.select().from(sellerDac7Stats).where(and(eq(sellerDac7Stats.userId, userId), gte(sellerDac7Stats.year, year - 1)));
    const cur = stats.find((s) => s.year === year);
    const reportable = stats.some((s) => dac7Reportable(s));
    const complete = taxInfoComplete(tax);
    return c.json({
      taxInfo: tax ? {
        sellerType: tax.sellerType, legalName: tax.legalName, street: tax.street, postalCode: tax.postalCode, city: tax.city, country: tax.country,
        vatId: tax.vatId, businessRegNo: tax.businessRegNo, updatedAt: tax.updatedAt,
        ...(reveal
          ? { birthDate: tax.birthDate, taxId: tax.taxId, iban: tax.iban }
          : { birthDate: "", taxId: "", iban: "", birthDateMasked: maskBirthDate(tax.birthDate ? String(tax.birthDate) : ""), taxIdMasked: maskTaxId(tax.taxId), ibanMasked: maskIban(tax.iban) }),
        hasBirthDate: Boolean(tax.birthDate), hasTaxId: Boolean(tax.taxId), hasIban: Boolean(tax.iban), revealed: reveal, encrypted: true,
      } : null,
      complete, reportable, required: reportable && !complete, blocked: Boolean(await dac7SellerBlock(userId)),
      year: { year, transactions: cur?.transactions ?? 0, netCents: cur ? netConsiderationCents(cur) : 0 },
      thresholds: { transactions: DAC7_TX_THRESHOLD, grossCents: DAC7_GROSS_THRESHOLD_CENTS },
      warnThresholds: { transactions: PSTTG_WARN_TX, grossCents: PSTTG_WARN_GROSS_CENTS },
      notice: await psttgNotice(userId),
    });
  });

  app.put("/api/market/tax-info", auth, async (c: any) => {
    const userId: string = c.get("user").id;
    if (!(await rateLimit(`taxinfo:${userId}`, 10, 3600_000))) return c.json({ error: "Zu viele Änderungen – bitte später erneut versuchen." }, 429);
    const input = await body(c);
    // Sensible Felder werden im Formular nur maskiert angezeigt: leer gelassen = gespeicherten Wert behalten
    const keep = (v: unknown) => v === undefined || v === null || String(v).trim() === "" || String(v).includes("•");
    if (keep(input.taxId) || keep(input.iban) || keep(input.birthDate)) {
      const prev = await taxInfoOf(userId);
      if (prev) {
        if (keep(input.taxId)) input.taxId = prev.taxId;
        if (keep(input.iban)) input.iban = prev.iban;
        if (keep(input.birthDate) && input.sellerType !== "entity") input.birthDate = prev.birthDate ? String(prev.birthDate) : "";
      }
    }
    const r = validateTaxInfo(input);
    if (!r.ok) return c.json({ error: r.error, field: r.field }, 400);
    const v = r.value;
    const now = new Date();
    let sealed;
    try { sealed = await sealTax(v); }
    catch (e) { log.error("dac7", "Steuerdaten konnten nicht verschlüsselt werden", { err: e }); return c.json({ error: "Speichern ist gerade nicht möglich (Verschlüsselung nicht verfügbar). Bitte später erneut versuchen." }, 503); }
    const values = { ...v, ...sealed };
    const [saved] = await db.insert(sellerTaxInfo).values({ userId, ...values, collectedAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: sellerTaxInfo.userId, set: { ...values, updatedAt: now } }).returning();
    await syncPsttgTaxFlag(userId).catch(() => {});
    return c.json({ ok: true, complete: rawComplete(saved), updatedAt: saved.updatedAt });
  });

  app.get("/api/admin/dac7", auth, adminOnly, async (c: any) => {
    const year = parseYear(c.req.query("year"));
    const list = await sellerYearRows(year);
    const sellers = [];
    for (const r of list) {
      const e = evaluate(r);
      if (e.commercial !== Boolean(r.commercial_flag)) await db.update(sellerDac7Stats).set({ commercialFlag: e.commercial }).where(eq(sellerDac7Stats.id, Number(r.id)));
      if (e.reportable !== Boolean(r.reporting_required)) await db.update(sellerDac7Stats).set({ reportingRequired: e.reportable }).where(eq(sellerDac7Stats.id, Number(r.id)));
      sellers.push({
        userId: r.user_id, displayName: r.display_name, email: r.email, flagged: Boolean(r.flagged_at),
        transactions: e.stats.transactions, grossCents: e.stats.grossCents, refundedCents: e.stats.refundedCents, netCents: netConsiderationCents(e.stats),
        feeCents: Number(r.fee_cents), quarters: [Number(r.q1_cents), Number(r.q2_cents), Number(r.q3_cents), Number(r.q4_cents)],
        reportable: e.reportable, stage: psttgStage(e.stats), warningSent: Boolean(r.threshold_warning_sent), commercial: e.commercial, commercialReasons: e.commercialReasons,
        taxInfo: e.tax ? await (async () => {
          const o = await openRowTax(r);
          return { complete: e.taxComplete, sellerType: e.tax!.sellerType, legalName: e.tax!.legalName, country: e.tax!.country,
            taxId: maskTaxId(o.taxId), iban: maskIban(o.iban), birthDate: maskBirthDate(o.birthDate || ""), decryptError: o.error };
        })() : null,
        remindersSent: Number(r.reminders_sent), lastReminderAt: r.last_reminder_at,
        blocked: e.reportable && !e.taxComplete && dac7Blocked({ reportable: true, hasTaxInfo: false, remindersSent: Number(r.reminders_sent), lastReminderAt: r.last_reminder_at ? new Date(r.last_reminder_at) : null }),
      });
    }
    const summary = {
      sellers: sellers.length, reportable: sellers.filter((s) => s.reportable).length,
      missingTaxInfo: sellers.filter((s) => s.reportable && !s.taxInfo?.complete).length,
      commercial: sellers.filter((s) => s.commercial).length, blocked: sellers.filter((s) => s.blocked).length,
      netCents: sellers.reduce((a, s) => a + s.netCents, 0), feeCents: sellers.reduce((a, s) => a + s.feeCents, 0),
    };
    return c.json({ year, sellers, summary, thresholds: { transactions: DAC7_TX_THRESHOLD, grossCents: DAC7_GROSS_THRESHOLD_CENTS }, vault: { configured: vaultConfigured() } });
  });

  // Alt-Einträge (Klartext / Notfall-Schlüssel) sofort umschlüsseln – läuft sonst schrittweise im Treuhand-Job
  app.post("/api/admin/dac7/reseal", auth, adminOnly, async (c: any) => {
    let total = 0, failed = 0;
    for (let i = 0; i < 20; i++) {
      const r = await resealTaxRows(100);
      total += r.resealed; failed += r.failed;
      if (r.resealed + r.failed === 0 || r.remaining === 0 && r.resealed < 100) break;
    }
    await db.insert(moderationLog).values({ actorId: c.get("user").id, action: "dac7_reseal", targetType: "dac7", targetId: "seller_tax_info", reason: `${total} umgeschlüsselt, ${failed} Fehler` });
    return c.json({ ok: true, resealed: total, failed, keyConfigured: vaultConfigured() });
  });

  app.get("/api/admin/dac7/export.csv", auth, adminOnly, async (c: any) => {
    const year = parseYear(c.req.query("year"));
    const all = str(c.req.query("all"), 1) === "1";
    // Klartext ausschließlich für die BZSt-Meldedatei (nur meldepflichtige Verkäufer, ausdrücklich angefordert, protokolliert).
    // Jede andere Ausgabe – auch „alle Verkäufer“ – enthält Steuer-ID, IBAN und Geburtsdatum nur maskiert.
    const plain = !all && str(c.req.query("purpose"), 10) === "bzst";
    const list = await sellerYearRows(year);
    const header = [
      "Verkäufer-ID", "Sammlername", "Art (natürliche Person/Unternehmen)", "Name / Firma", "Straße und Hausnummer", "PLZ", "Ort", "Land (ISO)",
      "Geburtsdatum", "Steuer-ID (TIN)", "TIN ausgestellt in", "USt-IdNr.", "Handelsregisternummer", "IBAN (Finanzkonto)", "Stripe-Konto",
      "Anzahl Verkäufe Q1", "Anzahl Verkäufe Q2", "Anzahl Verkäufe Q3", "Anzahl Verkäufe Q4", "Anzahl Verkäufe gesamt",
      "Vergütung Q1 (EUR)", "Vergütung Q2 (EUR)", "Vergütung Q3 (EUR)", "Vergütung Q4 (EUR)", "Vergütung gesamt netto (EUR)", "Erstattungen (EUR)",
      "Gebühren Q1 (EUR)", "Gebühren Q2 (EUR)", "Gebühren Q3 (EUR)", "Gebühren Q4 (EUR)", "Gebühren gesamt (EUR)",
      "Meldepflichtig", "Steuerdaten vollständig", "Gewerbliches Muster", "Meldejahr",
    ];
    const lines = [csvRow(header)];
    let count = 0;
    for (const r of list) {
      const e = evaluate(r);
      if (!all && !e.reportable) continue;
      const t = e.tax;
      const o = t ? await openRowTax(r) : null;
      const birth = o?.birthDate ? (plain ? new Date(`${o.birthDate}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }) : maskBirthDate(o.birthDate)) : "";
      lines.push(csvRow([
        r.user_id, r.display_name, t ? (t.sellerType === "entity" ? "Unternehmen" : "natürliche Person") : "", t?.legalName ?? "", t?.street ?? "", t?.postalCode ?? "",
        t?.city ?? "", t?.country ?? "", birth,
        o ? (plain ? o.taxId : maskTaxId(o.taxId)) : "", t?.country ?? "", t?.vatId ?? "", t?.businessRegNo ?? "", o ? (plain ? o.iban : maskIban(o.iban)) : "", r.stripe_account_id ?? "",
        Number(r.q1_tx), Number(r.q2_tx), Number(r.q3_tx), Number(r.q4_tx), e.stats.transactions,
        csvEuro(Number(r.q1_cents)), csvEuro(Number(r.q2_cents)), csvEuro(Number(r.q3_cents)), csvEuro(Number(r.q4_cents)),
        csvEuro(netConsiderationCents(e.stats)), csvEuro(e.stats.refundedCents),
        csvEuro(Number(r.q1_fee)), csvEuro(Number(r.q2_fee)), csvEuro(Number(r.q3_fee)), csvEuro(Number(r.q4_fee)), csvEuro(Number(r.fee_cents)),
        e.reportable ? "ja" : "nein", e.taxComplete ? "ja" : "nein", e.commercial ? `ja (${e.commercialReasons.join(", ")})` : "nein", year,
      ]));
      count++;
    }
    await db.insert(moderationLog).values({ actorId: c.get("user").id, action: plain ? "dac7_export_bzst" : "dac7_export", targetType: "dac7", targetId: String(year), reason: `${count} Verkäufer${all ? " (alle)" : ""}${plain ? " – Klartext für BZSt-Meldung" : " – maskiert"}` });
    return new Response(`﻿${lines.join("\r\n")}\r\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${plain ? `dac7-bzst-meldung-${year}` : `dac7-uebersicht-${year}-maskiert`}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
